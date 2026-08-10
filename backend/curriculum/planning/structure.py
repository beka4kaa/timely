"""Скелет плана: модули и темы строятся из оглавления, а не выбираются моделью.

Раньше модель получала полторы сотни разделов с уровнями и сама решала, что
считать модулем. По «Механике» Мякишева она выбрала уровень частей: пять
модулей («Кинематика», «Динамика», …), внутри — по несколько тем, каждая из
которых на самом деле глава. Все 129 параграфов книги в план не попали ни разу.

Просьбой в промпте это не чинится, и дело даже не в послушности модели: 129 тем
по двенадцати обязательным полям строгой схемы — это около 23 тысяч токенов
ответа при потолке в восемь. Полный план физически не помещается в один вызов.

Поэтому уровень иерархии выбирает backend:

    модуль  = учебный раздел уровня 2 (глава книги)
    тема    = учебный раздел уровня 3 под ней (параграф)
    порядок = порядок книги

Глава не может потеряться, потому что модуль — не решение модели, а строка
оглавления. Модель отвечает за смысл: цели, сложность, критерии освоения
(`planning/enrichment.py`). Это тот же раздел ответственности, что в `CLAUDE.md`
§3.3 — выбор уровня иерархии относится к правилам, а не к смыслу.

Модуль без единого учебного параграфа не выбрасывается: глава, у которой в
оглавлении нет вложенных записей, становится модулем с одной темой из себя
самой. Пустой модуль в интерфейсе выглядит как потерянный материал.
"""

from __future__ import annotations

from .contracts import ProposedModule, ProposedTopic, TocEntry

# Уровни книги. Часть (1) — контейнер над главами, в план как модуль не идёт:
# «Кинематика» это не программа, а корешок раздела.
CHAPTER_LEVEL = 2
SECTION_LEVEL = 3


def build_skeleton(toc: tuple[TocEntry, ...] | list[TocEntry]) -> list[ProposedModule]:
    """Оглавление → модули с темами. Без сети, без модели, без базы."""
    entries = list(toc)
    chapters = [e for e in entries if e.level == CHAPTER_LEVEL]
    if not chapters:
        # Плоская книга без глав: модулями становится верхний уровень.
        top = min((e.level for e in entries), default=CHAPTER_LEVEL)
        chapters = [e for e in entries if e.level == top]

    chapter_ids = {c.section_id for c in chapters if c.section_id}
    by_id = {e.section_id: e for e in entries if e.section_id}
    sections_by_parent: dict[str, list[TocEntry]] = {}
    for entry in entries:
        if entry.section_id in chapter_ids:
            continue
        parent = _owning_chapter(entry, by_id, chapter_ids)
        if parent:
            sections_by_parent.setdefault(parent, []).append(entry)

    modules: list[ProposedModule] = []
    for index, chapter in enumerate(chapters, start=1):
        sections = sections_by_parent.get(chapter.section_id, [])
        topics = [
            _topic(entry, external_id=f"m{index}-t{position}")
            for position, entry in enumerate(sections, start=1)
        ]
        if not topics:
            # Глава без вложенных записей — сама себе тема.
            topics = [_topic(chapter, external_id=f"m{index}-t1")]
        modules.append(
            ProposedModule(
                external_id=f"m{index}",
                title=_module_title(chapter),
                objective="",
                topics=topics,
            )
        )
    return modules


def _owning_chapter(
    entry: TocEntry, by_id: dict[str, TocEntry], chapter_ids: set[str]
) -> str:
    """Глава, которой принадлежит раздел.

    Родитель может оказаться подпунктом внутри главы, поэтому поднимаемся,
    пока не упрёмся в главу: тема должна попасть в модуль, а не потеряться на
    третьем уровне вложенности.
    """
    current = entry
    for _ in range(8):  # книг с восемью уровнями вложенности не бывает
        if current.section_id in chapter_ids:
            return current.section_id
        parent = by_id.get(current.parent_section_id)
        if parent is None:
            return ""
        current = parent
    return ""


def _module_title(chapter: TocEntry) -> str:
    """«Глава 3. Силы в механике» — номер помогает сверяться с книгой."""
    label = (chapter.number_label or "").strip(" .")
    title = chapter.title.strip()
    if label and not title.lower().startswith(label.lower()):
        return f"{label}. {title}"
    return title or chapter.path


def _topic(entry: TocEntry, *, external_id: str) -> ProposedTopic:
    return ProposedTopic(
        external_id=external_id,
        title=entry.title.strip() or entry.path,
        # Заполняется обогащением; при отказе вызова остаётся детерминированная
        # формулировка, а не пустая строка.
        objective=f"Разобраться в теме «{entry.title.strip()}»",
        # Считается по объёму материала в `_persist_plan`; модель к длительности
        # отношения не имеет.
        estimated_minutes=0,
        # Провенанс точный: тема — это раздел книги, а не догадка модели о том,
        # из чего она собрана.
        source_section_ids=[entry.section_id] if entry.section_id else [],
    )
