"""Подсчёт токенов для чанкинга и бюджета контекста.

Зачем отдельный слой, а не `len(text) // 4`. Эвристика «4 символа на токен»
откалибрована по латинице и на кириллице систематически врёт: русский текст в
cl100k_base даёт примерно вдвое больше токенов на тот же объём символов. При
лимите 650 токенов это означает чанки, которые на деле весят под тысячу, —
и переполненный контекст у модели там, где по расчётам оставался запас.

Точный путь — `cl100k_base`: это кодировка `text-embedding-3-small`, которым
считаются векторы (см. Решения №4 в ROADMAP), то есть чанкер меряет ровно тем
же, чем потом меряет провайдер.

**Про сеть.** `tiktoken` при первом обращении СКАЧИВАЕТ файл кодировки и кладёт
его в кэш. В контейнере с закрытым исходящим трафиком это исключение, а не
пустой результат. Поэтому загрузка обёрнута, и при любой неудаче остаётся
эвристика: разбиение книги не должно падать из-за недоступного CDN. Разница в
границах чанков при этом честно отражается в `PROCESSING_VERSION`.
"""

from __future__ import annotations

import logging
import re
from typing import Protocol

logger = logging.getLogger(__name__)

# Средняя длина токена в символах для эвристики. Занижена намеренно: лучше
# нарезать чуть мельче ожидаемого, чем выдать чанк, не влезающий в лимит.
_HEURISTIC_CHARS_PER_TOKEN = 4

_WORD_BOUNDARY = re.compile(r"\s")


class Tokenizer(Protocol):
    name: str

    def count(self, text: str) -> int: ...

    def tail(self, text: str, tokens: int) -> str: ...


class HeuristicTokenizer:
    """Приближение без внешних зависимостей.

    Тот же расчёт, что был зашит в `chunking.estimate_tokens`, вынесенный за
    общий интерфейс. Работает всегда и никуда не ходит.
    """

    name = "heuristic"

    def count(self, text: str) -> int:
        if not text:
            return 0
        return max(1, (len(text) + _HEURISTIC_CHARS_PER_TOKEN - 1) // _HEURISTIC_CHARS_PER_TOKEN)

    def tail(self, text: str, tokens: int) -> str:
        """Хвост примерно в `tokens` токенов, обрезанный по границе слова.

        Обрезка по слову важна не для красоты: разорванное пополам слово в
        начале следующего чанка попадает и в эмбеддинг, и в цитату, которую
        увидит ученик.
        """
        if tokens <= 0 or not text:
            return ""
        chars = tokens * _HEURISTIC_CHARS_PER_TOKEN
        if len(text) <= chars:
            return text
        cut = text[-chars:]
        match = _WORD_BOUNDARY.search(cut)
        return cut[match.end():].strip() if match else cut.strip()


class TiktokenTokenizer:
    """Точный подсчёт через `cl100k_base`."""

    name = "cl100k_base"

    def __init__(self, encoding) -> None:
        self._encoding = encoding

    def count(self, text: str) -> int:
        if not text:
            return 0
        return len(self._encoding.encode(text))

    def tail(self, text: str, tokens: int) -> str:
        if tokens <= 0 or not text:
            return ""
        ids = self._encoding.encode(text)
        if len(ids) <= tokens:
            return text
        return self._encoding.decode(ids[-tokens:])


_cached: Tokenizer | None = None


def get_tokenizer() -> Tokenizer:
    """Точный токенайзер, если он доступен, иначе эвристика.

    Результат кэшируется: загрузка кодировки стоит десятки миллисекунд, а
    чанкинг зовёт счётчик на каждом блоке.
    """
    global _cached
    if _cached is None:
        _cached = _build_tokenizer()
    return _cached


def set_tokenizer(tokenizer: Tokenizer | None) -> None:
    """Подмена для тестов. `None` возвращает автоматический выбор."""
    global _cached
    _cached = tokenizer


def _build_tokenizer() -> Tokenizer:
    try:
        import tiktoken
    except ImportError:
        logger.info("tiktoken не установлен — считаем токены эвристикой")
        return HeuristicTokenizer()

    try:
        # Может уйти в сеть за файлом кодировки — см. шапку модуля.
        encoding = tiktoken.get_encoding("cl100k_base")
    except Exception as exc:  # noqa: BLE001 — падать из-за CDN нельзя
        logger.warning(
            "Кодировка cl100k_base недоступна (%s) — считаем токены эвристикой", exc
        )
        return HeuristicTokenizer()

    return TiktokenTokenizer(encoding)
