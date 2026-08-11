"""Изменения расписания через предложение, а не правкой на месте.

Правило одно и оно жёсткое: ни AI, ни перетаскивание мышью не меняют календарь
напрямую. Сначала `ScheduleRevision` с diff'ом, потом подтверждение, потом
применение. Ученик обязан увидеть последствия до того, как они наступят, и
обязан иметь возможность вернуть как было.

**Почему обратный diff, а не снимок.** Снимок календаря на три месяца — это
сотни строк, и восстановление из него затёрло бы всё, что ученик сделал после.
Обратное изменение возвращает ровно то, что было изменено, и ничего больше.

**Оптимистичная блокировка.** У расписания есть `version`. Ревизия помнит, от
какой версии она построена, и при подтверждении версии сверяются. Две вкладки,
двигающие один блок, не смогут молча затереть друг друга.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone as django_timezone

from .models import FixedCommitment, LearningBlock, ScheduleRevision, StudySchedule
from .scheduling.contracts import MIN_PART_MINUTES, CommitmentSpec
from .scheduling.slots import busy_intervals, resolve_zone

# Статусы, в которых блок уже прожит и двигать его поздно.
_IMMOVABLE_STATUSES = frozenset(
    {
        LearningBlock.Status.COMPLETED,
        LearningBlock.Status.PARTIALLY_COMPLETED,
        LearningBlock.Status.IN_PROGRESS,
        LearningBlock.Status.CANCELLED,
    }
)

_EMPTY_DIFF = {
    "moved": [],
    "created": [],
    "removed": [],
    "shortened": [],
    "extended": [],
}


class RevisionRejected(RuntimeError):
    """Изменение невозможно: конфликт, закреплённый блок или нарушенный порядок."""


class StaleRevision(RevisionRejected):
    """Ревизия построена от устаревшей версии расписания."""


@dataclass(frozen=True)
class BlockMove:
    """Куда переносится блок. `duration_minutes` не задан — длительность та же."""

    block_id: str
    start_at: datetime
    duration_minutes: int | None = None


def _state(block: LearningBlock) -> dict:
    return {
        "start_at": block.start_at.isoformat(),
        "end_at": block.end_at.isoformat(),
        "duration_minutes": block.duration_minutes,
    }


def _target_state(block: LearningBlock, move: BlockMove) -> dict:
    minutes = move.duration_minutes or block.duration_minutes
    end = move.start_at + timedelta(minutes=minutes)
    return {
        "start_at": move.start_at.isoformat(),
        "end_at": end.isoformat(),
        "duration_minutes": minutes,
    }


def _overlaps(a_start, a_end, b_start, b_end) -> bool:
    return a_start < b_end and b_start < a_end


def _commitment_specs(user_email: str) -> tuple[CommitmentSpec, ...]:
    return tuple(
        CommitmentSpec(
            title=item.title,
            weekday=item.weekday,
            start_time=item.start_time,
            duration_minutes=item.duration_minutes,
            valid_from=item.valid_from,
            valid_until=item.valid_until,
            start_at=item.start_at,
            end_at=item.end_at,
        )
        for item in FixedCommitment.objects.filter(user_email=user_email)
    )


def _validate_moves(
    schedule: StudySchedule, moves: list[BlockMove]
) -> dict[str, tuple[LearningBlock, dict]]:
    """Проверить перенос целиком, ДО записи. Возвращает {block_id: (блок, куда)}."""
    if not moves:
        raise RevisionRejected("Нечего переносить.")

    blocks = {
        str(block.id): block for block in schedule.blocks.select_related("topic")
    }
    planned: dict[str, tuple[LearningBlock, dict]] = {}

    for move in moves:
        block = blocks.get(str(move.block_id))
        if block is None:
            raise RevisionRejected("Блок не принадлежит этому расписанию.")
        if block.fixed:
            raise RevisionRejected(f"Блок «{block.title}» закреплён и не переносится.")
        if block.status in _IMMOVABLE_STATUSES:
            raise RevisionRejected(
                f"Блок «{block.title}» уже в работе или завершён — перенос ничего не изменит."
            )

        target = _target_state(block, move)
        if target["duration_minutes"] < MIN_PART_MINUTES:
            raise RevisionRejected(
                f"Занятие короче {MIN_PART_MINUTES} минут не имеет смысла."
            )

        start = datetime.fromisoformat(target["start_at"])
        end = datetime.fromisoformat(target["end_at"])

        if block.earliest_start and start < block.earliest_start:
            raise RevisionRejected(f"Блок «{block.title}» нельзя ставить так рано.")
        if block.latest_end and end > block.latest_end:
            raise RevisionRejected(f"Блок «{block.title}» нельзя ставить так поздно.")
        if block.allowed_weekdays and start.weekday() not in block.allowed_weekdays:
            raise RevisionRejected(
                f"Блок «{block.title}» нельзя ставить на этот день недели."
            )

        planned[str(block.id)] = (block, target)

    _check_collisions(schedule, blocks, planned)
    _check_prerequisites(schedule, blocks, planned)
    return planned


def _resulting_interval(
    block: LearningBlock, planned: dict[str, tuple[LearningBlock, dict]]
) -> tuple[datetime, datetime]:
    entry = planned.get(str(block.id))
    if entry is None:
        return block.start_at, block.end_at
    target = entry[1]
    return (
        datetime.fromisoformat(target["start_at"]),
        datetime.fromisoformat(target["end_at"]),
    )


def _check_collisions(
    schedule: StudySchedule,
    blocks: dict[str, LearningBlock],
    planned: dict[str, tuple[LearningBlock, dict]],
) -> None:
    """Пересечения с другими блоками и с занятым временем ученика."""
    intervals: list[tuple[datetime, datetime, LearningBlock]] = []
    for block in blocks.values():
        if block.status in {
            LearningBlock.Status.CANCELLED,
            LearningBlock.Status.RESCHEDULED,
        }:
            continue
        start, end = _resulting_interval(block, planned)
        intervals.append((start, end, block))

    intervals.sort(key=lambda item: item[0])
    for (a_start, a_end, a_block), (b_start, b_end, b_block) in zip(
        intervals, intervals[1:]
    ):
        if _overlaps(a_start, a_end, b_start, b_end):
            raise RevisionRejected(
                f"«{a_block.title}» и «{b_block.title}» пересеклись бы по времени."
            )

    moved_intervals = [
        _resulting_interval(block, planned) for block, _ in planned.values()
    ]
    if not moved_intervals:
        return

    zone = resolve_zone(schedule.timezone)
    first = min(start for start, _ in moved_intervals).astimezone(zone).date()
    last = max(end for _, end in moved_intervals).astimezone(zone).date()
    busy = busy_intervals(
        _commitment_specs(schedule.user_email),
        start_date=first,
        end_date=last,
        zone=zone,
    )
    for start, end in moved_intervals:
        for busy_start, busy_end in busy:
            if _overlaps(start, end, busy_start, busy_end):
                raise RevisionRejected("В это время у тебя уже занято.")


def _check_prerequisites(
    schedule: StudySchedule,
    blocks: dict[str, LearningBlock],
    planned: dict[str, tuple[LearningBlock, dict]],
) -> None:
    """Порядок тем обязан пережить перенос.

    Проверяется в обе стороны: и что блок не уехал раньше своих предпосылок, и
    что он не обогнал тех, кто зависит от него. Односторонняя проверка ловила бы
    ровно половину случаев — а перетаскивают чаще именно вперёд.
    """
    for block_id, (block, target) in planned.items():
        start = datetime.fromisoformat(target["start_at"])
        end = datetime.fromisoformat(target["end_at"])

        for dependency_id in block.prerequisite_block_ids or []:
            dependency = blocks.get(str(dependency_id))
            if dependency is None:
                continue
            _, dependency_end = _resulting_interval(dependency, planned)
            if start < dependency_end:
                raise RevisionRejected(
                    f"«{block.title}» встал бы раньше «{dependency.title}», "
                    "от которой зависит."
                )

        for other in blocks.values():
            if str(other.id) == block_id:
                continue
            if block_id not in [str(x) for x in (other.prerequisite_block_ids or [])]:
                continue
            other_start, _ = _resulting_interval(other, planned)
            if other_start < end:
                raise RevisionRejected(
                    f"«{other.title}» зависит от «{block.title}» и оказался бы раньше неё."
                )


def _build_diff(planned: dict[str, tuple[LearningBlock, dict]]) -> tuple[dict, dict]:
    """Прямое и обратное изменение.

    Блок может попасть сразу в два списка: перенесён и укорочен. Применение
    идёт по объединению списков и идемпотентно, поэтому дубль безопасен, а
    ученик видит обе стороны изменения.
    """
    diff = {key: list(value) for key, value in _EMPTY_DIFF.items()}
    inverse = {key: list(value) for key, value in _EMPTY_DIFF.items()}

    for block_id, (block, target) in planned.items():
        before = _state(block)
        entry = {"block_id": block_id, "title": block.title, "from": before, "to": target}
        reverse = {
            "block_id": block_id,
            "title": block.title,
            "from": target,
            "to": before,
        }

        if before["start_at"] != target["start_at"]:
            diff["moved"].append(entry)
            inverse["moved"].append(reverse)

        if target["duration_minutes"] < before["duration_minutes"]:
            diff["shortened"].append(entry)
            inverse["extended"].append(reverse)
        elif target["duration_minutes"] > before["duration_minutes"]:
            diff["extended"].append(entry)
            inverse["shortened"].append(reverse)

    return diff, inverse


def _impact(schedule: StudySchedule, planned: dict) -> dict:
    """Последствия, которые ученик видит до применения."""
    before = schedule.blocks.order_by("-end_at").values_list("end_at", flat=True).first()
    after = before
    for block, target in planned.values():
        candidate = datetime.fromisoformat(target["end_at"])
        if after is None or candidate > after:
            after = candidate
    return {
        "blocks_touched": len(planned),
        "finish_before": before.isoformat() if before else None,
        "finish_after": after.isoformat() if after else None,
    }


@transaction.atomic
def propose_moves(
    schedule: StudySchedule,
    *,
    moves: list[BlockMove],
    requested_by: str = ScheduleRevision.RequestedBy.STUDENT,
    request_text: str = "",
    reason: str = "",
) -> ScheduleRevision:
    """Проверить перенос и сохранить его как предложение."""
    planned = _validate_moves(schedule, moves)
    diff, inverse = _build_diff(planned)

    if not any(diff[key] for key in ("moved", "shortened", "extended")):
        raise RevisionRejected("Изменений нет: блоки уже стоят так.")

    return ScheduleRevision.objects.create(
        user_email=schedule.user_email,
        schedule=schedule,
        base_version=schedule.version,
        proposed_version=schedule.version + 1,
        requested_by=requested_by,
        request_text=request_text,
        reason=reason,
        diff=diff,
        inverse_diff=inverse,
        impact=_impact(schedule, planned),
    )


def _entries(diff: dict) -> dict[str, dict]:
    """Уникальные целевые состояния по блокам из всех списков изменения."""
    result: dict[str, dict] = {}
    for key in ("moved", "shortened", "extended"):
        for entry in diff.get(key) or []:
            result[str(entry["block_id"])] = entry["to"]
    return result


def _apply(schedule: StudySchedule, diff: dict) -> int:
    targets = _entries(diff)
    if not targets:
        return 0

    blocks = {
        str(block.id): block
        for block in schedule.blocks.filter(id__in=list(targets))
    }
    updated: list[LearningBlock] = []
    for block_id, target in targets.items():
        block = blocks.get(block_id)
        if block is None:
            # Блок удалили между предложением и подтверждением. Это не повод
            # отменять остальное изменение, но и молчать нельзя — версия всё
            # равно вырастет, а расхождение видно по числу применённых блоков.
            continue
        block.start_at = datetime.fromisoformat(target["start_at"])
        block.end_at = datetime.fromisoformat(target["end_at"])
        block.duration_minutes = target["duration_minutes"]
        block.version += 1
        updated.append(block)

    if updated:
        LearningBlock.objects.bulk_update(
            updated, ["start_at", "end_at", "duration_minutes", "version"]
        )
    return len(updated)


class _VersionMismatch(Exception):
    """Внутренний сигнал: версия разошлась, транзакцию надо откатить.

    Нужен отдельным типом, потому что пометку «устарела» нельзя ставить ВНУТРИ
    транзакции: откат унёс бы её вместе с остальным, ревизия навсегда осталась
    бы «предложенной», и интерфейс предлагал бы подтвердить её снова и снова.
    """


def confirm_revision(revision: ScheduleRevision) -> ScheduleRevision:
    """Применить изменение. Устаревшая ревизия отклоняется, а не применяется."""
    if revision.status != ScheduleRevision.Status.PROPOSED:
        raise RevisionRejected("Подтвердить можно только предложенную ревизию.")

    try:
        with transaction.atomic():
            schedule = StudySchedule.objects.select_for_update().get(
                pk=revision.schedule_id
            )
            if schedule.version != revision.base_version:
                raise _VersionMismatch()

            _apply(schedule, revision.diff)

            schedule.version = revision.proposed_version
            schedule.save(update_fields=["version", "updated_at"])

            revision.status = ScheduleRevision.Status.CONFIRMED
            revision.confirmed_at = django_timezone.now()
            revision.save(update_fields=["status", "confirmed_at", "updated_at"])
    except _VersionMismatch:
        revision.status = ScheduleRevision.Status.EXPIRED
        revision.save(update_fields=["status", "updated_at"])
        raise StaleRevision(
            "Расписание изменилось с момента предложения — построй изменение заново."
        ) from None

    return revision


@transaction.atomic
def reject_revision(revision: ScheduleRevision) -> ScheduleRevision:
    if revision.status != ScheduleRevision.Status.PROPOSED:
        raise RevisionRejected("Отклонить можно только предложенную ревизию.")
    revision.status = ScheduleRevision.Status.REJECTED
    revision.save(update_fields=["status", "updated_at"])
    return revision


@transaction.atomic
def undo_revision(revision: ScheduleRevision) -> ScheduleRevision:
    """Вернуть как было.

    Отменить можно только ПОСЛЕДНЕЕ подтверждённое изменение. Иначе обратный
    diff применялся бы поверх более поздних правок и вернул бы блоки туда, где
    их уже никто не ждёт.
    """
    if revision.status != ScheduleRevision.Status.CONFIRMED:
        raise RevisionRejected("Отменить можно только подтверждённое изменение.")

    schedule = StudySchedule.objects.select_for_update().get(pk=revision.schedule_id)
    if schedule.version != revision.proposed_version:
        raise StaleRevision(
            "После этого изменения расписание менялось — отменить его уже нельзя."
        )

    _apply(schedule, revision.inverse_diff)

    schedule.version += 1
    schedule.save(update_fields=["version", "updated_at"])

    revision.status = ScheduleRevision.Status.REVERTED
    revision.reverted_at = django_timezone.now()
    revision.save(update_fields=["status", "reverted_at", "updated_at"])
    return revision
