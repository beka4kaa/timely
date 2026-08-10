"""Смысл тем одной главы. Структура уже построена без модели.

Скелет (`planning/structure.py`) знает, какие модули и темы будут в плане, но не
знает, чему каждая тема учит. Это и спрашивается у модели — по одной главе за
вызов.

Почему по главе, а не за раз на всю книгу: 129 тем «Механики» по двенадцати
полям строгой схемы — около 23 тысяч токенов ответа при потолке в восемь. Глава
же укладывается в две-три тысячи с запасом, вызовы идут параллельно, и отказ на
одной главе не уносит остальные одиннадцать.

Модель здесь ничего не решает о составе плана. Ей присылают готовый список тем
и просят заполнить поля; лишние темы игнорируются, недостающие остаются с
детерминированными значениями из скелета.
"""

from __future__ import annotations

import json
import re
from typing import Any, Protocol

from ..model_registry import ROLE_COURSE_PLANNING, resolve_model
from .contracts import ProposedModule, TocEntry
from .providers import ProviderNotConfigured
from .validation import ALLOWED_BALANCE, ALLOWED_DIFFICULTY, ALLOWED_REVIEW

ENRICHMENT_PROMPT_VERSION = "chapter-enrichment-1.0.0"
SCHEMA_NAME = "chapter_enrichment"

_TOPIC_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "external_id": {
            "type": "string",
            "description": "Идентификатор темы из присланного списка. Не выдумывать.",
        },
        "objective": {
            "type": "string",
            "description": "Чему ученик научится. Одно предложение, через действие.",
        },
        "difficulty": {"type": "string", "enum": sorted(ALLOWED_DIFFICULTY)},
        "theory_practice_balance": {"type": "string", "enum": sorted(ALLOWED_BALANCE)},
        "mastery_criteria": {
            "type": "string",
            "description": "Как понять, что тема освоена. Пустая строка допустима.",
        },
        "review_strategy": {"type": "string", "enum": sorted(ALLOWED_REVIEW)},
        "prerequisites": {
            "type": "array",
            "items": {"type": "string"},
            "description": "external_id тем ЭТОЙ же главы, изучаемых раньше.",
        },
    },
}
_TOPIC_SCHEMA["required"] = sorted(_TOPIC_SCHEMA["properties"])

CHAPTER_ENRICHMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "objective": {
            "type": "string",
            "description": "Чему учит глава целиком. Одно-два предложения.",
        },
        "completion_criteria": {
            "type": "string",
            "description": "Когда главу можно считать пройденной.",
        },
        "milestone": {
            "type": "string",
            "description": "Название контрольной точки. Пустая строка допустима.",
        },
        "topics": {"type": "array", "items": _TOPIC_SCHEMA},
    },
}
CHAPTER_ENRICHMENT_SCHEMA["required"] = sorted(CHAPTER_ENRICHMENT_SCHEMA["properties"])

SYSTEM_PROMPT = """Ты методист. Тебе дана ОДНА глава учебника и список её тем.

Состав плана уже определён. Твоя задача — заполнить смысл, а не менять структуру.

Правила:
- Отвечай ровно по присланным темам, по их external_id. Не добавляй своих и не
  объединяй существующие.
- objective — через действие: «находить работу постоянной силы», а не «работа
  силы». Одно предложение.
- mastery_criteria — проверяемый признак: что ученик должен суметь сделать сам.
- difficulty оценивай для школьника, изучающего предмет впервые.
- prerequisites — только external_id тем ЭТОЙ главы, которые изучаются раньше.
  Циклы запрещены. Обычно это предыдущая тема или пусто.
- Никаких дат и длительностей: их считает backend.
- Не утверждай ничего о содержании книги вне присланных названий и понятий.

Верни ТОЛЬКО JSON по схеме."""


class ChapterEnrichmentProvider(Protocol):
    name: str

    def enrich(self, request: "ChapterRequest") -> "ChapterEnrichment": ...


class ChapterRequest:
    """Глава и её темы — всё, что уходит в один вызов."""

    def __init__(
        self,
        *,
        module: ProposedModule,
        chapter: TocEntry | None,
        entries_by_section: dict[str, TocEntry],
        goal_text: str = "",
        current_level: str = "",
        language: str = "ru",
    ):
        self.module = module
        self.chapter = chapter
        self.entries_by_section = entries_by_section
        self.goal_text = goal_text
        self.current_level = current_level
        self.language = language

    def payload(self) -> dict:
        topics = []
        for topic in self.module.topics:
            entry = next(
                (
                    self.entries_by_section[sid]
                    for sid in topic.source_section_ids
                    if sid in self.entries_by_section
                ),
                None,
            )
            topics.append(
                {
                    "external_id": topic.external_id,
                    "title": topic.title,
                    # Понятия и навыки из профиля раздела, если книга
                    # профилирована. Пусто — модель работает по названию.
                    "concepts": list(entry.concepts) if entry else [],
                    "skills": list(entry.skills) if entry else [],
                    "pages": [entry.page_start, entry.page_end] if entry else [0, 0],
                }
            )
        return {
            "goal": self.goal_text,
            "current_level": self.current_level,
            "language": self.language,
            "chapter": {
                "title": self.module.title,
                "summary": (self.chapter.summary if self.chapter else "") or "",
            },
            "topics": topics,
        }


class ChapterEnrichment:
    """Ответ модели по одной главе, уже разобранный и очищенный."""

    def __init__(
        self,
        *,
        objective: str = "",
        completion_criteria: str = "",
        milestone: str = "",
        topics: dict[str, dict] | None = None,
        model: str = "",
    ):
        self.objective = objective
        self.completion_criteria = completion_criteria
        self.milestone = milestone
        self.topics = topics or {}
        self.model = model


def apply_enrichment(module: ProposedModule, enrichment: ChapterEnrichment) -> None:
    """Переносит смысл в скелет. Структуру не трогает.

    Тема, которой модель не вернула, остаётся с детерминированными значениями —
    именно поэтому отказ вызова не уменьшает план.
    """
    module.objective = enrichment.objective or module.objective
    module.completion_criteria = (
        enrichment.completion_criteria or module.completion_criteria
    )
    module.milestone = enrichment.milestone or module.milestone

    known = {topic.external_id for topic in module.topics}
    for topic in module.topics:
        data = enrichment.topics.get(topic.external_id)
        if not data:
            continue
        topic.objective = data.get("objective") or topic.objective
        topic.difficulty = data.get("difficulty") or topic.difficulty
        topic.theory_practice_balance = (
            data.get("theory_practice_balance") or topic.theory_practice_balance
        )
        topic.mastery_criteria = data.get("mastery_criteria") or topic.mastery_criteria
        topic.review_strategy = data.get("review_strategy") or topic.review_strategy
        # Зависимости только внутри главы и только на существующие темы: чужой
        # external_id стал бы висячим ребром в графе prerequisites.
        topic.prerequisites = [
            ref
            for ref in data.get("prerequisites") or []
            if ref in known and ref != topic.external_id
        ]


class FakeChapterEnrichmentProvider:
    """Детерминированное обогащение без сети.

    Не имитирует методиста: строит цель из названия темы. Этого хватает, чтобы
    тесты проверяли перенос полей и устойчивость к отказам, и не хватает, чтобы
    fake приняли за работающее обогащение.
    """

    name = "fake-enrichment"

    def enrich(self, request: ChapterRequest) -> ChapterEnrichment:
        topics = {}
        previous = ""
        for topic in request.module.topics:
            topics[topic.external_id] = {
                "objective": f"Научиться применять: {topic.title}",
                "difficulty": "medium",
                "theory_practice_balance": "balanced",
                "mastery_criteria": (
                    f"Самостоятельно решает задачи по теме «{topic.title}»"
                ),
                "review_strategy": "spaced",
                "prerequisites": [previous] if previous else [],
            }
            previous = topic.external_id
        return ChapterEnrichment(
            objective=f"Освоить материал главы «{request.module.title}»",
            completion_criteria="Все темы главы отмечены как усвоенные",
            topics=topics,
            model=self.name,
        )


class OpenRouterChapterEnrichmentProvider:
    """Реальное обогащение. Транспорт — тот же `TextModel`.

    Роль намеренно та же, что у планирования: это по-прежнему построение
    программы, просто разбитое по главам. Отдельная переменная окружения здесь
    завела бы вторую настройку для одной задачи.
    """

    name = "openrouter-enrichment"

    def __init__(self, *, model: str | None = None, feature: str = "course_planning"):
        binding = resolve_model(ROLE_COURSE_PLANNING)
        self.model = model or binding.model
        self.binding = binding
        self.feature = feature
        if not self.model:
            raise ProviderNotConfigured(
                "COURSE_PLANNING_MODEL и TEXT_LLM_MODEL не заданы."
            )

    def enrich(self, request: ChapterRequest) -> ChapterEnrichment:
        from ai_engine.text_llm import TextModel
        from ai_engine.usage import provider_call_reservation, usage_scope

        payload = request.payload()
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
                    json_schema=CHAPTER_ENRICHMENT_SCHEMA,
                    schema_name=SCHEMA_NAME,
                    providers=self.binding.providers,
                )
        return parse_enrichment_response(response.text, model=self.model)


def parse_enrichment_response(raw: str, *, model: str) -> ChapterEnrichment:
    """Мусор — это пустое обогащение, а не исключение.

    Скелет уже содержит все темы; нечитаемый ответ означает лишь, что глава
    останется с детерминированными формулировками.
    """
    data = _load_json(raw)
    if not isinstance(data, dict):
        return ChapterEnrichment(model=model)

    topics: dict[str, dict] = {}
    for item in data.get("topics") or []:
        if not isinstance(item, dict):
            continue
        external_id = str(item.get("external_id") or "").strip()
        if not external_id:
            continue
        difficulty = str(item.get("difficulty") or "").strip().lower()
        balance = str(item.get("theory_practice_balance") or "").strip().lower()
        review = str(item.get("review_strategy") or "").strip().lower()
        topics[external_id] = {
            "objective": str(item.get("objective") or "").strip(),
            "difficulty": difficulty if difficulty in ALLOWED_DIFFICULTY else "",
            "theory_practice_balance": balance if balance in ALLOWED_BALANCE else "",
            "mastery_criteria": str(item.get("mastery_criteria") or "").strip(),
            "review_strategy": review if review in ALLOWED_REVIEW else "",
            "prerequisites": [
                str(ref).strip()
                for ref in item.get("prerequisites") or []
                if str(ref or "").strip()
            ],
        }

    return ChapterEnrichment(
        objective=str(data.get("objective") or "").strip(),
        completion_criteria=str(data.get("completion_criteria") or "").strip(),
        milestone=str(data.get("milestone") or "").strip(),
        topics=topics,
        model=model,
    )


def _load_json(raw: str):
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def get_enrichment_provider() -> ChapterEnrichmentProvider:
    """Fake по умолчанию. Реальный провайдер — только при настроенной роли."""
    if not resolve_model(ROLE_COURSE_PLANNING).configured:
        return FakeChapterEnrichmentProvider()
    try:
        return OpenRouterChapterEnrichmentProvider()
    except ProviderNotConfigured:
        return FakeChapterEnrichmentProvider()
