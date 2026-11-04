"""
API identity.

The browser and the Next.js server call this API with a short-lived JWT that the
Next.js app signs from the NextAuth session (src/lib/backend-token.ts), sent as
`Authorization: Bearer <token>`. `request.user_email` comes from that token and
every view reads it; a caller cannot simply state who they are.

`API_AUTH_ENFORCE` exists for the rollout. Vercel and Railway deploy separately,
so until it is on, a request without a valid token may still use the old
`X-User-Email` header. Those requests are logged, without the address, so the
switch can be flipped once they stop.
"""

import logging

import jwt
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import JsonResponse

logger = logging.getLogger("config.auth")

# Everything else is refused without a credential, so a new endpoint starts closed.
PUBLIC_PATH_PREFIXES = ("/health/", "/admin/", "/static/")

TOKEN_ALGORITHM = "HS256"
TOKEN_ISSUER = "timely-web"
TOKEN_AUDIENCE = "timely-api"
# Vercel and Railway clocks are close, not identical.
TOKEN_LEEWAY_SECONDS = 30
MIN_SECRET_LENGTH = 32


def _bearer_token(request):
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


def _email_from_token(token, path):
    # An empty key would let anyone sign a token that verifies.
    if not settings.API_JWT_SECRET:
        return None
    try:
        claims = jwt.decode(
            token,
            settings.API_JWT_SECRET,
            algorithms=[TOKEN_ALGORITHM],
            audience=TOKEN_AUDIENCE,
            issuer=TOKEN_ISSUER,
            leeway=TOKEN_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        logger.info("auth.invalid_token reason=%s path=%s", type(exc).__name__, path)
        return None
    return claims["sub"] or None


class UserEmailMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        if settings.API_AUTH_ENFORCE and len(settings.API_JWT_SECRET) < MIN_SECRET_LENGTH:
            raise ImproperlyConfigured(
                "API_AUTH_ENFORCE needs TIMELY_API_JWT_SECRET of at least "
                f"{MIN_SECRET_LENGTH} characters."
            )
        logger.info("auth.mode enforce=%s", settings.API_AUTH_ENFORCE)

    def __call__(self, request):
        request.user_email = self._identify(request)
        # path_info, the part URLs are resolved against: request.path also holds
        # SCRIPT_NAME, which a proxy could fill with a public prefix.
        if (
            request.user_email is None
            and settings.API_AUTH_ENFORCE
            and not request.path_info.startswith(PUBLIC_PATH_PREFIXES)
        ):
            return JsonResponse(
                {"error": "Требуется вход.", "code": "auth_required"}, status=401
            )
        return self.get_response(request)

    def _identify(self, request):
        token = _bearer_token(request)
        email = _email_from_token(token, request.path_info) if token else None
        if email or settings.API_AUTH_ENFORCE:
            return email

        legacy_email = request.headers.get("X-User-Email") or None
        if legacy_email:
            logger.info("auth.legacy_header path=%s", request.path_info)
        elif request.path_info.startswith("/api/"):
            logger.info("auth.no_credential path=%s", request.path_info)
        return legacy_email
