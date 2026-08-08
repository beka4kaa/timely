"""Сравнение vision-моделей на страницах реального PDF.

Прогон платный и поэтому выключен по умолчанию. Нужны ВСЕ переменные:

    RUN_REAL_OCR_EVAL=1
    OCR_EVAL_MODELS="model-a,model-b,model-c"
    OCR_EVAL_PDF_PATH=/путь/к/скану.pdf
    OCR_EVAL_MAX_TOTAL_USD=0.50
    OPENROUTER_API_KEY=…
    OCR_EVAL_MAX_PAGES=3        # необязательно, по умолчанию 3

`--dry-run` показывает, что бы запустилось, и оценку стоимости, не делая ни
одного вызова.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from curriculum.ocr_benchmark import (
    OcrBenchmarkBudgetExceeded,
    OcrBenchmarkDisabled,
    estimate_cost,
    guard_real_run,
    run_ocr_benchmark,
)


class Command(BaseCommand):
    help = "Сравнивает vision-модели на распознавании страниц PDF."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Показать план прогона и оценку стоимости, ничего не вызывая",
        )
        parser.add_argument(
            "--show-text",
            action="store_true",
            help="Напечатать распознанный текст каждой страницы",
        )

    def handle(self, *args, **options):
        guard = guard_real_run()

        if not guard.enabled:
            self.stdout.write(
                self.style.WARNING("Платный прогон OCR-сравнения не разрешён.")
            )
            for reason in guard.reasons:
                self.stdout.write(f"  — {reason}")
            self.stdout.write(
                "\nЭто не ошибка: сравнение моделей по умолчанию выключено, "
                "чтобы случайный запуск не стоил денег."
            )
            return

        rows, total = estimate_cost(
            candidates=guard.candidates, pages=guard.max_pages
        )
        self.stdout.write(f"PDF: {guard.pdf_path}")
        self.stdout.write(f"Страниц: {guard.max_pages}")
        self.stdout.write("Кандидаты и оценка стоимости (верхняя граница):")
        for row in rows:
            self.stdout.write(f"  {row.model:45} ${row.usd}")
        self.stdout.write(f"  {'ИТОГО':45} ${total}  (потолок ${guard.max_total_usd})")

        if options["dry_run"]:
            self.stdout.write(
                self.style.SUCCESS("\n--dry-run: вызовов не сделано.")
            )
            return

        with open(guard.pdf_path, "rb") as handle:
            pdf_bytes = handle.read()

        try:
            run = run_ocr_benchmark(
                pdf_bytes=pdf_bytes,
                candidates=guard.candidates,
                max_pages=guard.max_pages,
                max_total_usd=guard.max_total_usd,
            )
        except OcrBenchmarkBudgetExceeded as exc:
            raise CommandError(str(exc)) from exc
        except OcrBenchmarkDisabled as exc:
            raise CommandError(str(exc)) from exc

        run.pdf_path = guard.pdf_path
        self.stdout.write("\n" + run.render_report())

        if options["show_text"]:
            for candidate in run.results:
                self.stdout.write(f"\n===== {candidate.model} =====")
                for page in candidate.pages:
                    self.stdout.write(f"--- стр. {page.page_number} ---")
                    self.stdout.write(page.text or f"(пусто: {page.error})")
