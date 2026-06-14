from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from rest_framework.routers import DefaultRouter
from planner.views import DayPlanViewSet, BlockViewSet, SegmentViewSet, SubtaskViewSet, ScheduleSlotViewSet
from planner.goal_views import GoalViewSet, GoalLinkViewSet
from mind.views import SubjectViewSet, TopicViewSet, SubtopicViewSet, MindSessionViewSet
from ai_engine.views import (
    GenerateProgramView, LearningProgramViewSet, TopicPlanViewSet,
    AnalyzeView, FastTopicsView, ModifyProgramView, GenerateSubtopicsView,
    DailyTasksView, ScheduleView
)
from accounts.views import RegisterView, LoginView, LeaderboardViewSet
from diary.views import WeeklyTemplateViewSet, DiaryWeekViewSet
from ai_engine.ocr_views import OCRView
from ai_engine.canvas_analyzer_views import CanvasAnalyzerView
from ai_engine.solve_views import SolveTaskView
from ai_engine.draw_views import WhiteboardDrawView
from habits.views import HabitViewSet
from nutrition.views import (
    FoodSearchView,
    BarcodeLookupView,
    OffSearchView,
    NutritionEntryViewSet,
    NutritionProfileView,
)
from nutrition.photo_views import AnalyzePhotoView



def health_check(request):
    return JsonResponse({'status': 'healthy', 'service': 'timely-backend'})


router = DefaultRouter()
router.register(r'planner/dayplans', DayPlanViewSet)
router.register(r'planner/blocks', BlockViewSet)
router.register(r'planner/segments', SegmentViewSet)
router.register(r'planner/subtasks', SubtaskViewSet)
router.register(r'schedule', ScheduleSlotViewSet)
router.register(r'goals/links', GoalLinkViewSet, basename='goal-links')
router.register(r'goals', GoalViewSet, basename='goals')
router.register(r'mind/subjects', SubjectViewSet)
router.register(r'mind/topics', TopicViewSet)
router.register(r'mind/subtopics', SubtopicViewSet)
router.register(r'mind/sessions', MindSessionViewSet)
router.register(r'ai_engine/learning-program', LearningProgramViewSet)
router.register(r'ai_engine/topic-plans', TopicPlanViewSet)
router.register(r'diary/templates', WeeklyTemplateViewSet, basename='diary-template')
router.register(r'diary/weeks', DiaryWeekViewSet, basename='diary-week')
router.register(r'leaderboard', LeaderboardViewSet, basename='leaderboard')
router.register(r'habits', HabitViewSet, basename='habits')
router.register(r'nutrition/entries', NutritionEntryViewSet, basename='nutrition-entries')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', health_check, name='health-check'),
    path('api/', include(router.urls)),
    
    # Authentication endpoints (support both with and without trailing slash)
    path('api/auth/register/', RegisterView.as_view(), name='register'),
    path('api/auth/register', RegisterView.as_view(), name='register-no-slash'),
    path('api/auth/login/', LoginView.as_view(), name='login'),
    path('api/auth/login', LoginView.as_view(), name='login-no-slash'),
    
    # AI Actions with trailing slashes (Django standard)
    path('api/ai/generate-program/', GenerateProgramView.as_view(), name='generate-program'),
    path('api/ai/analyze/', AnalyzeView.as_view(), name='analyze-progress'),
    path('api/ai/fast-topics/', FastTopicsView.as_view(), name='fast-topics'),
    path('api/ai/modify-program/', ModifyProgramView.as_view(), name='modify-program'),
    path('api/ai/generate-subtopics/', GenerateSubtopicsView.as_view(), name='generate-subtopics'),
    path('api/ai/daily-tasks/', DailyTasksView.as_view(), name='daily-tasks'),
    path('api/ai/schedule/', ScheduleView.as_view(), name='ai-schedule'),
    path('api/ai/ocr/', OCRView.as_view(), name='ai-ocr'),
    path('api/ai/ocr', OCRView.as_view(), name='ai-ocr-no-slash'),
    path('api/ai/analyze-canvas/', CanvasAnalyzerView.as_view(), name='ai-analyze-canvas'),
    path('api/ai/analyze-canvas', CanvasAnalyzerView.as_view(), name='ai-analyze-canvas-no-slash'),
    path('api/ai/solve/', SolveTaskView.as_view(), name='ai-solve'),
    path('api/ai/solve', SolveTaskView.as_view(), name='ai-solve-no-slash'),
    path('api/ai/draw/', WhiteboardDrawView.as_view(), name='ai-draw'),
    path('api/ai/draw', WhiteboardDrawView.as_view(), name='ai-draw-no-slash'),

    # Nutrition: food library search + barcode lookup (Open Food Facts proxy)
    path('api/nutrition/foods/', FoodSearchView.as_view(), name='nutrition-foods'),
    path('api/nutrition/foods', FoodSearchView.as_view(), name='nutrition-foods-no-slash'),
    path('api/nutrition/search-off/', OffSearchView.as_view(), name='nutrition-search-off'),
    path('api/nutrition/search-off', OffSearchView.as_view(), name='nutrition-search-off-no-slash'),
    path('api/nutrition/profile/', NutritionProfileView.as_view(), name='nutrition-profile'),
    path('api/nutrition/profile', NutritionProfileView.as_view(), name='nutrition-profile-no-slash'),
    path('api/nutrition/barcode/<str:code>/', BarcodeLookupView.as_view(), name='nutrition-barcode'),
    path('api/nutrition/barcode/<str:code>', BarcodeLookupView.as_view(), name='nutrition-barcode-no-slash'),
    path('api/nutrition/analyze-photo/', AnalyzePhotoView.as_view(), name='nutrition-analyze-photo'),
    path('api/nutrition/analyze-photo', AnalyzePhotoView.as_view(), name='nutrition-analyze-photo-no-slash'),
]
