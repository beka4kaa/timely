from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from demo.prune import prune_visitors


class Command(BaseCommand):
    help = "Удаляет посетителей демо старше DEMO_VISITOR_TTL_DAYS со всеми их данными."

    def handle(self, *args, **options):
        if not settings.DEMO_MODE:
            raise CommandError("DEMO_MODE выключен: это не база демо.")
        removed = prune_visitors(timezone.now())
        self.stdout.write(f"Удалено посетителей: {removed}.")
