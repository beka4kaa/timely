"""
POST /api/ai/chat/ — единая точка входа для чата на доске.

Заменяет прямой вызов /api/ai/draw из UI. Внутри — роутер скиллов: обычный
вопрос обслуживается одним дешёвым запросом, доска строится только по явной
просьбе ученика.
"""

import json
import logging

from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .llm_errors import llm_error_response
from .planning_intake import (
    PlanningIntakeValidationError,
    confirm_planning_intake,
    handle_planning_intake,
)
from .help_policy import check_help_allowed, resolve_profile
from .skills import route_and_run, route_and_run_streaming
from .solve_views import BOARD_LLM_BASE_URL, OPENROUTER_MODEL
from .tutor_modes import get_mode
from .usage import usage_scope

logger = logging.getLogger(__name__)


def _brief_text(value, limit: int) -> str:
    """Compact untrusted lesson-plan fields before adding them to a prompt."""
    if not isinstance(value, (str, int, float)):
        return ""
    return " ".join(str(value).split())[:limit]


def build_lesson_instruction(lesson_plan, active_task) -> str:
    """Turn the validated subset of the UI lesson plan into tutor context."""
    if not isinstance(lesson_plan, dict):
        return ""

    topic = _brief_text(lesson_plan.get("topic"), 180)
    objective = _brief_text(lesson_plan.get("objective"), 240)
    level = _brief_text(lesson_plan.get("levelLabel") or lesson_plan.get("level"), 80)
    result_type = _brief_text(lesson_plan.get("resultType"), 80)
    raw_difficulties = lesson_plan.get("difficulties")
    difficulties = []
    if isinstance(raw_difficulties, list):
        difficulties = [
            text
            for value in raw_difficulties[:4]
            if (text := _brief_text(value, 100))
        ]
    raw_criteria = lesson_plan.get("successCriteria")
    success_criteria = []
    if isinstance(raw_criteria, list):
        success_criteria = [
            text
            for value in raw_criteria[:4]
            if (text := _brief_text(value, 140))
        ]
    raw_tasks = lesson_plan.get("tasks")
    task_lines = []
    if isinstance(raw_tasks, list):
        for index, task in enumerate(raw_tasks[:8], start=1):
            if not isinstance(task, dict):
                continue
            title = _brief_text(task.get("title"), 80)
            description = _brief_text(task.get("description"), 180)
            if title:
                task_lines.append(f"{index}. {title}: {description}".rstrip(": "))

    current_title = ""
    current_description = ""
    if isinstance(active_task, dict):
        current_title = _brief_text(active_task.get("title"), 80)
        current_description = _brief_text(active_task.get("description"), 220)

    if not topic or not task_lines:
        return ""

    return "\n".join(
        [
            "КОНТЕКСТ ТЕКУЩЕГО УРОКА:",
            f"Тема: {topic}",
            f"Цель: {objective}" if objective else "",
            f"Уровень: {level}" if level else "",
            f"Результат на доске: {result_type}" if result_type else "",
            (
                f"Особый фокус: {'; '.join(difficulties)}"
                if difficulties
                else ""
            ),
            (
                f"Критерии успеха: {'; '.join(success_criteria)}"
                if success_criteria
                else ""
            ),
            "План:",
            *task_lines,
            f"Текущий этап: {current_title}" if current_title else "",
            (
                f"Задача текущего этапа: {current_description}"
                if current_description
                else ""
            ),
            (
                "Следуй текущему этапу, не переписывай план молча и не перескакивай "
                "к следующим этапам без необходимости. Ответ должен помогать завершить "
                "именно текущую задачу урока."
            ),
        ]
    ).strip()


def build_hint_instruction(rung: int, title: str) -> str:
    """Инструкция модели выдать РОВНО одну ступень лестницы помощи (§5.5).

    Ступень выбирает backend, а не модель: без этого «дай подсказку» превращалось
    бы в полное решение с первого нажатия — именно так модель и понимает просьбу
    о помощи, если её не ограничить.
    """
    return (
        f"ЗАПРОС ПОДСКАЗКИ. Выдай ровно одну подсказку уровня {rung}: «{title}».\n"
        "- Не давай подсказку более высокого уровня и не решай задачу целиком.\n"
        "- Одна короткая подсказка, затем верни ход ученику вопросом."
    )


def error_response(exc: Exception) -> Response:
    """Ошибки провайдера → понятные HTTP-коды и текст для UI."""
    return llm_error_response(exc, base_url=BOARD_LLM_BASE_URL, model=OPENROUTER_MODEL)


class BoardChatView(APIView):
    """
    Body: { message, history[], style?, palette?, reference_image_url?, reference_labels? }
    Returns: { reply, board|null, model, skill }

    `skill` — какой навык отработал ("chat" | "draw_board"). Фронтенд по нему
    понимает, ждать ли отрисовку, а в логах видно распределение запросов.
    """

    def post(self, request):
        data = request.data
        request_type = data.get("type")
        if request_type in {"planning_intake", "confirm_planning_intake"}:
            try:
                if request_type == "confirm_planning_intake":
                    return Response(confirm_planning_intake(data))
                return Response(handle_planning_intake(data))
            except PlanningIntakeValidationError as exc:
                return Response(
                    {"error": str(exc), "code": "invalid_planning_intake"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        user_message = (data.get("message") or "").strip()

        if not user_message:
            return Response(
                {"error": "Пустое сообщение. Напишите вопрос или что нарисовать."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reference_labels = data.get("reference_labels")
        if not (isinstance(reference_labels, list) and reference_labels):
            reference_labels = None

        # Режим и права разрешает СЕРВЕР. Клиент присылает только пожелание —
        # slug режима и профиль помощи, — а `get_mode` и `resolve_profile`
        # приводят их к допустимым значениям: неизвестный slug молча становится
        # режимом по умолчанию, а профиль умеет лишь ужесточать политику режима.
        # Так «режим» остаётся правилом, а не полем, которым клиент открывает
        # себе готовые ответы (PRODUCT.md §3.3).
        mode = get_mode(data.get("mode"))
        policy = resolve_profile(mode.policy, data.get("help_profile"))

        def as_int(key: str) -> int:
            try:
                return max(0, int(data.get(key) or 0))
            except (TypeError, ValueError):
                return 0

        hint_level = as_int("hint_level")
        attempts = as_int("attempts")

        # Просьба о подсказке — отдельный ход, а не обычное сообщение: ступень
        # выдаёт backend по политике режима, поэтому клиент не может получить
        # решение, просто нажав «подсказка» нужное число раз.
        instructions = [
            build_lesson_instruction(data.get("lesson_plan"), data.get("active_lesson_task"))
        ]
        granted_rung = None
        if data.get("request_hint"):
            decision = check_help_allowed(policy, attempts=attempts, hint_level=hint_level)
            if not decision.allowed:
                return Response(
                    {
                        "reply": decision.reason,
                        "policy_blocked": True,
                        "mode": mode.slug,
                        "policy": policy.as_dict(),
                        "hint_level": hint_level,
                    }
                )
            granted_rung = decision.granted_rung
            instructions.append(build_hint_instruction(granted_rung, decision.rung_title))

        try:
            result = route_and_run(
                user_message=user_message,
                history=data.get("history", []),
                mode=mode.slug,
                # Контекст инструментов §5.7. Пользователя берём из запроса, а не
                # из аргументов модели: иначе «инструмент» стал бы способом
                # прочитать чужой прогресс по подсказке в промпте.
                user_email=getattr(request, "user_email", "") or "",
                topic_name=(
                    (data.get("lesson_plan") or {}).get("topic")
                    if isinstance(data.get("lesson_plan"), dict)
                    else ""
                ),
                style=data.get("style"),
                palette=data.get("palette"),
                reference_image_url=data.get("reference_image_url") or None,
                reference_labels=reference_labels,
                # defer_images=true → доска возвращается без картинок, фронтенд
                # догружает их через /api/ai/illustration (прогрессивная выдача).
                enrich_images=not bool(data.get("defer_images")),
                lesson_instruction="\n\n".join(part for part in instructions if part),
            )
            payload = result.as_payload()
            # Фронтенду нужен разрешённый режим и его политика: по ним рисуется
            # активный пункт переключателя и решается, показывать ли кнопку
            # подсказки. Считать это на клиенте нельзя — он не владеет правилами.
            payload["mode"] = mode.slug
            payload["policy"] = policy.as_dict()
            if granted_rung is not None:
                # Клиент запоминает достигнутую ступень и присылает её в
                # следующем запросе — лестница движется только вперёд.
                payload["hint_level"] = granted_rung
            return Response(payload)
        except Exception as exc:  # noqa: BLE001 — маппим на HTTP ниже
            logger.error("Board chat error: %s", exc, exc_info=True)
            return error_response(exc)


def _sse(event: str, data: dict) -> str:
    """Одно Server-Sent Event.

    ensure_ascii=False — иначе кириллица раздувается в \\uXXXX и поток
    становится втрое тяжелее. separators без пробелов — по той же причине.
    """
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


class BoardChatStreamView(APIView):
    """POST /api/ai/chat/stream/ — то же, что BoardChatView, но потоком.

    Отдаёт Server-Sent Events, чтобы фронтенд показывал живой ход мысли модели
    («Думаю…») и печатал ответ по мере генерации, а не ждал молча 20-60 секунд.

    События: reasoning | content | stage | done | error.
    Нестримящий /api/ai/chat/ остаётся рабочим — на нём планировщик урока.
    """

    def post(self, request):
        data = request.data
        user_message = (data.get("message") or "").strip()
        if not user_message:
            return Response(
                {"error": "Пустое сообщение. Напишите вопрос или что нарисовать."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reference_labels = data.get("reference_labels")
        if not (isinstance(reference_labels, list) and reference_labels):
            reference_labels = None

        kwargs = dict(
            user_message=user_message,
            history=data.get("history", []),
            style=data.get("style"),
            palette=data.get("palette"),
            reference_image_url=data.get("reference_image_url") or None,
            reference_labels=reference_labels,
            enrich_images=not bool(data.get("defer_images")),
            lesson_instruction=build_lesson_instruction(
                data.get("lesson_plan"),
                data.get("active_lesson_task"),
            ),
        )

        # StreamingHttpResponse итерируется УЖЕ ПОСЛЕ того, как middleware
        # вернуло ответ, поэтому usage_scope из AIUsageContextMiddleware к тому
        # моменту закрыт, а contextvar сброшен. Без повторного входа в скоуп
        # внутри генератора record_model_usage не увидит user_email и молча
        # ничего не запишет. Поэтому забираем email здесь, синхронно.
        user_email = getattr(request, "user_email", None)

        def event_stream():
            with usage_scope(user_email=user_email, feature="chat_stream"):
                try:
                    for event, payload in route_and_run_streaming(**kwargs):
                        yield _sse(event, payload)
                except Exception as exc:  # noqa: BLE001
                    # Заголовки уже отправлены — HTTP-код не поменять, поэтому
                    # ошибка приезжает событием, и фронтенд её показывает.
                    logger.error("Board chat stream error: %s", exc, exc_info=True)
                    body = error_response(exc).data
                    yield _sse("error", body)

        response = StreamingHttpResponse(
            event_stream(), content_type="text/event-stream"
        )
        # no-transform — не косметика, а обязательное условие стриминга.
        # Next.js проксирует /api/ai/* и по умолчанию сжимает ответ gzip'ом.
        # Компрессор копит данные в своём буфере, поэтому браузер получал ВСЕ
        # события одним куском в самом конце: замерено — 124 reasoning-фрейма
        # с firstReasoningMs == totalMs == 6051. Блок «Думаю…» при этом тикал
        # секундами, но текст рассуждения не появлялся ни разу. Директива
        # no-transform запрещает промежуточным звеньям пересжимать тело, и
        # поток снова идёт по мере генерации.
        response["Cache-Control"] = "no-cache, no-transform"
        # Northflank проксирует через istio-envoy, а тот (как и nginx) охотно
        # буферизует ответ и склеивает весь поток в один кусок — стриминг
        # превращается в обычный долгий запрос. Заголовок это отключает.
        response["X-Accel-Buffering"] = "no"
        return response
