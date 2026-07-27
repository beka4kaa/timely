"""
POST /api/ai/illustration/ — обогащение ОДНОЙ иллюстрации.

Вторая фаза прогрессивной выдачи. Первая (`/api/ai/chat` с
`defer_images=true`) отдаёт доску сразу, но команды `image_with_labels`
приходят без картинок — только с `image_prompt`. Фронтенд рисует на их месте
плейсхолдеры и дёргает этот эндпоинт по одному разу на каждую иллюстрацию,
подставляя картинки по мере готовности.

Зачем так: генерация растра занимает ~20с, грунтинг ещё ~5с, и на ответе из
четырёх иллюстраций ожидание доходило до двух минут — всё это время экран был
пустым. Общее время тут не уменьшается, но текст и структура появляются через
~18с, а картинки «доезжают» по одной.
"""

import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .chat_views import error_response
from .image_enrichment import _enrich_command
from .vector_pipeline import try_build_vector_illustration

logger = logging.getLogger(__name__)


class IllustrationView(APIView):
    """
    Body: { command: {...image_with_labels...}, topic_hint?, style?, palette?,
            reference_image_url?, skip_grounding? }
    Returns: обогащённая команда — {type, base_image_url, labels, masks} либо
             {image_prompt, image_error} при сбое генерации.
    """

    def post(self, request):
        data = request.data
        command = data.get("command")

        if not isinstance(command, dict) or command.get("type") != "image_with_labels":
            return Response(
                {"error": "Ожидается команда image_with_labels в поле command."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (command.get("image_prompt") or "").strip():
            return Response(
                {"error": "У команды пустой image_prompt — генерировать нечего."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            # Сначала детерминированный путь: для механики он даёт точную
            # геометрию, кадр без единой буквы и ТОЧНЫЕ якоря подписей (середина
            # древка каждой силы) вместо vision-грунтинга. За сюжеты вне своего
            # покрытия он не берётся и возвращает None — тогда работает растр.
            # Рестайл сюда не пускаем: там смысл именно в перерисовке пикселей
            # существующей картинки, а не в генерации схемы с нуля.
            if not data.get("reference_image_url"):
                vector_result = try_build_vector_illustration(
                    command.get("image_prompt") or "",
                    seed_labels=command.get("labels") or None,
                    topic_hint=data.get("topic_hint") or "",
                    style=data.get("style"),
                    palette=data.get("palette"),
                )
                if vector_result:
                    return Response({"command": {**command, **vector_result}})

            # _enrich_command не бросает исключений на сбое генерации: он вернёт
            # команду с `image_error`, и фронтенд покажет текст ошибки вместо
            # картинки. Сюда попадают только неожиданные падения.
            enriched = _enrich_command(
                command,
                topic_hint=data.get("topic_hint") or "",
                style=data.get("style"),
                palette=data.get("palette"),
                reference_image_url=data.get("reference_image_url") or None,
                skip_grounding=bool(data.get("skip_grounding")),
            )
            return Response({"command": enriched})
        except Exception as exc:  # noqa: BLE001 — маппим на HTTP
            logger.error("Illustration enrichment error: %s", exc, exc_info=True)
            return error_response(exc)
