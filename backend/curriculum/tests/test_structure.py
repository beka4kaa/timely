"""Скелет плана строится из оглавления и не может потерять главу.

Тесты без базы и без сети: `build_skeleton` — чистая функция. Проверяется не
«вернулось 12 модулей», а свойства, ради которых структуру забрали у модели:
каждая глава становится модулем, каждый учебный параграф — темой, ничего не
исчезает и ничего не дублируется.
"""

from __future__ import annotations

from django.test import SimpleTestCase

from curriculum.planning.contracts import TocEntry
from curriculum.planning.structure import build_skeleton


def part(sid, title):
    return TocEntry(
        path=sid, title=title, page_start=1, page_end=500, level=1, role="part",
        section_id=sid,
    )


def chapter(sid, title, *, parent="", label=""):
    return TocEntry(
        path=label or sid, title=title, page_start=1, page_end=40, level=2,
        role="chapter", section_id=sid, parent_section_id=parent, number_label=label,
    )


def section(sid, title, *, parent, label="", level=3, page=1):
    return TocEntry(
        path=label or sid, title=title, page_start=page, page_end=page + 2, level=level,
        role="section", section_id=sid, parent_section_id=parent, number_label=label,
    )


class SkeletonTests(SimpleTestCase):
    def _book(self, chapters: int = 3, per_chapter: int = 5):
        """Книга: часть → главы → параграфы."""
        toc = [part("p1", "Кинематика")]
        for c in range(1, chapters + 1):
            toc.append(chapter(f"ch{c}", f"Глава {c}", parent="p1", label=f"Глава {c}"))
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

    def test_каждая_глава_становится_модулем(self):
        """То, чего не было: по «Механике» план давал 5 модулей на 9 глав."""
        modules = build_skeleton(self._book(chapters=9))
        self.assertEqual(len(modules), 9)

    def test_каждый_параграф_становится_темой(self):
        modules = build_skeleton(self._book(chapters=3, per_chapter=7))
        self.assertEqual(sum(len(m.topics) for m in modules), 21)

    def test_части_книги_модулями_не_становятся(self):
        """«Кинематика» — корешок раздела, а не программа."""
        titles = {m.title for m in build_skeleton(self._book())}
        self.assertNotIn("Кинематика", titles)

    def test_порядок_книги_сохраняется(self):
        modules = build_skeleton(self._book(chapters=4))
        self.assertEqual(
            [m.title for m in modules],
            ["Глава 1", "Глава 2", "Глава 3", "Глава 4"],
        )

    def test_каждая_тема_ссылается_на_свой_раздел(self):
        """Провенанс точный: тема — это раздел книги, а не догадка модели."""
        modules = build_skeleton(self._book(chapters=2, per_chapter=3))
        for module in modules:
            for topic in module.topics:
                self.assertEqual(len(topic.source_section_ids), 1)

    def test_разделы_не_дублируются_между_модулями(self):
        modules = build_skeleton(self._book(chapters=3, per_chapter=4))
        used = [sid for m in modules for t in m.topics for sid in t.source_section_ids]
        self.assertEqual(len(used), len(set(used)))

    def test_внешние_идентификаторы_уникальны(self):
        """Иначе `topics_by_external` молча схлопнет темы при сохранении."""
        modules = build_skeleton(self._book(chapters=3, per_chapter=4))
        ids = [t.external_id for m in modules for t in m.topics]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len({m.external_id for m in modules}), len(modules))

    def test_номер_главы_попадает_в_название(self):
        modules = build_skeleton(
            [chapter("ch1", "Силы в механике", label="Глава 3")]
        )
        self.assertEqual(modules[0].title, "Глава 3. Силы в механике")

    def test_номер_не_дублируется_если_уже_в_названии(self):
        modules = build_skeleton(
            [chapter("ch1", "Глава 3. Силы в механике", label="Глава 3")]
        )
        self.assertEqual(modules[0].title, "Глава 3. Силы в механике")

    def test_глава_без_параграфов_сама_себе_тема(self):
        """Пустой модуль читается как потерянный материал."""
        modules = build_skeleton([chapter("ch1", "Статика", label="Глава 8")])
        self.assertEqual(len(modules), 1)
        self.assertEqual(len(modules[0].topics), 1)
        self.assertEqual(modules[0].topics[0].source_section_ids, ["ch1"])

    def test_вложенный_подпункт_попадает_в_модуль_своей_главы(self):
        """Родитель может быть не главой, а пунктом внутри неё."""
        toc = [
            chapter("ch1", "Глава 1", label="Глава 1"),
            section("s1", "Параграф", parent="ch1", label="§ 1.1"),
            section("s1a", "Подпункт", parent="s1", label="§ 1.1.1", level=4),
        ]
        modules = build_skeleton(toc)
        sources = [sid for t in modules[0].topics for sid in t.source_section_ids]
        self.assertEqual(sources, ["s1", "s1a"])

    def test_плоская_книга_без_глав(self):
        """Модулями становится верхний уровень, а не пустота."""
        toc = [
            TocEntry(path="1", title="Первая", page_start=1, page_end=10, level=1,
                     section_id="a"),
            TocEntry(path="2", title="Вторая", page_start=11, page_end=20, level=1,
                     section_id="b"),
        ]
        modules = build_skeleton(toc)
        self.assertEqual([m.title for m in modules], ["Первая", "Вторая"])

    def test_пустое_оглавление_даёт_пустой_план(self):
        self.assertEqual(build_skeleton([]), [])

    def test_длительность_остаётся_за_backend_ом(self):
        """Скелет не выдумывает минуты: их считает `estimate_topic_minutes`."""
        modules = build_skeleton(self._book(chapters=2))
        for module in modules:
            for topic in module.topics:
                self.assertEqual(topic.estimated_minutes, 0)

    def test_цель_темы_заполнена_даже_без_модели(self):
        """Обогащение может не сработать — тема не должна остаться пустой."""
        modules = build_skeleton(self._book(chapters=1, per_chapter=1))
        self.assertIn("Параграф 1.1", modules[0].topics[0].objective)
