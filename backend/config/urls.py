from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from rest_framework.routers import DefaultRouter
from planner.views import DayPlanViewSet, BlockViewSet, SegmentViewSet, SubtaskViewSet, ScheduleSlotViewSet
from mind.views import SubjectViewSet, TopicViewSet, SubtopicViewSet, MindSessionViewSet
from ai_engine.views import (
    GenerateProgramView, LearningProgramViewSet, TopicPlanViewSet,
    AnalyzeView, FastTopicsView, ModifyProgramView, GenerateSubtopicsView,
    DailyTasksView, ScheduleView
)


def health_check(request):
    return JsonResponse({'status': 'healthy', 'service': 'timely-backend'})


router = DefaultRouter(trailing_slash=False)
router.register(r'planner/dayplans', DayPlanViewSet)
router.register(r'planner/blocks', BlockViewSet)
router.register(r'planner/segments', SegmentViewSet)
router.register(r'planner/subtasks', SubtaskViewSet)
router.register(r'schedule', ScheduleSlotViewSet)  # Direct /api/schedule/ route
router.register(r'mind/subjects', SubjectViewSet)
router.register(r'mind/topics', TopicViewSet)
router.register(r'mind/subtopics', SubtopicViewSet)
router.register(r'mind/sessions', MindSessionViewSet)
router.register(r'ai_engine/learning-program', LearningProgramViewSet)
router.register(r'ai_engine/topic-plans', TopicPlanViewSet)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', health_check, name='health-check'),
    path('api/', include(router.urls)),
    
    # AI Actions (no trailing slashes to match frontend)
    path('api/ai/generate-program', GenerateProgramView.as_view(), name='generate-program'),
    path('api/ai/analyze', AnalyzeView.as_view(), name='analyze-progress'),
    path('api/ai/fast-topics', FastTopicsView.as_view(), name='fast-topics'),
    path('api/ai/modify-program', ModifyProgramView.as_view(), name='modify-program'),
    path('api/ai/generate-subtopics', GenerateSubtopicsView.as_view(), name='generate-subtopics'),
    path('api/ai/daily-tasks', DailyTasksView.as_view(), name='daily-tasks'),
    path('api/ai/schedule', ScheduleView.as_view(), name='ai-schedule'),
]
