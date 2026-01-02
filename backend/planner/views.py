from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils.dateparse import parse_date
from .models import DayPlan, Block, Segment, Subtask, TimerState
from .serializers import DayPlanSerializer, BlockSerializer, SegmentSerializer, SubtaskSerializer

class DayPlanViewSet(viewsets.ModelViewSet):
    queryset = DayPlan.objects.all()
    serializer_class = DayPlanSerializer
    lookup_field = 'date' # Allow getting dayplans by date string

    @action(detail=True, methods=['post'])
    def copy(self, request, date=None):
        """Copy blocks from another day to this day"""
        source_date_str = request.data.get('from_date')
        if not source_date_str:
            return Response({'error': 'from_date is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target_plan = self.get_object() # Creating auto handled by get_object_or_404 logic if exists? 
            # Actually get_object might 404 if date doesn't exist. 
            # For simplicity, let's assume existence or create logic is handled by caller or generic create.
        except:
             # If target day doesn't exist, create it
            target_plan = DayPlan.objects.create(date=date)

        source_plan = DayPlan.objects.filter(date=source_date_str).first()
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

class BlockViewSet(viewsets.ModelViewSet):
    queryset = Block.objects.all()
    serializer_class = BlockSerializer

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        """Reorder blocks"""
        ordered_ids = request.data.get('ids', [])
        for index, block_id in enumerate(ordered_ids):
            Block.objects.filter(id=block_id).update(order_index=index)
        return Response({'status': 'reordered'})
