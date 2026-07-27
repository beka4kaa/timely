"""Fail-open AI usage ledger, quota summaries, and provider response parsing."""

from __future__ import annotations

import logging
import math
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Iterator

from django.conf import settings
from django.db.models import Sum
from django.db.utils import OperationalError, ProgrammingError
from django.utils import timezone

from .models import AIUsageEvent

logger = logging.getLogger(__name__)

SUPPORTED_AI_PLANS = ("free", "pro", "max")


@dataclass(frozen=True)
class UsageContext:
    user_email: str = ""
    feature: str = "unknown"


@dataclass(frozen=True)
class UsageNumbers:
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    cost_usd: Decimal | None = None
    estimated: bool = False


class AIUsageLimitExceeded(RuntimeError):
    def __init__(self, *, window: str, reset_at: str) -> None:
        super().__init__(f"AI usage limit exceeded for {window}")
        self.window = window
        self.reset_at = reset_at

    def as_payload(self) -> dict[str, Any]:
        return {
            "error": "Лимит AI-токенов исчерпан. Дождитесь обновления лимита.",
            "code": "ai_usage_limit_exceeded",
            "window": self.window,
            "reset_at": self.reset_at,
        }


_usage_context: ContextVar[UsageContext] = ContextVar(
    "timely_ai_usage_context",
    default=UsageContext(),
)


@contextmanager
def usage_scope(*, user_email: str | None = None, feature: str | None = None) -> Iterator[None]:
    current = _usage_context.get()
    token = _usage_context.set(
        UsageContext(
            user_email=(user_email if user_email is not None else current.user_email) or "",
            feature=(feature if feature is not None else current.feature) or "unknown",
        )
    )
    try:
        yield
    finally:
        _usage_context.reset(token)


def current_usage_context() -> UsageContext:
    return _usage_context.get()


def provider_from_base_url(base_url: str | None) -> str:
    value = (base_url or "").lower()
    if "openrouter.ai" in value:
        return "openrouter"
    if "groq.com" in value:
        return "groq"
    if value.startswith(("http://localhost", "http://127.0.0.1")):
        return "local"
    if value.startswith(("http://", "https://")):
        return "self_hosted"
    return "unknown"


def _get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _as_non_negative_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _as_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return decimal if decimal >= 0 else None


def _text_for_estimate(value: Any, *, key: str = "") -> str:
    """Collect text while excluding base64/image URLs from token estimates."""
    if value is None:
        return ""
    if isinstance(value, str):
        if key in {"url", "image_url"} or value.startswith(
            ("data:image/", "http://", "https://")
        ):
            return ""
        return value
    if isinstance(value, dict):
        return " ".join(
            _text_for_estimate(item, key=str(item_key))
            for item_key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return " ".join(_text_for_estimate(item, key=key) for item in value)
    return str(value)


def estimate_tokens(value: Any) -> int:
    text = " ".join(_text_for_estimate(value).split())
    if not text:
        return 0
    # Conservative provider-independent fallback for Cyrillic and Latin text.
    return max(1, math.ceil(len(text) / 3.5))


def _response_output(response: Any) -> Any:
    choices = _get(response, "choices", []) or []
    if not choices:
        return ""
    message = _get(choices[0], "message", {})
    return _get(message, "content", "")


def extract_usage(
    response: Any,
    *,
    input_payload: Any = None,
    output_payload: Any = None,
) -> UsageNumbers:
    usage = _get(response, "usage", {}) or {}
    input_tokens = _as_non_negative_int(
        _get(usage, "prompt_tokens", _get(usage, "input_tokens", 0))
    )
    output_tokens = _as_non_negative_int(
        _get(usage, "completion_tokens", _get(usage, "output_tokens", 0))
    )
    total_tokens = _as_non_negative_int(_get(usage, "total_tokens", 0))

    input_details = _get(
        usage,
        "prompt_tokens_details",
        _get(usage, "input_tokens_details", {}),
    ) or {}
    output_details = _get(
        usage,
        "completion_tokens_details",
        _get(usage, "output_tokens_details", {}),
    ) or {}
    cached_input_tokens = _as_non_negative_int(
        _get(input_details, "cached_tokens", _get(usage, "cached_tokens", 0))
    )
    reasoning_tokens = _as_non_negative_int(
        _get(output_details, "reasoning_tokens", _get(usage, "reasoning_tokens", 0))
    )
    cost = _as_decimal(_get(usage, "cost", _get(response, "cost", None)))

    estimated = False
    if input_tokens == 0 and input_payload is not None:
        input_tokens = estimate_tokens(input_payload)
        estimated = input_tokens > 0
    if output_tokens == 0:
        output_tokens = estimate_tokens(
            output_payload if output_payload is not None else _response_output(response)
        )
        estimated = estimated or output_tokens > 0
    if total_tokens == 0:
        total_tokens = input_tokens + output_tokens

    return UsageNumbers(
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        output_tokens=output_tokens,
        reasoning_tokens=reasoning_tokens,
        total_tokens=total_tokens,
        cost_usd=cost,
        estimated=estimated,
    )


def record_model_usage(
    response: Any,
    *,
    model: str,
    provider: str,
    feature: str | None = None,
    input_payload: Any = None,
    output_payload: Any = None,
    image_count: int = 0,
    metadata: dict[str, Any] | None = None,
) -> AIUsageEvent | None:
    """Persist one provider call without ever breaking the AI request."""
    context = current_usage_context()
    if not context.user_email and not getattr(settings, "AI_USAGE_TRACK_ANONYMOUS", False):
        return None
    numbers = extract_usage(
        response,
        input_payload=input_payload,
        output_payload=output_payload,
    )
    images = max(0, int(image_count or 0))
    image_charge = max(0, int(getattr(settings, "AI_IMAGE_TOKEN_CHARGE", 4000)))
    billable_tokens = max(numbers.total_tokens, images * image_charge)
    if billable_tokens == 0:
        return None

    request_id = str(_get(response, "id", "") or "")[:160]
    actual_model = str(_get(response, "model", "") or model or "unknown")[:160]
    safe_metadata = {
        str(key)[:80]: value
        for key, value in (metadata or {}).items()
        if isinstance(value, (str, int, float, bool, type(None)))
    }

    try:
        return AIUsageEvent.objects.create(
            user_email=context.user_email[:254],
            provider=(provider or "unknown")[:48],
            model_name=actual_model,
            feature=(feature or context.feature or "unknown")[:80],
            request_id=request_id,
            input_tokens=numbers.input_tokens,
            cached_input_tokens=numbers.cached_input_tokens,
            output_tokens=numbers.output_tokens,
            reasoning_tokens=numbers.reasoning_tokens,
            total_tokens=numbers.total_tokens,
            image_count=images,
            billable_tokens=billable_tokens,
            cost_usd=numbers.cost_usd,
            is_estimated=numbers.estimated,
            metadata=safe_metadata,
        )
    except (OperationalError, ProgrammingError) as exc:
        logger.warning("[usage] ledger unavailable; request remains successful: %s", exc)
    except Exception as exc:  # noqa: BLE001 - accounting is deliberately fail-open
        logger.warning("[usage] failed to record provider call: %s", exc, exc_info=True)
    return None


def _percent(used: int, limit: int) -> int:
    if limit <= 0:
        return 0
    return min(100, max(0, round(used / limit * 100)))


def _iso(value) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _window_payload(*, used: int, limit: int, reset_at) -> dict[str, Any]:
    return {
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
        "percent": _percent(used, limit),
        "reset_at": _iso(reset_at),
    }


def _plan_profile(
    plan_id: str,
    *,
    is_admin_grant: bool = False,
) -> dict[str, Any]:
    requested = plan_id if plan_id in SUPPORTED_AI_PLANS else "free"
    configured = getattr(settings, "AI_PLAN_LIMITS", {})
    defaults = {
        "free": {
            "label": "Free",
            "context": 32_000,
            "five_hour": 25_000,
            "weekly": 100_000,
            "price_usd": 0.0,
            "usage_multiplier": 1,
        },
        "pro": {
            "label": "Pro",
            "context": 128_000,
            "five_hour": 250_000,
            "weekly": 1_000_000,
            "price_usd": 19.9,
            "usage_multiplier": 10,
        },
        "max": {
            "label": "Max",
            "context": 256_000,
            "five_hour": 5_000_000,
            "weekly": 20_000_000,
            "price_usd": 199.0,
            "usage_multiplier": 200,
        },
    }
    values = {**defaults[requested], **dict(configured.get(requested, {}))}
    return {
        "id": requested,
        "label": str(values["label"]),
        "price_usd": float(values["price_usd"]),
        "usage_multiplier": int(values["usage_multiplier"]),
        "is_admin_grant": is_admin_grant,
        "limits": {
            "context": max(1, int(values["context"])),
            "five_hour": max(1, int(values["five_hour"])),
            "weekly": max(1, int(values["weekly"])),
        },
    }


def resolve_usage_plan(user_email: str | None) -> dict[str, Any]:
    """Resolve the stored plan, granting staff/superusers the bounded Max tier."""
    email = (user_email or "").strip().lower()
    if not email:
        return _plan_profile("free")

    try:
        from accounts.models import CustomUser

        user = (
            CustomUser.objects.filter(email__iexact=email)
            .only("ai_plan", "is_staff", "is_superuser")
            .first()
        )
        if user and (user.is_staff or user.is_superuser):
            return _plan_profile("max", is_admin_grant=True)
        return _plan_profile(user.ai_plan if user else "free")
    except (OperationalError, ProgrammingError) as exc:
        logger.warning("[usage] plan unavailable; using Free: %s", exc)
        return _plan_profile("free")


def empty_usage_summary(
    *,
    user_email: str = "",
    now=None,
    plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now or timezone.now()
    plan = plan or _plan_profile("free")
    five_limit = int(plan["limits"]["five_hour"])
    weekly_limit = int(plan["limits"]["weekly"])
    context_limit = int(plan["limits"]["context"])
    week_start = (now - timedelta(days=now.weekday())).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    daily = [
        {
            "date": (now.date() - timedelta(days=offset)).isoformat(),
            "tokens": 0,
        }
        for offset in reversed(range(7))
    ]
    return {
        "authenticated": bool(user_email),
        "updated_at": _iso(now),
        "plan": {
            key: value
            for key, value in plan.items()
            if key != "limits"
        },
        "context": {
            "used": 0,
            "limit": context_limit,
            "percent": 0,
            "model": "",
        },
        "windows": {
            "five_hour": _window_payload(
                used=0,
                limit=five_limit,
                reset_at=now + timedelta(hours=5),
            ),
            "weekly": _window_payload(
                used=0,
                limit=weekly_limit,
                reset_at=week_start + timedelta(days=7),
            ),
        },
        "totals": {
            "billable_tokens": 0,
            "provider_tokens": 0,
            "images": 0,
            "requests": 0,
            "cost_usd": 0.0,
        },
        "by_model": [],
        "by_feature": [],
        "daily": daily,
    }


def build_usage_summary(user_email: str | None, *, now=None) -> dict[str, Any]:
    email = (user_email or "").strip().lower()
    now = now or timezone.now()
    summary = empty_usage_summary(
        user_email=email,
        now=now,
        plan=resolve_usage_plan(email),
    )
    if not email:
        return summary

    try:
        queryset = AIUsageEvent.objects.filter(user_email__iexact=email)
        five_start = now - timedelta(hours=5)
        week_start = (now - timedelta(days=now.weekday())).replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
        seven_days_start = (now - timedelta(days=6)).replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )

        latest = queryset.order_by("-created_at").first()
        if latest:
            context_limit = summary["context"]["limit"]
            summary["context"] = {
                "used": latest.input_tokens,
                "limit": context_limit,
                "percent": _percent(latest.input_tokens, context_limit),
                "model": latest.model_name,
            }

        five_events = queryset.filter(created_at__gte=five_start)
        week_events = queryset.filter(created_at__gte=week_start)
        five_used = int(
            five_events.aggregate(value=Sum("billable_tokens"))["value"] or 0
        )
        weekly_used = int(
            week_events.aggregate(value=Sum("billable_tokens"))["value"] or 0
        )
        earliest_five = five_events.order_by("created_at").first()
        five_reset = (
            earliest_five.created_at + timedelta(hours=5)
            if earliest_five
            else now + timedelta(hours=5)
        )
        summary["windows"]["five_hour"] = _window_payload(
            used=five_used,
            limit=summary["windows"]["five_hour"]["limit"],
            reset_at=five_reset,
        )
        summary["windows"]["weekly"] = _window_payload(
            used=weekly_used,
            limit=summary["windows"]["weekly"]["limit"],
            reset_at=week_start + timedelta(days=7),
        )

        total_values = queryset.aggregate(
            billable_tokens=Sum("billable_tokens"),
            provider_tokens=Sum("total_tokens"),
            images=Sum("image_count"),
            cost_usd=Sum("cost_usd"),
        )
        summary["totals"] = {
            "billable_tokens": int(total_values["billable_tokens"] or 0),
            "provider_tokens": int(total_values["provider_tokens"] or 0),
            "images": int(total_values["images"] or 0),
            "requests": queryset.count(),
            "cost_usd": float(total_values["cost_usd"] or 0),
        }

        model_rows = (
            week_events.values("model_name")
            .annotate(tokens=Sum("billable_tokens"), cost_usd=Sum("cost_usd"))
            .order_by("-tokens")[:6]
        )
        summary["by_model"] = [
            {
                "model": row["model_name"],
                "tokens": int(row["tokens"] or 0),
                "cost_usd": float(row["cost_usd"] or 0),
            }
            for row in model_rows
        ]

        feature_rows = (
            week_events.values("feature")
            .annotate(tokens=Sum("billable_tokens"))
            .order_by("-tokens")[:6]
        )
        summary["by_feature"] = [
            {
                "feature": row["feature"],
                "tokens": int(row["tokens"] or 0),
            }
            for row in feature_rows
        ]

        daily_map = {item["date"]: 0 for item in summary["daily"]}
        for event in queryset.filter(created_at__gte=seven_days_start).only(
            "created_at",
            "billable_tokens",
        ):
            date_key = timezone.localtime(event.created_at).date().isoformat()
            if date_key in daily_map:
                daily_map[date_key] += event.billable_tokens
        summary["daily"] = [
            {"date": date_key, "tokens": tokens}
            for date_key, tokens in daily_map.items()
        ]
        return summary
    except (OperationalError, ProgrammingError) as exc:
        logger.warning("[usage] summary unavailable; returning zero state: %s", exc)
        return summary


def ensure_usage_available(user_email: str | None) -> None:
    if not getattr(settings, "AI_USAGE_ENFORCE_LIMITS", False):
        return
    email = (user_email or "").strip().lower()
    if not email:
        return
    summary = build_usage_summary(email)
    for key in ("five_hour", "weekly"):
        window = summary["windows"][key]
        if window["used"] >= window["limit"]:
            raise AIUsageLimitExceeded(window=key, reset_at=window["reset_at"])
