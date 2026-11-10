from django.urls import path

from .views import DemoStartView

# Оба варианта пути: фронтенд ходит в backend напрямую, а APPEND_SLASH выключен.
urlpatterns = [
    path("start/", DemoStartView.as_view(), name="demo-start"),
    path("start", DemoStartView.as_view(), name="demo-start-no-slash"),
]
