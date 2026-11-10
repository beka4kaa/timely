"""Общий мир демо: учитель, выдуманный класс, дисциплины и два контеста.

Мир один на всех посетителей и строится один раз. Каждый день его даты сдвигаются
так, чтобы осенний кубок всегда был 12 дней назад, а зимний раунд через 5 дней:
иначе через месяц «предстоящий» контест оказался бы в прошлом. Вместе с кубком
сдвигаются и все решения его задач, поэтому результаты остаются внутри окна.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.db import IntegrityError, transaction
from django.db.models import F

from accounts.models import Contest, CustomUser, Discipline, Task, TaskSubmission, UserRating

from . import content
from .identity import TEACHER_EMAIL, classmate_email

# 09:00 UTC — это 14:00 в Алматы, сразу после уроков.
CONTEST_HOUR_UTC = 9
CONTEST_HOURS = 3


def tier_of(points: int) -> str:
    if points >= 1600:
        return "LT1"
    if points >= 1450:
        return "LT2"
    if points >= 1300:
        return "LT3"
    if points >= 1150:
        return "LT4"
    return "LT5"


def contest_windows(now: datetime) -> dict[str, tuple[datetime, datetime]]:
    """Окна обоих контестов от сегодняшней даты по UTC."""
    base = now.astimezone(dt_timezone.utc).date()

    def window(day):
        begins = datetime.combine(day, time(CONTEST_HOUR_UTC), tzinfo=dt_timezone.utc)
        return begins, begins + timedelta(hours=CONTEST_HOURS)

    return {
        "past": window(base - timedelta(days=content.PAST_CONTEST["days_ago"])),
        "next": window(base + timedelta(days=content.NEXT_CONTEST["days_ahead"])),
    }


def _is_current(windows) -> bool:
    return (
        Contest.objects.filter(title=content.PAST_CONTEST["title"], start_time=windows["past"][0]).exists()
        and Contest.objects.filter(title=content.NEXT_CONTEST["title"], start_time=windows["next"][0]).exists()
    )


def world_user(email: str, username: str, **fields) -> CustomUser:
    """Строка выдуманного человека. Повторный вызов отдаёт уже созданную."""
    user = CustomUser.objects.filter(email=email).first()
    if user is not None:
        return user
    user = CustomUser(username=username, email=email, **fields)
    user.set_unusable_password()
    try:
        with transaction.atomic():
            user.save()
    except IntegrityError:
        return CustomUser.objects.get(email=email)
    return user


def _disciplines() -> dict[str, Discipline]:
    rows = {}
    for name in content.DISCIPLINES:
        rows[name] = Discipline.objects.filter(name=name, parent__isnull=True).first() or Discipline.objects.create(
            name=name
        )
    return rows


def _classmates(disciplines) -> list[CustomUser]:
    users = []
    for number, (nick, first, last, city, country, points, ratings, _group) in enumerate(content.CLASSMATES, 1):
        user = world_user(
            classmate_email(number),
            nick,
            first_name=first,
            last_name=last,
            city=city,
            country_code=country,
            overall_elo=points,
            show_in_leaderboard=True,
        )
        for name, score in ratings.items():
            UserRating.objects.get_or_create(
                user=user,
                discipline=disciplines[name],
                defaults={"elo_score": score, "tier_level": tier_of(score)},
            )
        users.append(user)
    return users


def _tasks(teacher, spec, discipline) -> list[Task]:
    tasks = []
    for title, difficulty, points, condition in spec["tasks"]:
        task, _ = Task.objects.get_or_create(
            author=teacher,
            title=title,
            defaults={
                "condition_text": condition,
                "difficulty": difficulty,
                "points": points,
                "status": "active",
                "discipline": discipline,
            },
        )
        tasks.append(task)
    return tasks


def _contest(spec, window, tasks, teacher) -> tuple[Contest, timedelta]:
    """Контест с нужным окном. Возвращает, на сколько его пришлось сдвинуть."""
    contest = Contest.objects.filter(title=spec["title"]).first()
    if contest is None:
        contest = Contest.objects.create(
            title=spec["title"],
            description=spec["description"],
            start_time=window[0],
            end_time=window[1],
            created_by=teacher,
        )
        shift = timedelta(0)
    else:
        shift = window[0] - contest.start_time
        if shift:
            Contest.objects.filter(pk=contest.pk).update(start_time=window[0], end_time=window[1])
    contest.tasks.set(tasks)
    return contest, shift


def solved_by(points: int) -> int:
    """Сколько задач кубка решил одноклассник: чем выше рейтинг, тем больше."""
    return max(0, min(len(content.PAST_CONTEST["tasks"]), int((points - 850) / 160)))


def _classmate_solutions(classmates, tasks, window, teacher) -> None:
    existing = set(
        TaskSubmission.objects.filter(task__in=tasks, student__in=classmates).values_list("student_id", "task_id")
    )
    for index, user in enumerate(classmates):
        for number, task in enumerate(tasks[: solved_by(user.overall_elo)]):
            if (user.pk, task.pk) in existing:
                continue
            row = TaskSubmission.objects.create(
                student=user,
                task=task,
                file_url_or_code="Решение на листе, фото приложено.",
                status="approved",
                reviewed_by=teacher,
            )
            # created_at ставится при вставке, поэтому окно контеста задаём отдельно.
            TaskSubmission.objects.filter(pk=row.pk).update(
                created_at=window[0] + timedelta(minutes=20 + 25 * number + index),
                reviewed_at=window[1] + timedelta(days=1, minutes=index),
            )


def ensure_world(now: datetime) -> bool:
    """Строит мир или сдвигает его даты. Возвращает, пришлось ли что-то менять."""
    windows = contest_windows(now)
    if _is_current(windows):
        return False
    with transaction.atomic():
        teacher = world_user(
            TEACHER_EMAIL,
            content.TEACHER["username"],
            first_name=content.TEACHER["first_name"],
            last_name=content.TEACHER["last_name"],
        )
        # Два первых посетителя строят мир по очереди, а не дважды.
        list(CustomUser.objects.select_for_update().filter(pk=teacher.pk))
        if _is_current(windows):
            return False

        disciplines = _disciplines()
        classmates = _classmates(disciplines)

        past_tasks = _tasks(teacher, content.PAST_CONTEST, disciplines["Математика"])
        _, shift = _contest(content.PAST_CONTEST, windows["past"], past_tasks, teacher)
        if shift:
            TaskSubmission.objects.filter(task__in=past_tasks).update(
                created_at=F("created_at") + shift,
                reviewed_at=F("reviewed_at") + shift,
            )
        _classmate_solutions(classmates, past_tasks, windows["past"], teacher)

        next_tasks = _tasks(teacher, content.NEXT_CONTEST, disciplines["Физика"])
        _contest(content.NEXT_CONTEST, windows["next"], next_tasks, teacher)
    return True


def past_contest_tasks() -> list[Task]:
    """Задачи осеннего кубка в порядке условия."""
    contest = Contest.objects.filter(title=content.PAST_CONTEST["title"]).first()
    if contest is None:
        return []
    order = {title: index for index, (title, *_rest) in enumerate(content.PAST_CONTEST["tasks"])}
    return sorted(contest.tasks.all(), key=lambda task: order.get(task.title, len(order)))


def group_classmates() -> list[CustomUser]:
    """Одноклассники из «10 «Б»» в порядке сюжета."""
    emails = [
        classmate_email(number)
        for number, row in enumerate(content.CLASSMATES, 1)
        if row[-1]
    ]
    users = {user.email: user for user in CustomUser.objects.filter(email__in=emails)}
    return [users[email] for email in emails if email in users]
