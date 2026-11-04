"""Per-account access for the apps that predate filtering by `request.user_email`.

Rows in planner, mind and the program tables of ai_engine belong to one account,
directly (`user_email`) or through a parent row. A row with no owner belongs to
nobody: it stays in the database, and the API no longer shows it to anyone.
"""

from rest_framework import permissions


def request_email(request):
    return getattr(request, "user_email", None) or None


class HasUserEmail(permissions.BasePermission):
    def has_permission(self, request, view):
        return request_email(request) is not None


class OwnedViewSetMixin:
    """Limits a viewset to the signed-in account's rows."""

    owner_field = "user_email"
    permission_classes = [HasUserEmail]

    def get_queryset(self):
        queryset = super().get_queryset()
        email = request_email(self.request)
        if email is None:
            return queryset.none()
        return queryset.filter(**{self.owner_field: email})


class OwnedRelationsMixin:
    """Limits a serializer's writable foreign keys to the signed-in account's rows.

    `owned_relations` maps a field to the path from the related row to its owner.
    Someone else's row then looks the same as one that doesn't exist.
    """

    owned_relations = {}

    def get_fields(self):
        fields = super().get_fields()
        email = request_email(self.context.get("request"))
        for name, owner_field in self.owned_relations.items():
            field = fields.get(name)
            if field is None or field.read_only:
                continue
            field.queryset = (
                field.queryset.none()
                if email is None
                else field.queryset.filter(**{owner_field: email})
            )
        return fields
