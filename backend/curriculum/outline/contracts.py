"""Контракты структуры книги.

Здесь описана ФИЗИЧЕСКАЯ структура документа — то, что напечатано в книге, — и
ничего больше. Учебная программа строится позже и из другого материала: узел
оглавления не обязан становиться модулем курса, а его заголовок не обязан
становиться названием темы.

Разделение появилось после разбора живого дефекта: строка «1. Вектор o» из
списка упражнений получала путь `1`, то есть глубину 1, и доезжала до
планировщика как глава наравне с «КИНЕМАТИКОЙ». Причина была в том, что уровень
вычислялся из числа точек в `path`, а `path` выдавался двумя несовместимыми
способами. Поэтому здесь уровень — самостоятельное поле, а не производная от
строки.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class Source:
    """Чем доказано существование узла. Порядок = порядок доверия."""

    PDF_OUTLINE = "pdf_outline"
    EPUB_NAVIGATION = "epub_navigation"
    TABLE_OF_CONTENTS = "table_of_contents"
    BODY_HEADING = "body_heading"
    HEURISTIC = "heuristic"
    MODEL_ASSISTED = "model_assisted"
    MANUAL = "manual"


# Базовая уверенность источника. Закладки PDF и навигация EPUB — это заявление
# издателя, печатное оглавление — заявление книги, заголовок в теле — наша
# догадка о вёрстке, а эвристика по капсу — догадка о догадке.
SOURCE_CONFIDENCE: dict[str, float] = {
    Source.PDF_OUTLINE: 0.99,
    Source.EPUB_NAVIGATION: 0.98,
    Source.TABLE_OF_CONTENTS: 0.90,
    Source.BODY_HEADING: 0.80,
    Source.MODEL_ASSISTED: 0.70,
    Source.HEURISTIC: 0.40,
    Source.MANUAL: 1.0,
}

SOURCE_PRIORITY: tuple[str, ...] = (
    Source.MANUAL,
    Source.PDF_OUTLINE,
    Source.EPUB_NAVIGATION,
    Source.TABLE_OF_CONTENTS,
    Source.BODY_HEADING,
    Source.HEURISTIC,
)


class Role:
    """Педагогическая роль узла. Отдельно от `kind`, который про иерархию."""

    PART = "part"
    CHAPTER = "chapter"
    SECTION = "section"
    SUBSECTION = "subsection"
    INTRODUCTION = "introduction"
    THEORY = "theory"
    WORKED_EXAMPLES = "worked_examples"
    EXERCISE_SET = "exercise_set"
    LABORATORY = "laboratory"
    SUMMARY = "summary"
    ASSESSMENT = "assessment"
    APPENDIX = "appendix"
    REFERENCE = "reference"
    ANSWERS = "answers"
    BIBLIOGRAPHY = "bibliography"
    INDEX = "index"
    FRONT_MATTER = "front_matter"
    UNKNOWN = "unknown"


ALL_ROLES: tuple[str, ...] = tuple(
    value
    for name, value in vars(Role).items()
    if not name.startswith("_") and isinstance(value, str)
)

# Роли, которые НИКОГДА не становятся учебной единицей. Не удаляются: ответы и
# указатель — часть книги, и ссылаться на них законно. Но программу по ним не
# строят, и в знаменатель покрытия они не идут.
NON_TEACHABLE_ROLES: frozenset[str] = frozenset(
    {
        Role.ANSWERS,
        Role.BIBLIOGRAPHY,
        Role.INDEX,
        Role.FRONT_MATTER,
        Role.REFERENCE,
        # EXERCISE_SET здесь НЕТ намеренно. «Упражнение 8» — это учебная работа,
        # и в книге оно завершает главу наравне с параграфами; без него план не
        # совпадает с оглавлением. А вот ANSWERS остаётся: готовые ответы как
        # шаг программы означают, что тьютор может выдать их до попытки решения.
    }
)


@dataclass
class OutlineNode:
    """Узел структуры книги до записи в БД.

    `printed_page` — номер, НАПЕЧАТАННЫЙ в книге; `start_page` — номер страницы
    PDF. Они почти никогда не совпадают: у Мякишева печатная 3 — это PDF 4.
    Путать их означает открывать ученику не ту страницу.
    """

    title: str
    level: int
    role: str = Role.UNKNOWN
    number_label: str = ""
    printed_page: int | None = None
    start_page: int = 0
    end_page: int = 0
    source: str = Source.HEURISTIC
    confidence: float = 0.0
    verified: bool = False
    is_teachable: bool = True
    # Строка оглавления БЕЗ номера страницы и без номера параграфа — заголовок,
    # под которым идут записи: «Глава 1», «Кинематика». Решение принимается при
    # разборе строки и дальше не пересчитывается: вывод «нет страницы — значит
    # контейнер» ошибался на параграфах, чей номер не удалось прочитать, и
    # превращал их в главы.
    is_container: bool = False
    order_index: int = 0
    parent_index: int | None = None
    signals: list[str] = field(default_factory=list)

    @property
    def has_page(self) -> bool:
        return self.printed_page is not None


@dataclass
class Outline:
    """Результат построения структуры: узлы плюс то, чем они доказаны."""

    nodes: list[OutlineNode] = field(default_factory=list)
    source: str = Source.HEURISTIC
    confidence: float = 0.0
    page_offset: int | None = None
    signals: list[str] = field(default_factory=list)

    def teachable(self) -> list[OutlineNode]:
        return [n for n in self.nodes if n.is_teachable]
