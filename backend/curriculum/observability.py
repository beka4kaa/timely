"""Безопасные NDJSON-события обработки книги.

Payload собирается только из allowlist: текст книги, filename/storage key,
email, exception message и embedding сюда передать невозможно случайно.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from django.utils import timezone

logger = logging.getLogger("curriculum.ingestion.events")

_OPTIONAL_FIELDS = frozenset(
    {
        "from_status",
        "to_status",
        "duration_ms",
        "retry_count",
        "error_code",
        "pages",
        "ocr_pages",
        "sections",
        "blocks",
        "tasks",
        "solutions",
        "chunks",
    }
)


def log_ingestion_event(
    event: str,
    *,
    document_id: Any,
    job_id: Any,
    processing_version: str,
    **fields: Any,
) -> None:
    payload: dict[str, Any] = {
        "event": str(event)[:64],
        "occurred_at": timezone.now().isoformat(),
        "document_id": str(document_id),
        "job_id": str(job_id),
        "processing_version": str(processing_version)[:32],
    }
    for key in _OPTIONAL_FIELDS:
        value = fields.get(key)
        if value in (None, ""):
            continue
        if isinstance(value, (bool, int, float)):
            payload[key] = value
        else:
            payload[key] = str(value)[:120]
    logger.info(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    )
