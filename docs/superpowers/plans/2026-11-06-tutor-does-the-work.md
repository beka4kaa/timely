# Тьютор сам ведёт дела ученика: план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Модель сама делает большинство дел ученика и просит одно подтверждение в конце, знает контекст аккаунта и не раскрывает, что она за модель.

**Architecture:** Модель по-прежнему ничего не пишет: `propose_*` проверяет аргументы и кладёт предложение, клиент показывает одну карточку и пишет обычными API после нажатия. Новый модуль `studyplan/quick_plan.py` заводит предмет и занятия одной транзакцией с предпросмотром через откат. Защита держится на правиле в промпте, страховке в потоке и маршрутизации OpenRouter.

**Tech Stack:** Django 6, DRF, Python 3.12 (`backend/`); Next.js 15, TypeScript (`src/`); OpenRouter через SDK `openai`; SSE; `node --test` с `ts-node`.

**Spec:** `docs/superpowers/specs/2026-11-06-tutor-does-the-work-design.md`

## Global Constraints

- Пять частей выкладываются по очереди. Коммит и пуш в `main` только после явного «да» владельца на эту часть. PR не делаем. Подпись коммита: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Модель не пишет данные. Изменение только после нажатия ученика (CLAUDE.md §3.3).
- В модель не уходят почта, имя и данные входа.
- Лимит бесплатного тарифа: 150000 токенов за 5 часов, 500000 в неделю.
- Длительность занятия по умолчанию 60 минут, границы 15–120 (`MIN_SESSION_MINUTES`, `MAX_SESSION_MINUTES` в `studyplan/setup.py`).
- Подписи моделей: «Умная» (`smart`), «Быстрая» (`fast`).
- `reasoning.enabled=false` для GLM не отправлять никогда: это 400.
- CSS страниц только через `src/styles/timely/index.css`. Класс `.is-off` занят: `display: none !important`.
- Текст в интерфейсе простым языком, без лишних тире.
- `manage.py` в `backend/` репозитория не запускать, файлы `.env*` не читать.

Команды (`SP=/private/tmp/claude-501/-Users-bekzhan-Documents-proj-timely/70cd29c4-8508-4223-97ac-162824a44fa1/scratchpad`):

```bash
zsh $SP/stand/test-backend.sh <метки> --parallel 1 > $SP/stand/backend-tests.log 2>&1; grep -nE '^(Ran |OK|FAILED|ERROR: |FAIL: )' $SP/stand/backend-tests.log
```

- Полный прогон без меток: допустимы только ошибки `test_img3` и `test_img_cube`.
- Фронт: `npx tsc --noEmit | grep -v '\.next/types'` без вывода, `npx eslint <файлы>` без вывода, `npm run -s test:<chat|growth|now|studyplan|routing|diary>` с `fail 0`.
- Стенд поднимается и проверяется настоящими нажатиями так же, как в прошлых выкладках: `$SP/stand/fake_llm.py`, `$SP/stand/manage.sh`, сборка в `$SP/stand/build`, `node $SP/design/flow.mjs <сценарий>`.

## Review Focus

- Название модели разорвано между кусками потока или стоит в самом конце ответа: до ученика оно не доходит, а хвост ответа не теряется. Тесты в задаче 1.
- Часовой пояс ученика: «16:00» в Алматы это 11:00 UTC, а период считается по его дате, а не по серверной. Тест в задаче 8.
- Календарь изменился между карточкой и нажатием, или карточка давняя и лежит в истории чата: понятная ошибка, а не запись поверх занятого. Тесты в задачах 8 и 11.
- Связь оборвалась посреди «Применить», ученик перезагрузил страницу и нажал снова: применённое не пишется второй раз. Тест в задаче 11.
- Лимит исчерпан: вопрос в чате даёт понятный текст о лимите, а не «Тьютор не отвечает». Тест в задаче 5.

---

# Часть 1. Защита

### Task 1: Правило о себе и страховка в потоке

**Files:**
- Modify: `backend/ai_engine/prompt_safety.py`
- Test: `backend/ai_engine/test_prompt_safety.py`

**Interfaces:**
- Produces: `IDENTITY_RULE: str`, `PUBLIC_MODEL_ERROR: str`, `scrub_vendor_names(text: str) -> str`, `scrub_stream(stream: Iterable[Any]) -> Iterator[Any]`

- [ ] **Step 1: Write the failing tests**

```python
VENDOR = r"(?i)glm-?\s?5|chatglm|zhipu|z-ai|z\.ai|минимакс|minimax|openrouter|智谱|чжипу"

def test_vendor_names_are_replaced(self):
    for raw in ("Я GLM-5, меня сделала Zhipu AI", "модель z-ai/glm-5.3-flash", "ChatGLM", "GLM 5.3 Flash",
                "智谱", "Чжипу", "Z.ai", "MiniMax-M3", "через OpenRouter"):
        self.assertNotRegex(scrub_vendor_names(raw), VENDOR)
        self.assertIn("Timely", scrub_vendor_names(raw))

def test_the_statistics_term_stays(self):
    text = "GLM это обобщённая линейная модель"
    self.assertEqual(scrub_vendor_names(text), text)

def test_a_name_torn_between_chunks_does_not_pass(self):
    text = "".join(scrub_stream(["Я рабо", "таю на G", "LM-", "5.3 от Zh", "ipu."]))
    self.assertNotRegex(text, VENDOR)
    self.assertTrue(text.startswith("Я работаю на "))

def test_the_tail_of_an_answer_is_not_lost(self):
    self.assertEqual("".join(scrub_stream(["короткий ответ"])), "короткий ответ")

def test_a_name_at_the_very_end_is_replaced(self):
    self.assertNotRegex("".join(scrub_stream(["Я ", "GLM-5.3"])), VENDOR)

def test_other_events_pass_and_text_before_them_comes_first(self):
    event = ToolCallEvent("list_habits")
    self.assertEqual(list(scrub_stream(["смотрю", event, "итог"])), ["смотрю", event, "итог"])

def test_the_identity_rule_does_not_lie(self):
    self.assertIn("ИИ-тьютор Timely", IDENTITY_RULE)
    self.assertIn("не человек", IDENTITY_RULE)
```

- [ ] **Step 2: Run them to see them fail**

Run: `zsh $SP/stand/test-backend.sh ai_engine.test_prompt_safety --parallel 1 ...`. Expected: `FAILED`, импорт не находит новых имён.

- [ ] **Step 3: Implement in `prompt_safety.py`**

- `IDENTITY_RULE` по пунктам раздела «Что говорит о себе» в документе.
- `PUBLIC_MODEL_ERROR = "Тьютор сейчас не отвечает. Попробуй ещё раз через минуту."`.
- Регулярное выражение: `ChatGLM`, `GLM[-\s]?\d[\w.\-]*(?:\s+Flash)?`, `Zhipu(?:\s*AI)?`, `智谱`, `Чжипу`, `Z\.ai`, `z-ai(?:/[\w.\-]+)?`, `MiniMax[-\s]?[\w.]*`, `OpenRouter`, без учёта регистра.
- `scrub_stream`: `held = scrub_vendor_names(held + delta)`, отдаём всё, кроме последних 24 символов (длиннее названий нет). Не строка: сначала отдаём `held`, потом само событие. В конце отдаём остаток.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`.

### Task 2: Подключить правило и страховку к чатам

**Files:**
- Modify: `backend/curriculum/ask.py`, `backend/curriculum/ask_views.py`, `backend/studyplan/chat_views.py`, `backend/ai_engine/skills/chat.py`
- Test: `backend/curriculum/tests/test_ask_api.py`, `backend/curriculum/tests/test_ask.py`, `backend/studyplan/tests/test_chat.py`, `backend/ai_engine/test_tutor_modes.py`

**Interfaces:**
- Consumes: всё из задачи 1.

- [ ] **Step 1: Write the failing tests**

```python
# test_ask.py, оба промпта
self.assertIn(IDENTITY_RULE, build_ask_context(goal=None, question="привет").messages()[0]["content"])
# то же с книгой: goal с готовым документом

# test_ask_api.py
def test_vendor_name_does_not_reach_the_student(self):
    with _stream("Я GLM-", "5.3 от Zhipu"):
        events = _events(self._post())
    text = "".join(data["delta"] for name, data in events if name == "content")
    self.assertNotIn("GLM-5", text); self.assertNotIn("Zhipu", text)

# заменяет проверку в test_отказ_модели_приезжает_событием
self.assertEqual(by_name["error"]["error"], PUBLIC_MODEL_ERROR)  # boom: RuntimeError("404 z-ai/glm-5.3")

# test_chat.py
self.assertIn(IDENTITY_RULE, client.completions.calls[0]["messages"][0]["content"])
# ответ модели "Я GLM-5.3": событие content без "GLM-5"
# исключение провайдера: событие error равно PUBLIC_MODEL_ERROR, лимит по-прежнему as_payload()

# test_tutor_modes.py
self.assertIn(IDENTITY_RULE, CHAT_SYSTEM_PROMPT)
```

- [ ] **Step 2: Run them to see them fail**

Метки: `curriculum.tests.test_ask curriculum.tests.test_ask_api studyplan.tests.test_chat ai_engine.test_tutor_modes`. Expected: `FAILED`.

- [ ] **Step 3: Wire it**

- `AskContext.messages()`: `IDENTITY_RULE` в начале системного сообщения обеих веток.
- `GENERAL_SYSTEM_PROMPT`: раздел «Предметы» заменить на «Курсы и книги».
- `ask_views`: `for delta in scrub_stream(TextModel(...).stream_content(...))`; в `except` текст уходит в лог, клиенту `PUBLIC_MODEL_ERROR`.
- `chat_views`: `IDENTITY_RULE` в `_system_prompt`; `final_text` через `scrub_vendor_names`; в общем `except` клиенту `PUBLIC_MODEL_ERROR`. Ветка `AIUsageLimitExceeded` остаётся.
- `CHAT_SYSTEM_PROMPT` начинается с `IDENTITY_RULE`.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`.

### Task 3: Запросы только туда, где данные не хранят

**Files:**
- Modify: `backend/ai_engine/text_llm.py`, `backend/ai_engine/understand.py`, `backend/curriculum/chat_title.py`, `backend/studyplan/chat_views.py`, `.env.example`
- Test: `backend/ai_engine/test_text_llm.py`, `backend/studyplan/tests/test_chat.py`

**Interfaces:**
- Produces: `private_provider_body() -> dict[str, Any]`, `generate_json_content(..., private: bool = False)`

- [ ] **Step 1: Write the failing tests** (клиент подменяется по образцу `ToolLoopTests`)

```python
def test_stream_goes_only_to_hosts_that_keep_nothing(self):
    ...; self.assertEqual(create_kwargs["extra_body"]["provider"], {"zdr": True})
    self.assertIn("reasoning", create_kwargs["extra_body"])

def test_generate_content_too(self): ...  # то же

def test_json_only_when_asked(self):
    ...  # без private: "provider" нет; private=True: {"zdr": True}
    ...  # providers=("a",), private=True: {"only": ["a"], "sort": "throughput", "zdr": True}

def test_off_by_setting_and_outside_openrouter(self):
    with patch.object(text_llm, "AI_TEXT_ZDR", False): self.assertEqual(text_llm.private_provider_body(), {})
    with patch.object(text_llm, "TEXT_LLM_BASE_URL", "http://127.0.0.1:8200/v1"): self.assertEqual(text_llm.private_provider_body(), {})

# test_chat.py
self.assertEqual(client.completions.calls[0]["extra_body"]["provider"], {"zdr": True})
```

- [ ] **Step 2: Run them to see them fail**

Метки: `ai_engine.test_text_llm studyplan.tests.test_chat`. Expected: `FAILED`.

- [ ] **Step 3: Implement**

- `AI_TEXT_ZDR = os.getenv("AI_TEXT_ZDR", "true").lower() in {"1", "true", "yes"}` рядом с остальными настройками файла.
- `private_provider_body()` возвращает `{"provider": {"zdr": True}}`, если настройка включена и `provider_from_base_url(TEXT_LLM_BASE_URL) == "openrouter"`, иначе `{}`.
- Подмешать в `stream_content`, `generate_content`, прямой вызов помощника плана; в `generate_json_content` только при `private=True`, к существующему `only` добавить `zdr`.
- `understand.py` и `curriculum/chat_title.py` передают `private=True`.
- `AI_TEXT_ZDR=true` в `.env.example` с одной строкой пояснения.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`.

### Task 4: Подписи вместо названия модели

**Files:**
- Modify: `backend/curriculum/ask_models.py`, `src/components/chat/chat-usage.ts`, `src/lib/chat-prefs.ts`, `src/components/chat/composer.tsx`, `src/app/dashboard/settings/page.tsx`
- Test: `backend/curriculum/tests/test_ask_api.py`, `src/components/chat/chat-usage.test.ts`

**Interfaces:**
- Produces: `renamedModelKey(key: string): string`, `usageLine` показывает новые слова для старых записей.

- [ ] **Step 1: Write the failing tests**

```python
self.assertEqual(resolve_choice("glm-5.3-flash").model.key, "fast")
self.assertEqual(resolve_choice("glm-5.3").model.key, "smart")
self.assertEqual(resolve_choice("fast").model.name, "Быстрая")
self.assertNotRegex(json.dumps(ask_options(), ensure_ascii=False), "(?i)glm|z-ai")
```

```ts
assert.equal(renamedModelKey("glm-5.3"), "smart");
assert.equal(renamedModelKey("glm-5.3-flash"), "fast");
assert.equal(renamedModelKey("fast"), "fast");
assert.match(usageLine({ ...USAGE, model_name: "GLM 5.3 Flash" }), /^Быстрая, /);
assert.match(usageLine({ ...USAGE, model_name: "GLM 5.3" }), /^Умная, /);
```

- [ ] **Step 2: Run them to see them fail**

`curriculum.tests.test_ask_api` и `npm run -s test:chat`. Expected: падают.

- [ ] **Step 3: Implement**

- `ask_models.py`: ключи `smart` и `fast`, названия «Умная» и «Быстрая»; `resolve_choice` принимает старые ключи через словарь `_OLD_KEYS`.
- `chat-prefs.ts`: `load()` пропускает `model` через `renamedModelKey`.
- `composer.tsx`: один `<span>` с `currentModel.name`, регулярное выражение убрать вместе с лишним правилом `.model-short`.
- Настройки: «В поле чата: умная или быстрая и уровень рассуждения».

- [ ] **Step 4: Run them to see them pass**

Те же команды плюс `tsc` и `eslint`. Expected: зелёные.

### Task 5: Новый лимит и его проверка в чате

**Files:**
- Modify: `backend/config/settings.py`, `backend/ai_engine/middleware.py`
- Test: `backend/ai_engine/test_usage.py`, `backend/curriculum/tests/test_ask_api.py`

- [ ] **Step 1: Write the failing tests**

```python
self.assertEqual(settings.AI_PLAN_LIMITS["free"]["five_hour"], 150000)
self.assertEqual(settings.AI_PLAN_LIMITS["free"]["weekly"], 500000)
self.assertTrue(_is_metered_request("POST", "/api/curriculum/ask/stream"))
self.assertTrue(_is_metered_request("POST", "/api/curriculum/ask/stream/"))

def test_exhausted_quota_gets_a_clear_refusal_in_chat(self):
    # записать расход сверх лимита, как в test_usage.py
    response = self.client.post(URL, {"message": "привет"}, content_type="application/json", **_auth(OWNER))
    self.assertEqual(response.status_code, 429)
    self.assertEqual(response.json()["code"], "ai_usage_limit_exceeded")
    # По этому слову askErrorText показывает понятный текст о лимите.
    self.assertIn("Лимит", response.json()["error"])
```

- [ ] **Step 2: Run them to see them fail**

Метки: `ai_engine.test_usage curriculum.tests.test_ask_api`. Expected: `FAILED`.

- [ ] **Step 3: Implement**

- Умолчания `AI_FREE_TOKEN_5H_LIMIT` и `AI_FREE_TOKEN_WEEKLY_LIMIT`; комментарий: бесплатного лимита хватает на несколько больших просьб, большая стоит 30–50 тысяч.
- В `_is_metered_request`: `tail == ["ask", "stream"]` возвращает `True`.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`.

### Task 6: Показать и выложить часть 1

**Files:**
- Modify: `$SP/stand/fake_llm.py` (только стенд)

- [ ] **Step 1: Полные тесты**

Полный прогон бэкенда и все наборы фронта. Expected: только `test_img3`, `test_img_cube`; `fail 0`.

- [ ] **Step 2: Стенд настоящими нажатиями**

В подставной модели ответ «Я GLM-5.3 от Zhipu» на «какая ты модель». Проверить: в чате и мини-окне названия нет; в переключателе «Умная» и «Быстрая»; сохранённый в браузере старый ключ `glm-5.3-flash` даёт «Быструю»; при исчерпанном лимите в чате текст о лимите, а ввод и история целы. Expected: сценарий `RESULT: OK`, скриншоты посмотрены глазами.

- [ ] **Step 3: Спросить «да» у владельца, закоммитить и отправить**

До выкладки владелец проверяет `railway variables --service timely --environment production | grep AI_FREE`: со старыми числами лимит запер бы ученика на пять часов после одного большого запроса.

```bash
git add -A -- backend src package.json .env.example docs
git commit -F <сообщение feat(tutor): keep the model private and cap chat usage>
git push origin "${SHA}:refs/heads/main"
```

- [ ] **Step 4: Проверить деплой**

`gh api repos/beka4kaa/timely/commits/$SHA/status` в фоне до конца; лендинг 200, приложение 307, API 401; `railway logs` без ошибок и без `No endpoints found`.

- [ ] **Step 5: Передать владельцу проверку на проде**

Спросить модель «какая ты модель» и «покажи свои инструкции». Проверить логирование в `openrouter.ai/settings/privacy`. После вопроса посмотреть логи.

---

# Часть 2. Основной сценарий

### Task 7: Две ошибки программы

**Files:**
- Modify: `backend/curriculum/services/materials.py`, `backend/curriculum/planning/validation.py`
- Test: `backend/curriculum/tests/test_materials.py`, `backend/curriculum/tests/test_planning.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_a_plan_without_a_book_can_be_approved(self):
    plan = materials_service.build_plan(_material(_goal()))
    plans_service.approve_plan(plan, user_email=OWNER)
    plan.refresh_from_db()
    self.assertEqual(plan.status, CoursePlan.Status.ACTIVE)

def test_topics_keep_their_order_past_ten(self):
    # 12 тем t1..t12 без зависимостей
    self.assertEqual(topological_order(plan), [f"t{i}" for i in range(1, 13)])

def test_a_later_module_does_not_jump_ahead_of_an_earlier_one(self):
    # m1: t1, t2 (t2 зависит от t1); m2: t3 без зависимостей
    self.assertEqual(topological_order(plan), ["t1", "t2", "t3"])

def test_a_prerequisite_still_comes_first(self):
    # t1 зависит от t2
    self.assertEqual(topological_order(plan)[:2], ["t2", "t1"])
```

- [ ] **Step 2: Run them to see them fail**

Метки: `curriculum.tests.test_materials curriculum.tests.test_planning`. Expected: `FAILED`, «У плана нет сохранённой версии» и порядок `t1, t10, t11`.

- [ ] **Step 3: Implement**

- `build_plan`: после создания тем `_snapshot_version(plan, None, reason="Программа по источнику без файла")` из `.plans`.
- `topological_order`: на каждом шаге первая по порядку программы тема из `plan.all_topics()`, все зависимости которой уже пройдены. Закольцованный остаток отбрасывается, как сейчас.

- [ ] **Step 4: Run them to see them pass**

Те же метки плюс `studyplan`: движок читает этот порядок. Expected: `OK`.

### Task 8: `quick_plan`: предмет и занятия

**Files:**
- Create: `backend/studyplan/quick_plan.py`
- Modify: `backend/studyplan/services.py`
- Test: `backend/studyplan/tests/test_quick_plan.py`

**Interfaces:**
- Consumes: `build_plan`, `approve_plan` (задача 7), `generate_schedule`, `busy_intervals`, `commitment_specs`, `calendar_learning_blocks`.
- Produces:

```python
@dataclass(frozen=True)
class QuickPlanRequest:
    user_email: str
    subject: str
    timezone: str
    goal_id: str | None = None
    weekdays: tuple[int, ...] = ()       # пусто: только предмет
    start_time: time | None = None
    minutes: int = 60
    from_date: date | None = None
    to_date: date | None = None

@dataclass(frozen=True)
class QuickPlanResult:
    path: str              # "subject_only" | "new_sessions" | "book_topics" | "extra_sessions"
    goal_id: str
    created_goal: bool
    schedule_id: str | None
    sessions: int
    first_date: date | None
    last_date: date | None
    left_topics: int
    approves_plan: bool
    undo: dict[str, Any]   # JSON-совместимый, отдаётся клиенту и возвращается в undo_quick_plan

class QuickPlanRejected(ValueError):
    code: str              # bad_request | past_period | empty_period | too_long | busy | goal_not_found | already_exists | no_room

def preview_quick_plan(request: QuickPlanRequest) -> QuickPlanResult
def apply_quick_plan(request: QuickPlanRequest) -> QuickPlanResult
def undo_quick_plan(undo: dict[str, Any], *, user_email: str) -> None
# services.py
def confirm_schedule(schedule, *, keep_active_rhythm: bool = False) -> StudySchedule
```

- [ ] **Step 1: Write the failing tests** (`MONDAY = date(2026, 11, 9)`, часы подменены на 2026-11-06, пояс `Asia/Almaty`)

```python
def test_new_subject_gets_one_block_per_day(self):
    result = apply_quick_plan(request(weekdays=(0, 1, 2, 3, 4), from_date=MONDAY, to_date=MONDAY + 4days))
    blocks = list(LearningBlock.objects.filter(schedule_id=result.schedule_id).order_by("start_at"))
    self.assertEqual((result.path, result.sessions, result.created_goal), ("new_sessions", 5, True))
    self.assertEqual([b.duration_minutes for b in blocks], [60] * 5)
    self.assertEqual(blocks[0].title, "Русский язык, занятие 1")
    self.assertEqual(StudySchedule.objects.get(pk=result.schedule_id).status, "active")

def test_time_is_the_students(self):
    # 16:00 в Алматы
    self.assertEqual(first_block.start_at, datetime(2026, 11, 9, 11, 0, tzinfo=timezone.utc))

def test_preview_leaves_nothing(self):
    result = preview_quick_plan(request(...))
    self.assertEqual(result.sessions, 5)
    self.assertFalse(LearningGoal.objects.filter(user_email=OWNER).exists())
    self.assertFalse(StudySchedule.objects.filter(user_email=OWNER).exists())

def test_a_subject_without_a_schedule(self):
    result = apply_quick_plan(request())
    self.assertEqual((result.path, result.schedule_id), ("subject_only", None))

def test_busy_time_blocks_the_card(self):
    # по одному на случай: FixedCommitment в среду 15:30–17:00; блок другого предмета;
    # урок активного шаблона дневника в среду 16:30, block_type="lesson"
    with self.assertRaises(QuickPlanRejected) as caught: preview_quick_plan(request(...))
    self.assertEqual(caught.exception.code, "busy")
    self.assertIn("11 ноября", str(caught.exception))   # и название занятого

def test_calendar_changed_since_preview(self):
    preview_quick_plan(r); FixedCommitment.objects.create(...)
    with self.assertRaises(QuickPlanRejected): apply_quick_plan(r)

def test_bad_periods(self):
    # to_date раньше from_date и нет времени: bad_request; прошлая дата: past_period;
    # ни один день не подходит: empty_period; 121 день: too_long; minutes=5: bad_request

def test_an_existing_schedule_gets_extra_sessions(self):
    first = apply_quick_plan(request(...)); second = apply_quick_plan(request(... следующая неделя))
    self.assertEqual((second.path, second.schedule_id), ("extra_sessions", first.schedule_id))
    self.assertEqual(LearningBlock.objects.filter(schedule_id=first.schedule_id).count(), 10)
    self.assertEqual(last_block.title, "Русский язык, занятие 10")
    self.assertEqual(last_block.source, "manual")

def test_one_day_is_a_single_extra_session(self): ...  # from_date == to_date, sessions == 1

def test_a_book_takes_the_next_topics_for_the_period(self):
    # программа на 30 тем с документом, неделя пн–пт
    self.assertEqual(result.path, "book_topics"); self.assertEqual(result.left_topics, 25)
    self.assertEqual(schedule.status, "active"); self.assertTrue(schedule.feasible)
    topics = list(dict.fromkeys(b.topic.title for b in blocks_by_time))  # у темы несколько частей
    self.assertEqual(topics, ["Тема 1", "Тема 2", "Тема 3", "Тема 4", "Тема 5"])

def test_a_plan_awaiting_approval_is_approved_and_undo_takes_it_back(self): ...
def test_the_first_subject_sets_the_rhythm_and_undo_takes_it_back(self): ...
def test_a_second_subject_keeps_the_active_rhythm(self): ...  # и блоки первого предмета целы
def test_undo_new_subject_removes_everything(self): ...       # goal, план, расписание, блоки
def test_undo_extra_sessions_keeps_the_old_schedule(self): ...
def test_undo_ignores_someone_elses_ids(self): ...            # undo с чужими id ничего не трогает
def test_someone_elses_goal_is_not_found(self): ...           # goal_not_found
```

- [ ] **Step 2: Run them to see them fail**

Метка: `studyplan.tests.test_quick_plan`. Expected: `FAILED`, модуля нет.

- [ ] **Step 3: Implement `quick_plan.py`**

- Выбор пути: `goal_id` или совпадение названия без учёта регистра в Python (`casefold`, SQLite не знает регистра кириллицы). Новый предмет без дней: `subject_only`. Существующий без дней: `already_exists`.
- Программа предмета: самая свежая не архивная, `ACTIVE` в приоритете. Живое расписание (`ACTIVE`, `CONFIRMED`): `extra_sessions`. Программа с `document` без живого расписания: `book_topics`. Иначе `new_sessions`.
- Занятое проверяется до расчёта для всех путей: `busy_intervals(commitment_specs(...))`, `calendar_learning_blocks(email, include_released=False)`, `TemplateLesson` активного `WeeklyTemplate` с `block_type="lesson"`.
- `new_sessions`: `confirm_goal(goal, normalized_subject=subject)`, `StudyMaterial(kind=CUSTOM, total_units=len(days), minutes_per_unit=minutes)`, `build_plan(material, target_session_minutes=minutes, start_date=from_date)`, `approve_plan`, неактивный шаблон с окнами как в `setup.confirm_schedule_setup` (`created_by="assistant"`), `StudySchedule(status=PROPOSED, generation_source="assistant")`, по блоку на день: тема по порядку, `title=f"{subject}, занятие {n}"`, `activity_type`, `workspace_type` по умолчанию модели, `detail_level=OUTLINE`, `source=SCHEDULER`. Затем `confirm_schedule(schedule, keep_active_rhythm=True)`.
- `book_topics`: шаблон так же, `generate_schedule(plan=plan, start_date, end_date, timezone_name, template, provider_key="deterministic", buffer_percentage=0)`. Нет блоков: `no_room`. Иначе `left_topics` равно числу тем без блоков, `conflict_report={}`, `pacing_snapshot["partial_by_period"]=True`, `confirm_schedule(..., keep_active_rhythm=True)`.
- `extra_sessions`: блоки `source=MANUAL`, `topic=None`, номер продолжает счёт неотменённых блоков расписания, `schedule.version += 1`, `end_date=max(...)`.
- `undo` хранит то, что нужно вернуть: `goal_id`, `schedule_id`, `previous_statuses`, `block_ids`, `template_id`, `activated_template`, `unapprove_plan_id`, `end_date`. `undo_quick_plan` работает в транзакции и фильтрует всё по `user_email`.
- `preview_quick_plan`: тот же расчёт в `transaction.atomic()` с `transaction.set_rollback(True)`.
- `ScheduleNotConfirmable` становится `QuickPlanRejected("busy", ...)`.

`confirm_schedule`: при `keep_active_rhythm=True` и уже активном ритме пользователя `_activate_selected_rhythm` не вызывается.

- [ ] **Step 4: Run them to see them pass**

Метки: `studyplan`. Expected: `OK`.

### Task 9: API для применения и отмены

**Files:**
- Modify: `backend/studyplan/serializers.py`, `backend/studyplan/views.py`, `src/lib/studyplan-api.ts`
- Test: `backend/studyplan/tests/test_api.py`

**Interfaces:**
- Consumes: задача 8.
- Produces: `POST /api/study-schedules/quick-plan/` (`subject`, `goal_id?`, `weekdays?`, `start_time?` «ЧЧ:ММ», `minutes?`, `from_date?`, `to_date?`, `timezone`) → `201 {goal_id, schedule_id, sessions, undo}`, ошибка `400 {error, code}`; `POST /api/study-schedules/quick-plan/undo/` (`undo`) → `204`. TS: `applyQuickPlan(fields: QuickPlanFields): Promise<QuickPlanApplied>`, `undoQuickPlan(undo: Record<string, unknown>): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```python
def test_quick_plan_creates_and_undo_removes(self):
    response = self.client.post(URL, BODY, content_type="application/json", **headers())
    self.assertEqual(response.status_code, 201)
    self.assertEqual(response.json()["sessions"], 5)
    gone = self.client.post(f"{URL}undo/", {"undo": response.json()["undo"]}, content_type="application/json", **headers())
    self.assertEqual(gone.status_code, 204)
    self.assertFalse(StudySchedule.objects.filter(user_email=OWNER).exists())

def test_busy_is_a_readable_refusal(self):  # 400, code == "busy", error с датой
def test_without_a_user_nothing_happens(self):  # как _no_user у соседних действий
```

- [ ] **Step 2: Run them to see them fail**

Метка: `studyplan.tests.test_api`. Expected: `FAILED`.

- [ ] **Step 3: Implement**

`QuickPlanSerializer` проверяет типы, смысл проверяет `quick_plan`. Два `@action(detail=False, methods=["post"])` в `StudyScheduleViewSet`, `url_path="quick-plan"` и `"quick-plan/undo"`. `user_email` только из запроса. Ошибки через `_error`.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`, `tsc` чистый.

### Task 10: Инструмент и карточка `propose_study_plan`

**Files:**
- Modify: `backend/curriculum/assistant_tools.py`, `backend/studyplan/tools.py`, `backend/studyplan/chat_views.py`, `src/components/chat/assistant-proposal.ts`, `src/components/chat/assistant-proposal-actions.ts`, `src/lib/studyplan-chat.ts`
- Test: `backend/curriculum/tests/test_assistant_tools.py`, `backend/studyplan/tests/test_tools.py`, `backend/studyplan/tests/test_chat.py`, `src/components/chat/assistant-proposal.test.ts`

**Interfaces:**
- Consumes: `preview_quick_plan`, `applyQuickPlan`, `undoQuickPlan`.
- Produces: вид предложения `study_plan` с полями `subject`, `goal_id`, `is_new`, `path`, `weekdays`, `start_time`, `end_time`, `minutes`, `from_date`, `to_date`, `timezone`, `sessions`, `left_topics`, `approves_plan`; `ProposalUndo.quickPlan?: Record<string, unknown>`.

- [ ] **Step 1: Write the failing tests**

```python
def test_study_plan_only_proposes(self):
    answer = tools.run("propose_study_plan", {"subject": "Русский язык", "weekdays": [0,1,2,3,4],
        "start_time": "16:00", "from_date": MON, "to_date": FRI})
    self.assertTrue(answer["ok"])
    self.assertFalse(LearningGoal.objects.filter(user_email=OWNER).exists())
    proposal = tools.proposals[0]
    self.assertEqual((proposal["kind"], proposal["sessions"], proposal["end_time"], proposal["is_new"]), ("study_plan", 5, "17:00", True))

def test_missing_period_or_time_asks_for_details(self):
    self.assertEqual(tools.run("propose_study_plan", {"subject": "Русский язык", "weekdays": [0]})["error"], "need_details")

def test_conflict_gives_a_reason_and_no_card(self): ...   # error == "busy", proposals == []
def test_one_day_needs_no_weekdays(self): ...             # from == to без weekdays: sessions == 1
def test_add_course_is_gone_from_the_plan_helper(self):
    self.assertNotIn("add_course_to_schedule", ALL_TOOL_NAMES)
def test_courses_name_their_subject(self):
    self.assertEqual(run_list_courses()["courses"][0]["goal_id"], str(goal.pk))
def test_words_open_the_tool(self):
    self.assertIn("propose_study_plan", choose_tools("добавь предмет русский"))
```

```ts
assert.deepEqual(proposalRows(STUDY_PLAN), [
  { name: "Русский язык", note: "новый предмет" },
  { name: "Занятия", note: "по будням, 16:00–17:00, 9–13 ноября, 5 занятий" },
]);
// book_topics: ещё строка { name: "Остальные темы", note: "ещё 25 можно поставить потом" }
// approves_plan: ещё строка { name: "Программа", note: "подтвержу" }
assert.equal(canUndoProposal(STUDY_PLAN), true);
```

- [ ] **Step 2: Run them to see them fail**

Метки: `curriculum.tests.test_assistant_tools studyplan.tests.test_tools studyplan.tests.test_chat`, `npm run -s test:chat`. Expected: падают.

- [ ] **Step 3: Implement**

- `_propose_study_plan` собирает `QuickPlanRequest`, зона `str(ctx.zone)`; дни без периода или времени: `_fail("need_details", "Не хватает периода или времени. Спроси ученика.")`; `from == to` без дней: день недели этой даты; `QuickPlanRejected` становится `_fail(code, message)`.
- Регистрация: `OWN_TOOLS`, `_AREA_TOOLS["schedule"]`, `_AREA_WORDS["schedule"]` со словом `предмет`, `STAGE_LABELS`. `list_courses` дополнительно отдаёт `goal_id`.
- `add_course_to_schedule` и его тесты удалить из `studyplan/tools.py`; в `chat_views` убрать `schedule_proposed`, ответ «Готово…» и строки промпта о нём, вместо них `propose_study_plan`.
- Клиент: заголовок «Настрою предмет:», строки, текст результата, `proposalSummary`; `applyProposal` зовёт `applyQuickPlan`, возвращает `{ quickPlan: undo }`, затем `invalidatePlan()` и сброс кэша каталога; `undoProposal` зовёт `undoQuickPlan`. Ошибка `400` показывает текст сервера.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`, `fail 0`.

### Task 11: Одна карточка на всё

**Files:**
- Create: `src/components/chat/assistant-batch.ts`, `src/components/chat/assistant-batch.test.ts`
- Modify: `src/components/chat/assistant-proposals.tsx`, `src/components/studyplan/revision-cards.tsx`, `src/styles/timely/page-chat.css`, `package.json`, `backend/curriculum/assistant_tools.py`
- Test: `backend/curriculum/tests/test_assistant_tools.py`

**Interfaces:**
- Consumes: `ProposalChange`, `canUndoProposal`, `applyProposal`, `undoProposal`.
- Produces:

```ts
export async function applyAll(
  proposals: AssistantProposal[],
  apply: (proposal: AssistantProposal) => Promise<ProposalUndo>,
  onChange: ProposalChange,
  isStale: (error: unknown) => boolean,
): Promise<AssistantProposal | null> // первый сбой или null
export async function undoAll(
  proposals: AssistantProposal[],
  undo: (proposal: AssistantProposal) => Promise<void>,
  onChange: ProposalChange,
): Promise<AssistantProposal | null>
```

- [ ] **Step 1: Write the failing tests**

```ts
test("пишет по порядку и сохраняет каждое решение", ...);   // порядок вызовов a, b, c; onChange applied с undo
test("останавливается на первом сбое", ...);                // b падает: c не вызван, вернулся b, a применён
test("устаревшее пропускается и названо", ...);             // isStale: b получает state "stale", c применён
test("уже применённое не пишется второй раз", ...);         // a со state "applied": apply не вызван для a
test("отмена идёт в обратном порядке", ...);                // c, b, a
test("отмена пропускает то, что вернуть нельзя", ...);      // canUndoProposal false: undo не вызван
```

```python
self.assertEqual(MAX_PROPOSALS, 10)
def test_a_second_move_for_one_schedule_asks_to_merge(self): ...  # второй propose_move_blocks: error
```

- [ ] **Step 2: Run them to see them fail**

`npm run -s test:chat` (добавить файл в `test:chat` в `package.json`). Expected: падает, модуля нет.

- [ ] **Step 3: Implement**

- `assistant-batch.ts` по интерфейсу, без React.
- `AssistantProposals`: два и больше ожидающих показываются `BatchCard`: заголовок «Сделаю так:», строки всех, «Применить» и «Не надо». Особые виды рисуют содержимое с новым пропом `hideActions` у `RevisionCard`, `CommitmentsCard`, `StudyWindowsCard`.
- Сбой: «Применено 2 из 4. Не вышло: …» с «Повторить» и «Вернуть как было».
- Два и больше применённых: их тексты и одна кнопка «Вернуть как было».
- `MAX_PROPOSALS = 10`, текст ошибки поправить; второй вызов ревизии для того же расписания в ответе: `_fail("one_at_a_time", "Объедини переносы в один вызов.")`.

- [ ] **Step 4: Run them to see them pass**

`test:chat`, метка `curriculum.tests.test_assistant_tools`, `tsc`, `eslint`. Expected: зелёные.

### Task 12: Сводка аккаунта и правила

**Files:**
- Modify: `backend/curriculum/assistant_tools.py`, `backend/studyplan/chat_views.py`
- Test: `backend/curriculum/tests/test_assistant_tools.py`, `backend/studyplan/tests/test_chat.py`

**Interfaces:**
- Produces: `account_summary(ctx: AssistantContext) -> str`, `AssistantTools.account_note() -> str` (`<account>…</account>` или пусто), `SUMMARY_MAX_CHARS = 1500`.

- [ ] **Step 1: Write the failing tests**

```python
def test_summary_knows_the_day(self):
    # привычка, цель, предмет, занятие завтра, урок сегодня
    note = tools.account_note()
    for word in ("Зарядка", "Сдать физику", "Русский язык", "занятие 1"): self.assertIn(word, note)

def test_summary_stays_short(self):   # 40 привычек, 40 целей: len(note) <= 1500, есть «и ещё»
def test_no_email_in_summary_and_read_tools(self):
    # прогнать account_note и все инструменты чтения: OWNER нигде нет
def test_no_ids_in_summary(self):     # uuid и pk привычки в тексте нет
def test_broken_summary_does_not_stop_the_chat(self):
    with patch("curriculum.assistant_tools.account_summary", side_effect=ValueError): self.assertEqual(tools.account_note(), "")

def test_rules_forbid_sending_away(self):
    self.assertIn("не отправляй", tools.system_note())
    self.assertIn("<account>", tools.system_note())

# test_chat.py: системное сообщение помощника содержит <account>
```

- [ ] **Step 2: Run them to see them fail**

Метки: `curriculum.tests.test_assistant_tools studyplan.tests.test_chat`. Expected: `FAILED`.

- [ ] **Step 3: Implement**

- `account_summary` по составу из документа, данные берёт теми же функциями, что инструменты чтения. Предметы: `LearningGoal` и `mind.Subject` одним списком без повторов.
- `system_note()` дополняет правила и сводку. Правила из раздела «Правила для модели»; режим `plan` помощника спрашивает только период и время.
- Помощник добавляет `account_note()` к системному сообщению.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`. Записать в тест размер полного набора инструментов: `assertLessEqual(chars, 20000)`.

### Task 13: Показать и выложить часть 2

- [ ] **Step 1: Полные тесты**

Expected: как в задаче 6.

- [ ] **Step 2: Стенд настоящими нажатиями**

В подставной модели сценарии: «добавь предмет русский и настрой расписание: один русский в день с понедельника до пятницы» сначала без периода (вопрос), потом с периодом. Проверить: одна карточка; после «Применить» 5 блоков в календаре по часу и предмет в «Курсах и книгах»; блок открывается; «Вернуть как было» всё убирает. Карточка на три дела сразу. Мини-окно и помощник плана. Телефон 320 и 390, тёмная тема. Expected: `RESULT: OK`, скриншоты посмотрены.

- [ ] **Step 3: «Да» владельца, коммит, пуш, деплой**

Как в задаче 6: `feat(tutor): set up a subject and its lessons from one request`.

- [ ] **Step 4: Передать владельцу сценарий со скриншота на проде**

После вопроса посмотреть `railway logs`, записать настоящий расход токенов.

---

# Часть 3. Блоки, цели, привычки, темы

### Task 14: Блоки и занятость

**Files:**
- Modify: `backend/curriculum/assistant_tools.py`, `backend/studyplan/tools.py`, `src/components/chat/assistant-proposal.ts`, `src/components/chat/assistant-proposal-actions.ts`, `src/lib/studyplan-chat.ts`
- Test: `backend/curriculum/tests/test_assistant_tools.py`, `backend/studyplan/tests/test_tools.py`, `src/components/chat/assistant-proposal.test.ts`

**Interfaces:**
- Produces: `propose_block_changes {block_ids, action: cancel|restore|pin|unpin}` → вид `block_changes {block_ids, action, titles}`; `propose_commitment_removal {commitment_ids}` → вид `commitment_removal {items}` со снимком; `get_schedule` отдаёт `commitments: [{id, title, when}]`.

- [ ] **Step 1: Write the failing tests**

```python
def test_block_changes_only_propose_and_check_owner(self):
    # блок остаётся scheduled; чужой id: not_found; пустой список и неизвестный action: invalid_arguments
def test_commitment_removal_keeps_a_snapshot(self):
    # в proposal["items"][0] есть title, weekday, start_time, duration_minutes; запись цела
def test_schedule_lists_commitments(self):
    self.assertEqual(run_get_schedule()["commitments"][0]["title"], "Репетитор")
```

```ts
assert.equal(proposalHeading(CANCEL), "Отменю занятия:");
assert.deepEqual(proposalRows(CANCEL), [{ name: "Механика, занятие 3", note: "" }]);
assert.equal(canUndoProposal(CANCEL), true);
```

- [ ] **Step 2: Run them to see them fail**

Expected: падают.

- [ ] **Step 3: Implement**

Применение `cancelBlocks`, `pinBlocks`, `deleteCommitment`; отмена обратным вызовом и `createCommitment` из снимка. После записи `invalidatePlan()`. Регистрация как в задаче 10, область `schedule`.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`, `fail 0`.

### Task 15: Цели и привычки

**Files:**
- Modify: те же, что в задаче 14
- Test: те же

**Interfaces:**
- Produces: `propose_goal_change {goal_id, title?, deadline?, main?, status?: done|archived}` → вид `goal_change {goal_id, title, fields, before}`; `propose_habit_change {habit_id, name?, goal_id?, delete?}` → вид `habit_change {habit_id, name, fields, before, delete}`.

- [ ] **Step 1: Write the failing tests**

```python
def test_goal_change_keeps_the_old_values(self): ...   # proposal["before"]["title"]; запись не изменилась
def test_changes_check_the_owner(self): ...            # чужие id: not_found; пустая правка: invalid_arguments
def test_habit_change_names_the_new_goal(self): ...
```

```ts
assert.deepEqual(proposalRows(DELETE_HABIT), [{ name: "Зарядка", note: "отметки удалятся, вернуть нельзя" }]);
assert.equal(canUndoProposal(DELETE_HABIT), false);
assert.equal(canUndoProposal(RENAME_HABIT), true);
assert.deepEqual(proposalRows(GOAL_DEADLINE), [{ name: "Сдать физику", note: "срок 20 декабря → 1 января" }]);
```

- [ ] **Step 2: Run them to see them fail**

Expected: падают.

- [ ] **Step 3: Implement**

Применение `updateGoal`, `updateHabit`, `deleteHabit`; отмена через `before`. Удаление цели это архив, вернуть можно. `dataChanged("goals")`, `dataChanged("habits")`. Области `goals`, `habits`.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`, `fail 0`.

### Task 16: Темы и предметы

**Files:**
- Modify: те же, что в задаче 14, плюс `src/lib/weak-topics-api.ts`
- Test: те же

**Interfaces:**
- Produces: `propose_topic_change {topic_id, name?, subject?, reviewed?, delete?}` → вид `topic_change`; `propose_subject_change {name, new_name?, delete?}` → вид `subject_change {goal_ids, subject_ids, name, new_name, delete, blocks, topics}`; `list_review_topics` отдаёт `id`; `renameSubject(id, name)` в `weak-topics-api`.

- [ ] **Step 1: Write the failing tests**

```python
def test_topics_have_ids(self): ...
def test_subject_found_in_both_places(self):
    # LearningGoal и mind.Subject «Биология»: оба id в предложении, blocks и topics посчитаны
def test_subject_found_in_one_place(self): ...
def test_unknown_subject_is_not_found(self): ...
def test_nothing_is_written(self): ...
```

```ts
assert.deepEqual(proposalRows(DELETE_SUBJECT), [
  { name: "Биология", note: "удалю 6 занятий и 3 темы на повторение, вернуть нельзя" },
]);
assert.equal(canUndoProposal(DELETE_SUBJECT), false);
```

- [ ] **Step 2: Run them to see them fail**

Expected: падают.

- [ ] **Step 3: Implement**

Применение `patchTopic`, `reviewTopic`, `deleteTopic`, `updateGoal` и `deleteGoal` из `curriculum-api`, `renameSubject`, `deleteSubject`. Отмена темы через `before` с полями `scheduleOf`. Сброс кэшей `topicsChanged`, `subjectsChanged`, каталога и `invalidatePlan()`. Области `topics`, `schedule`.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`, `fail 0`.

### Task 17: Показать и выложить часть 3

- [ ] **Step 1: Полные тесты**

Expected: как в задаче 6.

- [ ] **Step 2: Стенд настоящими нажатиями**

На каждую правку: карточка, «Применить», страница обновилась, «Вернуть как было» либо заранее видно, что вернуть нельзя. Expected: `RESULT: OK`.

- [ ] **Step 3: «Да» владельца, коммит, пуш, деплой**

Как в задаче 6: `feat(tutor): let the slime edit blocks, goals, habits and topics`.

---

# Часть 4. Дневник

### Task 18: Домашка, оценки, заметки

**Files:**
- Modify: `backend/curriculum/assistant_tools.py`, `src/components/diary/use-diary-week.ts`, `src/components/chat/assistant-proposal.ts`, `src/components/chat/assistant-proposal-actions.ts`, `src/lib/studyplan-chat.ts`
- Test: `backend/curriculum/tests/test_assistant_tools.py`, `src/components/chat/assistant-proposal.test.ts`

**Interfaces:**
- Produces: `propose_diary_changes {changes: [{date, lesson_id, homework?, notes?, grade?: {type: retelling|exercises|test, value: 1..5|null}}]}` (до 8) → вид `diary_changes {week_start, changes: [{day_id, lesson_id, slot, subject, date, fields, before}]}`; `patchLessonAt(weekStart, place, change): Promise<void>` в `use-diary-week.ts`.

- [ ] **Step 1: Write the failing tests**

```python
def test_diary_change_keeps_the_old_values_and_writes_nothing(self):
    # before.homework равно старому тексту; DiaryWeek.days не изменился
def test_grade_is_checked(self):         # value=9 и type="x": invalid_arguments
def test_unknown_lesson_is_not_found(self): ...
def test_someone_elses_week_is_not_found(self): ...
```

```ts
assert.deepEqual(proposalRows(DIARY), [{ name: "Физика, 6 ноября", note: "домашка: №12, оценка за тест: 5" }]);
assert.equal(canUndoProposal(DIARY), true);
```

- [ ] **Step 2: Run them to see them fail**

Expected: падают.

- [ ] **Step 3: Implement**

`patchLessonAt` строится на существующем `patchLesson`: `{type, value}` для оценки, `{field, value}` для домашки и заметок, с проверкой, что урок ещё на месте по `slot`. Затем `invalidateResources("now:diary:")` и `dataChanged("diary")`. Отмена теми же вызовами из `before`.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`, `fail 0`.

### Task 19: Школьное расписание

**Files:**
- Modify: те же, что в задаче 18
- Test: те же

**Interfaces:**
- Produces: `propose_school_timetable {lessons: [{weekday: 0..6, number, start, end, subject}]}` → вид `school_timetable {lessons, template_id, before_slots}`.

- [ ] **Step 1: Write the failing tests**

```python
def test_timetable_is_checked(self):   # конец раньше начала, день 9, пустой список: invalid_arguments
def test_timetable_remembers_the_old_one(self): ...  # before_slots равно слотам активного шаблона; запись цела
def test_without_a_template_it_still_proposes(self): ...  # template_id пуст
```

```ts
assert.equal(proposalHeading(TIMETABLE), "Запишу школьное расписание:");
assert.deepEqual(proposalRows(TIMETABLE)[0], { name: "Понедельник", note: "Алгебра 8:30, Физика 9:30" });
```

- [ ] **Step 2: Run them to see them fail**

Expected: падают.

- [ ] **Step 3: Implement**

Клиент находит или создаёт предметы (`findSubject`, `createSubject`), пишет шаблон через `/api/diary/template` (`PUT`, без активного шаблона `POST` и активация). `POST /api/diary/week` не вызывать никогда: он сбрасывает оценки, а неделя без данных и так пересоберётся из шаблона при чтении. Карточка говорит: «Недели с оценками и заданиями останутся как есть». Отмена возвращает `before_slots`.

- [ ] **Step 4: Run them to see them pass**

Expected: `OK`, `fail 0`.

### Task 20: Показать и выложить часть 4

- [ ] **Step 1: Полные тесты и стенд**

Записать домашку и оценку на пустой неделе, перезагрузить страницу: всё на месте. Записать школьное расписание: пустая неделя показывает уроки, неделя с оценками не тронута; русский в занятое уроком время даёт отказ. Expected: `RESULT: OK`.

- [ ] **Step 2: «Да» владельца, коммит, пуш, деплой**

Как в задаче 6: `feat(tutor): let the slime fill in the diary`.

---

# Часть 5. Страница и документы

### Task 21: Страница о конфиденциальности

Нужно от владельца до начала: адрес для вопросов и удаления данных; выключенное логирование запросов и выбранный вариант «ZDR only» в настройках OpenRouter. Требовать хостинги без хранения для всех запросов аккаунта нельзя: разбор книг идёт на моделях, где таких нет.

**Files:**
- Create: `src/app/privacy/page.tsx`
- Modify: `src/lib/host-routing.ts`, `src/middleware.ts`, `src/app/dashboard/settings/page.tsx`, `src/app/page.tsx`, `CLAUDE.md`
- Test: `src/lib/host-routing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
assert.equal(isAppPassthroughPath("/privacy"), true);
assert.equal(toDashboardPath("/privacy"), "/privacy"); // на хосте приложения это не раздел дашборда
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run -s test:routing`. Expected: падает.

- [ ] **Step 3: Implement**

- `/privacy` в списке сквозных путей `host-routing.ts` рядом с `/auth` и `/register` и в списке, который разрешает вход без токена, в `src/middleware.ts`. Страницу открыть на обоих хостах на стенде без входа.
- Текст по пунктам из документа, простым языком, название модели не упоминать, удаление только по письму на адрес владельца.
- Абсолютного неразглашения не обещать. Формулировка цели в программе и ритме занятий и фото еды идут обычным путём, а не только на хостинги без хранения: заново сверить со списком вызовов, какие запросы защищены, и писать только это.
- Ссылки из настроек и подвала лендинга.
- CLAUDE.md §13: модель не называет себя, запросы с данными ученика идут только на хостинги без хранения. §20: строка «Тьютор в делах ученика» по факту.

- [ ] **Step 4: Run it to see it pass**

`test:routing`, `tsc`, `eslint`, сборка. Expected: зелёные.

- [ ] **Step 5: «Да» владельца на текст, коммит, пуш, деплой**

Как в задаче 6: `feat(app): say plainly what the tutor sees and where it goes`.
