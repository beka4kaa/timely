"""Сравнение vision-моделей на распознавании страниц PDF.

Дисциплина полностью повторяет `benchmark.py`, и не случайно: там она уже
продумана и проверена тестами.

1. Прогон выключен по умолчанию и включается ЧЕТЫРЬМЯ независимыми условиями.
   Забытая переменная не должна приводить к платным вызовам.
2. Все кандидаты получают ОДИН И ТОТ ЖЕ вход, и это доказывается сравнением
   хешей картинок, а не обещанием.
3. Ровно один вызов на модель на страницу, без retry: retry ломает и замер
   латентности, и учёт стоимости.
4. Метрики только автоматически проверяемые. `render_report()` намеренно НЕ
   объявляет победителя: выбор модели по одной картинке — то, от чего прямо
   предостерегает CLAUDE.md.

Имена моделей в коде НЕ зашиты (`providers.py:3-4`): кандидаты приходят из
`OCR_EVAL_MODELS`, поэтому добавить модель можно без правки кода.
"""

from __future__ import annotations

import hashlib
import os
import re
import time
from dataclasses import dataclass, field


def _env(name: str) -> str:
    return (os.getenv(name, "") or "").strip()


# Те же грубые оценки «до запуска», что и в `benchmark.py`, но для картинок:
# страница в ~144 dpi стоит у большинства провайдеров как ~1–1.5к токенов.
FALLBACK_PRICE_PER_IMAGE_USD = 0.004
FALLBACK_PRICE_PER_1K_OUTPUT_USD = 0.015
EXPECTED_OUTPUT_TOKENS_PER_PAGE = 1200


class OcrBenchmarkDisabled(RuntimeError):
    """Условия платного прогона не выполнены."""


class OcrBenchmarkBudgetExceeded(RuntimeError):
    """Оценка стоимости выше разрешённого потолка."""


def ocr_evaluation_candidates() -> list[str]:
    """Кандидаты из `OCR_EVAL_MODELS`. Пусто — значит сравнивать нечего."""
    raw = _env("OCR_EVAL_MODELS")
    return [part.strip() for part in raw.split(",") if part.strip()]


@dataclass
class OcrGuardStatus:
    enabled: bool
    reasons: list[str] = field(default_factory=list)
    max_total_usd: float = 0.0
    pdf_path: str = ""
    candidates: list[str] = field(default_factory=list)
    max_pages: int = 3


def guard_real_run() -> OcrGuardStatus:
    """Проверяет условия прогона, ничего не запуская и не бросая исключений."""
    reasons: list[str] = []

    if os.getenv("RUN_REAL_OCR_EVAL", "") != "1":
        reasons.append("RUN_REAL_OCR_EVAL != 1")

    raw_budget = (os.getenv("OCR_EVAL_MAX_TOTAL_USD", "") or "").strip()
    budget = 0.0
    if not raw_budget:
        reasons.append("OCR_EVAL_MAX_TOTAL_USD не задан")
    else:
        try:
            budget = float(raw_budget)
            if budget <= 0:
                reasons.append("OCR_EVAL_MAX_TOTAL_USD должен быть больше нуля")
        except ValueError:
            reasons.append("OCR_EVAL_MAX_TOTAL_USD не число")

    if not (os.getenv("OPENROUTER_API_KEY", "") or os.getenv("VISION_API_KEY", "")):
        reasons.append("OPENROUTER_API_KEY не настроен")

    pdf_path = (os.getenv("OCR_EVAL_PDF_PATH", "") or "").strip()
    if not pdf_path:
        reasons.append("OCR_EVAL_PDF_PATH не указан")
    elif not os.path.isfile(pdf_path):
        reasons.append(f"OCR_EVAL_PDF_PATH не найден: {pdf_path}")

    candidates = ocr_evaluation_candidates()
    if not candidates:
        reasons.append("OCR_EVAL_MODELS пуст")

    try:
        max_pages = max(1, int(_env("OCR_EVAL_MAX_PAGES") or "3"))
    except ValueError:
        max_pages = 3

    return OcrGuardStatus(
        enabled=not reasons,
        reasons=reasons,
        max_total_usd=budget,
        pdf_path=pdf_path,
        candidates=candidates,
        max_pages=max_pages,
    )


@dataclass
class OcrCostEstimate:
    model: str
    pages: int
    usd: float


def estimate_cost(
    *, candidates: list[str], pages: int
) -> tuple[list[OcrCostEstimate], float]:
    """Верхняя оценка стоимости до первого запроса."""
    per_model = pages * (
        FALLBACK_PRICE_PER_IMAGE_USD
        + EXPECTED_OUTPUT_TOKENS_PER_PAGE / 1000 * FALLBACK_PRICE_PER_1K_OUTPUT_USD
    )
    rows = [
        OcrCostEstimate(model=model, pages=pages, usd=round(per_model, 4))
        for model in candidates
    ]
    return rows, round(sum(row.usd for row in rows), 4)


# ─────────────────────────────── Метрики ─────────────────────────────────────

_CYRILLIC = re.compile(r"[а-яёА-ЯЁ]")
_LATIN = re.compile(r"[a-zA-Z]")
_LATEX_MARKERS = re.compile(r"\$|\\frac|\\sqrt|\\int|\\sum|\\alpha|\\beta|\\theta")
_FENCE = re.compile(r"```")

# Признаки того, что модель занялась описанием вместо транскрипции. Ровно эта
# болезнь описана в `ai_engine/ocr_views.py`: «На доске изображена формула...»
_NARRATION = (
    re.compile(r"(?i)на (доске|странице|изображени\w+)\s+(изображен|показан|видн)"),
    re.compile(r"(?i)^(это|здесь|на\s+фото|the image|this image|the page)\b"),
    re.compile(r"(?i)\b(i'm sorry|i cannot|as an ai|извините|не могу)\b"),
    re.compile(r"(?i)^(конечно|sure|certainly|вот текст|here is)\b"),
)

# Маркеры структуры, которые OCR обязан сохранить: по ним `blocks.py` размечает
# блоки. Если модель их перепишет, задача перестанет быть задачей.
_STRUCTURE_MARKERS = re.compile(
    r"(?i)(определение|теорема|доказательство|задача|решение|пример|"
    r"definition|theorem|proof|problem|solution|example)"
)


@dataclass
class PageOcrResult:
    """Результат одной страницы у одной модели."""

    page_number: int
    image_sha256: str
    text: str = ""
    succeeded: bool = False
    latency_ms: int = 0
    error: str = ""

    def metrics(self) -> dict[str, float | int | bool]:
        text = self.text or ""
        letters = len(_CYRILLIC.findall(text)) + len(_LATIN.findall(text))
        return {
            "succeeded": self.succeeded,
            "char_count": len(text),
            "line_count": len(text.splitlines()),
            "cyrillic_ratio": (
                round(len(_CYRILLIC.findall(text)) / letters, 4) if letters else 0.0
            ),
            "latex_marker_count": len(_LATEX_MARKERS.findall(text)),
            "structure_marker_count": len(_STRUCTURE_MARKERS.findall(text)),
            "has_markdown_fence": bool(_FENCE.search(text)),
            "looks_like_narration": any(p.search(text) for p in _NARRATION),
            "latency_ms": self.latency_ms,
        }


@dataclass
class OcrCandidateResult:
    """Итог одного кандидата по всем страницам. `calls` == числу страниц."""

    model: str
    pages: list[PageOcrResult] = field(default_factory=list)
    calls: int = 0
    error: str = ""

    @property
    def succeeded(self) -> bool:
        return bool(self.pages) and all(page.succeeded for page in self.pages)

    def aggregate(self) -> dict[str, float | int | bool]:
        if not self.pages:
            return {"succeeded": False, "pages": 0}
        rows = [page.metrics() for page in self.pages]
        count = len(rows)
        return {
            "succeeded": self.succeeded,
            "pages": count,
            "calls": self.calls,
            "total_chars": sum(int(r["char_count"]) for r in rows),
            "avg_chars": round(sum(int(r["char_count"]) for r in rows) / count, 1),
            "avg_cyrillic_ratio": round(
                sum(float(r["cyrillic_ratio"]) for r in rows) / count, 4
            ),
            "latex_markers": sum(int(r["latex_marker_count"]) for r in rows),
            "structure_markers": sum(int(r["structure_marker_count"]) for r in rows),
            "pages_with_fence": sum(1 for r in rows if r["has_markdown_fence"]),
            "pages_with_narration": sum(1 for r in rows if r["looks_like_narration"]),
            "avg_latency_ms": round(sum(int(r["latency_ms"]) for r in rows) / count, 1),
            "max_latency_ms": max(int(r["latency_ms"]) for r in rows),
        }


@dataclass
class OcrBenchmarkRun:
    """Полный прогон. Знает, как доказать корректность сравнения."""

    image_hashes: list[str] = field(default_factory=list)
    results: list[OcrCandidateResult] = field(default_factory=list)
    estimated_usd: float = 0.0
    pdf_path: str = ""

    def inputs_identical(self) -> bool:
        """Все кандидаты получили те же самые картинки."""
        expected = list(self.image_hashes)
        return all(
            [page.image_sha256 for page in candidate.pages] == expected
            for candidate in self.results
            if candidate.pages
        )

    def one_call_per_page(self) -> bool:
        """Ни одного retry: вызовов ровно столько, сколько страниц."""
        return all(
            candidate.calls == len(candidate.pages) for candidate in self.results
        )

    def render_report(self) -> str:
        lines = [
            "OCR benchmark",
            f"PDF: {self.pdf_path}",
            f"Страниц: {len(self.image_hashes)}",
            f"Оценка стоимости до прогона: ${self.estimated_usd}",
            f"Одинаковый вход у всех моделей: {self.inputs_identical()}",
            f"Один вызов на страницу: {self.one_call_per_page()}",
            "",
        ]
        for candidate in self.results:
            lines.append(f"— {candidate.model}")
            if candidate.error:
                lines.append(f"    ошибка: {candidate.error}")
            for key, value in sorted(candidate.aggregate().items()):
                lines.append(f"    {key}: {value}")
            lines.append("")

        # Победитель не объявляется СОЗНАТЕЛЬНО. Метрики здесь механические:
        # они не отличают верную формулу от правдоподобной и не видят, что
        # модель переставила строки. Решение — за человеком, и на нескольких
        # повторах, а не на одной картинке.
        lines.append(
            "Победитель не выбран автоматически: метрики выше механические и не "
            "проверяют смысл. Сравнивай глазами и на повторных прогонах."
        )
        return "\n".join(lines)


def run_ocr_benchmark(
    *,
    pdf_bytes: bytes,
    candidates: list[str],
    max_pages: int = 3,
    max_total_usd: float = 0.0,
    provider_factory=None,
    render_scale: float | None = None,
) -> OcrBenchmarkRun:
    """Гоняет одинаковые страницы через каждого кандидата по одному разу.

    `provider_factory(model) -> OcrProvider` внедряется извне, чтобы тест мог
    подставить детерминированный провайдер без сети.
    """
    from . import extraction
    from .ocr import VisionOcrProvider

    if not candidates:
        raise OcrBenchmarkDisabled("Список моделей пуст.")

    pages = extraction.extract_pages(pdf_bytes, max_pages=max_pages)
    if not pages:
        raise OcrBenchmarkDisabled("В PDF нет страниц.")

    scale = render_scale or extraction.OCR_RENDER_SCALE
    images: list[tuple[int, bytes, str]] = []
    for page in pages:
        png = extraction.render_page_png(pdf_bytes, page.page_number, scale=scale)
        images.append((page.page_number, png, hashlib.sha256(png).hexdigest()))

    _, estimated = estimate_cost(candidates=candidates, pages=len(images))
    if max_total_usd and estimated > max_total_usd:
        raise OcrBenchmarkBudgetExceeded(
            f"Оценка ${estimated} выше потолка ${max_total_usd}."
        )

    factory = provider_factory or (lambda model: VisionOcrProvider(model=model))
    run = OcrBenchmarkRun(
        image_hashes=[digest for _, _, digest in images],
        estimated_usd=estimated,
    )

    for model in candidates:
        candidate = OcrCandidateResult(model=model)
        try:
            provider = factory(model)
        except Exception as exc:  # noqa: BLE001
            candidate.error = str(exc)
            run.results.append(candidate)
            continue

        for page_number, png, digest in images:
            started = time.monotonic()
            # Ровно один вызов. Никакого retry: он исказил бы и латентность,
            # и стоимость, и сам смысл сравнения.
            result = provider.transcribe_page(png)
            candidate.calls += 1
            candidate.pages.append(
                PageOcrResult(
                    page_number=page_number,
                    image_sha256=digest,
                    text=result.text,
                    succeeded=result.succeeded,
                    latency_ms=int((time.monotonic() - started) * 1000),
                    error=result.error,
                )
            )
        run.results.append(candidate)

    return run
