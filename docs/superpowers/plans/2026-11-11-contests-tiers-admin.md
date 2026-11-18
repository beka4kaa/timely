# Контесты: PDF, автопроверка, тиры и админка. План работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ученик решает контест: скачивает PDF задач, вводит ответ и сразу видит вердикт, есть таблица и лента попыток. Админ заводит контест в новой админке: тир, рисунок, календарь, задачи с PDF, ответом и баллами.

**Architecture:** Бэкенд остаётся в приложении `accounts`. Правила лежат чистыми функциями в `contest_rules.py`, ответы API собираются вручную в `contest_payloads.py`, чтобы ни одно поле не утекло само. Адреса ученика и админа лежат в `contest_views.py`. PDF хранятся в базе (`ContestFile.data`). Фронт: чистая логика в `src/lib/contest-*.ts` с тестами `node --test`, компоненты в `src/components/arena/`, стили только в `src/styles/timely/page-compete.css`.

**Tech Stack:** Django 6, DRF, pypdfium2 4.30, Next.js 15, React 19, react-day-picker 9, @radix-ui/react-popover, node:test + ts-node.

**Spec:** `docs/superpowers/specs/2026-11-11-contests-tiers-admin-design.md`. Номера «решение N» ниже ссылаются на него.

## Global Constraints

- Работа идёт в worktree `.claude/worktrees/contests-admin`, ветка `claude/contests-admin` от `origin/main` (da1e89f). Чужие файлы не трогать: `curriculum`, `src/components/curriculum`, `backend/mind`, `studyplan`, `CLAUDE.md`.
- `manage.py` в `backend/` репозитория не запускать. Бэкенд гоняется скриптом `$SCR/stand/run-tests.sh test <labels> --parallel 1`, где `SCR=/private/tmp/claude-501/-Users-bekzhan-Documents-proj-timely/a55e9e2d-55c8-4f80-b0f2-6be513728da2/scratchpad`. Скрипт копирует `backend/` без `.env*` и запускает под `env -i` на SQLite.
- `.env` не читать, ничего не скачивать.
- Тексты ученику короткие, на «ты», без канцелярита и лишних тире.
- Дизайн монохромный. Цвет только у плашек, значков тиров и вердиктов. Стекло только у того, что парит: окно календаря.
- CSS страниц только в `src/styles/timely/page-compete.css`, он уже подключён из `index.css`. Класс `.is-off` занят, `.live` тоже.
- Тиры и потолки: 1 Аметист 800, 2 Алмаз 400, 3 Золото 200, 4 Серебро 100, 5 Бронза 50. Тиры 1 и 2 ставят только `is_staff` или `is_superuser`.
- Рисунки: `rings, throw, orbits, waves, sun, grid, cells, stars, triangles, spiral, steps, code`.
- Лимиты: ответ до 100 знаков, вариантов в поле правильного ответа до 300 знаков, 30 попыток на задачу, 3 секунды между попытками в контесте, штраф 5 минут за ошибку, PDF до 10 МБ, текст для разбора до 4000 знаков, задач до 20, название до 120 знаков, описание до 2000.
- Коммиты по ходу работы остаются локальными на ветке. В `main` уходит один сжатый коммит после «да» владельца, с подписью `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Часы ученика спешат или отстают.** Браузер считает, что контест идёт, а сервер отвечает `not_running`. Тогда страница перечитывает контест и показывает его настоящее состояние, а не «Неверно». Тест в задаче 9: `answerErrorText` и сброс кэша.
2. **Двойной «Проверить» или две вкладки.** Баллы начисляются один раз, вторая вкладка видит «Эта задача уже решена». Тесты в задаче 5: путь через `IntegrityError` и повтор после верного.
3. **PDF больше 10 МБ или файл с расширением .pdf, но не PDF.** Ответ 400 с понятным текстом, а не 500. Тест в задаче 3.
4. **Админ в Алматы выбирает 11:00.** В базе 06:00Z, у ученика в Москве на плашке 09:00. Тест в задаче 9: `draftToInput` отдаёт ISO со смещением UTC, `emptyDraft` ставит 11:00 по местному времени.
5. **Скрытый ученик в ленте и таблице.** Он записан как «Участник», адреса и настоящего имени нет ни в одном ответе API. Тест в задаче 6.

---

## Карта файлов

Бэкенд, `backend/accounts/`:

- `contest_rules.py`: создать. Потолки, рисунки, права на тиры, нормализация и сравнение ответов, состояние контеста, проблемы публикации, таблица со штрафом. Без Django ORM.
- `contest_files.py`: создать. Проверка и чтение PDF, ответ с файлом.
- `contest_payloads.py`: создать. Словари для ученика и админа, таблица, лента.
- `contest_views.py`: создать. `ContestViewSet`, `AdminContestViewSet`, `AdminContestFileViewSet`.
- `models.py`: поля `Contest`, `Task`, `TaskSubmission`, модель `ContestFile`.
- `migrations/0009_contest_tiers_files_answers.py`: создать.
- `views.py`: закрыть `/api/tasks/` и запись в `/api/submissions/`, убрать старый `ContestViewSet`, одобрение без двойных баллов.
- `serializers.py`: убрать `ContestSerializer`.
- Тесты: `tests_contest_rules.py`, `tests_contests.py`, `tests_contest_admin.py`, `tests_contest_migration.py`. Поправить `config/test_ownership.py`.

Ещё `backend/config/urls.py` и `backend/demo/content.py`, `world.py`, `visitor.py`, `tests.py`.

Фронт:

- `src/lib/contest-api.ts`: типы и вызовы.
- `src/lib/contest-tiers.ts`, `contest-layout.ts`, `contest-form.ts`: создать.
- `src/lib/contest-view.ts`: убрать цвет по предмету, добавить строки задач, часы ленты, метки состояния.
- `src/lib/contest-pdf.ts`: создать. Скачивание и загрузка PDF.
- Тесты: `src/lib/contest-logic.test.ts`, плюс `compete-views.test.ts`. Скрипт `test:compete` в `package.json`.
- `src/components/arena/`:
  - `tier-emblem.tsx`, `contest-art.tsx` (переписать), `contest-plaques.tsx`, `contest-grid.tsx`;
  - `contest-tasks.tsx`, `contest-standings.tsx`, `contest-attempts.tsx`, `contest-shell.tsx`;
  - `date-time-field.tsx`, `contest-editor.tsx`.
- Страницы:
  - `src/app/dashboard/arena/solve/page.tsx`;
  - `src/app/dashboard/arena/solve/[id]/page.tsx`, `[id]/table/page.tsx`, `[id]/attempts/page.tsx`;
  - `src/app/dashboard/admin/page.tsx`, `admin/contests/new/page.tsx`, `admin/contests/[id]/page.tsx`.
- Ещё: `src/lib/now-feed.ts` и `src/components/now/side-cards.tsx` (ссылка на контест), `src/styles/timely/page-compete.css`, `public/demo/fixtures.json`.

---

### Task 1: Правила контеста

**Files:**
- Create: `backend/accounts/contest_rules.py`
- Test: `backend/accounts/tests_contest_rules.py`

**Interfaces:**
- Produces:
  - константы из Global Constraints: `TIER_CAPS: dict[int, int]`, `TIER_NAMES: dict[int, str]`, `ARTS: tuple[str, ...]`, `MAX_TASKS = 20`, `MAX_ANSWER_LENGTH = 100`, `MAX_EXPECTED_LENGTH = 300`, `MAX_ATTEMPTS_PER_TASK = 30`, `MIN_SECONDS_BETWEEN_ATTEMPTS = 3`, `WRONG_ATTEMPT_PENALTY_MINUTES = 5`, `MAX_PDF_BYTES = 10 * 1024 * 1024`, `REVIEW_TEXT_LIMIT = 4000`, `MAX_TITLE = 120`, `MAX_DESCRIPTION = 2000`;
  - `allowed_tiers(user) -> frozenset[int]`: `is_staff` или `is_superuser` дают 1–5, `is_moderator` даёт 3–5, остальным ничего;
  - `contest_state(start, end, now) -> str`: `"upcoming"`, `"running"` при `start <= now < end`, `"ended"`;
  - `split_variants(expected: str) -> list[str]`, `normalize_answer(text: str) -> str`, `parse_number(text: str) -> Fraction | None`, `answers_match(given: str, expected: str) -> bool`, `first_variant(expected: str) -> str`;
  - `Problem = TypedDict("Problem", code=str, field=str, message=str)`, `TaskDraft = TypedDict("TaskDraft", answer=str, points=int, statement_file=int | None)`;
  - `publish_problems(*, title, start, end, tier, art, tasks: Sequence[TaskDraft], actor, now) -> list[Problem]`;
  - `Attempt = NamedTuple(student_id: int, task_id: int, correct: bool, at: datetime)`;
  - `Standing` (dataclass): `student_id: int, place: int, points: int, penalty: int, solved: int, marks: list[str]`;
  - `standings(task_ids: Sequence[int], points: Mapping[int, int], attempts: Sequence[Attempt], start: datetime) -> list[Standing]`.

- [ ] **Step 1: Написать падающие тесты** в `tests_contest_rules.py` (`SimpleTestCase`):
  - `test_tier_caps_match_the_spec`: `TIER_CAPS == {1: 800, 2: 400, 3: 200, 4: 100, 5: 50}`, `TIER_NAMES[1] == "Аметист"`, `TIER_NAMES[5] == "Бронза"`, `len(ARTS) == 12`;
  - `test_only_staff_set_top_tiers`: staff даёт `{1, 2, 3, 4, 5}`, модератор `{3, 4, 5}`, ученик `frozenset()`. Пользователи берутся из `SimpleNamespace(is_staff=…, is_superuser=…, is_moderator=…)`;
  - `test_numbers_compare_as_numbers`: `answers_match` даёт `True` для пар `("0,75", "3/4")`, `(".75", "0.75")`, `("1 000", "1000")`, `("−2", "-2")`, `("60°", "60")`, `("15.", "15")`;
  - `test_text_ignores_case_spaces_and_yo`: `("  Ёж  ", "еж")` даёт `True`, `("ёж", "уж")` даёт `False`;
  - `test_any_variant_counts`: `answers_match("0,75", "1/2; 0.75")` даёт `True`. Пустой ответ и пустой эталон дают `False`;
  - `test_first_variant`: `first_variant(" 60 ; 60° ") == "60"`;
  - `test_state_boundaries`: в `start` контест `running`, в `end` уже `ended`;
  - `test_publish_problems_lists_every_gap`: у контеста тир 5, задачи `[{answer: "", points: 40, statement_file: None}, {answer: "1", points: 20, statement_file: 7}]` и пустое название. Коды по порядку: `["title", "no_statement", "no_answer", "over_cap"]`, а сообщение потолка `"Сумма 60 больше потолка тира: 50."`;
  - `test_publish_problems_for_dates_and_tier`: конец раньше начала даёт `dates_order`, конец в прошлом даёт `ended`, модератор с тиром 1 получает `tier_forbidden`, рисунок `"x"` даёт `art`, 21 задача даёт `too_many_tasks`, пустой список даёт `no_tasks`, баллы `0` дают `bad_points`;
  - `test_standings_order_and_penalty`: старт в 10:00, задачи `[1, 2]` по 100 и 50 баллов.
    - A решил задачу 1 в 10:20 с одной ошибкой: штраф 25.
    - B решил задачу 1 в 10:10 с тремя ошибками: штраф 25.
    - C решил задачу 2 в 10:05.
    - Итог: A и B делят 1-е место (100 баллов, штраф 25), C 3-й. Отметки C `["none", "solved"]`. У D только неверные попытки: `["tried", "none"]`, 0 баллов, 4-е место.
  - `test_attempts_after_the_first_correct_do_not_count`: неверная попытка после верной не меняет штраф.

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `$SCR/stand/run-tests.sh test accounts.tests_contest_rules --parallel 1`
Expected: ImportError `accounts.contest_rules`.

- [ ] **Step 3: Написать `contest_rules.py`.**
  - `normalize_answer`: NFKC, нижний регистр, `ё→е`; `−`, `–`, `—` заменяются на `-`; знак `°` убирается; пробелы по краям обрезаются, внутри схлопываются в один; точка в конце убирается.
  - `parse_number`: убирает все пробелы, `,` превращается в `.`, принимает `[+-]?\d*\.?\d+` и `a/b` из таких же чисел при `b != 0`. Возвращает `Fraction`, иначе `None`.
  - `answers_match`: если оба значения числа, сравнивает их как числа, иначе сравнивает нормализованные строки.
  - Тексты проблем: `title` «Напиши название.», `dates_order` «Конец должен быть позже начала.», `ended` «Конец уже прошёл.», `tier_forbidden` «Этот тир ставит только владелец.», `art` «Выбери рисунок.», `no_tasks` «Добавь хотя бы одну задачу.», `too_many_tasks` «Задач не больше 20.», `no_statement` «У задачи N нет PDF условия.», `no_answer` «У задачи N нет ответа.», `bad_points` «Баллы задачи N от 1.», `over_cap` «Сумма X больше потолка тира: Y.». В поле `field` лежит `title`, `dates`, `tier`, `art`, `tasks` или `tasks.N`.
  - Места считаются так: одинаковые `(points, penalty)` делят место, следующее место пропускается (1, 1, 3). Внутри одного места порядок по `student_id`.

- [ ] **Step 4: Запустить, PASS.**

- [ ] **Step 5: Локальный коммит** `feat(contests): rules for tiers, answers and standings`.

---

### Task 2: Модели и миграция

**Files:**
- Modify: `backend/accounts/models.py`
- Create: `backend/accounts/migrations/0009_contest_tiers_files_answers.py`
- Test: `backend/accounts/tests_contest_migration.py`

**Interfaces:**
- Consumes: `ARTS`, `TIER_CAPS` из задачи 1, только для `choices`.
- Produces:
  - `ContestFile(data: BinaryField, name: CharField(180), size: PositiveIntegerField, pages: PositiveSmallIntegerField(default=0), sha256: CharField(64), text: TextField(blank, default=""), uploaded_by: FK CustomUser SET_NULL null, created_at: auto_now_add)`;
  - `Contest.tier = PositiveSmallIntegerField(default=5, choices=1..5)`, `Contest.art = CharField(max_length=20, default="rings")`, `Contest.is_published = BooleanField(default=False, db_index=True)`;
  - `Task.position = PositiveSmallIntegerField(default=0)`, `Task.answer = CharField(max_length=300, blank=True, default="")`, `Task.statement_file` и `Task.solution_file`: FK `ContestFile`, `SET_NULL`, `null=True`, `related_name="+"`;
  - `TaskSubmission.contest = FK(Contest, SET_NULL, null=True, blank=True, related_name="submissions")`;
  - ограничение `UniqueConstraint(fields=["student", "task", "contest"], condition=Q(status="approved") & Q(contest__isnull=False), name="one_accepted_answer_per_contest_task")` и индекс `Index(fields=["contest", "created_at"])`;
  - в миграции функции `publish_ended_contests(apps, schema_editor)` и `link_answers_to_contests(apps, schema_editor)`.

- [ ] **Step 1: Написать падающие тесты** (`TestCase`, функции импортируются через `importlib`, как в `ExistingAccountsMigrationTests`):
  - `test_ended_contests_stay_published_and_the_rest_become_drafts`: прошедший контест получает `is_published=True`, будущий и идущий `False`;
  - `test_old_answers_link_to_their_only_contest`: ответ внутри окна единственного контеста задачи привязывается, ответ вне окна нет, ответ по задаче из двух контестов нет;
  - `test_only_the_earliest_accepted_answer_links`: из двух одобренных ответов одного ученика по одной задаче привязан ранний, поздний остаётся с `contest=None`;
  - `test_second_accepted_answer_in_a_contest_is_refused`: вторая строка `approved` с тем же `(student, task, contest)` даёт `IntegrityError`, а вторая `rejected` проходит.

- [ ] **Step 2: Запустить, FAIL** (нет полей и модуля).

- [ ] **Step 3: Поля моделей и миграция.** Порядок операций: `CreateModel`, затем `AddField`, затем `RunPython(publish_ended_contests, noop)` и `RunPython(link_answers_to_contests, noop)`, затем `AddConstraint` и `AddIndex`. Привязка идёт по ответам в порядке `created_at`; окно включает обе границы.

- [ ] **Step 4: Запустить вместе со старыми тестами, PASS.**

Run: `$SCR/stand/run-tests.sh test accounts --parallel 1` и `$SCR/stand/run-tests.sh makemigrations --check --dry-run accounts`
Expected: тесты зелёные, «No changes detected».

- [ ] **Step 5: Локальный коммит** `feat(contests): tiers, art, drafts, files and answers in the models`.

---

### Task 3: PDF: загрузка и скачивание

**Files:**
- Create: `backend/accounts/contest_files.py`
- Create: `backend/accounts/contest_views.py` (пока только `AdminContestFileViewSet`)
- Modify: `backend/config/urls.py`
- Test: `backend/accounts/tests_contest_admin.py` (`ContestFileTests`)

**Interfaces:**
- Produces:
  - `class PdfRejected(Exception)` с полями `code: str` и `message: str`. Коды и тексты: `too_big` «PDF больше 10 МБ.», `not_pdf` «Это не PDF.», `broken` «PDF не открывается.»;
  - `read_pdf(upload) -> PdfInfo`, где `PdfInfo` это dataclass `data: bytes, name: str, size: int, pages: int, sha256: str, text: str`. Имя файла чистится на месте, без импорта из `curriculum`: остаётся последняя часть пути без управляющих символов, до 180 знаков. Ученик это имя не видит, он скачивает `zadacha-N.pdf`. Текст вынимается через `pypdfium2`, не больше `REVIEW_TEXT_LIMIT` знаков. Если `pypdfium2` не импортируется, достаточно подписи `%PDF-`, а `pages` и `text` пустые;
  - `pdf_response(file: ContestFile, download_name: str) -> HttpResponse` с заголовками `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<download_name>"`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`;
  - `POST /api/admin/contest-files/` (multipart, поле `file`) отдаёт `201 {id, name, size, pages}`, `GET /api/admin/contest-files/{id}/` отдаёт PDF. Оба только для `is_admin_or_mod`, иначе `403 {"error", "code": "forbidden"}`.

- [ ] **Step 1: Падающие тесты.** Настоящий PDF собирается в тесте через `pypdfium2.PdfDocument.new()` с одной пустой страницей и сохраняется в `BytesIO`.
  - `test_admin_uploads_a_pdf`: 201, `pages == 1`, у строки `sha256` длиной 64;
  - `test_student_cannot_upload_or_download`: оба адреса дают 403;
  - `test_not_a_pdf_is_refused`: `b"hello"` с именем `a.pdf` даёт 400 `not_pdf`;
  - `test_a_broken_pdf_is_refused`: `b"%PDF-1.4 garbage"` даёт 400 `broken`;
  - `test_too_big_is_refused`: `MAX_PDF_BYTES + 1` байт после `%PDF-` даёт 400 `too_big`;
  - `test_download_headers`: тип, `attachment`, `no-store`, `nosniff`.

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Код.** Вьюсет: `viewsets.ViewSet` с `parser_classes = [MultiPartParser, FormParser]` на `create`. В `urls.py`: `router.register(r"admin/contest-files", AdminContestFileViewSet, basename="admin-contest-files")`.

- [ ] **Step 4: PASS.**

- [ ] **Step 5: Локальный коммит** `feat(contests): PDF upload and download for admins`.

---

### Task 4: Адреса ученика: контесты, задачи и закрытие старых путей

**Files:**
- Create: `backend/accounts/contest_payloads.py`
- Modify: `backend/accounts/contest_views.py` (`ContestViewSet` с `list`, `retrieve`, `statement`, `solution`), `backend/accounts/views.py`, `backend/accounts/serializers.py`, `backend/config/urls.py`
- Modify: `backend/config/test_ownership.py` (`test_author_and_admin_can_change_a_task`: автор-ученик теперь получает 403, админ 200)
- Test: `backend/accounts/tests_contests.py` (`ContestVisibilityTests`, `OldPathsTests`)

**Interfaces:**
- Consumes: `contest_state`, `first_variant`, `REVIEW_TEXT_LIMIT`, `pdf_response`.
- Produces:
  - `ordered_tasks(contest) -> list[Task]` (по `position`, затем `id`);
  - `student_contest(contest, *, now, viewer=None, with_mine=False) -> dict` с ключами `id, title, description, start_time, end_time, tier, art, state, tasks (id задач), task_count, points_total, task_details, created_at`, плюс `mine` при `with_mine`;
    - `task_details` до начала пустой;
    - после начала у каждой задачи `id, number, title, points, has_statement, condition_text`. В `condition_text` текст только у задач без PDF;
    - после конца ещё `answer` (первый вариант), `has_solution`, `review_text`;
    - `mine`: `[{task, attempts, solved, last_answer}]`;
  - `GET /api/contests/` (только `is_published=True`, новые сверху), `GET /api/contests/{id}/` (черновик даёт 404);
  - `GET /api/contests/{id}/tasks/{task_id}/statement/`: до начала 404 с кодом `not_started`, файл называется `zadacha-<number>.pdf`;
  - `GET /api/contests/{id}/tasks/{task_id}/solution/`: до конца 404 с кодом `not_ended`, файл называется `reshenie-<number>.pdf`. Админ скачивает оба файла всегда.

- [ ] **Step 1: Падающие тесты.**
  - `test_drafts_are_hidden`: черновика нет в списке, его детали дают 404;
  - `test_before_start_nothing_about_tasks`: `task_details == []`, в JSON нет текста условия и ответа, скачивание даёт 404;
  - `test_running_shows_tasks_without_answers`: у задачи `number`, `points`, `has_statement=True`. В теле ответа нет строки правильного ответа и нет ключа `answer`;
  - `test_after_end_answers_and_solutions_open`: `answer == "60"` при эталоне `"60; 60°"`, решение скачивается;
  - `test_mine_counts_own_attempts_only`: `mine` считает только попытки самого ученика;
  - `test_legacy_task_text_shows_after_start`;
  - `test_students_cannot_use_task_and_submission_writes`: `GET /api/tasks/`, `POST /api/tasks/`, `POST /api/submissions/`, `PATCH /api/submissions/{id}/` дают 403. `GET /api/submissions/` отдаёт только свои строки;
  - `test_contests_list_refuses_writes`: `POST /api/contests/` даёт 405.

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Код.** В `views.py` у `TaskViewSet` переопределить `check_permissions`: если не `is_admin_or_mod`, бросать `PermissionDenied`. У `TaskSubmissionViewSet` то же для `create`, `update`, `partial_update`, `destroy`. Старый `ContestViewSet` и `ContestSerializer` удалить, импорт в `urls.py` взять из `contest_views`.

- [ ] **Step 4: PASS**, плюс `$SCR/stand/run-tests.sh test accounts config --parallel 1` зелёные.

- [ ] **Step 5: Локальный коммит** `feat(contests): what a student sees, and old write paths closed`.

---

### Task 5: Ответ на задачу

**Files:**
- Modify: `backend/accounts/contest_views.py` (`ContestViewSet.answer`), `backend/accounts/views.py` (`approve`)
- Test: `backend/accounts/tests_contests.py` (`AnswerTests`)

**Interfaces:**
- Consumes: `answers_match`, `contest_state`, `MAX_ANSWER_LENGTH`, `MAX_ATTEMPTS_PER_TASK`, `MIN_SECONDS_BETWEEN_ATTEMPTS`, `is_admin_or_mod`, `current_user`.
- Produces: `POST /api/contests/{id}/answer/` с телом `{task, answer}` → `200 {correct, points, attempt, solved}`. Ошибки приходят как `{error, code}`:
  - `403 no_profile`;
  - `403 admin` «Админы не отвечают в контестах.»;
  - `404 bad_task` «Такой задачи в контесте нет.»;
  - `409 not_running` «Контест сейчас не идёт.»;
  - `400 empty` «Впиши ответ.»;
  - `400 too_long` «Ответ длиннее 100 знаков.»;
  - `409 already_solved` «Эта задача уже решена.»;
  - `429 too_many` «Попыток по этой задаче больше нет.»;
  - `429 too_fast` «Подожди пару секунд.», плюс `retry_after` в секундах;
  - `409 no_answer` «У задачи нет ответа.».

- [ ] **Step 1: Падающие тесты.**
  - `test_correct_answer_adds_points_once`: верный ответ даёт `{correct: True, points: 100, attempt: 1, solved: True}`, `overall_elo` вырос на 100, строка `approved` с `contest`. Повтор даёт 409 `already_solved`, рейтинг не меняется;
  - `test_wrong_answer_is_recorded_and_can_be_retried`: неверный ответ, затем через 3 секунды верный (время подменяется `unittest.mock.patch("accounts.contest_views.timezone.now")`). Во втором ответе `attempt == 2`;
  - `test_too_fast_and_too_many`: вторая попытка через 1 секунду даёт 429 `too_fast`, 31-я попытка даёт 429 `too_many`;
  - `test_only_while_running`: до начала и после конца 409 `not_running`;
  - `test_admins_do_not_answer`: 403 `admin`;
  - `test_task_from_another_contest`: 404 `bad_task`;
  - `test_race_on_the_unique_index_awards_nothing`: `TaskSubmission.objects.create` подменяется так, что бросает `IntegrityError` для `approved`. Ответ 409 `already_solved`, `overall_elo` не изменился;
  - `test_manual_approval_does_not_double_count`: у ученика уже есть `approved` по задаче. Одобрение его же `rejected`-попытки даёт 409 `already_counted` «Уже засчитано.», баллы не меняются.

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Код.** Проверки идут в порядке списка ошибок выше. Запись: `transaction.atomic()`, внутри `TaskSubmission.objects.create(..., status="approved"|"rejected", reviewed_at=now, file_url_or_code=answer)`, а для верного ответа ещё `CustomUser.objects.filter(pk=…).update(overall_elo=F("overall_elo") + task.points)`. `IntegrityError` ловится снаружи блока. В `approve` проверяется близнец `approved` с тем же `(student, task, contest)`, а `IntegrityError` ловится так же.

- [ ] **Step 4: PASS.**

- [ ] **Step 5: Локальный коммит** `feat(contests): check answers and award points once`.

---

### Task 6: Таблица и «Все решения»

**Files:**
- Modify: `backend/accounts/contest_payloads.py`, `backend/accounts/contest_views.py`
- Test: `backend/accounts/tests_contests.py` (`StandingsTests`, `AttemptsTests`)

**Interfaces:**
- Consumes: `standings`, `Attempt`, `on_public_board`, `public_username`.
- Produces:
  - `GET /api/contests/{id}/standings/` → `[{place, name, me, points, solved, penalty, marks}]`. До начала пустой список;
  - `GET /api/contests/{id}/attempts/?mine=1` → `[{id, at, name, me, task, correct}]`, где `at` это секунды от начала, а `task` номер задачи. Новые сверху, не больше 200. До начала пусто;
  - имя: `public_username(user)`, если ученик проходит `on_public_board(viewer)`, иначе `"Участник"`. У самого ученика `me=True` и его публичное имя.

- [ ] **Step 1: Падающие тесты.**
  - `test_table_orders_by_points_then_penalty`: данные как в тесте правил задачи 1, но через API;
  - `test_hidden_student_is_a_participant`: у скрытого ученика `name == "Участник"`. В теле ответа нет ни его адреса, ни имени, ни `username`;
  - `test_feed_never_contains_answers`: строки ответа ученика нет в теле ленты, а ключи строки ровно `{"id", "at", "name", "me", "task", "correct"}`;
  - `test_feed_mine_filter`;
  - `test_nothing_before_start`.

- [ ] **Step 2: FAIL.** **Step 3: Код.** **Step 4: PASS.**

- [ ] **Step 5: Локальный коммит** `feat(contests): live table and the attempts feed`.

---

### Task 7: Админские контесты

**Files:**
- Modify: `backend/accounts/contest_payloads.py` (`admin_contest`), `backend/accounts/contest_views.py` (`AdminContestViewSet`), `backend/config/urls.py`
- Test: `backend/accounts/tests_contest_admin.py` (`AdminContestTests`)

**Interfaces:**
- Consumes: `publish_problems`, `allowed_tiers`, `TIER_CAPS`, `ARTS`, лимиты длины, `ordered_tasks`.
- Produces:
  - `admin_contest(contest, *, now, stats) -> dict` с ключами `id, title, description, start_time, end_time, tier, art, is_published, state, created_at, points_total, tier_cap, participants, attempts, can_delete, locked`. Задачи: `tasks: [{id, number, title, condition_text, answer, points, statement, solution}]`, где `statement` и `solution` это `{id, name, size, pages}` или `null`;
  - `locked` значит, что контест опубликован и уже начался;
  - `GET /api/admin/contests/` (новые сверху, с черновиками), `GET /api/admin/contests/{id}/`;
  - `POST /api/admin/contests/` и `PATCH /api/admin/contests/{id}/` принимают `{title, description, start_time, end_time, tier, art, tasks: [{id?, answer, points, statement_file, solution_file}]}`;
  - `POST /api/admin/contests/{id}/publish/` и `POST /api/admin/contests/{id}/unpublish/`, `DELETE /api/admin/contests/{id}/`;
  - ошибки `{error, code, problems?}`:
    - `403 forbidden`, `403 tier_forbidden`;
    - `400 invalid` с `problems`;
    - `400 not_ready` с `problems`;
    - `409 locked` «После начала задачи, ответы, баллы, тир и начало не меняются.»;
    - `409 started` «Контест уже начался.»;
    - `409 has_answers` «В контесте уже есть ответы.».

- [ ] **Step 1: Падающие тесты.**
  - `test_admin_creates_a_draft_with_tasks`: черновик создан, у задач есть `position`, автор и `status="active"`;
  - `test_publish_checks_the_rules`: без PDF ответ 400 `not_ready` с кодами `no_statement` и `over_cap`. После исправления 200 и `is_published`;
  - `test_moderator_and_top_tiers`: модератор с тиром 1 получает 403 `tier_forbidden`. Он же не может сохранить или удалить контест тира 2, созданный владельцем;
  - `test_published_upcoming_stays_valid`: правка опубликованного контеста, которая превышает потолок, даёт 400 `not_ready`, данные не меняются;
  - `test_locked_after_start`: после начала смена ответа, баллов, тира, начала или PDF условия даёт 409 `locked`. Название, описание, рисунок, конец в будущем и PDF решения меняются;
  - `test_end_cannot_move_after_it_passed`: конец закончившегося контеста не двигается, ответ 409 `locked`;
  - `test_replacing_tasks_keeps_legacy_text_and_cleans_files`: задача с `condition_text` сохраняет текст. Заменённый PDF удаляется, если больше нигде не используется;
  - `test_unpublish_only_before_start`, `test_delete_rules`;
  - `test_list_counts_participants`.

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Код.** Сохранение идёт в `transaction.atomic()`. Задачи без `id` создаются, с `id` обновляются (только задачи этого контеста). Пропавшие отвязываются и удаляются, если не входят в другие контесты и у них нет ответов. Позиции идут по порядку списка. После сохранения удаляются `ContestFile`, на которые больше никто не ссылается. В `urls.py`: `router.register(r"admin/contests", AdminContestViewSet, basename="admin-contests")`.

- [ ] **Step 4: PASS** и `$SCR/stand/run-tests.sh test accounts config --parallel 1` зелёные.

- [ ] **Step 5: Локальный коммит** `feat(contests): admin API for drafts, publishing and tiers`.

---

### Task 8: Демо

**Files:**
- Modify: `backend/demo/content.py`, `backend/demo/world.py`, `backend/demo/visitor.py`, `backend/demo/tests.py`

**Interfaces:**
- Produces:
  - `PAST_CONTEST`: `tier: 2`, `art: "rings"`, баллы задач `60, 70, 80, 90, 100`, ответы `"15"`, `"(−∞; −2] ∪ (1; 2]"`, `"π/6; π/2; 5π/6; 3π/2"`, `"10000"`, `"60"`;
  - `NEXT_CONTEST`: `tier: 3`, `art: "throw"`, баллы `30, 40, 60, 70`, ответы `"20"`, `"4"`, `"2"`, `"6"`;
  - оба контеста опубликованы, у задач стоят `position` и `answer`, ответы демо привязаны к контесту.

- [ ] **Step 1: Тест** `test_contests_are_published_within_caps`: оба контеста опубликованы, сумма баллов каждого не больше `TIER_CAPS[tier]`, у всех ответов на задачи прошлого контеста задан `contest`. Существующие проверки баллов поправить под новые цифры.
- [ ] **Step 2: FAIL.** **Step 3: Код.** **Step 4:** `$SCR/stand/run-tests.sh test demo accounts config --parallel 1`, PASS.
- [ ] **Step 5: Локальный коммит** `feat(demo): contests with tiers and answers`.

---

### Task 9: Клиент API и логика фронта

**Files:**
- Modify: `src/lib/contest-api.ts`, `src/lib/contest-view.ts`, `src/lib/compete-views.test.ts`, `package.json` (`test:compete`)
- Create: `src/lib/contest-tiers.ts`, `src/lib/contest-layout.ts`, `src/lib/contest-form.ts`, `src/lib/contest-pdf.ts`, `src/lib/contest-logic.test.ts`
- Setup: `ln -s /Users/bekzhan/Documents/proj/timely/node_modules node_modules` в worktree. Ссылка в git не попадает.

**Interfaces:**
- Consumes: ответы задач 4–7.
- Produces:
  - **Типы** в `contest-api.ts`: `ContestTier = 1|2|3|4|5`, `ContestArtName` (12 имён), `ContestState`, `ContestTask`, `MyTaskResult`, `Contest`, `AnswerResult`, `StandingRow`, `AttemptRow`, `ContestFileInfo`, `AdminContestTask`, `AdminContest`, `AdminContestInput`, `ContestProblem`. Поля 1:1 с задачами 4–7.
  - **Ошибка**: `class ContestApiError extends Error { status: number; code: string; problems: ContestProblem[] }`.
  - **Вызовы ученика**: `getContest(id)`, `answerTask(contestId, taskId, answer): Promise<AnswerResult>`, `getStandings(id)`, `getAttempts(id, mine: boolean)`.
  - **Вызовы админа**: `listAdminContests()`, `getAdminContest(id)`, `createAdminContest(input)`, `updateAdminContest(id, input)`, `publishAdminContest(id)`, `unpublishAdminContest(id)`, `deleteAdminContest(id)`. Все бросают `ContestApiError`.
  - **PDF** в `contest-pdf.ts`: `downloadContestPdf(contestId, taskId, kind: "statement" | "solution", fileName: string): Promise<void>` (blob и временная ссылка), `downloadAdminPdf(fileId, fileName)`, `uploadContestPdf(file: File): Promise<ContestFileInfo>` (`fetch` с `backendAuthHeaders()` и `FormData`).
  - **Тиры** в `contest-tiers.ts`: `TIERS: readonly TierMeta[]`, где `TierMeta = {tier, name, cap, className: "tier-N"}`; `tierMeta(tier: number): TierMeta` (незнакомый тир даёт 5); `canSetTier(me: Pick<Me, "is_staff">, tier): boolean`; `ARTS: readonly {name: ContestArtName; label: string}[]` с подписями «Кольца», «Траектории», «Орбиты», «Волны», «Солнце», «Сетка», «Соты», «Созвездие», «Треугольники», «Спираль», «Столбики», «Код».
  - **Сетка** в `contest-layout.ts`: `layoutContests<T extends {start_time: string; end_time: string}>(rows: readonly T[], now: Date): {hero: T | null; next: Array<{contest: T; size: "card" | "wide"}>; past: T[]}`.
  - **Форма** в `contest-form.ts`:
    - `TaskDraft = {key, id?, answer, points, statement: ContestFileInfo | null, solution: ContestFileInfo | null, legacyText: string}`;
    - `ContestDraft = {title, description, start: Date, end: Date, tier, art, tasks: TaskDraft[]}`;
    - `emptyDraft(now: Date)`: завтра в 11:00 по местному времени, конец через 3 часа, тир 5, рисунок `rings`, одна пустая задача на 10 баллов;
    - `draftFromAdmin(contest)`, `draftToInput(draft): AdminContestInput` (даты через `toISOString()`);
    - `pointsBudget(draft): {total, cap, over, share}`, `publishBlockers(draft, now, canTopTiers): string[]` с теми же текстами, что на сервере;
    - `durationLabel(start, end)`: «Длится 3 часа», «Длится 1 час 30 минут», «Длится 2 дня», «Конец раньше начала».
  - **Вид** в `contest-view.ts`:
    - `contestStateAt(c, now): ContestState`, `taskRows(c): Array<ContestTask & {mine: MyTaskResult | null}>`;
    - `attemptClock(seconds)`: `"0:42"`, `"1:05"`, `"12:00"` (часы:минуты);
    - `adminBadge(c: AdminContest, now)`: «Черновик», «Через 5 дней», «Завтра», «Сегодня в 11:00», «Идёт, 38 участников», «Прошёл, 41 участник»;
    - `answerErrorText(code)`: тексты сервера, для незнакомого кода «Не получилось проверить. Попробуй ещё раз.»;
    - `contestTone` и `contestArt` по предмету удаляются, их тесты тоже.

- [ ] **Step 1: Падающие тесты** в `contest-logic.test.ts`:
  - тиры: потолки 800, 400, 200, 100, 50 и имена; `canSetTier({is_staff:false}, 2) === false`, `canSetTier({is_staff:false}, 3) === true`;
  - сетка:
    - идущий контест становится `hero` раньше ближайшего будущего;
    - три следующих раскладываются как `card, card, wide`, два как `card, card`;
    - прошедшие идут новые сверху;
    - без идущих и будущих `hero === null`;
  - форма:
    - `emptyDraft(new Date(2026, 10, 11, 15, 0))` даёт начало `2026-11-12 11:00` местного и конец в 14:00;
    - `draftToInput` даёт `start_time === start.toISOString()`;
    - бюджет: задачи по 150, 100 и 100 при тире 2 дают `{total: 350, cap: 400, over: 0}`, при тире 3 `over: 150`;
    - `publishBlockers` перечисляет отсутствие PDF и ответа по номерам и превышение потолка, а для модератора тир 1;
  - `durationLabel` на четырёх случаях выше;
  - `attemptClock(42) === "0:00"`, `attemptClock(2580) === "0:43"`, `attemptClock(3900) === "1:05"`;
  - `answerErrorText("not_running") === "Контест сейчас не идёт."`;
  - `taskRows` склеивает `mine` по `task`;
  - `adminBadge` для черновика, будущего, идущего и прошедшего контеста.

  В `compete-views.test.ts` тесты `contestTone` и `contestArt` удаляются, `contestResult` остаётся.
- [ ] **Step 2:** `npm run test:compete`, FAIL.
- [ ] **Step 3: Код.**
- [ ] **Step 4:** `npm run test:compete`, PASS; `npx tsc --noEmit` без новых ошибок в этих файлах.
- [ ] **Step 5: Локальный коммит** `feat(contests): client, tiers, layout and form logic`.

---

### Task 10: Значки, рисунки, плашки и список контестов

**Files:**
- Create: `src/components/arena/tier-emblem.tsx`, `src/components/arena/contest-plaques.tsx`, `src/components/arena/contest-grid.tsx`
- Rewrite: `src/components/arena/contest-art.tsx`, `src/app/dashboard/arena/solve/page.tsx`
- Modify: `src/lib/now-feed.ts` (у `NextContest` появляется `id`), `src/components/now/side-cards.tsx` (`href={`/dashboard/arena/solve/${contest.id}`}`), `src/lib/now-feed.test.ts`, `src/styles/timely/page-compete.css`

**Interfaces:**
- Consumes: `TIERS`, `tierMeta`, `layoutContests`, `contestResult`, `ownSubmissions`, `countdown`, `contestDate`, `shortDate`, `contestParts`.
- Produces:
  - `TierEmblem({tier, className?})`: SVG `viewBox="0 0 64 64"` с градиентами от `useId()`. Аметист рисуется друзой: три кристалла в середине и два позади под ±45° на тёмном камне. Алмаз огранённый, медали со звездой;
  - `ContestArt({art, size: "hero" | "card" | "mini"})`: один мотив на рисунок, размещение по размеру. Слайм только на `hero` и `card`;
  - `ContestHero({contest, now, href?, badge?})`, `ContestCard({contest, now, wide?, href, badge?})`, `ContestMini({contest, href, result?, badge?})`;
  - `ContestGrid({contests, now, hrefOf, badgeOf?, resultOf?})`: внутри `layoutContests`. Прошедшие показываются по 8, ниже «Показать ещё»;
  - CSS: `.tier-1 … .tier-5` задают `--d`, `--m`, `--t` (цвета из макета 6: `#2f0f66/#8a4fe0/#e4cfff`, `#0a3366/#2f86d6/#c8e8ff`, `#6e3104/#e3861c/#ffe0a3`, `#33363f/#8d93a3/#f1f3f8`, `#4a210d/#a8622f/#ffd3b2`). Ещё `.tier-pill`, `.stub-tier`, `.plq-wide`, `.admin-badge`, `.is-draft`.

- [ ] **Step 1: Тест** в `now-feed.test.ts`: ближайший контест несёт `id`.
- [ ] **Step 2:** `npm run test:now`, FAIL. **Step 3: Код.** **Step 4:** `npm run test:now` и `npm run test:compete`, PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Локальный коммит** `feat(contests): tier emblems, twelve pictures and the contest grid`.

---

### Task 11: Страница контеста

**Files:**
- Create: `src/components/arena/contest-shell.tsx`, `contest-tasks.tsx`, `contest-standings.tsx`, `contest-attempts.tsx`
- Create: `src/app/dashboard/arena/solve/[id]/page.tsx`, `[id]/table/page.tsx`, `[id]/attempts/page.tsx`
- Modify: `src/styles/timely/page-compete.css`

**Interfaces:**
- Consumes: `getContest`, `answerTask`, `getStandings`, `getAttempts`, `downloadContestPdf`, `taskRows`, `answerErrorText`, `attemptClock`, `reviewPrompt` (берёт `review_text`, если он есть), `useResource`, `invalidateResources`, `useAskRail`.
- Produces:
  - `ContestShell({id, tab: "tasks" | "table" | "attempts", children})`: «Контесты» назад, билет, описание, вкладки-ссылки `.cx-tabs`;
  - кэш-ключи `compete:contest:<id>` (ttl 15 с, пока контест идёт, иначе 60 с), `compete:standings:<id>`, `compete:attempts:<id>:<all|mine>` (ttl 15 с). Верный ответ сбрасывает `compete:contest:<id>`, `compete:standings:<id>`, `compete:attempts:<id>` и `compete:submissions`;
  - `ContestTasks`:
    - до начала строка «Задачи откроются …»;
    - во время контеста строки с иконкой скачивания, баллами, полем и «Проверить». Кнопка выключена, пока идёт запрос;
    - на `not_running` контест перечитывается;
    - после конца видны правильный ответ, «Решение» и «Разобрать с тьютором».

- [ ] **Step 1:** логика уже покрыта задачей 9. Здесь сборка: `npx tsc --noEmit`, `npm run test:compete`.
- [ ] **Step 2: Код страниц и компонентов.**
- [ ] **Step 3:** `npx tsc --noEmit`, eslint на новых файлах по рецепту из памяти (`npx eslint --no-eslintrc -c .eslintrc.json …`).
- [ ] **Step 4: Локальный коммит** `feat(contests): contest page with tasks, table and attempts`.

---

### Task 12: Админка и редактор

**Files:**
- Create: `src/components/arena/date-time-field.tsx`, `src/components/arena/contest-editor.tsx`
- Create: `src/app/dashboard/admin/contests/new/page.tsx`, `src/app/dashboard/admin/contests/[id]/page.tsx`
- Rewrite: `src/app/dashboard/admin/page.tsx`. Вкладки «Контесты», «Участники», «Решения» в новом дизайне. Логику вкладок «Участники» и «Решения» переносить как есть, меняется только вёрстка.
- Modify: `src/styles/timely/page-compete.css`

**Interfaces:**
- Consumes: всё из задачи 9, `ContestGrid`, `ContestCard`, `TierEmblem`, `ContestArt`, `listAdminUsers`, `updateAdminUserAccess`, `listMySubmissions`, `approveSubmission`, `rejectSubmission`.
- Produces:
  - `DateTimeField({label, value: Date, onChange(next: Date), min?: Date})`: `Popover` с `DayPicker` (`mode="single"`, неделя с понедельника, локаль `ru` из `date-fns`). Время: кнопки 09:00, 10:00, 11:00, 12:00, 15:00, 18:00 и поле `HH:MM`;
  - `ContestEditor({initial?: AdminContest, canTopTiers: boolean})`:
    - тир, рисунок, название, описание, даты с `durationLabel`;
    - задачи: загрузка PDF через `uploadContestPdf`, ответ, баллы, решение, «Добавить задачу»;
    - бюджет и кнопки;
    - справа «Так увидят ученики».

    При `locked` закрытые поля только для чтения, с подписью «После начала не меняется». Ошибки сервера ложатся под поле по `problem.field`.
  - Вкладка «Контесты»: `ContestGrid` с `adminBadge` и черновиками, кнопка «Новый контест».

- [ ] **Step 1:** `npx tsc --noEmit` и `npm run test:compete` зелёные до правок.
- [ ] **Step 2: Код.**
- [ ] **Step 3:** `npx tsc --noEmit`, eslint на новых и изменённых файлах.
- [ ] **Step 4: Локальный коммит** `feat(contests): admin panel with the grid and the contest editor`.

---

### Task 13: Снимок демо и полная проверка

**Files:**
- Modify: `public/demo/fixtures.json` (ключи `B /api/contests/` и `B /api/submissions/` переводятся в новый вид, у контестов `tier`, `art`, `state`, `task_details`, `points_total`)

- [ ] **Step 1:** правка снимка скриптом на Python в скретчпаде, который читает и пишет JSON. Затем `npm run test:demo`, PASS.
- [ ] **Step 2: Полный прогон.**
  - Бэкенд: `$SCR/stand/run-tests.sh test --parallel 1`. Падать могут только `test_img3` и `test_img_cube`, как раньше.
  - Фронт:
    - `npx tsc --noEmit`;
    - `npm run test:compete`, `test:now`, `test:demo`, `test:auth`;
    - eslint на изменённых файлах;
    - `next build` в rsync-копии со ссылкой на `node_modules`.
- [ ] **Step 3: Локальный коммит** `chore(demo): contest snapshot in the new shape`.

---

### Task 14: Стенд и показ владельцу

- [ ] **Step 1:** запустить стенд с настоящим бэкендом по рецепту из памяти `backend-test-setup`, на `127.0.0.1`. Нужны `TIMELY_API_JWT_SECRET` у обоих и `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`. `dev@example.com` сделать staff. Отдельного ученика с подписанным токеном завести в другой вкладке на `localhost`.
- [ ] **Step 2:** в админке создать контест тира 2 с двумя PDF, опубликовать и сдвинуть начало в прошлое через редактор черновика до публикации. Учеником ответить неверно, потом верно. Проверить таблицу, ленту, баллы в рейтинге и вид после конца.
- [ ] **Step 3:** скриншоты на 1280 и 735 пикселях: сетка ученика, страница контеста, таблица, лента, админская сетка, редактор с открытым календарём.
- [ ] **Step 4:** если владелец разрешит, проверить гонку двух верных ответов на временном Postgres из уже лежащего на диске колеса `pgserver`.

---

### Task 15: Выкладка

- [ ] **Step 1:** сжать ветку в один коммит поверх свежего `origin/main` (`git fetch`, `git rebase origin/main`, `git reset --soft origin/main`, один `git commit`). Заголовок `feat(contests): PDF tasks with instant checks, tiers and a new admin`, английский список изменений и подпись.
- [ ] **Step 2:** спросить владельца: «Коммитим и пушим в main?». Пушить только после «да»: `git push origin "HEAD:refs/heads/main"`.
- [ ] **Step 3:** дождаться зелёного `Vercel` и `positive-dedication - timely` в `gh api repos/beka4kaa/timely/commits/<sha>/status`. Затем проверить через curl, что лендинг отдаёт 200, а `/api/contests/` на Railway тоже 200.
