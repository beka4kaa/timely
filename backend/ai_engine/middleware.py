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


def _is_metered_request(method: str, path: str) -> bool:
    """Quota guard только для действий, которые реально могут вызвать модель."""
    if method.upper() in {"GET", "HEAD", "OPTIONS"}:
        return False
    normalized = "/" + path.strip("/")
    if normalized.startswith("/api/ai/"):
        return True
    if normalized == "/api/nutrition/analyze-photo":
        return True

    parts = normalized.strip("/").split("/")
    if parts[:2] != ["api", "curriculum"]:
        return False
    tail = parts[2:]
    if tail in (["search"], ["plans", "generate"]):
        return True
    if len(tail) == 3 and tail[0] == "goals" and tail[2] == "normalize":
        return True
    if len(tail) == 3 and tail[0] == "documents" and tail[2] == "ingest":
        return True
    return False


class AIUsageContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user_email = getattr(request, "user_email", None)
        with usage_scope(
            user_email=user_email,
            feature=_feature_from_path(request.path),
        ):
            try:
                if _is_metered_request(request.method, request.path):
                    ensure_usage_available(user_email)
                return self.get_response(request)
            except AIUsageLimitExceeded as exc:
                # A per-provider-call reservation can be denied after the
                # cheap request-level precheck. It is still the same 429, not
                # a provider failure or a generic 500.
                return JsonResponse(exc.as_payload(), status=429)
