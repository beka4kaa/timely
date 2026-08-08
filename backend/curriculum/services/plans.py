"""Сборка курса: цель + книга → план → валидация → рецензия → прогноз.

Здесь соблюдается разделение из `planning/contracts.py`: модель отдаёт ТОЛЬКО
семантику (темы, зависимости, приблизительные длительности и ссылки на выданные
ей chunk_id), а даты, порядок, права и нагрузку считает backend.

Порядок шагов зафиксирован и не сокращается:

    planner → validate → (блокеры ⇒ НИЧЕГО не сохраняем) → review → persist →
    forecast → снапшот версии → ожидание подтверждения ученика

Валидатор — граница доверия. Если он нашёл блокер (в том числе
`hallucinated_source`, то есть ссылку на несуществующий фрагмент), план не
попадает в БД вообще: курс со ссылкой на выдуманный источник хуже отсутствующего
курса.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

from django.db import transaction
from django.utils import timezone

from ..forecast import (
    ForecastInput,
    ForecastNotPossible,
    compute_forecast,
    suggest_intensity,
)
from ..models import (
    PLANNING_SCHEMA_VERSION,
    CourseDependency,
    CourseEnrollment,
    CourseMilestone,
    CourseModule,
    CoursePlan,
    CoursePlanVersion,
    CourseSourceBinding,
    CourseTopic,
    Document,
    DocumentSection,
    KnowledgeChunk,
    LearningGoal,
)
from ..planning.contracts import (
    BookMetadata,
    CoursePlanningRequest,
    PlanningConstraints,
    TocEntry,
)
from ..planning.providers import get_planning_provider, get_review_provider
from ..planning.validation import ValidationReport, topological_order, validate_plan
from ..retrieval import (
    ContextAssembler,
    KnowledgeRetrievalService,
    RetrievableChunk,
    RetrievalBundle,
    RetrievalPolicy,
    apply_access_policy,
)

logger = logging.getLogger(__name__)

# Режим retrieval для планирования. НЕ входит в `_SOLUTION_MODES`, поэтому
# решения задач в контекст планировщика не попадают: планировщику они не нужны,
# а любой их вынос за пределы политики — потенциальная утечка.
PLANNING_RETRIEVAL_MODE = "explain"
PLANNING_MAX_CHUNKS = 24
PLANNING_TOKEN_BUDGET = 6000


class PlanRejected(RuntimeError):
    """План не прошёл валидацию или рецензию. В БД ничего не записано."""

    def __init__(self, report: ValidationReport | None, message: str) -> None:
        super().__init__(message)
        self.report = report
        self.message = message


@dataclass
class PlanGenerationOutcome:
    """Итог генерации: план, отчёт валидатора и находки рецензента."""

    plan: CoursePlan | None
    report: ValidationReport | None = None
    review_findings: list[dict] = field(default_factory=list)
    planner_model: str = ""
    reviewer_model: str = ""
    warnings: list[str] = field(default_factory=list)


# ───────────────────────── Подготовка входа модели ───────────────────────────


def _as_retrievable(chunk: KnowledgeChunk, document: Document) -> RetrievableChunk:
    return RetrievableChunk(
        chunk_id=str(chunk.pk),
        document_id=str(document.pk),
        owner_email=document.user_email,
        chunk_type=chunk.chunk_type,
        text=chunk.normalized_text,
        section_path=chunk.section_path,
        page_start=chunk.page_start,
        page_end=chunk.page_end,
        document_title=document.title,
        access_scope=chunk.access_scope,
        solution_visibility=chunk.solution_visibility,
        language=document.language,
        task_id=str(chunk.task_id) if chunk.task_id else None,
    )


def retrieve_planning_context(
    goal: LearningGoal, document: Document
) -> RetrievalBundle:
    """Отбирает фрагменты книги, на которые планировщику разрешено ссылаться.

    Стратегия здесь ПОКРЫТИЕ, а не релевантность запросу, и это осознанно.
    Обычный RAG ищет top-k под конкретный вопрос; планировщику курса нужен
    представительный срез всей книги, иначе он построит программу по одному
    случайно похожему разделу.

    Практическая причина та же: релевантность считает `SimpleLexicalRetriever`
    (BM25 без морфологии, о чём честно написано в его docstring) плюс
    `InMemoryDenseRetriever` (пересечение термов, не эмбеддинги). На цели
    «механика кинематика с нуля» и книге, где раздел называется иначе, оба дают
    ноль совпадений — и планировать оказывалось не из чего.

    Поэтому: сначала обычная гибридная выдача по цели (релевантное — вперёд),
    затем доливка по разделам, которые в неё не попали. Политика доступа
    применяется ДО всего и одна для обеих частей, поэтому решения задач в
    контекст планировщика не попадают ни тем, ни другим путём.
    """
    policy = RetrievalPolicy(
        mode=PLANNING_RETRIEVAL_MODE,
        max_chunks=PLANNING_MAX_CHUNKS,
        token_budget=PLANNING_TOKEN_BUDGET,
    )
    query = " ".join(
        part
        for part in (
            goal.normalized_subject,
            goal.normalized_direction,
            goal.original_text,
        )
        if part
    )
    chunks = [
        _as_retrievable(chunk, document)
        for chunk in KnowledgeChunk.objects.filter(document=document)
        .select_related("task")
        .order_by("page_start", "id")
    ]
    document_ids = [str(document.pk)]

    relevant = KnowledgeRetrievalService().retrieve(
        user_email=goal.user_email,
        query=query,
        chunks=chunks,
        policy=policy,
        document_ids=document_ids,
    )

    allowed = apply_access_policy(
        chunks,
        user_email=goal.user_email,
        policy=policy,
        document_ids=document_ids,
    )
    ordered = _coverage_order(allowed, already=relevant.chunk_ids)
    if not ordered:
        return relevant

    # Синтетические строки для сборщика: 4-кортеж (чанк, lexical, dense, fused).
    # Нулевые веса — честно: это добор по покрытию, а не результат поиска.
    topped_up = ContextAssembler().assemble(
        [(chunk, 0.0, 0.0, 0.0) for chunk in ordered], policy=policy
    )

    merged = RetrievalBundle(policy_mode=policy.mode)
    seen: set[str] = set()
    for result in list(relevant.results) + list(topped_up.results):
        if result.chunk_id in seen or len(merged.results) >= policy.max_chunks:
            continue
        seen.add(result.chunk_id)
        merged.results.append(result)
    merged.truncated = relevant.truncated or topped_up.truncated
    return merged


def _coverage_order(candidates, *, already: list[str]):
    """Раскладывает фрагменты round-robin по разделам.

    Round-robin, а не «по порядку страниц»: подряд идущие чанки приходят из
    одной главы, и при лимите `max_chunks` планировщик увидел бы только начало
    книги. Обход по одному фрагменту от каждого раздела даёт срез всей книги.
    Детерминированность обеспечена сортировкой по `(section_path, chunk_id)`.
    """
    taken = set(already)
    by_section: dict[str, list] = {}
    for chunk in candidates:
        if chunk.chunk_id in taken:
            continue
        by_section.setdefault(chunk.section_path, []).append(chunk)
    for bucket in by_section.values():
        # Определения и теоремы информативнее для структуры курса, чем задачи.
        bucket.sort(key=lambda c: (_TYPE_PRIORITY.get(c.chunk_type, 5), c.chunk_id))

    ordered = []
    paths = sorted(by_section)
    index = 0
    while any(by_section[path] for path in paths):
        for path in paths:
            bucket = by_section[path]
            if index < len(bucket):
                ordered.append(bucket[index])
        index += 1
        if index > PLANNING_MAX_CHUNKS:
            break
    return ordered


# Приоритет типов для добора по покрытию: структуру курса определяют
# определения и теоремы, а не условия задач.
_TYPE_PRIORITY = {
    "definition": 0,
    "theorem": 1,
    "summary": 2,
    "prose": 3,
    "example": 4,
    "proof": 5,
    "table": 6,
    "figure": 6,
    "task": 7,
}


def build_planning_request(
    goal: LearningGoal, document: Document, bundle: RetrievalBundle
) -> CoursePlanningRequest:
    """Собирает вход планировщика.

    Названия разделов передаются ДОСЛОВНО: `validation` считает покрытие
    оглавления точным совпадением строк (case-folded), поэтому любая
    «причёсанная» здесь формулировка обнулила бы метрику покрытия.
    """
    sections = DocumentSection.objects.filter(document=document).order_by("order_index")
    toc = tuple(
        TocEntry(
            path=section.path,
            title=section.title,
            page_start=section.start_page,
            page_end=section.end_page,
        )
        for section in sections
    )
    return CoursePlanningRequest(
        goal_text=goal.original_text,
        normalized_subject=goal.normalized_subject,
        normalized_direction=goal.normalized_direction,
        current_level=goal.current_level,
        target_level=goal.target_level,
        language=goal.preferred_language,
        theory_practice_balance=goal.theory_practice_balance,
        desired_finish_date=(
            goal.desired_finish_date.isoformat() if goal.desired_finish_date else None
        ),
        book=BookMetadata(
            title=document.title,
            authors=tuple(document.authors or ()),
            language=document.language,
            document_id=str(document.pk),
        ),
        toc=toc,
        available_chunk_ids=tuple(bundle.chunk_ids),
        source_excerpts="",
        constraints=PlanningConstraints(required_language=goal.preferred_language),
        schema_version=PLANNING_SCHEMA_VERSION,
    )


# ───────────────────── Нормализация перечислений модели ──────────────────────

# Синонимы, которые модели возвращают вместо значений контракта. Нормализация —
# работа backend'а (тот же принцип, что и «даты считает backend»), поэтому
# известный синоним приводится к канону ЗДЕСЬ, до валидатора.
#
# Это не ослабление валидатора: неизвестное значение по-прежнему доедет до
# `validate_plan` и заблокирует план. Смысл в том, что план на десять модулей не
# должен выбрасываться целиком из-за того, что модель написала «средняя» вместо
# «medium».
_DIFFICULTY_SYNONYMS = {
    "easy": "easy",
    "легкая": "easy",
    "легкая ": "easy",
    "лёгкая": "easy",
    "простая": "easy",
    "basic": "easy",
    "beginner": "easy",
    "low": "easy",
    "medium": "medium",
    "средняя": "medium",
    "средний": "medium",
    "normal": "medium",
    "moderate": "medium",
    "intermediate": "medium",
    "hard": "hard",
    "сложная": "hard",
    "сложный": "hard",
    "трудная": "hard",
    "difficult": "hard",
    "advanced": "hard",
    "high": "hard",
}

_BALANCE_SYNONYMS = {
    "theory": "theory",
    "теория": "theory",
    "теоретический": "theory",
    "balanced": "balanced",
    "поровну": "balanced",
    "сбалансированный": "balanced",
    "mixed": "balanced",
    "practice": "practice",
    "практика": "practice",
    "практический": "practice",
}

_REVIEW_SYNONYMS = {
    "": "",
    "spaced": "spaced",
    "интервальное": "spaced",
    "интервальный": "spaced",
    "spaced_repetition": "spaced",
    "massed": "massed",
    "блочное": "massed",
    "interleaved": "interleaved",
    "перемежающееся": "interleaved",
}


def _canonical(value: str, table: dict[str, str], default: str) -> str:
    key = (value or "").strip().lower()
    if not key:
        return default
    return table.get(key, value)


def normalize_enum_fields(result) -> None:
    """Приводит перечисления к контракту на месте, до валидации."""
    for topic in result.all_topics():
        topic.difficulty = _canonical(topic.difficulty, _DIFFICULTY_SYNONYMS, "medium")
        topic.theory_practice_balance = _canonical(
            topic.theory_practice_balance, _BALANCE_SYNONYMS, "balanced"
        )
        topic.review_strategy = _canonical(topic.review_strategy, _REVIEW_SYNONYMS, "")


# ──────────────────────────────── Генерация ──────────────────────────────────


def generate_plan(
    goal: LearningGoal,
    document: Document,
    *,
    planning_provider=None,
    review_provider=None,
    start_date: date | None = None,
) -> PlanGenerationOutcome:
    """Полный цикл генерации. Кидает `PlanRejected`, если план непригоден."""
    if document.ingestion_status != Document.Status.READY:
        raise PlanRejected(
            None,
            "Документ ещё не обработан: дождитесь статуса «готов».",
        )

    bundle = retrieve_planning_context(goal, document)
    if not bundle.chunk_ids:
        raise PlanRejected(
            None, "В документе нет фрагментов, пригодных для планирования курса."
        )

    request = build_planning_request(goal, document, bundle)
    planner = planning_provider or get_planning_provider()

    try:
        result = planner.generate_plan(request, bundle)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Планировщик отказал для цели %s: %s", goal.pk, exc)
        raise PlanRejected(None, f"Планировщик недоступен: {exc}") from exc

    normalize_enum_fields(result)
    report = validate_plan(result, request)
    if not report.is_valid:
        # Блокеры — стоп. Ничего не сохраняем: план со ссылками на выдуманные
        # фрагменты или с циклом в зависимостях в БД попасть не должен.
        codes = sorted({issue.code for issue in report.issues if issue.is_blocker})
        raise PlanRejected(report, f"План не прошёл валидацию: {', '.join(codes)}")

    reviewer = review_provider or get_review_provider()
    review = None
    try:
        review = reviewer.review_plan(result, request)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Рецензент недоступен для цели %s: %s", goal.pk, exc)

    findings = [
        {
            "kind": finding.kind,
            "message": finding.message,
            "topic_external_id": finding.topic_external_id,
            "severity": finding.severity,
        }
        for finding in (review.findings if review else [])
    ]

    with transaction.atomic():
        plan = _persist_plan(
            goal=goal,
            document=document,
            result=result,
            report=report,
            review=review,
            request=request,
        )
        blockers = review.blockers if review else []
        if blockers:
            # Рецензент нашёл блокер: план сохраняем (ученик должен видеть, что
            # именно забраковано), но публикацию не разрешаем.
            plan.status = CoursePlan.Status.REJECTED
        else:
            plan.status = CoursePlan.Status.AWAITING_APPROVAL
        plan.save(update_fields=["status", "updated_at"])

        forecast_warnings = _apply_forecast(plan, goal, start_date=start_date)
        _snapshot_version(plan, result, reason="initial_generation")

    warning_codes = sorted(
        {issue.code for issue in report.issues if not issue.is_blocker}
    )
    return PlanGenerationOutcome(
        plan=plan,
        report=report,
        review_findings=findings,
        planner_model=getattr(planner, "name", ""),
        reviewer_model=getattr(reviewer, "name", ""),
        warnings=warning_codes + forecast_warnings,
    )


def _persist_plan(
    *,
    goal: LearningGoal,
    document: Document,
    result,
    report: ValidationReport,
    review,
    request: CoursePlanningRequest,
) -> CoursePlan:
    plan = CoursePlan.objects.create(
        user_email=goal.user_email,
        goal=goal,
        document=document,
        title=result.title[:300],
        objective=result.objective,
        current_level=goal.current_level,
        target_level=goal.target_level,
        language=goal.preferred_language,
        estimated_total_minutes=result.total_minutes(),
        status=CoursePlan.Status.REVIEWING,
        generation_model=result.model[:160],
        reviewer_model=(getattr(review, "model", "") or "")[:160],
        generation_prompt_version=result.prompt_version[:32],
        review_prompt_version=(getattr(review, "prompt_version", "") or "")[:32],
        source_processing_version=document.processing_version,
        schema_version=request.schema_version,
        current_version=1,
    )

    topics_by_external: dict[str, CourseTopic] = {}
    for module_index, proposed_module in enumerate(result.modules):
        module = CourseModule.objects.create(
            plan=plan,
            external_id=proposed_module.external_id[:64],
            title=proposed_module.title[:300],
            objective=proposed_module.objective,
            order_index=module_index,
            estimated_minutes=proposed_module.estimated_minutes,
            completion_criteria=proposed_module.completion_criteria,
        )
        if proposed_module.milestone:
            CourseMilestone.objects.create(
                plan=plan,
                module=module,
                title=proposed_module.milestone[:300],
                description="",
                order_index=module_index,
            )
        for topic_index, proposed_topic in enumerate(proposed_module.topics):
            topic = CourseTopic.objects.create(
                module=module,
                external_id=proposed_topic.external_id[:64],
                title=proposed_topic.title[:300],
                objective=proposed_topic.objective,
                order_index=topic_index,
                difficulty=proposed_topic.difficulty[:24],
                estimated_minutes=proposed_topic.estimated_minutes,
                suggested_lesson_count=proposed_topic.suggested_lesson_count,
                theory_practice_balance=proposed_topic.theory_practice_balance[:16],
                mastery_criteria=proposed_topic.mastery_criteria,
                review_strategy=proposed_topic.review_strategy[:64],
            )
            topics_by_external[proposed_topic.external_id] = topic

    # Зависимости — вторым проходом: тема может ссылаться на более позднюю.
    for proposed_topic in result.all_topics():
        topic = topics_by_external.get(proposed_topic.external_id)
        if topic is None:
            continue
        for prerequisite_id in proposed_topic.prerequisites:
            depends_on = topics_by_external.get(prerequisite_id)
            if depends_on is None or depends_on.pk == topic.pk:
                continue
            CourseDependency.objects.get_or_create(
                plan=plan, topic=topic, depends_on=depends_on
            )

        _bind_sources(plan, topic, proposed_topic, document)

    return plan


def _bind_sources(
    plan: CoursePlan, topic: CourseTopic, proposed_topic, document: Document
) -> None:
    """Привязывает тему к фрагментам книги.

    Отсутствие привязки означает «тема не подтверждена источником» (см.
    docstring `CourseSourceBinding`), поэтому невалидные chunk_id просто
    пропускаются — валидатор уже отсёк галлюцинации на предыдущем шаге.
    """
    chunks = {
        str(chunk.pk): chunk
        for chunk in KnowledgeChunk.objects.filter(
            document=document, pk__in=_uuid_like(proposed_topic.source_chunk_ids)
        )
    }
    for chunk_id in proposed_topic.source_chunk_ids:
        chunk = chunks.get(str(chunk_id))
        if chunk is None:
            continue
        CourseSourceBinding.objects.get_or_create(
            topic=topic,
            document=document,
            chunk=chunk,
            defaults={
                "section_path": chunk.section_path,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
            },
        )


def _uuid_like(values) -> list[str]:
    """Отбрасывает всё, что не похоже на UUID, до попадания в SQL.

    Без этого `pk__in` с мусорной строкой поднимает ValidationError из
    UUIDField, а причина — данные от модели, то есть ожидаемый случай.
    """
    import uuid as _uuid

    out: list[str] = []
    for value in values or []:
        try:
            out.append(str(_uuid.UUID(str(value))))
        except (ValueError, AttributeError, TypeError):
            continue
    return out


def _apply_forecast(
    plan: CoursePlan, goal: LearningGoal, *, start_date: date | None = None
) -> list[str]:
    """Считает прогноз и пишет его в план. Календарь — только backend."""
    start = start_date or timezone.localdate()
    total = plan.estimated_total_minutes
    if total <= 0:
        return ["forecast_skipped_zero_duration"]

    sessions_per_week, minutes_per_session = suggest_intensity(
        total_estimated_minutes=total,
        desired_finish_date=goal.desired_finish_date,
        start_date=start,
    )
    try:
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=total,
                sessions_per_week=sessions_per_week,
                minutes_per_session=minutes_per_session,
                start_date=start,
                desired_finish_date=goal.desired_finish_date,
            )
        )
    except ForecastNotPossible as exc:
        logger.info("Прогноз для плана %s невозможен: %s", plan.pk, exc)
        return ["forecast_not_possible"]

    plan.forecast = result.to_payload()
    plan.forecast_finish_date = result.realistic_finish_date
    plan.recommended_sessions_per_week = result.sessions_per_week
    plan.recommended_session_minutes = result.minutes_per_session
    plan.save(
        update_fields=[
            "forecast",
            "forecast_finish_date",
            "recommended_sessions_per_week",
            "recommended_session_minutes",
            "updated_at",
        ]
    )
    return list(result.warnings)


def _snapshot_version(plan: CoursePlan, result, *, reason: str) -> CoursePlanVersion:
    """Фиксирует версию плана. `CourseEnrollment` ссылается именно на версию."""
    return CoursePlanVersion.objects.create(
        plan=plan,
        version=plan.current_version,
        snapshot=plan_snapshot(plan),
        diff={},
        reason=reason[:300],
        requested_by="student",
        generation_model=result.model[:160] if result else "",
    )


def plan_snapshot(plan: CoursePlan) -> dict:
    """Полный слепок плана — то, что версионируется и с чем сравнивается diff."""
    modules = []
    for module in plan.modules.all().order_by("order_index"):
        modules.append(
            {
                "external_id": module.external_id,
                "title": module.title,
                "objective": module.objective,
                "order_index": module.order_index,
                "estimated_minutes": module.estimated_minutes,
                "completion_criteria": module.completion_criteria,
                "topics": [
                    {
                        "external_id": topic.external_id,
                        "title": topic.title,
                        "objective": topic.objective,
                        "order_index": topic.order_index,
                        "difficulty": topic.difficulty,
                        "estimated_minutes": topic.estimated_minutes,
                        "suggested_lesson_count": topic.suggested_lesson_count,
                        "theory_practice_balance": topic.theory_practice_balance,
                        "mastery_criteria": topic.mastery_criteria,
                        "review_strategy": topic.review_strategy,
                        "prerequisites": sorted(
                            dependency.depends_on.external_id
                            for dependency in topic.dependencies.all()
                        ),
                        "sources": sorted(
                            str(binding.chunk_id)
                            for binding in topic.source_bindings.all()
                            if binding.chunk_id
                        ),
                    }
                    for topic in module.topics.all().order_by("order_index")
                ],
            }
        )
    return {
        "title": plan.title,
        "objective": plan.objective,
        "estimated_total_minutes": plan.estimated_total_minutes,
        "language": plan.language,
        "current_level": plan.current_level,
        "target_level": plan.target_level,
        "modules": modules,
    }


# ────────────────────────── Подтверждение и запись ───────────────────────────


def approve_plan(plan: CoursePlan, *, user_email: str) -> CourseEnrollment:
    """Подтверждение учеником: план становится активным, создаётся запись.

    `CourseEnrollment.version` — FK с `PROTECT`: ученик учится по конкретной
    версии, и удалить её из-под него нельзя.
    """
    if plan.status == CoursePlan.Status.REJECTED:
        raise ValueError("План забракован рецензентом и не может быть подтверждён.")
    if plan.user_email != user_email:
        raise PermissionError("Подтвердить план может только его владелец.")

    version = (
        CoursePlanVersion.objects.filter(plan=plan, version=plan.current_version)
        .order_by("-version")
        .first()
    )
    if version is None:
        raise ValueError("У плана нет сохранённой версии.")

    version.approved_by_student = True
    version.approved_at = timezone.now()
    version.save(update_fields=["approved_by_student", "approved_at"])

    plan.status = CoursePlan.Status.ACTIVE
    plan.approved_at = timezone.now()
    plan.save(update_fields=["status", "approved_at", "updated_at"])

    enrollment, _ = CourseEnrollment.objects.get_or_create(
        plan=plan,
        user_email=user_email,
        defaults={"version": version, "is_active": True},
    )
    return enrollment


def topics_in_study_order(plan: CoursePlan) -> list[str]:
    """Порядок изучения тем с учётом зависимостей.

    Считается backend'ом через `validation.topological_order`, а не берётся из
    ответа модели: порядок публикации — не её решение.
    """
    from ..planning.contracts import (
        CoursePlanningResult,
        ProposedModule,
        ProposedTopic,
    )

    modules = []
    for module in plan.modules.all().order_by("order_index"):
        topics = [
            ProposedTopic(
                external_id=topic.external_id,
                title=topic.title,
                objective=topic.objective,
                estimated_minutes=topic.estimated_minutes,
                prerequisites=[
                    dependency.depends_on.external_id
                    for dependency in CourseDependency.objects.filter(topic=topic)
                ],
            )
            for topic in module.topics.all().order_by("order_index")
        ]
        modules.append(
            ProposedModule(
                external_id=module.external_id,
                title=module.title,
                objective=module.objective,
                topics=topics,
            )
        )
    return topological_order(
        CoursePlanningResult(title=plan.title, objective=plan.objective, modules=modules)
    )
