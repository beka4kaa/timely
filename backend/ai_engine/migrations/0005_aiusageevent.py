import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ai_engine", "0004_subjectdeadline"),
    ]

    operations = [
        migrations.CreateModel(
            name="AIUsageEvent",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "user_email",
                    models.EmailField(
                        blank=True,
                        db_index=True,
                        default="",
                        max_length=254,
                    ),
                ),
                ("provider", models.CharField(default="unknown", max_length=48)),
                ("model_name", models.CharField(max_length=160)),
                ("feature", models.CharField(default="unknown", max_length=80)),
                ("request_id", models.CharField(blank=True, default="", max_length=160)),
                ("input_tokens", models.PositiveBigIntegerField(default=0)),
                ("cached_input_tokens", models.PositiveBigIntegerField(default=0)),
                ("output_tokens", models.PositiveBigIntegerField(default=0)),
                ("reasoning_tokens", models.PositiveBigIntegerField(default=0)),
                ("total_tokens", models.PositiveBigIntegerField(default=0)),
                ("image_count", models.PositiveIntegerField(default=0)),
                ("billable_tokens", models.PositiveBigIntegerField(default=0)),
                (
                    "cost_usd",
                    models.DecimalField(
                        blank=True,
                        decimal_places=8,
                        max_digits=14,
                        null=True,
                    ),
                ),
                ("is_estimated", models.BooleanField(default=False)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(
                        fields=["user_email", "created_at"],
                        name="ai_usage_user_created_idx",
                    ),
                    models.Index(
                        fields=["model_name", "created_at"],
                        name="ai_usage_model_created_idx",
                    ),
                    models.Index(
                        fields=["feature", "created_at"],
                        name="ai_usage_feat_created_idx",
                    ),
                ],
            },
        ),
    ]
