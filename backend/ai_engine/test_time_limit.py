"""Предел часа воркера внутри чужих исключений.

Мягкий предел Celery бросается там, где сейчас стоит главный поток. Внутри SDK
модели он приходит обёрнутым: `APIConnectionError` с пределом в `__cause__`.
"""

from django.test import SimpleTestCase

from celery.exceptions import SoftTimeLimitExceeded

from .time_limit import hit_time_limit


def _wrapped(error: BaseException, *, cause=None, context=None) -> BaseException:
    error.__cause__ = cause
    error.__context__ = context
    return error


class HitTimeLimitTests(SimpleTestCase):
    def test_the_limit_itself(self) -> None:
        self.assertTrue(hit_time_limit(SoftTimeLimitExceeded()))

    def test_a_limit_wrapped_by_a_library(self) -> None:
        # Так SDK `openai` отдаёт любое исключение запроса.
        error = _wrapped(
            ConnectionError("Connection error."), cause=SoftTimeLimitExceeded()
        )
        self.assertTrue(hit_time_limit(error))

    def test_a_limit_raised_while_handling(self) -> None:
        error = _wrapped(
            RuntimeError("cleanup failed"), context=SoftTimeLimitExceeded()
        )
        self.assertTrue(hit_time_limit(error))

    def test_a_limit_deep_in_the_chain(self) -> None:
        inner = _wrapped(OSError("socket"), cause=SoftTimeLimitExceeded())
        middle = _wrapped(ValueError("parse"), context=inner)
        outer = _wrapped(RuntimeError("provider"), cause=middle)
        self.assertTrue(hit_time_limit(outer))

    def test_an_ordinary_failure(self) -> None:
        error = _wrapped(ConnectionError("Connection error."), cause=OSError("reset"))
        self.assertFalse(hit_time_limit(error))
        self.assertFalse(hit_time_limit(None))

    def test_a_cyclic_chain_ends(self) -> None:
        first = RuntimeError("first")
        second = _wrapped(ValueError("second"), cause=first)
        first.__context__ = second
        self.assertFalse(hit_time_limit(first))
