"""Загрузка документов: валидация содержимого и безопасность storage."""

import tempfile

from django.test import SimpleTestCase

from curriculum.storage import (
    LocalFileStorage,
    StorageError,
    build_storage_key,
    content_hash,
    sanitize_filename,
)
from curriculum.upload_validation import (
    UploadRejected,
    estimate_page_count,
    is_encrypted_pdf,
    looks_like_pdf,
    looks_like_zip_bomb,
    validate_pdf_upload,
)


def minimal_pdf(pages: int = 2, extra: bytes = b"") -> bytes:
    """Синтетический PDF: заголовок, дерево страниц и трейлер."""
    body = b"%PDF-1.7\n"
    body += b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    body += b"2 0 obj<</Type/Pages/Count " + str(pages).encode() + b">>endobj\n"
    for index in range(pages):
        body += (
            str(index + 3).encode()
            + b" 0 obj<</Type/Page /Parent 2 0 R>>endobj\n"
        )
    body += extra
    body += b"trailer<</Root 1 0 R>>\n%%EOF\n"
    return body


class FilenameSanitizationTests(SimpleTestCase):
    def test_strips_directory_traversal(self):
        self.assertEqual(
            sanitize_filename("../../../etc/passwd"), "passwd"
        )
        self.assertEqual(
            sanitize_filename(r"..\..\windows\system32\evil.pdf"), "evil.pdf"
        )

    def test_removes_control_characters(self):
        self.assertNotIn("\x00", sanitize_filename("bad\x00name.pdf"))

    def test_keeps_readable_cyrillic(self):
        self.assertEqual(
            sanitize_filename("Механика 10 класс.pdf"), "Механика 10 класс.pdf"
        )

    def test_empty_name_falls_back(self):
        self.assertEqual(sanitize_filename("   "), "document.pdf")
        self.assertEqual(sanitize_filename("..."), "document.pdf")

    def test_long_name_is_truncated(self):
        self.assertLessEqual(len(sanitize_filename("a" * 500 + ".pdf")), 180)


class StorageKeyTests(SimpleTestCase):
    def test_key_does_not_contain_raw_email(self):
        key = build_storage_key(
            user_email="Student@Timelyplan.me",
            document_id="doc-1",
            filename="book.pdf",
        )
        self.assertNotIn("Student", key)
        self.assertNotIn("@", key)
        self.assertTrue(key.startswith("documents/"))

    def test_key_is_stable_for_same_owner(self):
        first = build_storage_key(
            user_email="a@b.me", document_id="d1", filename="x.pdf"
        )
        second = build_storage_key(
            user_email="A@B.me", document_id="d1", filename="x.pdf"
        )
        self.assertEqual(first, second)


class LocalStorageTests(SimpleTestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.storage = LocalFileStorage(self._dir.name)

    def test_round_trip(self):
        key = "documents/abc/doc1/book.pdf"
        self.storage.save(key, b"payload")
        self.assertTrue(self.storage.exists(key))
        self.assertEqual(self.storage.open(key), b"payload")

    def test_delete_removes_file(self):
        key = "documents/abc/doc1/book.pdf"
        self.storage.save(key, b"payload")
        self.storage.delete(key)
        self.assertFalse(self.storage.exists(key))

    def test_traversal_key_is_rejected(self):
        for bad in ("../escape.pdf", "documents/../../etc/passwd", "/abs/path"):
            with self.subTest(key=bad):
                with self.assertRaises(StorageError):
                    self.storage.save(bad, b"x")

    def test_missing_file_raises(self):
        with self.assertRaises(StorageError):
            self.storage.open("documents/abc/doc1/absent.pdf")

    def test_signed_url_does_not_leak_filesystem_path(self):
        url = self.storage.signed_url("documents/abc/doc1/book.pdf")
        self.assertNotIn(self._dir.name, url)


class PdfDetectionTests(SimpleTestCase):
    def test_detects_pdf_magic(self):
        self.assertTrue(looks_like_pdf(minimal_pdf()))
        self.assertFalse(looks_like_pdf(b"PK\x03\x04 this is a zip"))

    def test_detects_encryption(self):
        self.assertTrue(is_encrypted_pdf(minimal_pdf(extra=b"/Encrypt 9 0 R\n")))
        self.assertFalse(is_encrypted_pdf(minimal_pdf()))

    def test_counts_pages(self):
        self.assertEqual(estimate_page_count(minimal_pdf(pages=7)), 7)

    def test_detects_disproportionate_streams(self):
        bomb = minimal_pdf(extra=b"/Length 999999999\n")
        self.assertTrue(looks_like_zip_bomb(bomb))
        self.assertFalse(looks_like_zip_bomb(minimal_pdf()))


class UploadValidationTests(SimpleTestCase):
    def test_valid_pdf_is_accepted(self):
        result = validate_pdf_upload(
            data=minimal_pdf(pages=3),
            filename="Механика.pdf",
            declared_mime="application/pdf",
        )
        self.assertEqual(result.mime_type, "application/pdf")
        self.assertEqual(result.page_count, 3)
        self.assertEqual(result.sanitized_filename, "Механика.pdf")
        self.assertEqual(len(result.sha256), 64)
        # Антивирус не настроен — это должно быть видно, а не молча пропущено.
        self.assertIn("antivirus_not_configured", result.warnings)

    def test_rejects_non_pdf_content_despite_pdf_extension(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_pdf_upload(data=b"PK\x03\x04" + b"x" * 200, filename="fake.pdf")
        self.assertEqual(ctx.exception.code, "bad_magic")

    def test_rejects_wrong_extension(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_pdf_upload(data=minimal_pdf(), filename="book.exe")
        self.assertEqual(ctx.exception.code, "bad_extension")

    def test_rejects_wrong_declared_mime(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_pdf_upload(
                data=minimal_pdf(),
                filename="book.pdf",
                declared_mime="application/x-msdownload",
            )
        self.assertEqual(ctx.exception.code, "bad_mime")

    def test_rejects_oversized_file(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_pdf_upload(
                data=minimal_pdf() + b"0" * 5000,
                filename="book.pdf",
                max_bytes=1024,
            )
        self.assertEqual(ctx.exception.code, "file_too_large")

    def test_rejects_empty_file(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_pdf_upload(data=b"", filename="book.pdf")
        self.assertEqual(ctx.exception.code, "empty_file")

    def test_rejects_encrypted_pdf(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_pdf_upload(
                data=minimal_pdf(extra=b"/Encrypt 9 0 R\n"), filename="book.pdf"
            )
        self.assertEqual(ctx.exception.code, "encrypted_pdf")

    def test_rejects_too_many_pages(self):
        with self.assertRaises(UploadRejected) as ctx:
            validate_pdf_upload(
                data=minimal_pdf(pages=50), filename="book.pdf", max_pages=10
            )
        self.assertEqual(ctx.exception.code, "too_many_pages")

    def test_duplicate_detection_by_hash(self):
        data = minimal_pdf()
        first = validate_pdf_upload(data=data, filename="a.pdf")
        second = validate_pdf_upload(data=data, filename="b.pdf")
        self.assertEqual(first.sha256, second.sha256)
        self.assertEqual(first.sha256, content_hash(data))

    def test_infected_file_is_rejected(self):
        class Positive:
            name = "test-scanner"

            def scan(self, data):
                return False, "EICAR-Test-Signature"

        with self.assertRaises(UploadRejected) as ctx:
            validate_pdf_upload(
                data=minimal_pdf(), filename="book.pdf", scanner=Positive()
            )
        self.assertEqual(ctx.exception.code, "infected")

    def test_clean_scanner_removes_warning(self):
        class Clean:
            name = "test-scanner"

            def scan(self, data):
                return True, "clean"

        result = validate_pdf_upload(
            data=minimal_pdf(), filename="book.pdf", scanner=Clean()
        )
        self.assertNotIn("antivirus_not_configured", result.warnings)

    def test_error_message_is_safe_for_display(self):
        try:
            validate_pdf_upload(data=b"nope" * 100, filename="book.pdf")
        except UploadRejected as exc:
            # Никаких путей, стектрейсов и внутренних деталей.
            self.assertNotIn("/", exc.message)
            self.assertNotIn("Traceback", exc.message)
