import base64
import cv2
import numpy as np
import logging
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .glm_client import (
    VISION_API_BASE_URL,
    VISION_API_KEY,
    VISION_MODEL_NAME,
    VISION_TIMEOUT,
    glm_chat_image,
)

logger = logging.getLogger(__name__)

# Модель универсальная, а не выделенная OCR: без явного запрета она охотно
# отвечает «На доске изображена формула...» вместо самой формулы. Поэтому
# требование транскрипции и запрет комментария вынесены в system prompt.
OCR_SYSTEM_PROMPT = (
    "You are an OCR engine, not an assistant. You transcribe images verbatim.\n"
    "Rules:\n"
    "1. Output ONLY the text visible in the image, character for character.\n"
    "2. Preserve line breaks and the natural reading order.\n"
    "3. Write mathematical expressions as LaTeX.\n"
    "4. Never describe, explain, summarise or comment on the image.\n"
    "5. Never add a preamble, heading, apology or closing remark.\n"
    "6. Never wrap the result in markdown code fences.\n"
    "7. If the image contains no text at all, return an empty response."
)

OCR_USER_PROMPT = "Transcribe this whiteboard image."


def preprocess_and_encode(base64_str: str, *, binarize: bool | None = None) -> str:
    """Очищает изображение с доски и возвращает base64 PNG для отправки в Vision API.

    `binarize` включает порог Оцу — наследие выделенной OCR-модели. По умолчанию
    берётся settings.VISION_OCR_BINARIZE, который выключен: универсальной VLM
    полутона обычно не мешают, а порог съедает слабый штрих.
    """
    if binarize is None:
        binarize = bool(getattr(settings, "VISION_OCR_BINARIZE", False))

    img_bytes = base64.b64decode(base64_str)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED)

    if img is None:
        raise ValueError("Failed to decode image: not a supported image format")

    # Альфа-канал → белый фон
    if len(img.shape) == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3]
        rgb = img[:, :, :3]
        white = np.ones_like(rgb, dtype=np.uint8) * 255
        factor = alpha[:, :, np.newaxis] / 255.0
        img = (rgb * factor + white * (1 - factor)).astype(np.uint8)
    elif len(img.shape) == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    if binarize:
        _, gray = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        # Инверсия если фон темный
        if np.mean(gray) < 127:
            gray = cv2.bitwise_not(gray)

    # Padding
    padded = cv2.copyMakeBorder(gray, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])

    # Обратно в BGR для imencode, потом в base64
    bgr = cv2.cvtColor(padded, cv2.COLOR_GRAY2BGR)
    ok, buf = cv2.imencode('.png', bgr)
    if not ok:
        raise ValueError("Failed to encode processed image to PNG")
    return base64.b64encode(buf).decode('utf-8')


class OCRView(APIView):
    def post(self, request):
        try:
            data = request.data
            image_data = data.get('image')

            if not image_data:
                logger.error("No image provided in request")
                return Response({'error': 'No image provided'}, status=status.HTTP_400_BAD_REQUEST)

            # Ключ по умолчанию пустой (см. VISION_API_KEY в settings). Без этой
            # проверки провайдер ответит невнятным 401, а пользователь увидит его
            # как «Vision API error».
            if not VISION_API_KEY:
                logger.error("Vision API key is not configured")
                return Response(
                    {'error': 'Vision API не настроен: задайте OPENROUTER_API_KEY или VISION_API_KEY.'},
                    status=status.HTTP_502_BAD_GATEWAY
                )

            if 'base64,' in image_data:
                image_data = image_data.split('base64,')[1]

            # Препроцессинг
            try:
                processed_b64 = preprocess_and_encode(image_data)
            except Exception as e:
                logger.error(f"Image preprocessing failed: {e}", exc_info=True)
                return Response({'error': f"Image preprocessing failed: {e}"}, status=status.HTTP_400_BAD_REQUEST)

            # Запрос к VLM (по умолчанию Qwen3-VL через OpenRouter), OpenAI-совместимый API
            try:
                logger.info(f"Sending Vision OCR request to {VISION_API_BASE_URL} (model: {VISION_MODEL_NAME})")
                extracted_text = glm_chat_image(
                    image_base64=processed_b64,
                    system_prompt=OCR_SYSTEM_PROMPT,
                    user_prompt=OCR_USER_PROMPT,
                    model=VISION_MODEL_NAME,
                    # Страница конспекта в LaTeX заметно длиннее прежних 500 токенов:
                    # на них транскрипция обрывалась на середине.
                    max_tokens=2000,
                    timeout=VISION_TIMEOUT,
                )

            except Exception as e:
                error_msg = str(e)
                logger.error(f"Vision API error: {error_msg}", exc_info=True)

                if "Connection" in error_msg or "connect" in error_msg.lower():
                    return Response(
                        {
                            'error': (
                                f'Не удалось подключиться к vision-провайдеру {VISION_API_BASE_URL}. '
                                'Проверьте VISION_API_BASE_URL и доступность сети из backend.'
                            )
                        },
                        status=status.HTTP_502_BAD_GATEWAY
                    )
                if "timed out" in error_msg.lower() or "timeout" in error_msg.lower():
                    return Response(
                        {'error': f'Vision-модель не ответила за {VISION_TIMEOUT} секунд (timeout).'},
                        status=status.HTTP_504_GATEWAY_TIMEOUT
                    )
                return Response(
                    {'error': f'Vision API error: {error_msg}'},
                    status=status.HTTP_502_BAD_GATEWAY
                )

            return Response({
                'text': extracted_text,
                'raw_results': [{'engine': VISION_MODEL_NAME, 'text': extracted_text}]
            })

        except Exception as e:
            logger.error(f"Unexpected OCR Error: {str(e)}", exc_info=True)
            import traceback
            return Response({'error': str(e), 'traceback': traceback.format_exc()}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
