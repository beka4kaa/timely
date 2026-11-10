from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from accounts.models import Contest, CustomUser
from demo.identity import DEMO_DOMAIN
from demo.world import ensure_world


class Command(BaseCommand):
    help = "Строит или сдвигает на сегодня общий мир демо: учитель, класс, контесты."

    def handle(self, *args, **options):
        # Без флага это была бы база настоящих учеников: выдуманный класс туда нельзя.
        if not settings.DEMO_MODE:
            raise CommandError("DEMO_MODE выключен: это не база демо.")
        changed = ensure_world(timezone.now())
        people = CustomUser.objects.filter(email__endswith=f"@{DEMO_DOMAIN}").exclude(email__startswith="visitor-")
        self.stdout.write(
            f"{'Мир обновлён' if changed else 'Мир уже на сегодня'}: "
            f"{people.count()} человек, {Contest.objects.count()} контеста."
        )
