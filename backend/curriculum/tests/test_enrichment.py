"""Обогащение главы: модель заполняет смысл, но не меняет состав плана.

Ключевое свойство, ради которого всё и переделано: что бы ни вернула модель,
число модулей и тем остаётся тем, которое построило оглавление.
"""

from __future__ import annotations

from django.test import SimpleTestCase

from curriculum.planning.contracts import TocEntry
from curriculum.retrieval import RetrievalBundle
from curriculum.planning.enrichment import (
    ChapterEnrichment,
    ChapterRequest,
    FakeChapterEnrichmentProvider,
    apply_enrichment,
    parse_enrichment_response,
)
from curriculum.planning.providers import SkeletonCoursePlanningProvider
from curriculum.planning.structure import build_skeleton

from .test_structure import chapter, section


def book(chapters: int = 3, per_chapter: int = 4) -> list[TocEntry]:
    toc: list[TocEntry] = []
    for c in range(1, chapters + 1):
        toc.append(chapter(f"ch{c}", f"Глава {c}", label=f"Глава {c}"))
        for s in range(1, per_chapter + 1):
            toc.append(
                section(
                    f"s{c}-{s}",
                    f"Параграф {c}.{s}",
                    parent=f"ch{c}",
                    label=f"§ {c}.{s}",
                )
            )
    return toc


def request_for(module, toc):
    return ChapterRequest(
        module=module,
        chapter=None,
        entries_by_section={e.section_id: e for e in toc},
    )


class ApplyEnrichmentTests(SimpleTestCase):
    def setUp(self):
        self.toc = book(chapters=1, per_chapter=3)
        self.module = build_skeleton(self.toc)[0]

    def test_поля_переносятся(self):
        first = self.module.topics[0]
        apply_enrichment(
            self.module,
            ChapterEnrichment(
                objective="Освоить кинематику",
                completion_criteria="Все темы усвоены",
                topics={
                    first.external_id: {
                        "objective": "Находить скорость",
                        "difficulty": "hard",
                        "mastery_criteria": "Решает сам",
                        "review_strategy": "spaced",
                    }
                },
            ),
        )
        self.assertEqual(self.module.objective, "Освоить кинематику")
        self.assertEqual(first.objective, "Находить скорость")
        self.assertEqual(first.difficulty, "hard")

    def test_состав_плана_не_меняется(self):
        """Модель прислала лишние темы — их не должно появиться в плане."""
        before = [t.external_id for t in self.module.topics]
        apply_enrichment(
            self.module,
            ChapterEnrichment(
                topics={
                    "чужая-1": {"objective": "Выдуманная тема"},
                    "чужая-2": {"objective": "И ещё одна"},
                }
            ),
        )
        self.assertEqual([t.external_id for t in self.module.topics], before)

    def test_тема_без_ответа_модели_сохраняет_свои_значения(self):
        second = self.module.topics[1]
        original = second.objective
        apply_enrichment(
            self.module,
            ChapterEnrichment(
                topics={self.module.topics[0].external_id: {"objective": "Первая"}}
            ),
        )
        self.assertEqual(second.objective, original)

    def test_чужие_prerequisites_отбрасываются(self):
        """Иначе в графе зависимостей появится висячее ребро."""
        first, second = self.module.topics[0], self.module.topics[1]
        apply_enrichment(
            self.module,
            ChapterEnrichment(
                topics={
                    second.external_id: {
                        "prerequisites": [first.external_id, "из-другой-главы"]
                    }
                }
            ),
        )
        self.assertEqual(second.prerequisites, [first.external_id])

    def test_тема_не_зависит_от_себя(self):
        first = self.module.topics[0]
        apply_enrichment(
            self.module,
            ChapterEnrichment(
                topics={first.external_id: {"prerequisites": [first.external_id]}}
            ),
        )
        self.assertEqual(first.prerequisites, [])

    def test_пустое_обогащение_ничего_не_ломает(self):
        before = [(t.external_id, t.objective) for t in self.module.topics]
        apply_enrichment(self.module, ChapterEnrichment())
        self.assertEqual(
            [(t.external_id, t.objective) for t in self.module.topics], before
        )


class ParseResponseTests(SimpleTestCase):
    def test_разбор_обычного_ответа(self):
        raw = """{"objective":"Освоить главу","completion_criteria":"Всё усвоено",
        "milestone":"Контрольная","topics":[{"external_id":"m1-t1",
        "objective":"Находить работу","difficulty":"hard",
        "theory_practice_balance":"practice","mastery_criteria":"Решает сам",
        "review_strategy":"spaced","prerequisites":[]}]}"""

        result = parse_enrichment_response(raw, model="m")

        self.assertEqual(result.objective, "Освоить главу")
        self.assertEqual(result.topics["m1-t1"]["difficulty"], "hard")
        self.assertEqual(result.topics["m1-t1"]["theory_practice_balance"], "practice")

    def test_мусор_даёт_пустое_обогащение(self):
        result = parse_enrichment_response("не json", model="m")
        self.assertEqual(result.topics, {})
        self.assertEqual(result.objective, "")

    def test_незнакомые_enum_значения_отбрасываются(self):
        """Пустая строка означает «оставить значение скелета»."""
        raw = '{"topics":[{"external_id":"m1-t1","difficulty":"очень сложно"}]}'
        result = parse_enrichment_response(raw, model="m")
        self.assertEqual(result.topics["m1-t1"]["difficulty"], "")

    def test_тема_без_идентификатора_игнорируется(self):
        raw = '{"topics":[{"objective":"Без внешнего id"}]}'
        self.assertEqual(parse_enrichment_response(raw, model="m").topics, {})


class SkeletonProviderTests(SimpleTestCase):
    def test_план_повторяет_структуру_книги(self):
        toc = book(chapters=9, per_chapter=14)
        plan = SkeletonCoursePlanningProvider().generate_plan(
            _request(toc), RetrievalBundle()
        )
        self.assertEqual(len(plan.modules), 9)
        self.assertEqual(len(plan.all_topics()), 126)

    def test_отказ_обогащения_не_уменьшает_план(self):
        """То, ради чего обогащение вынесено в отдельные вызовы по главам."""

        class Broken:
            name = "broken"

            def enrich(self, request):
                raise RuntimeError("провайдер лёг")

        toc = book(chapters=4, per_chapter=5)
        plan = SkeletonCoursePlanningProvider(
            enrichment_provider=Broken()
        ).generate_plan(_request(toc), RetrievalBundle())

        self.assertEqual(len(plan.modules), 4)
        self.assertEqual(len(plan.all_topics()), 20)
        # Цели остались детерминированными, а не пустыми.
        self.assertTrue(all(t.objective for t in plan.all_topics()))

    def test_отказ_на_одной_главе_не_трогает_остальные(self):
        class Flaky:
            name = "flaky"

            def enrich(self, request):
                if request.module.title == "Глава 2":
                    raise RuntimeError("не повезло")
                return FakeChapterEnrichmentProvider().enrich(request)

        toc = book(chapters=3, per_chapter=3)
        plan = SkeletonCoursePlanningProvider(
            enrichment_provider=Flaky()
        ).generate_plan(_request(toc), RetrievalBundle())

        by_title = {m.title: m for m in plan.modules}
        self.assertTrue(by_title["Глава 1"].objective)
        self.assertTrue(by_title["Глава 3"].objective)
        self.assertEqual(len(by_title["Глава 2"].topics), 3)

    def test_обогащение_вызывается_по_разу_на_главу(self):
        class Counting:
            name = "counting"

            def __init__(self):
                self.seen: list[str] = []

            def enrich(self, request):
                self.seen.append(request.module.title)
                return FakeChapterEnrichmentProvider().enrich(request)

        provider = Counting()
        toc = book(chapters=5, per_chapter=3)
        SkeletonCoursePlanningProvider(enrichment_provider=provider).generate_plan(
            _request(toc), RetrievalBundle()
        )
        self.assertEqual(sorted(provider.seen), [f"Глава {i}" for i in range(1, 6)])

    def test_главы_обогащаются_параллельно(self):
        """Регресс: один и тот же ContextVar-контекст на все потоки.

        `copy_context()` снимался один раз на весь прогон, и второй поток,
        войдя в тот же объект, получал «cannot enter context: … is already
        entered». Планировщик падал целиком — не одна глава, а весь план.

        Барьер заставляет потоки пересечься гарантированно: без него ошибка
        зависит от того, успел ли первый поток выйти из контекста.
        """
        import threading

        workers = SkeletonCoursePlanningProvider.max_concurrency
        barrier = threading.Barrier(workers, timeout=5)

        class Overlapping:
            name = "overlapping"

            def enrich(self, request):
                barrier.wait()
                return FakeChapterEnrichmentProvider().enrich(request)

        toc = book(chapters=workers, per_chapter=2)
        plan = SkeletonCoursePlanningProvider(
            enrichment_provider=Overlapping()
        ).generate_plan(_request(toc), RetrievalBundle())

        self.assertEqual(len(plan.modules), workers)
        self.assertTrue(all(m.objective for m in plan.modules))

    def test_каждая_тема_привязана_к_разделу(self):
        toc = book(chapters=3, per_chapter=4)
        plan = SkeletonCoursePlanningProvider().generate_plan(
            _request(toc), RetrievalBundle()
        )
        for topic in plan.all_topics():
            self.assertEqual(len(topic.source_section_ids), 1)


def _request(toc):
    from curriculum.planning.contracts import BookMetadata, CoursePlanningRequest

    return CoursePlanningRequest(
        goal_text="механика с нуля",
        normalized_subject="физика",
        normalized_direction="механика",
        current_level="school_basic",
        target_level="school_confident",
        language="ru",
        theory_practice_balance="balanced",
        desired_finish_date=None,
        book=BookMetadata(title="Механика", authors=("Мякишев",), language="ru"),
        toc=tuple(toc),
        available_chunk_ids=(),
        available_section_ids=tuple(e.section_id for e in toc),
    )
