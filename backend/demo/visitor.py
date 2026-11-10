"""Аккаунт одного посетителя: Алия с её неделей, учёбой, чатами и местом в классе.

Всё строится от «сейчас» в зоне посетителя и пересобирается, когда у него начался
новый день. Отметка о сборке живёт в `CustomUser.last_login`: обычного входа через
Django у API нет, поле свободно, и так демо обходится без своих таблиц.
"""

from __future__ import annotations

import random
import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.apps import apps
from django.core.exceptions import FieldDoesNotExist
from django.db import transaction

from accounts.models import CustomUser, Discipline, PrivateLeaderboard, TaskSubmission, UserRating
from curriculum.models import CourseEnrollment, CourseModule, CoursePlan, CourseTopic, LearningGoal, SubjectChat
from curriculum.services import goals as goals_service
from curriculum.services import plans as plans_service
from diary.models import DiaryWeek, WeeklyTemplate
from diary.views import _sync_template_lessons
from habits.models import Habit, HabitLog
from habits.serializers import server_today
from mind.models import ReviewLog, Subject, Topic
from planner.models import Goal
from pomodoro.models import FocusSession
from studyplan.models import (
    FixedCommitment,
    LearningBlock,
    LearningBlockResult,
    StudySchedule,
    TemplateSlot,
    WeeklyScheduleTemplate,
)
from studyplan.scheduling.slots import local_to_utc

from . import content, days
from .world import contest_windows, group_classmates, past_contest_tasks, tier_of

DEFAULT_ZONE = "Asia/Almaty"
WEEKDAY_KEYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

# Учёт ИИ не трогаем при ежедневной пересборке: иначе лимит посетителя и дневной
# бюджет демо обнулялись бы каждое утро. Векторы книг живут в своей базе и уходят
# вместе с документом через сигнал `curriculum`.
USAGE_MODELS = {("ai_engine", "aiusageevent"), ("ai_engine", "aiusagequotastate")}
SKIPPED_MODELS = {("curriculum", "knowledgechunk")}

OBJECTIVES = {
    "practice": "Решить задачи по теме без подсказок, потом сверить ответы.",
    "theory": "Разобраться в теме и ответить на контрольный вопрос тьютора.",
    "review": "Вспомнить тему без конспекта и проверить себя.",
    "homework": "Сделать домашнее задание и отметить его в дневнике.",
}


# ───────────────────────────────── Время ───────────────────────────────────────


def resolve_zone(name) -> ZoneInfo:
    """Зона браузера. Пустая, чужая или выдуманная строка даёт Алматы."""
    if isinstance(name, str) and 0 < len(name) <= 64:
        try:
            return ZoneInfo(name)
        except Exception:  # noqa: BLE001 — ZoneInfoNotFoundError, ValueError на «../»
            pass
    return ZoneInfo(DEFAULT_ZONE)


def seeded_today(user: CustomUser, zone: ZoneInfo, now: datetime) -> bool:
    stamp = user.last_login
    return bool(stamp) and stamp.astimezone(zone).date() == now.astimezone(zone).date()


def _moment(day: date, minute: int, zone: ZoneInfo) -> datetime:
    minute = max(0, min(minute, 24 * 60 - 1))
    return local_to_utc(day, time(minute // 60, minute % 60), zone)[0]


def _clock(value: str) -> int:
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


def _next_date(today: date, month: int, day: int) -> date:
    candidate = date(today.year, month, day)
    return candidate if candidate >= today else date(today.year + 1, month, day)


# ─────────────────────────────── Очистка ───────────────────────────────────────


def _owned_models(keep_usage: bool):
    for model in apps.get_models():
        label = (model._meta.app_label, model._meta.model_name)
        if label in SKIPPED_MODELS or (keep_usage and label in USAGE_MODELS):
            continue
        try:
            model._meta.get_field("user_email")
        except FieldDoesNotExist:
            continue
        yield model


def wipe_user_rows(email: str, *, keep_usage: bool) -> None:
    """Всё, что приложения хранят по адресу. Сначала то, что держит остальное через PROTECT."""
    CourseEnrollment.objects.filter(user_email=email).delete()
    StudySchedule.objects.filter(user_email=email).delete()
    for model in _owned_models(keep_usage):
        model.objects.filter(user_email=email).delete()


def _wipe_account_rows(user: CustomUser) -> None:
    TaskSubmission.objects.filter(student=user).delete()
    UserRating.objects.filter(user=user).delete()
    PrivateLeaderboard.objects.filter(owner=user).delete()
    user.private_leaderboards.clear()


# ─────────────────────────────── Сборка ────────────────────────────────────────


def seed_if_needed(user_pk: int, zone: ZoneInfo, now: datetime) -> bool | None:
    """Собирает аккаунт, если сегодня по зоне посетителя он ещё не собран.

    Строка пользователя блокируется на время сборки: две вкладки, открытые разом,
    иначе собрали бы всё дважды. None — строки уже нет: её убрала чистка.
    """
    with transaction.atomic():
        user = CustomUser.objects.select_for_update().filter(pk=user_pk).first()
        if user is None:
            return None
        if seeded_today(user, zone, now):
            return False
        wipe_user_rows(user.email, keep_usage=True)
        _wipe_account_rows(user)
        build_visitor(user, zone, now)
        user.last_login = now
        user.save(update_fields=["last_login"])
    return True


def build_visitor(user: CustomUser, zone: ZoneInfo, now: datetime) -> None:
    email = user.email
    local_now = now.astimezone(zone)
    today = local_now.date()
    rng = random.Random(f"{email}:{today.isoformat()}")

    _profile(user)
    subjects = _subjects(email)
    template = _school(email, subjects)
    _diary(email, subjects, template, today, local_now, rng)
    _commitments(email)
    goals = _learning_goals(email)
    plans = _plans(email, goals, today, now)
    slots = _blocks(email, plans, zone, today, local_now, now)
    _focus(email, slots, zone, now, rng)
    _topics(email, subjects, now)
    life_goals = _life_goals(email, goals, today)
    # Привычки считают дни по дате сервера (UTC), а не по зоне ученика.
    _habits(email, life_goals, server_today())
    _chats(email, goals, now, rng)
    _contest_rows(user, now)


def _profile(user: CustomUser) -> None:
    for field, value in content.PROFILE.items():
        setattr(user, field, value)
    user.has_full_access = True
    # Посетители не видят друг друга только благодаря ветке DEMO_MODE в accounts.views.on_public_board.
    user.show_in_leaderboard = True
    user.ai_plan = "free"
    user.save(
        update_fields=[*content.PROFILE.keys(), "has_full_access", "show_in_leaderboard", "ai_plan"]
    )


def _subjects(email: str) -> dict[str, Subject]:
    rows = {}
    for index, (name, emoji, color, hours) in enumerate(content.SUBJECTS):
        rows[name] = Subject.objects.create(
            user_email=email, name=name, emoji=emoji, color=color, target_hours_week=hours, order_index=index
        )
    return rows


def _school(email: str, subjects: dict[str, Subject]) -> WeeklyTemplate:
    slots = []
    for day, names in content.TIMETABLE.items():
        for number, name in enumerate(names, 1):
            start, end = content.LESSON_TIMES[number - 1]
            slots.append({
                "id": str(uuid.uuid4()),
                "dayOfWeek": day,
                "lessonNumber": number,
                "startTime": start,
                "endTime": end,
                "subjectId": str(subjects[name].pk),
                "blockType": "lesson",
                "label": "",
            })
    template = WeeklyTemplate.objects.create(
        id=str(uuid.uuid4()), user_email=email, name="Школьное расписание", slots=[], is_active=True
    )
    _sync_template_lessons(template, slots)
    return template


def _grades(rng: random.Random, subject: str) -> dict:
    grades = {"retelling": None, "exercises": None, "test": None}
    roll = rng.random()
    if roll < 0.42:
        # Химия чуть слабее: ради неё и готовится СОР.
        pool = (5, 4, 4, 3) if subject == "Химия" else (5, 5, 4, 5, 4)
        if subject == "История Казахстана":
            grades["retelling"] = rng.choice(pool)
        else:
            grades["exercises"] = rng.choice(pool)
    elif roll < 0.5:
        grades["test"] = rng.choice((5, 4))
    return grades


def _diary(email, subjects, template, today, local_now, rng) -> None:
    """Эта и прошлая неделя: домашка, оценки и заметка о СОР. Пустые недели дневник
    пересобирает из шаблона, поэтому в каждой есть домашка."""
    monday = today - timedelta(days=today.weekday())
    counters: dict[str, int] = {}
    stamp = local_now.isoformat()
    now_minute = local_now.hour * 60 + local_now.minute

    for week_start in (monday - timedelta(days=7), monday):
        week_id = str(uuid.uuid4())
        week_days = []
        for offset, key in enumerate(WEEKDAY_KEYS):
            day = week_start + timedelta(days=offset)
            lessons = []
            for number, name in enumerate(content.TIMETABLE.get(key, ()), 1):
                start, end = content.LESSON_TIMES[number - 1]
                subject = subjects[name]
                pool = content.HOMEWORK[name]
                homework = pool[counters.get(name, 0) % len(pool)]
                counters[name] = counters.get(name, 0) + 1
                finished = day < today or (day == today and _clock(end) <= now_minute)
                note = content.NOTES.get((key, name), "") if week_start == monday else ""
                lessons.append({
                    "id": str(uuid.uuid4()),
                    "lessonNumber": number,
                    "startTime": start,
                    "endTime": end,
                    "blockType": "lesson",
                    "blockLabel": "",
                    "linkedSubjectIds": [],
                    "subjectId": str(subject.pk),
                    "subjectName": subject.name,
                    "subjectEmoji": subject.emoji,
                    "subjectColor": subject.color,
                    "grades": _grades(rng, name) if finished else {"retelling": None, "exercises": None, "test": None},
                    "homework": homework,
                    "homeworkDone": day < today,
                    "notes": note,
                })
            week_days.append({
                "id": str(uuid.uuid4()),
                "userId": email,
                "date": day.isoformat(),
                "dayOfWeek": key,
                "weekId": week_id,
                "lessons": lessons,
                "youtubeLinks": [],
                "createdAt": stamp,
                "updatedAt": stamp,
            })
        DiaryWeek.objects.create(
            id=week_id,
            user_email=email,
            week_start=week_start.isoformat(),
            week_end=(week_start + timedelta(days=6)).isoformat(),
            template_id=template.id,
            days=week_days,
        )


def _commitments(email: str) -> None:
    for title, kind, weekday, start, minutes in content.COMMITMENTS:
        FixedCommitment.objects.create(
            user_email=email,
            title=title,
            kind=kind,
            weekday=weekday,
            start_time=time(*map(int, start.split(":"))),
            duration_minutes=minutes,
        )


def _learning_goals(email: str) -> dict[str, LearningGoal]:
    """Папки предметов для тьютора и библиотеки. Связываются с предметами дневника по имени."""
    rows = {}
    for spec in content.PLANS:
        name = spec["subject"]
        goal = LearningGoal.objects.create(
            user_email=email,
            original_text=name,
            goal_type=LearningGoal.GoalType.COURSE,
            current_level=LearningGoal.Level.SCHOOL_BASIC,
            target_level=LearningGoal.Level.SCHOOL_CONFIDENT,
        )
        rows[name] = goals_service.confirm_goal(goal, normalized_subject=name)
    return rows


def _plans(email, goals, today, now) -> dict[str, dict]:
    """Программы курсов: модули и темы, подтверждённая версия и запись на курс."""
    rows = {}
    for spec in content.PLANS:
        goal = goals[spec["subject"]]
        topics_spec = [topic for _title, topics in spec["modules"] for topic in topics]
        total = sum(minutes for _name, minutes, _criteria in topics_spec)
        plan = CoursePlan.objects.create(
            user_email=email,
            goal=goal,
            title=spec["title"],
            objective=spec["objective"],
            current_level=goal.current_level,
            target_level=goal.target_level,
            language="ru",
            estimated_total_minutes=total,
            recommended_sessions_per_week=3,
            recommended_session_minutes=40,
            status=CoursePlan.Status.AWAITING_APPROVAL,
            current_version=1,
        )
        topics = []
        for module_index, (module_title, module_topics) in enumerate(spec["modules"]):
            module = CourseModule.objects.create(
                plan=plan,
                external_id=f"m{module_index + 1}",
                title=module_title,
                order_index=module_index,
                estimated_minutes=sum(minutes for _name, minutes, _criteria in module_topics),
            )
            for name, minutes, criteria in module_topics:
                topics.append(
                    CourseTopic.objects.create(
                        module=module,
                        external_id=f"t{len(topics) + 1}",
                        title=name,
                        order_index=len(topics),
                        estimated_minutes=minutes,
                        mastery_criteria=criteria,
                    )
                )
        plans_service._apply_forecast(plan, goal, start_date=today)
        plans_service._snapshot_version(plan, None, reason="Программа ученицы демо")
        plans_service.approve_plan(plan, user_email=email)
        rows[spec["key"]] = {"spec": spec, "plan": plan, "topics": topics}
    return rows


def _rhythm(email: str, zone: ZoneInfo, first_day: date) -> WeeklyScheduleTemplate:
    template = WeeklyScheduleTemplate.objects.create(
        user_email=email, title="Учебный ритм", timezone=zone.key, active=True, valid_from=first_day
    )
    rows = []
    for weekday, layout in content.WEEK_LAYOUT.items():
        first = _clock(layout[0][0])
        last = max(_clock(start) + minutes for start, minutes, _plan, _kind in layout)
        rows.append(
            TemplateSlot(
                template=template,
                weekday=weekday,
                start_time=time(first // 60, first % 60),
                duration_minutes=last - first,
            )
        )
    TemplateSlot.objects.bulk_create(rows)
    return template


def _layout(today: date, local_now: datetime) -> list[days.Slot]:
    """Три недели блоков: две прошлых, эта и следующая."""
    monday = today - timedelta(days=today.weekday())
    now_minute = local_now.hour * 60 + local_now.minute
    slots = []
    day = monday - timedelta(days=14)
    while day <= monday + timedelta(days=13):
        slots.extend(days.today_slots(day, now_minute) if day == today else days.week_slots(day))
        day += timedelta(days=1)
    return slots


def _topic_indexes(slots: list[days.Slot], plan_key: str, today: date, today_topic: int, count: int) -> dict[int, int]:
    """Какая тема у каждого блока программы: сегодняшняя у первого блока сегодня,
    раньше — предыдущие, позже — следующие, по два блока на тему."""
    own = [index for index, slot in enumerate(slots) if slot.plan == plan_key]
    if not own:
        return {}
    anchor = next((position for position, index in enumerate(own) if slots[index].day >= today), len(own) - 1)
    result = {}
    for position, index in enumerate(own):
        step = position - anchor
        topic = today_topic + (step // 2 if step >= 0 else -((-step + 1) // 2))
        result[index] = max(0, min(count - 1, topic))
    return result


def _block_title(spec: dict, topic: CourseTopic, kind: str) -> str:
    override = spec.get("block_titles", {}).get(topic.title)
    if override and override.startswith("Повторение") == (kind == "review"):
        return override
    name = topic.title
    if name[:1].isalpha() and "а" <= name[:1].lower() <= "я":
        name = name[:1].lower() + name[1:]
    return f"Повторение: {name}" if kind == "review" else f"{spec['short']}: {name}"


def _blocks(email, plans, zone, today, local_now, now) -> list[tuple[days.Slot, LearningBlock]]:
    monday = today - timedelta(days=today.weekday())
    first_day, last_day = monday - timedelta(days=14), monday + timedelta(days=13)
    template = _rhythm(email, zone, first_day)
    schedules = {
        key: StudySchedule.objects.create(
            user_email=email,
            course_plan=row["plan"],
            template=template,
            start_date=first_day,
            end_date=last_day,
            timezone=zone.key,
            status=StudySchedule.Status.ACTIVE,
            generation_source="assistant",
            confirmed_at=now - timedelta(days=15),
        )
        for key, row in plans.items()
    }

    slots = _layout(today, local_now)
    topic_of: dict[int, int] = {}
    for key, row in plans.items():
        names = [topic.title for topic in row["topics"]]
        today_topic = names.index(row["spec"]["today_topic"])
        topic_of.update(_topic_indexes(slots, key, today, today_topic, len(names)))

    blocks = []
    for index, slot in enumerate(slots):
        row = plans[slot.plan]
        topic = row["topics"][topic_of[index]]
        activity, workspace = content.BLOCK_KINDS[slot.kind]
        begins = _moment(slot.day, slot.start, zone)
        ends = begins + timedelta(minutes=slot.minutes)
        done = ends <= now
        blocks.append(
            LearningBlock(
                user_email=email,
                schedule=schedules[slot.plan],
                course_plan=row["plan"],
                module_id=topic.module_id,
                topic=topic,
                title=_block_title(row["spec"], topic, slot.kind)[:300],
                objective=OBJECTIVES[slot.kind],
                activity_type=activity,
                workspace_type=workspace,
                start_at=begins,
                end_at=ends,
                duration_minutes=slot.minutes,
                status=LearningBlock.Status.COMPLETED if done else LearningBlock.Status.SCHEDULED,
                detail_level=LearningBlock.DetailLevel.OUTLINE,
                source=LearningBlock.Source.REVIEW if slot.kind == "review" else LearningBlock.Source.SCHEDULER,
                mastery_criteria=topic.mastery_criteria,
                review_of_topic=topic if slot.kind == "review" else None,
                review_step=0 if slot.kind == "review" else None,
                created_by="assistant",
            )
        )
    LearningBlock.objects.bulk_create(blocks)
    LearningBlockResult.objects.bulk_create(
        [
            LearningBlockResult(
                block=block,
                user_email=email,
                opened_at=block.start_at,
                started_at=block.start_at,
                completed_at=block.end_at,
                actual_minutes=block.duration_minutes,
                completion_percent=100,
                completion_reason="completed",
            )
            for block in blocks
            if block.status == LearningBlock.Status.COMPLETED
        ]
    )
    return list(zip(slots, blocks))


def _focus(email, placed, zone, now, rng) -> None:
    """Помодоро за три недели: фокус на большинстве сделанных блоков."""
    rows = []
    for _slot, block in placed:
        if block.status != LearningBlock.Status.COMPLETED or block.end_at < now - timedelta(days=21):
            continue
        if rng.random() > 0.75:
            continue
        preset = 50 if block.duration_minutes >= 50 else 25
        planned = min(preset, block.duration_minutes) * 60
        rows.append(
            FocusSession(
                user_email=email,
                kind=FocusSession.FOCUS,
                started_at=block.start_at,
                seconds=planned if rng.random() < 0.8 else planned - 60 * rng.randint(2, 6),
                planned_seconds=planned,
                preset_focus_min=preset,
                preset_break_min=10 if preset == 50 else 5,
            )
        )
    FocusSession.objects.bulk_create(rows)


def _topics(email, subjects, now) -> None:
    """Слабые темы с историей повторений: три пора повторить, четыре в работе, пять выучены."""
    logs = []
    ratings = {"MEDIUM": ("AGAIN", "HARD", "GOOD"), "SUCCESS": ("HARD", "GOOD", "GOOD"), "MASTERED": ("GOOD", "GOOD", "EASY")}
    for index, (subject, name, status, ease, interval, next_in, last_ago) in enumerate(content.TOPICS):
        topic = Topic.objects.create(
            subject=subjects[subject],
            name=name,
            status=status,
            study_state="STUDIED",
            order_index=index,
            last_revised_at=now - timedelta(days=last_ago),
            next_review_at=now + timedelta(days=next_in),
            interval_days=interval,
            ease_factor=ease,
        )
        for step, rating in enumerate(reversed(ratings[status])):
            logs.append((topic, rating, max(1, interval - step * 2), now - timedelta(days=last_ago + step * max(2, interval))))
    for topic, rating, after, when in logs:
        row = ReviewLog.objects.create(topic=topic, rating=rating, interval_days_after=after)
        ReviewLog.objects.filter(pk=row.pk).update(reviewed_at=when)


def _life_goals(email, goals, today) -> dict[str, Goal]:
    rows = {}
    for title, description, tone, progress, priority, deadline, is_main, subjects in content.GOALS:
        due = _next_date(today, deadline[1], deadline[2]) if deadline[0] == "date" else today + timedelta(days=deadline[1])
        goal = Goal.objects.create(
            user_email=email,
            title=title,
            description=description,
            type="goal",
            status="active",
            priority=priority,
            due_date=due,
            progress=progress,
            tone=tone,
            scope="study",
            is_main=is_main,
            order_index=len(rows),
        )
        goal.lessons.set([goals[name] for name in subjects if name in goals])
        rows[title] = goal
    return rows


def _habits(email, life_goals, today) -> None:
    for name, emoji, color, hint, streak, extra, goal_title in content.HABITS:
        habit = Habit.objects.create(
            user_email=email,
            name=name,
            emoji=emoji,
            color=color,
            goal_text=hint,
            frequency=Habit.DAILY,
            goal=life_goals.get(goal_title) if goal_title else None,
        )
        offsets = sorted({*range(1, streak + 1), *extra})
        HabitLog.objects.bulk_create([HabitLog(habit=habit, date=today - timedelta(days=offset)) for offset in offsets])


def _turns(rows, rng) -> list[dict]:
    turns = []
    for role, text in rows:
        turn = {"role": role, "content": text}
        if role == "assistant":
            # Книги у разговора нет: так же сохраняет ответы и сам чат.
            turn.update({"library": False, "durationMs": rng.randint(2800, 9500)})
        turns.append(turn)
    return turns


def _chats(email, goals, now, rng) -> None:
    """Три разговора. Чат по алгебре самый свежий: тур открывает именно его."""
    chats = (
        (None, content.GENERAL_CHAT_TITLE, content.GENERAL_CHAT, timedelta(days=2)),
        (goals["Физика"], content.PHYSICS_CHAT_TITLE, content.PHYSICS_CHAT, timedelta(days=1)),
        (goals["Алгебра"], content.ALGEBRA_CHAT_TITLE, content.ALGEBRA_CHAT, timedelta(hours=2)),
    )
    for goal, title, rows, ago in chats:
        chat = SubjectChat.objects.create(user_email=email, goal=goal, title=title, messages=_turns(rows, rng))
        SubjectChat.objects.filter(pk=chat.pk).update(
            created_at=now - ago - timedelta(minutes=25), updated_at=now - ago
        )


def _contest_rows(user: CustomUser, now: datetime) -> None:
    """Рейтинг по предметам, решения осеннего кубка и группа «10 «Б»»."""
    for name, points in content.PROFILE_RATINGS:
        discipline = Discipline.objects.filter(name=name, parent__isnull=True).first()
        if discipline is not None:
            UserRating.objects.create(user=user, discipline=discipline, elo_score=points, tier_level=tier_of(points))

    tasks = past_contest_tasks()
    window = contest_windows(now)["past"]
    teacher = tasks[0].author if tasks else None
    for number, task in enumerate(tasks[: content.VISITOR_SOLVED]):
        row = TaskSubmission.objects.create(
            student=user,
            task=task,
            file_url_or_code="Решение на листе, фото приложено.",
            status="approved",
            reviewed_by=teacher,
        )
        # Последнее решение учитель проверил только позавчера: оно и даёт прирост за неделю.
        reviewed = now - timedelta(days=2) if number == content.VISITOR_SOLVED - 1 else window[1] + timedelta(days=1)
        TaskSubmission.objects.filter(pk=row.pk).update(
            created_at=window[0] + timedelta(minutes=30 + 35 * number), reviewed_at=reviewed
        )

    classmates = group_classmates()
    if classmates:
        board = PrivateLeaderboard.objects.create(name=content.GROUP_NAME, owner=user)
        board.members.add(user, *classmates)
