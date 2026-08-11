"""Черновик эталонного набора для оценки поиска.

По каждому учебному разделу модель пишет вопрос ОТ ЛИЦА УЧЕНИКА — своими
словами. Вопрос, повторяющий заголовок, отбраковывается: он находится лексикой
по совпадению слов, и оценка сказала бы больше о заголовке, чем о поиске.

Результат — черновик. Его правят руками; сгенерированный эталон не истина.
"""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from ai_engine.usage import usage_scope
from curriculum.gold_set import GoldQuery, dumps, rejection_reason
from curriculum.models import Document, DocumentSection

SYSTEM_PROMPT = """Ты школьник или студент, который читает учебник и не понял тему.

Тебе дают раздел книги. Напиши ОДИН вопрос, который ты задал бы репетитору.

Правила:
- Своими словами. НЕ повторяй заголовок раздела и не используй его термины —
  вопрос «что такое сила трения» по разделу «Сила трения» никуда не годится.
- Спрашивай о сути: почему так происходит, как это применить, чем одно
  отличается от другого.
- Один вопрос, одна строка, без пояснений и без кавычек.
- На языке книги.

Верни ТОЛЬКО JSON: {"question": "..."}"""


class Command(BaseCommand):
    help = "Готовит черновик эталонного набора вопросов по книге."

    def add_arguments(self, parser):
        parser.add_argument("--document", required=True, help="UUID документа")
        parser.add_argument("--out", required=True, help="Куда положить JSON")
        parser.add_argument("--max-sections", type=int, default=30)
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Разрешить вызовы модели; без флага только оценка объёма",
        )

    def handle(self, *args, **options):
        document = Document.objects.filter(pk=options["document"]).first()
        if document is None:
            raise CommandError("Документ не найден.")

        sections = list(
            DocumentSection.objects.filter(
                document=document, is_teachable=True, level__gte=3
            )
            .exclude(title="")
            .order_by("order_index")[: max(1, int(options["max_sections"]))]
        )
        if not sections:
            raise CommandError("У книги нет учебных разделов — сначала обработайте её.")

        self.stdout.write(
            f"Разделов: {len(sections)}. Это {len(sections)} вызовов модели."
        )
        if not options["execute"]:
            self.stdout.write(
                self.style.WARNING("Сухой прогон. Повторите с --execute.")
            )
            return

        queries: list[GoldQuery] = []
        rejected: list[tuple[str, str]] = []
        with usage_scope(user_email=document.user_email, feature="gold_set"):
            for section in sections:
                question = self._ask(section)
                if not question:
                    rejected.append((section.title, "модель не ответила"))
                    continue
                reason = rejection_reason(question, section.title)
                if reason:
                    rejected.append((question, reason))
                    continue
                queries.append(
                    GoldQuery(query=question, section_paths=(section.path,))
                )

        if not queries:
            raise CommandError("Ни одного пригодного вопроса не получилось.")

        Path(options["out"]).write_text(dumps(queries), encoding="utf-8")
        self.stdout.write(
            self.style.SUCCESS(f"Готово: {len(queries)} вопросов → {options['out']}")
        )
        for question, reason in rejected:
            self.stdout.write(self.style.WARNING(f"  отброшен ({reason}): {question}"))
        self.stdout.write(
            "Проверьте файл глазами: эталон определяет, что вы измеряете."
        )

    def _ask(self, section: DocumentSection) -> str:
        from ai_engine.text_llm import TextModel

        payload = {
            "section_title": section.title,
            "section_label": section.number_label,
            "pages": [section.start_page, section.end_page],
        }
        try:
            response = TextModel(temperature=0.7).generate_json_content(
                system_prompt=SYSTEM_PROMPT,
                payload=payload,
                timeout=60,
                max_tokens=200,
                feature="gold_set",
            )
        except Exception as exc:  # noqa: BLE001 — один раздел не должен ронять набор
            self.stderr.write(f"  раздел «{section.title}»: {exc}")
            return ""
        try:
            data = json.loads(response.text)
        except json.JSONDecodeError:
            return ""
        return str(data.get("question") or "").strip() if isinstance(data, dict) else ""
