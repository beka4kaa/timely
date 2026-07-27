import json
import re
import logging

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

# Генерация доски переехала в ai_engine.skills.board (BoardSkill) — здесь
# остались DSL-промпт, санитайзеры и legacy-вью, делегирующая в скилл. Вызов
# модели и обогащение иллюстраций живут в скилле, поэтому клиент OpenRouter и
# enrich_board_steps тут больше не импортируются.

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
3. Для лекций/теории/пошаговых объяснений НЕ пытайся верстать текст пиксельными координатами. Верни команды в порядке чтения: короткий текстовый блок → формула/таблица/иллюстрация при необходимости → следующий текстовый блок. Фронтенд сам детерминированно разложит это на доске колонками сверху вниз, затем в новый столбец. Для text/formula/table/barchart можно ставить x=0,y=0.
4. Не более 10 команд суммарно по всем шагам (это важно для скорости генерации).
4a. КРИТИЧНО, сколько делать иллюстраций. Правило одно: ОДНА ФИЗИЧЕСКАЯ СИТУАЦИЯ = ОДНА картинка.
   • Если пользователь описал ОДНУ ситуацию — сделай РОВНО ОДНУ "image_with_labels", даже если разбираешь её в несколько этапов. НЕ дроби одну сцену на картинку-на-этап.
   • Если в запросе НЕСКОЛЬКО РАЗНЫХ задач или сцен (брусок на плоскости; отдельно маятник; отдельно блок с грузом) — сделай ОТДЕЛЬНУЮ "image_with_labels" на каждую. НЕ склеивай разные задачи в один кадр: получается нечитаемая каша, где ничего не разобрать.
   • Максимум 4 иллюстрации на ответ. Если задач больше — возьми 4 самые важные и скажи об этом текстом.
4b. КРИТИЧНО, сколько подписей. Максимум 6 labels на ОДНУ иллюстрацию, и это потолок, а не цель. Подписывай только то, без чего рисунок не понять. Если подписей просится больше — это верный признак, что ты пытаешься уместить в один кадр несколько разных сцен: раздели их по правилу 4a.
5. Если рисовать ничего не нужно (чистая теория/объяснение) — верни "board_steps": [] или шаги с пустыми "commands": [].
5a. Если пользователь просит «полную лекцию», «объясни тему», «как учитель на доске» — обязательно дели материал на 3–7 коротких text/formula/table блоков, не одним огромным текстом. Длинный абзац хуже: его сложнее читать и он чаще пересекается с рисунками.
6. "reply" — короткий ответ ученику в чат (1-3 предложения, на языке вопроса).
7. "intent" — ОБЯЗАТЕЛЬНАЯ классификация запроса:
   • "restyle" — пользователь просит перерисовать УЖЕ СОЗДАННУЮ иллюстрацию в другом стиле/виде, НЕ меняя тему и состав сцены: «сделай скетч», «do 3d», «теперь в другом стиле», «перерисуй красивее», «сделай 2.5d» и т.п. Смотри на историю диалога: если до этого была нарисована иллюстрация и запрос — короткая команда про стиль/вид, это restyle. При restyle поле image_prompt должно описывать ТО ЖЕ СОДЕРЖАНИЕ, что у предыдущей иллюстрации; labels можешь не придумывать заново — система переиспользует подписи предыдущей картинки.
   • "new" — новая тема, другой вопрос, либо содержательное изменение сцены («добавь горы», «убери реку», «нарисуй клетку»).
   Если сомневаешься — ставь "new".
8. История диалога — слабый контекст. ТЕКУЩЕЕ сообщение пользователя всегда главный источник содержания. Не переноси объекты, стрелки, подписи, цвета или тему из прошлых картинок, если пользователь явно не просит «то же самое», «эту картинку», «продолжи», «добавь/убери» или сменить стиль текущей иллюстрации.

СТРУКТУРА ОТВЕТА (строго такие ключи верхнего уровня):
{
  "reply": "короткий ответ ученику в чат",
  "intent": "restyle | new",
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
        "target_kind": "object",
        "x": 50,
        "y": 20,
        "arrow_to": {"x": 50, "y": 30}
      }
    ]
  }

  ПРАВИЛА для image_with_labels:
  • Это твой ЕДИНСТВЕННЫЙ способ рисовать. Используй его для всего, что требует рисунка.
  • image_prompt — ТОЛЬКО английский, и описывает ТОЛЬКО СОДЕРЖАНИЕ: какие объекты на картинке, их форма, цвет, взаимное расположение, пропорции, ракурс/перспектива. НЕ пиши слова о художественном стиле ('3d render', 'minimalist', 'realistic', 'cartoon', 'sketch', 'photo' и т.п.) — единый визуальный стиль для ВСЕХ иллюстраций уже жёстко задан системой централизованно (это сделано специально, чтобы все картинки в уроке выглядели так, будто их нарисовал один художник в одной манере). Твоя задача — только описать ЧТО изображено, а не КАК это нарисовано.
  • Никогда не упоминай текст, подписи, цифры или надписи внутри image_prompt — для подписей есть отдельное поле "labels".
  • ВАЖНО: названия процессов/объектов тоже НЕ должны быть просьбой написать слова на картинке. В image_prompt описывай визуальные признаки, объекты, движение, стрелки и взаимное расположение; любые слова для пользователя клади только в labels.content.
  • Для задач по физике/математике/механике сначала зафиксируй ТОПОЛОГИЮ сцены: точное число тел, поверхностей, опор, нитей/пружин и стрелок. Каждый запрошенный объект рисуется ровно один раз. Не добавляй фон, пейзаж, декоративные элементы, лишние механизмы, направляющие и стрелки “для красоты”.
  • НАКЛОННАЯ ПЛОСКОСТЬ: image_prompt обязан требовать ровно ОДИН брусок на ровно ОДНОЙ связной наклонной поверхности. Нижняя грань бруска непосредственно касается верхней границы плоскости. Запрещены вторая параллельная рейка/полоса/полка, дополнительный клин, подпорка, ножка или платформа под/за бруском.
  • СИЛЫ: одна сила = одна односторонняя стрелка. Хвост каждой стрелки силы начинается в центре тела, наконечник направлен ОТ тела: mg строго вниз, N перпендикулярно наружу от поверхности, трение вдоль поверхности против движения. Запрещены двусторонние, дублирующиеся и пересекающиеся стрелки, а также стрелки-выноски, направленные наконечником в центр тела.
  • x/y в labels — проценты от размера изображения (0–100), НЕ пиксели.
  • target_kind в каждой labels — один из: "object", "vector", "angle", "region". Для подписи силы ставь "vector"; для угла — "angle"; для тела/детали — "object"; для процесса/зоны — "region".
  • arrow_to — координаты СМЫСЛОВОЙ ЦЕЛИ в тех же процентах: у "vector" это середина древка соответствующей стрелки силы (НИКОГДА не центр тела), у "angle" — середина дуги, у "object" — центр объекта, у "region" — центр области.
  • x/y — ближайшее свободное место рядом с arrow_to. Не клади текст на тело, стрелку или другую подпись; не выноси его далеко через весь рисунок.
  • content может содержать LaTeX: "$F = ma$".
  • Не задавай цвет подписи. Цвет overlay-текста выбирает приложение автоматически: только чёрный или белый по яркости фона.
  • "requires_segmentation" (boolean) — нужно ли ВЫРЕЗАТЬ отдельные объекты на картинке для интерактивной подсветки:
    – Ставь FALSE по умолчанию — для пейзажей, сцен, процессов, карт, непрерывных систем и диаграмм-схем, где подписи просто указывают на области целостной картинки.
    – Ставь TRUE ТОЛЬКО когда на картинке есть НЕСКОЛЬКО ЧЁТКО ОТДЕЛЬНЫХ физических объектов, каждый из которых нужно выделить по контуру. Примеры TRUE: «органеллы внутри клетки» (ядро, митохондрия, рибосома — отдельные тела), «детали механизма», «геометрические тела рядом» (куб и сфера), «органы человека на схеме».
    – Если сомневаешься — ставь FALSE.

ВЕРНИ ТОЛЬКО ВАЛИДНЫЙ JSON ПО ЭТОЙ СХЕМЕ. Никакого текста до или после.
"""


# В JSON валидны только escape-последовательности \" \\ \/ \b \f \n \r \t и
# \uXXXX. Любой другой бэкслеш делает весь документ невалидным.
#
# Почему это важно именно здесь: board-DSL просит подписи в LaTeX ($N$,
# $F_{тр}$, $30^\circ$), а команды LaTeX начинаются с бэкслеша. Модель почти
# всегда пишет его ОДИНАРНЫМ — «$30^\circ$» вместо «$30^\\circ$». Один такой
# символ ронял разбор ВСЕГО ответа, и вместо доски пользователь видел в чате
# простыню сырого JSON (см. ветку «Модель не выдала JSON» в skills/board.py).
# Ловим и \u, за которым нет четырёх hex-цифр: «\upsilon» тоже не escape.
#
# Сканируем ПАРАМИ, а не «бэкслеш + заглядывание вперёд»: иначе на уже
# корректном «\\circ» второй бэкслеш выглядит как одиночный перед «c» и его
# удваивают — получается «\\\circ», то есть починка сама всё ломает.
# Альтернатива ниже сначала съедает валидный escape целиком, поэтому его вторая
# половина под замену уже не попадает.
_JSON_ESCAPE_SCAN_RE = re.compile(r'\\(u[0-9a-fA-F]{4}|["\\/bfnrt])|\\')


def _repair_json_escapes(text: str) -> str:
    """Удваивает бэкслеши, не образующие валидный JSON-escape."""
    return _JSON_ESCAPE_SCAN_RE.sub(
        lambda match: match.group(0) if match.group(1) else "\\\\",
        text,
    )


# Вторая, более коварная половина той же проблемы. Часть команд LaTeX начинается
# с букв, которые в JSON ЗНАЧАТ управляющий символ:
#     \theta → TAB + "heta"      \frac → FF + "rac"
#     \beta  → BS  + "eta"       \nu   → LF + "u"      \rho → CR + "ho"
# Такой документ парсится УСПЕШНО, ошибки нет — подпись просто молча портится,
# и на доску вместо «θ» приезжает «<таб>heta». Поэтому внутри математических
# вставок ($...$) удваиваем ОДИНОЧНЫЕ бэкслеши: там бэкслеш — это всегда
# команда LaTeX и никогда не JSON-escape. Уже удвоенные не трогаем.
_MATH_SPAN_RE = re.compile(r"\$[^$\n]{1,300}\$")
_LONE_BACKSLASH_RE = re.compile(r"(?<!\\)\\(?!\\)")


def _escape_latex_in_math_spans(text: str) -> str:
    return _MATH_SPAN_RE.sub(
        lambda match: _LONE_BACKSLASH_RE.sub(r"\\\\", match.group(0)),
        text,
    )


def _extract_json(text: str):
    """Best-effort extraction of the outermost JSON object from a model reply."""
    if not text:
        return None
    cleaned = text.replace("```json", "").replace("```", "").strip()

    candidates = [cleaned]
    # Fallback: grab from first '{' to last '}'
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(cleaned[start : end + 1])

    for candidate in candidates:
        repaired = _repair_json_escapes(_escape_latex_in_math_spans(candidate))
        # Починенный вариант ПЕРВЫМ: на валидном JSON без LaTeX он совпадает с
        # исходным (обе замены — no-op), а на LaTeX-подписях только он и даёт
        # верный текст. Исходный остаётся запасным.
        for attempt in (repaired, candidate):
            try:
                return json.loads(attempt)
            except Exception:
                continue
    return None


_STYLE_RESTYLE_RE = re.compile(
    r"^\s*(?:"
    r"(?:do|make|turn|convert|redraw|rerender|re-render|перерисуй|сделай|сделать|преобразуй|измени)\s+"
    r"(?:it|this|это|её|его|картинку|иллюстрацию|изображение)?\s*"
    r"(?:as|to|into|in|в)?\s*"
    r"(?:sketch|скетч|скетчем|3d|2\.?5d|2_5d|flat|флэт|плоском|монохром|monochrome)"
    r"|"
    r"(?:sketch|скетч|3d|2\.?5d|2_5d|flat|флэт|monochrome|монохром)\s*(?:style|стиль|режим)?"
    r")\s*[.!?]*\s*$",
    re.I,
)


_CONTEXTUAL_FOLLOWUP_RE = re.compile(
    r"("
    r"\b(?:same|previous|again|continue|add|remove|change|edit|that|this|it)\b|"
    r"\b(?:ещ[её]|снова|продолж|добав|убер|измени|поменяй|перерисуй|сделай|"
    r"та\s*же|то\s*же|эт[ауо]|эту|это|картинк|иллюстрац|предыдущ)\b"
    r")",
    re.I,
)


# Стиль, названный прямо в сообщении. Фронтенд шлёт `style` из выпадашки, а не
# из текста, поэтому «do sketch» или «сделай в 3d» раньше не меняли НИЧЕГО:
# параметр оставался прежним, и картинка перерисовывалась в том же виде.
_STYLE_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("sketch", ("sketch", "скетч", "скетчем", "эскиз", "от руки", "hand drawn", "hand-drawn")),
    ("2_5d", ("2.5d", "2_5d", "25d", "изометр", "isometric")),
    ("3d", ("3d", "3д", "объ[её]мн", "render", "рендер")),
    ("flat", ("flat", "флэт", "плоск", "векторн")),
)


# Служебные слова, которые окружают команду смены стиля и сами смысла не несут.
_STYLE_FILLER_RE = re.compile(
    r"\b(?:do|make|turn|convert|redraw|re-?render|it|this|that|as|to|into|in|same|"
    r"task|style|mode|please|now|again|a|the|"
    r"сделай|сделать|перерисуй|преобразуй|измени|поменяй|давай|"
    r"это|эту|её|его|картинку|иллюстрацию|изображение|схему|рисунок|"
    r"в|во|на|тоже|то|самое|же|стиль|стиле|режим|режиме|теперь|а|и|ну)\b",
    re.I,
)


def style_from_message(text: str) -> str | None:
    """Извлекает стиль, названный в самом запросе, иначе None.

    Срабатывает ТОЛЬКО на командах смены стиля («do sketch», «сделай в 3d»),
    но не на описании сюжета. Проверка такая: убираем служебные слова — если
    от сообщения осталось практически одно название стиля, это команда.
    Иначе слово было частью предмета: «Нарисуй плоское зеркало» — про зеркало,
    а не просьба рисовать во flat-стиле.
    """
    if not isinstance(text, str) or not text.strip():
        return None
    lowered = text.lower()

    matched: str | None = None
    for key, needles in _STYLE_KEYWORDS:
        for needle in needles:
            if re.search(needle, lowered):
                matched = key
                break
        if matched:
            break
    if not matched:
        return None

    # Что останется, если выбросить служебные слова и само название стиля.
    residue = _STYLE_FILLER_RE.sub(" ", lowered)
    for _key, needles in _STYLE_KEYWORDS:
        for needle in needles:
            residue = re.sub(needle + r"\w*", " ", residue)
    residue = re.sub(r"[^\w]+", "", residue)

    # Пара символов шума допустима, целое слово — уже предмет, а не стиль.
    return matched if len(residue) <= 3 else None


def _looks_like_style_restyle(text: str) -> bool:
    """Короткие команды вида "do sketch" должны менять стиль текущей картинки."""
    if not isinstance(text, str):
        return False
    return bool(_STYLE_RESTYLE_RE.match(text))


# Голая команда без предмета: «нарисуй», «нарисуй мне», «покажи схему».
# Такое сообщение НИКОГДА не является самостоятельной задачей — рисовать в нём
# нечего, предмет остался в предыдущей реплике. Прежняя эвристика считала его
# «новой задачей» и выбрасывала историю: после разговора о первом законе
# Ньютона «нарисуй мне» превращалось в случайный куб с подписями граней.
_BARE_DRAW_COMMAND_RE = re.compile(
    r"^\s*(?:а\s+|и\s+|ну\s+)?(?:теперь\s+|тогда\s+)?"
    r"(?:нарисуй|начерти|построй|изобрази|покажи|схему|draw|show|plot|sketch)"
    r"(?:\s+(?:мне|нам|её|его|их|схему|рисунок|картинку|please|me|us|it))*"
    r"\s*[.!?]*\s*$",
    re.I,
)


def _needs_chat_history(text: str) -> bool:
    """Use old chat only for explicit follow-ups; new tasks stay clean."""
    if not isinstance(text, str):
        return False
    return (
        _looks_like_style_restyle(text)
        or bool(_BARE_DRAW_COMMAND_RE.match(text))
        or bool(_CONTEXTUAL_FOLLOWUP_RE.search(text))
    )


def _history_for_model(history: list, user_message: str) -> list:
    if not _needs_chat_history(user_message):
        return []
    clean = []
    for msg in history[-6:]:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            clean.append({"role": role, "content": content.strip()[:900]})
    return clean


# Command types the frontend AITutorBoard component understands
# (board_steps[].commands[].type).
# `image_with_labels` is a macro: Llama emits it with `image_prompt`, the
# enrichment service replaces image_prompt with image_url before the response
# reaches the frontend ScientificIllustration component.
_ALLOWED_COMMANDS = {"text", "line", "circle", "rect", "formula", "table", "barchart", "image_with_labels"}

# Сколько сгенерированных иллюстраций максимум отдаём за один ответ. Каждая —
# это ~25с генерации плюс грунтинг, поэтому потолок нужен; четыре покрывают
# типичный «разбери мне эти задачи» и не превращают ответ в ленту картинок.
MAX_ILLUSTRATIONS_PER_ANSWER = 4

# Подписей на ОДНУ иллюстрацию. Свыше этого кадр перестаёт читаться (замерено
# на проде: 18 подписей на картинку — сплошная каша), а грунтинг дорожает
# линейно по их числу. Лишние отбрасываем, оставляя первые — модель ставит
# важные вперёд.
MAX_LABELS_PER_ILLUSTRATION = 6
ALLOWED_LABEL_TARGET_KINDS = {"object", "vector", "angle", "region"}


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

        # labels: [{content, x, y, fontSize?, arrow_to?}]
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
                if "fontSize" in lbl:
                    clean_lbl["fontSize"] = _num(lbl["fontSize"], 0.85)
                target_kind = lbl.get("target_kind")
                if (
                    isinstance(target_kind, str)
                    and target_kind.strip().lower() in ALLOWED_LABEL_TARGET_KINDS
                ):
                    clean_lbl["target_kind"] = target_kind.strip().lower()
                # arrow_to: {x, y}
                arrow = lbl.get("arrow_to")
                if isinstance(arrow, dict) and "x" in arrow and "y" in arrow:
                    clean_lbl["arrow_to"] = {
                        "x": _num(arrow["x"], 0),
                        "y": _num(arrow["y"], 0),
                    }
                clean_labels.append(clean_lbl)
                if len(clean_labels) >= MAX_LABELS_PER_ILLUSTRATION:
                    break
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

    # Лимит иллюстраций на ответ. Раньше он был жёстко равен ОДНОЙ: правило
    # ввели, когда модель плодила по картинке на каждый под-этап одной темы.
    # Но на запросе из нескольких РАЗНЫХ задач оно давало обратный эффект —
    # модель слепляла их в один кадр (наблюдалось: пять задач и 18 подписей на
    # одной картинке, нечитаемо и медленно). Теперь одна ситуация по-прежнему
    # рисуется одной картинкой, а разные задачи — разными; лишнее сверх лимита
    # режем. Картинки обогащаются параллельно (IMAGE_GEN_MAX_WORKERS), поэтому
    # время растёт не суммой, а примерно максимумом.
    steps = []
    image_count = 0
    for i, step in enumerate(steps_in):
        if not isinstance(step, dict):
            continue
        commands_in = step.get("commands")
        commands = []
        if isinstance(commands_in, list):
            for c in commands_in:
                clean = _sanitize_command(c)
                if clean is None:
                    continue
                if clean.get("type") == "image_with_labels":
                    if image_count >= MAX_ILLUSTRATIONS_PER_ANSWER:
                        continue  # лимит исчерпан — лишние иллюстрации режем
                    image_count += 1
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
        # reference_image_url / reference_labels — последняя (или выделенная)
        # иллюстрация на доске и её подписи. Фронтенд шлёт их ВСЕГДА как
        # кандидата; ИСПОЛЬЗОВАТЬ ли референс, решает Llama классификацией
        # intent (см. правило 7 в DRAW_SYSTEM_PROMPT):
        #   • intent="restyle" → нативный image-to-image (композиция сохраняется
        #     edit-механизмом Gemini/Nano Banana) + переиспользуем ТЕ ЖЕ подписи
        #     с теми же координатами (грунтинг пропускается — позиции уже
        #     финальные). Текст остаётся на прежних местах.
        #   • intent="new" → референс игнорируется, обычный text-to-image.
        gen_reference_image_url: str | None = data.get("reference_image_url") or None
        reference_labels = data.get("reference_labels")
        if not (isinstance(reference_labels, list) and reference_labels):
            reference_labels = None

        if not user_message:
            return Response(
                {"error": "Пустое сообщение. Напишите, что нарисовать или объяснить."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Единственная реализация генерации доски живёт в BoardSkill —
            # этот эндпоинт остаётся ради обратной совместимости и делегирует
            # туда. Импорт локальный: skills.board импортирует данный модуль на
            # уровне модуля, поэтому глобальный импорт здесь дал бы цикл.
            from .skills.board import BoardSkill

            result = BoardSkill().run(
                user_message=user_message,
                history=history,
                style=gen_style,
                palette=gen_palette,
                reference_image_url=gen_reference_image_url,
                reference_labels=reference_labels,
            )
            return Response(result.as_payload())

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
