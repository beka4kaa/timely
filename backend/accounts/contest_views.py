"""Адреса контестов: что видит ученик и что делает админ."""

from __future__ import annotations

from rest_framework import status, viewsets
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .contest_files import PdfRejected, pdf_response, read_pdf
from .models import ContestFile
from .views import current_user, is_admin_or_mod


def refusal(code: str, message: str, http_status: int, **extra) -> Response:
    return Response({"error": message, "code": code, **extra}, status=http_status)


def forbidden() -> Response:
    return refusal("forbidden", "Это только для админов.", status.HTTP_403_FORBIDDEN)


def file_info(file: ContestFile | None) -> dict | None:
    if file is None:
        return None
    return {"id": file.pk, "name": file.name, "size": file.size, "pages": file.pages}


class AdminContestFileViewSet(viewsets.ViewSet):
    """POST /api/admin/contest-files/ — загрузить PDF; GET …/{id}/ — скачать его."""

    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def create(self, request):
        actor = current_user(request)
        if not is_admin_or_mod(actor):
            return forbidden()
        try:
            info = read_pdf(request.FILES.get("file"))
        except PdfRejected as rejected:
            return refusal(rejected.code, rejected.message, status.HTTP_400_BAD_REQUEST)
        stored = ContestFile.objects.create(
            data=info.data,
            name=info.name,
            size=info.size,
            pages=info.pages,
            sha256=info.sha256,
            text=info.text,
            uploaded_by=actor,
        )
        return Response(file_info(stored), status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        if not is_admin_or_mod(current_user(request)):
            return forbidden()
        stored = ContestFile.objects.filter(pk=pk).first() if str(pk).isdigit() else None
        if stored is None:
            return refusal("not_found", "Файла нет.", status.HTTP_404_NOT_FOUND)
        return pdf_response(stored, f"fajl-{stored.pk}.pdf")
