"""
Журнал учебных событий и производное состояние навыка (PRODUCT.md §15.3, §6.1).

Разделение обязанностей в этом модуле:

* `record_learning_event` — запись в append-only журнал. Ходит в БД.
* `recompute_skill_state` — ЧИСТАЯ функция: список фактов → поля состояния.
  Ни БД, ни сети, ни `now()` внутри (время передаётся аргументом), поэтому её
  можно проверять таблицей и она даёт один и тот же ответ на одних данных.
* `apply_learning_event` — оркестровка: записать событие и пересчитать состояние.

Почему состояние пересчитывается целиком, а не инкрементально: журнал — источник
истины, и полный пересчёт означает, что расхождение между таблицами лечится
повторным пересчётом, а не ручной правкой. Событий на один навык у одного
ученика десятки, поэтому цена пересчёта несопоставима с ценой класса ошибок
«счётчик разъехался с историей».
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable, Sequence

from django.utils import timezone

from .models import ERROR_TYPES, LearningEvent, SkillState

logger = logging.getLogger(__name__)

# Сколько оценённых попыток нужно, чтобы считать оценку навыка уверенной.
# Пять — это компромисс: по двум попыткам делать вывод нельзя, а ждать десяти
# значит месяц не показывать ученику никакого прогресса.
CONFIDENCE_EVIDENCE_TARGET = 5

# Порог mastery (§6.3): тема считается усвоенной не после просмотра объяснения,
# а после доказательств.
MASTERY_THRESHOLD = 0.8
MASTERY_MIN_UNAIDED_SUCCESSES = 3
NEEDS_PRACTICE_THRESHOLD = 0.5

# Сколько повторений одного типа ошибки делают её СИСТЕМНОЙ. Пока такая ошибка
# есть, mastery не выдаётся, даже если процент верных ответов высокий: §6.3
# требует «отсутствие повторяющейся системной ошибки».
SYSTEMIC_ERROR_COUNT = 3

# Только оценённые события двигают mastery. Объяснение или открытая схема — это
# не доказательство навыка, иначе «посмотрел урок» повышало бы усвоенность.
GRADED_RESULTS = frozenset({"correct", "incorrect", "partial"})

# Параметры Bayesian Knowledge Tracing (Corbett & Anderson, 1995; PRODUCT.md §6.1).
# Это типовые значения из литературы, а не подобранные по нашим данным: подбор
# (EM/fit по журналу, как bkt_trainer.py у OpenTutor) появится, когда накопятся
# события. Подобраны так, чтобы три самостоятельных успеха подряд давали
# вероятность выше MASTERY_THRESHOLD, а «четыре ошибки и один успех» оставляли
# навык в NEEDS_PRACTICE.
BKT_PRIOR = 0.3  # P(L0): вероятность, что навык уже был усвоен до первой попытки
BKT_LEARN = 0.1  # P(T): шанс усвоить навык за одну попытку
BKT_GUESS = 0.2  # P(G): шанс ответить верно, не владея навыком
BKT_SLIP = 0.1  # P(S): шанс ошибиться, владея навыком
# Верный ответ с подсказкой — слабее доказательство: подсказка могла «подсказать»
# и без владения, поэтому вероятность угадать здесь выше (как прежний вес 0.6).
BKT_GUESS_HINTED = 0.5
# «Частично»: смесь верного и неверного исхода; доля верного — как прежние
# веса 0.4 / 0.25 для ответа без подсказки / с подсказкой.
_PARTIAL_CORRECT_SHARE = {False: 0.4, True: 0.25}

# Верный ответ, помеченный как угаданный или списанный, — не доказательство
# навыка: BKT-обновление пропускается, и такой ответ не считается самостоятельным.
UNEARNED_SUCCESS_ERRORS = frozenset({"guessed", "copied"})


def normalize_error_type(value: Any) -> str:
    """Привести тип ошибки к перечню §6.8.

    Тип предлагает модель, а перечень — контракт backend'а (AGENTS.md: строгая
    валидация на границе LLM → backend). Неизвестное значение НЕ пропускаем и не
    роняем запрос: пишем `unknown` и оставляем след в логе, иначе типология
    тихо превратилась бы в свободный текст и перестала управлять интервенцией.

    Пустое значение — легальное: далеко не каждое событие является ошибкой.
    """
    text = str(value or "").strip().lower()
    if not text:
        return ""
    if text in ERROR_TYPES:
        return text
    logger.warning("[learning_events] неизвестный тип ошибки %r → unknown", value)
    return "unknown"


@dataclass(frozen=True)
class LearningEventFacts:
    """Минимум сведений о событии, нужный для пересчёта состояния.

    Отдельный тип, а не сама модель: так `recompute_skill_state` не зависит от
    Django и тестируется без БД.
    """

    result: str
    hint_level: int = 0
    error_type: str = ""
    created_at: datetime | None = None
    activity: str = ""

    @property
    def is_graded(self) -> bool:
        return self.result in GRADED_RESULTS

    @property
    def is_practice(self) -> bool:
        """Событие вообще говорит о практике навыка.

        Повторение без оценки (`activity="review"`, оценка лежит в metadata) и
        событие с пустым результатом — не практика: они не должны ни «начинать»
        навык, ни копить доказательства, ни сдвигать дату последней практики.
        """
        if self.is_graded:
            return True
        return bool(self.result) and self.activity != "review"

    @property
    def is_earned_success(self) -> bool:
        """Верный ответ, не помеченный как угаданный или списанный."""
        return self.result == "correct" and self.error_type not in UNEARNED_SUCCESS_ERRORS

    @property
    def was_hinted(self) -> bool:
        return self.hint_level > 0


@dataclass(frozen=True)
class SkillStateFields:
    """Результат пересчёта — ровно те поля, что хранит `SkillState`."""

    status: str
    mastery_probability: float
    confidence: float
    success_count: int
    fail_count: int
    hint_count: int
    avg_hint_level: float
    evidence_count: int
    common_errors: dict[str, int] = field(default_factory=dict)
    last_practiced_at: datetime | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "mastery_probability": self.mastery_probability,
            "confidence": self.confidence,
            "success_count": self.success_count,
            "fail_count": self.fail_count,
            "hint_count": self.hint_count,
            "avg_hint_level": self.avg_hint_level,
            "evidence_count": self.evidence_count,
            "common_errors": dict(self.common_errors),
            "last_practiced_at": self.last_practiced_at,
        }


def _bkt_update(mastery: float, fact: LearningEventFacts) -> float:
    """Один шаг BKT: апостериорная вероятность по исходу попытки, затем обучение."""

    def posterior(correct: bool, guess: float) -> float:
        if correct:
            hit = mastery * (1 - BKT_SLIP)
            miss = (1 - mastery) * guess
        else:
            hit = mastery * BKT_SLIP
            miss = (1 - mastery) * (1 - guess)
        return hit / (hit + miss)

    if fact.result == "correct":
        if not fact.is_earned_success:
            return mastery
        known = posterior(True, BKT_GUESS_HINTED if fact.was_hinted else BKT_GUESS)
    elif fact.result == "partial":
        share = _PARTIAL_CORRECT_SHARE[fact.was_hinted]
        known = share * posterior(True, BKT_GUESS) + (1 - share) * posterior(False, BKT_GUESS)
    else:
        known = posterior(False, BKT_GUESS)
    return known + (1 - known) * BKT_LEARN


def bkt_mastery(facts: Sequence[LearningEventFacts]) -> float:
    """Вероятность владения после всех оценённых попыток, от старых к новым.

    Порядок решает: свежие успехи весят больше старых ошибок и наоборот. События
    без оценённого результата (объяснение, повторение) пропускаются.
    """
    ordered = [item for item in facts if item.is_graded]
    # Журнал отдаёт события уже по created_at; сортируем сами только когда у всех
    # есть время, иначе доверяем порядку вызывающего.
    if all(item.created_at is not None for item in ordered):
        ordered.sort(key=lambda item: item.created_at)
    mastery = BKT_PRIOR
    for item in ordered:
        mastery = _bkt_update(mastery, item)
    return mastery


def recompute_skill_state(facts: Sequence[LearningEventFacts]) -> SkillStateFields:
    """Свести события навыка в одно состояние. Чистая функция.

    Вероятность владения — Bayesian Knowledge Tracing по оценённым попыткам от
    старых к новым (§6.1). Статус по-прежнему требует доказательств: порог
    вероятности, число самостоятельных успехов и отсутствие системной ошибки
    (§6.3). Параметры BKT — константы выше, пока не подобраны по данным.
    """
    facts = [item for item in facts if item.is_practice]
    if not facts:
        return SkillStateFields(
            status="NOT_STARTED",
            mastery_probability=0.0,
            confidence=0.0,
            success_count=0,
            fail_count=0,
            hint_count=0,
            avg_hint_level=0.0,
            evidence_count=0,
        )

    graded = [item for item in facts if item.is_graded]
    hinted_levels = [item.hint_level for item in facts if item.was_hinted]

    success_count = sum(1 for item in graded if item.result == "correct")
    fail_count = sum(1 for item in graded if item.result == "incorrect")
    unaided_successes = sum(
        1 for item in graded if item.is_earned_success and not item.was_hinted
    )

    errors = Counter(
        item.error_type for item in facts if item.error_type and item.error_type != ""
    )

    mastery = bkt_mastery(facts) if graded else 0.0

    confidence = min(1.0, len(graded) / CONFIDENCE_EVIDENCE_TARGET)
    has_systemic_error = any(count >= SYSTEMIC_ERROR_COUNT for count in errors.values())

    if not graded:
        # Ученик что-то делал (читал объяснение, смотрел схему), но ни одной
        # оценённой попытки нет — знать, усвоено ли, мы не можем.
        status = "LEARNING"
    elif (
        mastery >= MASTERY_THRESHOLD
        and unaided_successes >= MASTERY_MIN_UNAIDED_SUCCESSES
        and not has_systemic_error
    ):
        status = "MASTERED"
    elif mastery < NEEDS_PRACTICE_THRESHOLD:
        status = "NEEDS_PRACTICE"
    else:
        status = "LEARNING"

    timestamps = [item.created_at for item in facts if item.created_at is not None]

    return SkillStateFields(
        status=status,
        mastery_probability=round(mastery, 4),
        confidence=round(confidence, 4),
        success_count=success_count,
        fail_count=fail_count,
        hint_count=len(hinted_levels),
        avg_hint_level=round(sum(hinted_levels) / len(hinted_levels), 4) if hinted_levels else 0.0,
        evidence_count=len(facts),
        common_errors=dict(errors),
        last_practiced_at=max(timestamps) if timestamps else None,
    )


def resolve_display_status(
    status: str, next_review_at: datetime | None, now: datetime | None = None
) -> str:
    """Статус для показа ученику с учётом наступившего повторения (§6.1).

    «Пора повторить» применяется только к УСВОЕННОМУ навыку: для навыка в работе
    «Изучаю» или «Нужна практика» информативнее, чем напоминание о повторении, и
    подменять их значило бы прятать текущее состояние за расписанием.
    """
    if status != "MASTERED" or next_review_at is None:
        return status
    moment = now or timezone.now()
    return "DUE_REVIEW" if next_review_at <= moment else status


def facts_from_events(events: Iterable[LearningEvent]) -> list[LearningEventFacts]:
    """Модели → чистые факты для `recompute_skill_state`."""
    return [
        LearningEventFacts(
            result=event.result,
            hint_level=event.hint_level or 0,
            error_type=event.error_type or "",
            created_at=event.created_at,
            activity=event.activity or "",
        )
        for event in events
    ]


def record_learning_event(
    *,
    user_email: str,
    activity: str = "explanation",
    result: str = "completed",
    topic=None,
    skill_ref: str = "",
    mode: str = "",
    task_ref: str = "",
    attempt_count: int = 0,
    hint_level: int = 0,
    duration_seconds: int = 0,
    error_type: Any = "",
    confidence_before: float | None = None,
    confidence_after: float | None = None,
    source: str = "",
    metadata: dict[str, Any] | None = None,
) -> LearningEvent | None:
    """Записать одно событие в журнал.

    Никогда не бросает наружу: потеря строки статистики не должна ронять урок
    (§13.5 — сбой AI-инфраструктуры не уничтожает сессию). Возвращает `None`,
    если записать не удалось, и оставляет причину в логе.
    """
    if not user_email:
        # Журнал без владельца бесполезен для student state — ровно та ошибка,
        # из-за которой mind.ReviewLog оказался нечитаемым.
        logger.warning("[learning_events] событие без user_email отброшено")
        return None

    try:
        return LearningEvent.objects.create(
            user_email=user_email,
            topic=topic,
            skill_ref=skill_ref or (getattr(topic, "name", "") or ""),
            activity=activity,
            mode=mode or "",
            task_ref=task_ref or "",
            result=result,
            attempt_count=max(0, int(attempt_count or 0)),
            hint_level=max(0, int(hint_level or 0)),
            duration_seconds=max(0, int(duration_seconds or 0)),
            error_type=normalize_error_type(error_type),
            confidence_before=confidence_before,
            confidence_after=confidence_after,
            source=source or "",
            metadata=metadata or {},
        )
    except Exception:  # noqa: BLE001 — журнал не важнее урока
        logger.exception("[learning_events] не удалось записать событие")
        return None


def refresh_skill_state(*, user_email: str, topic) -> SkillState | None:
    """Пересчитать состояние навыка по всей его истории событий."""
    if not user_email or topic is None:
        return None

    events = LearningEvent.objects.filter(user_email=user_email, topic=topic).order_by(
        "created_at"
    )
    computed = recompute_skill_state(facts_from_events(events))

    state, _ = SkillState.objects.update_or_create(
        user_email=user_email,
        topic=topic,
        defaults=computed.as_dict(),
    )
    return state


def apply_learning_event(**kwargs: Any) -> tuple[LearningEvent | None, SkillState | None]:
    """Записать событие и обновить производное состояние навыка.

    Основная точка входа для тьютора: одно место, где история и состояние
    остаются согласованными.
    """
    event = record_learning_event(**kwargs)
    if event is None:
        return None, None

    state = None
    if event.topic_id:
        try:
            state = refresh_skill_state(user_email=event.user_email, topic=event.topic)
        except Exception:  # noqa: BLE001 — состояние всегда можно пересчитать позже
            logger.exception("[learning_events] не удалось пересчитать SkillState")
    return event, state
