from typing import TypedDict
from django.db import transaction
from .models import CustomUser, TaskSubmission, ReviewVote, UserRating

class MatchResult(TypedDict):
    new_elo: int
    elo_delta: int
    new_tier: str
    tier_changed: bool

def get_tier_by_elo(elo: int) -> str:
    """
    Маппинг ELO в Тиры:
    - меньше 1000 = 'LT5' (Low Tier 5)
    ...
    - 2600 и выше = 'HT1'
    """
    if elo < 1000:
        return 'LT5'
    elif elo < 1200:
        return 'LT4'
    elif elo < 1400:
        return 'LT3'
    elif elo < 1600:
        return 'LT2'
    elif elo < 1800:
        return 'LT1'
    elif elo < 2000:
        return 'HT5'
    elif elo < 2200:
        return 'HT4'
    elif elo < 2400:
        return 'HT3'
    elif elo < 2600:
        return 'HT2'
    else:
        return 'HT1'

def calculate_match_result(player_elo: int, task_elo: int, is_correct: bool) -> MatchResult:
    k_factor = 32
    
    # Вероятность победы игрока (ожидаемый результат)
    expected_score = 1 / (1 + 10 ** ((task_elo - player_elo) / 400))
    
    # Фактический результат
    actual_score = 1 if is_correct else 0
    
    # Расчет нового ELO
    new_elo = round(player_elo + k_factor * (actual_score - expected_score))
    
    # Проверка на изменение тира
    old_tier = get_tier_by_elo(player_elo)
    new_tier = get_tier_by_elo(new_elo)
    
    return {
        "new_elo": new_elo,
        "elo_delta": new_elo - player_elo,
        "new_tier": new_tier,
        "tier_changed": old_tier != new_tier
    }

import random
from django.db import models

def assign_reviewers(submission_id: int):
    with transaction.atomic():
        try:
            submission = TaskSubmission.objects.select_related('task', 'student').get(id=submission_id)
        except TaskSubmission.DoesNotExist:
            return
            
        task = submission.task
        exclude_ids = [submission.student.id, task.author.id]
        
        # Находим подходящих юзеров (overall_elo >= base_elo, исключаем автора задачи и решения)
        eligible_reviewers = list(
            CustomUser.objects.filter(overall_elo__gte=task.base_elo)
            .exclude(id__in=exclude_ids)
            .values_list('id', flat=True)
        )
        
        if not eligible_reviewers:
            return # Недостаточно пользователей для ревью
            
        # Выбираем до 3 случайных ревьюеров
        sample_size = min(3, len(eligible_reviewers))
        selected_ids = random.sample(eligible_reviewers, sample_size)
        
        # Создаем пустые записи ReviewVote
        votes_to_create = [
            ReviewVote(submission=submission, reviewer_id=reviewer_id)
            for reviewer_id in selected_ids
        ]
        ReviewVote.objects.bulk_create(votes_to_create)

def process_vote(review_vote_id: int, vote_decision: str):
    with transaction.atomic():
        try:
            review_vote = ReviewVote.objects.select_related(
                'submission', 'submission__task', 'submission__student', 'submission__task__discipline'
            ).get(id=review_vote_id)
        except ReviewVote.DoesNotExist:
            return

        submission = review_vote.submission

        # Если статус уже не under_review, значит консенсус уже был достигнут
        if submission.status != 'under_review':
            return
            
        # a. Сохраняет голос ревьюера
        review_vote.vote = vote_decision
        review_vote.save(update_fields=['vote'])

        # b. Проверяет все голоса для данного сабмита
        all_votes = list(submission.review_votes.exclude(vote__isnull=True).values_list('vote', flat=True))
        
        vote_counts = {}
        for v in all_votes:
            vote_counts[v] = vote_counts.get(v, 0) + 1
            
        consensus = None
        for v, count in vote_counts.items():
            if count >= 2 and v in ['correct', 'incorrect']:
                consensus = v
                break
                
        # c. Если консенсус достигнут: меняет статус и пересчитывает ELO
        if consensus:
            submission.status = consensus
            submission.save(update_fields=['status'])
            
            task = submission.task
            student = submission.student
            discipline = task.discipline
            
            is_correct = (consensus == 'correct')
            
            # Получаем или создаем рейтинг пользователя по дисциплине
            user_rating, created = UserRating.objects.get_or_create(
                user=student,
                discipline=discipline,
                defaults={'elo_score': 1200, 'tier_level': 'LT5'}
            )
            
            # Считаем новый результат
            match_res = calculate_match_result(
                player_elo=user_rating.elo_score,
                task_elo=task.base_elo,
                is_correct=is_correct
            )
            
            user_rating.elo_score = match_res['new_elo']
            user_rating.tier_level = match_res['new_tier']
            user_rating.save(update_fields=['elo_score', 'tier_level'])
            
            # d. Начисляет проверяющим (чья оценка совпала с консенсусом) +5 очков
            consensus_reviewers = ReviewVote.objects.filter(
                submission=submission, 
                vote=consensus
            ).values_list('reviewer_id', flat=True)
            
            CustomUser.objects.filter(id__in=consensus_reviewers).update(
                contribution_points=models.F('contribution_points') + 5
            )
