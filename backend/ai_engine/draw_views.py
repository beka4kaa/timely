import json
import re
import time
import logging

from openai import APIConnectionError
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

# Reuse the already-configured OpenRouter client + model from solve_views
from .solve_views import openrouter_client, OPENROUTER_MODEL

# Image enrichment: resolves image_prompt → image_url via BananaPro / gemini-pro-image
from .image_enrichment import enrich_board_steps

logger = logging.getLogger(__name__)


# The AI explains and draws on a virtual "lesson board" using a small set of
# MACRO commands. Instead of asking the model to hand-draw complex structures
# (tables, charts) out of primitive lines/shapes — which it does poorly and
# slowly — it only supplies the DATA, and the frontend (AITutorBoard component)
# renders the table/formula/chart as a pixel-perfect, pre-built widget.
DRAW_SYSTEM_PROMPT = r"""Ты — интерактивный AI-учитель на цифровой доске. Твоя задача — решить задачу ученика и выдать ответ СТРОГО в формате JSON для отрисовки на холсте.

ПРАВИЛА:
1. Запрещён любой текст вне JSON — ни до, ни после, ни в markdown-обёртке (```).
2. Для любых рисунков, схем, геометрии (кубы, круги, графики и т.д.) ВСЕГДА используй команду "image_with_labels". Эта команда триггерит мощный генератор изображений. НЕ пытайся рисовать примитивами.
3. Доска имеет координаты X и Y в виртуальном пространстве ~960×680 (0,0 — левый верхний угол). Располагай элементы ПОСЛЕДОВАТЕЛЬНО сверху вниз, с отступом минимум 80–120px по Y между ними — не накладывай их друг на друга.
4. Не более 10 команд суммарно по всем шагам (это важно для скорости генерации).
5. Если рисовать ничего не нужно (чистая теория/объяснение) — верни "board_steps": [] или шаги с пустыми "commands": [].
6. "reply" — короткий ответ ученику в чат (1-3 предложения, на языке вопроса).

СТРУКТУРА ОТВЕТА (строго такие ключи верхнего уровня):
{
  "reply": "короткий ответ ученику в чат",
  "subject": "предмет, например 'Физика'",
  "topic": "тема задачи одной строкой",
  "board_steps": [
    {"step_number": 1, "title": "название шага", "commands": [ ...команды ниже... ]}
  ]
}

JSON-СХЕМА КОМАНД (массив "commands" внутри каждого шага board_steps):

- Текст: {"type": "text", "x": число, "y": число, "content": "строка"}

- Формула / математика:
  {"type": "formula", "x": число, "y": число, "content": "ТОЛЬКО LaTeX-код, БЕЗ знаков $ ... $, например: F = m \\cdot a"}

- Таблица (рендерится идеальной HTML-сеткой — передавай ТОЛЬКО данные):
  {"type": "table", "x": число, "y": число,
   "headers": ["Величина", "Обозначение", "Единица"],
   "rows": [["Сила", "F", "Н"], ["Масса", "m", "кг"]]}

- Столбчатая диаграмма / гистограмма:
  {"type": "barchart", "x": число, "y": число, "width": 360, "height": 240,
   "title": "опционально, заголовок графика",
   "labels": ["2", "3", "4", "5"], "values": [3, 7, 12, 8]}

- Генерация изображения (Используй для ВСЕХ визуальных чертежей, геометрических фигур, иллюстраций, схем!):
  {
    "type": "image_with_labels",
    "image_prompt": "Описание ТОЛЬКО содержимого/композиции на АНГЛИЙСКОМ — какие объекты, их форма, цвет, взаимное расположение и ракурс. БЕЗ художественного стиля и БЕЗ текста на изображении. Например: 'a cube and a sphere resting side by side on a flat surface, cube on the left in a muted blue tone, sphere on the right in a soft coral tone, viewed from a three-quarter angle'",
    "requires_segmentation": false,
    "alt": "Схема нейрона",
    "labels": [
      {
        "content": "Верхняя грань",
        "x": 50,
        "y": 20,
        "color": "#ffffff",
        "arrow_to": {"x": 50, "y": 30}
      }
    ]
  }

  ПРАВИЛА для image_with_labels:
  • Это твой ЕДИНСТВЕННЫЙ способ рисовать. Используй его для всего, что требует рисунка.
  • image_prompt — ТОЛЬКО английский, и описывает ТОЛЬКО СОДЕРЖАНИЕ: какие объекты на картинке, их форма, цвет, взаимное расположение, пропорции, ракурс/перспектива. НЕ пиши слова о художественном стиле ('3d render', 'minimalist', 'realistic', 'cartoon', 'sketch', 'photo' и т.п.) — единый визуальный стиль для ВСЕХ иллюстраций уже жёстко задан системой централизованно (это сделано специально, чтобы все картинки в уроке выглядели так, будто их нарисовал один художник в одной манере). Твоя задача — только описать ЧТО изображено, а не КАК это нарисовано.
  • Никогда не упоминай текст, подписи, цифры или надписи внутри image_prompt — для подписей есть отдельное поле "labels".
  • x/y в labels — проценты от размера изображения (0–100), НЕ пиксели.
  • arrow_to — координаты цели стрелки в тех же процентах.
  • content может содержать LaTeX: "$F = ma$".
  • "requires_segmentation" (boolean) — нужно ли ВЫРЕЗАТЬ отдельные объекты на картинке для интерактивной подсветки:
    – Ставь FALSE по умолчанию — для пейзажей, сцен, процессов, диаграмм-схем, где подписи просто указывают на области целостной картинки. Примеры FALSE: «круговорот воды», «строение атмосферы», «экосистема леса», «солнечная система», карта, любой пейзаж или непрерывная сцена.
    – Ставь TRUE ТОЛЬКО когда на картинке есть НЕСКОЛЬКО ЧЁТКО ОТДЕЛЬНЫХ физических объектов, каждый из которых нужно выделить по контуру. Примеры TRUE: «органеллы внутри клетки» (ядро, митохондрия, рибосома — отдельные тела), «детали механизма», «геометрические тела рядом» (куб и сфера), «органы человека на схеме».
    – Если сомневаешься — ставь FALSE.

ВЕРНИ ТОЛЬКО ВАЛИДНЫЙ JSON ПО ЭТОЙ СХЕМЕ. Никакого текста до или после.
"""


def _extract_json(text: str):
    """Best-effort extraction of the outermost JSON object from a model reply."""
    if not text:
        return None
    cleaned = text.replace("```json", "").replace("```", "").strip()
    # Fast path
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # Fallback: grab from first '{' to last '}'
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = cleaned[start : end + 1]
        try:
            return json.loads(snippet)
        except Exception:
            return None
    return None


# Command types the frontend AITutorBoard component understands
# (board_steps[].commands[].type).
# `image_with_labels` is a macro: Llama emits it with `image_prompt`, the
# enrichment service replaces image_prompt with image_url before the response
# reaches the frontend ScientificIllustration component.
_ALLOWED_COMMANDS = {"text", "line", "circle", "rect", "formula", "table", "barchart", "image_with_labels"}


def _num(value, fallback=0):
    try:
        if isinstance(value, bool):
            return fallback
        return float(value) if not isinstance(value, (int, float)) else value
    except (TypeError, ValueError):
        return fallback


def _sanitize_command(cmd):
    """Validate & coerce a single board command into the shape AITutorBoard expects.
    Returns None if the command is malformed or of an unknown type."""
    if not isinstance(cmd, dict):
        return None
    t = cmd.get("type")
    if t not in _ALLOWED_COMMANDS:
        return None

    if t == "text":
        content = cmd.get("content")
        if not isinstance(content, str) or not content.strip():
            return None
        out = {"type": "text", "x": _num(cmd.get("x")), "y": _num(cmd.get("y")), "content": content}
        if isinstance(cmd.get("color"), str):
            out["color"] = cmd["color"]
        if "fontSize" in cmd:
            out["fontSize"] = _num(cmd.get("fontSize"), None)
        return out

    if t == "line":
        out = {
            "type": "line",
            "x1": _num(cmd.get("x1")),
            "y1": _num(cmd.get("y1")),
            "x2": _num(cmd.get("x2")),
            "y2": _num(cmd.get("y2")),
        }
        if isinstance(cmd.get("color"), str):
            out["color"] = cmd["color"]
        return out

    if t in ("circle", "rect"):
        # Pass through with light validation — used sparingly for simple diagrams.
        if not isinstance(cmd, dict):
            return None
        return cmd

    if t == "formula":
        content = cmd.get("content")
        if not isinstance(content, str) or not content.strip():
            return None
        # Strip stray `$...$` wrappers in case the model adds them anyway.
        clean_content = content.strip().strip("$").strip()
        return {"type": "formula", "x": _num(cmd.get("x")), "y": _num(cmd.get("y")), "content": clean_content}

    if t == "table":
        rows = cmd.get("rows")
        if not isinstance(rows, list) or not rows:
            return None
        clean_rows = []
        for row in rows:
            if isinstance(row, list):
                clean_rows.append([str(cell) for cell in row])
        if not clean_rows:
            return None
        out = {"type": "table", "x": _num(cmd.get("x")), "y": _num(cmd.get("y")), "rows": clean_rows}
        headers = cmd.get("headers")
        if isinstance(headers, list) and headers:
            out["headers"] = [str(h) for h in headers]
        return out

    if t == "barchart":
        labels = cmd.get("labels")
        values = cmd.get("values")
        if not isinstance(labels, list) or not isinstance(values, list) or not values:
            return None
        clean_values = [_num(v, 0) for v in values]
        out = {
            "type": "barchart",
            "x": _num(cmd.get("x")),
            "y": _num(cmd.get("y")),
            "labels": [str(l) for l in labels],
            "values": clean_values,
        }
        for key in ("width", "height"):
            if key in cmd:
                out[key] = _num(cmd.get(key))
        if isinstance(cmd.get("title"), str):
            out["title"] = cmd["title"]
        if isinstance(cmd.get("color"), str):
            out["color"] = cmd["color"]
        return out

    if t == "image_with_labels":
        # Must have either image_prompt (pre-enrichment) or image_url (post-enrichment).
        has_prompt = isinstance(cmd.get("image_prompt"), str) and cmd["image_prompt"].strip()
        has_url = isinstance(cmd.get("image_url"), str) and cmd["image_url"].strip()
        if not has_prompt and not has_url:
            return None

        out: dict = {"type": "image_with_labels"}

        if has_prompt:
            out["image_prompt"] = cmd["image_prompt"].strip()
        if has_url:
            out["image_url"] = cmd["image_url"].strip()

        # requires_segmentation: решение Llama, нужно ли резать картинку SAM2.
        # Прокидываем его в команду ДО обогащения (enrich_board_steps читает
        # этот флаг). По умолчанию False — для сцен/пейзажей сегментация не
        # нужна, достаточно картинки + подписей.
        out["requires_segmentation"] = bool(cmd.get("requires_segmentation", False))

        # alt text (optional)
        if isinstance(cmd.get("alt"), str) and cmd["alt"].strip():
            out["alt"] = cmd["alt"].strip()

        # labels: [{content, x, y, color?, fontSize?, arrow_to?}]
        raw_labels = cmd.get("labels")
        if isinstance(raw_labels, list):
            clean_labels = []
            for lbl in raw_labels:
                if not isinstance(lbl, dict):
                    continue
                content = lbl.get("content")
                if not isinstance(content, str) or not content.strip():
                    continue
                clean_lbl: dict = {
                    "content": content.strip(),
                    "x": _num(lbl.get("x"), 0),
                    "y": _num(lbl.get("y"), 0),
                }
                if isinstance(lbl.get("color"), str):
                    clean_lbl["color"] = lbl["color"]
                if "fontSize" in lbl:
                    clean_lbl["fontSize"] = _num(lbl["fontSize"], 0.85)
                # arrow_to: {x, y}
                arrow = lbl.get("arrow_to")
                if isinstance(arrow, dict) and "x" in arrow and "y" in arrow:
                    clean_lbl["arrow_to"] = {
                        "x": _num(arrow["x"], 0),
                        "y": _num(arrow["y"], 0),
                    }
                clean_labels.append(clean_lbl)
            out["labels"] = clean_labels
        else:
            out["labels"] = []

        # Preserve image_error if already present (post-enrichment fallback)
        if isinstance(cmd.get("image_error"), dict):
            out["image_error"] = cmd["image_error"]

        return out

    return None


def _sanitize_board_data(parsed):
    """Validate & coerce `board_steps` from the model reply into the BoardData
    shape the frontend AITutorBoard component expects. Returns None when there
    is nothing meaningful to draw."""
    if not isinstance(parsed, dict):
        return None
    steps_in = parsed.get("board_steps")
    if not isinstance(steps_in, list) or not steps_in:
        return None

    steps = []
    for i, step in enumerate(steps_in):
        if not isinstance(step, dict):
            continue
        commands_in = step.get("commands")
        commands = []
        if isinstance(commands_in, list):
            for c in commands_in:
                clean = _sanitize_command(c)
                if clean is not None:
                    commands.append(clean)
        if not commands:
            continue
        steps.append(
            {
                "step_number": step.get("step_number") if isinstance(step.get("step_number"), int) else i + 1,
                "title": step.get("title") if isinstance(step.get("title"), str) else f"Шаг {i + 1}",
                "commands": commands,
            }
        )

    if not steps:
        return None

    return {
        "subject": parsed.get("subject") if isinstance(parsed.get("subject"), str) else "",
        "topic": parsed.get("topic") if isinstance(parsed.get("topic"), str) else "",
        "board_steps": steps,
    }


class WhiteboardDrawView(APIView):
    """
    POST /api/ai/draw/
    Body: { "message": "...", "history": [ {role, content}, ... ] }
    Returns: { "reply": "...", "actions": [ ...store actions... ], "model": "..." }
    """

    def post(self, request):
        data = request.data
        user_message = (data.get("message") or "").strip()
        history = data.get("history", [])
        # Стиль/палитра выбираются в UI (StyleSelector) и шлются фронтендом —
        # применяются ко всем иллюстрациям этого ответа (см. enrich_board_steps).
        gen_style = data.get("style")
        gen_palette = data.get("palette")
        # reference_image_url — URL/Data URL существующей картинки на доске.
        # Передаётся фронтендом, когда пользователь меняет стиль УЖЕ нарисованного
        # изображения. Включает нативный image-to-image (edit) у Gemini/Nano Banana:
        # картинка идёт как настоящий image-input, модель сохраняет композицию
        # своим edit-механизмом и перерисовывает только стиль (см. _call_image_api).
        gen_reference_image_url: str | None = data.get("reference_image_url") or None

        if not user_message:
            return Response(
                {"error": "Пустое сообщение. Напишите, что нарисовать или объяснить."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        messages = [{"role": "system", "content": DRAW_SYSTEM_PROMPT}]
        for msg in history[-8:]:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_message})

        try:
            logger.info(f"Whiteboard draw request → OpenRouter ({OPENROUTER_MODEL})")
            # OpenRouter connectivity from this host is occasionally flaky.
            # Connection errors fail instantly, so retry a few times quickly
            # (this does NOT risk the long hangs that slow-request retries do).
            response = None
            last_conn_err = None
            for attempt in range(3):
                try:
                    response = openrouter_client.chat.completions.create(
                        model=OPENROUTER_MODEL,
                        messages=messages,
                        max_tokens=1200,
                        temperature=0.4,
                        timeout=75,
                    )
                    break
                except APIConnectionError as ce:
                    last_conn_err = ce
                    logger.warning(f"OpenRouter connection error (attempt {attempt + 1}/3), retrying…")
                    time.sleep(1.5)
            if response is None:
                raise last_conn_err if last_conn_err else Exception("No response from model")
            raw = response.choices[0].message.content or ""
            parsed = _extract_json(raw)

            if not parsed or not isinstance(parsed, dict):
                # Model didn't return JSON — treat the whole thing as a chat reply.
                return Response({"reply": raw.strip() or "Не удалось сформировать ответ.", "board": None})

            reply = parsed.get("reply") or ""
            board = _sanitize_board_data(parsed)

            # ── Обогащение иллюстраций ─────────────────────────────────────────
            # Команды `image_with_labels` с `image_prompt` прогоняются через
            # пайплайн (image_enrichment._enrich_command →
            # illustration_pipeline.build_vector_illustration). На выходе —
            # строгий контракт {base_image_url, labels, masks}:
            #   • base_image_url — ВСЕГДА оригинальная картинка от Banana;
            #   • masks — опц. полигоны SAM2, ТОЛЬКО если Llama выставила
            #     requires_segmentation=true (для сцен/пейзажей — null);
            # При сбое генерации — image_error (фронтенд покажет текст-ошибку).
            if board and isinstance(board.get("board_steps"), list):
                board["board_steps"] = enrich_board_steps(
                    board["board_steps"],
                    topic_hint=board.get("topic") or "",
                    style=gen_style,
                    palette=gen_palette,
                    reference_image_url=gen_reference_image_url,
                )
            # ──────────────────────────────────────────────────────────────────

            payload = {"reply": (reply or "").strip(), "board": board, "model": OPENROUTER_MODEL}
            return Response(payload)

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Whiteboard draw error: {error_msg}", exc_info=True)

            if "429" in error_msg:
                return Response(
                    {"error": "Модель перегружена (rate limit). Подождите немного и попробуйте снова."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            if "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
                return Response(
                    {"error": "Модель не ответила вовремя. Попробуйте ещё раз."},
                    status=status.HTTP_504_GATEWAY_TIMEOUT,
                )
            if "connection" in error_msg.lower():
                return Response(
                    {"error": "Не удалось связаться с моделью (сетевая ошибка). Попробуйте ещё раз."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            return Response(
                {"error": f"Ошибка AI: {error_msg}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
