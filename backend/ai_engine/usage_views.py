from rest_framework.response import Response
from rest_framework.views import APIView

from .usage import build_usage_summary


class AIUsageSummaryView(APIView):
    """Return only the current user's aggregate AI usage."""

    def get(self, request):
        return Response(build_usage_summary(getattr(request, "user_email", None)))
