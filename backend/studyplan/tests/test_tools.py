"""Инструменты AI: читают календарь, предлагают изменения, но не правят его."""

from __future__ import annotations

from datetime import timedelta

from studyplan.availability import free_windows
from studyplan.models import (
    FixedCommitment,
    LearningBlock,
    ScheduleRevision,
    StudySchedule,
)
from studyplan.services import generate_schedule
from studyplan.tools import (
    ALL_TOOL_NAMES,
    SCHEDULE_TOOLS,
    ScheduleToolContext,
    run_schedule_tool,
    tool_schemas,
)

from .test_materialize import MONDAY, OWNER, SchedulePlanFixture


class ToolFixture(SchedulePlanFixture):
    def setUp(self):
        super().setUp()
        self.outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=41),
            template=self.make_template(),
        )
        self.schedule = self.outcome.schedule
        self.blocks = list(self.schedule.blocks.order_by("start_at"))
        self.context = ScheduleToolContext(
            user_email=OWNER, schedule=self.schedule, today=MONDAY
        )

    def call(self, name, **args):
        return run_schedule_tool(name, args, self.context)


class ContractTests(ToolFixture):
    def test_every_tool_exposes_a_schema(self):
        schemas = tool_schemas()
        self.assertEqual(len(schemas), len(ALL_TOOL_NAMES))
        for schema in schemas:
            self.assertEqual(schema["type"], "function")
            self.assertIn("description", schema["function"])
            self.assertEqual(schema["function"]["parameters"]["type"], "object")

    def test_no_tool_lets_the_model_choose_a_user_or_a_schedule(self):
        # Пользователь и расписание приходят из запроса. Появись они в схеме —
        # подсказка в промпте стала бы способом читать чужой календарь.
        forbidden = {"user_email", "schedule_id", "user", "schedule"}
        for tool in SCHEDULE_TOOLS.values():
            properties = set(tool.parameters.get("properties", {}))
            self.assertEqual(properties & forbidden, set(), tool.name)

    def test_unknown_tool_is_reported_not_raised(self):
        result = run_schedule_tool("телепатия", {}, self.context)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "unknown_tool")

    def test_broken_arguments_do_not_raise(self):
        result = self.call("explain_schedule", date="позавчера")
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "invalid_arguments")

    def test_failing_handler_is_wrapped(self):
        broken = SCHEDULE_TOOLS["get_schedule"]
        original = broken.handler
        try:
            object.__setattr__(
                broken,
                "handler",
                lambda args, ctx: (_ for _ in ()).throw(RuntimeError("бум")),
            )
            result = self.call("get_schedule")
        finally:
            object.__setattr__(broken, "handler", original)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "tool_failed")

    def test_without_a_schedule_tools_answer_honestly(self):
        empty = ScheduleToolContext(user_email=OWNER, schedule=None, today=MONDAY)
        result = run_schedule_tool("get_schedule", {}, empty)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "no_schedule")


class ReadToolTests(ToolFixture):
    def test_get_schedule_returns_blocks_and_daily_load(self):
        result = self.call("get_schedule")
        self.assertTrue(result["ok"])
        self.assertTrue(result["blocks"])
        self.assertIn("block_id", result["blocks"][0])
        self.assertIn("start_time", result["blocks"][0])
        self.assertTrue(result["daily_minutes"])
        self.assertEqual(result["version"], self.schedule.version)

    def test_get_schedule_window_is_capped(self):
        result = self.call("get_schedule", from_date="2026-08-17", to_date="2027-08-17")
        span = (
            __import__("datetime").date.fromisoformat(result["period"]["to"])
            - __import__("datetime").date.fromisoformat(result["period"]["from"])
        ).days
        self.assertLessEqual(span, 60)

    def test_find_free_slots_skips_busy_time(self):
        FixedCommitment.objects.create(
            user_email=OWNER,
            kind=FixedCommitment.Kind.SCHOOL,
            title="Школа",
            weekday=2,
            start_time="16:00",
            duration_minutes=180,
        )
        result = self.call("find_free_slots", minutes=30)
        self.assertTrue(result["ok"])
        wednesdays = [item for item in result["slots"] if item["weekday"] == "среда"]
        self.assertEqual(wednesdays, [])

    def test_explain_schedule_describes_a_day(self):
        result = self.call("explain_schedule", date=MONDAY.isoformat())
        self.assertTrue(result["ok"])
        self.assertEqual(result["weekday"], "понедельник")
        self.assertGreater(result["total_minutes"], 0)
        self.assertTrue(result["weekly_pattern"])


class ProposalTests(ToolFixture):
    def _free_start(self):
        last = max(block.end_at for block in self.blocks)
        candidate = last + timedelta(days=1)
        while candidate.weekday() != 6:
            candidate += timedelta(days=1)
        return candidate.replace(hour=12, minute=0, second=0, microsecond=0)

    def test_move_creates_a_proposal_and_leaves_the_calendar_alone(self):
        block = self.blocks[0]
        before = block.start_at
        result = self.call(
            "propose_move_blocks",
            moves=[
                {"block_id": str(block.id), "start_at": self._free_start().isoformat()}
            ],
            reason="Просьба ученика",
        )

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["moved_count"], 1)
        self.assertIn("не применено", result["note"])

        block.refresh_from_db()
        self.schedule.refresh_from_db()
        self.assertEqual(block.start_at, before)
        self.assertEqual(self.schedule.version, 1)

        revision = ScheduleRevision.objects.get(pk=result["revision_id"])
        self.assertEqual(revision.status, ScheduleRevision.Status.PROPOSED)
        self.assertEqual(revision.requested_by, ScheduleRevision.RequestedBy.AI)

    def test_move_of_a_fixed_block_is_refused(self):
        block = self.blocks[0]
        block.fixed = True
        block.save(update_fields=["fixed"])
        result = self.call(
            "propose_move_blocks",
            moves=[
                {"block_id": str(block.id), "start_at": self._free_start().isoformat()}
            ],
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "rejected")

    def test_move_with_invented_block_is_refused(self):
        result = self.call(
            "propose_move_blocks",
            moves=[
                {
                    "block_id": "00000000-0000-0000-0000-000000000000",
                    "start_at": self._free_start().isoformat(),
                }
            ],
        )
        self.assertFalse(result["ok"])

    def test_move_without_moves_is_refused(self):
        result = self.call("propose_move_blocks", moves=[])
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "invalid_arguments")

    def test_load_reduction_empties_the_day(self):
        target = self.blocks[0].start_at.date()
        result = self.call("propose_load_reduction", date=target.isoformat())
        self.assertTrue(result["ok"], result)
        self.assertGreater(result["moved_count"], 0)

        # Пока не подтверждено — день на месте.
        same_day = self.schedule.blocks.filter(start_at__date=target).count()
        self.assertGreater(same_day, 0)

    def test_load_reduction_keeps_the_requested_head_of_the_day(self):
        target = self.blocks[0].start_at.date()
        result = self.call(
            "propose_load_reduction", date=target.isoformat(), keep_minutes=25
        )
        self.assertTrue(result["ok"], result)
        # Первое занятие (25 минут) остаётся, остальные предлагаются к переносу.
        day_blocks = self.schedule.blocks.filter(
            start_at__date=target, fixed=False
        ).count()
        self.assertLess(result["moved_count"], day_blocks)

    def test_load_reduction_of_an_empty_day_says_so(self):
        empty = (MONDAY + timedelta(days=6)).isoformat()  # воскресенье
        result = self.call("propose_load_reduction", date=empty)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "nothing_to_move")

    def test_recovery_moves_missed_blocks_forward(self):
        # Смотрим из будущего: первая неделя оказалась в прошлом.
        later = ScheduleToolContext(
            user_email=OWNER,
            schedule=self.schedule,
            today=MONDAY + timedelta(days=14),
        )
        result = run_schedule_tool("propose_recovery_plan", {}, later)
        self.assertTrue(result["ok"], result)
        self.assertGreater(result["missed_total"], 0)
        self.assertGreater(result["moved_count"], 0)

    def test_recovery_without_misses_is_not_an_error(self):
        result = self.call("propose_recovery_plan")
        self.assertTrue(result["ok"])
        self.assertTrue(result["nothing_missed"])


class CommitmentParsingTests(ToolFixture):
    def test_recurring_commitment_is_parsed_but_not_saved(self):
        before = FixedCommitment.objects.count()
        result = self.call(
            "propose_fixed_commitments",
            items=[
                {
                    "title": "Школа",
                    "kind": "school",
                    "weekday": 0,
                    "start_time": "08:00",
                    "duration_minutes": 300,
                }
            ],
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["items"][0]["weekday_name"], "понедельник")
        self.assertIn("не сохранена", result["note"])
        self.assertEqual(FixedCommitment.objects.count(), before)

    def test_one_off_commitment_is_parsed(self):
        result = self.call(
            "propose_fixed_commitments",
            items=[
                {
                    "title": "Экзамен",
                    "kind": "exam",
                    "start_at": "2026-09-01T09:00:00+00:00",
                    "end_at": "2026-09-01T12:00:00+00:00",
                }
            ],
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["items"][0]["kind"], "exam")

    def test_unknown_kind_falls_back_instead_of_failing(self):
        result = self.call(
            "propose_fixed_commitments",
            items=[
                {
                    "title": "Что-то",
                    "kind": "телепортация",
                    "weekday": 1,
                    "start_time": "10:00",
                    "duration_minutes": 60,
                }
            ],
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["items"][0]["kind"], "other")

    def test_incomplete_commitment_is_refused(self):
        result = self.call(
            "propose_fixed_commitments", items=[{"title": "Непонятно", "kind": "other"}]
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "invalid_arguments")

    def test_commitment_without_title_is_refused(self):
        result = self.call("propose_fixed_commitments", items=[{"kind": "school"}])
        self.assertFalse(result["ok"])


class AvailabilityTests(ToolFixture):
    def test_free_windows_exclude_occupied_time(self):
        windows = free_windows(
            self.schedule,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=6),
        )
        # Сравниваем по дате, а не по моменту: `date` в фильтре
        # `DateTimeField` Django приводит к наивному времени и предупреждает.
        occupied = [
            (block.start_at, block.end_at)
            for block in self.schedule.blocks.filter(
                start_at__date__lt=MONDAY + timedelta(days=7)
            )
        ]
        for window in windows:
            for start, end in occupied:
                self.assertFalse(
                    window.start < end and start < window.end,
                    "свободное окно пересеклось с занятием",
                )

    def test_excluded_block_frees_its_own_place(self):
        block = self.blocks[0]
        without = free_windows(
            self.schedule,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=1),
            exclude_block_ids=(str(block.id),),
        )
        with_block = free_windows(
            self.schedule,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=1),
        )
        released = sum(item.duration_minutes for item in without) - sum(
            item.duration_minutes for item in with_block
        )
        self.assertEqual(released, block.duration_minutes)

    def test_cancelled_block_does_not_hold_its_slot(self):
        block = self.blocks[0]
        before = sum(
            item.duration_minutes
            for item in free_windows(
                self.schedule, start_date=MONDAY, end_date=MONDAY
            )
        )
        block.status = LearningBlock.Status.CANCELLED
        block.save(update_fields=["status"])
        after = sum(
            item.duration_minutes
            for item in free_windows(
                self.schedule, start_date=MONDAY, end_date=MONDAY
            )
        )
        self.assertEqual(after - before, block.duration_minutes)
