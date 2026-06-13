import base64
import cv2
import numpy as np
import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .glm_client import VISION_API_BASE_URL, VISION_MODEL_NAME, glm_chat_image

logger = logging.getLogger(__name__)

def preprocess_and_encode(base64_str: str) -> str:
    """Очищает изображение с доски и возвращает base64 PNG для отправки в Vision API."""
    img_bytes = base64.b64decode(base64_str)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED)

    # Альфа-канал → белый фон
    if img is not None and len(img.shape) == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3]
        rgb = img[:, :, :3]
        white = np.ones_like(rgb, dtype=np.uint8) * 255
        factor = alpha[:, :, np.newaxis] / 255.0
        img = (rgb * factor + white * (1 - factor)).astype(np.uint8)
    elif img is not None and len(img.shape) == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

    # Grayscale + бинаризация Оцу
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Инверсия если фон темный
    if np.mean(thresh) < 127:
        thresh = cv2.bitwise_not(thresh)

    # Padding
    padded = cv2.copyMakeBorder(thresh, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])

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

            if 'base64,' in image_data:
                image_data = image_data.split('base64,')[1]

            # Препроцессинг
            try:
                processed_b64 = preprocess_and_encode(image_data)
            except Exception as e:
                logger.error(f"Image preprocessing failed: {e}", exc_info=True)
                return Response({'error': f"Image preprocessing failed: {e}"}, status=status.HTTP_400_BAD_REQUEST)

            # Запрос к VLM (GLM-OCR на Mac Studio, :8081) через OpenAI-совместимый API
            try:
                logger.info(f"Sending Vision OCR request to {VISION_API_BASE_URL} (model: {VISION_MODEL_NAME})")
                extracted_text = glm_chat_image(
                    image_base64=processed_b64,
                    user_prompt=(
                        "Extract all text and math formulas from this whiteboard image. "
                        "Return only the extracted text, nothing else."
                    ),
                    model=VISION_MODEL_NAME,
                    max_tokens=500,
                    timeout=30,
                )

            except Exception as e:
                error_msg = str(e)
                logger.error(f"Vision API error: {error_msg}", exc_info=True)

                if "Connection" in error_msg or "connect" in error_msg.lower():
                    return Response(
                        {'error': f'Не удалось подключиться к серверу {VISION_API_BASE_URL}. Убедитесь, что Mac Studio работает.'},
                        status=status.HTTP_502_BAD_GATEWAY
                    )
                if "timed out" in error_msg.lower() or "timeout" in error_msg.lower():
                    return Response(
                        {'error': 'Сервер не ответил за 30 секунд (timeout).'},
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
