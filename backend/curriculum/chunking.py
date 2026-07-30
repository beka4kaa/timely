"""Смысловое разбиение книги на фрагменты для retrieval.

Почему не «каждые N токенов»: механическая нарезка разрывает определение
пополам, склеивает конец доказательства с началом примера и — самое опасное —
кладёт условие задачи и её решение в один фрагмент. После этого никакая
политика доступа уже не спасёт: решение попадёт в контекст модели вместе с
условием.

Здесь чанк строится по типу блока:

* определение / теорема / пример / итоги  — каждый отдельным чанком;
* доказательство                          — отдельно, но с `parent` на теорему;
* задача                                  — отдельно, `chunk_type=task`;
* решение                                 — отдельно, `solution_visibility=restricted`;
* таблица и рисунок                       — вместе со своей подписью;
* обычный текст                           — склеивается в пределах одного
                                            раздела до лимита токенов.

Детерминированность: для одинакового входа и одной `processing_version` выход
обязан совпадать побитово, включая `content_hash`. Иначе переиндексация будет
каждый раз создавать «новые» чанки, а `CourseSourceBinding` начнёт ссылаться на
исчезнувшие ID. Поэтому здесь нет ни словарей с недетерминированным порядком,
ни времени, ни случайности.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

# Ограничение на «прозаический» чанк. Токены считаем приближённо (см.
# `estimate_tokens`) — точный токенайзер зависит от модели, а чанкинг обязан
# оставаться от модели независимым.
MAX_PROSE_TOKENS = 350
# Ниже этого порога отдельный прозаический чанк бессмысленен — приклеиваем к
# предыдущему, если он в том же разделе.
MIN_PROSE_TOKENS = 20

# Типы блоков, каждый из которых всегда становится самостоятельным чанком.
_STANDALONE = {
    "definition": "definition",
    "theorem": "theorem",
    "proof": "proof",
    "example": "example",
    "summary": "summary",
    "exercise": "task",
    "solution": "solution",
}

# Блоки, которые склеиваются со своей подписью.
_CAPTIONED = {"table": "table", "figure": "figure"}

_WHITESPACE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """Схлопывает пробелы и переносы: хеш не должен зависеть от вёрстки."""
    return _WHITESPACE.sub(" ", (text or "").replace("­", "")).strip()


def estimate_tokens(text: str) -> int:
    """Грубая оценка: ~4 символа на токен для кириллицы и латиницы.

    Специально приближённая и без внешних зависимостей: точное число знает
    только токенайзер конкретной модели, а бюджет контекста всё равно берётся с
    запасом в `ContextAssembler`.
    """
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


@dataclass(frozen=True)
class SourceBlock:
    """Вход чанкера — уже извлечённый и типизированный блок.

    Намеренно не Django-модель: чанкер должен работать и над данными из БД, и
    над фикстурой в тесте, не требуя миграций.
    """

    block_id: str
    kind: str
    text: str
    page: int
    reading_order: int
    section_path: str = ""
    section_id: str | None = None
    # Для решения — ссылка на блок задачи, чтобы связать их, не сливая.
    task_block_id: str | None = None
    number_label: str = ""


@dataclass
class Chunk:
    """Результат чанкинга. `content_hash` стабилен между запусками."""

    chunk_type: str
    normalized_text: str
    block_ids: tuple[str, ...]
    page_start: int
    page_end: int
    section_path: str
    section_id: str | None
    token_count: int
    content_hash: str
    solution_visibility: str = "always"
    # Индексы соседей в возвращённом списке; проставляются в `link_chunks`.
    parent_index: int | None = None
    previous_index: int | None = None
    next_index: int | None = None
    task_block_id: str | None = None
    number_label: str = ""
    order_index: int = 0


def compute_content_hash(
    *, chunk_type: str, normalized_text: str, processing_version: str
) -> str:
    """Хеш содержимого чанка.

    В хеш входит тип и версия пайплайна: один и тот же текст, размеченный как
    `definition` и как `prose`, — разные фрагменты, и при смене версии
    переиндексация обязана дать новые ID, а не молча переиспользовать старые.
    """
    payload = f"{processing_version}\x1f{chunk_type}\x1f{normalized_text}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _make_chunk(
    *,
    chunk_type: str,
    blocks: list[SourceBlock],
    processing_version: str,
    solution_visibility: str = "always",
) -> Chunk:
    text = normalize_text(" ".join(b.text for b in blocks))
    pages = [b.page for b in blocks]
    first = blocks[0]
    return Chunk(
        chunk_type=chunk_type,
        normalized_text=text,
        block_ids=tuple(b.block_id for b in blocks),
        page_start=min(pages),
        page_end=max(pages),
        section_path=first.section_path,
        section_id=first.section_id,
        token_count=estimate_tokens(text),
        content_hash=compute_content_hash(
            chunk_type=chunk_type,
            normalized_text=text,
            processing_version=processing_version,
        ),
        solution_visibility=solution_visibility,
        task_block_id=first.task_block_id,
        number_label=first.number_label,
    )


def _flush_prose(
    buffer: list[SourceBlock], out: list[Chunk], processing_version: str
) -> None:
    if not buffer:
        return
    out.append(
        _make_chunk(
            chunk_type="prose", blocks=list(buffer), processing_version=processing_version
        )
    )
    buffer.clear()


def chunk_blocks(
    blocks: list[SourceBlock], *, processing_version: str
) -> list[Chunk]:
    """Главная точка входа. Порядок выхода повторяет `reading_order`.

    Вход не сортируется по месту: копия сортируется явно, чтобы функция
    оставалась чистой и не зависела от того, в каком порядке ORM вернул строки.
    """
    ordered = sorted(blocks, key=lambda b: (b.reading_order, b.block_id))
    out: list[Chunk] = []
    prose: list[SourceBlock] = []
    pending_caption_for: int | None = None

    for block in ordered:
        kind = block.kind

        # Подпись приклеиваем к предыдущей таблице/рисунку, а не делаем чанком.
        if kind == "caption" and pending_caption_for is not None:
            target = out[pending_caption_for]
            merged = normalize_text(f"{target.normalized_text} {block.text}")
            out[pending_caption_for] = Chunk(
                chunk_type=target.chunk_type,
                normalized_text=merged,
                block_ids=target.block_ids + (block.block_id,),
                page_start=min(target.page_start, block.page),
                page_end=max(target.page_end, block.page),
                section_path=target.section_path,
                section_id=target.section_id,
                token_count=estimate_tokens(merged),
                content_hash=compute_content_hash(
                    chunk_type=target.chunk_type,
                    normalized_text=merged,
                    processing_version=processing_version,
                ),
                solution_visibility=target.solution_visibility,
                task_block_id=target.task_block_id,
                number_label=target.number_label,
            )
            pending_caption_for = None
            continue

        pending_caption_for = None

        if kind in _STANDALONE:
            _flush_prose(prose, out, processing_version)
            chunk_type = _STANDALONE[kind]
            # Решение — единственный тип с ограниченной видимостью.
            visibility = "restricted" if chunk_type == "solution" else "always"
            out.append(
                _make_chunk(
                    chunk_type=chunk_type,
                    blocks=[block],
                    processing_version=processing_version,
                    solution_visibility=visibility,
                )
            )
            continue

        if kind in _CAPTIONED:
            _flush_prose(prose, out, processing_version)
            out.append(
                _make_chunk(
                    chunk_type=_CAPTIONED[kind],
                    blocks=[block],
                    processing_version=processing_version,
                )
            )
            pending_caption_for = len(out) - 1
            continue

        if kind == "heading":
            # Заголовок закрывает предыдущий прозаический чанк, но сам чанком
            # не становится: его роль — в `section_path`.
            _flush_prose(prose, out, processing_version)
            continue

        # Обычный текст: копим в пределах раздела до лимита.
        if prose and prose[-1].section_path != block.section_path:
            _flush_prose(prose, out, processing_version)

        prose.append(block)
        accumulated = estimate_tokens(
            normalize_text(" ".join(b.text for b in prose))
        )
        if accumulated >= MAX_PROSE_TOKENS:
            _flush_prose(prose, out, processing_version)

    _flush_prose(prose, out, processing_version)
    return link_chunks(out)


def link_chunks(chunks: list[Chunk]) -> list[Chunk]:
    """Проставляет order_index, previous/next и parent для доказательств.

    `parent` для доказательства — ближайшая теорема выше: доказательство без
    формулировки бесполезно в выдаче, и по этой связи `ContextAssembler`
    подтягивает теорему следом.
    """
    last_theorem: int | None = None
    for index, chunk in enumerate(chunks):
        chunk.order_index = index
        chunk.previous_index = index - 1 if index > 0 else None
        chunk.next_index = index + 1 if index < len(chunks) - 1 else None

        if chunk.chunk_type == "theorem":
            last_theorem = index
        elif chunk.chunk_type == "proof":
            # Между теоремой и доказательством может стоять абзац-связка,
            # поэтому ссылку не сбрасываем на первом же чужом чанке.
            chunk.parent_index = last_theorem

    return chunks


@dataclass(frozen=True)
class TaskSolutionPair:
    """Разделённая пара: условие и решение живут раздельно, связаны по ID."""

    task_block_id: str
    task_text: str
    task_page: int
    number_label: str
    solution_block_id: str | None = None
    solution_text: str = ""
    solution_page: int = 0


def split_tasks_and_solutions(blocks: list[SourceBlock]) -> list[TaskSolutionPair]:
    """Собирает пары «задача → решение», НЕ склеивая их тексты.

    Решение связывается с задачей по `task_block_id`, если извлекатель его
    проставил, иначе — по совпадению номера («12.4»). Несопоставленное решение
    остаётся без задачи: лучше потерять связь, чем привязать решение к чужому
    условию.
    """
    ordered = sorted(blocks, key=lambda b: (b.reading_order, b.block_id))
    tasks = [b for b in ordered if b.kind == "exercise"]
    solutions = [b for b in ordered if b.kind == "solution"]

    by_block_id = {b.block_id: b for b in tasks}
    by_number = {b.number_label: b for b in tasks if b.number_label}

    matched: dict[str, SourceBlock] = {}
    for solution in solutions:
        target = None
        if solution.task_block_id and solution.task_block_id in by_block_id:
            target = by_block_id[solution.task_block_id]
        elif solution.number_label and solution.number_label in by_number:
            target = by_number[solution.number_label]
        if target is not None and target.block_id not in matched:
            matched[target.block_id] = solution

    pairs: list[TaskSolutionPair] = []
    for task in tasks:
        solution = matched.get(task.block_id)
        pairs.append(
            TaskSolutionPair(
                task_block_id=task.block_id,
                task_text=normalize_text(task.text),
                task_page=task.page,
                number_label=task.number_label,
                solution_block_id=solution.block_id if solution else None,
                solution_text=normalize_text(solution.text) if solution else "",
                solution_page=solution.page if solution else 0,
            )
        )
    return pairs
