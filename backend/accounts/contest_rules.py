"""Правила контестов без базы: тиры, рисунки, сравнение ответов, публикация и таблица.

Здесь только чистые функции. Их проверяют модульные тесты, а вьюхи и формы
опираются на них, чтобы правило жило в одном месте.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from typing import Mapping, NamedTuple, Sequence, TypedDict

# Тир задаёт потолок баллов за весь контест и цвет плашки. Тир 1 самый ценный.
TIER_CAPS: dict[int, int] = {1: 800, 2: 400, 3: 200, 4: 100, 5: 50}
TIER_NAMES: dict[int, str] = {1: "Аметист", 2: "Алмаз", 3: "Золото", 4: "Серебро", 5: "Бронза"}
# Тиры 1 и 2 раздают много баллов разом, поэтому их ставит только владелец.
OWNER_ONLY_TIERS = frozenset({1, 2})
ALL_TIERS = frozenset(TIER_CAPS)

ARTS: tuple[str, ...] = (
    "rings", "throw", "orbits", "waves", "sun", "grid",
    "cells", "stars", "triangles", "spiral", "steps", "code",
)

MAX_TASKS = 20
MAX_ANSWER_LENGTH = 100
MAX_EXPECTED_LENGTH = 300
MAX_ATTEMPTS_PER_TASK = 30
MIN_SECONDS_BETWEEN_ATTEMPTS = 3
WRONG_ATTEMPT_PENALTY_MINUTES = 5
MAX_PDF_BYTES = 10 * 1024 * 1024
REVIEW_TEXT_LIMIT = 4000
MAX_TITLE = 120
MAX_DESCRIPTION = 2000


def allowed_tiers(user) -> frozenset[int]:
    """Какие тиры человек может ставить контесту."""
    if user is None:
        return frozenset()
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return ALL_TIERS
    if getattr(user, "is_moderator", False):
        return ALL_TIERS - OWNER_ONLY_TIERS
    return frozenset()


def contest_state(start: datetime, end: datetime, now: datetime) -> str:
    if now < start:
        return "upcoming"
    if now < end:
        return "running"
    return "ended"


# ───────────────────────────── Ответы ─────────────────────────────

_DASHES = str.maketrans({"−": "-", "–": "-", "—": "-"})
_SPACES = re.compile(r"\s+")
_NUMBER = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)")


def split_variants(expected: str) -> list[str]:
    """Админ пишет несколько верных вариантов через «;»."""
    return [part.strip() for part in (expected or "").split(";") if part.strip()]


def first_variant(expected: str) -> str:
    variants = split_variants(expected)
    return variants[0] if variants else ""


def normalize_answer(text: str) -> str:
    """Регистр, «ё», виды минуса, знак градуса, лишние пробелы и точка в конце не важны."""
    value = unicodedata.normalize("NFKC", text or "").lower().replace("ё", "е")
    value = value.translate(_DASHES).replace("°", "")
    value = _SPACES.sub(" ", value).strip()
    return value.rstrip(".").strip()


def _decimal(text: str) -> Fraction | None:
    if not _NUMBER.fullmatch(text):
        return None
    try:
        return Fraction(Decimal(text))
    except (InvalidOperation, ValueError):
        return None


def parse_number(text: str) -> Fraction | None:
    """«0,75», «.75», «3/4» и «1 000» становятся числами. Остальное не число."""
    value = _SPACES.sub("", text or "").replace(",", ".")
    if not value:
        return None
    if value.count("/") == 1:
        top, bottom = value.split("/")
        top_number, bottom_number = _decimal(top), _decimal(bottom)
        if top_number is None or bottom_number is None or bottom_number == 0:
            return None
        return top_number / bottom_number
    return _decimal(value)


def answers_match(given: str, expected: str) -> bool:
    answer = normalize_answer(given)
    if not answer:
        return False
    answer_number = parse_number(answer)
    for variant in split_variants(expected):
        wanted = normalize_answer(variant)
        if not wanted:
            continue
        wanted_number = parse_number(wanted)
        if answer_number is not None and wanted_number is not None:
            if answer_number == wanted_number:
                return True
        elif answer == wanted:
            return True
    return False


# ──────────────────────────── Публикация ────────────────────────────


class Problem(TypedDict):
    code: str
    field: str
    message: str


class TaskDraft(TypedDict):
    answer: str
    points: int
    statement_file: int | None


def _problem(code: str, field_name: str, message: str) -> Problem:
    return {"code": code, "field": field_name, "message": message}


def publish_problems(
    *,
    title: str,
    start: datetime,
    end: datetime,
    tier: int,
    art: str,
    tasks: Sequence[TaskDraft],
    actor,
    now: datetime,
) -> list[Problem]:
    """Всё, что мешает опубликовать контест, в порядке полей формы."""
    found: list[Problem] = []
    if not (title or "").strip():
        found.append(_problem("title", "title", "Напиши название."))
    if end <= start:
        found.append(_problem("dates_order", "dates", "Конец должен быть позже начала."))
    elif end <= now:
        found.append(_problem("ended", "dates", "Конец уже прошёл."))
    if tier not in allowed_tiers(actor):
        found.append(_problem("tier_forbidden", "tier", "Этот тир ставит только владелец."))
    if art not in ARTS:
        found.append(_problem("art", "art", "Выбери рисунок."))
    if not tasks:
        found.append(_problem("no_tasks", "tasks", "Добавь хотя бы одну задачу."))
    elif len(tasks) > MAX_TASKS:
        found.append(_problem("too_many_tasks", "tasks", f"Задач не больше {MAX_TASKS}."))
    else:
        for number, item in enumerate(tasks, start=1):
            if not item.get("statement_file"):
                found.append(_problem("no_statement", f"tasks.{number}", f"У задачи {number} нет PDF условия."))
            if not split_variants(item.get("answer") or ""):
                found.append(_problem("no_answer", f"tasks.{number}", f"У задачи {number} нет ответа."))
            if int(item.get("points") or 0) < 1:
                found.append(_problem("bad_points", f"tasks.{number}", f"Баллы задачи {number} от 1."))
        total = sum(max(0, int(item.get("points") or 0)) for item in tasks)
        cap = TIER_CAPS.get(tier)
        if cap is not None and total > cap:
            found.append(_problem("over_cap", "tasks", f"Сумма {total} больше потолка тира: {cap}."))
    return found


# ───────────────────────────── Таблица ─────────────────────────────


class Attempt(NamedTuple):
    student_id: int
    task_id: int
    correct: bool
    at: datetime


@dataclass
class Standing:
    student_id: int
    place: int = 0
    points: int = 0
    penalty: int = 0
    solved: int = 0
    marks: list[str] = field(default_factory=list)


def standings(
    task_ids: Sequence[int],
    points: Mapping[int, int],
    attempts: Sequence[Attempt],
    start: datetime,
) -> list[Standing]:
    """Места по баллам, при равных баллах по штрафу.

    Штраф по решённой задаче: минуты от начала до первого верного ответа плюс
    5 минут за каждую ошибку до него. Попытки после верного ответа не считаются.
    Одинаковые баллы и штраф делят место, следующее место пропускается.
    """
    by_student: dict[int, dict[int, list[Attempt]]] = {}
    for attempt in sorted(attempts, key=lambda row: row.at):
        by_student.setdefault(attempt.student_id, {}).setdefault(attempt.task_id, []).append(attempt)

    rows: list[Standing] = []
    for student_id, tasks in by_student.items():
        row = Standing(student_id=student_id)
        for task_id in task_ids:
            tried = tasks.get(task_id, [])
            wrong = 0
            solved_at = None
            for attempt in tried:
                if attempt.correct:
                    solved_at = attempt.at
                    break
                wrong += 1
            if solved_at is not None:
                row.points += points.get(task_id, 0)
                row.solved += 1
                minutes = max(0, int((solved_at - start).total_seconds() // 60))
                row.penalty += minutes + WRONG_ATTEMPT_PENALTY_MINUTES * wrong
                row.marks.append("solved")
            else:
                row.marks.append("tried" if tried else "none")
        rows.append(row)

    rows.sort(key=lambda row: (-row.points, row.penalty, row.student_id))
    previous = None
    for index, row in enumerate(rows, start=1):
        key = (row.points, row.penalty)
        row.place = previous.place if previous and (previous.points, previous.penalty) == key else index
        previous = row
    return rows
