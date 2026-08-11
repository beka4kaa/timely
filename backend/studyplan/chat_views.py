"""Помощник по расписанию: «разгрузи среду», «я пропустил три дня».

Отдельная маленькая точка входа, а не ещё один универсальный чат. Приёмы взяты
у `curriculum.ask_views.SubjectAskStreamView` и `ai_engine.skills.router`, и
повторять их путь заново незачем:

* `usage_scope` открывается ВНУТРИ генератора: `StreamingHttpResponse`
  итерируется уже после того, как middleware закрыло свой скоуп, и без этого
  расход токенов записался бы никому;
* `Cache-Control: no-transform` и `X-Accel-Buffering: no` — иначе прокси копит
  поток и отдаёт всё одним куском в конце;
* цикл вызовов инструментов ограничен по кругам: модель умеет зацикливаться на
  «проверю ещё раз», а каждый круг — отдельный оплаченный запрос.

**Почему ответ не стримится по словам.** Пока модель работает, ученик видит
события `stage` — какой инструмент сейчас вызван. Финальный текст приходит
одним событием, потому что он УЖЕ получен последним вызовом цикла: чтобы
напечатать его по буквам, пришлось бы сделать ещё один запрос к модели и
заплатить за тот же ответ дважды. Живость обеспечивают стадии, а не побуквенная
печать.
"""

from __future__ import annotations

import json
import logging

from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ai_engine.usage import provider_call_reservation, usage_scope
from curriculum.model_registry import ROLE_SCHEDULE_PLANNING, resolve_model

from .models import ScheduleRevision, StudySchedule
from .serializers import ScheduleRevisionSerializer
from .tools import (
    SCHEDULE_TOOLS,
    ScheduleToolContext,
    run_schedule_tool,
    tool_schemas,
)

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 4
CHAT_MAX_TOKENS = 1200
CHAT_TIMEOUT_SECONDS = 90
# Сколько прошлых реплик уходит в контекст. Панель решает короткие задачи, и
# длинная история здесь только удорожает вызов.
MAX_HISTORY_MESSAGES = 8

SYSTEM_PROMPT = """Ты помощник по расписанию. Ты помогаешь ученику держать ритм.

Как работать:
- Сначала посмотри расписание инструментом get_schedule. Идентификаторы занятий
  берутся ТОЛЬКО оттуда, придумывать их нельзя.
- Прежде чем предлагать перенос, найди свободные окна: find_free_slots.
- Любое изменение делается инструментом propose_*. Ты НЕ меняешь календарь —
  ты предлагаешь изменение, а применяет его ученик.
- Закреплённые занятия (fixed) не переносятся никогда. Не предлагай этого.
- Не выдумывай занятия, дат и время: всё берётся из инструментов.
- Если места нет, скажи прямо и предложи выбор: продлить срок, добавить день
  или сократить практику. Не делай вид, что всё поместилось.
- Просят добавить курс, начать программу, запланировать книгу — сначала
  list_courses, потом add_course_to_schedule с идентификатором оттуда.
  Кнопки для этого в интерфейсе больше нет: программа ставится в календарь
  только через тебя.
- Пустой календарь — не ошибка. Если расписания ещё нет, покажи список программ
  и предложи поставить одну из них.

Как отвечать:
- Коротко, по-русски, без списков из десяти пунктов.
- После предложения скажи одним предложением, что именно изменится и что
  ученику осталось нажать «Применить».
- Если пользователь рассказал про занятость (школа, репетитор, секция),
  разбери её инструментом propose_fixed_commitments."""


def _sse(event: str, data: dict) -> str:
    """Одно Server-Sent Event.

    `default=str` обязателен: сериализаторы DRF отдают `UUID` объектами, а не
    строками (их превращает в строки JSON-рендерер, мимо которого поток идёт).
    Без этого первое же событие с ревизией падало бы прямо в открытом потоке,
    когда HTTP-код уже не поменять.

    `ensure_ascii=False` — иначе кириллица раздувается в \\uXXXX и поток
    становится втрое тяжелее.
    """
    payload = json.dumps(
        data, ensure_ascii=False, separators=(",", ":"), default=str
    )
    return f"event: {event}\ndata: {payload}\n\n"


def _history(raw) -> list[dict]:
    """Прошлые реплики панели в формате сообщений модели."""
    if not isinstance(raw, list):
        return []
    messages: list[dict] = []
    for item in raw[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = str(item.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content[:2000]})
    return messages


class ScheduleChatStreamView(APIView):
    """POST /api/studyplan/chat/stream/ — просьба про расписание.

    События: `stage`* → `revision`? → `commitments`? → `content` → `done`,
    либо `error`.
    """

    def post(self, request):
        message = (request.data.get("message") or "").strip()
        if not message:
            return Response(
                {"error": "Пустая просьба."}, status=status.HTTP_400_BAD_REQUEST
            )

        user_email = getattr(request, "user_email", None)
        if not user_email:
            return Response(
                {"error": "Не определён пользователь."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule_id = str(request.data.get("schedule_id") or "").strip()
        schedule = None
        if schedule_id:
            schedule = StudySchedule.objects.filter(
                pk=schedule_id, user_email=user_email
            ).first()
            if schedule is None:
                # 404, а не 403: чужое расписание не должно подтверждать, что есть.
                return Response(
                    {"error": "Расписание не найдено."},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            schedule = (
                StudySchedule.objects.filter(user_email=user_email)
                .exclude(status=StudySchedule.Status.ARCHIVED)
                .order_by("-created_at")
                .first()
            )

        binding = resolve_model(ROLE_SCHEDULE_PLANNING)
        if not binding.configured:
            # Честный отказ до открытия потока: детерминированного помощника
            # здесь нет и быть не может — это разговор, а не расчёт.
            return Response(
                {
                    "error": "Помощник по расписанию не настроен.",
                    "code": "assistant_not_configured",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        history = _history(request.data.get("history"))
        context = ScheduleToolContext(user_email=user_email, schedule=schedule)

        def event_stream():
            from openai import OpenAI

            from ai_engine.text_llm import TEXT_LLM_API_KEY, TEXT_LLM_BASE_URL
            from ai_engine.usage import provider_from_base_url, record_model_usage

            client = OpenAI(
                api_key=TEXT_LLM_API_KEY, base_url=TEXT_LLM_BASE_URL, max_retries=0
            )
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                *history,
                {"role": "user", "content": message},
            ]
            revision: ScheduleRevision | None = None
            commitments: list[dict] | None = None

            with usage_scope(user_email=user_email, feature="schedule_chat"):
                try:
                    reply = ""
                    for round_index in range(MAX_TOOL_ROUNDS):
                        with provider_call_reservation(
                            input_payload=messages,
                            max_output_tokens=CHAT_MAX_TOKENS,
                            feature="schedule_chat",
                        ):
                            response = client.chat.completions.create(
                                model=binding.model,
                                messages=messages,
                                tools=tool_schemas(),
                                max_tokens=CHAT_MAX_TOKENS,
                                temperature=0.2,
                                timeout=CHAT_TIMEOUT_SECONDS,
                            )
                        record_model_usage(
                            response,
                            model=binding.model,
                            provider=provider_from_base_url(TEXT_LLM_BASE_URL),
                            feature="schedule_chat",
                            input_payload=messages,
                        )

                        choice = response.choices[0].message
                        reply = (choice.content or "").strip()
                        tool_calls = getattr(choice, "tool_calls", None)
                        if not tool_calls:
                            break

                        call = tool_calls[0]
                        name = call.function.name
                        yield _sse("stage", {"stage": "tool", "tool": name})

                        try:
                            args = json.loads(call.function.arguments or "{}")
                        except (TypeError, ValueError):
                            args = {}

                        result = run_schedule_tool(name, args, context)
                        logger.info(
                            "[schedule_chat] tool=%s ok=%s (круг %s)",
                            name,
                            result.get("ok"),
                            round_index + 1,
                        )

                        tool = SCHEDULE_TOOLS.get(name)
                        if tool and tool.creates_revision and result.get("revision_id"):
                            revision = ScheduleRevision.objects.filter(
                                pk=result["revision_id"], user_email=user_email
                            ).first()
                        if name == "propose_fixed_commitments" and result.get("ok"):
                            commitments = result.get("items")

                        call_id = getattr(call, "id", None) or f"{name}-{round_index}"
                        messages = [
                            *messages,
                            {
                                "role": "assistant",
                                "content": choice.content or "",
                                "tool_calls": [
                                    {
                                        "id": call_id,
                                        "type": "function",
                                        "function": {
                                            "name": name,
                                            "arguments": call.function.arguments or "{}",
                                        },
                                    }
                                ],
                            },
                            {
                                "role": "tool",
                                "tool_call_id": call_id,
                                "content": json.dumps(result, ensure_ascii=False),
                            },
                        ]

                    if revision is not None:
                        yield _sse(
                            "revision", ScheduleRevisionSerializer(revision).data
                        )
                    if commitments:
                        yield _sse("commitments", {"items": commitments})

                    yield _sse(
                        "content",
                        {
                            "text": reply
                            or "Готово. Посмотри предложенное изменение в календаре."
                        },
                    )
                    yield _sse("done", {"has_revision": revision is not None})
                except Exception as exc:  # noqa: BLE001
                    # Заголовки уже отправлены — HTTP-код не поменять, поэтому
                    # ошибка приезжает событием, и панель её показывает.
                    logger.error("Schedule chat error: %s", exc, exc_info=True)
                    yield _sse("error", {"error": str(exc)})

        response = StreamingHttpResponse(
            event_stream(), content_type="text/event-stream"
        )
        response["Cache-Control"] = "no-cache, no-transform"
        response["X-Accel-Buffering"] = "no"
        return response
