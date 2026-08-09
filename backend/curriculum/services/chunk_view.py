"""Перевод строки БД в плоский `RetrievableChunk`.

Отдельный модуль, потому что конвертация нужна двум потребителям — контексту
планировщика и поиску, — а `retrieval.py` намеренно не знает про Django-модели:
он тестируется без базы.
"""

from __future__ import annotations

from ..models import Document, KnowledgeChunk
from ..retrieval import RetrievableChunk


def as_retrievable(chunk: KnowledgeChunk, document: Document) -> RetrievableChunk:
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
