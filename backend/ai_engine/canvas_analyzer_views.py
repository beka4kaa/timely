import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .canvas_analyzer import AnalyzerValidationError, analyze_canvas_with_glm
from .ocr_views import preprocess_and_encode
from .vector_renderer import VectorRenderer, svg_to_png_data_url

logger = logging.getLogger(__name__)


class CanvasAnalyzerView(APIView):
    """
    Smart Canvas Analyzer endpoint.

    Contract:
      canvas screenshot -> existing GLM backend -> strict JSON validation ->
      deterministic diagram SVG/PNG fallback rendering.
    """

    def post(self, request):
        image_data = request.data.get("image") or request.data.get("screenshot") or request.data.get("canvas")
        if not image_data:
            return Response(
                {"error": {"code": "NO_IMAGE", "message": "No canvas image provided."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if "base64," in image_data:
            image_data = image_data.split("base64,", 1)[1]

        try:
            processed_b64 = preprocess_and_encode(image_data)
        except Exception as exc:  # noqa: BLE001
            logger.error("[CanvasAnalyzer] image preprocessing failed: %s", exc, exc_info=True)
            return Response(
                {"error": {"code": "IMAGE_PREPROCESS_FAILED", "message": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            analyzer_data, repaired, _raw = analyze_canvas_with_glm(processed_b64)
        except AnalyzerValidationError as exc:
            logger.warning("[CanvasAnalyzer] GLM JSON validation failed: %s", exc.errors)
            return Response(
                {
                    "error": {
                        "code": "GLM_VALIDATION_FAILED",
                        "message": "GLM returned invalid analyzer JSON.",
                        "details": exc.errors,
                    }
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("[CanvasAnalyzer] GLM call failed: %s", exc, exc_info=True)
            return Response(
                {
                    "error": {
                        "code": "GLM_ANALYZER_FAILED",
                        "message": str(exc),
                    }
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        rendered_diagrams = render_diagrams(analyzer_data.get("diagrams") or [])
        return Response(
            {
                "recognized_topics": analyzer_data["recognized_topics"],
                "lessons": analyzer_data["lessons"],
                "canvas_storyboard": analyzer_data["canvas_storyboard"],
                "render_requests": analyzer_data["render_requests"],
                "rendered_diagrams": rendered_diagrams,
                "meta": {
                    "schema_version": analyzer_data["schema_version"],
                    "language": analyzer_data["language"],
                    "glm_json_repaired": repaired,
                    "flux_called": False,
                },
            }
        )


def render_diagrams(diagrams: list[dict]) -> list[dict]:
    rendered: list[dict] = []
    renderer = VectorRenderer()
    for diagram in diagrams:
        diagram_id = diagram.get("id")
        try:
            svg = renderer.render(diagram["vector_layout"])
            png_url = svg_to_png_data_url(svg)
            rendered.append(
                {
                    "diagram_id": diagram_id,
                    "title": diagram.get("title", ""),
                    "svg": svg,
                    "png_url": png_url,
                    "flux_url": None,
                    "source_of_truth": "svg",
                    "render_status": "svg_only",
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[CanvasAnalyzer] diagram render failed for %s: %s", diagram_id, exc)
            rendered.append(
                {
                    "diagram_id": diagram_id,
                    "title": diagram.get("title", ""),
                    "svg": None,
                    "png_url": None,
                    "flux_url": None,
                    "source_of_truth": "vector_layout",
                    "render_status": "render_failed",
                    "error": str(exc),
                }
            )
    return rendered
