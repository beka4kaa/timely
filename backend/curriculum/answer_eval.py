"""Насколько ответ попадает в книгу — по эталону, без модели-судьи.

Recall@10 меряет поиск, а ученик видит ответ. Между ними есть зазор: найти
нужный раздел мало, его надо ещё донести до модели и получить ссылку именно на
него.

Судьи здесь нет намеренно. Вторая модель добавила бы собственную ошибку поверх
измеряемой и собственную стоимость; обе метрики ниже считаются сравнением с
размеченными разделами, то есть арифметикой.
"""

from __future__ import annotations

from dataclasses import dataclass, field


def normalize_path(path: str) -> str:
    """Путь раздела в сравнимом виде.

    Эталон пишет человек, и «§ 3.13», «§3.13» и «3.13» означают одно и то же.
    Без нормализации метрика мерила бы аккуратность разметки, а не поиск.
    """
    return "".join(ch for ch in (path or "").lower() if ch.isalnum() or ch == ".")


@dataclass
class AnswerCase:
    """Один размеченный вопрос и то, что по нему ответила система."""

    query: str
    #: Разделы, где по мнению эталона лежит ответ.
    relevant_section_paths: frozenset[str]
    #: Разделы, на которые сослался ответ.
    cited_section_paths: tuple[str, ...] = ()
    #: Модель ответила «в книге этого нет».
    outside_book: bool = False

    @property
    def cited_correctly(self) -> bool:
        """Хотя бы одна цитата попала в размеченный раздел."""
        if not self.relevant_section_paths:
            return False
        expected = {normalize_path(path) for path in self.relevant_section_paths}
        return any(
            normalize_path(path) in expected for path in self.cited_section_paths
        )

    @property
    def falsely_outside(self) -> bool:
        """Сказала «в книге нет», хотя эталон говорит, что раздел есть.

        Прямой признак того, что поиск не донёс материал до модели: сама книга
        ответ содержит.
        """
        return self.outside_book and bool(self.relevant_section_paths)


@dataclass
class AnswerReport:
    total: int = 0
    cited_correctly: int = 0
    falsely_outside: int = 0
    without_citations: int = 0
    cases: list[AnswerCase] = field(default_factory=list)

    @property
    def citation_hit_rate(self) -> float:
        return self.cited_correctly / self.total if self.total else 0.0

    @property
    def false_outside_rate(self) -> float:
        return self.falsely_outside / self.total if self.total else 0.0

    def as_dict(self) -> dict:
        return {
            "questions": self.total,
            "citation_hit_rate": round(self.citation_hit_rate, 4),
            "false_outside_rate": round(self.false_outside_rate, 4),
            "without_citations": self.without_citations,
        }

    def misses(self) -> list[AnswerCase]:
        """Вопросы, на которых система промахнулась. С них и начинают разбор."""
        return [case for case in self.cases if not case.cited_correctly]


def score_answers(cases: list[AnswerCase]) -> AnswerReport:
    report = AnswerReport(total=len(cases), cases=list(cases))
    for case in cases:
        if case.cited_correctly:
            report.cited_correctly += 1
        if case.falsely_outside:
            report.falsely_outside += 1
        if not case.cited_section_paths:
            report.without_citations += 1
    return report
