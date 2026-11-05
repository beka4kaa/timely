"""Эндпоинт «спросить по книге предмета».

Вторая точка входа в RAG после генерации курса — и первая, до которой дотянется
сам ученик. Панель живёт на всех страницах дашборда, поэтому ответ идёт потоком:
молчать двадцать секунд в боковой панели нельзя.

Приёмы стриминга взяты у `ai_engine.chat_views.BoardChatStreamView` — там они
выстраданы на живом проде, и повторять их путь заново незачем:

* `usage_scope` открывается ВНУТРИ генератора. `StreamingHttpResponse`
  итерируется уже после того, как middleware закрыло свой скоуп, и без этого
  расход токенов записался бы никому;
* `Cache-Control: no-transform` и `X-Accel-Buffering: no` — иначе прокси копит
  поток в буфере и отдаёт всё одним куском в самом конце.
"""

from __future__ import annotations

import json
import logging

from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ai_engine.usage import usage_scope

from .ask import build_ask_context, split_outside_marker
from .ask_models import ask_options, resolve_choice, usage_payload
from .models import LearningGoal

logger = logging.getLogger(__name__)

# Ответ в боковой панели — это несколько абзацев, а не конспект урока.
ASK_TIMEOUT_SECONDS = 90
# Цитата на бумажке короче самого фрагмента, а хранится она вместе с разговором.
ASK_EXCERPT_CHARS = 500


def _sse(event: str, data: dict) -> str:
    """Одно Server-Sent Event.

    `ensure_ascii=False` — иначе кириллица раздувается в \\uXXXX и поток
    становится втрое тяжелее.
    """
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


class AskOptionsView(APIView):
    """GET /api/curriculum/ask/options — какие модели и уровни рассуждения можно выбрать."""

    def get(self, request):
        return Response(ask_options())


class SubjectAskStreamView(APIView):
    """POST /api/curriculum/ask/stream — вопрос по книгам предмета.

    События: `stage` → `content`* → `citations` → `usage` → `done`, либо `error`.
    """

    def post(self, request):
        question = (request.data.get("message") or "").strip()
        if not question:
            return Response(
                {"error": "Пустой вопрос."}, status=status.HTTP_400_BAD_REQUEST
            )

        choice = resolve_choice(request.data.get("model"), request.data.get("reasoning"))
        goal_id = str(request.data.get("goal_id") or "").strip()
        user_email = getattr(request, "user_email", None)

        # Без предмета — разговор без книги. Пустой `goal_id` это разрешённый
        # случай, а вот указанный и ненайденный — по-прежнему ошибка: иначе
        # опечатка в идентификаторе молча превращала бы вопрос по учебнику в
        # ответ «от себя», и ученик не узнал бы, что книгу не читали.
        goal = None
        if goal_id:
            goal = LearningGoal.objects.filter(
                pk=goal_id, user_email=user_email
            ).first()
            if goal is None:
                # 404, а не 403: чужой предмет не должен подтверждать, что есть.
                return Response(
                    {"error": "Предмет не найден."}, status=status.HTTP_404_NOT_FOUND
                )

        # Поиск делается ДО открытия потока: на нём ещё можно ответить честной
        # ошибкой с кодом, а после первого события заголовки уже отправлены.
        context = build_ask_context(
            goal=goal,
            question=question,
            history=request.data.get("history"),
            mode=request.data.get("mode"),
        )
        citations = [
            {
                "label": result.citation.render(),
                # Название книги отдельным полем: панель показывает его один
                # раз над списком, а не в каждой из восьми ссылок. С длинным
                # именем файла восемь цитат занимали больше места, чем ответ.
                "document_title": result.citation.document_title,
                "document_id": result.citation.document_id,
                "section_path": result.citation.section_path,
                "page_start": result.citation.page_start,
                "page_end": result.citation.page_end,
                # Сам фрагмент: источник виден вместе с местом в книге (§3.4), и
                # за цитатой не нужно идти вторым поиском. Решения задач сюда не
                # попадают: поиск идёт в режиме чтения ученика.
                "excerpt": result.excerpt[:ASK_EXCERPT_CHARS],
            }
            for result in context.results
        ]

        def event_stream():
            from ai_engine.text_llm import TextModel

            with usage_scope(user_email=user_email, feature="subject_ask"):
                # Три события, а не одно: ученик видит, ЧТО происходит, пока
                # ждёт. Поиск к этому моменту уже сделан — он идёт до открытия
                # потока, — поэтому первые два уходят подряд, и «нашёл»
                # остаётся на экране как результат, а не как обещание.
                #
                # Без книги искать было негде, и «ищу в учебнике» стало бы
                # выдумкой о работе, которой не было.
                if context.has_library:
                    yield _sse("stage", {"stage": "retrieving"})
                    yield _sse("stage", {"stage": "found", "found": len(citations)})
                yield _sse("stage", {"stage": "answering"})
                try:
                    head = ""
                    # Без книги маркера не будет: модель о нём не знает, и
                    # разбор начала ответа только задержал бы первое слово.
                    marker_resolved = not context.has_library
                    grounded = context.grounded
                    usage: list = []
                    for delta in TextModel(choice.model.model_id, temperature=0.3).stream_content(
                        context.messages(),
                        max_tokens=choice.reasoning.max_tokens,
                        timeout=ASK_TIMEOUT_SECONDS,
                        feature="subject_ask",
                        reasoning_effort=choice.reasoning.key,
                        on_usage=usage.append,
                    ):
                        if marker_resolved:
                            yield _sse("content", {"delta": delta})
                            continue
                        # Маркер «вне книги» приходит первым, но может быть
                        # разорван между чанками. Копим начало ответа, пока его
                        # длины не хватит для решения, и только потом начинаем
                        # печатать: иначе ученик успеет увидеть служебную
                        # строку до того, как мы её снимем.
                        head += delta
                        if len(head) < 24 and "\n" not in head:
                            continue
                        grounded, cleaned = split_outside_marker(head)
                        marker_resolved = True
                        if cleaned:
                            yield _sse("content", {"delta": cleaned})

                    if not marker_resolved and head:
                        grounded, cleaned = split_outside_marker(head)
                        if cleaned:
                            yield _sse("content", {"delta": cleaned})

                    # Цитаты показываются, только если ответ действительно по
                    # книге: ссылка под ответом «от себя» выглядела бы
                    # подтверждением, которого нет.
                    #
                    # `library` отличает «книга есть, но ответа в ней нет» от
                    # «книги и не было». Без этого признака страница показывала
                    # бы пометку «В книге этого нет» в разговоре, где книгу
                    # никто не открывал.
                    yield _sse(
                        "citations",
                        {
                            "grounded": grounded,
                            "library": context.has_library,
                            "items": citations if grounded else [],
                        },
                    )
                    if usage:
                        yield _sse("usage", usage_payload(choice, usage[-1]))
                    yield _sse(
                        "done", {"grounded": grounded, "library": context.has_library}
                    )
                except Exception as exc:  # noqa: BLE001
                    # Заголовки уже отправлены — HTTP-код не поменять, поэтому
                    # ошибка приезжает событием, и панель её показывает.
                    logger.error("Subject ask stream error: %s", exc, exc_info=True)
                    yield _sse("error", {"error": str(exc)})

        response = StreamingHttpResponse(
            event_stream(), content_type="text/event-stream"
        )
        response["Cache-Control"] = "no-cache, no-transform"
        response["X-Accel-Buffering"] = "no"
        return response
