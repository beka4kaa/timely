"""Контесты с тирами, черновиками, PDF и автопроверкой.

Старые контесты получают тир 5 и рисунок «кольца». Закончившиеся остаются
опубликованными. Остальные становятся черновиками: у их задач нет ни PDF, ни
ответов, проверять нечем, и владелец допишет их в новом редакторе.

Старые ответы привязываются к контесту, если задача входит ровно в один контест
и ответ отправлен в его окно. Из нескольких одобренных ответов ученика по одной
задаче привязывается самый ранний, иначе уникальный индекс не создастся.

Обратного шага у данных нет: при откате поля исчезают вместе со значениями.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


def publish_ended_contests(apps, schema_editor):
    Contest = apps.get_model("accounts", "Contest")
    Contest.objects.filter(end_time__lte=timezone.now()).update(is_published=True)


def link_answers_to_contests(apps, schema_editor):
    Contest = apps.get_model("accounts", "Contest")
    TaskSubmission = apps.get_model("accounts", "TaskSubmission")

    contests_of: dict[int, list[int]] = {}
    for task_id, contest_id in Contest.tasks.through.objects.values_list("task_id", "contest_id"):
        contests_of.setdefault(task_id, []).append(contest_id)
    only = {task_id: ids[0] for task_id, ids in contests_of.items() if len(ids) == 1}
    if not only:
        return

    windows = {
        contest.pk: (contest.start_time, contest.end_time)
        for contest in Contest.objects.filter(pk__in=set(only.values()))
    }
    accepted: set[tuple[int, int, int]] = set()
    rows = (
        TaskSubmission.objects.filter(contest__isnull=True, task_id__in=list(only))
        .order_by("created_at", "pk")
        .only("pk", "task_id", "student_id", "status", "created_at")
    )
    for row in rows.iterator():
        contest_id = only[row.task_id]
        start, end = windows[contest_id]
        if row.created_at is None or not (start <= row.created_at <= end):
            continue
        if row.status == "approved":
            key = (row.student_id, row.task_id, contest_id)
            if key in accepted:
                continue
            accepted.add(key)
        TaskSubmission.objects.filter(pk=row.pk).update(contest_id=contest_id)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0011_privateleaderboard_invite_code_unique"),
    ]

    operations = [
        migrations.CreateModel(
            name="ContestFile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("data", models.BinaryField()),
                ("name", models.CharField(max_length=180)),
                ("size", models.PositiveIntegerField()),
                ("pages", models.PositiveSmallIntegerField(default=0)),
                ("sha256", models.CharField(max_length=64)),
                ("text", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="contest_files",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="contest",
            name="tier",
            field=models.PositiveSmallIntegerField(
                choices=[(1, "Аметист"), (2, "Алмаз"), (3, "Золото"), (4, "Серебро"), (5, "Бронза")], default=5
            ),
        ),
        migrations.AddField(
            model_name="contest",
            name="art",
            field=models.CharField(default="rings", max_length=20),
        ),
        migrations.AddField(
            model_name="contest",
            name="is_published",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="task",
            name="position",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="task",
            name="answer",
            field=models.CharField(blank=True, default="", max_length=300),
        ),
        migrations.AddField(
            model_name="task",
            name="statement_file",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="accounts.contestfile",
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="solution_file",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="accounts.contestfile",
            ),
        ),
        migrations.AddField(
            model_name="tasksubmission",
            name="contest",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="submissions",
                to="accounts.contest",
            ),
        ),
        migrations.RunPython(publish_ended_contests, migrations.RunPython.noop),
        migrations.RunPython(link_answers_to_contests, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="tasksubmission",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "approved"), ("contest__isnull", False)),
                fields=("student", "task", "contest"),
                name="one_accepted_answer_per_contest_task",
            ),
        ),
        migrations.AddIndex(
            model_name="tasksubmission",
            index=models.Index(fields=["contest", "created_at"], name="submission_contest_time"),
        ),
    ]
