import json
from datetime import date, datetime, timedelta, timezone as dt_timezone
from unittest import mock
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from accounts.models import Contest, CustomUser, PrivateLeaderboard, Task, TaskSubmission
from ai_engine.models import AIUsageEvent
from config.testing import auth_headers
from curriculum.models import CoursePlan, LearningGoal, SubjectChat
from diary.models import DiaryWeek, TemplateLesson, WeeklyTemplate
from habits.models import Habit, HabitLog
from mind.models import Subject, Topic
from planner.models import Goal
from pomodoro.models import FocusSession
from studyplan.models import FixedCommitment, LearningBlock, StudySchedule

from demo import content, days
from demo.identity import TEACHER_EMAIL, classmate_email, is_visitor_email
from demo.limits import client_ip
from demo.middleware import DemoDailyBudgetMiddleware, is_ai_request
from demo.prune import prune_visitors
from demo.visitor import resolve_zone, seed_if_needed
from demo.world import contest_windows, ensure_world

VISITOR = "visitor-0f8e7a2c-1111-4c3d-9e2f-0a1b2c3d4e5f@demo.timely-plan.study"
OTHER = "visitor-aa8e7a2c-2222-4c3d-9e2f-0a1b2c3d4e5f@demo.timely-plan.study"
ALMATY = ZoneInfo("Asia/Almaty")


def start(client, email, tz="Asia/Almaty", **extra):
    return client.post(
        "/api/demo/start/",
        data={"tz": tz},
        content_type="application/json",
        **auth_headers(email),
        **extra,
    )


def local(year, month, day, hour, minute, zone=ALMATY):
    return datetime(year, month, day, hour, minute, tzinfo=zone).astimezone(dt_timezone.utc)


def visitor_row(email):
    return CustomUser.objects.create(username=email, email=email)


class IdentityTests(SimpleTestCase):
    def test_only_generated_visitor_addresses_match(self):
        self.assertTrue(is_visitor_email(VISITOR))
        self.assertFalse(is_visitor_email("student@example.com"))
        self.assertFalse(is_visitor_email(VISITOR.upper()))
        self.assertFalse(is_visitor_email(VISITOR + ".evil.com"))
        self.assertFalse(is_visitor_email(TEACHER_EMAIL))
        self.assertFalse(is_visitor_email(classmate_email(1)))
        self.assertFalse(is_visitor_email(None))

    def test_unknown_zone_falls_back_to_almaty(self):
        for name in ("Mars/Base", "../etc/passwd", "", None, 42, "x" * 80):
            self.assertEqual(resolve_zone(name).key, "Asia/Almaty")
        self.assertEqual(resolve_zone("America/New_York").key, "America/New_York")


class LimitsTests(SimpleTestCase):
    def ip(self, **meta):
        request = RequestFactory().post("/api/demo/start/", REMOTE_ADDR="10.9.9.9", **meta)
        return client_ip(request)

    def test_trusts_the_address_the_proxy_appends(self):
        # Левые части X-Forwarded-For и X-Real-IP клиент может прислать сам.
        self.assertEqual(
            self.ip(HTTP_X_FORWARDED_FOR="6.6.6.6, 203.0.113.7", HTTP_X_REAL_IP="6.6.6.6"), "203.0.113.7"
        )
        self.assertEqual(self.ip(HTTP_X_REAL_IP="198.51.100.4"), "198.51.100.4")
        self.assertEqual(self.ip(), "10.9.9.9")

    def test_defaults_fit_a_room_behind_one_nat(self):
        self.assertEqual(settings.DEMO_STARTS_PER_IP_PER_HOUR, 60)
        self.assertEqual(settings.DEMO_AI_REQUESTS_PER_IP_PER_DAY, 60)

    def test_matcher_covers_every_model_call(self):
        chat = "/api/curriculum/chats/0f8e7a2c-1111-4c3d-9e2f-0a1b2c3d4e5f"
        for path in (
            "/api/curriculum/ask/stream/",
            "/api/studyplan/chat/stream/",
            f"{chat}/title/",
            f"{chat}/title",
            "/api/study-schedules/generate/",
            "/api/study-schedules/generate",
        ):
            self.assertTrue(is_ai_request("POST", path), path)
        for method, path in (
            ("GET", f"{chat}/title/"),
            ("POST", f"{chat}/"),
            ("POST", f"{chat}/titles/"),
            ("POST", "/api/curriculum/chats/"),
            ("POST", "/api/study-schedules/generate/extra/"),
            ("POST", "/api/study-schedules/"),
            ("GET", "/api/study-schedules/generate/"),
        ):
            self.assertFalse(is_ai_request(method, path), (method, path))


class DayLayoutTests(SimpleTestCase):
    WEDNESDAY = date(2026, 11, 11)
    TUESDAY = date(2026, 11, 10)
    SUNDAY = date(2026, 11, 15)

    def overlaps(self, slot, rows):
        return any(slot.start < end and start < slot.end for start, end in rows)

    def test_free_afternoon_has_a_block_running_now(self):
        slots = days.today_slots(self.WEDNESDAY, 16 * 60 + 20)
        running = [slot for slot in slots if slot.running]
        self.assertEqual(len(running), 1)
        self.assertLessEqual(running[0].start, 16 * 60 + 20)
        self.assertGreater(running[0].end, 16 * 60 + 20)
        self.assertEqual(running[0].plan, "algebra")
        self.assertEqual(len([slot for slot in slots if slot.end <= running[0].start]), 2)
        self.assertGreaterEqual(len([slot for slot in slots if slot.start >= running[0].end]), 2)

    def test_school_time_uses_the_usual_day(self):
        self.assertEqual(days.today_slots(self.WEDNESDAY, 10 * 60), days.week_slots(self.WEDNESDAY))

    def test_running_block_stops_before_volleyball(self):
        slots = days.today_slots(self.TUESDAY, 16 * 60 + 30)
        running = next(slot for slot in slots if slot.running)
        self.assertLessEqual(running.end, 17 * 60 - days.MARGIN)
        self.assertGreater(running.end, 16 * 60 + 30)

    def test_night_still_has_a_running_block(self):
        slots = days.today_slots(self.SUNDAY, 3 * 60)
        running = next(slot for slot in slots if slot.running)
        self.assertLessEqual(running.start, 3 * 60)
        self.assertGreater(running.end, 3 * 60)
        self.assertGreater(len(slots), 1)

    def test_no_layout_overlaps_itself_or_busy_time(self):
        for offset in range(7):
            day = date(2026, 11, 9) + timedelta(days=offset)
            taken = days.busy(day)
            for minute in range(0, 24 * 60, 10):
                slots = days.today_slots(day, minute)
                with self.subTest(day=day, minute=minute):
                    self.assertEqual(slots, sorted(slots, key=lambda slot: slot.start))
                    for left, right in zip(slots, slots[1:]):
                        self.assertLessEqual(left.end, right.start)
                    for slot in slots:
                        self.assertFalse(self.overlaps(slot, taken))
                    free = not any(start <= minute < end for start, end in taken)
                    if free and days.DAY_START <= minute < days.NIGHT_FROM - 60:
                        running = [slot for slot in slots if slot.running]
                        if running:
                            self.assertTrue(running[0].start <= minute < running[0].end)


@override_settings(DEMO_MODE=True)
class DemoStartTests(TestCase):
    def setUp(self):
        cache.clear()

    @override_settings(DEMO_MODE=False)
    def test_off_without_demo_mode(self):
        self.assertEqual(start(self.client, VISITOR).status_code, 404)
        self.assertFalse(Contest.objects.exists())

    def test_needs_a_token(self):
        response = self.client.post("/api/demo/start/", data={}, content_type="application/json")
        self.assertEqual(response.status_code, 401)

    def test_rejects_anyone_but_a_visitor(self):
        response = start(self.client, "student@example.com")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "Это не посетитель демо.")
        self.assertFalse(CustomUser.objects.filter(email="student@example.com").exists())

    def test_first_start_builds_the_whole_account(self):
        response = start(self.client, VISITOR)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "seeded": True})

        user = CustomUser.objects.get(email=VISITOR)
        self.assertEqual(user.first_name, "Алия")
        self.assertTrue(user.show_in_leaderboard)
        self.assertTrue(user.has_full_access)
        self.assertIsNotNone(user.last_login)

        self.assertEqual(Subject.objects.filter(user_email=VISITOR).count(), len(content.SUBJECTS))
        template = WeeklyTemplate.objects.get(user_email=VISITOR, is_active=True)
        self.assertEqual(TemplateLesson.objects.filter(template=template).count(), 30)
        weeks = DiaryWeek.objects.filter(user_email=VISITOR)
        self.assertEqual(weeks.count(), 2)
        for week in weeks:
            # Неделя без домашки пересобралась бы из шаблона и потеряла оценки.
            self.assertTrue(any(lesson["homework"] for day in week.days for lesson in day["lessons"]))
        self.assertEqual(FixedCommitment.objects.filter(user_email=VISITOR).count(), 3)

        self.assertEqual(LearningGoal.objects.filter(user_email=VISITOR).count(), len(content.PLANS))
        self.assertEqual(
            CoursePlan.objects.filter(user_email=VISITOR, status=CoursePlan.Status.ACTIVE).count(), len(content.PLANS)
        )
        self.assertEqual(
            StudySchedule.objects.filter(user_email=VISITOR, status=StudySchedule.Status.ACTIVE).count(),
            len(content.PLANS),
        )
        blocks = LearningBlock.objects.filter(user_email=VISITOR)
        self.assertGreater(blocks.count(), 50)
        self.assertTrue(blocks.filter(status=LearningBlock.Status.COMPLETED).exists())
        today = timezone.now().astimezone(ALMATY).date()
        self.assertTrue(any(block.start_at.astimezone(ALMATY).date() == today for block in blocks))

        topics = Topic.objects.filter(subject__user_email=VISITOR)
        self.assertEqual(topics.count(), len(content.TOPICS))
        self.assertEqual(topics.filter(next_review_at__lte=timezone.now()).count(), 3)
        goals = Goal.objects.filter(user_email=VISITOR)
        self.assertEqual(goals.count(), 3)
        self.assertEqual(goals.filter(is_main=True).count(), 1)
        self.assertEqual(Habit.objects.filter(user_email=VISITOR).count(), 3)
        # Привычки живут по дате сервера: сегодня ещё не отмечено, вчера отмечено.
        server_day = timezone.now().date()
        self.assertFalse(HabitLog.objects.filter(habit__user_email=VISITOR, date=server_day).exists())
        self.assertTrue(HabitLog.objects.filter(habit__user_email=VISITOR, date=server_day - timedelta(days=1)).exists())
        self.assertTrue(FocusSession.objects.filter(user_email=VISITOR).exists())

        chats = SubjectChat.objects.filter(user_email=VISITOR).order_by("-updated_at")
        self.assertEqual(chats.count(), 3)
        # Договор с туром: самый свежий чат — про тригонометрическое уравнение.
        self.assertIn("тригонометр", chats.first().title.casefold())
        self.assertEqual(chats.first().messages[0]["role"], "user")

        window = contest_windows(timezone.now())["past"]
        solutions = TaskSubmission.objects.filter(student=user, status="approved")
        self.assertEqual(solutions.count(), content.VISITOR_SOLVED)
        for row in solutions:
            self.assertTrue(window[0] <= row.created_at <= window[1])
        board = PrivateLeaderboard.objects.get(owner=user)
        self.assertEqual(board.members.count(), 1 + sum(1 for row in content.CLASSMATES if row[-1]))

    def test_second_start_the_same_day_changes_nothing(self):
        start(self.client, VISITOR)
        chats = set(SubjectChat.objects.filter(user_email=VISITOR).values_list("id", flat=True))
        response = start(self.client, VISITOR)
        self.assertEqual(response.json(), {"ok": True, "seeded": False})
        self.assertEqual(set(SubjectChat.objects.filter(user_email=VISITOR).values_list("id", flat=True)), chats)

    def test_new_day_rebuilds_but_keeps_ai_usage(self):
        start(self.client, VISITOR)
        AIUsageEvent.objects.create(user_email=VISITOR, model_name="m", total_tokens=10, billable_tokens=10)
        CustomUser.objects.filter(email=VISITOR).update(last_login=timezone.now() - timedelta(days=2))
        response = start(self.client, VISITOR)
        self.assertEqual(response.json(), {"ok": True, "seeded": True})
        self.assertEqual(Subject.objects.filter(user_email=VISITOR).count(), len(content.SUBJECTS))
        self.assertEqual(SubjectChat.objects.filter(user_email=VISITOR).count(), 3)
        self.assertEqual(TaskSubmission.objects.filter(student__email=VISITOR).count(), content.VISITOR_SOLVED)
        self.assertEqual(PrivateLeaderboard.objects.filter(owner__email=VISITOR).count(), 1)
        self.assertTrue(AIUsageEvent.objects.filter(user_email=VISITOR).exists())

    def test_world_is_shared_between_visitors(self):
        start(self.client, VISITOR)
        start(self.client, OTHER)
        world = CustomUser.objects.filter(email__endswith="@demo.timely-plan.study").exclude(
            email__startswith="visitor-"
        )
        self.assertEqual(world.count(), len(content.CLASSMATES) + 1)
        self.assertEqual(Contest.objects.count(), 2)
        self.assertEqual(
            Task.objects.count(), len(content.PAST_CONTEST["tasks"]) + len(content.NEXT_CONTEST["tasks"])
        )

    def test_visitors_never_see_each_other_on_the_leaderboard(self):
        start(self.client, VISITOR)
        start(self.client, OTHER)
        me = CustomUser.objects.get(email=VISITOR)
        other = CustomUser.objects.get(email=OTHER)
        rows = self.client.get("/api/leaderboard/", **auth_headers(VISITOR)).json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        ids = {row["id"] for row in rows}
        self.assertIn(me.pk, ids)
        self.assertNotIn(other.pk, ids)
        self.assertEqual(len(ids), len(content.CLASSMATES) + 1)

    def test_a_failing_prune_never_breaks_the_start(self):
        with mock.patch("demo.views.prune_visitors", side_effect=RuntimeError("boom")):
            with self.assertLogs("demo.start", "ERROR"):
                response = start(self.client, VISITOR)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["seeded"])

    @override_settings(DEMO_STARTS_PER_IP_PER_HOUR=1)
    def test_new_visitors_are_limited_per_address(self):
        self.assertEqual(start(self.client, VISITOR).status_code, 200)
        response = start(self.client, OTHER)
        self.assertEqual(response.status_code, 429)
        self.assertIn("error", response.json())
        # Вернувшийся посетитель лимит не тратит.
        self.assertEqual(start(self.client, VISITOR).status_code, 200)


@override_settings(DEMO_MODE=True)
class SeedTimeTests(TestCase):
    def seed(self, now, zone=ALMATY):
        ensure_world(now)
        user = visitor_row(VISITOR)
        self.assertTrue(seed_if_needed(user.pk, zone, now))
        return LearningBlock.objects.filter(user_email=VISITOR)

    def test_afternoon_block_runs_now(self):
        now = local(2026, 11, 11, 16, 20)
        blocks = self.seed(now)
        running = blocks.get(start_at__lte=now, end_at__gt=now)
        self.assertEqual(running.title, "Алгебра: тригонометрические уравнения, № 412–416")
        self.assertEqual(running.status, LearningBlock.Status.SCHEDULED)
        self.assertEqual(running.topic.title, "Тригонометрические уравнения")
        self.assertTrue(blocks.filter(end_at__lte=now, start_at__gte=local(2026, 11, 11, 0, 0)).exists())
        self.assertFalse(blocks.filter(end_at__lte=now, status=LearningBlock.Status.SCHEDULED).exists())

    def test_school_time_has_no_block_over_lessons(self):
        now = local(2026, 11, 11, 10, 0)
        blocks = self.seed(now)
        self.assertFalse(blocks.filter(start_at__lte=now, end_at__gt=now).exists())
        school = (local(2026, 11, 11, 8, 30), local(2026, 11, 11, 13, 55))
        self.assertFalse(blocks.filter(start_at__lt=school[1], end_at__gt=school[0]).exists())
        self.assertTrue(blocks.filter(start_at__gte=school[1], start_at__lt=local(2026, 11, 12, 0, 0)).exists())

    def test_a_vanished_row_is_reported_not_raised(self):
        self.assertIsNone(seed_if_needed(987654, ALMATY, timezone.now()))

    def test_blocks_follow_the_visitors_zone(self):
        zone = ZoneInfo("America/New_York")
        now = local(2026, 11, 11, 16, 20, zone)
        blocks = self.seed(now, zone)
        running = blocks.get(start_at__lte=now, end_at__gt=now)
        self.assertEqual(running.start_at.astimezone(zone).date(), date(2026, 11, 11))
        self.assertEqual(StudySchedule.objects.filter(user_email=VISITOR).first().timezone, "America/New_York")


@override_settings(DEMO_MODE=True)
class WorldTests(TestCase):
    def test_world_is_built_once_and_moves_with_the_days(self):
        now = timezone.now()
        self.assertTrue(ensure_world(now))
        self.assertFalse(ensure_world(now))
        people = CustomUser.objects.count()

        later = now + timedelta(days=1)
        self.assertTrue(ensure_world(later))
        self.assertEqual(CustomUser.objects.count(), people)
        window = contest_windows(later)["past"]
        past = Contest.objects.get(title=content.PAST_CONTEST["title"])
        self.assertEqual(past.start_time, window[0])
        rows = TaskSubmission.objects.filter(task__contests=past)
        self.assertTrue(rows.exists())
        for row in rows:
            self.assertTrue(window[0] <= row.created_at <= window[1])
        upcoming = Contest.objects.get(title=content.NEXT_CONTEST["title"])
        self.assertGreater(upcoming.start_time, later)


@override_settings(DEMO_MODE=True)
class PruneTests(TestCase):
    def age(self, user, *, joined_days, seeded_days):
        now = timezone.now()
        CustomUser.objects.filter(pk=user.pk).update(
            date_joined=now - timedelta(days=joined_days),
            last_login=None if seeded_days is None else now - timedelta(days=seeded_days),
        )

    def test_old_visitors_go_with_all_their_rows(self):
        now = timezone.now()
        ensure_world(now)
        old, fresh = visitor_row(OTHER), visitor_row(VISITOR)
        seed_if_needed(old.pk, ALMATY, now)
        seed_if_needed(fresh.pk, ALMATY, now)
        AIUsageEvent.objects.create(user_email=OTHER, model_name="m", total_tokens=5, billable_tokens=5)
        self.age(old, joined_days=30, seeded_days=20)

        self.assertEqual(prune_visitors(now), 1)
        self.assertFalse(CustomUser.objects.filter(email=OTHER).exists())
        for model in (Subject, StudySchedule, LearningBlock, SubjectChat, DiaryWeek, Habit, Goal, AIUsageEvent):
            self.assertFalse(model.objects.filter(user_email=OTHER).exists(), model.__name__)
        self.assertTrue(Subject.objects.filter(user_email=VISITOR).exists())
        self.assertTrue(CustomUser.objects.filter(email=TEACHER_EMAIL).exists())
        self.assertTrue(CustomUser.objects.filter(email=classmate_email(1)).exists())

    def test_a_returning_visitor_is_kept(self):
        # Пришёл впервые 20 дней назад, но вчера вернулся: его нельзя удалить посреди сессии.
        user = visitor_row(VISITOR)
        self.age(user, joined_days=20, seeded_days=1)
        self.assertEqual(prune_visitors(timezone.now()), 0)
        self.assertTrue(CustomUser.objects.filter(pk=user.pk).exists())

    def test_never_seeded_rows_age_by_their_first_visit(self):
        stale, recent = visitor_row(OTHER), visitor_row(VISITOR)
        self.age(stale, joined_days=20, seeded_days=None)
        self.age(recent, joined_days=2, seeded_days=None)
        self.assertEqual(prune_visitors(timezone.now()), 1)
        self.assertFalse(CustomUser.objects.filter(pk=stale.pk).exists())
        self.assertTrue(CustomUser.objects.filter(pk=recent.pk).exists())

    def test_the_current_visitor_is_kept(self):
        user = visitor_row(VISITOR)
        self.age(user, joined_days=20, seeded_days=None)
        self.assertEqual(prune_visitors(timezone.now(), keep=VISITOR), 0)
        self.assertTrue(CustomUser.objects.filter(pk=user.pk).exists())

    def test_errors_are_logged_not_raised(self):
        first, second = visitor_row(OTHER), visitor_row(VISITOR)
        self.age(first, joined_days=20, seeded_days=20)
        self.age(second, joined_days=20, seeded_days=20)
        with mock.patch("demo.prune.wipe_user_rows", side_effect=RuntimeError("boom")):
            with self.assertLogs("demo.prune", "ERROR") as logs:
                self.assertEqual(prune_visitors(timezone.now()), 0)
        self.assertEqual(len(logs.records), 2)
        self.assertEqual(CustomUser.objects.filter(pk__in=[first.pk, second.pk]).count(), 2)


class BudgetMiddlewareTests(TestCase):
    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()
        self.middleware = DemoDailyBudgetMiddleware(lambda request: HttpResponse("passed"))
        self.visitor = visitor_row(VISITOR)
        CustomUser.objects.filter(pk=self.visitor.pk).update(last_login=timezone.now())

    def call(self, path, *, method="post", email=VISITOR, ip="203.0.113.7"):
        request = getattr(self.factory, method)(path, REMOTE_ADDR=ip)
        request.user_email = email
        return self.middleware(request)

    def spend(self, tokens, hours_ago=1):
        row = AIUsageEvent.objects.create(user_email=VISITOR, model_name="m", total_tokens=tokens, billable_tokens=tokens)
        AIUsageEvent.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(hours=hours_ago))

    @override_settings(DEMO_MODE=True)
    def test_refuses_identities_that_never_opened_the_demo(self):
        # Личность из провайдера демо, которая ни разу не звала /start: строки нет вовсе.
        response = self.call("/api/curriculum/ask/stream/", email=OTHER)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "demo_not_started")
        # Строка есть, но аккаунт не собран.
        visitor_row(OTHER)
        self.assertEqual(self.call("/api/curriculum/ask/stream/", email=OTHER).status_code, 403)
        self.assertEqual(self.call("/api/curriculum/ask/stream/", email=None).status_code, 403)
        # Чтение и всё, что не зовёт модель, работает.
        self.assertEqual(self.call("/api/curriculum/chats/", method="get", email=OTHER).status_code, 200)
        self.assertEqual(self.call("/api/goals/", email=OTHER).status_code, 200)
        self.assertEqual(self.call("/api/curriculum/ask/stream/").status_code, 200)

    @override_settings(DEMO_MODE=True, DEMO_AI_REQUESTS_PER_IP_PER_DAY=2)
    def test_caps_model_calls_per_address_a_day(self):
        self.assertEqual(self.call("/api/curriculum/ask/stream/").status_code, 200)
        self.assertEqual(self.call("/api/study-schedules/generate/").status_code, 200)
        response = self.call("/api/curriculum/ask/stream/")
        self.assertEqual(response.status_code, 429)
        payload = json.loads(response.content)
        self.assertEqual(payload["code"], "ai_usage_limit_exceeded")
        self.assertEqual(payload["window"], "demo_ip_day")
        self.assertGreater(datetime.fromisoformat(payload["reset_at"]), timezone.now())
        # Другой адрес считается отдельно, и всё, что не зовёт модель, проходит.
        self.assertEqual(self.call("/api/curriculum/ask/stream/", ip="198.51.100.4").status_code, 200)
        self.assertEqual(self.call("/api/goals/").status_code, 200)

    @override_settings(DEMO_MODE=True, DEMO_DAILY_TOKEN_BUDGET=1000)
    def test_blocks_model_calls_over_the_daily_budget(self):
        self.spend(1200)
        response = self.call("/api/curriculum/ask/stream/")
        self.assertEqual(response.status_code, 429)
        payload = json.loads(response.content)
        self.assertEqual(payload["code"], "ai_usage_limit_exceeded")
        self.assertEqual(payload["window"], "demo_day")
        self.assertIn("reset_at", payload)
        chat = "/api/curriculum/chats/0f8e7a2c-1111-4c3d-9e2f-0a1b2c3d4e5f/title/"
        for path in ("/api/studyplan/chat/stream/", chat, "/api/study-schedules/generate/"):
            self.assertEqual(self.call(path).status_code, 429, path)

    @override_settings(DEMO_MODE=True, DEMO_DAILY_TOKEN_BUDGET=1000)
    def test_everything_else_passes(self):
        self.spend(1200)
        self.assertEqual(self.call("/api/curriculum/chats/", method="get").status_code, 200)
        self.assertEqual(self.call("/api/goals/").status_code, 200)

    @override_settings(DEMO_MODE=True, DEMO_DAILY_TOKEN_BUDGET=1000)
    def test_old_spending_leaves_the_window(self):
        self.spend(1200, hours_ago=25)
        self.spend(100)
        self.assertEqual(self.call("/api/curriculum/ask/stream/").status_code, 200)

    @override_settings(DEMO_MODE=False, DEMO_DAILY_TOKEN_BUDGET=1000, DEMO_AI_REQUESTS_PER_IP_PER_DAY=1)
    def test_off_outside_the_demo(self):
        self.spend(5000)
        for email in (VISITOR, OTHER, None):
            self.assertEqual(self.call("/api/curriculum/ask/stream/", email=email).status_code, 200)


class CommandTests(TestCase):
    @override_settings(DEMO_MODE=False)
    def test_commands_refuse_a_real_database(self):
        with self.assertRaises(CommandError):
            call_command("demo_seed_world")
        with self.assertRaises(CommandError):
            call_command("demo_prune")
        self.assertFalse(CustomUser.objects.filter(email=TEACHER_EMAIL).exists())

    @override_settings(DEMO_MODE=True)
    def test_seed_world_builds_the_class(self):
        call_command("demo_seed_world", stdout=__import__("io").StringIO())
        self.assertTrue(CustomUser.objects.filter(email=TEACHER_EMAIL).exists())
        self.assertEqual(Contest.objects.count(), 2)
