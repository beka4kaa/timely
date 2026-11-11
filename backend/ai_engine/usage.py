"""Fail-open AI usage ledger, quota summaries, and provider response parsing."""

from __future__ import annotations

import logging
import math
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from typing import Any, Callable, Iterator

from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.db.utils import Error as DBError, OperationalError, ProgrammingError
from django.utils import timezone

from .models import AIUsageEvent, AIUsageQuotaState
from .time_limit import hit_time_limit

logger = logging.getLogger(__name__)

SUPPORTED_AI_PLANS = ("free", "pro", "max")

# The most a plan or chapter-profiling call is expected to write. A job that
# reserves up front prices each call's output with it rather than with the
# call's ceiling (``provider_call_token_estimate``).
CALL_OUTPUT_ESTIMATE_TOKENS = 3000


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


@dataclass(frozen=True)
class UsageReservation:
    """Handle for one worker's temporary quota claim."""

    user_email: str = ""
    key: str = ""
    reserved_tokens: int = 0
    kind: str = "capacity"
    active: bool = False


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

# The reserve a whole job paid for up front (``prepaid_usage``). It has its own
# variable rather than a field in ``UsageContext``: ``usage_scope`` rebuilds that
# context from the e-mail and the feature, and every provider opens one per call.
_prepaid_reservation: ContextVar[UsageReservation | None] = ContextVar(
    "timely_ai_prepaid_reservation",
    default=None,
)


def _prepaid_for(user_email: str | None) -> UsageReservation | None:
    """The active prepaid reserve, when it is this student's.

    A prepayment covers its own student only: a call for anyone else inside the
    block reserves for itself and leaves the reserve alone.
    """

    prepaid = _prepaid_reservation.get()
    if prepaid is None or prepaid.user_email != (user_email or "").strip().lower():
        return None
    return prepaid


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


@lru_cache(maxsize=1)
def _reservation_tokenizer():
    """Load the pinned local tokenizer, with a fail-closed fallback."""

    try:
        import tiktoken

        return tiktoken.get_encoding("cl100k_base")
    except Exception as exc:  # noqa: BLE001 - fallback below remains safe
        logger.warning("[usage] reservation tokenizer unavailable: %s", exc)
        return None


def _provider_input_token_bound(value: Any) -> int:
    text = _text_for_estimate(value)
    if not text:
        return 0

    tokenizer = _reservation_tokenizer()
    if tokenizer is None:
        # A byte-level tokenizer cannot produce more text tokens than there
        # are UTF-8 bytes. This path is conservative by design.
        estimated = len(text.encode("utf-8"))
    else:
        # Exact for the configured embedding model and a close local proxy for
        # the OpenAI-compatible chat roles. The margin covers message framing
        # and small provider-specific tokenizer differences. A book or a goal
        # may spell a special token such as "<|endoftext|>": here it is just
        # text, and tiktoken's default would raise on it.
        estimated = math.ceil(
            len(tokenizer.encode(text, disallowed_special=())) * 1.25
        )
    return estimated + 256


def provider_call_token_upper_bound(
    input_payload: Any,
    *,
    max_output_tokens: int = 0,
    image_count: int = 0,
    image_input_tokens: int = 0,
) -> int:
    """Conservative reservation aligned with the ledger's billing formula.

    Text input is counted locally, output uses the request ceiling, and images
    use the deterministic charge. The ledger bills the greater of provider
    tokens and that image charge, so summing both would reject valid OCR calls.

    ``image_input_tokens`` is what the provider counts in its input for each
    image (a vision model's visual tokens), which the local text count cannot
    see. It adds to the input side; the image charge stays the floor.
    """

    input_upper_bound = _provider_input_token_bound(input_payload)
    output_upper_bound = max(0, int(max_output_tokens or 0))
    images = max(0, int(image_count or 0))
    image_input_upper_bound = images * max(0, int(image_input_tokens or 0))
    image_upper_bound = images * max(
        0,
        int(getattr(settings, "AI_IMAGE_TOKEN_CHARGE", 4000)),
    )
    return max(
        1,
        input_upper_bound + image_input_upper_bound + output_upper_bound,
        image_upper_bound,
    )


def provider_call_token_estimate(
    input_payload: Any,
    *,
    max_output_tokens: int = 0,
) -> int:
    """Expected price of one text call, for a job that reserves up front.

    The input is counted like the upper bound, the output only up to
    ``CALL_OUTPUT_ESTIMATE_TOKENS``: priced at every call's ceiling, a plan with
    its chapter profiles would rarely fit the window. A call that writes more
    still runs inside ``prepaid_usage``, and the overrun lands in the ledger.
    Scans and lone calls keep ``provider_call_token_upper_bound``.
    """

    output_estimate = min(
        max(0, int(max_output_tokens or 0)),
        CALL_OUTPUT_ESTIMATE_TOKENS,
    )
    return _provider_input_token_bound(input_payload) + output_estimate


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
    metered: bool = True,
) -> AIUsageEvent | None:
    """Persist one provider call without ever breaking the AI request.

    ``metered=False`` keeps the call in the ledger but out of the student's
    quota: windows and the usage summary ignore it. Inside ``prepaid_usage`` a
    metered call of the reserve's own student also draws that reserve down by
    its billable tokens.
    """
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
        event = AIUsageEvent.objects.create(
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
            metered=metered,
            metadata=safe_metadata,
        )
    except Exception as exc:  # noqa: BLE001 - accounting is deliberately fail-open
        if hit_time_limit(exc):
            # Fail-open covers accounting failures, not the worker's soft time
            # limit: swallowed here, it would let the job run on to the hard kill.
            raise SoftTimeLimitExceeded() from exc
        if isinstance(exc, (OperationalError, ProgrammingError)):
            logger.warning(
                "[usage] ledger unavailable; request remains successful: %s", exc
            )
        else:
            logger.warning(
                "[usage] failed to record provider call: %s", exc, exc_info=True
            )
    else:
        prepaid = _prepaid_for(context.user_email)
        if metered and prepaid is not None:
            # The windows count these tokens from now on, so the reserve that
            # held them for this call lets go of exactly as many.
            consume_usage_reservation(prepaid, billable_tokens)
        return event
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
            "five_hour": 150_000,
            "weekly": 500_000,
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
        # Unmetered calls stay in the ledger only. Every part below (windows,
        # totals, models, features, days and context) reads metered events.
        queryset = AIUsageEvent.objects.filter(user_email__iexact=email, metered=True)
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


def _window_refusal(
    summary: dict[str, Any],
    *,
    reserved: int,
    tokens: int,
) -> AIUsageLimitExceeded | None:
    """Refusal for ``tokens`` more next to ``reserved``, or ``None`` if they fit.

    When both windows are short, the refusal names the one that frees up last:
    the work cannot start before then anyway, and that is the time the student
    is shown.
    """

    windows = summary["windows"]
    short = [
        name
        for name in ("five_hour", "weekly")
        if int(windows[name]["used"]) + reserved + tokens > int(windows[name]["limit"])
    ]
    if not short:
        return None
    name = max(short, key=lambda item: datetime.fromisoformat(windows[item]["reset_at"]))
    return AIUsageLimitExceeded(window=name, reset_at=windows[name]["reset_at"])


def _claims_block_until(
    windows: dict[str, Any],
    reservations: dict[str, dict[str, Any]],
    need: int,
    *,
    kind: str = "capacity",
) -> datetime | None:
    """When the claims a new ``kind`` claim competes with stop blocking ``need``.

    The claims are let go in the order they expire, so the answer is the
    expiry of the claim whose release makes room. ``None`` when the spent
    tokens alone leave no room (the window reset is the answer then) or when
    no claim is in the way.
    """
    room = min(
        int(windows[name]["limit"]) - int(windows[name]["used"])
        for name in ("five_hour", "weekly")
    )
    if need > room:
        return None
    claims = sorted(
        (
            claim
            for claim in reservations.values()
            if kind == "admission" or claim["kind"] == "capacity"
        ),
        key=lambda claim: claim["expires_at"],
    )
    held = sum(int(claim["tokens"]) for claim in claims)
    blocked_until: float | None = None
    for claim in claims:
        if held + need <= room:
            break
        held -= int(claim["tokens"])
        blocked_until = claim["expires_at"]
    if blocked_until is None:
        return None
    return datetime.fromtimestamp(blocked_until, tz=UTC)


def _refusal_until_claims_end(
    denied: AIUsageLimitExceeded,
    windows: dict[str, Any],
    reservations: dict[str, dict[str, Any]],
    need: int,
    *,
    kind: str = "capacity",
) -> AIUsageLimitExceeded:
    """The refusal, with the time live claims let go when only they block it.

    Claims expire within minutes (a chat call, the rest of a job cut off by a
    deploy), so the student is told that time and not a window reset hours
    away. The payload keeps its shape.
    """
    blocked_until = _claims_block_until(windows, reservations, need, kind=kind)
    if blocked_until is None:
        return denied
    return AIUsageLimitExceeded(window=denied.window, reset_at=_iso(blocked_until))


def ensure_usage_available(user_email: str | None) -> None:
    """Refuse a request up front when a window has no room left for it.

    Live capacity reservations hold their part of the window, so a chat cannot
    spend what a running job has reserved. The reserve of the job this check
    runs in (``prepaid_usage``) does not count against it. When only live
    reservations stand in the way, the refusal says when they let go.
    """

    if not getattr(settings, "AI_USAGE_ENFORCE_LIMITS", False):
        return
    email = (user_email or "").strip().lower()
    if not email:
        return
    current = timezone.now()
    summary = build_usage_summary(email, now=current)
    reservations = _read_live_reservations(email, now_timestamp=current.timestamp())
    own = _prepaid_for(email)
    if own is not None:
        reservations.pop(own.key, None)
    # Room for at least one more token: used + reserved >= limit refuses.
    denied = _window_refusal(
        summary,
        reserved=_competing_reserved_tokens(reservations, kind="capacity"),
        tokens=1,
    )
    if denied is not None:
        raise _refusal_until_claims_end(denied, summary["windows"], reservations, 1)


def usage_window_limit(user_email: str | None) -> int | None:
    """The smaller of the plan's two windows: no single job can reserve more.

    ``None`` when limits are off or there is no student to charge.
    """
    if not getattr(settings, "AI_USAGE_ENFORCE_LIMITS", False):
        return None
    email = (user_email or "").strip().lower()
    if not email:
        return None
    limits = resolve_usage_plan(email)["limits"]
    return min(int(limits["five_hour"]), int(limits["weekly"]))


def _active_reservations(
    raw: Any,
    *,
    now_timestamp: float,
) -> dict[str, dict[str, Any]]:
    """Return only well-formed, unexpired reservations from persisted JSON."""

    if not isinstance(raw, dict):
        return {}
    active: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            continue
        try:
            tokens = int(value.get("tokens", 0))
            expires_at = float(value.get("expires_at", 0))
        except (TypeError, ValueError):
            continue
        if tokens <= 0 or not math.isfinite(expires_at) or expires_at <= now_timestamp:
            continue
        reservation_kind = str(value.get("kind", "capacity"))
        if reservation_kind not in {"admission", "capacity"}:
            reservation_kind = "capacity"
        active[key] = {
            "tokens": tokens,
            "expires_at": expires_at,
            "feature": str(value.get("feature", "unknown"))[:80],
            "kind": reservation_kind,
        }
    return active


def _competing_reserved_tokens(
    reservations: dict[str, dict[str, Any]],
    *,
    kind: str,
) -> int:
    """Live reserved tokens a new claim of ``kind`` has to fit next to.

    Admission leases gate concurrent jobs against all live work, but do not
    consume their own provider-call budget a second time. Capacity claims
    therefore count only other capacity claims.
    """
    return sum(
        int(item["tokens"])
        for item in reservations.values()
        if kind == "admission" or item["kind"] == "capacity"
    )


def _read_live_reservations(
    email: str,
    *,
    now_timestamp: float,
) -> dict[str, dict[str, Any]]:
    """One user's live reservations, read without the row lock.

    An unreadable row counts as no reservations: ``reserve_usage_capacity``
    fails open on the same errors and would admit the work.
    """
    try:
        state = AIUsageQuotaState.objects.filter(user_email=email).first()
    except (OperationalError, ProgrammingError) as exc:
        logger.warning("[usage] quota reservations unavailable; counting none: %s", exc)
        return {}
    return _active_reservations(
        state.reservations if state is not None else {},
        now_timestamp=now_timestamp,
    )


def available_usage_tokens(user_email: str | None, *, now=None) -> int | None:
    """Tokens a new capacity reservation could still take right now.

    The headroom of the tighter window minus live capacity reservations,
    counted exactly as ``reserve_usage_capacity`` counts them, never below
    zero. ``None`` when limits are off or there is no student to charge.
    """
    if not getattr(settings, "AI_USAGE_ENFORCE_LIMITS", False):
        return None
    email = (user_email or "").strip().lower()
    if not email:
        return None

    current = now or timezone.now()
    windows = build_usage_summary(email, now=current)["windows"]
    headroom = min(
        int(windows[name]["limit"]) - int(windows[name]["used"])
        for name in ("five_hour", "weekly")
    )
    reservations = _read_live_reservations(email, now_timestamp=current.timestamp())
    return max(0, headroom - _competing_reserved_tokens(reservations, kind="capacity"))


def reservations_block_until(
    user_email: str | None,
    need: int,
    *,
    now=None,
) -> datetime | None:
    """When live reservations stop standing in the way of ``need`` more tokens.

    A refused reserve shows the student when to come back. If the spent tokens
    leave room for ``need`` in both windows, only live capacity reservations
    block it: a chat call's claim, the rest of a dead worker's reserve. They
    let go as they expire, so the answer is the expiry of the claim whose
    release makes room, that is the latest of the claims that have to go, and
    not a window reset hours away.

    ``None`` when limits are off, there is no student, the spent tokens alone
    leave no room (then the window reset is the answer), or no live claim is
    in the way.
    """
    if not getattr(settings, "AI_USAGE_ENFORCE_LIMITS", False):
        return None
    email = (user_email or "").strip().lower()
    if not email:
        return None

    current = now or timezone.now()
    # Counted as `reserve_usage_capacity` counts them for a capacity claim.
    return _claims_block_until(
        build_usage_summary(email, now=current)["windows"],
        _read_live_reservations(email, now_timestamp=current.timestamp()),
        need,
    )


def reserve_usage_capacity(
    user_email: str | None,
    *,
    reserved_tokens: int,
    feature: str = "unknown",
    reservation_kind: str = "capacity",
    ttl_seconds: int | None = None,
    now=None,
) -> UsageReservation:
    """Atomically check quota and reserve capacity for deferred worker work.

    The per-user state row is the serialization point.  Reservations are
    deliberately separate from ``AIUsageEvent`` because the latter is an
    immutable ledger of provider calls which actually happened.  The fixed
    amount is an admission/concurrency lease, not a usage prediction or a
    charge; only provider events contribute to reported actual usage.

    As with the existing usage ledger, a missing table during a rolling deploy
    is fail-open.  Once migrations are present, concurrent PostgreSQL workers
    cannot over-admit based on the same usage snapshot.
    """

    if not getattr(settings, "AI_USAGE_ENFORCE_LIMITS", False):
        return UsageReservation()
    email = (user_email or "").strip().lower()
    if not email:
        return UsageReservation()

    tokens = max(1, int(reserved_tokens))
    kind = (
        reservation_kind
        if reservation_kind in {"admission", "capacity"}
        else "capacity"
    )
    ttl = max(
        60,
        int(
            ttl_seconds
            if ttl_seconds is not None
            else getattr(settings, "AI_USAGE_RESERVATION_TTL_SECONDS", 3900)
        ),
    )
    current = now or timezone.now()
    now_timestamp = current.timestamp()
    key = uuid.uuid4().hex
    denied: AIUsageLimitExceeded | None = None

    try:
        with transaction.atomic():
            # Keep the empty row after release: deleting the serialization
            # point would reintroduce a first-reservation race.
            # ``get_or_create`` performs its insert in a savepoint; the unique
            # email PK makes a concurrent first insert block, then the loser
            # catches that uniqueness collision and fetches the winning row.
            AIUsageQuotaState.objects.get_or_create(user_email=email)
            state = AIUsageQuotaState.objects.select_for_update().get(
                user_email=email
            )
            reservations = _active_reservations(
                state.reservations,
                now_timestamp=now_timestamp,
            )
            already_reserved = _competing_reserved_tokens(reservations, kind=kind)
            summary = build_usage_summary(email, now=current)
            denied = _window_refusal(summary, reserved=already_reserved, tokens=tokens)
            if denied is not None:
                denied = _refusal_until_claims_end(
                    denied, summary["windows"], reservations, tokens, kind=kind
                )

            if denied is None:
                reservations[key] = {
                    "tokens": tokens,
                    "expires_at": (current + timedelta(seconds=ttl)).timestamp(),
                    "feature": (feature or "unknown")[:80],
                    "kind": kind,
                }
            if reservations != state.reservations:
                state.reservations = reservations
                state.save(update_fields=["reservations", "updated_at"])
    except (OperationalError, ProgrammingError) as exc:
        logger.warning("[usage] quota reservation unavailable; failing open: %s", exc)
        return UsageReservation()

    if denied is not None:
        raise denied
    return UsageReservation(
        user_email=email,
        key=key,
        reserved_tokens=tokens,
        kind=kind,
        active=True,
    )


def _edit_live_reservations(
    reservation: UsageReservation,
    edit: Callable[[dict[str, dict[str, Any]]], Any],
    *,
    what: str,
) -> None:
    """Change one user's live reservations under the row lock.

    Expired claims are pruned on the way, and the row is written only when it
    changed. Database errors are logged and swallowed: the TTL is the
    crash/rolling-deploy cleanup path, and accounting must not turn completed
    work into failed work.
    """

    if not reservation.active:
        return
    try:
        with transaction.atomic():
            state = (
                AIUsageQuotaState.objects.select_for_update()
                .filter(user_email=reservation.user_email)
                .first()
            )
            if state is None:
                return
            reservations = _active_reservations(
                state.reservations,
                now_timestamp=timezone.now().timestamp(),
            )
            edit(reservations)
            if reservations != state.reservations:
                state.reservations = reservations
                state.save(update_fields=["reservations", "updated_at"])
    except DBError as exc:  # every DB-API error, InterfaceError included
        logger.warning("[usage] %s unavailable: %s", what, exc)


def release_usage_reservation(reservation: UsageReservation) -> None:
    """Release one claim; stale claims are also pruned opportunistically."""

    _edit_live_reservations(
        reservation,
        lambda live: live.pop(reservation.key, None),
        what="quota reservation cleanup",
    )


def shrink_usage_reservation(reservation: UsageReservation, tokens: int) -> None:
    """Keep at most ``tokens`` of a claim and give the rest of it back.

    A job that stops waiting for calls still running keeps their share: they
    draw it down as they record usage, and the expiry removes what they leave.
    The claim never grows, since the calls may already have spent more than
    their estimate. Zero releases it. Database errors are swallowed as in
    ``release_usage_reservation``.
    """

    keep = _as_non_negative_int(tokens)
    if keep == 0:
        release_usage_reservation(reservation)
        return

    def shrink(live: dict[str, dict[str, Any]]) -> None:
        claim = live.get(reservation.key)
        if claim is not None and int(claim["tokens"]) > keep:
            live[reservation.key] = {**claim, "tokens": keep}

    _edit_live_reservations(reservation, shrink, what="quota reservation shrink")


def consume_usage_reservation(reservation: UsageReservation, tokens: int) -> None:
    """Draw a prepaid reserve down by tokens its job has just spent.

    Those tokens are in the ledger now, so the reserve no longer has to hold
    them. A reserve drawn down to zero disappears. The expiry stays as it was,
    so the TTL still cleans up after a crashed worker. Database errors are
    swallowed as in ``release_usage_reservation``: the reserve then holds until
    it is released or expires.
    """

    spent = _as_non_negative_int(tokens)
    if spent == 0:
        return

    def draw_down(live: dict[str, dict[str, Any]]) -> None:
        claim = live.get(reservation.key)
        if claim is None:
            return
        left = int(claim["tokens"]) - spent
        if left > 0:
            live[reservation.key] = {**claim, "tokens": left}
        else:
            del live[reservation.key]

    _edit_live_reservations(reservation, draw_down, what="prepaid reservation draw-down")


@contextmanager
def usage_reservation(
    user_email: str | None,
    *,
    reserved_tokens: int,
    feature: str = "unknown",
    reservation_kind: str = "capacity",
    ttl_seconds: int | None = None,
) -> Iterator[UsageReservation]:
    """Reserve worker capacity and always release it on normal/error exits."""

    reservation = reserve_usage_capacity(
        user_email,
        reserved_tokens=reserved_tokens,
        feature=feature,
        reservation_kind=reservation_kind,
        ttl_seconds=ttl_seconds,
    )
    try:
        yield reservation
    finally:
        release_usage_reservation(reservation)


@contextmanager
def prepaid_usage(reservation: UsageReservation) -> Iterator[None]:
    """Let the calls inside draw on a reserve paid up front for a whole job.

    Inside the block, for the reservation's own student,
    ``provider_call_reservation`` reserves nothing and hands back this
    reservation, and every metered ``record_model_usage`` draws it down by its
    billable tokens. A call that costs more than what is left still runs: the
    overrun is in the ledger, and the windows read it from there. A call for
    anyone else reserves and is charged as usual. A parallel request has its
    own context and keeps reserving as usual, and its pre-check counts the
    reserve, so it cannot eat it.

    An inactive reservation changes nothing. Threads see the reserve through
    ``contextvars.copy_context()``. The block does not release the reservation:
    whoever reserved it does.
    """

    if not reservation.active:
        yield
        return
    token = _prepaid_reservation.set(reservation)
    try:
        yield
    finally:
        _prepaid_reservation.reset(token)


@contextmanager
def provider_call_reservation(
    *,
    input_payload: Any,
    max_output_tokens: int = 0,
    image_count: int = 0,
    image_input_tokens: int = 0,
    feature: str = "unknown",
) -> Iterator[UsageReservation]:
    """Reserve a model call until its caller has persisted ``AIUsageEvent``.

    Callers must keep both the network request and ``record_model_usage`` inside
    this context. Quota denial happens before the provider can spend anything.
    Inside ``prepaid_usage`` the job's reserve already covers the call: nothing
    is reserved, and that reservation is handed back.

    The claim expires after ``AI_USAGE_CALL_RESERVATION_TTL_SECONDS``, not the
    long job TTL: a call cut off by a redeploy or the gunicorn timeout must not
    hold the student's window, which the request pre-check counts, for an hour.
    """

    prepaid = _prepaid_for(current_usage_context().user_email)
    if prepaid is not None:
        yield prepaid
        return
    upper_bound = provider_call_token_upper_bound(
        input_payload,
        max_output_tokens=max_output_tokens,
        image_count=image_count,
        image_input_tokens=image_input_tokens,
    )
    with usage_reservation(
        current_usage_context().user_email,
        reserved_tokens=upper_bound,
        feature=feature,
        reservation_kind="capacity",
        ttl_seconds=getattr(settings, "AI_USAGE_CALL_RESERVATION_TTL_SECONDS", 600),
    ) as reservation:
        yield reservation
