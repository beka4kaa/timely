"""Only a credential the server can verify says who is calling the API."""

import jwt
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings

from ai_engine.models import ChatSession
from curriculum.models import LearningGoal
from config.middleware import UserEmailMiddleware
from config.testing import api_token, auth_headers

OWNER = "owner@example.com"
VICTIM = "victim@example.com"
LIST_URL = "/api/ai_engine/chat-sessions/"

# The requests reproduced against the old API: a stranger's schedules, their
# proposals, and a write that changes their calendar. Unknown ids are enough,
# because the refusal must come before any view runs.
GUARDED_REQUESTS = [
    ("get", "/api/study-schedules/"),
    ("get", "/api/study-schedules/some-id/revisions/"),
    ("post", "/api/schedule-revisions/some-id/confirm/"),
    ("get", "/api/me/"),
    ("get", "/api/admin/users/"),
    ("get", "/api/users/search/?q=a"),
    ("get", "/api/leaderboard/"),
    ("get", "/api/nutrition/foods/?q=a"),
    ("post", "/api/ai/ocr/"),
    ("post", "/api/auth/login/"),
    ("post", "/api/auth/register/"),
    ("get", "/api/no-such-endpoint/"),
]


class _Base(TestCase):
    def setUp(self):
        ChatSession.objects.create(id="own", user_email=OWNER, title="Own", messages=[])
        ChatSession.objects.create(id="victims", user_email=VICTIM, title="Victim's", messages=[])

    def assert_lists_only_own(self, response):
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([row["id"] for row in response.json()], ["own"])


class RefusedWithoutValidCredentialTests(_Base):
    def test_no_credential(self):
        for method, url in GUARDED_REQUESTS:
            with self.subTest(url=url):
                response = getattr(self.client, method)(url)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()["code"], "auth_required")

    def test_forged_header(self):
        for method, url in GUARDED_REQUESTS:
            with self.subTest(url=url):
                response = getattr(self.client, method)(url, HTTP_X_USER_EMAIL=VICTIM)
                self.assertEqual(response.status_code, 401)

    def test_query_parameter(self):
        response = self.client.get(f"{LIST_URL}?user_email={VICTIM}")
        self.assertEqual(response.status_code, 401)

    def test_expired_token(self):
        # Past the leeway, not just past `exp`.
        response = self.client.get(LIST_URL, **auth_headers(OWNER, ttl=-120))
        self.assertEqual(response.status_code, 401)

    def test_token_signed_with_another_secret(self):
        headers = auth_headers(OWNER, secret="a-different-secret-that-is-also-long-enough")
        self.assertEqual(self.client.get(LIST_URL, **headers).status_code, 401)

    def test_wrong_audience_or_issuer(self):
        for claims in ({"aud": "something-else"}, {"iss": "someone-else"}):
            with self.subTest(claims=claims):
                response = self.client.get(LIST_URL, **auth_headers(OWNER, **claims))
                self.assertEqual(response.status_code, 401)

    def test_unsigned_token(self):
        token = jwt.encode(
            {"iss": "timely-web", "aud": "timely-api", "sub": OWNER, "iat": 1, "exp": 9999999999},
            key="",
            algorithm="none",
        )
        response = self.client.get(LIST_URL, HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(response.status_code, 401)

    def test_token_with_a_required_claim_missing(self):
        for missing in ("sub", "exp", "iat"):
            with self.subTest(missing=missing):
                claims = {
                    "iss": "timely-web",
                    "aud": "timely-api",
                    "sub": OWNER,
                    "iat": 1,
                    "exp": 9999999999,
                }
                del claims[missing]
                token = jwt.encode(claims, settings.API_JWT_SECRET, algorithm="HS256")
                response = self.client.get(LIST_URL, HTTP_AUTHORIZATION=f"Bearer {token}")
                self.assertEqual(response.status_code, 401)

    def test_bad_token_is_logged_without_the_address(self):
        with self.assertLogs("config.auth", level="INFO") as logs:
            self.client.get(LIST_URL, **auth_headers(OWNER, ttl=-120))
        self.assertIn("auth.invalid_token reason=ExpiredSignatureError", logs.output[0])
        self.assertNotIn(OWNER, logs.output[0])

    def test_garbage_and_other_schemes(self):
        for value in ("Bearer not-a-token", "Bearer ", "Basic b3duZXI6cGFzcw==", api_token(OWNER)):
            with self.subTest(value=value):
                response = self.client.get(LIST_URL, HTTP_AUTHORIZATION=value)
                self.assertEqual(response.status_code, 401)


class ValidCredentialTests(_Base):
    def test_reads_only_the_tokens_own_rows(self):
        self.assert_lists_only_own(self.client.get(LIST_URL, **auth_headers(OWNER)))

    def test_header_and_query_cannot_change_who_the_token_is(self):
        response = self.client.get(
            f"{LIST_URL}?user_email={VICTIM}", HTTP_X_USER_EMAIL=VICTIM, **auth_headers(OWNER)
        )
        self.assert_lists_only_own(response)

    def test_token_inside_the_clock_leeway_still_works(self):
        self.assert_lists_only_own(self.client.get(LIST_URL, **auth_headers(OWNER, ttl=-5)))

    def test_email_is_used_exactly_as_signed(self):
        mixed_case = "Mixed.Case@Example.com"
        ChatSession.objects.create(id="mixed", user_email=mixed_case, title="Mixed", messages=[])
        response = self.client.get(LIST_URL, **auth_headers(mixed_case))
        self.assertEqual([row["id"] for row in response.json()], ["mixed"])


class PublicPathTests(TestCase):
    def test_health_needs_no_credential(self):
        self.assertEqual(self.client.get("/health/").status_code, 200)

    def test_admin_login_keeps_its_own_auth(self):
        self.assertEqual(self.client.get("/admin/login/").status_code, 200)

    def test_script_name_cannot_borrow_a_public_prefix(self):
        # Django routes on path_info, but request.path includes SCRIPT_NAME.
        for prefix in ("/admin", "/health", "/static"):
            with self.subTest(prefix=prefix):
                response = self.client.get(LIST_URL, SCRIPT_NAME=prefix)
                self.assertEqual(response.status_code, 401)


class NoHtmlFormsTests(TestCase):
    """DRF's HTML forms list every row a foreign key can point at."""

    def setUp(self):
        LearningGoal.objects.create(user_email=VICTIM, original_text="secret goal text")

    def assert_no_leak(self, response):
        body = response.content.decode()
        self.assertNotIn(VICTIM, body)
        self.assertNotIn("secret goal text", body)

    def test_format_override_finds_no_html_renderer(self):
        response = self.client.get("/api/curriculum/chats/?format=api", **auth_headers(OWNER))
        self.assertEqual(response.status_code, 404)
        self.assert_no_leak(response)

    def test_asking_for_html_gets_no_form(self):
        response = self.client.get(
            "/api/curriculum/chats/", HTTP_ACCEPT="text/html", **auth_headers(OWNER)
        )
        self.assertNotIn("text/html", response.headers.get("Content-Type", ""))
        self.assert_no_leak(response)

    def test_a_browser_opening_the_url_gets_json(self):
        response = self.client.get(
            "/api/curriculum/chats/",
            HTTP_ACCEPT="text/html,application/xhtml+xml,*/*;q=0.8",
            **auth_headers(OWNER),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])


class StartupCheckTests(TestCase):
    @override_settings(API_JWT_SECRET="")
    def test_no_secret_refuses_to_start(self):
        with self.assertRaises(ImproperlyConfigured):
            UserEmailMiddleware(lambda request: None)

    @override_settings(API_JWT_SECRET="too-short")
    def test_short_secret_refuses_to_start(self):
        with self.assertRaises(ImproperlyConfigured):
            UserEmailMiddleware(lambda request: None)


class CorsTests(TestCase):
    APP_ORIGIN = "https://app.timely-plan.study"

    def _allowed(self, response):
        return response.headers.get("Access-Control-Allow-Origin")

    def test_foreign_origin_gets_no_cors_header(self):
        response = self.client.get(LIST_URL, HTTP_ORIGIN="https://evil.example.com")
        self.assertIsNone(self._allowed(response))

    def test_app_origin_is_allowed_and_can_read_the_401(self):
        response = self.client.get(LIST_URL, HTTP_ORIGIN=self.APP_ORIGIN)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self._allowed(response), self.APP_ORIGIN)

    def test_preflight_allows_the_token_header_without_a_credential(self):
        response = self.client.options(
            LIST_URL,
            HTTP_ORIGIN=self.APP_ORIGIN,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._allowed(response), self.APP_ORIGIN)
        self.assertIn("authorization", response.headers["Access-Control-Allow-Headers"])

    def test_preflight_still_allows_the_old_header_during_the_rollout(self):
        response = self.client.options(
            LIST_URL,
            HTTP_ORIGIN=self.APP_ORIGIN,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-user-email",
        )
        self.assertIn("x-user-email", response.headers["Access-Control-Allow-Headers"])

    def test_preflight_from_a_foreign_origin_is_not_allowed(self):
        response = self.client.options(
            LIST_URL,
            HTTP_ORIGIN="https://evil.example.com",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
        )
        self.assertIsNone(self._allowed(response))
