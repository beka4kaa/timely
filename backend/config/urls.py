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
    DailyTasksView, ScheduleView, ChatSessionViewSet
)
from accounts.views import (
    RegisterView, LoginView, LeaderboardViewSet, MeView, UserSearchView,
    TaskViewSet, TaskSubmissionViewSet, ContestViewSet, PrivateLeaderboardViewSet,
    AdminUserViewSet,
)
from diary.views import WeeklyTemplateViewSet, DiaryWeekViewSet
from ai_engine.ocr_views import OCRView
from ai_engine.canvas_analyzer_views import CanvasAnalyzerView
from ai_engine.solve_views import SolveTaskView
from ai_engine.draw_views import WhiteboardDrawView
from ai_engine.chat_views import BoardChatStreamView, BoardChatView
from ai_engine.illustration_views import IllustrationView, ImageModelsView
from ai_engine.usage_views import AIUsageSummaryView
from habits.views import HabitViewSet
from pomodoro.views import FocusSessionViewSet
from nutrition.views import (
    FoodSearchView,
    BarcodeLookupView,
    OffSearchView,
    NutritionEntryViewSet,
    NutritionProfileView,
)
from nutrition.photo_views import AnalyzePhotoView
from studyplan.chat_views import ScheduleChatStreamView
from studyplan.views import (
    FixedCommitmentViewSet,
    LearningBlockViewSet,
    ScheduleRevisionViewSet,
    ScheduleSetupView,
    StudyScheduleViewSet,
    WeeklyScheduleTemplateViewSet,
)
from curriculum.ask_views import SubjectAskStreamView
from curriculum.views import (
    SubjectChatViewSet,
    CourseEnrollmentViewSet,
    CoursePlanViewSet,
    DocumentViewSet,
    KnowledgeSearchView,
    LearningGoalViewSet,
)



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
router.register(r'ai_engine/chat-sessions', ChatSessionViewSet, basename='chat-session')
router.register(r'diary/templates', WeeklyTemplateViewSet, basename='diary-template')
router.register(r'diary/weeks', DiaryWeekViewSet, basename='diary-week')
router.register(r'leaderboard', LeaderboardViewSet, basename='leaderboard')
router.register(r'tasks', TaskViewSet, basename='tasks')
router.register(r'submissions', TaskSubmissionViewSet, basename='submissions')
router.register(r'contests', ContestViewSet, basename='contests')
router.register(r'private-leaderboards', PrivateLeaderboardViewSet, basename='private-leaderboards')
router.register(r'admin/users', AdminUserViewSet, basename='admin-users')
router.register(r'habits', HabitViewSet, basename='habits')
router.register(r'nutrition/entries', NutritionEntryViewSet, basename='nutrition-entries')
router.register(r'pomodoro/sessions', FocusSessionViewSet, basename='pomodoro-sessions')
# Curriculum: цель ученика → загруженный PDF → программа курса.
router.register(r'curriculum/goals', LearningGoalViewSet, basename='curriculum-goals')
router.register(r'curriculum/documents', DocumentViewSet, basename='curriculum-documents')
router.register(r'curriculum/plans', CoursePlanViewSet, basename='curriculum-plans')
router.register(r'curriculum/chats', SubjectChatViewSet, basename='curriculum-chats')
router.register(
    r'curriculum/enrollments', CourseEnrollmentViewSet, basename='curriculum-enrollments'
)
# Расписание самостоятельного обучения: ритм → календарь → изменения.
router.register(r'study-templates', WeeklyScheduleTemplateViewSet, basename='study-templates')
router.register(r'study-commitments', FixedCommitmentViewSet, basename='study-commitments')
router.register(r'study-schedules', StudyScheduleViewSet, basename='study-schedules')
router.register(r'learning-blocks', LearningBlockViewSet, basename='learning-blocks')
router.register(
    r'schedule-revisions', ScheduleRevisionViewSet, basename='schedule-revisions'
)

urlpatterns = [
    path('admin/', admin.site.urls),
    # Поиск по книгам ученика. Не ViewSet: это одно действие, а не ресурс.
    path(
        'api/curriculum/search/',
        KnowledgeSearchView.as_view(),
        name='curriculum-search',
    ),
    # Вопрос по книгам предмета — потоком. Оба варианта пути, как у чата доски:
    # фронтенд ходит в backend напрямую, и лишний редирект на слеше оборвал бы
    # POST с телом.
    path(
        'api/curriculum/ask/stream/',
        SubjectAskStreamView.as_view(),
        name='curriculum-ask-stream',
    ),
    path(
        'api/curriculum/ask/stream',
        SubjectAskStreamView.as_view(),
        name='curriculum-ask-stream-no-slash',
    ),
    # Помощник по расписанию — потоком. Оба варианта пути, как у чата доски:
    # фронтенд ходит в backend напрямую, и редирект на слеше оборвал бы POST.
    path(
        'api/studyplan/chat/stream/',
        ScheduleChatStreamView.as_view(),
        name='studyplan-chat-stream',
    ),
    path(
        'api/studyplan/chat/stream',
        ScheduleChatStreamView.as_view(),
        name='studyplan-chat-stream-no-slash',
    ),
    path(
        'api/studyplan/setup/',
        ScheduleSetupView.as_view(),
        name='studyplan-setup',
    ),
    path(
        'api/studyplan/setup',
        ScheduleSetupView.as_view(),
        name='studyplan-setup-no-slash',
    ),
    path('health/', health_check, name='health-check'),
    path('api/', include(router.urls)),
    
    # Authentication endpoints (support both with and without trailing slash)
    path('api/auth/register/', RegisterView.as_view(), name='register'),
    path('api/auth/register', RegisterView.as_view(), name='register-no-slash'),
    path('api/auth/login/', LoginView.as_view(), name='login'),
    path('api/auth/login', LoginView.as_view(), name='login-no-slash'),
    path('api/me/', MeView.as_view(), name='me'),
    path('api/me', MeView.as_view(), name='me-no-slash'),
    path('api/users/search/', UserSearchView.as_view(), name='user-search'),
    path('api/users/search', UserSearchView.as_view(), name='user-search-no-slash'),
    
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
    # Роутер скиллов — основная точка входа чата на доске (см. ai_engine.skills).
    # Стриминг регистрируем ДО 'api/ai/chat/', иначе он бы не совпал первым.
    path('api/ai/chat/stream/', BoardChatStreamView.as_view(), name='ai-board-chat-stream'),
    path('api/ai/chat/stream', BoardChatStreamView.as_view(), name='ai-board-chat-stream-no-slash'),
    path('api/ai/chat/', BoardChatView.as_view(), name='ai-board-chat'),
    path('api/ai/chat', BoardChatView.as_view(), name='ai-board-chat-no-slash'),
    # Вторая фаза прогрессивной выдачи: одна иллюстрация за запрос.
    path('api/ai/illustration/', IllustrationView.as_view(), name='ai-illustration'),
    path('api/ai/illustration', IllustrationView.as_view(), name='ai-illustration-no-slash'),
    # Allowlist image-моделей для селектора на доске.
    path('api/ai/image-models/', ImageModelsView.as_view(), name='ai-image-models'),
    path('api/ai/image-models', ImageModelsView.as_view(), name='ai-image-models-no-slash'),
    path('api/ai/usage/', AIUsageSummaryView.as_view(), name='ai-usage-summary'),
    path('api/ai/usage', AIUsageSummaryView.as_view(), name='ai-usage-summary-no-slash'),

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
