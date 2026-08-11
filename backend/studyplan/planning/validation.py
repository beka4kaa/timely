"""Проверка ритма, предложенного моделью.

Схема (`schema.py`) снимает ошибки ФОРМЫ до генерации. Здесь проверяется
СМЫСЛ: те же поля правильного типа могут описывать ритм, по которому учиться
нельзя — с выдуманной темой, с практикой раньше теории или с нулевой
длительностью занятия.

Блокер означает «показывать ученику нельзя», а не «мне не нравится». Всё, что
можно молча исправить или пережить, остаётся предупреждением: отказ ценой
пустого календаря хуже, чем ритм с лишним предупреждением.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..scheduling.contracts import PacingPlan

# Типы занятий, которые модель имеет право назначить. Берутся у модели данных,
# а не переписываются списком: разъехавшийся перечень означал бы, что валидатор
# пропускает значение, которое БД потом не примет.
def allowed_activity_types() -> frozenset[str]:
    from ..models import ActivityType

    return frozenset(choice.value for choice in ActivityType)


SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_BLOCKER = "blocker"


@dataclass(frozen=True)
class PacingIssue:
    kind: str
    message: str
    severity: str = SEVERITY_WARNING
    topic_id: str = ""

    def to_payload(self) -> dict:
        return {
            "kind": self.kind,
            "message": self.message,
            "severity": self.severity,
            "topic_id": self.topic_id,
        }


@dataclass
class PacingValidationReport:
    issues: list[PacingIssue] = field(default_factory=list)

    @property
    def blockers(self) -> list[PacingIssue]:
        return [issue for issue in self.issues if issue.severity == SEVERITY_BLOCKER]

    @property
    def approved(self) -> bool:
        return not self.blockers

    def to_payload(self) -> dict:
        return {
            "approved": self.approved,
            "issues": [issue.to_payload() for issue in self.issues],
        }


def validate_pacing(
    plan: PacingPlan,
    *,
    allowed_topic_ids: tuple[str, ...],
    prerequisites: dict[str, tuple[str, ...]] | None = None,
    constraints=None,
) -> PacingValidationReport:
    """Проверить ритм против программы и рамок."""
    from .contracts import PacingConstraints

    limits = constraints or PacingConstraints()
    prerequisites = prerequisites or {}
    allowed = set(allowed_topic_ids)
    activities = allowed_activity_types()
    report = PacingValidationReport()

    if not plan.topic_pacing:
        report.issues.append(
            PacingIssue(
                kind="empty_plan",
                message="Ритм не содержит ни одной темы.",
                severity=SEVERITY_BLOCKER,
            )
        )
        return report

    seen: list[str] = []
    for topic in plan.topic_pacing:
        topic_id = topic.topic_id

        if topic_id not in allowed:
            report.issues.append(
                PacingIssue(
                    kind="unknown_topic",
                    message=f"Темы {topic_id} нет в программе.",
                    severity=SEVERITY_BLOCKER,
                    topic_id=topic_id,
                )
            )
            continue

        if topic_id in seen:
            # Одна тема, расписанная дважды, — это два разных ответа на один
            # вопрос «сколько её учить». Выбрать между ними мы не можем.
            report.issues.append(
                PacingIssue(
                    kind="duplicate_topic",
                    message=f"Тема {topic_id} встречается в ритме дважды.",
                    severity=SEVERITY_BLOCKER,
                    topic_id=topic_id,
                )
            )
            continue
        seen.append(topic_id)

        if not topic.lesson_parts:
            report.issues.append(
                PacingIssue(
                    kind="empty_topic",
                    message=f"У темы {topic_id} нет ни одного занятия.",
                    severity=SEVERITY_BLOCKER,
                    topic_id=topic_id,
                )
            )
            continue

        kinds = set()
        for part in topic.lesson_parts:
            kinds.add(part.activity_type)
            if part.duration_minutes <= 0:
                report.issues.append(
                    PacingIssue(
                        kind="non_positive_duration",
                        message=(
                            f"Занятие «{part.activity_type}» темы {topic_id} "
                            "имеет неположительную длительность."
                        ),
                        severity=SEVERITY_BLOCKER,
                        topic_id=topic_id,
                    )
                )
            elif part.duration_minutes < limits.min_part_minutes:
                report.issues.append(
                    PacingIssue(
                        kind="part_too_short",
                        message=(
                            f"Занятие темы {topic_id} короче "
                            f"{limits.min_part_minutes} мин."
                        ),
                        topic_id=topic_id,
                    )
                )
            if part.activity_type not in activities:
                report.issues.append(
                    PacingIssue(
                        kind="unknown_activity_type",
                        message=f"Неизвестный тип занятия «{part.activity_type}».",
                        severity=SEVERITY_BLOCKER,
                        topic_id=topic_id,
                    )
                )

        if "assessment" not in kinds:
            report.issues.append(
                PacingIssue(
                    kind="no_assessment",
                    message=(
                        f"У темы {topic_id} нет проверки — освоение нечем "
                        "подтвердить."
                    ),
                    topic_id=topic_id,
                )
            )

    missing = allowed - set(seen)
    if missing:
        # Пропущенная тема исчезла бы из календаря целиком, и ученик узнал бы об
        # этом через месяц.
        report.issues.append(
            PacingIssue(
                kind="missing_topics",
                message=f"В ритме нет {len(missing)} тем программы.",
                severity=SEVERITY_BLOCKER,
            )
        )

    _check_prerequisite_order(plan, prerequisites=prerequisites, report=report)

    total = plan.total_minutes
    if total > limits.max_total_minutes:
        report.issues.append(
            PacingIssue(
                kind="total_minutes_exceeded",
                message=f"Суммарная длительность {total} мин выходит за допустимую.",
                severity=SEVERITY_BLOCKER,
            )
        )

    if not plan.weekly_pattern:
        report.issues.append(
            PacingIssue(
                kind="empty_weekly_pattern",
                message="Недельный ритм пуст — будет взят из шаблона ученика.",
            )
        )

    if not limits.min_buffer <= plan.buffer_percentage <= limits.max_buffer:
        report.issues.append(
            PacingIssue(
                kind="buffer_out_of_range",
                message=(
                    f"Буфер {plan.buffer_percentage} вне диапазона "
                    f"[{limits.min_buffer}, {limits.max_buffer}]."
                ),
            )
        )

    return report


def _check_prerequisite_order(
    plan: PacingPlan,
    *,
    prerequisites: dict[str, tuple[str, ...]],
    report: PacingValidationReport,
) -> None:
    """Порядок тем обязан уважать зависимости.

    Движок размещает части строго по порядку `topic_pacing`, поэтому тема,
    стоящая раньше своей предпосылки, физически окажется в календаре раньше
    неё. Это не косметика: ученик получит практику до теории.
    """
    position = {topic.topic_id: index for index, topic in enumerate(plan.topic_pacing)}
    for topic_id, required in prerequisites.items():
        if topic_id not in position:
            continue
        for dependency in required:
            if dependency not in position:
                continue
            if position[dependency] >= position[topic_id]:
                report.issues.append(
                    PacingIssue(
                        kind="prerequisite_order_violated",
                        message=(
                            f"Тема {topic_id} стоит раньше своей предпосылки "
                            f"{dependency}."
                        ),
                        severity=SEVERITY_BLOCKER,
                        topic_id=topic_id,
                    )
                )
