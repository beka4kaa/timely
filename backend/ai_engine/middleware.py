"""Attach user/feature context to every model call made during an API request."""

from __future__ import annotations

from django.http import JsonResponse

from .usage import (
    AIUsageLimitExceeded,
    ensure_usage_available,
    usage_scope,
)


def _feature_from_path(path: str) -> str:
    normalized = path.strip("/").replace("-", "_")
    if not normalized:
        return "unknown"
    parts = normalized.split("/")
    if parts[:2] == ["api", "ai"] and len(parts) >= 3:
        return parts[2]
    if parts[:2] == ["api", "nutrition"] and "analyze_photo" in parts:
        return "nutrition_photo"
    return parts[-1] or "unknown"


class AIUsageContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user_email = getattr(request, "user_email", None)
        with usage_scope(
            user_email=user_email,
            feature=_feature_from_path(request.path),
        ):
            is_metered_request = (
                request.method not in {"GET", "HEAD", "OPTIONS"}
                and (
                    request.path.startswith("/api/ai/")
                    or request.path.rstrip("/") == "/api/nutrition/analyze-photo"
                )
            )
            if is_metered_request:
                try:
                    ensure_usage_available(user_email)
                except AIUsageLimitExceeded as exc:
                    return JsonResponse(exc.as_payload(), status=429)
            return self.get_response(request)
