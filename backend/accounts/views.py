from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.contrib.auth import authenticate
from django_filters.rest_framework import DjangoFilterBackend
from .models import CustomUser, Task, TaskSubmission
from .serializers import RegisterSerializer, LoginSerializer, UserSerializer, LeaderboardSerializer, TaskSerializer, TaskSubmissionSerializer


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

class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return Task.objects.all()
        return Task.objects.filter(status='active')

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)


class TaskSubmissionViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSubmissionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return TaskSubmission.objects.filter(student=self.request.user)

    def perform_create(self, serializer):
        serializer.save(student=self.request.user)
