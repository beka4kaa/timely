"""Провайдеры ритма занятий.

Модель-независимость буквальна: ни одного названия модели в бизнес-логике.
Реализация выбирается фабрикой, идентификатор приходит из
`curriculum.model_registry` по роли `SCHEDULE_PLANNING`.

По умолчанию возвращается детерминированный провайдер — и это не заглушка на
время разработки. Он строит осмысленный ритм из данных, которые уже посчитаны
при создании программы, поэтому сетевой вызов здесь — улучшение, а не условие
работоспособности. Именно поэтому при любом нарушении контракта мы молча
откатываемся на него, а не показываем ученику ошибку.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Protocol

from curriculum.model_registry import ROLE_SCHEDULE_PLANNING, resolve_model

from ..scheduling.contracts import (
    MilestoneSpec,
    PacingPlan,
    TopicPacing,
    WeeklyPatternDay,
)
from ..scheduling.pacing import build_lesson_parts
from .contracts import PacingRequest
from .schema import SCHEMA_NAME, build_pacing_schema

logger = logging.getLogger(__name__)

_JSON_FENCE = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)


class MalformedPacingResponse(RuntimeError):
    """Ответ модели не разобрать. Не ошибка ученика — повод откатиться."""


class ProviderNotConfigured(RuntimeError):
    """Роль не настроена, а вызывающий код потребовал реальную модель."""


class PacingProvider(Protocol):
    name: str

    def generate_pacing(self, request: PacingRequest) -> PacingPlan: ...


# ──────────────────────── Детерминированный провайдер ─────────────────────────


class DeterministicPacingProvider:
    """Ритм из разбивки, уже посчитанной программой.

    `CourseTopic.duration_breakdown` содержит теорию, практику и проверку
    (`curriculum/planning/duration.py`), а темп занятий ученик задал сам. Этого
    достаточно для полноценного ритма без единого сетевого вызова.
    """

    name = "deterministic"

    def generate_pacing(self, request: PacingRequest) -> PacingPlan:
        pacing = tuple(
            TopicPacing(
                topic_id=topic.topic_id,
                topic_external_id=topic.external_id,
                lesson_parts=build_lesson_parts(
                    topic, max_part_minutes=request.session_minutes
                ),
                title=topic.title,
                module_external_id=topic.module_external_id,
            )
            for topic in request.topics
        )
        return PacingPlan(
            weekly_pattern=(),
            topic_pacing=pacing,
            buffer_percentage=0.15,
            rationale="Ритм собран из разбивки тем программы.",
        )


# ────────────────────────────── Разбор ответа ────────────────────────────────


def _extract_json(raw: str) -> dict:
    """JSON из ответа модели, даже если он завёрнут в тройные кавычки.

    Своя копия, а не импорт из `curriculum.planning.providers`: там она
    приватная и живёт внутри другого домена. Копий две — если появится третья,
    её пора выносить в общий модуль.
    """
    text = (raw or "").strip()
    fence = _JSON_FENCE.search(text)
    if fence:
        text = fence.group(1).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise MalformedPacingResponse("В ответе модели нет JSON-объекта.") from None
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise MalformedPacingResponse(f"Некорректный JSON: {exc.msg}") from None
    if not isinstance(parsed, dict):
        raise MalformedPacingResponse("Ожидался JSON-объект.")
    return parsed


def _as_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_pacing_response(raw: str, *, request: PacingRequest) -> PacingPlan:
    """Ответ модели → `PacingPlan`.

    Модель решает, СКОЛЬКО и КАКОГО занятия нужно теме. Названия, цели и ссылки
    на разделы книги подставляет backend из программы — иначе в календаре
    появились бы страницы, которых в источнике нет.

    Тема с неизвестным `topic_id` не отбрасывается молча: она превращается в
    пустую запись, чтобы валидатор доложил о выдумке, а не сделал вид, что её
    не было.
    """
    data = _extract_json(raw)
    by_id = {topic.topic_id: topic for topic in request.topics}

    pacing: list[TopicPacing] = []
    for entry in data.get("topic_pacing") or []:
        if not isinstance(entry, dict):
            continue
        topic_id = str(entry.get("topic_id", ""))
        specs = [
            (str(part.get("activity_type", "")), _as_int(part.get("duration_minutes")))
            for part in entry.get("lesson_parts") or []
            if isinstance(part, dict)
        ]

        topic = by_id.get(topic_id)
        if topic is None:
            pacing.append(
                TopicPacing(topic_id=topic_id, topic_external_id="", lesson_parts=())
            )
            continue

        pacing.append(
            TopicPacing(
                topic_id=topic.topic_id,
                topic_external_id=topic.external_id,
                lesson_parts=build_lesson_parts(
                    topic,
                    max_part_minutes=request.session_minutes,
                    part_plan=specs or None,
                ),
                title=topic.title,
                module_external_id=topic.module_external_id,
            )
        )

    pattern: list[WeeklyPatternDay] = []
    for entry in data.get("weekly_pattern") or []:
        if not isinstance(entry, dict):
            continue
        pattern.append(
            WeeklyPatternDay(
                weekday=_as_int(entry.get("weekday")),
                activity_types=tuple(
                    str(item) for item in entry.get("activity_types") or []
                ),
                preferred_duration_minutes=_as_int(
                    entry.get("preferred_duration_minutes"), request.session_minutes
                ),
            )
        )

    milestones: list[MilestoneSpec] = []
    for entry in data.get("milestones") or []:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title", "")).strip()
        if title:
            milestones.append(
                MilestoneSpec(
                    title=title,
                    after_topic_external_id=str(entry.get("after_topic_id", "")),
                )
            )

    try:
        buffer = float(data.get("buffer_percentage", 0.15))
    except (TypeError, ValueError):
        buffer = 0.15

    return PacingPlan(
        weekly_pattern=tuple(pattern),
        topic_pacing=tuple(pacing),
        milestones=tuple(milestones),
        buffer_percentage=buffer,
        rationale=str(data.get("rationale", "")),
    )


# ────────────────────────── Провайдер поверх модели ──────────────────────────


SYSTEM_PROMPT = """Ты методист, который делает ритм обучения устойчивым.

Твоя задача — разложить уже готовые темы на занятия. Программу менять нельзя.

Правила:
- Не создавай календарных дат: их считает backend.
- Ссылайся только на topic_id из переданного списка. Придумывать нельзя.
- Верни ВСЕ темы из списка, ни одной не пропусти и ни одну не повтори.
- Не меняй порядок тем относительно их prerequisites.
- Каждая тема заканчивается занятием assessment: без проверки освоение нечем
  подтвердить.
- Разделяй теорию, разбор примера, практику с подсказками и самостоятельную
  практику. Опора должна убывать: сначала показываем, потом делаем вместе,
  потом ученик работает сам.
- Не перегружай один день и не превышай переданные ограничения.
- Оставляй buffer: план должен быть устойчивым, а не максимально плотным.
- Не ставь новую сложную тему сразу после тяжёлой проверки.
- Сумма длительностей темы должна быть близка к её estimated_minutes: это
  оценка backend'а по объёму материала, а не пожелание."""


class OpenRouterPacingProvider:
    """Адаптер поверх существующего `ai_engine.text_llm.TextModel`.

    Новый клиент не создаётся: `TextModel` уже умеет strict JSON Schema,
    ограничение reasoning-бюджета и запись `AIUsageEvent`. Здесь добавляется
    только роль модели и feature-тег.
    """

    name = "openrouter"

    def __init__(self, *, model: str | None = None, feature: str = "schedule_pacing"):
        binding = resolve_model(ROLE_SCHEDULE_PLANNING)
        self.binding = binding
        self.model = model or binding.model
        self.feature = feature
        if not self.model:
            raise ProviderNotConfigured(
                "SCHEDULE_PLANNING_MODEL и TEXT_LLM_MODEL не заданы."
            )

    def generate_pacing(self, request: PacingRequest) -> PacingPlan:
        from ai_engine.text_llm import TextModel
        from ai_engine.usage import provider_call_reservation, usage_scope

        payload = {
            "goal": request.goal_text,
            "subject": request.subject,
            "current_level": request.current_level,
            "target_level": request.target_level,
            "theory_practice_balance": request.theory_practice_balance,
            "language": request.language,
            "sessions_per_week": request.sessions_per_week,
            "session_minutes": request.session_minutes,
            "available_weekdays": list(request.available_weekdays),
            "constraints": {
                "min_part_minutes": request.constraints.min_part_minutes,
                "max_part_minutes": request.constraints.max_part_minutes,
                "max_minutes_per_day": request.constraints.max_minutes_per_day,
                "max_minutes_per_week": request.constraints.max_minutes_per_week,
            },
            "topics": [
                {
                    "topic_id": topic.topic_id,
                    "title": topic.title,
                    "estimated_minutes": topic.estimated_minutes,
                    "breakdown": topic.duration_breakdown or {},
                    "prerequisites": list(
                        request.prerequisites.get(topic.topic_id, ())
                    ),
                }
                for topic in request.topics
            ],
        }

        with usage_scope(feature=self.feature):
            with provider_call_reservation(
                input_payload={"system_prompt": SYSTEM_PROMPT, "payload": payload},
                max_output_tokens=self.binding.max_tokens,
                feature=self.feature,
            ):
                response = TextModel(self.model, temperature=0.2).generate_json_content(
                    system_prompt=SYSTEM_PROMPT,
                    payload=payload,
                    timeout=self.binding.timeout_seconds,
                    max_tokens=self.binding.max_tokens,
                    reasoning_effort=self.binding.reasoning_effort,
                    feature=self.feature,
                    json_schema=build_pacing_schema(),
                    schema_name=SCHEMA_NAME,
                    providers=self.binding.providers,
                )

        return parse_pacing_response(response.text, request=request)


_FACTORIES = {
    "deterministic": DeterministicPacingProvider,
    "openrouter": OpenRouterPacingProvider,
}


def get_pacing_provider(key: str | None = None) -> PacingProvider:
    """Провайдер ритма. Без явного ключа — консервативный выбор.

    Реальная модель берётся ТОЛЬКО при явно настроенной роли: забытая
    переменная окружения не должна приводить к платному вызову. Та же логика,
    что у `curriculum.planning.providers.get_review_provider`.
    """
    if key:
        factory = _FACTORIES.get(key)
        if factory is None:
            raise ProviderNotConfigured(f"Неизвестный провайдер ритма: {key}")
        return factory()

    if resolve_model(ROLE_SCHEDULE_PLANNING).configured:
        try:
            return OpenRouterPacingProvider()
        except ProviderNotConfigured:
            logger.warning("Роль SCHEDULE_PLANNING настроена, но провайдер не поднялся.")
    return DeterministicPacingProvider()
