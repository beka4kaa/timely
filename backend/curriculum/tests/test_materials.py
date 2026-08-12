"""Источники без файла: изоляция пользователей и детерминированный расчёт."""

from django.test import TestCase

from curriculum.models import CoursePlan, CourseTopic, LearningGoal, StudyMaterial
from curriculum.services import materials as materials_service

OWNER = "owner@example.com"
INTRUDER = "intruder@example.com"


def _auth(email: str) -> dict:
    """Заголовок, который проставляет `config.middleware`."""
    return {"HTTP_X_USER_EMAIL": email}


def _goal(email: str = OWNER, text: str = "Подготовиться к SAT") -> LearningGoal:
    return LearningGoal.objects.create(user_email=email, original_text=text)


def _material(goal: LearningGoal, **overrides) -> StudyMaterial:
    fields = {
        "user_email": goal.user_email,
        "goal": goal,
        "kind": StudyMaterial.Kind.PRACTICE_SET,
        "title": "SAT Practice Tests",
        "total_units": 10,
        "minutes_per_unit": 180,
    }
    fields.update(overrides)
    return StudyMaterial.objects.create(**fields)


class StudyMaterialApiTests(TestCase):
    def test_create_attaches_to_own_goal(self):
        goal = _goal()
        response = self.client.post(
            "/api/curriculum/materials/",
            {
                "goal_id": str(goal.id),
                "kind": "practice_set",
                "title": "SAT Practice Tests",
                "total_units": 10,
                "minutes_per_unit": 180,
            },
            content_type="application/json",
            **_auth(OWNER),
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["goal"], str(goal.id))
        # Подпись единицы приходит с сервера, чтобы интерфейс не собирал её сам.
        self.assertEqual(response.json()["units_word"], "вариантов")
        self.assertEqual(response.json()["total_minutes"], 1800)

    def test_create_rejects_someone_elses_goal(self):
        goal = _goal(email=INTRUDER)
        response = self.client.post(
            "/api/curriculum/materials/",
            {
                "goal_id": str(goal.id),
                "kind": "link",
                "title": "Чужой предмет",
                "url": "https://example.com",
            },
            content_type="application/json",
            **_auth(OWNER),
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "goal_not_found")
        self.assertEqual(StudyMaterial.objects.count(), 0)

    def test_link_requires_url(self):
        goal = _goal()
        response = self.client.post(
            "/api/curriculum/materials/",
            {"goal_id": str(goal.id), "kind": "link", "title": "Khan Academy"},
            content_type="application/json",
            **_auth(OWNER),
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("url", response.json())

    def test_list_is_scoped_to_owner_and_goal(self):
        mine = _goal()
        other = _goal(text="Механика")
        _material(mine, title="Мой")
        _material(other, title="Другой предмет")
        _material(_goal(email=INTRUDER), title="Чужой")

        response = self.client.get(
            f"/api/curriculum/materials/?goal={mine.id}", **_auth(OWNER)
        )

        self.assertEqual(response.status_code, 200)
        titles = [row["title"] for row in response.json()]
        self.assertEqual(titles, ["Мой"])

    def test_intruder_cannot_read_material(self):
        material = _material(_goal())
        response = self.client.get(
            f"/api/curriculum/materials/{material.id}/", **_auth(INTRUDER)
        )
        self.assertEqual(response.status_code, 404)

    def test_completed_cannot_exceed_total(self):
        material = _material(_goal())
        response = self.client.patch(
            f"/api/curriculum/materials/{material.id}/",
            {"completed_units": 11},
            content_type="application/json",
            **_auth(OWNER),
        )
        self.assertEqual(response.status_code, 400)

    def test_deleting_goal_removes_its_materials(self):
        goal = _goal()
        _material(goal)
        self.client.delete(f"/api/curriculum/goals/{goal.id}/", **_auth(OWNER))
        self.assertEqual(StudyMaterial.objects.count(), 0)


class MaterialPlanTests(TestCase):
    def test_long_unit_is_never_split(self):
        # Практис-тест на три часа — это один блок на три часа. Разрезанный
        # пополам пробник перестаёт быть пробником.
        material = _material(_goal(), total_units=10, minutes_per_unit=180)
        plan = materials_service.build_plan(material)

        topics = list(CourseTopic.objects.filter(module__plan=plan))
        self.assertEqual(len(topics), 10)
        self.assertEqual(topics[0].title, "Вариант 1")
        self.assertEqual(topics[0].estimated_minutes, 180)
        self.assertEqual(plan.estimated_total_minutes, 1800)

    def test_short_units_are_grouped_into_sessions(self):
        material = _material(
            _goal(),
            kind=StudyMaterial.Kind.PROBLEM_SET,
            title="Задачник",
            total_units=200,
            minutes_per_unit=5,
        )
        plan = materials_service.build_plan(material)

        topics = list(CourseTopic.objects.filter(module__plan=plan))
        # 45 / 5 = 9 задач за занятие → 200 / 9 = 23 занятия, последнее короче.
        self.assertEqual(len(topics), 23)
        self.assertEqual(topics[0].title, "Задачи 1–9")
        self.assertEqual(topics[0].estimated_minutes, 45)
        self.assertEqual(topics[-1].title, "Задачи 199–200")
        self.assertEqual(topics[-1].estimated_minutes, 10)
        self.assertEqual(
            sum(topic.estimated_minutes for topic in topics), 200 * 5
        )

    def test_plan_keeps_link_to_its_material(self):
        material = _material(_goal())
        plan = materials_service.build_plan(material)

        self.assertIsNone(plan.document)
        self.assertEqual(plan.material_id, material.id)
        self.assertEqual(plan.status, CoursePlan.Status.AWAITING_APPROVAL)

    def test_rebuilding_archives_the_previous_plan(self):
        material = _material(_goal())
        first = materials_service.build_plan(material)
        second = materials_service.build_plan(material)

        first.refresh_from_db()
        self.assertEqual(first.status, CoursePlan.Status.ARCHIVED)
        self.assertEqual(second.status, CoursePlan.Status.AWAITING_APPROVAL)

    def test_material_without_units_is_not_plannable(self):
        material = _material(_goal(), total_units=0)
        with self.assertRaises(materials_service.MaterialNotPlannable) as caught:
            materials_service.build_plan(material)
        self.assertEqual(caught.exception.code, "material_without_units")

    def test_material_without_duration_is_not_plannable(self):
        material = _material(_goal(), minutes_per_unit=0)
        with self.assertRaises(materials_service.MaterialNotPlannable) as caught:
            materials_service.build_plan(material)
        self.assertEqual(caught.exception.code, "material_without_duration")

    def test_plan_endpoint_builds_and_reports_failure(self):
        material = _material(_goal())
        response = self.client.post(
            f"/api/curriculum/materials/{material.id}/plan/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(len(response.json()["plan"]["modules"][0]["topics"]), 10)

        empty = _material(_goal(), title="Без объёма", total_units=0)
        failed = self.client.post(
            f"/api/curriculum/materials/{empty.id}/plan/", **_auth(OWNER)
        )
        self.assertEqual(failed.status_code, 400)
        self.assertEqual(failed.json()["code"], "material_without_units")

    def test_rebuild_of_material_plan_is_refused_by_planner(self):
        # Планировщику нечего читать: у источника нет оглавления.
        material = _material(_goal())
        plan = materials_service.build_plan(material)

        response = self.client.post(
            f"/api/curriculum/plans/{plan.id}/rebuild/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("источнику", response.json()["error"])
