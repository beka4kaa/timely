"""Credentials for tests that call the API over HTTP."""

import time

import jwt
from django.conf import settings

from .middleware import TOKEN_ALGORITHM, TOKEN_AUDIENCE, TOKEN_ISSUER


def api_token(email, *, ttl=600, secret=None, algorithm=TOKEN_ALGORITHM, **claims):
    now = int(time.time())
    payload = {
        "iss": TOKEN_ISSUER,
        "aud": TOKEN_AUDIENCE,
        "sub": email,
        "iat": now,
        "exp": now + ttl,
        **claims,
    }
    return jwt.encode(payload, secret or settings.API_JWT_SECRET, algorithm=algorithm)


def auth_headers(email, **kwargs):
    return {"HTTP_AUTHORIZATION": f"Bearer {api_token(email, **kwargs)}"}
