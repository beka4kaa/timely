from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from .models import Goal, GoalLink
from .serializers import GoalSerializer, GoalLinkSerializer


class GoalViewSet(viewsets.ModelViewSet):
    """
    Full CRUD for goals. Supports:
      - filtering by year / month / status / type
      - dependency graph queries
      - bulk sync from frontend Zustand store
    """
    serializer_class = GoalSerializer

    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        qs = Goal.objects.select_related('parent').prefetch_related('children')
        if not user_email:
            return qs.none()
        qs = qs.filter(user_email=user_email)

        # Optional filters
        year   = self.request.query_params.get('year')
        month  = self.request.query_params.get('month')
        status = self.request.query_params.get('status')
        gtype  = self.request.query_params.get('type')

        if year:
            qs = qs.filter(year=year)
        if month:
            qs = qs.filter(month=month)
        if status:
            qs = qs.filter(status=status)
        if gtype:
            qs = qs.filter(type=gtype)

        return qs.order_by('parent_id', 'order_index', '-created_at')

    def perform_create(self, serializer):
        user_email = getattr(self.request, 'user_email', None)
        serializer.save(user_email=user_email)

    # ── Dependency queries ────────────────────────────────────

    @action(detail=True, methods=['get'])
    def dependencies(self, request, pk=None):
        """All goals this goal depends on (direct + transitive)."""
        goal = self.get_object()
        visited, queue = set(), [goal]
        while queue:
            current = queue.pop()
            deps = Goal.objects.filter(
                incoming_links__source=current,
                incoming_links__type='depends_on',
            )
            for dep in deps:
                if dep.id not in visited:
                    visited.add(dep.id)
                    queue.append(dep)
        result = Goal.objects.filter(id__in=visited)
        return Response(GoalSerializer(result, many=True).data)

    @action(detail=True, methods=['get'])
    def blockers(self, request, pk=None):
        """Active goals that currently block this goal."""
        goal = self.get_object()
        return Response(GoalSerializer(goal.get_blockers(), many=True).data)

    @action(detail=True, methods=['get'])
    def subtree(self, request, pk=None):
        """This goal + all descendants."""
        goal = self.get_object()
        ids, queue = [], [goal]
        while queue:
            current = queue.pop()
            ids.append(current.id)
            queue.extend(current.children.all())
        result = Goal.objects.filter(id__in=ids)
        return Response(GoalSerializer(result, many=True).data)

    # ── Progress update ───────────────────────────────────────

    @action(detail=True, methods=['patch'])
    def progress(self, request, pk=None):
        """PATCH /api/goals/{id}/progress/ — set manual progress."""
        goal = self.get_object()
        value = request.data.get('progress')
        if value is None or not (0 <= int(value) <= 100):
            return Response({'error': 'progress must be 0–100'}, status=status.HTTP_400_BAD_REQUEST)
        goal.progress = int(value)
        if int(value) == 100:
            goal.status = 'done'
        goal.save()
        return Response(GoalSerializer(goal).data)

    # ── Bulk sync from frontend ───────────────────────────────

    @action(detail=False, methods=['post'])
    def bulk_sync(self, request):
        """
        POST /api/goals/bulk_sync/
        Body: { goals: GoalNode[], links: GoalLink[] }

        Upserts all goals and links for the current user.
        Goals not present in the payload are marked archived (soft delete).
        """
        user_email = getattr(request, 'user_email', None)
        if not user_email:
            return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

        goals_data = request.data.get('goals', [])
        links_data = request.data.get('links', [])

        with transaction.atomic():
            incoming_ids = set()

            # Upsert goals (without parent first to avoid FK issues)
            for g in goals_data:
                goal_id = g.get('id')
                incoming_ids.add(goal_id)
                Goal.objects.update_or_create(
                    id=goal_id,
                    defaults={
                        'user_email':     user_email,
                        'title':          g.get('title', ''),
                        'description':    g.get('description', ''),
                        'type':           g.get('type', 'task'),
                        'status':         g.get('status', 'not_started'),
                        'priority':       g.get('priority'),
                        'planning_scale': g.get('planningScale'),
                        'parent_id':      g.get('parentId'),
                        'year':           g.get('year'),
                        'month':          g.get('month'),
                        'start_date':     g.get('startDate') or None,
                        'end_date':       g.get('endDate') or None,
                        'due_date':       g.get('dueDate') or None,
                        'progress':       g.get('progress', 0),
                        'order_index':    g.get('order', 0),
                        'target_amount':  g.get('targetAmount'),
                        'current_amount': g.get('currentAmount'),
                        'currency':       g.get('currency', 'USD'),
                    },
                )

            # Soft-delete goals not in payload
            Goal.objects.filter(user_email=user_email).exclude(id__in=incoming_ids).update(status='archived')

            # Replace all links for this user
            existing_goal_ids = set(Goal.objects.filter(user_email=user_email).values_list('id', flat=True))
            GoalLink.objects.filter(source__user_email=user_email).delete()
            for lnk in links_data:
                src, tgt = lnk.get('source'), lnk.get('target')
                if src in existing_goal_ids and tgt in existing_goal_ids:
                    GoalLink.objects.get_or_create(
                        id=lnk.get('id', str(__import__('uuid').uuid4())),
                        defaults={
                            'source_id': src,
                            'target_id': tgt,
                            'type':      lnk.get('type', 'related_to'),
                            'strength':  lnk.get('strength', 1),
                        },
                    )

        goals_qs = Goal.objects.filter(user_email=user_email).exclude(status='archived').order_by('parent_id', 'order_index', '-created_at')
        links_qs = GoalLink.objects.filter(source__user_email=user_email)
        return Response({
            'goals': GoalSerializer(goals_qs, many=True).data,
            'links': GoalLinkSerializer(links_qs, many=True).data,
        })


class GoalLinkViewSet(viewsets.ModelViewSet):
    serializer_class = GoalLinkSerializer

    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        qs = GoalLink.objects.select_related('source', 'target')
        if not user_email:
            return qs.none()
        qs = qs.filter(source__user_email=user_email)
        ltype = self.request.query_params.get('type')
        if ltype:
            qs = qs.filter(type=ltype)
        return qs

    def perform_create(self, serializer):
        serializer.save()
