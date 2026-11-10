"""`POST /api/demo/start/`: мир на месте, аккаунт посетителя собран на сегодня."""

from __future__ import annotations

import logging

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import current_user

from .identity import is_visitor_email
from .limits import client_ip, take_slot
from .prune import prune_visitors
from .visitor import resolve_zone, seed_if_needed
from .world import ensure_world

logger = logging.getLogger("demo.start")

# Сколько старых посетителей убирать за один вход: чистка не должна тормозить вход.
PRUNE_BATCH = 5
NOT_A_VISITOR = "Это не посетитель демо."


def take_start_slot(ip: str, now) -> bool:
    """Ещё один новый посетитель с этого адреса в этот час. False — лимит исчерпан."""
    return take_slot(f"demo:starts:{ip}:{now:%Y%m%d%H}", settings.DEMO_STARTS_PER_IP_PER_HOUR, 3600)


class DemoStartView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if not settings.DEMO_MODE:
            return Response({"error": "Не найдено."}, status=status.HTTP_404_NOT_FOUND)
        email = getattr(request, "user_email", None)
        if not is_visitor_email(email):
            return Response({"error": NOT_A_VISITOR}, status=status.HTTP_403_FORBIDDEN)

        payload = request.data if isinstance(request.data, dict) else {}
        zone = resolve_zone(payload.get("tz"))
        now = timezone.now()

        ensure_world(now)
        try:
            prune_visitors(now, limit=PRUNE_BATCH, keep=email)
        except Exception:  # noqa: BLE001 — из-за чистки вход в демо падать не должен
            logger.exception("demo.prune_failed_on_start")

        user = current_user(request)
        if user is None:
            return Response({"error": NOT_A_VISITOR}, status=status.HTTP_403_FORBIDDEN)
        # Считаются только новые посетители: возвращение на следующий день лимит не тратит.
        if user.last_login is None and not take_start_slot(client_ip(request), now):
            return Response(
                {"error": "Слишком много новых демо-аккаунтов с этого адреса. Попробуй через час."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        seeded = seed_if_needed(user.pk, zone, now)
        if seeded is None:
            # Строку только что убрала чистка с чужого входа: заводим заново и собираем.
            user = current_user(request)
            seeded = seed_if_needed(user.pk, zone, now) if user else None
        if seeded is None:
            return Response({"error": "Не получилось собрать демо. Обнови страницу."}, status=status.HTTP_409_CONFLICT)
        return Response({"ok": True, "seeded": seeded})
