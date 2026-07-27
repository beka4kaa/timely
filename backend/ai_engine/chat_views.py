"""
POST /api/ai/chat/ — единая точка входа для чата на доске.

Заменяет прямой вызов /api/ai/draw из UI. Внутри — роутер скиллов: обычный
вопрос обслуживается одним дешёвым запросом, доска строится только по явной
просьбе ученика.
"""

import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .planning_intake import (
    PlanningIntakeValidationError,
    confirm_planning_intake,
    handle_planning_intake,
)
from .help_policy import check_help_allowed, resolve_profile
from .skills import route_and_run
from .tutor_modes import get_mode

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
    error_msg = str(exc)
    lowered = error_msg.lower()

    if "429" in error_msg:
        return Response(
            {"error": "Модель перегружена (rate limit). Подождите немного и попробуйте снова."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    if "timeout" in lowered or "timed out" in lowered:
        return Response(
            {"error": "Модель не ответила вовремя. Попробуйте ещё раз."},
            status=status.HTTP_504_GATEWAY_TIMEOUT,
        )
    if "connection" in lowered:
        return Response(
            {"error": "Не удалось связаться с моделью (сетевая ошибка). Попробуйте ещё раз."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return Response({"error": f"Ошибка AI: {error_msg}"}, status=status.HTTP_502_BAD_GATEWAY)


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
