from django.contrib import admin
from django.utils.html import format_html
from .models import CustomUser, Discipline, UserRating, Task, TaskSubmission, ReviewVote
from .services import calculate_match_result

@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('id', 'author', 'discipline', 'base_elo', 'status')
    list_filter = ('status', 'discipline')
    actions = ['approve_tasks', 'reject_tasks']

    @admin.action(description="Одобрить задачи (перевод в 'active')")
    def approve_tasks(self, request, queryset):
        queryset.update(status='active')

    @admin.action(description="Отклонить задачи (перевод в 'rejected')")
    def reject_tasks(self, request, queryset):
        queryset.update(status='rejected')

@admin.register(TaskSubmission)
class TaskSubmissionAdmin(admin.ModelAdmin):
    list_display = ('id', 'student', 'task', 'status', 'created_at')
    list_filter = ('status',)
    readonly_fields = ('student_solution_image_html',)
    actions = ['force_recalculate_elo']

    def student_solution_image_html(self, obj):
        if obj.student_solution_image:
            src = obj.student_solution_image
            if not src.startswith('data:image'):
                src = f'data:image/png;base64,{src}'
            return format_html('<img src="{}" style="max-width: 500px; max-height: 500px; border: 1px solid #ccc;" />', src)
        return "No image"
    student_solution_image_html.short_description = "Student Solution Image"

    @admin.action(description="Принудительный пересчет ELO (игнорируя Peer Review)")
    def force_recalculate_elo(self, request, queryset):
        for submission in queryset:
            if submission.status in ['correct', 'incorrect']:
                task = submission.task
                student = submission.student
                discipline = task.discipline
                is_correct = (submission.status == 'correct')
                
                user_rating, _ = UserRating.objects.get_or_create(
                    user=student,
                    discipline=discipline,
                    defaults={'elo_score': 1200, 'tier_level': 'LT5'}
                )
                
                match_res = calculate_match_result(
                    player_elo=user_rating.elo_score,
                    task_elo=task.base_elo,
                    is_correct=is_correct
                )
                
                user_rating.elo_score = match_res['new_elo']
                user_rating.tier_level = match_res['new_tier']
                user_rating.save(update_fields=['elo_score', 'tier_level'])

@admin.register(ReviewVote)
class ReviewVoteAdmin(admin.ModelAdmin):
    list_display = ('id', 'submission', 'reviewer', 'vote', 'created_at')
    list_filter = ('vote',)

from django.contrib.auth.admin import UserAdmin

# Опционально зарегистрируем остальные модели (если еще не были)
@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = ('username', 'email', 'overall_elo', 'contribution_points', 'is_staff')
    fieldsets = UserAdmin.fieldsets + (
        ('Platform Stats', {'fields': ('overall_elo', 'contribution_points', 'country_code', 'city')}),
    )

@admin.register(Discipline)
class DisciplineAdmin(admin.ModelAdmin):
    list_display = ('name', 'parent')

@admin.register(UserRating)
class UserRatingAdmin(admin.ModelAdmin):
    list_display = ('user', 'discipline', 'elo_score', 'tier_level')
