"""Генератор настоящих PDF для тестов извлечения.

Зачем отдельно от `minimal_pdf` в `test_upload.py`: тот фикстур намеренно
синтетический — заголовок, дерево страниц и трейлер, без xref и без контента.
Его достаточно, чтобы проверить регулярочный гейт `upload_validation`, но pdfium
открывает его как ОДНУ страницу независимо от `/Count`, и извлекать из него
нечего.

Здесь собирается валидный PDF с настоящим потоком контента и шрифтом Helvetica,
из которого pdfium реально достаёт текст.

Про язык фикстур: Helvetica — базовый шрифт из 14 стандартных, в кодировке
WinAnsi, и кириллических глифов у него нет. Поэтому в PDF-фикстурах маркеры
английские (классификатор в `blocks.py` их поддерживает наравне с русскими), а
русский путь проверяется прямыми вызовами `classify_pages` без PDF — там текст
приходит строкой и никакой шрифт не участвует.
"""

from __future__ import annotations


def build_text_pdf(
    pages: list[str], *, page_size: tuple[float, float] = (612, 792)
) -> bytes:
    """Собирает PDF с заданным MediaBox и текстом Helvetica 12pt.

    Каждая строка входа рисуется отдельным `Td`-смещением, поэтому pdfium
    возвращает её отдельной строкой — как и настоящий вёрстанный учебник.
    """
    if not pages:
        raise ValueError("Нужна хотя бы одна страница")

    width, height = page_size
    objects: dict[int, bytes] = {}
    kids = " ".join(f"{4 + index * 2} 0 R" for index in range(len(pages)))
    objects[1] = b"<</Type/Catalog/Pages 2 0 R>>"
    objects[2] = f"<</Type/Pages/Count {len(pages)}/Kids[{kids}]>>".encode()
    objects[3] = b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"

    for index, body in enumerate(pages):
        page_number = 4 + index * 2
        commands: list[str] = []
        y = 750
        for line in body.split("\n"):
            escaped = (
                line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
            )
            commands.append(f"BT /F1 12 Tf 72 {y} Td ({escaped}) Tj ET")
            y -= 16
        stream = "\n".join(commands).encode("latin-1", errors="replace")
        objects[page_number] = (
            f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {width:g} {height:g}]"
            "/Resources<</Font<</F1 3 0 R>>>>"
            f"/Contents {page_number + 1} 0 R>>"
        ).encode()
        objects[page_number + 1] = (
            b"<</Length "
            + str(len(stream)).encode()
            + b">>stream\n"
            + stream
            + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.7\n")
    offsets: dict[int, int] = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj".encode() + objects[number] + b"endobj\n"

    xref_offset = len(out)
    highest = max(objects)
    out += f"xref\n0 {highest + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for number in range(1, highest + 1):
        if number in offsets:
            out += f"{offsets[number]:010d} 00000 n \n".encode()
        else:
            out += b"0000000000 65535 f \n"
    out += (
        f"trailer<</Size {highest + 1}/Root 1 0 R>>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode()
    return bytes(out)


# Страница с полным набором размечаемых блоков: заголовки, определение,
# теорема, доказательство, задача и решение.
TEXTBOOK_PAGE_ONE = """Chapter 1. MECHANICS
1.2 Kinematics of a point
A body moves along a straight line with a
constant acceleration a.
Definition. Velocity is the derivative of the
radius vector with respect to time.
Theorem 3. The path equals the integral of speed.
Proof. It follows from the definition.
Problem 5. Find the path travelled in 3 s.
Solution. s = v0 t + a t^2 / 2."""

TEXTBOOK_PAGE_TWO = """1.3 Dynamics
The second law of Newton relates force and
acceleration.
Problem 6. Find the force acting on the body.
Solution. F = m a.
Figure 4. Diagram of forces."""


def textbook_pdf() -> bytes:
    """Двухстраничный «учебник» со задачами и решениями."""
    return build_text_pdf([TEXTBOOK_PAGE_ONE, TEXTBOOK_PAGE_TWO])


def scanned_pdf() -> bytes:
    """PDF, у которого вторая страница пустая — имитация скана без текста."""
    return build_text_pdf([TEXTBOOK_PAGE_ONE, ""])
