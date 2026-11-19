from django.contrib import admin

from .models import AnswerFeedback


@admin.register(AnswerFeedback)
class AnswerFeedbackAdmin(admin.ModelAdmin):
    """Оценки ответов тьютора: что нравится и что нет, с вопросом и ответом."""

    list_display = ("updated_at", "rating", "mode", "model", "question_start")
    list_filter = ("rating", "mode", "model")
    search_fields = ("question", "answer")
    readonly_fields = ("user_email", "chat", "answer_at", "rating", "question", "answer", "model", "mode", "created_at", "updated_at")

    @admin.display(description="Вопрос")
    def question_start(self, row):
        return row.question[:80]
