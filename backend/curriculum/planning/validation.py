"""Строгая проверка предложения модели перед показом ученику.

Модель не является источником истины ни для одного факта в плане. Всё, что она
прислала, проверяется здесь, и только прошедшее проверку доходит до превью.

Разделение серьёзности:

* `blocker` — план нельзя показывать: цикл зависимостей, ссылка на
  несуществующий фрагмент, отрицательная длительность.
* `warning` — план показать можно, но ученик увидит пометку: неполное покрытие
  глав, тема без источника.

Функции чистые: на вход `CoursePlanningResult`, на выход список проблем. Ни
базы, ни сети — иначе валидатор нельзя будет прогнать на benchmark-выдаче.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .contracts import CoursePlanningRequest, CoursePlanningResult

# Публичные: из них же собирается JSON Schema (`planning/schema.py`). Разъехавшись,
# схема начала бы разрешать то, что валидатор запрещает, — и модель получала бы
# отказ за ответ, о котором её сами попросили.
ALLOWED_DIFFICULTY = frozenset({"easy", "medium", "hard"})
ALLOWED_BALANCE = frozenset({"theory", "balanced", "practice"})
ALLOWED_REVIEW = frozenset({"", "spaced", "massed", "interleaved"})

# ── Сопоставление заголовков темы и раздела книги ──
#
# Раньше покрытие считалось ТОЧНЫМ равенством casefold-строк. Живая модель
# перефразирует («§2.1 Кинематика материальной точки» → «Кинематика точки»), и
# метрика показывала 0% на любом осмысленном плане: предупреждение `low_coverage`
# приезжало всегда, а цифра в интерфейсе врала.
#
# Считаем пересечение значимых слов. Порог 0.5 — от МЕНЬШЕГО множества, иначе
# длинный заголовок книги никогда не совпадёт с короткой темой.
_SECTION_NUMBER_RE = re.compile(r"^[\s§]*\d+(?:[.\-]\d+)*[.)]?\s*")
_WORD_RE = re.compile(r"\w+", re.UNICODE)
_TITLE_MATCH_THRESHOLD = 0.5
# Слова, которые несут нагрузку раздела, а не темы: совпадение только по ним не
# означает, что тема покрывает раздел.
_TITLE_STOPWORDS = frozenset(
    {
        "глава", "раздел", "параграф", "часть", "тема", "введение", "заключение",
        "chapter", "section", "part", "unit", "introduction", "conclusion",
        "и", "или", "в", "на", "по", "с", "к", "о", "об", "для", "из", "the", "a", "an",
        "of", "in", "on", "to", "for", "and", "or",
    }
)


def _title_terms(title: str) -> frozenset[str]:
    """Значимые слова заголовка: без номера раздела, регистра и стоп-слов."""
    stripped = _SECTION_NUMBER_RE.sub("", (title or "").strip())
    words = {w.casefold() for w in _WORD_RE.findall(stripped)}
    meaningful = words - _TITLE_STOPWORDS
    # Если после чистки не осталось ничего (заголовок вида «Глава 3»), возвращаем
    # исходные слова: пусть лучше совпадёт по слабому признаку, чем никогда.
    return frozenset(meaningful or words)


def _titles_match(section_terms: frozenset[str], topic_terms: frozenset[str]) -> bool:
    if not section_terms or not topic_terms:
        return False
    overlap = len(section_terms & topic_terms)
    return overlap / min(len(section_terms), len(topic_terms)) >= _TITLE_MATCH_THRESHOLD

# Признаки того, что модель попыталась вернуть не семантику, а разметку.
#
# SQL-слов здесь больше нет. `SELECT ` и `DROP ` отвергали план по «Hands-On
# Machine Learning» целиком: в книге есть разделы «Select a Performance Measure»
# и «Select and Train a Model», а в цели темы «Clean the Data» написано «drop
# rows with missing values». Это обычный английский, а не инъекция.
#
# Защищаться от SQL здесь и незачем: содержимое плана не попадает в сырые
# запросы — ORM параметризует всё сам. Разметка осталась, потому что заголовки
# и цели показываются пользователю.
_FORBIDDEN_MARKERS = ("<script", "</script", "<svg", "foreignObject")


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    severity: str = "blocker"  # blocker | warning
    topic_external_id: str = ""

    @property
    def is_blocker(self) -> bool:
        return self.severity == "blocker"


@dataclass
class ValidationReport:
    issues: list[ValidationIssue] = field(default_factory=list)
    # Метрики, которые ниже переиспользует benchmark.
    topic_count: int = 0
    module_count: int = 0
    hallucinated_source_count: int = 0
    prerequisite_cycle_count: int = 0
    duplicate_topic_count: int = 0
    missing_objective_count: int = 0
    unsourced_topic_count: int = 0
    covered_sections: int = 0
    total_sections: int = 0
    total_minutes: int = 0
    # Доля тем, чьё название дословно совпадает с разделом книги.
    copied_title_ratio: float = 0.0
    # Доля модулей ровно с одной темой.
    single_topic_module_ratio: float = 0.0
    unknown_section_count: int = 0
    # Доля глав книги, представленных в плане хотя бы одной темой. Считается по
    # идентификаторам разделов, а не по совпадению названий: точное число, а не
    # оценка. Именно оно отличает план по всей книге от плана по её пятой части.
    covered_chapters: int = 0
    total_chapters: int = 0

    @property
    def blockers(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.is_blocker]

    @property
    def is_valid(self) -> bool:
        return not self.blockers

    @property
    def coverage_ratio(self) -> float:
        return (self.covered_sections / self.total_sections) if self.total_sections else 0.0

    @property
    def chapter_coverage_ratio(self) -> float:
        return (
            (self.covered_chapters / self.total_chapters)
            if self.total_chapters
            else 0.0
        )

    def add(self, issue: ValidationIssue) -> None:
        self.issues.append(issue)


# Уровень главы в книге. Дублирует `planning.structure.CHAPTER_LEVEL`
# намеренно: импорт связал бы валидатор со сборщиком скелета, а он обязан
# проверять любой план, включая пришедший от одновызывного провайдера.
_CHAPTER_LEVEL = 2


def _owning_chapter_id(entry, toc) -> str:
    """Глава, которой принадлежит раздел. Пусто, если раздел выше главы."""
    by_id = {e.section_id: e for e in toc if e.section_id}
    current = entry
    for _ in range(8):
        if current.level == _CHAPTER_LEVEL:
            return current.section_id
        parent = by_id.get(current.parent_section_id)
        if parent is None:
            return ""
        current = parent
    return ""


def _detect_cycles(edges: dict[str, list[str]]) -> list[list[str]]:
    """Ищет циклы в графе prerequisites обходом в глубину.

    Возвращает найденные циклы, а не просто флаг: ученику и рецензенту нужно
    показать, какая именно цепочка тем закольцована.
    """
    WHITE, GREY, BLACK = 0, 1, 2
    color: dict[str, int] = {node: WHITE for node in edges}
    cycles: list[list[str]] = []
    stack: list[str] = []

    def visit(node: str) -> None:
        color[node] = GREY
        stack.append(node)
        for neighbour in edges.get(node, ()):
            if neighbour not in color:
                continue
            if color[neighbour] == GREY:
                start = stack.index(neighbour)
                cycles.append(stack[start:] + [neighbour])
            elif color[neighbour] == WHITE:
                visit(neighbour)
        stack.pop()
        color[node] = BLACK

    for node in sorted(edges):
        if color.get(node) == WHITE:
            visit(node)
    return cycles


def validate_plan(
    plan: CoursePlanningResult, request: CoursePlanningRequest
) -> ValidationReport:
    """Полная проверка предложения относительно исходного запроса."""
    report = ValidationReport()
    constraints = request.constraints
    allowed_chunks = set(request.available_chunk_ids)

    if not plan.title.strip():
        report.add(ValidationIssue("empty_title", "У курса нет названия."))

    report.module_count = len(plan.modules)
    if not plan.modules:
        report.add(ValidationIssue("no_modules", "План не содержит ни одного модуля."))
    # Размер плана — предупреждение, а не блокер. Толстый учебник честно даёт
    # много модулей, и выбрасывать из-за этого весь план значит оставить ученика
    # ни с чем после нескольких минут ожидания. Опасности в лишнем модуле нет:
    # в отличие от выдуманного источника или цикла зависимостей, он не делает
    # план неверным — он делает его большим, и это видно ученику.
    if len(plan.modules) > constraints.max_modules:
        report.add(
            ValidationIssue(
                "too_many_modules",
                f"Модулей больше рекомендованных {constraints.max_modules}.",
                severity="warning",
            )
        )

    if plan.unknown_fields:
        report.add(
            ValidationIssue(
                "unknown_fields",
                "Модель вернула поля вне схемы: " + ", ".join(plan.unknown_fields[:8]),
                severity="warning",
            )
        )

    allowed_sections = set(request.available_section_ids)
    section_titles = {
        " ".join(_WORD_RE.findall((entry.title or "").casefold()))
        for entry in request.toc
    }

    topics = plan.all_topics()
    report.topic_count = len(topics)

    # ── Насколько план повторяет оглавление ──
    #
    # Оба числа появились, когда состав плана выбирала модель: она отдавала
    # 38 модулей ровно по одной теме, и каждое название совпадало с разделом
    # книги. Теперь структуру задаёт само оглавление
    # (`planning/structure.py`), и совпадение в 100% — это норма, а не регресс.
    #
    # Поэтому метрики остались, а предупреждения по ним ушли: benchmark по ним
    # по-прежнему сравнивает провайдеров, но ученику показывать «программа
    # похожа на переписанное оглавление» больше незачем — она такой и задумана.
    if topics and section_titles:
        copied = sum(
            1
            for topic in topics
            if " ".join(_WORD_RE.findall(topic.title.casefold())) in section_titles
        )
        report.copied_title_ratio = copied / len(topics)

    if plan.modules:
        single = sum(1 for module in plan.modules if len(module.topics) == 1)
        report.single_topic_module_ratio = single / len(plan.modules)
    report.total_minutes = plan.total_minutes()

    # ── Уникальность идентификаторов ──
    seen_topic_ids: set[str] = set()
    for topic in topics:
        if not topic.external_id:
            report.add(
                ValidationIssue(
                    "missing_topic_id", f"У темы «{topic.title}» нет external_id."
                )
            )
        elif topic.external_id in seen_topic_ids:
            report.add(
                ValidationIssue(
                    "duplicate_topic_id",
                    f"external_id «{topic.external_id}» встречается дважды.",
                    topic_external_id=topic.external_id,
                )
            )
        else:
            seen_topic_ids.add(topic.external_id)

    # Одинаковые названия проверяются ВНУТРИ модуля, а не по всему плану.
    # Учебник называет разделы одинаково в каждой главе: у «Hands-On Machine
    # Learning» одиннадцать разделов «Exercises», по одному на главу, и это
    # правильная структура книги, а не ошибка планирования. Две темы с одним
    # названием в одной главе — вот это действительно странно.
    for module in plan.modules:
        seen_in_module: set[str] = set()
        for topic in module.topics:
            normalized_title = topic.title.strip().casefold()
            if not normalized_title:
                continue
            if normalized_title in seen_in_module:
                report.duplicate_topic_count += 1
                report.add(
                    ValidationIssue(
                        "duplicate_topic_title",
                        f"В модуле «{module.title}» тема «{topic.title}» дублируется.",
                        severity="warning",
                        topic_external_id=topic.external_id,
                    )
                )
            seen_in_module.add(normalized_title)

    module_ids: set[str] = set()
    for module in plan.modules:
        if module.external_id in module_ids:
            report.add(
                ValidationIssue(
                    "duplicate_module_id",
                    f"Модуль «{module.external_id}» встречается дважды.",
                )
            )
        module_ids.add(module.external_id)
        if len(module.topics) > constraints.max_topics_per_module:
            report.add(
                ValidationIssue(
                    "too_many_topics",
                    f"В модуле «{module.title}» больше "
                    f"{constraints.max_topics_per_module} тем.",
                    severity="warning",
                )
            )

    # ── Содержимое тем ──
    for topic in topics:
        if not topic.objective.strip():
            report.missing_objective_count += 1
            report.add(
                ValidationIssue(
                    "missing_objective",
                    f"У темы «{topic.title}» не заполнена цель.",
                    topic_external_id=topic.external_id,
                )
            )

        if topic.estimated_minutes <= 0:
            report.add(
                ValidationIssue(
                    "non_positive_duration",
                    f"У темы «{topic.title}» некорректная длительность.",
                    topic_external_id=topic.external_id,
                )
            )
        elif not (
            constraints.min_topic_minutes
            <= topic.estimated_minutes
            <= constraints.max_topic_minutes
        ):
            report.add(
                ValidationIssue(
                    "duration_out_of_range",
                    f"Длительность темы «{topic.title}» вне допустимого диапазона.",
                    severity="warning",
                    topic_external_id=topic.external_id,
                )
            )

        if topic.difficulty not in ALLOWED_DIFFICULTY:
            report.add(
                ValidationIssue(
                    "invalid_difficulty",
                    f"Недопустимая сложность «{topic.difficulty}».",
                    topic_external_id=topic.external_id,
                )
            )
        if topic.theory_practice_balance not in ALLOWED_BALANCE:
            report.add(
                ValidationIssue(
                    "invalid_balance",
                    f"Недопустимый баланс «{topic.theory_practice_balance}».",
                    topic_external_id=topic.external_id,
                )
            )
        if topic.review_strategy not in ALLOWED_REVIEW:
            report.add(
                ValidationIssue(
                    "invalid_review_strategy",
                    f"Недопустимая стратегия повторения «{topic.review_strategy}».",
                    severity="warning",
                    topic_external_id=topic.external_id,
                )
            )

        # ── Provenance: тема обязана быть привязана к книге ──
        #
        # Раздел засчитывается наравне с фрагментом. Тема плана соответствует
        # разделу книги, и это и есть её источник; фрагменты приходят из
        # retrieval-выдачи, ограниченной `PLANNING_MAX_CHUNKS`, и у большинства
        # тем их просто нет. Проверка только по ним помечала «без источника» все
        # 174 темы плана, у каждой из которых раздел был указан.
        if not topic.source_chunk_ids and not topic.source_section_ids:
            report.unsourced_topic_count += 1
            report.add(
                ValidationIssue(
                    "topic_without_source",
                    f"Тема «{topic.title}» не привязана к источнику.",
                    severity="warning",
                    topic_external_id=topic.external_id,
                )
            )
        # Раздел книги проверяется так же строго, как фрагмент: тема,
        # сославшаяся на несуществующий раздел, выглядит подтверждённой, а на
        # деле её содержание неизвестно откуда.
        for section_id in topic.source_section_ids:
            if allowed_sections and section_id not in allowed_sections:
                report.unknown_section_count += 1
                report.add(
                    ValidationIssue(
                        "unknown_source_section",
                        f"Тема «{topic.title}» ссылается на раздел вне книги.",
                        topic_external_id=topic.external_id,
                    )
                )

        for chunk_id in topic.source_chunk_ids:
            if chunk_id not in allowed_chunks:
                report.hallucinated_source_count += 1
                report.add(
                    ValidationIssue(
                        "hallucinated_source",
                        f"Тема «{topic.title}» ссылается на несуществующий "
                        f"фрагмент {chunk_id}.",
                        topic_external_id=topic.external_id,
                    )
                )

        blob = f"{topic.title} {topic.objective} {topic.mastery_criteria}"
        for marker in _FORBIDDEN_MARKERS:
            if marker.lower() in blob.lower():
                report.add(
                    ValidationIssue(
                        "unsafe_content",
                        f"В теме «{topic.title}» небезопасное содержимое.",
                        topic_external_id=topic.external_id,
                    )
                )
                break

    # ── Граф зависимостей ──
    edges: dict[str, list[str]] = {t.external_id: [] for t in topics if t.external_id}
    for topic in topics:
        for prerequisite in topic.prerequisites:
            if prerequisite == topic.external_id:
                report.add(
                    ValidationIssue(
                        "self_prerequisite",
                        f"Тема «{topic.title}» зависит сама от себя.",
                        topic_external_id=topic.external_id,
                    )
                )
                continue
            if prerequisite not in edges:
                report.add(
                    ValidationIssue(
                        "unknown_prerequisite",
                        f"Тема «{topic.title}» ссылается на несуществующую "
                        f"тему «{prerequisite}».",
                        topic_external_id=topic.external_id,
                    )
                )
                continue
            edges[topic.external_id].append(prerequisite)

    cycles = _detect_cycles(edges)
    report.prerequisite_cycle_count = len(cycles)
    for cycle in cycles:
        report.add(
            ValidationIssue(
                "prerequisite_cycle",
                "Циклическая зависимость тем: " + " → ".join(cycle),
            )
        )

    # ── Покрытие книги ──
    report.total_sections = len(request.toc)
    topic_terms = [_title_terms(t.title) for t in topics]
    report.covered_sections = sum(
        1
        for entry in request.toc
        if any(_titles_match(_title_terms(entry.title), terms) for terms in topic_terms)
    )
    if report.total_sections and report.coverage_ratio < 0.5:
        report.add(
            ValidationIssue(
                "low_coverage",
                f"План покрывает лишь {report.coverage_ratio:.0%} разделов книги.",
                severity="warning",
            )
        )

    # ── Покрытие ГЛАВ ──
    #
    # Отдельно от покрытия разделов и по идентификаторам, а не по названиям.
    # Пропущенная глава — это пропущенная часть книги, и заметить её обязан
    # точный счёт: план на пять модулей по книге из девяти глав проходил
    # проверку названий молча, потому что названия у него совпадали.
    chapters = [e for e in request.toc if e.level == _CHAPTER_LEVEL and e.section_id]
    if chapters:
        referenced = {
            section_id for topic in topics for section_id in topic.source_section_ids
        }
        chapter_of = {
            entry.section_id: _owning_chapter_id(entry, request.toc)
            for entry in request.toc
            if entry.section_id
        }
        touched = {chapter_of.get(section_id) for section_id in referenced}
        report.total_chapters = len(chapters)
        report.covered_chapters = sum(1 for c in chapters if c.section_id in touched)
        if report.chapter_coverage_ratio < 1.0:
            missing = [
                c.title for c in chapters if c.section_id not in touched
            ]
            report.add(
                ValidationIssue(
                    "missing_chapters",
                    "В плане нет глав книги: " + ", ".join(missing[:5]),
                    severity="warning",
                )
            )

    for module in plan.modules:
        if not module.topics:
            report.add(
                ValidationIssue(
                    "empty_module",
                    f"Модуль «{module.title}» не содержит ни одной темы.",
                )
            )

    if report.total_minutes > constraints.max_total_minutes:
        report.add(
            ValidationIssue(
                "total_duration_too_large", "Суммарная длительность нереалистична."
            )
        )

    # Сумма по модулю должна сходиться с суммой его тем — иначе превью покажет
    # ученику одно число, а прогноз посчитает по другому.
    for module in plan.modules:
        topics_sum = sum(t.estimated_minutes for t in module.topics)
        if module.estimated_minutes and module.estimated_minutes != topics_sum:
            report.add(
                ValidationIssue(
                    "module_duration_mismatch",
                    f"У модуля «{module.title}» сумма тем не совпадает с заявленной.",
                    severity="warning",
                )
            )

    return report


def topological_order(plan: CoursePlanningResult) -> list[str]:
    """Порядок изучения с учётом prerequisites (для проверки ordering)."""
    topics = plan.all_topics()
    known = {t.external_id for t in topics}
    edges = {t.external_id: set(t.prerequisites) & known for t in topics}
    resolved: list[str] = []
    pending = dict(edges)
    while pending:
        ready = sorted(k for k, deps in pending.items() if not (deps - set(resolved)))
        if not ready:
            break  # остаток закольцован — это уже поймал validate_plan
        resolved.extend(ready)
        for key in ready:
            pending.pop(key)
    return resolved
