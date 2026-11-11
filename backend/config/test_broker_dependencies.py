"""Смоук-тест закреплённых зависимостей брокера.

Тесты очереди подменяют `apply_async`, поэтому разнобой версий kombu и
redis-py они не видят: он вскрывается только в проде, до первой попытки
соединения.
"""

from django.conf import settings
from django.test import SimpleTestCase


class BrokerDependenciesTests(SimpleTestCase):
    def test_redis_transport_accepts_the_pinned_redis_driver(self):
        import kombu
        import redis
        from kombu.exceptions import OperationalError, VersionMismatch

        connection = kombu.Connection(
            "redis://127.0.0.1:1/0",
            connect_timeout=1,
            transport_options={"socket_connect_timeout": 1},
        )
        try:
            try:
                connection.default_channel
                connection.ensure_connection(max_retries=0)
            except VersionMismatch as exc:
                self.fail(
                    f"kombu {kombu.__version__} не принимает redis-py "
                    f"{redis.__version__}: {exc}"
                )
            except (OperationalError, ConnectionError, OSError):
                pass
            else:
                self.fail("Порт 1 не должен был принять соединение.")
        finally:
            connection.release()

    def test_broker_has_short_socket_timeouts(self):
        options = settings.CELERY_BROKER_TRANSPORT_OPTIONS
        self.assertLessEqual(options["socket_connect_timeout"], 5)
        # Больше секундного BRPOP воркера, иначе пустая очередь считалась бы
        # обрывом связи.
        self.assertGreater(options["socket_timeout"], 1)
        self.assertLessEqual(options["socket_timeout"], 30)
