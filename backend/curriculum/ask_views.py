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
from .models import LearningGoal

logger = logging.getLogger(__name__)

# Ответ в боковой панели — это несколько абзацев, а не конспект урока.
ASK_MAX_TOKENS = 1200
ASK_TIMEOUT_SECONDS = 90


def _sse(event: str, data: dict) -> str:
    """Одно Server-Sent Event.

    `ensure_ascii=False` — иначе кириллица раздувается в \\uXXXX и поток
    становится втрое тяжелее.
    """
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


class SubjectAskStreamView(APIView):
    """POST /api/curriculum/ask/stream — вопрос по книгам предмета.

    События: `stage` → `content`* → `citations` → `done`, либо `error`.
    """

    def post(self, request):
        question = (request.data.get("message") or "").strip()
        if not question:
            return Response(
                {"error": "Пустой вопрос."}, status=status.HTTP_400_BAD_REQUEST
            )

        goal_id = str(request.data.get("goal_id") or "").strip()
        user_email = getattr(request, "user_email", None)
        goal = LearningGoal.objects.filter(pk=goal_id, user_email=user_email).first()
        if goal is None:
            # 404, а не 403: чужой предмет не должен подтверждать, что он есть.
            return Response(
                {"error": "Предмет не найден."}, status=status.HTTP_404_NOT_FOUND
            )

        # Поиск делается ДО открытия потока: на нём ещё можно ответить честной
        # ошибкой с кодом, а после первого события заголовки уже отправлены.
        context = build_ask_context(
            goal=goal, question=question, history=request.data.get("history")
        )
        citations = [
            {
                "label": citation.render(),
                # Название книги отдельным полем: панель показывает его ОДИН
                # раз над списком, а не в каждой из восьми ссылок. С длинным
                # именем файла восемь цитат занимали больше места, чем ответ.
                "document_title": citation.document_title,
                "document_id": citation.document_id,
                "section_path": citation.section_path,
                "page_start": citation.page_start,
                "page_end": citation.page_end,
            }
            for citation in context.citations
        ]

        def event_stream():
            from ai_engine.text_llm import TextModel

            with usage_scope(user_email=user_email, feature="subject_ask"):
                # Три события, а не одно: ученик видит, ЧТО происходит, пока
                # ждёт. Поиск к этому моменту уже сделан — он идёт до открытия
                # потока, — поэтому первые два уходят подряд, и «нашёл»
                # остаётся на экране как результат, а не как обещание.
                yield _sse("stage", {"stage": "retrieving"})
                yield _sse("stage", {"stage": "found", "found": len(citations)})
                yield _sse("stage", {"stage": "answering"})
                try:
                    head = ""
                    marker_resolved = False
                    grounded = context.grounded
                    for delta in TextModel(temperature=0.3).stream_content(
                        context.messages(),
                        max_tokens=ASK_MAX_TOKENS,
                        timeout=ASK_TIMEOUT_SECONDS,
                        feature="subject_ask",
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
                    yield _sse(
                        "citations",
                        {"grounded": grounded, "items": citations if grounded else []},
                    )
                    yield _sse("done", {"grounded": grounded})
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
