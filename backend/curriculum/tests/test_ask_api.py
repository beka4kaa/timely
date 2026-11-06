"""Эндпоинт вопроса по книге: доступ, форма потока и поведение при отказе.

Модель подменяется: проверяется обвязка, а не её ответы. Смысловая часть —
что уходит в промпт — живёт в `test_ask.py`.
"""

from __future__ import annotations

import json
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings

from ai_engine.models import AIUsageEvent
from ai_engine.prompt_safety import PUBLIC_MODEL_ERROR
from ai_engine.text_llm import ToolCallEvent
from ai_engine.usage import AIUsageLimitExceeded, UsageNumbers
from curriculum.ask import OUTSIDE_MARKER
from curriculum.ask_models import ask_options, resolve_choice
from curriculum.models import Document, KnowledgeChunk, LearningGoal
from config.testing import auth_headers
from habits.models import Habit

OWNER = "owner@example.com"
INTRUDER = "intruder@example.com"
URL = "/api/curriculum/ask/stream"


def _auth(email: str) -> dict:
    return auth_headers(email)


def _events(response) -> list[tuple[str, dict]]:
    """Разбирает поток в список `(событие, данные)`."""
    body = b"".join(response.streaming_content).decode("utf-8")
    parsed: list[tuple[str, dict]] = []
    for block in body.split("\n\n"):
        lines = [line for line in block.split("\n") if line.strip()]
        if len(lines) < 2:
            continue
        event = lines[0].removeprefix("event: ").strip()
        data = json.loads(lines[1].removeprefix("data: "))
        parsed.append((event, data))
    return parsed


def _stream(*chunks):
    """Подменяет поток модели заданными кусочками текста."""
    return mock.patch(
        "ai_engine.text_llm.TextModel.stream_content",
        lambda self, messages, **kwargs: iter(chunks),
    )


class AskStreamTests(TestCase):
    def setUp(self):
        self.goal = LearningGoal.objects.create(
            user_email=OWNER, original_text="механика"
        )
        self.document = Document.objects.create(
            user_email=OWNER,
            goal=self.goal,
            title="Механика",
            ingestion_status=Document.Status.READY,
        )
        KnowledgeChunk.objects.create(
            document_id=self.document.pk,
            normalized_text="Импульс тела равен произведению массы на скорость",
            content_hash="a" * 64,
            processing_version=self.document.processing_version,
            section_path="§ 5.2",
            page_start=292,
            page_end=292,
        )

    def _post(self, question="импульс", email=OWNER, goal=None, **body):
        return self.client.post(
            URL,
            data=json.dumps(
                {
                    "goal_id": str((goal or self.goal).pk),
                    "message": question,
                    **body,
                }
            ),
            content_type="application/json",
            **_auth(email),
        )

    def _ask(self, *chunks, **kwargs):
        """Спрашивает с подменённым потоком и СРАЗУ читает ответ.

        Читать обязательно внутри патча: тело `StreamingHttpResponse` — это
        генератор, и он исполняется в момент чтения. Прочитанный снаружи, он
        уходил в настоящую модель — тест ждал по пятнадцать секунд и тратил
        деньги.
        """
        with _stream(*chunks):
            response = self._post(**kwargs)
            events = _events(response) if response.status_code == 200 else []
        return response, events

    def test_поток_отдаётся_событиями(self):
        response, events = self._ask(
            "Импульс — это ", "произведение массы на скорость."
        )

        self.assertEqual(response["Content-Type"], "text/event-stream")
        names = [name for name, _ in events]
        # Три стадии подряд: ищу → нашёл → отвечаю. Ученик видит, что делается,
        # а не одну крутилку на всё время ожидания.
        self.assertEqual(names[:3], ["stage", "stage", "stage"])
        self.assertEqual(names[-1], "done")
        self.assertIn("content", names)
        self.assertIn("citations", names)

    def test_цитата_приходит_вместе_со_ссылкой(self):
        """Источник виден с самим фрагментом: за ним не нужно идти вторым поиском."""
        _, events = self._ask("Импульс это произведение массы на скорость.")

        items = dict(events)["citations"]["items"]
        self.assertTrue(items)
        self.assertIn("Импульс тела", items[0]["excerpt"])

    def test_заголовки_запрещают_буферизацию(self):
        """Без них прокси копит поток и отдаёт всё одним куском в конце.

        Проверено на живом проде для чата доски: 124 события приходили
        одновременно, и «печать» ответа не работала вовсе.
        """
        response, _ = self._ask("текст")

        self.assertIn("no-transform", response["Cache-Control"])
        self.assertEqual(response["X-Accel-Buffering"], "no")

    def test_стадии_приходят_по_порядку(self):
        _, events = self._ask("ответ")
        stages = [d.get("stage") for n, d in events if n == "stage"]
        self.assertEqual(stages, ["retrieving", "found", "answering"])

    def test_цитата_несёт_название_книги_отдельно(self):
        """Панель показывает книгу один раз над списком, а не в каждой ссылке."""
        _, events = self._ask("ответ")
        item = dict(events)["citations"]["items"][0]
        self.assertEqual(item["document_title"], "Механика")
        self.assertEqual(item["section_path"], "§ 5.2")

    def test_ответ_по_книге_приходит_с_цитатами(self):
        _, events = self._ask("Импульс — это произведение массы на скорость.")
        by_name = dict(events)

        self.assertTrue(by_name["citations"]["grounded"])
        self.assertIn("§ 5.2", by_name["citations"]["items"][0]["label"])

    def test_ответ_вне_книги_без_цитат_и_без_маркера(self):
        """Маркер — сигнал интерфейсу; ученик не должен его увидеть."""
        _, events = self._ask(
            f"{OUTSIDE_MARKER}\nИсаак Ньютон — английский физик.",
            question="кто такой Ньютон",
        )
        by_name = dict(events)
        self.assertFalse(by_name["citations"]["grounded"])
        self.assertEqual(by_name["citations"]["items"], [])

        text = "".join(
            data["delta"] for name, data in events if name == "content"
        )
        self.assertNotIn(OUTSIDE_MARKER, text)
        self.assertIn("Исаак Ньютон", text)

    def test_маркер_узнаётся_разорванным_между_чанками(self):
        """Провайдер режет поток где хочет, в том числе посреди маркера."""
        _, events = self._ask("[ВНЕ ", "КНИГИ]\n", "Ответ от себя.")

        text = "".join(d["delta"] for n, d in events if n == "content")
        self.assertNotIn("[ВНЕ", text)
        self.assertIn("Ответ от себя.", text)
        self.assertFalse(dict(events)["done"]["grounded"])

    def test_чужой_предмет_не_находится(self):
        """404, а не 403: чужая цель не должна подтверждать своё существование."""
        response, _ = self._ask("текст", email=INTRUDER)
        self.assertEqual(response.status_code, 404)

    def test_пустой_вопрос_отклоняется_кодом(self):
        response, _ = self._ask("текст", question="   ")
        self.assertEqual(response.status_code, 400)

    def test_отказ_модели_приезжает_событием(self):
        """Заголовки уже отправлены — HTTP-код не поменять."""

        def boom(self, messages, **kwargs):
            raise RuntimeError("404 z-ai/glm-5.3 no endpoints")
            yield  # pragma: no cover — делает функцию генератором

        with mock.patch("ai_engine.text_llm.TextModel.stream_content", boom):
            response = self._post()
            events = _events(response)

        self.assertEqual(response.status_code, 200)
        by_name = dict(events)
        # Текст исключения остаётся в логе: там бывает идентификатор модели.
        self.assertEqual(by_name["error"]["error"], PUBLIC_MODEL_ERROR)

    def test_название_модели_не_доходит_и_в_ответе_по_книге(self):
        with _stream(f"{OUTSIDE_MARKER}\n", "Я GLM-", "5.3 от Zhipu, а импульс это масса на скорость"):
            events = _events(self._post())

        text = "".join(d["delta"] for n, d in events if n == "content")
        self.assertNotIn("GLM-5", text)
        self.assertNotIn("Zhipu", text)
        self.assertNotIn(OUTSIDE_MARKER, text)
        self.assertIn("масса на скорость", text)

    def test_предмет_без_готовых_книг_отвечает_вне_книги(self):
        empty_goal = LearningGoal.objects.create(
            user_email=OWNER, original_text="химия"
        )
        _, events = self._ask(
            f"{OUTSIDE_MARKER}\nОтвечаю от себя.",
            question="что такое моль",
            goal=empty_goal,
        )
        # События `stage` приходят тройкой, поэтому берём нужное по имени, а не
        # схлопываем всё в словарь: там побеждало бы последнее.
        found = next(d for n, d in events if n == "stage" and "found" in d)
        by_name = dict(events)
        self.assertEqual(found["found"], 0)
        self.assertFalse(by_name["citations"]["grounded"])
        self.assertEqual(by_name["done"]["grounded"], False)

    def test_решение_не_доезжает_до_модели(self):
        """Тот же рубеж, что и в поиске: режим ученика запрещает решения."""
        KnowledgeChunk.objects.create(
            document_id=self.document.pk,
            normalized_text="Ответ: p = 12 кг·м/с",
            content_hash="b" * 64,
            processing_version=self.document.processing_version,
            chunk_type=KnowledgeChunk.ChunkType.SOLUTION,
            solution_visibility=KnowledgeChunk.SolutionVisibility.RESTRICTED,
        )
        seen: list[list[dict]] = []

        def capture(self, messages, **kwargs):
            seen.append(messages)
            return iter(["ответ"])

        with mock.patch("ai_engine.text_llm.TextModel.stream_content", capture):
            _events(self._post("импульс"))

        blob = " ".join(m["content"] for m in seen[0])
        self.assertNotIn("12 кг·м/с", blob)


class WithoutSubjectStreamTests(TestCase):
    """Вопрос без предмета: книги нет, и притворяться, что она есть, нельзя."""

    def _ask(self, *chunks, **body):
        with _stream(*chunks):
            response = self.client.post(
                URL,
                data=json.dumps({"message": "что такое интеграл", **body}),
                content_type="application/json",
                **_auth(OWNER),
            )
            events = _events(response) if response.status_code == 200 else []
        return response, events

    def test_название_модели_не_доходит_до_ученика(self):
        _, events = self._ask("Я GLM-", "5.3 от Zh", "ipu, а интеграл это площадь")

        text = "".join(d["delta"] for n, d in events if n == "content")
        self.assertNotIn("GLM-5", text)
        self.assertNotIn("Zhipu", text)
        self.assertTrue(text.endswith("а интеграл это площадь"))

    def test_ответ_приходит_без_предмета(self):
        response, events = self._ask("Интеграл — это ", "площадь под кривой.")

        self.assertEqual(response.status_code, 200)
        text = "".join(d["delta"] for n, d in events if n == "content")
        self.assertEqual(text, "Интеграл — это площадь под кривой.")

    def test_поиска_не_было_и_стадия_о_нём_не_приходит(self):
        """«Ищу в учебнике» без учебника — выдумка о работе, которой не было."""
        _, events = self._ask("ответ")

        stages = [d["stage"] for n, d in events if n == "stage"]
        self.assertEqual(stages, ["answering"])

    def test_разговор_помечен_как_безкнижный(self):
        """Страница по этому признаку не рисует пометку «В книге этого нет»."""
        _, events = self._ask("ответ")

        by_name = dict(events)
        self.assertFalse(by_name["citations"]["library"])
        self.assertFalse(by_name["citations"]["grounded"])
        self.assertEqual(by_name["citations"]["items"], [])
        self.assertFalse(by_name["done"]["library"])

    def test_маркер_не_вырезается_из_начала_ответа(self):
        """Модель без книги о маркере не знает, и разбор только съел бы текст."""
        _, events = self._ask("[ВНЕ", " КНИГИ] всё же ответ")

        text = "".join(d["delta"] for n, d in events if n == "content")
        self.assertEqual(text, "[ВНЕ КНИГИ] всё же ответ")

    def test_указанный_но_чужой_предмет_остаётся_ошибкой(self):
        """Опечатка в идентификаторе не должна тихо превращаться в ответ «от
        себя»: ученик не узнал бы, что книгу не читали."""
        stranger = LearningGoal.objects.create(
            user_email=INTRUDER, original_text="чужая физика"
        )

        response, _ = self._ask("ответ", goal_id=str(stranger.pk))

        self.assertEqual(response.status_code, 404)


class AskModesTests(TestCase):
    """Режим чата меняет то, что слышит модель, и больше ничего."""

    def _system(self, **body):
        seen: list[list[dict]] = []

        def capture(self, messages, **kwargs):
            seen.append(messages)
            return iter(["ответ"])

        with mock.patch("ai_engine.text_llm.TextModel.stream_content", capture):
            response = self.client.post(
                URL,
                data=json.dumps({"message": "помоги с задачей", **body}),
                content_type="application/json",
                **_auth(OWNER),
            )
            self.assertEqual(response.status_code, 200)
            _events(response)
        return seen[0][0]["content"]

    def test_в_любом_режиме_действуют_общие_правила(self):
        for mode in ("plain", "plan", "guide", "ideas", "check"):
            self.assertIn("Не решай задачу за ученика", self._system(mode=mode))

    def test_наводящая_помощь_не_даёт_решение_сразу(self):
        self.assertIn("Режим: наводящая помощь", self._system(mode="guide"))

    def test_планирование_не_обещает_менять_расписание(self):
        self.assertIn("Сам ты расписание не меняешь", self._system(mode="plan"))

    def test_без_режима_и_с_незнакомым_обычный(self):
        self.assertIn("Режим: обычный разговор", self._system())
        self.assertIn("Режим: обычный разговор", self._system(mode="contest"))
        self.assertIn("Режим: обычный разговор", self._system(mode=["plan"]))


class AskModelChoiceTests(TestCase):
    """Модель и уровень рассуждения выбирают из списка, проверяет сервер."""

    def _ask(self, usage=None, **body):
        seen: dict = {}

        def capture(model, messages, **kwargs):
            seen["model"] = model.model
            seen.update(kwargs)
            if usage is not None:
                kwargs["on_usage"](usage)
            return iter(["ответ"])

        with mock.patch("ai_engine.text_llm.TextModel.stream_content", capture):
            response = self.client.post(
                URL,
                data=json.dumps({"message": "вопрос", **body}),
                content_type="application/json",
                **_auth(OWNER),
            )
            self.assertEqual(response.status_code, 200)
            events = _events(response)
        return seen, events

    def test_по_умолчанию_основная_модель_и_низкий_уровень(self):
        seen, _ = self._ask()
        self.assertEqual(seen["model"], "z-ai/glm-5.3")
        self.assertEqual(seen["reasoning_effort"], "low")

    def test_выбранная_модель_и_уровень_доходят_до_провайдера(self):
        seen, _ = self._ask(model="glm-5.3-flash", reasoning="high")
        self.assertEqual(seen["model"], "z-ai/glm-5.3-flash")
        self.assertEqual(seen["reasoning_effort"], "high")

    def test_чем_выше_уровень_тем_больше_лимит(self):
        low, _ = self._ask(reasoning="low")
        high, _ = self._ask(reasoning="high")
        self.assertGreater(high["max_tokens"], low["max_tokens"])

    def test_чужую_модель_с_клиента_не_пропускаем(self):
        seen, _ = self._ask(model="openai/gpt-5-pro", reasoning="turbo")
        self.assertEqual(seen["model"], "z-ai/glm-5.3")
        self.assertEqual(seen["reasoning_effort"], "low")

    def test_расход_приходит_отдельным_событием(self):
        numbers = UsageNumbers(
            input_tokens=3000,
            cached_input_tokens=1000,
            output_tokens=500,
            reasoning_tokens=200,
            total_tokens=3500,
            cost_usd=Decimal("0.0009"),
        )
        _, events = self._ask(usage=numbers, model="glm-5.3-flash", reasoning="high")

        names = [name for name, _ in events]
        self.assertEqual(names[-2:], ["usage", "done"])
        usage = dict(events)["usage"]
        self.assertEqual(usage["model_name"], "Быстрая")
        self.assertEqual(usage["reasoning"], "high")
        self.assertEqual(usage["input_tokens"], 3000)
        self.assertEqual(usage["cached_input_tokens"], 1000)
        self.assertEqual(usage["output_tokens"], 500)
        self.assertEqual(usage["reasoning_tokens"], 200)
        self.assertEqual(usage["context_window"], 1_048_576)
        self.assertEqual(usage["cost_usd"], 0.0009)
        self.assertFalse(usage["cost_estimated"])

    def test_без_цены_от_провайдера_считаем_по_прайсу(self):
        numbers = UsageNumbers(input_tokens=1_000_000, output_tokens=1_000_000, total_tokens=2_000_000)
        _, events = self._ask(usage=numbers, model="glm-5.3")

        usage = dict(events)["usage"]
        self.assertAlmostEqual(usage["cost_usd"], 1.47)
        self.assertTrue(usage["cost_estimated"])

    def test_без_данных_о_расходе_события_нет(self):
        _, events = self._ask()
        self.assertNotIn("usage", [name for name, _ in events])

    def test_список_вариантов_только_после_входа(self):
        url = "/api/curriculum/ask/options/"
        self.assertEqual(self.client.get(url).status_code, 401)
        body = self.client.get(url, **_auth(OWNER)).json()
        self.assertEqual([row["key"] for row in body["models"]], ["smart", "fast"])
        self.assertEqual([row["key"] for row in body["reasoning"]], ["low", "high", "max"])
        self.assertNotIn("model_id", body["models"][0])


class AskLimitTests(TestCase):
    """Лимит действует и в чате: иначе расход тьютора ничем не ограничен."""

    def _spend(self, tokens: int) -> None:
        AIUsageEvent.objects.create(
            user_email=OWNER,
            provider="openrouter",
            model_name="test-model",
            feature="subject_ask",
            total_tokens=tokens,
            billable_tokens=tokens,
        )

    def _ask(self):
        return self.client.post(
            URL, {"message": "привет"}, content_type="application/json", **_auth(OWNER)
        )

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True)
    def test_исчерпанный_лимит_даёт_понятный_отказ(self):
        self._spend(150000)

        def must_not_run(self, messages, **kwargs):
            raise AssertionError("после лимита модель не вызывается")

        with mock.patch("ai_engine.text_llm.TextModel.stream_content", must_not_run):
            response = self._ask()

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "ai_usage_limit_exceeded")
        # По этому коду клиент показывает понятный текст о лимите.
        self.assertIn("Лимит", response.json()["error"])
        self.assertEqual(response.json()["window"], "five_hour")
        self.assertTrue(response.json()["reset_at"])

    def test_отказ_при_поиске_по_книге_тоже_понятный(self):
        # Сам запрос прошёл проверку, а на векторе вопроса токены кончились. Это уже внутри вью.
        self.client.raise_request_exception = False
        denied = AIUsageLimitExceeded(window="five_hour", reset_at="2026-08-09T12:00:00Z")

        with mock.patch("curriculum.ask_views.build_ask_context", side_effect=denied):
            response = self._ask()

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "ai_usage_limit_exceeded")
        self.assertEqual(response.json()["reset_at"], "2026-08-09T12:00:00Z")

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True)
    def test_пока_лимит_не_кончился_вопрос_проходит(self):
        self._spend(149000)

        with _stream("Ответ"):
            response = self._ask()
            events = _events(response)

        self.assertEqual(response.status_code, 200)
        self.assertIn("done", [name for name, _ in events])


class ModelLabelsTests(TestCase):
    """Ученик выбирает «Умная» или «Быстрая»: что это за модель, ему не показываем."""

    def test_старые_ключи_из_браузера_работают(self):
        self.assertEqual(resolve_choice("glm-5.3").model.key, "smart")
        self.assertEqual(resolve_choice("glm-5.3-flash").model.key, "fast")

    def test_новые_ключи_и_подписи(self):
        self.assertEqual(resolve_choice("smart").model.name, "Умная")
        self.assertEqual(resolve_choice("fast").model.name, "Быстрая")

    def test_незнакомый_ключ_даёт_значение_по_умолчанию(self):
        self.assertEqual(resolve_choice("gpt").model.key, "smart")

    def test_варианты_не_называют_модель(self):
        self.assertNotRegex(json.dumps(ask_options(), ensure_ascii=False), "(?i)glm|z-ai")


class AssistantInStreamTests(TestCase):
    """Тьютор смотрит дела ученика прямо в ответе и предлагает карточки."""

    def _ask(self, stream, **fields):
        with mock.patch("ai_engine.text_llm.TextModel.stream_content", stream):
            response = self.client.post(
                URL, {"message": "добавь зарядку", **fields}, content_type="application/json", **_auth(OWNER)
            )
            # Поток читается лениво, поэтому и разбирать его надо, пока модель подменена.
            return _events(response)

    def test_tool_call_shows_a_plain_label_and_a_card(self):
        def stream(self, messages, **kwargs):
            yield ToolCallEvent("list_habits")
            kwargs["run_tool"]("list_habits", {})
            yield ToolCallEvent("propose_new_habit")
            kwargs["run_tool"]("propose_new_habit", {"name": "Зарядка"})
            yield "Предлагаю привычку."

        events = self._ask(stream)
        labels = [data.get("label") for name, data in events if name == "stage" and data["stage"] == "tool"]
        self.assertEqual(labels, ["Смотрю привычки", "Готовлю предложение"])
        cards = [data for name, data in events if name == "proposal"]
        self.assertEqual(cards[0]["kind"], "new_habit")
        self.assertEqual(cards[0]["name"], "Зарядка")
        self.assertFalse(Habit.objects.filter(user_email=OWNER).exists())

    def test_silent_proposal_still_gets_words(self):
        def stream(self, messages, **kwargs):
            yield ToolCallEvent("propose_new_habit")
            kwargs["run_tool"]("propose_new_habit", {"name": "Зарядка"})

        events = self._ask(stream)
        self.assertEqual("".join(data["delta"] for name, data in events if name == "content"), "Вот что предлагаю:")

    def test_answer_about_affairs_is_not_presented_as_from_the_book(self):
        goal = LearningGoal.objects.create(user_email=OWNER, original_text="механика")
        document = Document.objects.create(
            user_email=OWNER, goal=goal, title="Механика", ingestion_status=Document.Status.READY
        )
        KnowledgeChunk.objects.create(
            document_id=document.pk,
            normalized_text="Зарядка полезна для здоровья",
            content_hash="b" * 64,
            processing_version=document.processing_version,
            section_path="§ 1",
            page_start=1,
            page_end=1,
        )

        def stream(self, messages, **kwargs):
            yield ToolCallEvent("list_habits")
            yield "Сегодня ты не отметил зарядку, и этого хватит для ответа."

        events = dict(self._ask(stream, goal_id=str(goal.pk), message="зарядка"))
        self.assertEqual(events["citations"]["items"], [])
        self.assertFalse(events["citations"]["library"])

    def test_the_model_gets_tools_and_the_rules(self):
        seen = {}

        def stream(self, messages, **kwargs):
            seen["messages"] = messages
            seen["tools"] = kwargs["tools"]()
            yield "Привет."

        self._ask(stream, timezone="Asia/Almaty")
        self.assertIn("«Применить»", seen["messages"][0]["content"])
        self.assertIn("list_habits", {row["function"]["name"] for row in seen["tools"]})

    def test_plain_study_question_costs_almost_nothing(self):
        seen = {}

        def stream(self, messages, **kwargs):
            seen["system"] = messages[0]["content"]
            seen["tools"] = kwargs["tools"]()
            yield "Предел отношения приращений."

        self._ask(stream, message="Что такое производная?")
        self.assertEqual([row["function"]["name"] for row in seen["tools"]], ["open_my_affairs"])
        self.assertNotIn("«Применить»", seen["system"])

    def test_page_narrows_tools_to_its_subject(self):
        seen = {}

        def stream(self, messages, **kwargs):
            seen["tools"] = kwargs["tools"]()
            yield "Ответ."

        self._ask(stream, message="Читать двадцать минут", page="habits")
        names = {row["function"]["name"] for row in seen["tools"]}
        self.assertIn("propose_new_habit", names)
        self.assertNotIn("get_schedule", names)

    def test_usage_sums_rounds_but_context_is_the_last_one(self):
        def stream(self, messages, **kwargs):
            kwargs["on_usage"](UsageNumbers(input_tokens=100, output_tokens=20, reasoning_tokens=5, total_tokens=120, cost_usd=Decimal("0.001")))
            kwargs["on_usage"](UsageNumbers(input_tokens=300, output_tokens=40, reasoning_tokens=10, total_tokens=340, cost_usd=Decimal("0.002")))
            yield "Ответ."

        usage = dict(self._ask(stream))["usage"]
        self.assertEqual(usage["input_tokens"], 400)
        self.assertEqual(usage["output_tokens"], 60)
        self.assertEqual(usage["context_tokens"], 330)
        self.assertAlmostEqual(usage["cost_usd"], 0.003)
