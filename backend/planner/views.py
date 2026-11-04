from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils.dateparse import parse_date
from django.utils import timezone
from config.ownership import OwnedViewSetMixin, request_email
from .models import DayPlan, Block, Segment, Subtask, TimerState, ScheduleSlot
from .serializers import DayPlanSerializer, BlockSerializer, SegmentSerializer, SubtaskSerializer, TimerStateSerializer, ScheduleSlotSerializer

class DayPlanViewSet(OwnedViewSetMixin, viewsets.ModelViewSet):
    queryset = DayPlan.objects.all()
    serializer_class = DayPlanSerializer
    lookup_field = 'date'
    
    def get_queryset(self):
        return super().get_queryset().prefetch_related('blocks').order_by('-date')
    
    def create(self, request, *args, **kwargs):
        # One plan per account and day: asking again returns the same plan.
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan, created = DayPlan.objects.get_or_create(
            user_email=request_email(request),
            date=serializer.validated_data['date'],
        )
        return Response(
            self.get_serializer(plan).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=['post'])
    def copy(self, request, date=None):
        """Copy blocks from another day to this day"""
        source_date_str = request.data.get('from_date')
        if not source_date_str:
            return Response({'error': 'from_date is required'}, status=status.HTTP_400_BAD_REQUEST)

        # If target day doesn't exist, create it
        target_plan, _ = DayPlan.objects.get_or_create(
            user_email=request_email(request), date=date
        )

        source_plan = self.get_queryset().filter(date=source_date_str).first()
        if not source_plan:
             return Response({'error': 'Source day plan not found'}, status=status.HTTP_404_NOT_FOUND)

        # Copy logic
        new_blocks = []
        for block in source_plan.blocks.all():
            new_block = Block.objects.create(
                day_plan=target_plan,
                type=block.type,
                title=block.title,
                duration_minutes=block.duration_minutes,
                start_time=block.start_time,
                status='NOT_STARTED',
                order_index=block.order_index,
                notes=block.notes,
                color=block.color
            )
            # Copy segments/subtasks if needed (omitted for brevity, can add later)
        
        return Response(DayPlanSerializer(target_plan).data)

class BlockViewSet(OwnedViewSetMixin, viewsets.ModelViewSet):
    queryset = Block.objects.all()
    serializer_class = BlockSerializer
    owner_field = 'day_plan__user_email'

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        """Reorder blocks"""
        ordered_ids = request.data.get('ids', [])
        for index, block_id in enumerate(ordered_ids):
            self.get_queryset().filter(id=block_id).update(order_index=index)
        return Response({'status': 'reordered'})

    @action(detail=True, methods=['post', 'patch'])
    def timer(self, request, pk=None):
        """Manage timer state for a block"""
        block = self.get_object()
        action = request.data.get('action')
        
        timer_state, created = TimerState.objects.get_or_create(
            block=block,
            defaults={'remaining_seconds': block.duration_minutes * 60}
        )
        
        if action == 'start':
            timer_state.is_running = True
            timer_state.started_at = timezone.now()
            block.status = 'IN_PROGRESS'
        elif action == 'pause':
            timer_state.is_running = False
            # Calculate remaining time
            if timer_state.started_at:
                elapsed = (timezone.now() - timer_state.started_at).total_seconds()
                timer_state.remaining_seconds = max(0, timer_state.remaining_seconds - int(elapsed))
        elif action == 'stop':
            timer_state.is_running = False
            timer_state.remaining_seconds = 0
            block.status = 'DONE'
        elif action == 'reset':
            timer_state.is_running = False
            timer_state.remaining_seconds = block.duration_minutes * 60
            timer_state.started_at = None
            block.status = 'NOT_STARTED'
        
        timer_state.save()
        block.save()
        
        return Response({
            'block': BlockSerializer(block).data,
            'timer': TimerStateSerializer(timer_state).data
        })


class SegmentViewSet(OwnedViewSetMixin, viewsets.ModelViewSet):
    queryset = Segment.objects.all()
    serializer_class = SegmentSerializer
    owner_field = 'block__day_plan__user_email'

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        """Reorder segments"""
        ordered_ids = request.data.get('ids', [])
        for index, segment_id in enumerate(ordered_ids):
            self.get_queryset().filter(id=segment_id).update(order_index=index)
        return Response({'status': 'reordered'})


class SubtaskViewSet(OwnedViewSetMixin, viewsets.ModelViewSet):
    queryset = Subtask.objects.all()
    serializer_class = SubtaskSerializer
    owner_field = 'block__day_plan__user_email'

    @action(detail=True, methods=['post'])
    def toggle(self, request, pk=None):
        """Toggle subtask completion"""
        subtask = self.get_object()
        subtask.is_done = not subtask.is_done
        subtask.save()
        return Response(SubtaskSerializer(subtask).data)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        """Reorder subtasks"""
        ordered_ids = request.data.get('ids', [])
        for index, subtask_id in enumerate(ordered_ids):
            self.get_queryset().filter(id=subtask_id).update(order_index=index)
        return Response({'status': 'reordered'})

class ScheduleSlotViewSet(OwnedViewSetMixin, viewsets.ModelViewSet):
    """Weekly schedule slots CRUD"""
    queryset = ScheduleSlot.objects.all()
    serializer_class = ScheduleSlotSerializer
    
    def get_queryset(self):
        return super().get_queryset().order_by('day_of_week', 'start_time')
    
    def perform_create(self, serializer):
        serializer.save(user_email=request_email(self.request))
