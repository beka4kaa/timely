"""EPUB: определение формата, извлечение структуры, валидация, цитаты.

Ключевое отличие от PDF проверяется прямо: страницы не выдумываются ни на одном
шаге, а носителем локации служит раздел.
"""

import io
import struct
import tempfile
import zipfile
from unittest import mock

from django.test import SimpleTestCase, TestCase

from curriculum import storage as storage_module
from curriculum.epub_extraction import EpubExtractionError, extract_epub
from curriculum.models import Document, DocumentFile
from curriculum.ocr import NullOcrProvider
from curriculum.parsers import (
    FORMAT_EPUB,
    FORMAT_PDF,
    UnsupportedDocumentType,
    detect_format,
    resolve_parser,
)
from curriculum.retrieval import Citation
from curriculum.tests.pdf_fixtures import textbook_pdf
from curriculum.upload_validation import (
    UploadRejected,
    _MAX_EPUB_ENTRIES,
    _MAX_EPUB_ENTRY_BYTES,
    _MAX_EPUB_UNPACKED_BYTES,
    _inspect_epub_stream,
    _validate_epub_sizes,
    looks_like_epub,
    validate_upload,
)
from curriculum.services.ingestion import ingest_document


def build_epub(chapters: list[tuple[str, str]], *, with_nav: bool = True) -> bytes:
    """Минимальный валидный EPUB из пар (имя файла, html).

    Собирается zipfile'ом, а не ebooklib: тест не должен зависеть от того же
    кода, который проверяет, и битые архивы так собрать проще.
    """
    manifest = "".join(
        f'<item id="c{i}" href="{name}" media-type="application/xhtml+xml"/>'
        for i, (name, _) in enumerate(chapters)
    )
    spine = "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
    opf = f"""<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">test</dc:identifier><dc:title>Книга</dc:title>
    <dc:language>ru</dc:language>
  </metadata>
  <manifest>{manifest}</manifest>
  <spine>{spine}</spine>
</package>"""
    container = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        # `mimetype` обязан идти первым и без сжатия — по нему EPUB и опознаётся.
        archive.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("content.opf", opf)
        for name, html in chapters:
            archive.writestr(name, html)
        if with_nav:
            archive.writestr("nav.xhtml", "<html><body><nav><ol><li>Оглавление</li></ol></nav></body></html>")
    return buffer.getvalue()


SIMPLE = build_epub([
    ("c1.xhtml", """<html><body>
        <h1>Кинематика</h1><p>Движение с постоянной скоростью тела.</p>
        <h2>Скорость</h2><p>Определение. Скорость есть отношение пути ко времени.</p>
    </body></html>"""),
])


class FormatDetectionTests(SimpleTestCase):
    def test_epub_опознаётся_по_содержимому(self):
        self.assertEqual(detect_format(SIMPLE), FORMAT_EPUB)
        self.assertTrue(looks_like_epub(SIMPLE))

    def test_pdf_опознаётся_по_содержимому(self):
        self.assertEqual(detect_format(textbook_pdf()), FORMAT_PDF)

    def test_расширению_не_верим(self):
        # `книга.pdf` с EPUB внутри — обычное дело: люди переименовывают файлы.
        parser = resolve_parser(SIMPLE)
        self.assertEqual(parser.format_name, FORMAT_EPUB)

    def test_обычный_zip_не_считается_epub(self):
        # Одного PK\x03\x04 мало: под него подходят docx, jar и любой архив.
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("word/document.xml", "<w:document/>")
        self.assertFalse(looks_like_epub(buffer.getvalue()))
        with self.assertRaises(UnsupportedDocumentType):
            detect_format(buffer.getvalue())

    def test_неизвестный_формат_отклоняется_с_кодом(self):
        with self.assertRaises(UnsupportedDocumentType) as ctx:
            detect_format(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
        self.assertEqual(ctx.exception.code, "unsupported_format")


class EpubStructureTests(SimpleTestCase):
    def test_заголовки_дают_вложенные_разделы(self):
        blocks, sections = extract_epub(build_epub([
            ("c1.xhtml", """<html><body>
                <h1>Кинематика</h1><p>Первый абзац главы.</p>
                <h2>Скорость</h2><p>Про скорость подробно.</p>
                <h3>Средняя</h3><p>Про среднюю скорость.</p>
                <h1>Динамика</h1><p>Второй раздел книги.</p>
            </body></html>"""),
        ]))
        self.assertEqual(
            [(s.path, s.kind) for s in sections],
            [("1", "chapter"), ("1.1", "section"), ("1.1.1", "subsection"), ("2", "chapter")],
        )
        self.assertEqual([b.section_path for b in blocks], ["1", "1.1", "1.1.1", "2"])

    def test_страницы_не_выдумываются(self):
        blocks, sections = extract_epub(SIMPLE)
        self.assertTrue(all(b.page == 0 for b in blocks))
        self.assertTrue(all(s.start_page == 0 and s.end_page == 0 for s in sections))

    def test_порядок_по_spine_а_не_по_именам_файлов(self):
        # Имена подобраны так, что алфавит дал бы обратный порядок.
        blocks, _ = extract_epub(build_epub([
            ("zzz.xhtml", "<html><body><h1>Первая</h1><p>Текст первой главы.</p></body></html>"),
            ("aaa.xhtml", "<html><body><h1>Вторая</h1><p>Текст второй главы.</p></body></html>"),
        ]))
        self.assertEqual(
            [b.text for b in blocks], ["Текст первой главы.", "Текст второй главы."]
        )

    def test_оглавление_скрипты_и_стили_выброшены(self):
        blocks, _ = extract_epub(build_epub([
            ("c1.xhtml", """<html><body>
                <nav><ol><li>Ссылка оглавления</li></ol></nav>
                <script>alert('привет')</script>
                <style>p { color: red }</style>
                <h1>Глава</h1><p>Полезный текст главы.</p>
            </body></html>"""),
        ]))
        texts = " ".join(b.text for b in blocks)
        self.assertIn("Полезный текст", texts)
        for junk in ("Ссылка оглавления", "alert", "color: red"):
            self.assertNotIn(junk, texts)

    def test_маркеры_размечаются_тем_же_кодом_что_и_в_pdf(self):
        blocks, _ = extract_epub(build_epub([
            ("c1.xhtml", """<html><body><h1>Задачи</h1>
                <p>Задача 7. Найдите ускорение бруска на наклонной плоскости.</p>
                <p>Решение. a = g sin alpha по второму закону Ньютона.</p>
            </body></html>"""),
        ]))
        kinds = {b.kind for b in blocks}
        self.assertIn("exercise", kinds)
        self.assertIn("solution", kinds, "решение обязано остаться отдельным блоком")

    def test_книга_без_заголовков_не_падает(self):
        blocks, sections = extract_epub(build_epub([
            ("c1.xhtml", "<html><body><p>Сплошной текст без единого заголовка.</p></body></html>"),
        ]))
        self.assertEqual(len(blocks), 1)
        self.assertEqual(sections, [])
        self.assertEqual(blocks[0].section_path, "")

    def test_пустая_книга_даёт_понятную_ошибку(self):
        with self.assertRaises(EpubExtractionError):
            extract_epub(build_epub([("c1.xhtml", "<html><body></body></html>")]))

    def test_битый_архив_не_роняет_обработку_молча(self):
        with self.assertRaises(EpubExtractionError):
            extract_epub(b"PK\x03\x04application/epub+zip" + b"\x00" * 200)


class EpubUploadValidationTests(TestCase):
    def test_epub_принимается_и_страниц_у_него_ноль(self):
        result = validate_upload(data=SIMPLE, filename="книга.epub")
        self.assertEqual(result.mime_type, "application/epub+zip")
        self.assertEqual(result.page_count, 0)

    def test_чужое_расширение_отклоняется(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_upload(data=SIMPLE, filename="книга.txt")
        self.assertEqual(ctx.exception.code, "bad_extension")

    def test_содержимое_не_совпало_ни_с_одним_форматом(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_upload(data=b"\x89PNG\r\n\x1a\n" + b"0" * 200, filename="a.pdf")
        self.assertEqual(ctx.exception.code, "bad_magic")

    def test_архив_с_выходом_за_свои_пределы_отклоняется(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("mimetype", "application/epub+zip")
            archive.writestr("../../etc/passwd", "root:x:0:0")
        with self.assertRaises(UploadRejected) as ctx:
            validate_upload(data=buffer.getvalue(), filename="a.epub")
        self.assertEqual(ctx.exception.code, "unsafe_archive")

    def test_зип_бомба_отклоняется_до_распаковки(self):
        # Размер объявлен в оглавлении архива, поэтому проверка не требует
        # распаковать ни одного байта.
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            # `mimetype` обязан лежать БЕЗ сжатия — этого требует спецификация
            # EPUB, и по нему формат опознаётся. Сжатый архив отсеялся бы
            # раньше как «не EPUB», и проверка размера до него бы не дошла.
            archive.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
            archive.writestr("bomb.txt", "0" * 20_000_000)
        with self.assertRaises(UploadRejected) as ctx:
            validate_upload(data=buffer.getvalue(), filename="a.epub")
        self.assertEqual(ctx.exception.code, "suspicious_compression")

    def test_eocd_rejects_unsafe_archives_before_zipfile(self):
        def changed_eocd(*changes: tuple[int, str, int]) -> bytes:
            data = bytearray(SIMPLE)
            eocd = data.rfind(b"PK\x05\x06")
            self.assertGreaterEqual(eocd, 0)
            for offset, field_format, value in changes:
                struct.pack_into("<" + field_format, data, eocd + offset, value)
            return bytes(data)

        cases = (
            ("multi_disk", ((4, "H", 1),), "bad_archive"),
            (
                "zip64",
                ((8, "H", 0xFFFF), (10, "H", 0xFFFF)),
                "bad_archive",
            ),
            (
                "too_many_entries",
                (
                    (8, "H", _MAX_EPUB_ENTRIES + 1),
                    (10, "H", _MAX_EPUB_ENTRIES + 1),
                ),
                "suspicious_compression",
            ),
            ("invalid_central_offset", ((16, "L", 0),), "bad_archive"),
            # Заниженный count не должен обойти лимит: структура central
            # directory обязана закончиться ровно после заявленного числа rows.
            (
                "forged_low_entry_count",
                ((8, "H", 1), (10, "H", 1)),
                "bad_archive",
            ),
        )

        for name, changes, expected_code in cases:
            with self.subTest(name=name):
                data = changed_eocd(*changes)
                with mock.patch(
                    "curriculum.upload_validation.zipfile.ZipFile"
                ) as zip_file:
                    with self.assertRaises(UploadRejected) as ctx:
                        _inspect_epub_stream(
                            io.BytesIO(data),
                            archive_size=len(data),
                        )
                self.assertEqual(ctx.exception.code, expected_code)
                zip_file.assert_not_called()

    def test_oversized_mimetype_is_rejected_before_entry_read(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "mimetype",
                b"application/epub+zip" + b"x" * (1024 * 1024),
                zipfile.ZIP_STORED,
            )
        data = buffer.getvalue()

        with mock.patch(
            "curriculum.upload_validation.zipfile.ZipFile.open",
            side_effect=AssertionError("oversized mimetype must not be read"),
        ) as open_entry:
            with self.assertRaises(UploadRejected) as ctx:
                _inspect_epub_stream(io.BytesIO(data), archive_size=len(data))

        self.assertEqual(ctx.exception.code, "bad_archive")
        open_entry.assert_not_called()

    def test_unpacked_size_has_per_entry_and_absolute_caps(self):
        per_entry = zipfile.ZipInfo("huge.xhtml")
        per_entry.file_size = _MAX_EPUB_ENTRY_BYTES + 1
        with self.assertRaises(UploadRejected) as entry_error:
            _validate_epub_sizes([per_entry], archive_size=2 * 1024 * 1024)
        self.assertEqual(entry_error.exception.code, "suspicious_compression")

        # Архив достаточно велик, чтобы ratio 100× сам по себе разрешал этот
        # объём. Отклонить его обязан именно абсолютный cap.
        entries = []
        for index in range(5):
            info = zipfile.ZipInfo(f"chapter-{index}.xhtml")
            info.file_size = _MAX_EPUB_UNPACKED_BYTES // 5 + 1
            entries.append(info)
        with self.assertRaises(UploadRejected) as total_error:
            _validate_epub_sizes(entries, archive_size=2 * 1024 * 1024)
        self.assertEqual(total_error.exception.code, "suspicious_compression")

    def test_pdf_по_прежнему_принимается(self):
        result = validate_upload(data=textbook_pdf(), filename="книга.pdf")
        self.assertEqual(result.mime_type, "application/pdf")


class CitationWithoutPagesTests(SimpleTestCase):
    def test_у_epub_в_цитате_нет_страниц(self):
        citation = Citation(
            document_id="d1", document_title="Механика",
            section_path="7.2", page_start=0, page_end=0,
        )
        rendered = citation.render()
        self.assertIn("§7.2", rendered)
        self.assertNotIn("стр.", rendered)

    def test_у_pdf_страницы_остались(self):
        citation = Citation(
            document_id="d1", document_title="Механика",
            section_path="2.1", page_start=34, page_end=37,
        )
        self.assertIn("стр. 34–37", citation.render())


class EpubEndToEndIngestionTests(TestCase):
    def setUp(self):
        self.storage_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.storage_dir.cleanup)
        storage_module.set_storage(
            storage_module.LocalFileStorage(self.storage_dir.name)
        )
        self.addCleanup(lambda: storage_module.set_storage(None))

    def test_epub_reaches_ready_with_sections_chunks_and_no_fake_pages(self):
        document = Document.objects.create(user_email="a@b.c", title="EPUB")
        key = storage_module.build_storage_key(
            user_email=document.user_email,
            document_id=str(document.pk),
            filename="book.epub",
        )
        storage_module.get_storage().save(key, SIMPLE)
        DocumentFile.objects.create(
            document=document,
            original_filename="book.epub",
            sanitized_filename="book.epub",
            storage_key=key,
            mime_type="application/epub+zip",
            byte_size=len(SIMPLE),
            content_hash=storage_module.content_hash(SIMPLE),
        )

        outcome = ingest_document(document, ocr_provider=NullOcrProvider())

        self.assertTrue(outcome.succeeded)
        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.READY)
        self.assertEqual(document.page_count, 0)
        self.assertGreater(document.sections.count(), 0)
        self.assertGreater(document.chunks.count(), 0)
        self.assertTrue(
            all(chunk.page_start == 0 and chunk.page_end == 0 for chunk in document.chunks.all())
        )
