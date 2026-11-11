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

from dataclasses import dataclass


@dataclass(frozen=True)
class ScanPage:
    """Страница-скан: растровая картинка и ни одного символа текста.

    `coverage` — высота картинки в долях листа: полоса во всю ширину, нижний
    край на высоте `bottom` (тоже в долях листа, может быть отрицательной —
    тогда картинка свисает за лист). `in_form` рисует картинку через Form
    XObject, растянутый на лист матрицей страницы, как делают некоторые
    программы сканирования: рамку такой картинки pdfium отдаёт в координатах
    формы, а не листа.
    """

    coverage: float = 1.0
    in_form: bool = False
    bottom: float = 0.0


# Скан во весь лист: обычная страница отсканированной книги.
SCAN = ScanPage()


@dataclass(frozen=True)
class VectorPage:
    """Страница из векторных контуров: `paths` маленьких закрашенных квадратов.

    Так выглядят текст, нарисованный кривыми, и векторизованный скан: на
    странице нет ни текста, ни картинки. `text` добавляет строку поверх, как
    у титула главы с парой линеек.
    """

    paths: int
    text: str = ""

# Сторона картинки в пикселях. Содержимое для тестов не важно, важны место и
# размер на листе.
_IMAGE_SIDE = 8


def _stream(entries: str, data: bytes) -> bytes:
    return (
        b"<<"
        + entries.encode()
        + b"/Length "
        + str(len(data)).encode()
        + b">>stream\n"
        + data
        + b"\nendstream"
    )


def _text_commands(body: str) -> list[str]:
    commands: list[str] = []
    y = 750
    for line in body.split("\n"):
        escaped = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        commands.append(f"BT /F1 12 Tf 72 {y} Td ({escaped}) Tj ET")
        y -= 16
    return commands


def build_text_pdf(
    pages: list[str | ScanPage | VectorPage],
    *,
    page_size: tuple[float, float] = (612, 792),
    untyped_pages: frozenset[int] = frozenset(),
) -> bytes:
    """Собирает PDF с заданным MediaBox и текстом Helvetica 12pt.

    Каждая строка входа рисуется отдельным `Td`-смещением, поэтому pdfium
    возвращает её отдельной строкой — как и настоящий вёрстанный учебник.
    Вместо строки можно передать `ScanPage`: страница будет растровой
    картинкой без текста, как у отсканированной книги. `VectorPage` рисует
    страницу векторными контурами.

    `untyped_pages` — номера страниц (с единицы), в словаре которых нет
    `/Type /Page`. Так пишут некоторые программы: pdfium такую страницу
    открывает, читает и рендерит, но её объекты не перечисляет.
    """
    if not pages:
        raise ValueError("Нужна хотя бы одна страница")

    width, height = page_size
    objects: dict[int, bytes] = {}
    kids = " ".join(f"{4 + index * 2} 0 R" for index in range(len(pages)))
    objects[1] = b"<</Type/Catalog/Pages 2 0 R>>"
    objects[2] = f"<</Type/Pages/Count {len(pages)}/Kids[{kids}]>>".encode()
    objects[3] = b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"
    # Картинка и форма идут после всех страниц: у PDF из одного текста номера
    # объектов и байты остаются прежними.
    image_number = 4 + len(pages) * 2
    form_number = image_number + 1
    if any(isinstance(body, ScanPage) for body in pages):
        objects[image_number] = _stream(
            f"/Type/XObject/Subtype/Image/Width {_IMAGE_SIDE}/Height {_IMAGE_SIDE}"
            "/ColorSpace/DeviceGray/BitsPerComponent 8",
            bytes(
                (row * 31 + col * 7) % 256
                for row in range(_IMAGE_SIDE)
                for col in range(_IMAGE_SIDE)
            ),
        )
        objects[form_number] = _stream(
            "/Type/XObject/Subtype/Form/BBox[0 0 1 1]"
            f"/Resources<</XObject<</Im1 {image_number} 0 R>>>>",
            b"/Im1 Do",
        )

    for index, body in enumerate(pages):
        page_number = 4 + index * 2
        if isinstance(body, ScanPage):
            name = "Fm1" if body.in_form else "Im1"
            stream = (
                f"q {width:g} 0 0 {height * body.coverage:g} "
                f"0 {height * body.bottom:g} cm /{name} Do Q"
            ).encode()
            resources = (
                f"<</XObject<</Im1 {image_number} 0 R/Fm1 {form_number} 0 R>>>>"
            )
        elif isinstance(body, VectorPage):
            # Каждый `re f` — отдельный контур: по 20 квадратов в ряд.
            commands = _text_commands(body.text) if body.text else []
            commands += [
                f"{72 + (n % 20) * 20} {100 + (n // 20) * 20} 10 10 re f"
                for n in range(body.paths)
            ]
            stream = "\n".join(commands).encode("latin-1", errors="replace")
            resources = "<</Font<</F1 3 0 R>>>>"
        else:
            commands = _text_commands(body)
            stream = "\n".join(commands).encode("latin-1", errors="replace")
            resources = "<</Font<</F1 3 0 R>>>>"
        page_type = "" if index + 1 in untyped_pages else "/Type/Page"
        objects[page_number] = (
            f"<<{page_type}/Parent 2 0 R/MediaBox[0 0 {width:g} {height:g}]"
            f"/Resources{resources}"
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
    """PDF, у которого вторая страница — скан: картинка во весь лист без текста."""
    return build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN])
