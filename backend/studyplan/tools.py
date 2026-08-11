"""Инструменты AI для расписания.

Правило домена, ради которого весь этот слой и существует: **модель не пишет в
календарь**. Она вызывает типизированный инструмент, инструмент проверяет
аргументы и создаёт `ScheduleRevision` — предложение с diff'ом, которое ученик
подтверждает или отклоняет. Между «AI подвинул физику» и «AI предложил
подвинуть физику, вот что изменится» лежит вся разница между инструментом и
неприятным сюрпризом.

Что приходит НЕ от модели: пользователь и расписание. И то и другое берётся из
запроса, иначе «инструмент» стал бы способом читать и править чужой календарь
по подсказке в промпте. Тот же приём, что в `ai_engine.tutor_tools.ToolContext`.

Исключение из правила «результат — ревизия»: `propose_fixed_commitments` ничего
не создаёт вовсе и возвращает разобранную структуру. Занятость — это не
изменение календаря, а новый факт о жизни ученика, и для него нет сущности
предложения; панель показывает разбор и создаёт блоки обычным CRUD, когда
человек согласился.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Callable

from django.utils import timezone as django_timezone

from ai_engine.tutor_tools import ToolValidationError, validate_args

from .availability import free_windows, place_sequentially
from .models import FixedCommitment, LearningBlock, StudySchedule
from .revisions import BlockMove, RevisionRejected, propose_moves
from .scheduling.slots import local_to_utc, resolve_zone

logger = logging.getLogger(__name__)

# Сколько дней вперёд инструменты смотрят по умолчанию. Две недели — это
# горизонт, на который ученик реально планирует; дальше он всё равно
# пересогласует.
DEFAULT_WINDOW_DAYS = 14
# Потолок, чтобы один вызов не вытащил в контекст модели три месяца календаря.
MAX_WINDOW_DAYS = 60
MAX_BLOCKS_IN_ANSWER = 120

_WEEKDAY_NAMES = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)


@dataclass(frozen=True)
class ScheduleToolContext:
    """Что инструменту даёт backend, а не модель."""

    user_email: str = ""
    schedule: StudySchedule | None = None
    today: date | None = None

    @property
    def zone(self):
        return resolve_zone(self.schedule.timezone if self.schedule else "UTC")

    def current_date(self) -> date:
        if self.today is not None:
            return self.today
        return django_timezone.now().astimezone(self.zone).date()


@dataclass(frozen=True)
class ScheduleTool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any], ScheduleToolContext], dict[str, Any]]
    # Инструменты, создающие ревизию, помечены явно: панель по этому признаку
    # понимает, что после ответа надо показать diff и кнопки подтверждения.
    creates_revision: bool = False

    def as_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


def _fail(error: str, message: str) -> dict[str, Any]:
    return {"ok": False, "error": error, "message": message}


def _require_schedule(context: ScheduleToolContext) -> dict[str, Any] | None:
    if context.schedule is None:
        return _fail("no_schedule", "У ученика ещё нет построенного расписания.")
    return None


def _parse_date(value: str | None, fallback: date) -> date:
    if not value:
        return fallback
    try:
        return date.fromisoformat(value.strip())
    except ValueError as exc:
        raise ToolValidationError(f"дата {value!r} не разобрана") from exc


def _window(
    args: dict[str, Any], context: ScheduleToolContext
) -> tuple[date, date]:
    today = context.current_date()
    start = _parse_date(args.get("from_date"), today)
    end = _parse_date(args.get("to_date"), start + timedelta(days=DEFAULT_WINDOW_DAYS))
    if end < start:
        start, end = end, start
    if (end - start).days > MAX_WINDOW_DAYS:
        end = start + timedelta(days=MAX_WINDOW_DAYS)
    return start, end


def _block_payload(block: LearningBlock, zone) -> dict[str, Any]:
    local = block.start_at.astimezone(zone)
    return {
        "block_id": str(block.id),
        "title": block.title,
        "date": local.date().isoformat(),
        "weekday": _WEEKDAY_NAMES[local.weekday()],
        "start_time": local.strftime("%H:%M"),
        "duration_minutes": block.duration_minutes,
        "activity_type": block.activity_type,
        "status": block.status,
        "fixed": block.fixed,
        "start_at": block.start_at.isoformat(),
    }


# ─────────────────────────── Чтение расписания ───────────────────────────────


def _handle_get_schedule(
    args: dict[str, Any], context: ScheduleToolContext
) -> dict[str, Any]:
    problem = _require_schedule(context)
    if problem:
        return problem

    schedule = context.schedule
    start, end = _window(args, context)
    zone = context.zone

    blocks = list(
        schedule.blocks.filter(
            start_at__gte=local_to_utc(start, time(0, 0), zone)[0],
            start_at__lt=local_to_utc(end + timedelta(days=1), time(0, 0), zone)[0],
        ).order_by("start_at")[:MAX_BLOCKS_IN_ANSWER]
    )

    load: dict[str, int] = {}
    for block in blocks:
        key = block.start_at.astimezone(zone).date().isoformat()
        load[key] = load.get(key, 0) + block.duration_minutes

    return {
        "ok": True,
        "timezone": schedule.timezone,
        "status": schedule.status,
        "version": schedule.version,
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "today": context.current_date().isoformat(),
        "daily_minutes": load,
        "blocks": [_block_payload(block, zone) for block in blocks],
    }


def _handle_find_free_slots(
    args: dict[str, Any], context: ScheduleToolContext
) -> dict[str, Any]:
    problem = _require_schedule(context)
    if problem:
        return problem

    start, end = _window(args, context)
    minutes = int(args.get("minutes") or 45)
    windows = free_windows(context.schedule, start_date=start, end_date=end)
    zone = context.zone

    suitable = [item for item in windows if item.duration_minutes >= minutes][:40]
    return {
        "ok": True,
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "slots": [
            {
                "date": item.local_date.isoformat(),
                "weekday": _WEEKDAY_NAMES[item.local_date.weekday()],
                "start_time": item.start.astimezone(zone).strftime("%H:%M"),
                "duration_minutes": item.duration_minutes,
                "start_at": item.start.isoformat(),
            }
            for item in suitable
        ],
    }


def _handle_explain_schedule(
    args: dict[str, Any], context: ScheduleToolContext
) -> dict[str, Any]:
    problem = _require_schedule(context)
    if problem:
        return problem

    schedule = context.schedule
    zone = context.zone
    target = _parse_date(args.get("date"), context.current_date())
    day_start, _ = local_to_utc(target, time(0, 0), zone)
    day_end, _ = local_to_utc(target + timedelta(days=1), time(0, 0), zone)

    blocks = list(
        schedule.blocks.filter(start_at__gte=day_start, start_at__lt=day_end).order_by(
            "start_at"
        )
    )
    snapshot = schedule.pacing_snapshot or {}

    return {
        "ok": True,
        "date": target.isoformat(),
        "weekday": _WEEKDAY_NAMES[target.weekday()],
        "blocks": [_block_payload(block, zone) for block in blocks],
        "total_minutes": sum(block.duration_minutes for block in blocks),
        "weekly_pattern": snapshot.get("weekly_pattern", []),
        "buffer_percentage": snapshot.get("buffer_percentage"),
        "rationale": snapshot.get("rationale", ""),
        "conflict": schedule.conflict_report or None,
    }


# ──────────────────────────── Предложения ────────────────────────────────────


def _revision_payload(revision) -> dict[str, Any]:
    moved = revision.diff.get("moved", [])
    return {
        "ok": True,
        "revision_id": str(revision.id),
        "base_version": revision.base_version,
        "proposed_version": revision.proposed_version,
        "moved_count": len(moved),
        "moved": [
            {
                "title": entry["title"],
                "from": entry["from"]["start_at"],
                "to": entry["to"]["start_at"],
            }
            for entry in moved[:20]
        ],
        "impact": revision.impact,
        "note": (
            "Изменение ПРЕДЛОЖЕНО и ещё не применено. Ученик подтверждает его "
            "в панели."
        ),
    }


def _propose(context: ScheduleToolContext, moves: list[BlockMove], reason: str):
    try:
        revision = propose_moves(
            context.schedule,
            moves=moves,
            requested_by="ai",
            reason=reason,
        )
    except RevisionRejected as exc:
        return _fail("rejected", str(exc))
    return _revision_payload(revision)


def _handle_propose_move_blocks(
    args: dict[str, Any], context: ScheduleToolContext
) -> dict[str, Any]:
    problem = _require_schedule(context)
    if problem:
        return problem

    raw_moves = args.get("moves")
    if not isinstance(raw_moves, list) or not raw_moves:
        return _fail("invalid_arguments", "Нужен непустой список переносов.")

    moves: list[BlockMove] = []
    for item in raw_moves:
        if not isinstance(item, dict):
            return _fail("invalid_arguments", "Каждый перенос — это объект.")
        block_id = str(item.get("block_id") or "").strip()
        start_at = str(item.get("start_at") or "").strip()
        if not block_id or not start_at:
            return _fail("invalid_arguments", "У переноса нужны block_id и start_at.")
        try:
            moment = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
        except ValueError:
            return _fail("invalid_arguments", f"Момент {start_at!r} не разобран.")
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=context.zone)

        duration = item.get("duration_minutes")
        moves.append(
            BlockMove(
                block_id=block_id,
                start_at=moment,
                duration_minutes=int(duration) if duration else None,
            )
        )

    return _propose(context, moves, args.get("reason") or "Предложение помощника")


def _handle_propose_load_reduction(
    args: dict[str, Any], context: ScheduleToolContext
) -> dict[str, Any]:
    """Разгрузить день: лишние занятия уезжают в ближайшие свободные окна."""
    problem = _require_schedule(context)
    if problem:
        return problem

    schedule = context.schedule
    zone = context.zone
    target = _parse_date(args.get("date"), context.current_date())
    keep_minutes = max(0, int(args.get("keep_minutes") or 0))

    day_start, _ = local_to_utc(target, time(0, 0), zone)
    day_end, _ = local_to_utc(target + timedelta(days=1), time(0, 0), zone)
    blocks = list(
        schedule.blocks.filter(
            start_at__gte=day_start, start_at__lt=day_end, fixed=False
        )
        .exclude(status__in=[LearningBlock.Status.COMPLETED, LearningBlock.Status.CANCELLED])
        .order_by("start_at")
    )
    if not blocks:
        return _fail("nothing_to_move", f"На {target.isoformat()} нечего переносить.")

    # Оставляем начало дня, увозим хвост: убрать первое занятие и оставить
    # последнее значило бы сдвинуть весь день на потом, а просили разгрузить.
    kept = 0
    to_move: list[LearningBlock] = []
    for block in blocks:
        if kept + block.duration_minutes <= keep_minutes:
            kept += block.duration_minutes
            continue
        to_move.append(block)

    if not to_move:
        return _fail("nothing_to_move", "Этот день и так в пределах лимита.")

    windows = free_windows(
        schedule,
        start_date=target + timedelta(days=1),
        end_date=target + timedelta(days=DEFAULT_WINDOW_DAYS),
        exclude_block_ids=tuple(str(block.id) for block in to_move),
    )
    placed = place_sequentially(
        windows,
        [
            (str(block.id), block.duration_minutes, block.activity_type)
            for block in to_move
        ],
    )
    if not placed:
        return _fail(
            "no_room",
            "В ближайшие две недели нет окон, куда это перенести.",
        )

    moves = [BlockMove(block_id=block_id, start_at=start) for block_id, start in placed]
    result = _propose(
        context, moves, f"Разгрузка дня {target.isoformat()}"
    )
    if result.get("ok"):
        result["not_placed"] = len(to_move) - len(placed)
    return result


def _handle_propose_recovery_plan(
    args: dict[str, Any], context: ScheduleToolContext
) -> dict[str, Any]:
    """Восстановить пропущенное: незакрытые занятия из прошлого едут вперёд."""
    problem = _require_schedule(context)
    if problem:
        return problem

    schedule = context.schedule
    zone = context.zone
    today = context.current_date()
    boundary, _ = local_to_utc(today, time(0, 0), zone)

    missed = list(
        schedule.blocks.filter(start_at__lt=boundary, fixed=False)
        .filter(
            status__in=[
                LearningBlock.Status.SCHEDULED,
                LearningBlock.Status.READY,
                LearningBlock.Status.MISSED,
            ]
        )
        .order_by("start_at")
    )
    if not missed:
        return {"ok": True, "nothing_missed": True, "message": "Пропусков нет."}

    windows = free_windows(
        schedule,
        start_date=today,
        end_date=today + timedelta(days=DEFAULT_WINDOW_DAYS),
        exclude_block_ids=tuple(str(block.id) for block in missed),
    )
    placed = place_sequentially(
        windows,
        [(str(block.id), block.duration_minutes, block.activity_type) for block in missed],
    )
    if not placed:
        return _fail("no_room", "Свободных окон на ближайшие две недели нет.")

    moves = [BlockMove(block_id=block_id, start_at=start) for block_id, start in placed]
    result = _propose(context, moves, "Восстановление пропущенного")
    if result.get("ok"):
        result["missed_total"] = len(missed)
        result["not_placed"] = len(missed) - len(placed)
    return result


def _handle_propose_fixed_commitments(
    args: dict[str, Any], context: ScheduleToolContext
) -> dict[str, Any]:
    """Разобрать фразу про занятость в структуру. В базу НИЧЕГО не пишет.

    Занятость — это факт о жизни ученика, а не изменение календаря, и сущности
    «предложенная занятость» в модели нет. Поэтому инструмент только разбирает,
    а создаёт блоки панель — обычным CRUD и после согласия человека.
    """
    raw_items = args.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return _fail("invalid_arguments", "Нужен непустой список занятости.")

    kinds = {choice.value for choice in FixedCommitment.Kind}
    parsed: list[dict[str, Any]] = []
    for item in raw_items[:20]:
        if not isinstance(item, dict):
            return _fail("invalid_arguments", "Каждая занятость — это объект.")

        title = str(item.get("title") or "").strip()
        if not title:
            return _fail("invalid_arguments", "У занятости должно быть название.")

        kind = str(item.get("kind") or "other").strip()
        if kind not in kinds:
            kind = "other"

        weekday = item.get("weekday")
        start_time = str(item.get("start_time") or "").strip()
        duration = item.get("duration_minutes")

        candidate: dict[str, Any] = {"title": title, "kind": kind}
        if weekday is not None and start_time:
            if not isinstance(weekday, int) or not 0 <= weekday <= 6:
                return _fail("invalid_arguments", "weekday — целое от 0 до 6.")
            try:
                time.fromisoformat(start_time)
            except ValueError:
                return _fail("invalid_arguments", f"Время {start_time!r} не разобрано.")
            if not duration or int(duration) <= 0:
                return _fail("invalid_arguments", "Нужна длительность в минутах.")
            candidate.update(
                {
                    "weekday": weekday,
                    "weekday_name": _WEEKDAY_NAMES[weekday],
                    "start_time": start_time,
                    "duration_minutes": int(duration),
                    "valid_from": item.get("valid_from") or None,
                    "valid_until": item.get("valid_until") or None,
                }
            )
        else:
            start_at = str(item.get("start_at") or "").strip()
            end_at = str(item.get("end_at") or "").strip()
            if not start_at or not end_at:
                return _fail(
                    "invalid_arguments",
                    "Нужны либо weekday+start_time+duration_minutes, либо start_at+end_at.",
                )
            candidate.update({"start_at": start_at, "end_at": end_at})

        parsed.append(candidate)

    return {
        "ok": True,
        "items": parsed,
        "note": (
            "Занятость РАЗОБРАНА, но не сохранена. Ученик подтверждает её в "
            "панели, и только тогда она появится в календаре."
        ),
    }


# ─────────────────────────────── Реестр ──────────────────────────────────────

_DATE_RANGE_PROPERTIES = {
    "from_date": {"type": "string", "description": "Дата начала, YYYY-MM-DD."},
    "to_date": {"type": "string", "description": "Дата конца, YYYY-MM-DD."},
}

SCHEDULE_TOOLS: dict[str, ScheduleTool] = {
    "get_schedule": ScheduleTool(
        name="get_schedule",
        description=(
            "Показать занятия ученика за период с датами, временем и нагрузкой "
            "по дням. Вызывай перед любым изменением: block_id берутся отсюда."
        ),
        parameters={
            "type": "object",
            "properties": dict(_DATE_RANGE_PROPERTIES),
            "required": [],
        },
        handler=_handle_get_schedule,
    ),
    "find_free_slots": ScheduleTool(
        name="find_free_slots",
        description=(
            "Найти свободные окна нужной длины: куда вообще можно что-то "
            "поставить, не задев занятость и другие занятия."
        ),
        parameters={
            "type": "object",
            "properties": {
                **_DATE_RANGE_PROPERTIES,
                "minutes": {
                    "type": "integer",
                    "minimum": 5,
                    "description": "Минимальная длина окна.",
                },
            },
            "required": [],
        },
        handler=_handle_find_free_slots,
    ),
    "explain_schedule": ScheduleTool(
        name="explain_schedule",
        description=(
            "Из чего сложился конкретный день: занятия, нагрузка, недельный "
            "ритм и буфер. Для вопросов «почему так»."
        ),
        parameters={
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "Дата, YYYY-MM-DD."}
            },
            "required": [],
        },
        handler=_handle_explain_schedule,
    ),
    "propose_move_blocks": ScheduleTool(
        name="propose_move_blocks",
        description=(
            "ПРЕДЛОЖИТЬ перенос конкретных занятий. Не применяет изменение — "
            "создаёт предложение, которое подтверждает ученик."
        ),
        parameters={
            "type": "object",
            "properties": {
                "moves": {
                    "type": "array",
                    "description": (
                        "Список переносов: block_id из get_schedule и start_at "
                        "в ISO с зоной."
                    ),
                },
                "reason": {"type": "string", "description": "Зачем переносим."},
            },
            "required": ["moves"],
        },
        handler=_handle_propose_move_blocks,
        creates_revision=True,
    ),
    "propose_load_reduction": ScheduleTool(
        name="propose_load_reduction",
        description=(
            "ПРЕДЛОЖИТЬ разгрузить день: лишние занятия уезжают в ближайшие "
            "свободные окна. Для просьб вида «разгрузи среду»."
        ),
        parameters={
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "Какой день, YYYY-MM-DD."},
                "keep_minutes": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "Сколько минут оставить в этом дне. 0 — освободить целиком.",
                },
            },
            "required": ["date"],
        },
        handler=_handle_propose_load_reduction,
        creates_revision=True,
    ),
    "propose_recovery_plan": ScheduleTool(
        name="propose_recovery_plan",
        description=(
            "ПРЕДЛОЖИТЬ восстановление пропущенного: незакрытые занятия из "
            "прошлого переезжают в ближайшие окна."
        ),
        parameters={"type": "object", "properties": {}, "required": []},
        handler=_handle_propose_recovery_plan,
        creates_revision=True,
    ),
    "propose_fixed_commitments": ScheduleTool(
        name="propose_fixed_commitments",
        description=(
            "Разобрать сказанное учеником про занятое время (школа, репетитор, "
            "экзамен) в структуру. Ничего не сохраняет: ученик подтверждает."
        ),
        parameters={
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": (
                        "Занятость: title, kind и либо weekday+start_time+"
                        "duration_minutes, либо start_at+end_at."
                    ),
                }
            },
            "required": ["items"],
        },
        handler=_handle_propose_fixed_commitments,
    ),
}

READ_ONLY_TOOLS = ("get_schedule", "find_free_slots", "explain_schedule")
ALL_TOOL_NAMES = tuple(SCHEDULE_TOOLS)


def tool_schemas(names: tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    selected = names or ALL_TOOL_NAMES
    return [SCHEDULE_TOOLS[name].as_tool() for name in selected if name in SCHEDULE_TOOLS]


def run_schedule_tool(
    name: str, raw_args: Any, context: ScheduleToolContext | None = None
) -> dict[str, Any]:
    """Выполнить инструмент. Никогда не бросает.

    Результат уходит модели как tool-result, и исключение здесь оборвало бы
    ответ ученику из-за того, что модель неверно заполнила поле.
    """
    tool = SCHEDULE_TOOLS.get(name)
    if tool is None:
        return _fail("unknown_tool", f"Инструмент {name} не существует.")

    ctx = context or ScheduleToolContext()
    try:
        # Списки объектов валидатор `ai_engine` не разбирает — он умеет ровно
        # то, что нужно его собственным инструментам. Поэтому массивы
        # проверяются внутри обработчиков, а общая проверка ловит остальное.
        schema = {
            "type": "object",
            "properties": {
                key: value
                for key, value in tool.parameters.get("properties", {}).items()
                if value.get("type") != "array"
            },
            "required": [
                name
                for name in tool.parameters.get("required", [])
                if tool.parameters["properties"].get(name, {}).get("type") != "array"
            ],
        }
        scalar_args = {
            key: value
            for key, value in (raw_args or {}).items()
            if not isinstance(value, (list, dict))
        }
        validate_args(scalar_args, schema)
    except ToolValidationError as exc:
        logger.warning("[schedule_tools] %s: невалидные аргументы: %s", name, exc)
        return _fail("invalid_arguments", str(exc))
    except AttributeError:
        return _fail("invalid_arguments", "Аргументы должны быть объектом.")

    try:
        return tool.handler(dict(raw_args or {}), ctx)
    except ToolValidationError as exc:
        return _fail("invalid_arguments", str(exc))
    except Exception as exc:  # noqa: BLE001 — сбой инструмента не рвёт разговор
        logger.exception("[schedule_tools] %s упал", name)
        return _fail("tool_failed", str(exc))
