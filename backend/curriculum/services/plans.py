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
import time
from dataclasses import dataclass, field, replace
from datetime import date
from typing import NamedTuple

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ai_engine.usage import AIUsageLimitExceeded

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
    get_lexical_retriever,
)
from .chunk_view import as_retrievable

logger = logging.getLogger(__name__)

# Режим retrieval для планирования. НЕ входит в `_SOLUTION_MODES`, поэтому
# решения задач в контекст планировщика не попадают: планировщику они не нужны,
# а любой их вынос за пределы политики — потенциальная утечка.
PLANNING_RETRIEVAL_MODE = "explain"
PLANNING_MAX_CHUNKS = 24
PLANNING_TOKEN_BUDGET = 6000

# Общий дедлайн на ВСЮ генерацию, а не на отдельный вызов модели.
#
# Пер-вызовные таймауты складываются: планировщик + починка + рецензент в худшем
# случае дают 180 + 180 + 60 = 420 с, тогда как в проде стоит `gunicorn
# --timeout 360`. Воркер, убитый по SIGABRT посреди запроса, не оставляет ученику
# ничего — ни плана, ни ошибки, только оборванное соединение (ROADMAP, «Грабли»).
#
# Поэтому дедлайн один и общий, а шаги по нему ДЕГРАДИРУЮТ, а не падают: и
# починка, и рецензия необязательны, план без них хуже, но он есть. Каждый
# пропуск попадает в `outcome.warnings` — два пропущенных платных шага не должны
# быть невидимой магией.
PLAN_DEADLINE_SECONDS = 300


def _plan_deadline_seconds() -> int:
    return max(
        1, int(getattr(settings, "CURRICULUM_PLAN_DEADLINE_SECONDS", PLAN_DEADLINE_SECONDS))
    )


class PlanRejected(RuntimeError):
    """План не прошёл валидацию или рецензию. В БД ничего не записано."""

    def __init__(self, report: ValidationReport | None, message: str) -> None:
        super().__init__(message)
        self.report = report
        self.message = message


class PlanSourceChanged(PlanRejected):
    """Документ изменился после формирования контекста планировщика."""

    def __init__(self) -> None:
        super().__init__(
            None,
            "Документ был переобработан во время генерации плана. "
            "Запустите генерацию заново.",
        )


@dataclass
class PlanGenerationOutcome:
    """Итог генерации: план, отчёт валидатора и находки рецензента."""

    plan: CoursePlan | None
    report: ValidationReport | None = None
    review_findings: list[dict] = field(default_factory=list)
    planner_model: str = ""
    reviewer_model: str = ""
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ProvenanceCoverage:
    covered_sections: int
    total_sections: int
    ratio: float | None
    stale: bool = False

    def to_payload(self) -> dict:
        return {
            "covered_sections": self.covered_sections,
            "total_sections": self.total_sections,
            "ratio": self.ratio,
            "stale": self.stale,
        }


def provenance_coverage(plan: CoursePlan) -> ProvenanceCoverage:
    """Покрытие подтверждённых разделов по snapshot `section_path`.

    Один раздел может дать несколько чанков и несколько тем — в числителе он
    всё равно один. Неизвестные/пустые path не раздувают метрику. После новой
    обработки книги старые bindings нельзя делить на новое оглавление.
    """

    if plan.document_id is None:
        return ProvenanceCoverage(0, 0, None)
    # `plan.document` может быть закэширован сериализатором ещё до завершения
    # concurrent ingestion. Для stale-флага нужна текущая версия из БД.
    document = Document.objects.filter(pk=plan.document_id).only(
        "id", "processing_version"
    ).first()
    if document is None:
        return ProvenanceCoverage(0, 0, None)
    if plan.source_processing_version != document.processing_version:
        return ProvenanceCoverage(0, 0, None, stale=True)

    section_paths = set(
        DocumentSection.objects.filter(document=document)
        .exclude(path="")
        .values_list("path", flat=True)
        .distinct()
    )
    if not section_paths:
        return ProvenanceCoverage(0, 0, None)
    bound_paths = set(
        CourseSourceBinding.objects.filter(
            topic__module__plan=plan,
            document=document,
        )
        .exclude(section_path="")
        .values_list("section_path", flat=True)
        .distinct()
    )
    covered = len(section_paths & bound_paths)
    return ProvenanceCoverage(
        covered_sections=covered,
        total_sections=len(section_paths),
        ratio=covered / len(section_paths),
    )


# ───────────────────────── Подготовка входа модели ───────────────────────────


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
        as_retrievable(chunk, document)
        for chunk in KnowledgeChunk.objects.filter(
            document_id=document.pk,
            processing_version=document.processing_version,
        )
        # select_related("task") убран: задача в основной базе,
        # а JOIN между базами невозможен — task_id лежит в самом чанке.
        .order_by("page_start", "id")
    ]
    document_ids = [str(document.pk)]

    relevant = KnowledgeRetrievalService(lexical=get_lexical_retriever()).retrieve(
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


def _call_planner(planner, request: CoursePlanningRequest, bundle, *, goal):
    """Один вызов планировщика с нормализацией enum'ов и валидацией."""
    try:
        result = planner.generate_plan(request, bundle)
    except AIUsageLimitExceeded:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("Планировщик отказал для цели %s: %s", goal.pk, exc)
        raise PlanRejected(None, f"Планировщик недоступен: {exc}") from exc

    normalize_enum_fields(result)
    return result, validate_plan(result, request)


class PlannerOutcome(NamedTuple):
    """Что вышло у планировщика вместе с историей попыток."""

    result: object
    report: ValidationReport
    repair_attempted: bool
    repair_skipped_deadline: bool


def _plan_with_one_repair(
    planner, request: CoursePlanningRequest, bundle, *, goal, deadline: float | None = None
) -> PlannerOutcome:
    """Генерация с ОДНОЙ попыткой починки при блокерах валидатора.

    Зачем: живая модель регулярно спотыкается на мелочи — забытый `objective`,
    `estimated_minutes: 0`, ссылка на несуществующий chunk_id. Любая из них —
    блокер, а блокер означает, что не сохраняется ничего и ученик получает 422.
    Один повторный вызов со списком претензий превращает «работает через раз» в
    «работает».

    Попытка ровно одна: вторая почти не добавляет успеха, зато удваивает счёт и
    задержку. Если и она не прошла — отдаём отчёт ВТОРОЙ попытки, он свежее.

    `deadline` — момент `time.monotonic()`, после которого второй вызов уже не
    начинается. Починка стоит целого вызова модели, и запускать её, когда времени
    заведомо не осталось, значит гарантированно потерять и её, и ответ ученику.
    """
    result, report = _call_planner(planner, request, bundle, goal=goal)
    if report.is_valid:
        return PlannerOutcome(result, report, False, False)

    if deadline is not None and time.monotonic() >= deadline:
        logger.warning(
            "План для цели %s забракован, но на починку не осталось времени", goal.pk
        )
        return PlannerOutcome(result, report, False, True)

    issues = tuple(
        f"{issue.code}: {issue.message}" for issue in report.issues if issue.is_blocker
    )
    logger.info(
        "План для цели %s забракован валидатором (%s), пробуем починить",
        goal.pk,
        ", ".join(sorted({i.code for i in report.issues if i.is_blocker})),
    )

    repair_request = replace(request, repair_issues=issues)
    try:
        repaired, repaired_report = _call_planner(
            planner, repair_request, bundle, goal=goal
        )
    except PlanRejected:
        # Планировщик отвалился на повторе — возвращаем результат первой попытки,
        # чтобы ученик увидел претензии валидатора, а не «модель недоступна».
        return PlannerOutcome(result, report, True, False)

    return PlannerOutcome(repaired, repaired_report, True, False)


def generate_plan(
    goal: LearningGoal,
    document: Document,
    *,
    planning_provider=None,
    review_provider=None,
    start_date: date | None = None,
) -> PlanGenerationOutcome:
    """Полный цикл генерации. Кидает `PlanRejected`, если план непригоден."""
    # Отсчёт идёт от входа в функцию, а не от первого вызова модели: retrieval и
    # сборка запроса тоже тратят время из того же бюджета ответа.
    deadline = time.monotonic() + _plan_deadline_seconds()

    # Объект мог ждать во view, пока другой запрос уже запустил ingestion.
    # Снимок берём из БД непосредственно перед retrieval/LLM и повторно сверяем
    # под row lock перед первой записью плана.
    document.refresh_from_db(fields=["ingestion_status", "processing_version"])
    if document.ingestion_status != Document.Status.READY:
        raise PlanRejected(
            None,
            "Документ ещё не обработан: дождитесь статуса «готов».",
        )
    source_processing_version = document.processing_version

    bundle = retrieve_planning_context(goal, document)
    if not bundle.chunk_ids:
        raise PlanRejected(
            None, "В документе нет фрагментов, пригодных для планирования курса."
        )

    request = build_planning_request(goal, document, bundle)
    planner = planning_provider or get_planning_provider()

    attempt = _plan_with_one_repair(
        planner, request, bundle, goal=goal, deadline=deadline
    )
    result, report = attempt.result, attempt.report
    if not report.is_valid:
        # Блокеры — стоп. Ничего не сохраняем: план со ссылками на выдуманные
        # фрагменты или с циклом в зависимостях в БД попасть не должен.
        #
        # Про пропущенную починку сообщаем ЗДЕСЬ, а не кодом в `warnings`:
        # предупреждения собираются только на успешном пути, а пропуск починки
        # по определению случается на неуспешном. Иначе причина отказа была бы
        # видна только в логах сервера.
        codes = sorted({issue.code for issue in report.issues if issue.is_blocker})
        if attempt.repair_skipped_deadline:
            raise PlanRejected(
                report,
                "План не прошёл валидацию, а времени на повторную попытку не "
                f"осталось: {', '.join(codes)}",
            )
        raise PlanRejected(report, f"План не прошёл валидацию: {', '.join(codes)}")

    reviewer = review_provider or get_review_provider()
    review = None
    review_skipped_deadline = False
    review_unavailable = False
    if time.monotonic() >= deadline:
        # Рецензент необязателен: его заключение только помечает план, а
        # публикацию всё равно подтверждает ученик. Лучше отдать план без
        # рецензии, чем не отдать ничего.
        review_skipped_deadline = True
        logger.warning("Рецензия для цели %s пропущена: вышел дедлайн", goal.pk)
    else:
        try:
            review = reviewer.review_plan(result, request)
        except AIUsageLimitExceeded:
            raise
        except Exception as exc:  # noqa: BLE001
            review_unavailable = True
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
        locked_document = Document.objects.select_for_update().get(pk=document.pk)
        source_chunks = _lock_planning_source_snapshot(
            locked_document,
            processing_version=source_processing_version,
            chunk_ids=request.available_chunk_ids,
        )
        plan = _persist_plan(
            goal=goal,
            document=locked_document,
            result=result,
            report=report,
            review=review,
            request=request,
            source_processing_version=source_processing_version,
            source_chunks=source_chunks,
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
    if attempt.repair_attempted:
        # Починка не должна быть невидимой: два вызова модели вместо одного видно
        # в счёте, и причина этого должна быть прослеживаемой.
        warning_codes.append("plan_repaired_after_validation")
    # Пропущенный шаг — тоже событие. Раньше падение рецензента не оставляло
    # следа нигде, кроме лога: снаружи план выглядел полностью проверенным.
    # (Пропуск ПОЧИНКИ сюда не попадает: он возможен только когда план
    # забракован, а тогда мы уже вышли через PlanRejected выше.)
    if review_skipped_deadline:
        warning_codes.append("plan_review_skipped_deadline")
    if review_unavailable:
        warning_codes.append("plan_review_unavailable")
    return PlanGenerationOutcome(
        plan=plan,
        report=report,
        review_findings=findings,
        planner_model=getattr(planner, "name", ""),
        # Пусто, если рецензия не состоялась: имя провайдера, который не
        # отработал, читается как «план проверен», а он не проверен.
        reviewer_model=getattr(reviewer, "name", "") if review is not None else "",
        warnings=warning_codes + forecast_warnings,
    )


def _lock_planning_source_snapshot(
    document: Document,
    *,
    processing_version: str,
    chunk_ids,
) -> dict[str, KnowledgeChunk]:
    """Финальный CAS для результата долгих LLM-вызовов.

    Вызывается только с уже захваченной `Document` row lock. Ingestion берёт ту
    же блокировку перед заменой производных строк, поэтому проверка и сохранение
    плана образуют одну атомарную критическую секцию. Chunk rows тоже блокируем:
    это сохраняет инвариант даже для кода, который удаляет их напрямую.
    """

    if (
        document.ingestion_status != Document.Status.READY
        or document.processing_version != processing_version
    ):
        raise PlanSourceChanged()

    expected_ids = {str(value) for value in chunk_ids}
    valid_ids = set(_uuid_like(expected_ids))
    if valid_ids != expected_ids:
        raise PlanSourceChanged()

    chunks = {
        str(chunk.pk): chunk
        for chunk in KnowledgeChunk.objects.select_for_update().filter(
            document_id=document.pk,
            processing_version=processing_version,
            pk__in=valid_ids,
        )
    }
    if set(chunks) != expected_ids:
        raise PlanSourceChanged()
    return chunks


def _persist_plan(
    *,
    goal: LearningGoal,
    document: Document,
    result,
    report: ValidationReport,
    review,
    request: CoursePlanningRequest,
    source_processing_version: str,
    source_chunks: dict[str, KnowledgeChunk],
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
        source_processing_version=source_processing_version,
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

        _bind_sources(
            plan,
            topic,
            proposed_topic,
            document,
            source_processing_version=source_processing_version,
            source_chunks=source_chunks,
        )

    return plan


def _bind_sources(
    plan: CoursePlan,
    topic: CourseTopic,
    proposed_topic,
    document: Document,
    *,
    source_processing_version: str,
    source_chunks: dict[str, KnowledgeChunk],
) -> None:
    """Привязывает тему к фрагментам книги.

    Валидатор уже отсёк галлюцинации, а финальный CAS зафиксировал существование
    строк. Поэтому отсутствие id здесь означает нарушение snapshot-инварианта,
    а не допустимый повод молча сохранить тему без provenance.
    """
    for chunk_id in proposed_topic.source_chunk_ids:
        chunk = source_chunks.get(str(chunk_id))
        if (
            chunk is None
            or chunk.document_id != document.pk
            or chunk.processing_version != source_processing_version
        ):
            raise PlanSourceChanged()
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
    plan: CoursePlan,
    goal: LearningGoal,
    *,
    start_date: date | None = None,
    sessions_per_week: int | None = None,
    minutes_per_session: int | None = None,
) -> list[str]:
    """Считает прогноз и пишет его в план. Календарь — только backend.

    Темп по умолчанию подбирается автоматически (`suggest_intensity`). Явно
    заданный побеждает: ученик знает про свои вечера больше, чем формула,
    и «сделай занятия короче, но чаще» должно работать буквально.
    """
    start = start_date or timezone.localdate()
    total = plan.estimated_total_minutes
    if total <= 0:
        return ["forecast_skipped_zero_duration"]

    if sessions_per_week is None or minutes_per_session is None:
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


# ───────────────────────── Перестройка и темп ────────────────────────────────

# Отличает «поле не прислали» от «прислали null, убери дедлайн».
UNSET = object()


def rebuild_plan(
    plan: CoursePlan,
    *,
    planning_provider=None,
    review_provider=None,
    start_date: date | None = None,
) -> PlanGenerationOutcome:
    """Строит программу заново по той же паре цель+книга.

    Прежний план архивируется ПОСЛЕ успеха, а не до него. Порядок здесь —
    не мелочь: генерация занимает минуты и вполне может не удаться, и ученик,
    нажавший «перестроить», не должен в этом случае остаться вообще без
    программы. Пока новая не готова, старая — единственное, что у него есть.

    Архивация, а не удаление: по плану могли уже заниматься, и `CourseEnrollment`
    держит версию через `PROTECT`.
    """
    document = plan.document
    if document is None:
        raise PlanRejected(
            None, "Книга удалена — перестроить программу по ней нельзя."
        )

    outcome = generate_plan(
        plan.goal,
        document,
        planning_provider=planning_provider,
        review_provider=review_provider,
        start_date=start_date,
    )

    CoursePlan.objects.filter(pk=plan.pk).update(
        status=CoursePlan.Status.ARCHIVED, updated_at=timezone.now()
    )
    return outcome


def repace_plan(
    plan: CoursePlan,
    *,
    sessions_per_week: int | None = None,
    minutes_per_session: int | None = None,
    desired_finish_date=UNSET,
    start_date: date | None = None,
) -> list[str]:
    """Меняет темп и срок, пересчитывая ТОЛЬКО прогноз.

    Модель здесь не вызывается вовсе: состав тем не меняется, меняется
    расписание. Это принципиально дешевле перестройки и потому доступно на
    любом плане, включая активный, — темп занятий не влияет на то, чему учат.

    Желаемая дата живёт на цели, а не на плане: это свойство предмета, и следующая
    программа по той же цели должна его унаследовать.
    """
    goal = plan.goal
    if desired_finish_date is not UNSET:
        goal.desired_finish_date = desired_finish_date
        goal.save(update_fields=["desired_finish_date", "updated_at"])

    warnings = _apply_forecast(
        plan,
        goal,
        start_date=start_date,
        sessions_per_week=sessions_per_week,
        minutes_per_session=minutes_per_session,
    )
    plan.refresh_from_db()
    return warnings


# ──────────────────────── Ручная правка структуры ────────────────────────────


class PlanNotEditable(RuntimeError):
    """Программу в этом состоянии править нельзя."""


def apply_structure(plan: CoursePlan, modules: list[dict]) -> list[str]:
    """Заменяет состав программы присланным деревом.

    Дерево приходит ЦЕЛИКОМ, а не набором точечных операций. Причина не в
    удобстве клиента: правка обязана быть атомарной, давать ровно одну новую
    версию и один пересчёт прогноза. Шесть отдельных ручек создавали бы
    промежуточные состояния, в которых порядок изучения и сроки не согласованы
    между собой, и ученик успевал бы их увидеть.

    Что разрешено: переименовать, переставить, изменить длительность, удалить,
    перенести тему в другой модуль. Что запрещено: добавить тему, которой не
    было. У новой темы неоткуда взяться `CourseSourceBinding`, а тема без
    провенанса неотличима от выдуманной моделью — валидатор блокирует именно
    такие.

    Возвращает предупреждения прогноза.
    """
    if plan.status == CoursePlan.Status.ACTIVE:
        # По активной программе уже занимаются, и `CourseEnrollment` держит
        # конкретную версию через PROTECT. Менять её состав из-под ученика
        # нельзя — для этого есть «построить заново».
        raise PlanNotEditable(
            "Программа уже активна. Чтобы изменить состав, постройте её заново."
        )
    if plan.status == CoursePlan.Status.ARCHIVED:
        raise PlanNotEditable("Это архивная версия программы.")

    existing_modules = {m.external_id: m for m in plan.modules.all()}
    existing_topics = {
        topic.external_id: topic
        for topic in CourseTopic.objects.filter(module__plan=plan)
    }

    kept_modules: set[str] = set()
    kept_topics: set[str] = set()
    for module_data in modules:
        module_id = str(module_data.get("external_id") or "")
        if module_id not in existing_modules:
            raise ValueError(f"Модуля «{module_id}» нет в программе.")
        if module_id in kept_modules:
            raise ValueError(f"Модуль «{module_id}» встречается дважды.")
        kept_modules.add(module_id)
        for topic_data in module_data.get("topics") or []:
            topic_id = str(topic_data.get("external_id") or "")
            if topic_id not in existing_topics:
                raise ValueError(f"Темы «{topic_id}» нет в программе.")
            if topic_id in kept_topics:
                raise ValueError(f"Тема «{topic_id}» встречается дважды.")
            kept_topics.add(topic_id)

    if not kept_topics:
        raise ValueError("В программе должна остаться хотя бы одна тема.")

    with transaction.atomic():
        for module_index, module_data in enumerate(modules):
            module = existing_modules[str(module_data["external_id"])]
            module.title = str(module_data.get("title") or module.title)[:300]
            module.objective = str(
                module_data.get("objective", module.objective) or ""
            )
            module.order_index = module_index

            topics_total = 0
            for topic_index, topic_data in enumerate(module_data.get("topics") or []):
                topic = existing_topics[str(topic_data["external_id"])]
                topic.module = module
                topic.title = str(topic_data.get("title") or topic.title)[:300]
                topic.objective = str(
                    topic_data.get("objective", topic.objective) or ""
                )
                if "estimated_minutes" in topic_data:
                    topic.estimated_minutes = max(
                        0, int(topic_data["estimated_minutes"])
                    )
                topic.order_index = topic_index
                topic.save(
                    update_fields=[
                        "module",
                        "title",
                        "objective",
                        "estimated_minutes",
                        "order_index",
                    ]
                )
                topics_total += topic.estimated_minutes

            # Длительность модуля считается, а не принимается на веру: иначе
            # превью показало бы ученику одно число, а прогноз посчитал бы по
            # другому — ровно то расхождение, которое ловит `module_duration_mismatch`.
            module.estimated_minutes = topics_total
            module.save(
                update_fields=[
                    "title",
                    "objective",
                    "order_index",
                    "estimated_minutes",
                ]
            )

        # Удаление в конце: связи `CourseDependency` и `CourseSourceBinding`
        # уходят каскадом, поэтому висящих prerequisites не остаётся по
        # устройству схемы, а не по отдельной проверке.
        CourseTopic.objects.filter(module__plan=plan).exclude(
            external_id__in=kept_topics
        ).delete()
        plan.modules.exclude(external_id__in=kept_modules).delete()

        plan.estimated_total_minutes = sum(
            topic.estimated_minutes
            for topic in CourseTopic.objects.filter(module__plan=plan)
        )
        plan.current_version += 1
        plan.save(
            update_fields=["estimated_total_minutes", "current_version", "updated_at"]
        )

        warnings = _apply_forecast(plan, plan.goal)
        _snapshot_version(plan, None, reason="manual_edit")

    plan.refresh_from_db()
    return warnings


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
