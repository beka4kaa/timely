"""OCR сканированных страниц через vision-модель.

Дисциплина та же, что в `planning/providers.py`: провайдер выбирается по
конфигурации, и НЕнастроенная роль даёт «пустой» провайдер, а не падение и не
неожиданный платный вызов. Забытая переменная окружения не должна ни ломать
загрузку книги, ни выставлять счёт.

Модель берётся из `model_registry.resolve_model(ROLE_OCR)`. `ROLE_OCR`
намеренно исключён из `_TEXT_FALLBACK_ROLES`, поэтому чат-модель здесь
подставиться не может: она не распознаёт страницу.

Сеть и клиент не свои: используется существующий `ai_engine.glm_client.
glm_chat_image`, который уже умеет OpenAI-совместимый vision-запрос, принимает
`model=` и сам пишет расход в `record_model_usage`.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Protocol

from .model_registry import ROLE_OCR, resolve_model

logger = logging.getLogger(__name__)

# Промпт-дисциплина унаследована от `ai_engine/ocr_views.py`: универсальная VLM
# без явного запрета охотно отвечает «На странице изображена формула...» вместо
# самой формулы. Здесь дополнительно требуется сохранять структуру, потому что
# дальше текст размечается по маркерам в `blocks.py`: если модель перепишет
# «Задача 5.» своими словами, блок перестанет быть задачей.
OCR_SYSTEM_PROMPT = (
    "You are an OCR engine, not an assistant. You transcribe textbook pages verbatim.\n"
    "Rules:\n"
    "1. Output ONLY the text visible on the page, character for character.\n"
    "2. Preserve the original line breaks and the natural reading order.\n"
    "3. Preserve section numbers and marker words exactly as printed "
    "(for example «1.2», «Определение.», «Теорема 3.», «Задача 5.», «Решение.»).\n"
    "4. Write mathematical expressions as LaTeX.\n"
    "5. Never describe, explain, summarise or comment on the page.\n"
    "6. Never add a preamble, heading, apology or closing remark.\n"
    "7. Never wrap the result in markdown code fences.\n"
    "8. Never translate: keep the original language of the page.\n"
    "9. If the page contains no text at all, return an empty response."
)

OCR_USER_PROMPT = "Transcribe this textbook page."

# Сколько страниц одного документа разрешено отправить в OCR за один прогон.
# Предохранитель от стоимости: `upload_validation.MAX_PAGES` допускает 1500
# страниц, а это 1500 vision-вызовов за одну загрузку.
MAX_OCR_PAGES_PER_RUN = 40


@dataclass(frozen=True)
class OcrResult:
    """Результат распознавания одной страницы."""

    text: str
    model: str
    succeeded: bool
    error: str = ""

    @property
    def is_empty(self) -> bool:
        return not self.text.strip()


class OcrProvider(Protocol):
    name: str

    def transcribe_page(self, png_bytes: bytes) -> OcrResult: ...


class NullOcrProvider:
    """Провайдер по умолчанию: OCR не настроен, страница остаётся без текста.

    Возвращает неуспех, а не исключение: скан внутри книги — это не причина
    провалить загрузку всей книги. Страница просто останется с пустым текстом,
    и `DocumentPage.ocr_applied` останется False, что видно в диагностике.
    """

    name = "null-ocr"

    def transcribe_page(self, png_bytes: bytes) -> OcrResult:
        return OcrResult(
            text="", model="", succeeded=False, error="ocr_not_configured"
        )


class VisionOcrProvider:
    """OCR через существующий vision-клиент проекта."""

    name = "vision-ocr"

    def __init__(
        self, *, model: str, timeout_seconds: int = 180, max_tokens: int = 8000
    ) -> None:
        if not model:
            raise ValueError("VisionOcrProvider требует непустое имя модели")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_tokens = max_tokens

    def transcribe_page(self, png_bytes: bytes) -> OcrResult:
        # Импорт внутри метода: `ai_engine.glm_client` при импорте читает
        # настройки и создаёт клиент, а `curriculum.ocr` должен импортироваться
        # в тестах без сети и без ключей.
        from ai_engine.glm_client import glm_chat_image
        from ai_engine.usage import usage_scope

        encoded = base64.b64encode(png_bytes).decode("ascii")
        try:
            with usage_scope(feature="curriculum_ocr"):
                text = glm_chat_image(
                    image_base64=encoded,
                    system_prompt=OCR_SYSTEM_PROMPT,
                    user_prompt=OCR_USER_PROMPT,
                    model=self.model,
                    max_tokens=self.max_tokens,
                    timeout=self.timeout_seconds,
                )
        except Exception as exc:  # noqa: BLE001 — наружу OCR не роняем
            logger.warning("OCR страницы не удался (%s): %s", self.model, exc)
            return OcrResult(text="", model=self.model, succeeded=False, error=str(exc))

        return OcrResult(text=strip_code_fences(text), model=self.model, succeeded=True)


def strip_code_fences(text: str) -> str:
    """Снимает ```-обёртку, если модель всё же её добавила."""
    cleaned = (text or "").strip()
    if not cleaned.startswith("```"):
        return cleaned
    lines = cleaned.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def get_ocr_provider() -> OcrProvider:
    """Возвращает настроенный провайдер или `NullOcrProvider`.

    Реальная модель берётся только при заданном `OCR_MODEL`. Обрати внимание:
    `model_registry` читает переменные процесса через `os.getenv` и НЕ смотрит в
    настройки Django, поэтому `OCR_MODEL` надо экспортировать серверу.
    """
    binding = resolve_model(ROLE_OCR)
    if not binding.configured:
        return NullOcrProvider()
    return VisionOcrProvider(
        model=binding.model,
        timeout_seconds=binding.timeout_seconds,
        max_tokens=binding.max_tokens,
    )
