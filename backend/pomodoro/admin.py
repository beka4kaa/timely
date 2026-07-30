from django.contrib import admin
from .models import FocusSession


@admin.register(FocusSession)
class FocusSessionAdmin(admin.ModelAdmin):
    list_display = ('user_email', 'kind', 'started_at', 'seconds')
    list_filter = ('kind',)
    search_fields = ('user_email',)
