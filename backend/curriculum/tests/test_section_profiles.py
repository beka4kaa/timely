"""Профилирование разделов: кэш, выбор разделов и утечка решений.

Сеть не задействована: по умолчанию `get_profiling_provider` возвращает fake,
а там, где нужно посчитать вызовы, подставляется счётчик.
"""

from __future__ import annotations

from django.test import TestCase

from curriculum.models import (
    Document,
    DocumentSection,
    KnowledgeChunk,
    SectionProfile,
)
from curriculum.profiles.context import (
    EXCLUDED_TYPES,
    build_context,
    collect_statistics,
    descendant_ids,
)
from curriculum.profiles.contracts import (
    MAX_CONCEPTS,
    ProfileResult,
    ProfilingRequest,
)
from curriculum.profiles.providers import (
    FakeSectionProfilingProvider,
    parse_profile_response,
)
from curriculum.services.section_profiles import (
    LARGE_CHAPTER_PAGES,
    compute_content_hash,
    profile_document_sections,
    sections_to_profile,
)

OWNER = "student@timelyplan.me"


def document(title="Механика") -> Document:
    return Document.objects.create(user_email=OWNER, title=title)


def section(doc, *, path, title, level, start, end, parent=None, teachable=True):
    return DocumentSection.objects.create(
        document=doc,
        path=path,
        title=title,
        level=level,
        start_page=start,
        end_page=end,
        parent=parent,
        is_teachable=teachable,
        order_index=DocumentSection.objects.filter(document=doc).count(),
    )


def chunk(doc, sec, text="Работа силы равна произведению.", **kwargs):
    kwargs.setdefault("content_hash", "a" * 64)
    return KnowledgeChunk.objects.create(
        document_id=doc.pk,
        section_id=sec.pk,
        normalized_text=text,
        **kwargs,
    )


class CountingProvider:
    """Fake со счётчиком: сколько разделов реально ушло в модель."""

    name = "counting"

    def __init__(self):
        self.calls: list[str] = []
        self._inner = FakeSectionProfilingProvider()

    def profile(self, request: ProfilingRequest) -> ProfileResult:
        self.calls.append(request.section_id)
        return self._inner.profile(request)


class ContextTests(TestCase):
    def test_решения_не_попадают_в_контекст(self):
        """Главное свойство модуля.

        Профиль уходит в планировщик, планировщик — в описание темы, описание
        ученик видит до того, как взялся за задачу. Решение в контексте
        превращает самостоятельную работу в списывание.
        """
        doc = document()
        sec = section(doc, path="1", title="Работа", level=2, start=1, end=4)
        chunk(doc, sec, text="Теория работы силы.")
        chunk(
            doc,
            sec,
            text="Ответ: A = 42 Дж, потому что сила равна 7 Н.",
            chunk_type=KnowledgeChunk.ChunkType.SOLUTION,
            content_hash="b" * 64,
        )

        context = build_context(sec)

        self.assertIn("Теория работы силы", context)
        self.assertNotIn("42 Дж", context)

    def test_решение_исключается_по_типу_а_не_по_тексту(self):
        self.assertIn(KnowledgeChunk.ChunkType.SOLUTION, EXCLUDED_TYPES)

    def test_контекст_главы_собирается_из_её_параграфов(self):
        """У главы своего текста обычно нет — он в параграфах."""
        doc = document()
        chapter = section(doc, path="1", title="Законы", level=2, start=1, end=20)
        para = section(
            doc, path="1.1", title="Импульс", level=3, start=1, end=8, parent=chapter
        )
        chunk(doc, para, text="Импульсом называется произведение массы на скорость.")

        context = build_context(chapter)

        self.assertIn("Импульсом называется", context)

    def test_вложенность_обходится_на_любую_глубину(self):
        doc = document()
        part = section(doc, path="I", title="Часть", level=1, start=1, end=40)
        chapter = section(
            doc, path="1", title="Глава", level=2, start=1, end=20, parent=part
        )
        para = section(
            doc, path="1.1", title="Пункт", level=3, start=1, end=8, parent=chapter
        )

        ids = descendant_ids(part)

        self.assertEqual(
            set(ids), {str(part.pk), str(chapter.pk), str(para.pk)}
        )

    def test_бюджет_соблюдается(self):
        doc = document()
        sec = section(doc, path="1", title="Работа", level=2, start=1, end=40)
        for index in range(40):
            chunk(doc, sec, text="я" * 500, content_hash=f"{index:064d}")

        context = build_context(sec, budget=2000)

        self.assertLessEqual(len(context), 2000)

    def test_раздел_без_текста_даёт_пустой_контекст(self):
        doc = document()
        sec = section(doc, path="1", title="Пусто", level=2, start=1, end=2)
        self.assertEqual(build_context(sec), "")

    def test_статистика_считается_по_базе(self):
        doc = document()
        sec = section(doc, path="1", title="Работа", level=2, start=10, end=14)
        chunk(doc, sec, chunk_type=KnowledgeChunk.ChunkType.DEFINITION)
        chunk(doc, sec, chunk_type=KnowledgeChunk.ChunkType.TASK, content_hash="b" * 64)
        chunk(doc, sec, chunk_type=KnowledgeChunk.ChunkType.TASK, content_hash="c" * 64)

        stats = collect_statistics(sec)

        self.assertEqual(stats["pages"], 5)
        self.assertEqual(stats["definitions"], 1)
        self.assertEqual(stats["tasks"], 2)


class SectionSelectionTests(TestCase):
    def test_профилируются_главы_а_не_каждый_параграф(self):
        """Стоимость: 16 вызовов на книгу вместо 158.

        Параграфы маленькой главы планировщик всё равно соберёт в одну тему —
        платить за профиль каждого незачем.
        """
        doc = document()
        chapter = section(doc, path="1", title="Глава", level=2, start=1, end=6)
        for index in range(5):
            section(
                doc,
                path=f"1.{index}",
                title=f"§ {index}",
                level=3,
                start=1 + index,
                end=2 + index,
                parent=chapter,
            )

        selected = sections_to_profile(doc)

        self.assertEqual([s.pk for s in selected], [chapter.pk])

    def test_у_большой_главы_профилируются_параграфы(self):
        doc = document()
        chapter = section(
            doc,
            path="1",
            title="Большая глава",
            level=2,
            start=1,
            end=1 + LARGE_CHAPTER_PAGES + 5,
        )
        para = section(
            doc, path="1.1", title="§ 1", level=3, start=1, end=8, parent=chapter
        )

        selected = {s.pk for s in sections_to_profile(doc)}

        self.assertIn(chapter.pk, selected)
        self.assertIn(para.pk, selected)

    def test_части_книги_не_профилируются(self):
        """Часть на сотню страниц дала бы профиль «здесь про механику»."""
        doc = document()
        part = section(doc, path="I", title="Кинематика", level=1, start=1, end=120)
        chapter = section(
            doc, path="1", title="Глава", level=2, start=1, end=20, parent=part
        )

        selected = {s.pk for s in sections_to_profile(doc)}

        self.assertIn(chapter.pk, selected)
        self.assertNotIn(part.pk, selected)

    def test_в_плоской_книге_профилируется_верхний_уровень(self):
        """Книга без частей: главы лежат на первом уровне."""
        doc = document()
        chapter = section(doc, path="1", title="Глава", level=1, start=1, end=20)

        self.assertEqual([s.pk for s in sections_to_profile(doc)], [chapter.pk])

    def test_неучебные_разделы_не_профилируются(self):
        """За «Ответы» и «Указатель» платить не нужно."""
        doc = document()
        section(doc, path="1", title="Глава", level=2, start=1, end=6)
        section(
            doc, path="2", title="Ответы", level=2, start=7, end=9, teachable=False
        )

        titles = {s.title for s in sections_to_profile(doc)}

        self.assertEqual(titles, {"Глава"})


class ProfilingRunTests(TestCase):
    def setUp(self):
        self.doc = document()
        self.chapter = section(
            self.doc, path="1", title="Работа и мощность", level=2, start=1, end=6
        )
        chunk(self.doc, self.chapter, text="Работой силы называется...")

    def test_профиль_сохраняется(self):
        report = profile_document_sections(self.doc, provider=CountingProvider())

        profile = SectionProfile.objects.get(section=self.chapter)
        self.assertEqual(report.generated, 1)
        self.assertEqual(profile.document_id, self.doc.pk)
        self.assertTrue(profile.content_hash)
        self.assertTrue(profile.concepts)

    def test_повторный_прогон_не_вызывает_модель(self):
        """Ради этого и заведён кэш: второй план по книге бесплатен."""
        profile_document_sections(self.doc, provider=CountingProvider())

        provider = CountingProvider()
        report = profile_document_sections(self.doc, provider=provider)

        self.assertEqual(provider.calls, [])
        self.assertEqual(report.from_cache, 1)
        self.assertEqual(report.generated, 0)

    def test_изменение_текста_сбрасывает_кэш(self):
        profile_document_sections(self.doc, provider=CountingProvider())
        chunk(self.doc, self.chapter, text="Добавили абзац.", content_hash="b" * 64)

        provider = CountingProvider()
        profile_document_sections(self.doc, provider=provider)

        self.assertEqual(provider.calls, [str(self.chapter.pk)])

    def test_профиль_на_раздел_один(self):
        profile_document_sections(self.doc, provider=CountingProvider())
        chunk(self.doc, self.chapter, text="Ещё абзац.", content_hash="c" * 64)
        profile_document_sections(self.doc, provider=CountingProvider())

        self.assertEqual(
            SectionProfile.objects.filter(section=self.chapter).count(), 1
        )

    def test_раздел_без_текста_пропускается(self):
        empty = document("Пустая")
        section(empty, path="1", title="Глава", level=2, start=1, end=4)

        provider = CountingProvider()
        report = profile_document_sections(empty, provider=provider)

        self.assertEqual(provider.calls, [])
        self.assertEqual(report.skipped_empty, 1)

    def test_ошибка_одного_раздела_не_роняет_книгу(self):
        second = section(
            self.doc, path="2", title="Энергия", level=2, start=7, end=12
        )
        chunk(self.doc, second, text="Энергия — способность совершить работу.")

        class Flaky:
            name = "flaky"

            def profile(self, request):
                if request.title == "Энергия":
                    raise RuntimeError("провайдер лёг")
                return FakeSectionProfilingProvider().profile(request)

        report = profile_document_sections(self.doc, provider=Flaky())

        self.assertEqual(report.generated, 1)
        self.assertEqual(report.failed, 1)
        self.assertTrue(SectionProfile.objects.filter(section=self.chapter).exists())

    def test_профиль_может_снять_отметку_teachable(self):
        """Оглавление обещало теорию, а внутри одни ответы."""

        class SaysNotTeachable:
            name = "strict"

            def profile(self, request):
                return ProfileResult(section_id=request.section_id, is_teachable=False)

        profile_document_sections(self.doc, provider=SaysNotTeachable())

        self.chapter.refresh_from_db()
        self.assertFalse(self.chapter.is_teachable)

    def test_хеш_учитывает_версию_промпта(self):
        first = compute_content_hash(
            self.chapter, processing_version="1.3.0", chunk_ids=["a"]
        )
        second = compute_content_hash(
            self.chapter, processing_version="1.4.0", chunk_ids=["a"]
        )
        self.assertNotEqual(first, second)

    def test_порядок_фрагментов_не_меняет_хеш(self):
        """Иначе кэш сбрасывался бы от перестановки строк в выборке."""
        first = compute_content_hash(
            self.chapter, processing_version="1.3.0", chunk_ids=["a", "b"]
        )
        second = compute_content_hash(
            self.chapter, processing_version="1.3.0", chunk_ids=["b", "a"]
        )
        self.assertEqual(first, second)


class ParseResponseTests(TestCase):
    def test_разбор_обычного_ответа(self):
        raw = """{"summary":"О работе силы","concepts":["работа"],
        "skills":["находить работу"],"prerequisites":["сила"],
        "difficulty":"hard","is_teachable":true}"""

        profile = parse_profile_response(raw, section_id="s1", model="m")

        self.assertEqual(profile.concepts, ["работа"])
        self.assertEqual(profile.difficulty, "hard")
        self.assertTrue(profile.is_teachable)

    def test_мусор_даёт_пустой_профиль_а_не_исключение(self):
        profile = parse_profile_response("не json", section_id="s1", model="m")
        self.assertEqual(profile.concepts, [])
        self.assertEqual(profile.difficulty, "medium")

    def test_незнакомая_сложность_понижается_до_medium(self):
        raw = '{"difficulty":"очень сложно","concepts":[],"skills":[]}'
        profile = parse_profile_response(raw, section_id="s1", model="m")
        self.assertEqual(profile.difficulty, "medium")

    def test_списки_обрезаются_по_потолку(self):
        raw = (
            '{"concepts":['
            + ",".join(f'"понятие {i}"' for i in range(40))
            + '],"skills":[],"difficulty":"easy"}'
        )
        profile = parse_profile_response(raw, section_id="s1", model="m")
        self.assertEqual(len(profile.concepts), MAX_CONCEPTS)

    def test_дубликаты_убираются(self):
        raw = '{"concepts":["работа","работа"],"skills":[],"difficulty":"easy"}'
        profile = parse_profile_response(raw, section_id="s1", model="m")
        self.assertEqual(profile.concepts, ["работа"])
