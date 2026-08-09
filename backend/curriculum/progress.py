"""Прогресс обработки документа: один источник правды для API и интерфейса.

Зачем отдельный модуль. Статусы живут в `Document.Status` и описывают ПАЙПЛАЙН:
одиннадцать шагов, из которых человеку интересны четыре. Если долю выполнения и
подписи считать во вьюхе, а группировку — на фронтенде, они разъедутся при первом
же новом шаге пайплайна. Здесь и то и другое рядом, и добавление шага правит одно
место.

Модуль намеренно не импортирует ничего тяжёлого: его зовут на каждый опрос
статуса, а опрашивают раз в две секунды.
"""

from __future__ import annotations

from .models import Document

# Порядок шагов пайплайна. Совпадает с последовательностью `_run_pipeline`
# в `services/ingestion.py`; `failed` сюда не входит — это не шаг, а исход.
INGESTION_STEPS: tuple[str, ...] = (
    Document.Status.UPLOADED,
    Document.Status.VALIDATING,
    Document.Status.EXTRACTING,
    Document.Status.CLASSIFYING,
    Document.Status.OCR,
    Document.Status.RECONSTRUCTING,
    Document.Status.EXTRACTING_BLOCKS,
    Document.Status.CHUNKING,
    Document.Status.INDEXING,
    Document.Status.QUALITY_CHECK,
    Document.Status.READY,
)

TERMINAL_STATUSES: frozenset[str] = frozenset(
    {Document.Status.READY, Document.Status.FAILED}
)

# Подписи берём у самих TextChoices, чтобы не держать второй словарь, который
# рассинхронизируется с моделью.
STEP_LABELS: dict[str, str] = {
    value: label for value, label in Document.Status.choices
}

# Укрупнение для интерфейса. Одиннадцать шагов человеку не нужны: он видит
# «идёт работа», а не внутреннее устройство пайплайна. Сырой статус остаётся
# в ответе — фронтенд прячет его в «подробности».
PHASES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "checking",
        "Проверяем файл",
        (
            Document.Status.UPLOADED,
            Document.Status.QUEUED,
            Document.Status.VALIDATING,
        ),
    ),
    (
        "reading",
        "Читаем страницы",
        (
            Document.Status.EXTRACTING,
            Document.Status.CLASSIFYING,
            Document.Status.OCR,
        ),
    ),
    (
        "structuring",
        "Разбираем структуру",
        (
            Document.Status.RECONSTRUCTING,
            Document.Status.EXTRACTING_BLOCKS,
            Document.Status.CHUNKING,
        ),
    ),
    (
        "indexing",
        "Готовим поиск по книге",
        (
            Document.Status.INDEXING,
            Document.Status.QUALITY_CHECK,
            Document.Status.READY,
        ),
    ),
)

_STATUS_TO_PHASE: dict[str, tuple[str, str, int]] = {
    status: (key, title, index)
    for index, (key, title, statuses) in enumerate(PHASES)
    for status in statuses
}

_STEP_INDEX: dict[str, int] = {
    status: index for index, status in enumerate(INGESTION_STEPS)
}
# Очередь — состояние до первого шага пайплайна, а не отдельная операция над
# документом. В API она поэтому показывает тот же первый шаг, что и `uploaded`,
# не увеличивая исторический счётчик 11 шагов.
_STEP_INDEX[Document.Status.QUEUED] = _STEP_INDEX[Document.Status.UPLOADED]


def is_terminal(status: str) -> bool:
    """`ready` и `failed` — исходы, дальше опрашивать нечего."""
    return status in TERMINAL_STATUSES


def step_label(status: str) -> str:
    return STEP_LABELS.get(status, status)


def progress_for(status: str) -> tuple[int, int, float]:
    """`(номер шага, всего шагов, доля 0..1)`.

    `failed` отдаёт долю по последнему известному шагу — 0.0. Показывать
    провалившемуся документу «выполнено 64%» было бы враньём, а прогресс на
    экране ошибки всё равно скрыт.
    """
    total = len(INGESTION_STEPS)
    if status == Document.Status.FAILED:
        return 0, total, 0.0
    index = _STEP_INDEX.get(status)
    if index is None:
        return 0, total, 0.0
    return index + 1, total, (index + 1) / total


def phase_for(status: str) -> tuple[str, str, int]:
    """`(ключ фазы, подпись, порядковый номер)` для укрупнённого индикатора."""
    return _STATUS_TO_PHASE.get(status, ("checking", PHASES[0][1], 0))


# Сообщение о зависшей обработке. Одно место на весь проект: код `stalled`
# приходит и в `error_code` джоба, и в ответ `/status/`.
STALLED_ERROR_CODE = "stalled"
STALLED_MESSAGE = (
    "Обработка прервалась: задача давно не обновляла состояние. "
    "Файл сохранён — попробуйте запустить обработку заново."
)


def describe(status: str, *, stale: bool = False) -> dict:
    """Готовый блок прогресса для ответа API.

    `stale` — это job, который не менял статус дольше допустимого. Причину по
    одному таймауту не угадываем, но продолжать показывать «идёт работа» значит
    обрекать интерфейс на вечный спиннер. Признак вычисляет
    `services.dispatch.is_stale`, здесь он только переводится в ответ.
    """
    if stale:
        status = Document.Status.FAILED
    step_index, step_total, ratio = progress_for(status)
    phase_key, phase_title, phase_index = phase_for(status)
    return {
        "stalled": bool(stale),
        "ingestion_status": status,
        "step_index": step_index,
        "step_total": step_total,
        "progress": round(ratio, 4),
        "step_label": step_label(status),
        "phase": phase_key,
        "phase_label": phase_title,
        "phase_index": phase_index,
        "phase_total": len(PHASES),
        "is_terminal": is_terminal(status),
    }
