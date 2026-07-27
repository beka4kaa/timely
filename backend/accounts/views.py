from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.contrib.auth import authenticate
from django.db.models import Count, Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from .models import CustomUser, Task, TaskSubmission, Contest, PrivateLeaderboard
from .serializers import (
    RegisterSerializer, LoginSerializer, UserSerializer, LeaderboardSerializer,
    TaskSerializer, TaskSubmissionSerializer, ContestSerializer,
    PrivateLeaderboardSerializer, MeSerializer, AdminUserSerializer,
)


# ── Auth helpers (X-User-Email middleware sets request.user_email) ──────────
def current_user(request):
    """Resolve the CustomUser from the X-User-Email header (or ?user_email=)."""
    email = getattr(request, 'user_email', None)
    if not email:
        return None
    return CustomUser.objects.filter(email=email).first()


def is_admin_or_mod(user):
    return bool(user and (user.is_staff or user.is_superuser or user.is_moderator))


def has_full_access(user):
    return bool(user and (user.has_full_access or is_admin_or_mod(user)))


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            user_data = UserSerializer(user).data
            return Response({
                'message': 'User registered successfully',
                'user': user_data
            }, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        password = serializer.validated_data['password']

        # Find user by email
        try:
            user = CustomUser.objects.get(email=email)
        except CustomUser.DoesNotExist:
            return Response({
                'error': 'Invalid email or password'
            }, status=status.HTTP_401_UNAUTHORIZED)

        # Authenticate with username (since Django uses username for auth)
        user = authenticate(username=user.username, password=password)
        
        if user is not None:
            user_data = UserSerializer(user).data
            return Response({
                'message': 'Login successful',
                'user': user_data
            }, status=status.HTTP_200_OK)
        else:
            return Response({
                'error': 'Invalid email or password'
            }, status=status.HTTP_401_UNAUTHORIZED)


class LeaderboardViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/leaderboard/          — глобальный лидерборд (по overall_elo)
    GET /api/leaderboard/?country_code=KZ  — фильтр по стране
    GET /api/leaderboard/?city=Almaty       — фильтр по городу
    GET /api/leaderboard/?discipline_name=Math — топ по конкретной дисциплине
    """
    serializer_class = LeaderboardSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['country_code', 'city']

    def get_queryset(self):
        queryset = CustomUser.objects.prefetch_related(
            'ratings__discipline'  # N+1 protection: related_name='ratings' in UserRating model
        )

        discipline_name = self.request.query_params.get('discipline_name')

        if discipline_name:
            # Фильтруем только пользователей, у которых есть рейтинг в указанной дисциплине,
            # и сортируем по elo_score именно этой дисциплины (не overall_elo)
            queryset = (
                queryset
                .filter(ratings__discipline__name__iexact=discipline_name)
                .order_by('-ratings__elo_score')
                .distinct()
            )
        else:
            # Глобальный лидерборд — сортировка по общему ELO
            queryset = queryset.order_by('-overall_elo')

        return queryset

class MeView(APIView):
    """GET /api/me/ — current user + role flags (for frontend admin gating)."""
    permission_classes = [AllowAny]

    def get(self, request):
        user = current_user(request)
        if not user:
            return Response({'authenticated': False}, status=status.HTTP_200_OK)
        return Response(MeSerializer(user).data, status=status.HTTP_200_OK)


class UserSearchView(APIView):
    """GET /api/users/search/?q= — find players by name, username, email, or numeric id."""
    permission_classes = [AllowAny]

    def get(self, request):
        q = (request.query_params.get('q') or '').strip()
        if not q:
            return Response([])
        qs = CustomUser.objects.filter(
            Q(username__icontains=q) | Q(email__icontains=q)
            | Q(first_name__icontains=q) | Q(last_name__icontains=q)
        )
        if q.isdigit():
            qs = qs | CustomUser.objects.filter(pk=int(q))
        qs = qs.distinct().order_by('-overall_elo')[:20]
        data = [{
            'id': u.id,
            'name': f"{u.first_name} {u.last_name}".strip() or u.username,
            'username': u.username,
            'email': u.email,
            'overall_elo': u.overall_elo,
        } for u in qs]
        return Response(data)


def _request_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {'1', 'true', 'yes', 'on'}
    return bool(value)


class AdminUserViewSet(viewsets.ReadOnlyModelViewSet):
    """Admin-only account list with rating and access flags."""
    serializer_class = AdminUserSerializer
    permission_classes = [AllowAny]

    def _actor(self):
        return current_user(self.request)

    def _forbidden(self):
        return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

    def _base_queryset(self):
        return (
            CustomUser.objects
            .annotate(
                submissions_total=Count('submissions'),
                submissions_approved=Count('submissions', filter=Q(submissions__status='approved')),
                submissions_pending=Count('submissions', filter=Q(submissions__status='pending')),
                submissions_rejected=Count('submissions', filter=Q(submissions__status='rejected')),
            )
            .order_by('-overall_elo', 'email')
        )

    def get_queryset(self):
        actor = self._actor()
        if not is_admin_or_mod(actor):
            return CustomUser.objects.none()
        qs = self._base_queryset()
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(email__icontains=q)
                | Q(username__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
            )
        return qs

    def list(self, request, *args, **kwargs):
        if not is_admin_or_mod(self._actor()):
            return self._forbidden()
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        if not is_admin_or_mod(self._actor()):
            return self._forbidden()
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=['patch'], url_path='access')
    def access(self, request, pk=None):
        actor = self._actor()
        if not is_admin_or_mod(actor):
            return self._forbidden()

        target = self.get_object()
        allowed_fields = ['has_full_access', 'is_moderator']
        if actor.is_staff or actor.is_superuser:
            allowed_fields.extend(['is_staff', 'ai_plan'])

        changed = []
        for field in allowed_fields:
            if field in request.data:
                if field == 'ai_plan':
                    requested_plan = str(request.data[field]).strip().lower()
                    valid_plans = {choice[0] for choice in CustomUser.AI_PLAN_CHOICES}
                    if requested_plan not in valid_plans:
                        return Response(
                            {'error': 'Unknown AI plan.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    setattr(target, field, requested_plan)
                else:
                    setattr(target, field, _request_bool(request.data[field]))
                changed.append(field)

        if changed:
            target.save(update_fields=changed)

        refreshed = self._base_queryset().get(pk=target.pk)
        return Response(AdminUserSerializer(refreshed).data, status=status.HTTP_200_OK)


class TaskViewSet(viewsets.ModelViewSet):
    """Tasks/problems. Admins & moderators see all; everyone else sees active ones."""
    serializer_class = TaskSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        user = current_user(self.request)
        if is_admin_or_mod(user):
            return Task.objects.all().order_by('-created_at', '-id')
        return Task.objects.filter(status='active').order_by('-created_at', '-id')

    def perform_create(self, serializer):
        user = current_user(self.request)
        # Admin/mod-authored tasks go straight to active; peer-authored stay pending.
        new_status = 'active' if is_admin_or_mod(user) else 'pending'
        serializer.save(author=user, status=new_status)


class ContestViewSet(viewsets.ModelViewSet):
    """Contests bundle tasks. Anyone can read; only admins/mods can write."""
    serializer_class = ContestSerializer
    queryset = Contest.objects.all().prefetch_related('tasks')

    def _require_admin(self):
        user = current_user(self.request)
        return is_admin_or_mod(user), user

    def create(self, request, *args, **kwargs):
        ok, _ = self._require_admin()
        if not ok:
            return Response({'error': 'Only admins or moderators can create contests.'}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        ok, _ = self._require_admin()
        if not ok:
            return Response({'error': 'Only admins or moderators can edit contests.'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        ok, _ = self._require_admin()
        if not ok:
            return Response({'error': 'Only admins or moderators can delete contests.'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(created_by=current_user(self.request))


class TaskSubmissionViewSet(viewsets.ModelViewSet):
    """Submissions. Users manage their own; admins/mods see all + can approve/reject."""
    serializer_class = TaskSubmissionSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        user = current_user(self.request)
        qs = TaskSubmission.objects.select_related('student', 'task').order_by('-created_at')
        if is_admin_or_mod(user):
            status_filter = self.request.query_params.get('status')
            return qs.filter(status=status_filter) if status_filter else qs
        if not user:
            return qs.none()
        return qs.filter(student=user)

    def perform_create(self, serializer):
        serializer.save(student=current_user(self.request), status='pending')

    @action(detail=False, methods=['get'])
    def pending(self, request):
        """GET /api/submissions/pending/ — review queue (admins/mods only)."""
        if not is_admin_or_mod(current_user(request)):
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
        qs = TaskSubmission.objects.select_related('student', 'task').filter(status='pending').order_by('created_at')
        return Response(TaskSubmissionSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """POST /api/submissions/{id}/approve/ — approve + award task points once."""
        reviewer = current_user(request)
        if not is_admin_or_mod(reviewer):
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
        sub = self.get_object()
        if sub.status != 'approved':
            student = sub.student
            student.overall_elo = (student.overall_elo or 0) + (sub.task.points or 0)
            student.save(update_fields=['overall_elo'])
        sub.status = 'approved'
        sub.reviewed_by = reviewer
        sub.reviewed_at = timezone.now()
        sub.save(update_fields=['status', 'reviewed_by', 'reviewed_at'])
        return Response(TaskSubmissionSerializer(sub).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """POST /api/submissions/{id}/reject/ — reject; reverse points if previously approved."""
        reviewer = current_user(request)
        if not is_admin_or_mod(reviewer):
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
        sub = self.get_object()
        if sub.status == 'approved':
            student = sub.student
            student.overall_elo = (student.overall_elo or 0) - (sub.task.points or 0)
            student.save(update_fields=['overall_elo'])
        sub.status = 'rejected'
        sub.reviewed_by = reviewer
        sub.reviewed_at = timezone.now()
        sub.save(update_fields=['status', 'reviewed_by', 'reviewed_at'])
        return Response(TaskSubmissionSerializer(sub).data)


class PrivateLeaderboardViewSet(viewsets.ModelViewSet):
    """Private leaderboards owned by a user, scoped to invited members."""
    serializer_class = PrivateLeaderboardSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        user = current_user(self.request)
        if not user:
            return PrivateLeaderboard.objects.none()
        # Boards you own or are a member of.
        return (
            PrivateLeaderboard.objects
            .filter(Q(owner=user) | Q(members=user))
            .distinct()
            .prefetch_related('members__ratings__discipline', 'owner')
        )

    def perform_create(self, serializer):
        user = current_user(self.request)
        board = serializer.save(owner=user)
        board.members.add(user)  # owner is always a member

    @action(detail=True, methods=['post'], url_path='add-member')
    def add_member(self, request, pk=None):
        """POST /api/private-leaderboards/{id}/add-member/ {identifier: email|username}"""
        board = self.get_object()
        user = current_user(request)
        if not user or board.owner_id != user.id:
            return Response({'error': 'Only the owner can add members.'}, status=status.HTTP_403_FORBIDDEN)
        uid = request.data.get('user_id')
        identifier = (request.data.get('identifier') or '').strip()
        target = None
        if uid:
            target = CustomUser.objects.filter(pk=uid).first()
        if not target and identifier:
            target = CustomUser.objects.filter(Q(email__iexact=identifier) | Q(username__iexact=identifier)).first()
            if not target and identifier.isdigit():
                target = CustomUser.objects.filter(pk=int(identifier)).first()
        if not target:
            return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        board.members.add(target)
        return Response(PrivateLeaderboardSerializer(board).data)

    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, pk=None):
        board = self.get_object()
        user = current_user(request)
        if not user or board.owner_id != user.id:
            return Response({'error': 'Only the owner can remove members.'}, status=status.HTTP_403_FORBIDDEN)
        target = CustomUser.objects.filter(pk=request.data.get('user_id')).first()
        if target and target.id != board.owner_id:
            board.members.remove(target)
        return Response(PrivateLeaderboardSerializer(board).data)
