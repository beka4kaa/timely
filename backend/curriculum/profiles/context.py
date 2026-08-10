"""Сбор текста раздела для профилирования.

Две вещи, которые здесь важнее удобства.

**Решения не попадают в контекст.** `KnowledgeChunk.SOLUTION` исключается на
уровне запроса, а не фильтрацией результата. Профиль главы уходит в
планировщик, планировщик — в описание темы, описание темы ученик видит до
того, как взялся за задачу. Один пропущенный фрагмент с решением превращает
самостоятельную работу в списывание, и заметить это постфактум невозможно.

**Раздел не пересказывается целиком.** Главе на сорок страниц соответствуют
десятки фрагментов; отправлять их все — платить за пересказ книги ради списка
из десяти понятий. Берётся начало раздела (там вводятся определения) и
равномерная выборка дальше, в пределах бюджета символов.
"""

from __future__ import annotations

from ..models import DocumentSection, KnowledgeChunk

# Бюджет на раздел. Примерно 4 тысячи токенов — достаточно, чтобы увидеть
# определения и характер материала, и мало, чтобы профилирование книги не
# стоило дороже самого планирования.
CONTEXT_CHAR_BUDGET = 16000

# Сколько фрагментов от начала раздела берётся подряд, без прореживания.
# Определения и постановка задачи почти всегда в первых абзацах.
HEAD_CHUNKS = 6

# Типы, которые не идут в контекст ни при каких условиях.
EXCLUDED_TYPES = (KnowledgeChunk.ChunkType.SOLUTION,)


def descendant_ids(section: DocumentSection) -> list[str]:
    """Раздел вместе со всеми вложенными.

    Профилируется глава, а материал лежит в её параграфах: у самой главы
    собственного текста обычно нет, кроме вводного абзаца.
    """
    ids = [str(section.pk)]
    frontier = [section.pk]
    while frontier:
        children = list(
            DocumentSection.objects.filter(parent_id__in=frontier).values_list(
                "id", flat=True
            )
        )
        if not children:
            break
        ids.extend(str(child) for child in children)
        frontier = children
    return ids


def collect_statistics(
    section: DocumentSection, *, processing_version: str = ""
) -> dict:
    """Из чего состоит раздел. Считается по базе, а не спрашивается у модели.

    Число формул и задач — арифметика, и модель здесь только ошибётся: она
    оценивает на глаз то, что у нас лежит строками в таблице.
    """
    section_ids = descendant_ids(section)
    counts: dict[str, int] = {}
    for chunk_type, count in _counts_by_type(section_ids, processing_version):
        counts[chunk_type] = count
    return {
        "pages": max(0, (section.end_page or 0) - (section.start_page or 0) + 1),
        "definitions": counts.get(KnowledgeChunk.ChunkType.DEFINITION, 0),
        "theorems": counts.get(KnowledgeChunk.ChunkType.THEOREM, 0),
        "examples": counts.get(KnowledgeChunk.ChunkType.EXAMPLE, 0),
        "tasks": counts.get(KnowledgeChunk.ChunkType.TASK, 0),
        "figures": counts.get(KnowledgeChunk.ChunkType.FIGURE, 0),
        "chunks": sum(counts.values()),
    }


def _counts_by_type(section_ids: list[str], processing_version: str):
    from django.db.models import Count

    rows = (
        _chunks(section_ids, processing_version)
        .values("chunk_type")
        .annotate(total=Count("id"))
    )
    return [(row["chunk_type"], row["total"]) for row in rows]


def _chunks(section_ids: list[str], processing_version: str):
    """Фрагменты раздела ОДНОГО прогона обработки.

    Без фильтра по версии в выборку попадает смесь старой и новой индексации
    книги: страницы те же, тексты разные, и профиль получается по материалу,
    которого в текущем документе уже нет.
    """
    queryset = KnowledgeChunk.objects.filter(section_id__in=section_ids)
    if processing_version:
        queryset = queryset.filter(processing_version=processing_version)
    return queryset


def build_context(
    section: DocumentSection,
    *,
    processing_version: str = "",
    budget: int = CONTEXT_CHAR_BUDGET,
) -> str:
    """Представительная выжимка текста раздела без решений."""
    chunks = list(
        _chunks(descendant_ids(section), processing_version)
        .exclude(chunk_type__in=EXCLUDED_TYPES)
        .order_by("page_start", "id")
        .values_list("chunk_type", "normalized_text")
    )
    if not chunks:
        return ""

    selected = _select(chunks, budget=budget)
    parts = [f"[{chunk_type}] {text.strip()}" for chunk_type, text in selected if text]
    return "\n\n".join(parts)[:budget]


def _select(chunks: list[tuple[str, str]], *, budget: int) -> list[tuple[str, str]]:
    """Начало раздела целиком, дальше — равномерно, пока хватает бюджета."""
    head = chunks[:HEAD_CHUNKS]
    used = sum(len(text or "") for _, text in head)
    tail = chunks[HEAD_CHUNKS:]
    if not tail or used >= budget:
        return head

    # Шаг подбирается так, чтобы выборка покрыла раздел до конца, а не
    # оборвалась на середине: середина главы и её конец говорят о материале
    # разное.
    average = max(1, used // max(1, len(head)))
    affordable = max(1, (budget - used) // average)
    step = max(1, len(tail) // affordable)

    for index in range(0, len(tail), step):
        chunk_type, text = tail[index]
        length = len(text or "")
        if used + length > budget:
            break
        head.append((chunk_type, text))
        used += length
    return head
