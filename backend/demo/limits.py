"""Кто пришёл и сколько раз: адрес за прокси Railway и счётчики в кэше."""

from __future__ import annotations

from django.core.cache import cache


def client_ip(request) -> str:
    """Адрес посетителя.

    Крайний справа адрес в X-Forwarded-For дописывает сам прокси Railway, а всё левее
    клиент может прислать какое угодно. X-Real-IP идёт вторым: его клиент, возможно,
    тоже умеет подставить через край Railway. Последним идёт адрес соединения.
    """
    forwarded = [part.strip() for part in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if part.strip()]
    real = request.META.get("HTTP_X_REAL_IP", "").strip()
    return ((forwarded[-1] if forwarded else "") or real or request.META.get("REMOTE_ADDR", "") or "unknown")[:64]


def take_slot(key: str, limit: int, timeout: int) -> bool:
    """Ещё один раз под этим ключом. False — лимит исчерпан, ноль и меньше — лимита нет."""
    if limit <= 0:
        return True
    if cache.add(key, 1, timeout=timeout):
        return True
    try:
        count = cache.incr(key)
    except ValueError:
        # Ключ успел истечь между add и incr.
        cache.set(key, 1, timeout=timeout)
        return True
    return count <= limit
