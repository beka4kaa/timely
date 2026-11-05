from django.db import migrations, models

MAIN_GOAL_TYPES = ('goal', 'global_goal', 'financial_goal')
FINISHED_GOAL_STATUSES = ('done', 'archived')
PRIORITY_RANK = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}


def choose_main_goals(apps, schema_editor):
    """У каждого ученика с целями одна становится главной: важнее, ближе по сроку, старше."""
    Goal = apps.get_model('planner', 'Goal')
    rows = (
        Goal.objects.filter(type__in=MAIN_GOAL_TYPES)
        .exclude(status__in=FINISHED_GOAL_STATUSES)
        .values('pk', 'user_email', 'priority', 'due_date', 'end_date', 'created_at')
    )

    def rank(row):
        deadline = row['due_date'] or row['end_date']
        return (
            PRIORITY_RANK.get(row['priority'], 2),
            deadline is None,
            deadline.toordinal() if deadline else 0,
            row['created_at'],
        )

    best = {}
    for row in rows:
        current = best.get(row['user_email'])
        if current is None or rank(row) < rank(current):
            best[row['user_email']] = row
    for row in best.values():
        Goal.objects.filter(pk=row['pk']).update(is_main=True)


class Migration(migrations.Migration):

    dependencies = [
        ('curriculum', '0016_studymaterial_courseplan_material_and_more'),
        ('planner', '0005_goal_order_and_choices'),
    ]

    operations = [
        migrations.AddField(
            model_name='goal',
            name='tone',
            field=models.CharField(
                blank=True,
                choices=[
                    ('indigo', 'Индиго'),
                    ('rose', 'Розовый'),
                    ('teal', 'Бирюзовый'),
                    ('blue', 'Синий'),
                    ('amber', 'Янтарный'),
                ],
                default='',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='goal',
            name='scope',
            field=models.CharField(
                blank=True,
                choices=[('study', 'Учёба'), ('general', 'Общая')],
                default='',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='goal',
            name='is_main',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='goal',
            name='lessons',
            field=models.ManyToManyField(
                blank=True,
                related_name='life_goals',
                to='curriculum.learninggoal',
            ),
        ),
        migrations.AddConstraint(
            model_name='goal',
            constraint=models.UniqueConstraint(
                condition=models.Q(is_main=True),
                fields=('user_email',),
                name='planner_goal_one_main_per_user',
            ),
        ),
        migrations.RunPython(choose_main_goals, migrations.RunPython.noop),
    ]
