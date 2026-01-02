from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from planner.views import DayPlanViewSet, BlockViewSet
from mind.views import SubjectViewSet, TopicViewSet
from ai_engine.views import GenerateProgramView

router = DefaultRouter()
router.register(r'planner/dayplans', DayPlanViewSet)
router.register(r'planner/blocks', BlockViewSet)
router.register(r'mind/subjects', SubjectViewSet)
router.register(r'mind/topics', TopicViewSet)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include(router.urls)),
    path('api/ai/generate-program/', GenerateProgramView.as_view(), name='generate-program'),
]
