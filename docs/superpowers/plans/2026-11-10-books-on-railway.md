# Книги на Railway (Часть 1): план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Книги снова обрабатываются в продакшене. Векторы лежат в основной базе Railway как `halfvec`, книги обрабатывает воркер Celery с Redis, файлы живут в S3 и удаляются вместе с книгой. Лимит ученика тратят только сканы и программа, и книга никогда не висит.

**Architecture:** Вторая база уходит из кода. Две миграции создают таблицу кусков, если её нет, и переводят вектор в `halfvec(1536)`. Учёт лимита получает два новых понятия:

- немеренные записи: эмбеддинги пишутся в журнал, но в окна не входят;
- предоплаченный резерв: распознавание сканов и программа резервируют сумму заранее, а их вызовы расходуют этот резерв и сверх него не резервируют.

Воркер шлёт пульс из фонового потока. Зависание считается по пульсу, а книга в очереди за чужой книгой зависшей не считается.

**Tech Stack:** Django 6, DRF, Python 3.12, PostgreSQL + pgvector 0.8, pgvector-python 0.4.1 (`HalfVectorField`, `HalfVector`), psycopg2, Celery 5.4 + Redis 5.2, boto3 (S3/R2); Next.js 15, TypeScript, `node --test` с `ts-node`.

**Spec:** `docs/superpowers/specs/2026-11-09-subjects-books-and-setup-guide-design.md`. Нужны: Часть 1 (решения 5–18), «Как устроено → Часть 1», «Токены и лимит → Книги», «Проверка → обработка книги», «Что нужно от владельца», «Что поменять в CLAUDE.md».

## Global Constraints

- Работа идёт прямо в `main`: это постоянное правило владельца.
  - Код Части 1 уходит одним коммитом в задаче 16 и только после явного «да» владельца. Пуш тоже после «да».
  - PR не делаем.
  - Подпись коммита: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Стиль: conventional subject, английское тело списком.
- В рабочем дереве лежат чужие незакоммиченные правки Части 5: `CLAUDE.md`, `src/app/privacy/`, `src/app/dashboard/settings/page.tsx`, `src/app/page.tsx`, `src/lib/host-routing*.ts`, `src/middleware.ts`. Их не трогать и не коммитить: `git add` только по спискам файлов задач.
- `manage.py` в `backend/` репозитория не запускать, `.env` не читать. `backend/.env.example` — шаблон без секретов, его править можно.
- Модель сама ничего не пишет (CLAUDE.md §3.3).
- Бесплатный лимит: 150 000 токенов за 5 часов и 500 000 в неделю. Счёт страницы-скана — `max(реальные токены, 4000)` (`AI_IMAGE_TOKEN_CHARGE`).
- Не больше 40 страниц-сканов за обработку (`MAX_OCR_PAGES_PER_RUN`), продолжения нет.
- Эмбеддинги: `openai/text-embedding-3-small`, 1536 измерений. Вектор вопроса идёт только на хостинги без хранения (`private=True`), куски книги — обычным путём.
- Вектор вопроса: таймаут 12 с и одна попытка. Индексация книги: прежние `EMBEDDING_TIMEOUT` (180 с) и 3 попытки.
- Предел задачи воркера — 1 час: `CELERY_TASK_TIME_LIMIT=3600`, мягкий `CELERY_TASK_SOFT_TIME_LIMIT=3540`. Оба уже в settings.
- Недостающие векторы ставятся в очередь не чаще раза в 10 минут на книгу.
- Режим `inline` в продакшене не используется: дефолт `CURRICULUM_INGEST_MODE=celery` вне тестов не меняется.
- Тексты для ученика: коротко, на «ты», без канцелярита и лишних тире.
- CSS страниц только через `src/styles/timely/index.css`. Страничные `page-*.css` подключены там.

## Команды

`SP=/private/tmp/claude-501/-Users-bekzhan-Documents-proj-timely/b14e9f8d-1ffb-4f1f-84dc-1d83b1dc5904/scratchpad`

- **Тесты бэкенда по меткам:**
  `zsh $SP/stand/test-backend.sh <метки> --parallel 1 > $SP/stand/t.log 2>&1; grep -nE '^(Ran |OK|FAILED|ERROR: |FAIL: )' $SP/stand/t.log`
- **Полный прогон:** та же команда без меток. Допустимы только ошибки `test_img3` и `test_img_cube`.
- **Тесты на Postgres:** перед той же командой ставится `STAND_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres`. Стенд Postgres поднимается в задаче 0.
- **Нет пропущенных миграций:** `zsh $SP/stand/manage.sh makemigrations --check --dry-run` → `No changes detected`.
- **Фронт:**
  - `npx tsc --noEmit | grep -v '\.next/types'` — пусто;
  - `npx eslint <файлы>` — пусто;
  - `npm run -s test:curriculum` и `npm run -s test:chat` — `fail 0`.

## Review Focus

1. **Сканы вперемешку с текстом, а лимита на сканы нет.** Книга готова по страницам с текстом, ни одна страница-скан не распознана, у книги строка «Не распознано…». Тест `test_mixed_book_without_limit_is_ready_by_text_pages` в задаче 8.
2. **Ученик много раз спрашивает по книге с недописанными векторами, а брокер лежит.** В очередь уходит одна задача на 10 минут, поиск отвечает как обычно. Тест `test_broker_failure_does_not_break_search` в задаче 10.
3. **Разбор глав идёт в пуле потоков.** Каждый поток расходует резерв разбора и сверх него не резервирует, а расход пишется ученику. Тест `test_profiling_threads_draw_on_the_profiling_reserve` в задаче 9.
4. **Книгу удалили, пока она стоит в очереди.** Файл удаляется после коммита, задача воркера видит, что документа нет, и выходит. Сбой хранилища при удалении уходит только в лог. Тест `test_deleting_a_queued_book_removes_the_file_and_the_task_skips` в задаче 11.
5. **Время восстановления лимита в строке книги.** `reset_at` приходит в UTC, а ученик видит своё местное время, и «сегодня» и «завтра» считаются по его дате. Тест «resetPhrase считает сегодня и завтра по местной дате» в задаче 15.

---

### Задача 0: Стенд

**Files:** только `$SP/stand/*` и `$SP/pg/*`, вне репозитория.

- [ ] **Step 1: venv на Python 3.12**

```bash
mkdir -p $SP/stand && ~/.local/share/uv/python/cpython-3.12.16-macos-aarch64-none/bin/python3.12 -m venv $SP/stand/venv && $SP/stand/venv/bin/pip install -q -r /Users/bekzhan/Documents/proj/timely/backend/requirements.txt
```

Expected: без ошибок. Проверка: `$SP/stand/venv/bin/python -c "from pgvector.django import HalfVectorField; from pgvector import HalfVector; print(HalfVector([1, 2]).to_list())"` печатает `[1.0, 2.0]`.

- [ ] **Step 2: скрипты стенда**

`$SP/stand/test-backend.sh` синхронизирует бэкенд в копию и гоняет тесты:

```zsh
#!/bin/zsh
set -e
SP=/private/tmp/claude-501/-Users-bekzhan-Documents-proj-timely/b14e9f8d-1ffb-4f1f-84dc-1d83b1dc5904/scratchpad
rsync -a --delete --exclude '.env*' --exclude '__pycache__' --exclude 'db.sqlite3' --exclude '.curriculum-storage' \
  /Users/bekzhan/Documents/proj/timely/backend/ $SP/stand/backend/
cd $SP/stand/backend
exec env -i PATH=/usr/bin:/bin HOME=$SP/stand \
  DATABASE_URL="${STAND_DATABASE_URL:-sqlite:///$SP/stand/test.sqlite3}" \
  $SP/stand/venv/bin/python manage.py test "$@"
```

`$SP/stand/manage.sh` — то же самое, только последняя строка `manage.py "$@"` вместо `manage.py test "$@"`.

- [ ] **Step 3: базовый прогон**

Run: полный прогон (см. «Команды»).
Expected: ошибки только `test_img3` и `test_img_cube`. Число тестов записать в журнал: это база для задачи 16.

- [ ] **Step 4: Postgres с pgvector**

Сначала спросить владельца: «Скачать pgserver 0.1.4 (колесо с PyPI, 9.8 МБ: Postgres 16.2 с pgvector) для проверки `halfvec` на настоящем Postgres?»

Если владелец согласен:

```bash
mkdir -p $SP/pg && $SP/stand/venv/bin/pip download pgserver==0.1.4 --no-deps --only-binary=:all: --platform macosx_11_0_arm64 --python-version 3.12 -d $SP/pg && cd $SP/pg && unzip -qo pgserver-0.1.4-*.whl -d wheel
$SP/pg/wheel/pgserver/pginstall/bin/initdb -D $SP/pg/data -U postgres --auth=trust
$SP/pg/wheel/pgserver/pginstall/bin/pg_ctl -D $SP/pg/data -o "-p 55432 -k $SP/pg -c listen_addresses=127.0.0.1" -l $SP/pg/log start
$SP/pg/wheel/pgserver/pginstall/bin/psql -h 127.0.0.1 -p 55432 -U postgres -Atc "create extension if not exists vector; select extversion from pg_extension where extname = 'vector'"
```

Expected: версия `0.7.0` или выше.

Если владелец отказал или версия ниже 0.7, Postgres-тесты задач 2–3 не гоняются. Это решение записывается в журнал строкой `Ruling:`, а проверку берёт на себя шаг 12 в задаче 17.

---

### Задача 1: Вторая база уходит из кода (решение 7)

**Files:**
- Delete: `backend/curriculum/routers.py`, `backend/curriculum/management/commands/curriculum_init_vector_db.py`, `backend/curriculum/management/commands/curriculum_move_vectors.py`, `backend/curriculum/tests/test_vector_routing.py`
- Modify: `backend/config/settings.py:167-205` (блок `VECTOR_DB_*` и `DATABASE_ROUTERS`), `backend/.env.example` (блок `VECTOR_DB_URL`)
- Modify (только комментарии про «другую базу»): `backend/curriculum/models.py:756-771`, `backend/curriculum/services/search.py:55-57`, `backend/curriculum/services/ingestion.py:994-1000`, `backend/curriculum/views.py:356-357`
- Test: `backend/curriculum/tests/test_single_database.py` (новый)

**Interfaces:**
- Produces: в `settings.DATABASES` только `default`, `DATABASE_ROUTERS == []`. `KnowledgeChunk.document_id/section_id/task_id` остаются UUID без внешних ключей, удаление по-прежнему держат сигналы.

- [ ] **Step 1: тест**

```python
class SingleDatabaseTests(SimpleTestCase):
    def test_only_the_default_database_is_configured(self):
        self.assertEqual(set(settings.DATABASES), {"default"})

    def test_no_database_router(self):
        self.assertEqual(list(settings.DATABASE_ROUTERS), [])
```

- [ ] **Step 2: запустить, убедиться в падении**

Run: `curriculum.tests.test_single_database`.
Expected: FAIL, в `DATABASES` есть `vector_db`.

- [ ] **Step 3: убрать алиас, роутер, две команды и их тест.** В settings на месте блока остаётся одна строка комментария: куски лежат в основной базе.

- [ ] **Step 4: зелёный прогон**

Run: `curriculum` целиком.
Expected: OK. `grep -rn "vector_db\|VECTOR_DB\|VectorDatabaseRouter" backend --include='*.py'` пусто.

---

### Задача 2: Таблица кусков, если её нет (шаг 5 Части 1)

**Files:**
- Create: `backend/curriculum/migrations/0017_chunk_table_if_missing.py`
- Test: `backend/curriculum/tests/test_vector_schema_pg.py` (новый, только Postgres)

**Interfaces:**
- Produces: миграция `0017_chunk_table_if_missing`, функция `ensure_chunk_table(apps, schema_editor) -> None`. Обратная операция ничего не делает.

- [ ] **Step 1: тест** (`@skipUnless(connection.vendor == "postgresql", "нужен Postgres")`, класс `TestCase`)

```python
def test_missing_chunk_table_is_created_with_both_indexes(self):
    migration = importlib.import_module("curriculum.migrations.0017_chunk_table_if_missing")
    with connection.cursor() as cursor:
        cursor.execute("DROP TABLE curriculum_knowledgechunk CASCADE")
    with connection.schema_editor() as editor:
        migration.ensure_chunk_table(django_apps_at("curriculum", "0016_studymaterial_courseplan_material_and_more"), editor)
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass('public.curriculum_knowledgechunk') is not null")
        self.assertTrue(cursor.fetchone()[0])
        cursor.execute("select indexname from pg_indexes where tablename = 'curriculum_knowledgechunk'")
        names = {row[0] for row in cursor.fetchall()}
    self.assertIn("curriculum_chunk_embedding_hnsw", names)
    self.assertIn("curriculum_chunk_fts_ru_gin", names)

def test_existing_table_is_left_alone(self):
    KnowledgeChunk.objects.create(document_id=uuid.uuid4(), normalized_text="текст", content_hash="h")
    migration = importlib.import_module("curriculum.migrations.0017_chunk_table_if_missing")
    with connection.schema_editor() as editor:
        migration.ensure_chunk_table(django_apps_at("curriculum", "0016_studymaterial_courseplan_material_and_more"), editor)
    self.assertEqual(KnowledgeChunk.objects.count(), 1)
```

`django_apps_at(app, name)` — помощник в этом же файле: `MigrationExecutor(connection).loader.project_state((app, name)).apps`.

- [ ] **Step 2: запустить на Postgres, убедиться в падении**

Expected: ERROR, модуля `0017_chunk_table_if_missing` нет. Без Postgres-стенда задача проверяется только шагом 4.

- [ ] **Step 3: миграция** (зависит от `0016_studymaterial_courseplan_material_and_more`)

`ensure_chunk_table` работает только при `connection.vendor == "postgresql"`:

1. Расширение ставится функцией `ensure_vector_extension` из `0003_chunk_embeddings` (через `importlib`).
2. Если `to_regclass('public.curriculum_knowledgechunk')` пуст, таблица создаётся вызовом `schema_editor.create_model(apps.get_model("curriculum", "KnowledgeChunk"))`. Это историческое состояние `0016`, то есть `vector(1536)`.
3. В обоих случаях выполняются `CREATE_INDEX_SQL` из `0003` и SQL индекса из `0006`. В обоих есть `IF NOT EXISTS`.

- [ ] **Step 4: зелёный прогон**

Run: `curriculum.tests.test_vector_schema_pg` на Postgres; `curriculum` на SQLite; `makemigrations --check`.
Expected: OK, OK, `No changes detected`.

---

### Задача 3: Векторы как `halfvec(1536)` (решение 8)

**Files:**
- Modify: `backend/curriculum/models.py:30,816` (`HalfVectorField`)
- Create: `backend/curriculum/migrations/0018_chunk_embedding_halfvec.py`
- Modify: `backend/curriculum/embeddings.py` (новый `vector_as_list`), `backend/curriculum/services/embedding_index.py:89-91`, `backend/curriculum/retrieval.py:521-533`
- Test: `backend/curriculum/tests/test_embeddings.py`, `backend/curriculum/tests/test_vector_schema_pg.py`

**Interfaces:**
- Produces: `KnowledgeChunk.embedding: HalfVectorField(dimensions=1536, null=True, blank=True)`, `vector_as_list(value) -> list[float]` в `curriculum/embeddings.py`. Функция принимает `None`, `list`, numpy-массив и `HalfVector` и отдаёт `[]` или список float.

- [ ] **Step 1: тесты**

В `test_embeddings.py`:

```python
def test_embedding_column_is_half_precision(self):
    field = KnowledgeChunk._meta.get_field("embedding")
    self.assertIsInstance(field, HalfVectorField)
    self.assertEqual(field.db_type(connection), "halfvec(1536)")

def test_reused_vector_survives_the_half_precision_column(self):
    document = make_document()
    ready = make_chunk(document, "сила", content_hash="same")
    KnowledgeChunk.objects.filter(pk=ready.pk).update(
        embedding=[0.25] * 1536, embedding_model=FakeEmbeddingProvider.model,
        embedding_status=KnowledgeChunk.EmbeddingStatus.READY)
    fresh = make_chunk(document, "сила", content_hash="same")
    index_document_chunks(document, provider=FakeEmbeddingProvider(), chunk_ids=[fresh.pk])
    fresh.refresh_from_db()
    self.assertEqual(vector_as_list(fresh.embedding), [0.25] * 1536)
```

В `test_vector_schema_pg.py`:

- `test_embedding_column_is_halfvec`: `format_type(atttypid, atttypmod)` колонки `embedding` равен `halfvec(1536)`.
- `test_hnsw_index_uses_halfvec_cosine_ops`: `indexdef` индекса `curriculum_chunk_embedding_hnsw` содержит `halfvec_cosine_ops`.
- `test_dense_search_finds_the_nearest_chunk`:
  - два READY-куска с векторами `[1, 0, 0, …]` и `[0, 1, 0, …]`;
  - провайдер, который на вопрос отдаёт `[1, 0, 0, …]`;
  - `PgVectorDenseRetriever(provider=…).search("вопрос", candidates, limit=2)` ставит первый кусок первым.

Если поле `FakeEmbeddingProvider.model` называется иначе, взять то имя, которое `_index` пишет в `embedding_model`.

- [ ] **Step 2: запустить, убедиться в падении**

Expected:
- `test_embedding_column_is_half_precision` падает FAIL;
- `test_reused_vector_…` пока проходит: он закрепляет нынешнее поведение;
- Postgres-тесты падают FAIL.

- [ ] **Step 3: поле и миграция `0018`** (зависит от `0017`). Операции по порядку:
  1. `RunPython`, только Postgres. Проверить `select extversion from pg_extension where extname = 'vector'`. Если версия ниже 0.7.0, бросить `RuntimeError("pgvector <версия> не умеет halfvec, нужен 0.7+: пересоберите сервис Postgres на свежем образе postgres-ssl той же основной версии.")` до любых изменений. Затем `DROP INDEX IF EXISTS curriculum_chunk_embedding_hnsw`. Обратная операция пересоздаёт индекс на `vector_cosine_ops`.
  2. `AlterField` на `HalfVectorField(dimensions=1536, null=True, blank=True)`. Django сам пишет `USING embedding::halfvec(1536)`.
  3. `RunPython`, только Postgres: `CREATE INDEX IF NOT EXISTS curriculum_chunk_embedding_hnsw ON curriculum_knowledgechunk USING hnsw (embedding halfvec_cosine_ops)`. Обратная операция удаляет индекс.

- [ ] **Step 4: прогнать** `test_embeddings`. Если `test_reused_vector_…` упал на чтении `HalfVector`, это ожидаемо: Step 5 это чинит.

- [ ] **Step 5: `vector_as_list` и её вызовы.** В `_reuse_map` вместо `list(embedding)` пишется `vector_as_list(embedding)`. В `PgVectorDenseRetriever.search` вместо `CosineDistance("embedding", vector)` пишется `CosineDistance("embedding", HalfVector(vector))`, импорт `from pgvector import HalfVector`.

- [ ] **Step 6: зелёный прогон**

Run: `curriculum` на SQLite; `curriculum.tests.test_vector_schema_pg` на Postgres; `makemigrations --check`.
Expected: всё OK.

---

### Задача 4: Векторы не тянутся туда, где они не нужны

**Files:**
- Modify:
  - `backend/curriculum/services/search.py:58`;
  - `backend/curriculum/services/plans.py:236`, `:783`;
  - `backend/curriculum/profiles/context.py:96`;
  - `backend/curriculum/views.py:386`;
  - `backend/curriculum/management/commands/curriculum_retrieval_eval.py:71`.
- Test: `backend/curriculum/tests/test_vector_reads.py` (новый)

**Interfaces:**
- Consumes: `_PlanBase` из `curriculum/tests/test_services.py`. Его `setUp` даёт `self.goal` и обработанный `self.document`.

- [ ] **Step 1: тесты.** Общий помощник:

```python
EMBEDDING_COLUMN = re.compile(r'"curriculum_knowledgechunk"\."embedding"(?!_)')

def chunk_selects_with_vectors(queries):
    return [q["sql"] for q in queries
            if q["sql"].lstrip().upper().startswith("SELECT")
            and "curriculum_knowledgechunk" in q["sql"]
            and EMBEDDING_COLUMN.search(q["sql"])]
```

Тесты на базе `_PlanBase`, каждый под `CaptureQueriesContext(connection)` и с проверкой `self.assertEqual(chunk_selects_with_vectors(ctx.captured_queries), [])`:

- `test_search_does_not_load_vectors` вызывает `search_chunks(SearchRequest(user_email=EMAIL, query="сила", document_ids=[], limit=5, mode="explain"))`;
- `test_planning_context_does_not_load_vectors` вызывает `plans_service.retrieve_planning_context(self.goal, self.document)`;
- `test_plan_source_lock_does_not_load_vectors` вызывает `_lock_planning_source_snapshot` в `transaction.atomic()` с id всех кусков документа.

- [ ] **Step 2: запустить, убедиться в падении**

Expected: FAIL, в списке SELECT с колонкой `embedding`.

- [ ] **Step 3: добавить `.defer("embedding")` в шесть перечисленных выборок.** У `select_for_update` порядок такой: `.select_for_update().defer("embedding").filter(...)`.

- [ ] **Step 4: зелёный прогон**

Run: `curriculum`.
Expected: OK.

---

### Задача 5: Эмбеддинги вне окон лимита, короткий вектор вопроса (решения 10, 12, 16)

**Files:**
- Modify: `backend/ai_engine/models.py:177-215`
- Create: `backend/ai_engine/migrations/0010_aiusageevent_metered.py`
- Modify:
  - `backend/ai_engine/usage.py`: `record_model_usage` и `build_usage_summary`;
  - `backend/curriculum/embeddings.py`: `embed`, `__init__`, `get_embedding_provider`;
  - `backend/curriculum/retrieval.py:497`;
  - `backend/config/settings.py` и `backend/.env.example`: новая настройка.
- Test: `backend/ai_engine/test_usage.py`, `backend/curriculum/tests/test_embeddings.py`

**Interfaces:**
- Produces:
  - `AIUsageEvent.metered: bool`, по умолчанию `True`;
  - `record_model_usage(..., metered: bool = True)`;
  - `build_usage_summary` считает только `metered=True`: окна, итоги, модели, функции, дни и контекст;
  - `OpenAICompatibleEmbeddingProvider(..., max_attempts: int = MAX_ATTEMPTS)` с атрибутом `max_attempts`;
  - `get_embedding_provider(*, private: bool = False, for_query: bool = False)`;
  - `QUERY_MAX_ATTEMPTS = 1`;
  - настройка `CURRICULUM_QUERY_EMBEDDING_TIMEOUT_SECONDS = int(os.getenv(..., "12"))`.

- [ ] **Step 1: тесты.** Лимиты `AI_PLAN_LIMITS={"free": {"context": 1000, "five_hour": 1000, "weekly": 1000}}` и `AI_USAGE_ENFORCE_LIMITS=True`.

```python
# ai_engine/test_usage.py
def test_unmetered_calls_stay_out_of_the_windows(self):
    AIUsageEvent.objects.create(user_email=EMAIL, model_name="emb", feature="curriculum_embedding",
                                total_tokens=90_000, billable_tokens=90_000, metered=False)
    AIUsageEvent.objects.create(user_email=EMAIL, model_name="m", feature="chat",
                                total_tokens=300, billable_tokens=300)
    summary = build_usage_summary(EMAIL)
    self.assertEqual(summary["windows"]["five_hour"]["used"], 300)
    self.assertEqual(summary["totals"]["billable_tokens"], 300)
    reserve_usage_capacity(EMAIL, reserved_tokens=600)  # не бросает
```

В `test_embeddings.py` OpenAI-клиент подменяется так же, как в соседних тестах провайдера (`mock.patch("openai.OpenAI")`):

- `test_book_vectors_are_recorded_but_not_metered`: после `embed(["a"])` есть `AIUsageEvent` с `feature="curriculum_embedding"` и `metered=False`, а окно `five_hour.used == 0`.
- `test_embedding_runs_with_an_exhausted_window`: метеренное событие на 1000 токенов, и `embed(["a"])` всё равно вызывает клиент и не бросает `AIUsageLimitExceeded`.
- `test_query_provider_has_a_short_timeout_and_one_attempt`: под `mock.patch.dict(os.environ, {"EMBEDDING_MODEL": "m"})` с подменёнными `EMBEDDING_BASE_URL` и `EMBEDDING_API_KEY` модуля `get_embedding_provider(private=True, for_query=True)` даёт `timeout_seconds == 12` и `max_attempts == 1`. Падающий клиент вызывается ровно один раз.

Тест на отказ лимита для эмбеддингов (`test_embeddings.py:132`) теперь противоречит решению 12: удалить его и записать это в журнал.

- [ ] **Step 2: запустить, убедиться в падении**

Expected: FAIL или ERROR. Поля `metered` нет, у `get_embedding_provider` нет параметра `for_query`.

- [ ] **Step 3: поле, миграция и учёт.** Миграция `0010_aiusageevent_metered` — один `AddField` с `default=True`, пишется руками.

- [ ] **Step 4: провайдер.** Изменения в `embed`:
  - `provider_call_reservation` убирается;
  - `record_model_usage` получает `metered=False`;
  - цикл попыток идёт по `self.max_attempts`.

  `get_embedding_provider(for_query=True)` берёт таймаут из `CURRICULUM_QUERY_EMBEDDING_TIMEOUT_SECONDS` и `max_attempts=QUERY_MAX_ATTEMPTS`. `PgVectorDenseRetriever._embed_query` вызывает `get_embedding_provider(private=True, for_query=True)`.

- [ ] **Step 5: зелёный прогон**

Run: `ai_engine curriculum`; `makemigrations --check`.
Expected: OK, `No changes detected`.

---

### Задача 6: Предоплаченный резерв в учёте лимита (решения 13, 14)

**Files:**
- Modify: `backend/ai_engine/usage.py`
- Test: `backend/ai_engine/test_usage.py`

**Interfaces:**
- Produces:
  - `usage_window_limit(user_email: str | None) -> int | None`: меньший из лимитов `five_hour` и `weekly` тарифа ученика. `None`, когда лимиты не включены или нет почты.
  - `available_usage_tokens(user_email: str | None, *, now=None) -> int | None`: `min(limit - used)` по двум окнам минус активные резервы вида `capacity`, не меньше 0. `None` в тех же случаях.
  - `consume_usage_reservation(reservation: UsageReservation, tokens: int) -> None`: уменьшает `tokens` у этого резерва. Резерв, дошедший до нуля, исчезает. Ошибки базы гасятся, как у `release_usage_reservation`.
  - `prepaid_usage(reservation: UsageReservation)` — контекстный менеджер. Если резерв активен, внутри него:
    - `provider_call_reservation` ничего не резервирует и отдаёт этот же резерв;
    - `record_model_usage` после записи метеренного события зовёт `consume_usage_reservation(reservation, billable_tokens)`.

    Неактивный резерв ничего не меняет. Переменная контекста — `ContextVar`, в потоки она переходит через `contextvars.copy_context()`.
  - `provider_call_token_estimate(input_payload: Any, *, max_output_tokens: int = 0) -> int`: `_provider_input_token_bound(input_payload) + min(max_output_tokens, CALL_OUTPUT_ESTIMATE_TOKENS)`, где `CALL_OUTPUT_ESTIMATE_TOKENS = 3000`. Это ожидаемая цена вызова для программы и разбора глав. Верхняя граница `provider_call_token_upper_bound` остаётся для сканов и отдельных вызовов.

- [ ] **Step 1: тесты** (лимиты окон по 2000, `AI_USAGE_ENFORCE_LIMITS=True`)

```python
def test_calls_inside_a_prepaid_scope_do_not_reserve_again(self):
    prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1000)
    with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
        with provider_call_reservation(input_payload="x", max_output_tokens=500):
            pass
    self.assertEqual(list(AIUsageQuotaState.objects.get(user_email=EMAIL).reservations), [prepaid.key])

def test_recorded_calls_draw_down_the_prepaid_reserve(self):
    prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1000)
    with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
        record_model_usage(SimpleNamespace(usage={"total_tokens": 300}, id="r", model="m"), model="m", provider="p")
    self.assertEqual(AIUsageQuotaState.objects.get(user_email=EMAIL).reservations[prepaid.key]["tokens"], 700)

def test_overrun_does_not_stop_prepaid_calls(self):
    prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=100)
    with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
        record_model_usage(SimpleNamespace(usage={"total_tokens": 1900}, id="r", model="m"), model="m", provider="p")
        with provider_call_reservation(input_payload="x", max_output_tokens=500):
            pass  # окно почти выбрано, но вызов внутри предоплаты не отказывает
    self.assertNotIn(prepaid.key, AIUsageQuotaState.objects.get(user_email=EMAIL).reservations)

def test_parallel_chat_cannot_eat_a_prepaid_reserve(self):
    reserve_usage_capacity(EMAIL, reserved_tokens=1500)
    with usage_scope(user_email=EMAIL), self.assertRaises(AIUsageLimitExceeded):
        with provider_call_reservation(input_payload="x", max_output_tokens=600):
            pass

def test_available_tokens_subtract_used_and_reserved(self):
    AIUsageEvent.objects.create(user_email=EMAIL, model_name="m", total_tokens=500, billable_tokens=500)
    reserve_usage_capacity(EMAIL, reserved_tokens=300)
    self.assertEqual(available_usage_tokens(EMAIL), 1200)
    self.assertEqual(usage_window_limit(EMAIL), 2000)

@override_settings(AI_USAGE_ENFORCE_LIMITS=False)
def test_without_limits_there_is_no_ceiling(self):
    self.assertIsNone(available_usage_tokens(EMAIL))
    self.assertIsNone(usage_window_limit(EMAIL))
```

- [ ] **Step 2: запустить, убедиться в падении**

Expected: ImportError.

- [ ] **Step 3: реализовать пять функций.** Отбор активных резервов в `available_usage_tokens` тот же, что у резерва вида `capacity` в `reserve_usage_capacity`.

- [ ] **Step 4: зелёный прогон**

Run: `ai_engine`.
Expected: OK.

---

### Задача 7: Обработка без входного резерва, пульс, очередь, предел часа (решения 12, 15)

**Files:**
- Modify:
  - `backend/curriculum/tasks.py`: обёртка задачи, `_mark_quota_denied`;
  - `backend/curriculum/services/dispatch.py`: `is_stale`;
  - `backend/curriculum/services/ingestion.py`: ветка `SoftTimeLimitExceeded`;
  - `backend/curriculum/views.py:313-342`: статус `timed_out`;
  - `backend/config/settings.py` и `backend/.env.example`.
- Create: `backend/curriculum/services/pulse.py`
- Modify (`except SoftTimeLimitExceeded: raise` перед каждым `except Exception`):
  - `backend/curriculum/extraction.py:107,248`;
  - `backend/curriculum/epub_extraction.py:145,174`;
  - `backend/curriculum/ocr.py:140`;
  - `backend/curriculum/embeddings.py:175`;
  - `backend/curriculum/services/embedding_index.py:140`;
  - `backend/curriculum/services/ingestion.py:379,708`.
- Test:
  - `backend/curriculum/tests/test_pulse.py` (новый);
  - `backend/curriculum/tests/test_tasks.py`;
  - `backend/curriculum/tests/test_dispatch.py`;
  - `backend/curriculum/tests/test_api.py`.

**Interfaces:**
- Produces:
  - `job_pulse(job_id, *, run_token: str, interval_seconds: float | None = None) -> ContextManager[None]` в `services/pulse.py`. Это фоновый поток-демон: раз в `interval_seconds` (по умолчанию `CURRICULUM_INGEST_PULSE_SECONDS`) он обновляет `updated_at` у джоба с этим `celery_task_id`. Поток останавливается, когда блок закончился, когда джоб заменён (обновлено 0 строк) или на любой ошибке базы (запись в лог уровня info). Перед выходом поток закрывает своё соединение `connection.close()`.
  - `RUNNING_STATUSES: frozenset[str]` в `dispatch.py`: от `VALIDATING` до `QUALITY_CHECK`.
  - `TIMED_OUT_ERROR_CODE = "timed_out"`, `TIMED_OUT_MESSAGE = "Обработка заняла больше часа и остановлена."` в `ingestion.py`.
- Настройки:
  - `CURRICULUM_INGEST_STALE_AFTER_SECONDS` по умолчанию 300 (было 1800);
  - новая `CURRICULUM_INGEST_PULSE_SECONDS = 60`;
  - `CURRICULUM_INGESTION_AI_RESERVATION_TOKENS` удаляется из settings и `.env.example`.

- [ ] **Step 1: тесты**

`test_pulse.py` — класс `TransactionTestCase`, интервал 0.05 с:
- `test_pulse_moves_updated_at_while_the_block_runs`: джобу ставят `updated_at` на час назад, затем `with job_pulse(job.pk, run_token="t", interval_seconds=0.05): time.sleep(0.3)`. После этого `updated_at` моложе 5 секунд.
- `test_pulse_stops_after_the_block`: после выхода из блока и `sleep(0.3)` `updated_at` не меняется.
- `test_pulse_ignores_a_superseded_run`: у джоба `celery_task_id="другой"`, `updated_at` остаётся старым.

`test_tasks.py` (`IngestTaskTests`):

```python
@override_settings(AI_USAGE_ENFORCE_LIMITS=True,
                   AI_PLAN_LIMITS={"free": {"context": 1000, "five_hour": 1000, "weekly": 1000}})
def test_text_book_is_processed_with_an_exhausted_window(self):
    AIUsageEvent.objects.create(user_email=EMAIL, model_name="m", total_tokens=1000, billable_tokens=1000)
    document = self._document()
    IngestionJob.objects.create(document=document, user_email=EMAIL,
                                status=Document.Status.QUEUED, celery_task_id="text-run")
    ingest_document_task.apply(args=[str(document.pk)], task_id="text-run").get()
    document.refresh_from_db()
    self.assertEqual(document.ingestion_status, Document.Status.READY)

def test_quota_denial_after_the_job_started_closes_it(self):
    # ingest_document подменён: переводит джоб в OCR и бросает AIUsageLimitExceeded
    ...
    self.assertEqual(job.status, Document.Status.FAILED)
    self.assertEqual(job.error_code, "ai_usage_limit_exceeded")

def test_soft_time_limit_closes_the_job_as_timed_out(self):
    with mock.patch("curriculum.services.ingestion.chunk_blocks", side_effect=SoftTimeLimitExceeded()):
        ingest_document_task.apply(args=[str(document.pk)], task_id="slow-run").get()
    self.assertEqual(job.error_code, "timed_out")

def test_embedding_failure_does_not_hide_the_time_limit(self):
    # провайдер эмбеддингов бросает SoftTimeLimitExceeded → тот же timed_out, книга не READY
```

Тесты, которые закрепляли входной резерв, переписать или удалить: `test_worker_releases_quota_reservation_after_pipeline_exit`, `test_worker_quota_denial_is_a_terminal_fenced_job_error` и зависящие от `CURRICULUM_INGESTION_AI_RESERVATION_TOKENS`. Отказ лимита у джоба в очереди (`test_provider_call_quota_denial_…`, `…duplicate…`, `…superseded…`) остаётся.

`test_dispatch.py` (`CURRICULUM_INGEST_STALE_AFTER_SECONDS=300`):
- `test_a_book_waiting_behind_another_is_not_stale`: джоб A в очереди, `updated_at` час назад. У другого ученика джоб B в `OCR` со свежим `updated_at`. `is_stale(A)` равно `False`.
- `test_a_queued_book_with_an_idle_worker_goes_stale`: нет ни одного работающего джоба, A ждёт час. `is_stale(A)` равно `True`.
- `test_a_running_book_is_stale_only_by_its_pulse`: джоб в `OCR` начат два часа назад, `updated_at` минуту назад: `False`. `updated_at` 10 минут назад: `True`.

`test_api.py`:
- `test_a_job_dead_after_the_time_limit_reads_as_timed_out`: джоб в `OCR`, `started_at` и `updated_at` два часа назад. `GET …/status/` отдаёт `job.error_code == "timed_out"`.

- [ ] **Step 2: запустить, убедиться в падении**

Run: `curriculum.tests.test_pulse curriculum.tests.test_tasks curriculum.tests.test_dispatch curriculum.tests.test_api`.
Expected: FAIL или ERROR в новых тестах.

- [ ] **Step 3: задача воркера**

- Блок `usage_reservation(... "admission" ...)` убирается, `usage_scope(user_email=..., feature="curriculum_ingestion")` остаётся.
- При непустом `run_token` вызов `ingest_document` идёт внутри `job_pulse(queued_job.pk, run_token=run_token)`.
- `except SoftTimeLimitExceeded` в обёртке закрывает джоб так же, как `_mark_unexpected_failure`, но с `timed_out`. Это запасной путь: основной в `ingest_document`.
- `_mark_quota_denied` закрывает и начатый джоб: с тем же `celery_task_id` и в любом статусе из `RUNNING_STATUSES`, не только `QUEUED`.

- [ ] **Step 4: остальное**

- `is_stale` по правилам тестов:
  - для статусов из `RUNNING_STATUSES` — по пульсу;
  - для `QUEUED` и `UPLOADED` джоб зависшим не считается, пока у любого другого джоба в `RUNNING_STATUSES` `updated_at` свежее порога.
- `ingest_document` ловит `SoftTimeLimitExceeded` до общего `except Exception` и вызывает `recorder.fail(TIMED_OUT_ERROR_CODE, TIMED_OUT_MESSAGE)`.
- Перед каждым из девяти перечисленных `except Exception` стоит `except SoftTimeLimitExceeded: raise`.
- Вьюха статуса: если джоб завис и `now - started_at >= CELERY_TASK_TIME_LIMIT`, в ответе стоят `timed_out` и `TIMED_OUT_MESSAGE` вместо `stalled`.

- [ ] **Step 5: зелёный прогон**

Run: `curriculum`.
Expected: OK.

---

### Задача 8: Сканы — всё или ничего, с резервом на всю обработку (решения 13, 15, 17)

**Files:**
- Modify:
  - `backend/curriculum/ocr.py`: `page_token_bound`, потолок ответа;
  - `backend/curriculum/services/ingestion.py`: шаг OCR, проверка качества, запись сводки;
  - `backend/curriculum/models.py`: `Document.ocr_summary`.
- Create: `backend/curriculum/migrations/0019_document_ocr_summary.py`
- Modify: `backend/config/settings.py` и `backend/.env.example`: `CURRICULUM_OCR_MAX_OUTPUT_TOKENS`
- Test:
  - `backend/curriculum/tests/test_ocr_budget.py` (новый);
  - `backend/curriculum/tests/test_ingestion.py` (`StubOcrProvider`, `test_ocr_page_cap_is_reported`).

**Interfaces:**
- Consumes: `prepaid_usage`, `usage_window_limit` (задача 6), `reserve_usage_capacity`, `release_usage_reservation`, `resolve_usage_plan`.
- Produces:
  - `OcrProvider.page_token_bound() -> int`. У `VisionOcrProvider` это `provider_call_token_upper_bound({"system_prompt": OCR_SYSTEM_PROMPT, "user_prompt": OCR_USER_PROMPT}, max_output_tokens=self.max_tokens, image_count=1)`, у `NullOcrProvider` — `0`.
  - `get_ocr_provider()` ставит `max_tokens=settings.CURRICULUM_OCR_MAX_OUTPUT_TOKENS`, по умолчанию 3500. Тогда граница страницы — ровно 4000 (`AI_IMAGE_TOKEN_CHARGE`).
  - `OcrSummary` (dataclass в `ingestion.py`), `as_dict()` отдаёт ключи:
    - `scanned` — страниц-сканов среди обработанных страниц;
    - `attempted` — сколько отправлено в распознавание, не больше 40;
    - `recognized` — сколько вернулись с текстом;
    - `skipped` — `""`, `"quota"` или `"window"`;
    - `reset_at` — строка ISO, только для `quota`;
    - `plan` — `"free"`, `"pro"` или `"max"`, только при отказе.
  - `IngestionOutcome.ocr_summary: dict` и `Document.ocr_summary: JSONField(default=dict, blank=True)`.
  - `OCR_QUOTA_ERROR_CODE = "ocr_quota"`, `OCR_QUOTA_MESSAGE = "В книге одни сканы, а лимита на их распознавание не хватило. Файл сохранён."`

- [ ] **Step 1: тесты**

Основа — PDF из `pdf_fixtures.build_text_pdf`: одна страница текста `TEXTBOOK_PAGE_ONE` и N пустых. Пустая страница считается сканом.

Заглушка `BudgetOcr`:
- `page_token_bound()` отдаёт 4000;
- `transcribe_page` пишет расход `record_model_usage(SimpleNamespace(usage={"total_tokens": 900}, id="o", model="m"), model="m", provider="p", image_count=1)`, то есть 4000 за страницу;
- умеет падать на заданной странице.

Лимиты задаются через `AI_PLAN_LIMITS` и `AI_USAGE_ENFORCE_LIMITS=True`. Обработка идёт вызовом `ingest_document(document, ocr_provider=…)`.

- `test_scans_are_recognized_when_the_reserve_fits`: лимит 100 000, 2 скана. Сводка `{"scanned": 2, "attempted": 2, "recognized": 2, "skipped": ""}`, резервов после обработки нет.
- `test_mixed_book_without_limit_is_ready_by_text_pages` (Review Focus 1): лимит 10 000, метеренное событие на 8 000, 1 скан. Книга READY, у провайдера 0 вызовов, `skipped == "quota"`, `reset_at` непустой.
- `test_all_or_nothing`: лимит 10 000, 3 скана (нужно 12 000). Провайдер не вызывался ни разу, `skipped == "window"`, `plan == "free"`.
- `test_scan_only_book_without_limit_fails_with_ocr_quota`: три пустые страницы и ни одной с текстом, лимит 10 000. Джоб FAILED с `ocr_quota`, `document.ocr_summary["skipped"]` равен `"window"`, файл в хранилище на месте.
- `test_more_scans_than_one_run_reports_the_cap`: `max_ocr_pages=1`, 2 скана. `scanned == 2`, `attempted == 1`.
- `test_a_failed_page_keeps_the_recognized_ones`: падает вторая из трёх страниц. Книга READY, `recognized == 2`, `attempted == 3`.
- `test_parallel_chat_cannot_eat_the_ocr_reserve`: лимит 10 000, 2 скана. Внутри первого `transcribe_page` вызов `reserve_usage_capacity(EMAIL, reserved_tokens=3000)` бросает `AIUsageLimitExceeded`.
- `test_pages_draw_down_the_ocr_reserve`: на второй странице резерв вида `curriculum_ocr` равен 4000, а не 8000.
- `test_book_page_bound_is_4000`: `get_ocr_provider()` под `mock.patch.dict(os.environ, {"OCR_MODEL": "m"})` даёт `max_tokens == 3500` и `page_token_bound() == 4000`.

Ещё две правки в старых тестах:
- `StubOcrProvider` в `test_ingestion.py` получает `page_token_bound()`, который отдаёт 4000;
- `test_ocr_page_cap_is_reported` проверяет сводку (`scanned`, `attempted`) вместо предупреждения `ocr_limited_…`.

- [ ] **Step 2: запустить, убедиться в падении**

Run: `curriculum.tests.test_ocr_budget curriculum.tests.test_ingestion`.
Expected: FAIL или ERROR.

- [ ] **Step 3: шаг OCR в `_run_pipeline`.** Он выносится в функцию `_recognize_scans(document, job, pdf_bytes, scanned, *, max_ocr_pages, ocr_provider, run_token) -> tuple[dict[int, tuple[str, str]], OcrSummary]`:
  1. `to_ocr = scanned[:max_ocr_pages]`. Если `to_ocr` пуст или провайдер — `NullOcrProvider`, ничего не резервировать. Старое предупреждение `ocr_not_configured` остаётся.
  2. `need = len(to_ocr) * ocr_provider.page_token_bound()`. Затем `reserve_usage_capacity(document.user_email, reserved_tokens=need, feature="curriculum_ocr")`.
  3. Отказ: `skipped` равен `"window"`, если `usage_window_limit(...)` не `None` и `need` больше него, иначе `"quota"` с `reset_at` из исключения. `plan = resolve_usage_plan(email)["id"]`. Ни одна страница не распознаётся.
  4. Успех: цикл по страницам внутри `usage_scope(user_email=document.user_email)` и `prepaid_usage(reservation)`. Без явной почты расход прямого вызова `ingest_document` (тесты, команда) никуда не записался бы. `_touch_job` идёт после каждой страницы, как сейчас. `AIUsageLimitExceeded` на странице останавливает цикл, распознанное сохраняется. Резерв снимается в `finally`.
  5. Предупреждение `ocr_limited_to_…` больше не пишется: его заменяет сводка.

- [ ] **Step 4: проверка качества и запись**

- Если `chunk_count == 0` и `skipped` равен `quota` или `window`, бросается `IngestionError(OCR_QUOTA_ERROR_CODE, OCR_QUOTA_MESSAGE)`.
- `ingest_document` пишет `Document.ocr_summary = outcome.ocr_summary` в том же огороженном блоке, где сейчас пишет `warnings`, то есть и при успехе, и при `IngestionError`.
- Миграция `0019_document_ocr_summary` — один `AddField`.

- [ ] **Step 5: зелёный прогон**

Run: `curriculum`; `makemigrations --check`.
Expected: OK, `No changes detected`.

---

### Задача 9: Сначала резерв программы, потом разбор глав (решение 14)

**Files:**
- Modify: `backend/curriculum/tasks.py`. Удалить `profile_document_sections_task` и `_enqueue_profiling`, а в обёртке убрать вызов после успеха.
- Modify: `backend/curriculum/services/section_profiles.py`, `backend/curriculum/profiles/providers.py`
- Modify:
  - `backend/curriculum/planning/providers.py`: оценки у провайдеров плана и рецензента;
  - `backend/curriculum/planning/enrichment.py`: оценка у провайдера обогащения.
- Modify:
  - `backend/curriculum/services/plans.py`: `generate_plan`, `_persist_plan`;
  - `backend/curriculum/models.py`: `CoursePlan.generation_warnings`;
  - `backend/curriculum/serializers.py`: `CoursePlanSerializer`;
  - `backend/curriculum/views.py`: `generate` и `rebuild`.
- Create: `backend/curriculum/migrations/0020_courseplan_generation_warnings.py`
- Modify: `backend/config/settings.py` и `backend/.env.example`: `CURRICULUM_PLAN_PROFILING_SECONDS = 60`
- Test: `backend/curriculum/tests/test_plan_budget.py` (новый, на базе `_PlanBase`), `backend/curriculum/tests/test_section_profiles.py`

**Interfaces:**
- Consumes: из задачи 6 `available_usage_tokens`, `usage_window_limit`, `prepaid_usage`, `provider_call_token_estimate`; кроме того `reserve_usage_capacity` и `release_usage_reservation`.
- Produces:
  - Оценки цены вызовов, все через `provider_call_token_estimate(<тот же payload, что уходит в модель>, max_output_tokens=self.binding.max_tokens)`:

    | Провайдер | Метод | Что отдаёт |
    |---|---|---|
    | `OpenRouterChapterEnrichmentProvider` | `.estimate_tokens(request: ChapterRequest) -> int` | оценку одного вызова |
    | `FakeChapterEnrichmentProvider` | `.estimate_tokens(request) -> int` | `0` |
    | `SkeletonCoursePlanningProvider` | `.estimate_tokens(request, context) -> int` | сумму оценок обогащения по главам скелета. Построение `ChapterRequest` выносится в `_chapter_requests(request) -> list[ChapterRequest]` |
    | `OpenRouterCoursePlanningProvider` | `.estimate_tokens(request, context) -> int` | оценку по общему `_planner_payload(request, context)` |
    | `FakeCoursePlanningProvider` | `.estimate_tokens(...) -> int` | `0` |
    | `OpenRouterCourseReviewProvider` | `.estimate_tokens(context) -> int` | оценку по источникам плюс `PLAN_REVIEW_PLAN_TOKENS = 6000` |
    | `FakeCourseReviewProvider` | `.estimate_tokens(context) -> int` | `0` |
    | `OpenRouterSectionProfilingProvider` | `.estimate_tokens(request: ProfilingRequest) -> int` | оценку одного вызова; таймаут вызова `min(binding.timeout_seconds, CURRICULUM_PLAN_PROFILING_SECONDS)` |
    | `FakeSectionProfilingProvider` | `.estimate_tokens(request) -> int` | `0` |
  - `ProfilingWork` (dataclass в `section_profiles.py`): `items: list[tuple[DocumentSection, ProfilingRequest, str, int]]` (раздел, запрос, хеш, оценка), `requested`, `from_cache`, `skipped_empty`.
  - `plan_section_profiling(document, *, processing_version: str = "", include_subsections: bool = True, provider=None) -> ProfilingWork` — без вызовов модели.
  - `run_section_profiling(document, work: ProfilingWork, *, items=None, stop_at: float | None = None, provider=None, processing_version: str = "") -> ProfilingReport`. Раздел, до которого очередь дошла после `stop_at`, не стартует и считается в `skipped_time`.
  - `ProfilingReport` получает `skipped_limit: int = 0` и `skipped_time: int = 0`. `profile_document_sections` сохраняет подпись: это `plan` плюс `run` без пределов.
  - `PlanDoesNotFitLimit(RuntimeError)` в `plans.py`: `code = "plan_exceeds_window"`, `message = "Программа по этой книге не помещается в лимит твоего тарифа, даже когда он полностью свободен."`
  - `generate_plan(goal, document, *, planning_provider=None, review_provider=None, profiling_provider=None, start_date=None)`.
  - Предупреждения `plan_profiling_skipped` и `plan_profiling_partial`, `CoursePlan.generation_warnings: JSONField(default=list, blank=True)` в ответе сериализатора.

- [ ] **Step 1: тесты** (`test_plan_budget.py`)

Провайдеры с оценками — небольшие подклассы фейков с ненулевым `estimate_tokens`:
- планировщик: 1000;
- рецензент: 500;
- разбор: 400 на раздел; при каждом вызове пишет расход 300 через `record_model_usage`.

Лимиты задаются через `AI_PLAN_LIMITS`. Если у `self.document` из `_PlanBase` меньше трёх разделов для разбора, в `setUp` добавляются разделы и куски помощниками `section` и `chunk` из `test_section_profiles.py`.

- `test_ingestion_no_longer_queues_profiling`: `hasattr(curriculum.tasks, "profile_document_sections_task")` равно `False`.
- `test_nothing_starts_when_the_program_does_not_fit`: свободно 1000 из нужных 1500. `AIUsageLimitExceeded`, ни планировщик, ни разбор не вызывались.
- `test_a_program_larger_than_the_window_says_so`: лимит окна 1200, программа стоит 1500. Бросается `PlanDoesNotFitLimit`.
- `test_program_is_reserved_before_profiling`: свободно 1700. Программа (1500) составлена, разбор не вызывался ни разу, в `outcome.warnings` и в `plan.generation_warnings` есть `plan_profiling_skipped`.
- `test_profiling_takes_only_what_fits`: свободно 1500 + 800, то есть ровно на 2 из N ≥ 3 разделов. Разобрано 2, предупреждение `plan_profiling_partial`.
- `test_profiling_threads_draw_on_the_profiling_reserve` (Review Focus 3): во время разбора в `AIUsageQuotaState.reservations` нет резервов вида `curriculum_section_profiling` сверх резерва разбора. Расход вызовов пишется ученику (`AIUsageEvent.user_email == EMAIL`).
- `test_profiling_stops_starting_sections_after_its_time`: `CURRICULUM_PLAN_PROFILING_SECONDS=0`. Разбор не вызывался, план составлен.
- `test_second_plan_does_not_pay_for_profiles_again`: второй `generate_plan` по той же книге не вызывает разбор (кэш).

В `test_section_profiles.py` добавить `test_run_respects_given_items_and_stop_at`.

API в `test_api.py`: `test_plan_too_large_for_the_window_is_a_429_with_its_code`, ответ `429`, `code == "plan_exceeds_window"`.

- [ ] **Step 2: запустить, убедиться в падении**

Run: `curriculum.tests.test_plan_budget curriculum.tests.test_section_profiles curriculum.tests.test_api`.
Expected: FAIL или ERROR.

- [ ] **Step 3: оценки у провайдеров**, по таблице в Interfaces. Payload строится той же функцией, что и сам вызов, без копий.

- [ ] **Step 4: `section_profiles`** — `plan_section_profiling` и `run_section_profiling` по интерфейсу, `profile_document_sections` через них.

- [ ] **Step 5: `generate_plan`.** Все вызовы модели в функции идут внутри `usage_scope(user_email=goal.user_email)`. В запросе ту же почту ставит middleware, а прямой вызов (тесты) без этого не записал бы расход ученику. До первого вызова модели:
  1. `estimate = planner.estimate_tokens(request, bundle) + reviewer.estimate_tokens(bundle)`. Если у любого из двух провайдеров нет `estimate_tokens`, оценки нет: шаги 2 и 5 пропускаются, вызовы резервируют сами, как сейчас.
  2. `reserve_usage_capacity(goal.user_email, reserved_tokens=max(1, estimate), feature="curriculum_plan")`. Отказ: если `usage_window_limit` не `None` и `estimate` больше него, бросается `PlanDoesNotFitLimit`, иначе исключение уходит дальше.
  3. Разбор:
     - `work = plan_section_profiling(document, provider=profiling_provider or get_profiling_provider())`;
     - `available = available_usage_tokens(email)`;
     - берётся префикс `work.items`, чья сумма оценок не больше `available`. При `None` берутся все;
     - на сумму префикса делается резерв `feature="curriculum_section_profiling"`. Если резерв отклонён, префикс пуст;
     - `run_section_profiling(..., items=префикс, stop_at=начало + CURRICULUM_PLAN_PROFILING_SECONDS)` идёт внутри `prepaid_usage(резерв разбора)`, затем резерв снимается.

     Любое исключение разбора, кроме лимита, пишется в лог, и программа составляется без профилей.
  4. `request = build_planning_request(goal, document, bundle)` пересобирается: свежие профили попадают в оглавление.
  5. `_plan_with_one_repair(...)` и `reviewer.review_plan(...)` — каждый внутри `prepaid_usage(резерв программы)`. Резерв снимается в `finally` всей функции.
  6. Предупреждения:
     - `plan_profiling_skipped`, если `work.items` не пуст и не разобрано ни одного раздела;
     - `plan_profiling_partial`, если разобрана часть.

     `_persist_plan` пишет их в `plan.generation_warnings`, они же идут в `outcome.warnings`.

- [ ] **Step 6: вьюхи.** `generate` и `rebuild` ловят `PlanDoesNotFitLimit` и отвечают `429 {"error": exc.message, "code": exc.code}`. Миграция `0020` — один `AddField`, поле добавляется в `CoursePlanSerializer.Meta.fields`.

- [ ] **Step 7: зелёный прогон**

Run: `curriculum`; `makemigrations --check`.
Expected: OK, `No changes detected`.

---

### Задача 10: Недостающие векторы снова в очередь, не чаще раза в 10 минут (решение 11)

**Files:**
- Modify:
  - `backend/curriculum/services/embedding_index.py`: параметр `only_statuses` и новая функция;
  - `backend/curriculum/tasks.py`: новая задача;
  - `backend/curriculum/services/search.py`: вызов после выборки кандидатов;
  - `backend/curriculum/services/ingestion.py:659-667`: предупреждение в лог.
- Test: `backend/curriculum/tests/test_vector_repair.py` (новый)

**Interfaces:**
- Produces:
  - `index_document_chunks(..., only_statuses: Collection[str] | None = None)`: при заданном значении в работу идут только куски с этими `embedding_status`;
  - `VECTOR_REPAIR_INTERVAL_SECONDS = 600`;
  - `request_vector_repair(document_ids: Iterable[str]) -> list[str]`;
  - `embed_missing_chunks_task(self, document_id: str)` с именем `curriculum.embed_missing_chunks`: `acks_late=True`, `max_retries=0`, `ignore_result=True`.
- Правила `request_vector_repair`:
  - берутся только READY-документы, у которых есть куски в статусах `PENDING` или `FAILED`. `SKIPPED` не трогаются: это потолок или выключенный провайдер, их забирает команда `curriculum_embed`;
  - нужны настроенный провайдер (`get_embedding_provider().name != "null-embedding"`) и `resolve_mode() == "celery"`;
  - проверка `cache.add(f"curriculum:vector-repair:{id}", "1", timeout=600)`, затем `embed_missing_chunks_task.delay(id)`;
  - сбой брокера пишется в лог предупреждением, наружу не выходит.

  Задача запускает `index_document_chunks(document, only_statuses=(PENDING, FAILED))` в `usage_scope(user_email=…, feature="curriculum_embedding")`.

- [ ] **Step 1: тесты.** Настройки `CURRICULUM_INGEST_MODE="celery"`, `CELERY_BROKER_URL="redis://stub"`. `get_embedding_provider` подменён на фейк с `name="fake"`.
  - `test_search_requeues_missing_vectors_once_per_ten_minutes`: READY-документ с FAILED-куском. Два вызова `search_chunks` дают один `delay`. После `cache.delete(ключ)` третий вызов даёт второй `delay`.
  - `test_skipped_chunks_are_not_requeued`: только `SKIPPED`, `delay` не вызван.
  - `test_broker_failure_does_not_break_search` (Review Focus 2): `delay` бросает `ConnectionError`, поиск отдаёт результат, в логе предупреждение.
  - `test_repair_task_embeds_only_pending_and_failed`: задача с фейковым провайдером переводит `FAILED` в `READY`, а `SKIPPED` остаётся.
  - `test_failed_vectors_are_logged_as_a_warning`: в `ingest_document` провайдер эмбеддингов отказывает. Книга READY и `assertLogs("curriculum.services.ingestion", "WARNING")`.

- [ ] **Step 2: запустить, убедиться в падении**

Expected: ImportError или FAIL.

- [ ] **Step 3: реализовать по интерфейсу.** Вызов `request_vector_repair(list(document_map))` в `search_chunks` обёрнут так, чтобы любая ошибка только логировалась.

- [ ] **Step 4: зелёный прогон**

Run: `curriculum`.
Expected: OK.

---

### Задача 11: Файл читается своим хранилищем и удаляется вместе с книгой (решение 9)

**Files:**
- Modify:
  - `backend/curriculum/storage.py`: новая функция;
  - `backend/curriculum/services/ingestion.py:701-709`: `_read_file`;
  - `backend/curriculum/signals.py`: новый получатель.
- Test: `backend/curriculum/tests/test_file_lifecycle.py` (новый)

**Interfaces:**
- Produces:
  - `get_storage_for(backend_name: str) -> FileStorage`:
    - если подменённое через `set_storage` хранилище имеет этот `backend_name`, отдаётся оно;
    - `"s3"` → `S3FileStorage(s3_settings_from_django())`, без настроек `StorageError`;
    - `"local"` → `LocalFileStorage(settings.CURRICULUM_STORAGE_ROOT)`.
  - Получатель `post_delete` для `DocumentFile`: `transaction.on_commit(…)` удаляет `storage_key` через `get_storage_for(storage_backend)`. Ошибка пишется в лог предупреждением.

- [ ] **Step 1: тесты**
  - `test_file_is_read_from_the_backend_it_was_saved_to`:
    - подменённое хранилище — заглушка S3 (`make_storage()` из `test_storage_s3.py`);
    - файл с `storage_backend="local"` лежит в `LocalFileStorage(tmp)`, `CURRICULUM_STORAGE_ROOT=tmp`;
    - `ingestion._read_file(document)` отдаёт локальные байты.
  - `test_deleting_a_book_deletes_its_file`: `with self.captureOnCommitCallbacks(execute=True): document.delete()`, затем `store.exists(key)` равно `False`.
  - `test_deleting_a_subject_deletes_book_files`: то же через удаление `LearningGoal`.
  - `test_storage_failure_on_delete_is_only_logged`: `delete` бросает `StorageError`, удаление проходит, в логе предупреждение.
  - `test_deleting_a_queued_book_removes_the_file_and_the_task_skips` (Review Focus 4): джоб в `QUEUED`, книга удалена с коммитом, затем `ingest_document_task.apply(args=[id], task_id=…)`. Без ошибок, файла нет.

- [ ] **Step 2: запустить, убедиться в падении**

Expected: FAIL.

- [ ] **Step 3: реализовать.** `_read_file` берёт `get_storage_for(file_row.storage_backend)`.

- [ ] **Step 4: зелёный прогон**

Run: `curriculum`.
Expected: OK.

---

### Задача 12: Кусок пишется одной записью, `raw_text` не хранится (шаг 5, «по возможности»)

**Files:**
- Modify: `backend/curriculum/services/ingestion.py`: `_write_chunks` (1004–1060) и `_write_blocks` (934)
- Test: `backend/curriculum/tests/test_ingestion.py`

- [ ] **Step 1: тесты** (`HappyPathTests`)
  - `test_chunks_are_written_with_their_links_in_one_pass`. Под `CaptureQueriesContext` во время `ingest_document`:
    - нет ни одного `UPDATE "curriculum_knowledgechunk"`, где в `SET` есть `"parent_id"`, `"previous_id"` или `"next_id"`;
    - у каждого куска с `next_id` следующий кусок указывает назад через `previous_id`.
  - `test_blocks_do_not_keep_a_raw_copy`: у всех `DocumentBlock` поле `raw_text == ""`.

- [ ] **Step 2: запустить, убедиться в падении**

Expected: FAIL.

- [ ] **Step 3: реализовать**
  - `_write_chunks`:
    - id заранее: `[uuid.uuid4() for _ in chunks]`;
    - `parent_id`, `previous_id` и `next_id` ставятся по индексам до вставки;
    - один `bulk_create(batch_size=500)`. Внешние ключи у Django отложенные, а запись идёт в одной транзакции.
  - `_write_blocks` больше не передаёт `raw_text`.

- [ ] **Step 4: зелёный прогон**

Run: `curriculum`.
Expected: OK.

---

### Задача 13: `curriculum_embed --reset-failed` работает и не трогает лимит ученика (решение 16)

**Files:**
- Modify: `backend/curriculum/management/commands/curriculum_embed.py:141-148`
- Test: `backend/curriculum/tests/test_embeddings.py`, рядом с тестами команды

- [ ] **Step 1: тест**

`test_reset_failed_requeues_and_embeds_outside_the_window`:
- у ученика выбранное окно: метеренное событие на весь лимит;
- `call_command("curriculum_embed", "--user", EMAIL, "--reset-failed", "--execute", "--max-usd", "1", stdout=StringIO())` с провайдером, подменённым так же, как в соседних тестах команды;
- `FieldError` нет, FAILED-кусок стал READY;
- новых метеренных событий нет.

- [ ] **Step 2: запустить, убедиться в падении**

Expected: ERROR `FieldError`.

- [ ] **Step 3: `document__in=documents` заменить на `document_id__in=[d.pk for d in documents]`.**

- [ ] **Step 4: зелёный прогон**

Run: `curriculum.tests.test_embeddings`.
Expected: OK.

---

### Задача 14: API книги: «Обработать заново» только без программы, сводка сканов наружу (решение 17)

**Files:**
- Modify:
  - `backend/curriculum/views.py`: `ingest` (269–291) и `ingestion_status` (295–360);
  - `backend/curriculum/serializers.py`: `DocumentSerializer`.
- Test: `backend/curriculum/tests/test_api.py`

**Interfaces:**
- Produces:
  - `POST /api/curriculum/documents/{id}/ingest/` для READY-книги с программой (`CoursePlan` с этим `document` в статусе не `ARCHIVED`) отвечает `409 {"error": "У книги уже есть программа, поэтому обработать её заново нельзя.", "code": "book_has_program"}`. Джоб при этом не меняется.
  - В `DocumentSerializer.fields` есть `ocr_summary`, только для чтения.
  - Тело ответа `GET …/status/` получает ключ `ocr_summary`.

- [ ] **Step 1: тесты**
  - `test_ready_book_with_a_program_is_not_reprocessed`: программа создана так же, как в `_generate_plan` в `test_api.py`. Ответ 409, `code == "book_has_program"`.
  - `test_ready_book_without_a_program_can_be_reprocessed`: ответ 202.
  - `test_status_and_list_carry_the_ocr_summary`: `ocr_summary` есть и в статусе, и в элементе списка `GET /documents/`.

- [ ] **Step 2: запустить, убедиться в падении**

Expected: FAIL.

- [ ] **Step 3: реализовать по интерфейсу.**

- [ ] **Step 4: зелёный прогон**

Run: `curriculum`.
Expected: OK.

---

### Задача 15: Интерфейс: строка у книги, «Обработать заново», предупреждение перед программой, понятный лимит

**Files:**
- Modify:
  - `src/lib/ai-limit.ts`, `src/lib/ai-limit.test.ts`;
  - `src/lib/curriculum-progress.ts`, `src/lib/curriculum-progress.test.ts`;
  - `src/lib/curriculum-api.ts`: типы `CurriculumDocument`, `IngestionState`, `CoursePlan`;
  - `src/lib/curriculum-catalog.ts`: `generation_warnings` переносится в сводку программы;
  - `src/components/curriculum/catalog.tsx`: `SourceNotes`, 831–894;
  - `src/components/curriculum/plan-review.tsx`: `PlanGenerationStep`, 16–75;
  - `src/stores/curriculum-store.ts`: `toWizardError`, 154–157;
  - стили: `src/styles/timely/page-curriculum.css`, если понадобится новый класс.

**Interfaces:**
- Consumes: `ocr_summary` из задач 8 и 14, `generation_warnings` из задачи 9, `startIngestion(documentId)` (уже есть).
- Produces:
  - `resetPhrase(resetAt: unknown, now?: Date): string | null` в `ai-limit.ts`: «сегодня в 18:40», «завтра в 03:05», «9 ноября в 03:00» или `null`. Через неё работает `limitMessage`, его тексты не меняются.
  - В `curriculum-progress.ts`:
    - `type OcrSummary = { scanned: number; attempted: number; recognized: number; skipped: "" | "quota" | "window"; reset_at?: string; plan?: string }`;
    - `ocrNotice(summary: OcrSummary | null | undefined, options: { hasProgram: boolean; now?: Date }): string | null`;
    - `unrecognizedScans(summary): number`, то есть `max(0, scanned − recognized)`;
    - `planProfilingNotice(warnings: string[] | undefined): string | null`;
    - в `ERROR_MESSAGES` добавляются `timed_out`, `ocr_quota` и `book_has_program`. Их тексты дословно повторяют сообщения бэкенда.

**Тексты `ocrNotice`.** `n = scanned`. Склонения:
- «страница-скан / страницы-скана / страниц-сканов» после числа;
- «страницы-скана / страниц-сканов» после «из»;
- «Не распознана» при n с концом на 1, кроме 11, иначе «Не распознано».

| Случай | Текст |
|---|---|
| `quota`, без программы, время известно | `Не распознано 25 страниц-сканов: не хватило лимита. Он восстановится сегодня в 18:40, тогда нажми «Обработать заново».` |
| `quota`, без программы, времени нет или оно прошло | `Не распознано 25 страниц-сканов: не хватило лимита. Нажми «Обработать заново», когда он восстановится.` |
| `quota`, программа есть | `Не распознано 25 страниц-сканов: не хватило лимита.` Если время известно, добавляется `Он восстановится …` |
| `window`, `plan == "free"` | `Не распознано 120 страниц-сканов: на бесплатном тарифе столько не распознать за раз.` |
| `window`, другой тариф | `… на твоём тарифе столько не распознать за раз.` |
| `attempted > 0`, `scanned > attempted`, всё отправленное распознано | `Распознаны первые 40 страниц-сканов из 120: больше за одну обработку нельзя.` |
| `attempted > 0`, `scanned > attempted`, часть упала | `Распознано 35 из 120 страниц-сканов: больше 40 за одну обработку нельзя.` |
| `attempted > 0`, `recognized < attempted`, без потолка | `Распознано 3 из 5 страниц-сканов.` |
| иначе, в том числе `attempted == 0` без отказа (распознавание не настроено) | `null` |

`planProfilingNotice` отдаёт `Программа составлена без подробного разбора глав.`, если в предупреждениях есть `plan_profiling_skipped` или `plan_profiling_partial`.

- [ ] **Step 1: тесты.** Строки из таблицы как `assert.equal`. Фиксированный `NOW = new Date(2026, 10, 10, 15, 0)`, время задаётся через `new Date(...).toISOString()`, как в `ai-limit.test.ts`.
  - «resetPhrase считает сегодня и завтра по местной дате» (Review Focus 5): 18:40 того же дня, 03:05 следующего, 9 ноября и `undefined`.
  - Каждая строка таблицы `ocrNotice` отдельным тестом, плюс n = 1 («Не распознана 1 страница-скан: …») и n = 21.
  - `unrecognizedScans` и `planProfilingNotice`.

- [ ] **Step 2: запустить, убедиться в падении**

Run: `npm run -s test:chat; npm run -s test:curriculum`.
Expected: `fail` больше 0, функций нет.

- [ ] **Step 3: функции, затем типы.**

- [ ] **Step 4: экраны**
  - `SourceNotes`:
    - у упавшей книги с `ocr_quota` вместо общей причины стоит `ocrNotice(document.ocr_summary, { hasProgram: true })`, кнопка «Разобраться» остаётся;
    - у READY-книги без программы, где `ocrNotice(..., { hasProgram: false })` не `null`, появляется отдельный пункт: строка и кнопка «Обработать заново» (`btn btn-line`). Во время запроса на кнопке «Запускаю…». Кнопка вызывает `startIngestion(document.id)`, затем `onChanged()`, ошибку показывает в этом же пункте;
    - у READY-книги с программой показываются строка без кнопки и `planProfilingNotice` по `generation_warnings` её программ;
    - кнопка «Обработать заново» без строки о сканах не показывается.
  - `PlanGenerationStep`: если `unrecognizedScans(сводка документа) > 0`, первый клик по «Составить программу» не зовёт `requestPlan()`. Он показывает вопрос `В программу не попадут 25 страниц. Подождать лимит и распознать их или составить без них?` («страница / страницы / страниц») и две кнопки:
    - «Составить без них» зовёт `requestPlan()`;
    - «Подождать» возвращает к полке тем же действием, каким мастер закрывается сейчас.
  - `toWizardError`:
    - `ai_usage_limit_exceeded` даёт сообщение `limitMessage(payload.reset_at)`;
    - `plan_exceeds_window` даёт текст ответа сервера.

- [ ] **Step 5: проверки фронта.** `tsc`, `eslint` по изменённым файлам, `test:curriculum`, `test:chat` (см. «Команды»).

---

### Задача 16: Показать, получить «да», выложить код (шаги 1–5)

- [ ] **Step 1: полный прогон бэкенда** на SQLite и `curriculum.tests.test_vector_schema_pg` на Postgres-стенде, если он есть. Expected: ошибки только `test_img3` и `test_img_cube`, тестов больше базы из задачи 0.

- [ ] **Step 2: проверки фронта** — все из «Команд» и `npm run build` в копии в `$SP`. Expected: сборка проходит.

- [ ] **Step 3: живая проверка на стенде.** Next и Django поднимаются против настоящего бэкенда по рецепту из памяти `backend-test-setup`:
  - один `TIMELY_API_JWT_SECRET` у обоих;
  - `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`;
  - `CORS_ALLOWED_ORIGINS=http://127.0.0.1:<порт>`;
  - адрес `127.0.0.1`.

  У книг `dev@example.com` проставлены сводки сканов всех вариантов таблицы задачи 15, и одна книга с программой с `plan_profiling_partial`. Проверить:
  - строки на полке;
  - кнопку «Обработать заново» и 409 у книги с программой;
  - вопрос перед программой;
  - ширины 375 px и десктоп, светлую и тёмную темы.

  Скриншоты показать владельцу.

- [ ] **Step 4: шаги владельца до выкладки** (шаги 1–4 документа). Прислать владельцу:
  1. Только чтение, в панели Railway. Переменные веб-сервиса: заданы ли `VECTOR_DB_URL`, `DATABASE_URL` (Railway или Neon), `EMBEDDING_*`, `OCR_MODEL`, `CURRICULUM_INGEST_MODE`, `CELERY_BROKER_URL`/`REDIS_URL`, `CURRICULUM_S3_*`, `RUN_MIGRATIONS`. Ещё: стартовая команда, healthcheck, том, тариф. SQL во вкладке Query у Postgres:
     ```sql
     select extversion from pg_extension where extname = 'vector';
     select default_version from pg_available_extensions where name = 'vector';
     select to_regclass('public.curriculum_knowledgechunk');
     select count(*), count(embedding) from curriculum_knowledgechunk;
     select ingestion_status, count(*) from curriculum_document group by 1;
     ```
  2. Healthcheck веб-сервиса: путь `/health/` (Settings → Deploy).
  3. Резервная копия базы — `pg_dump` той же основной версии, что и сервер. Способ выбирает владелец. Если нужно, вместе проверим `railway ssh` в контейнер Postgres.
  4. pgvector 0.7 или новее. Если расширения нет или оно старое, пересобрать сервис Postgres на свежем образе `postgres-ssl` той же основной версии. Образ `pgvector/pgvector` не годится.

  Дальше шаг идёт только после подтверждения пунктов 2 и 4.

- [ ] **Step 5: «да» владельца.** Спросить: «Закоммитить Часть 1 в main и запушить?»

- [ ] **Step 6: коммит и пуш** — после «да». В коммит идут только файлы задач 1–15:

```bash
git add backend/config/settings.py backend/.env.example backend/ai_engine backend/curriculum src/lib/ai-limit.ts src/lib/ai-limit.test.ts src/lib/curriculum-progress.ts src/lib/curriculum-progress.test.ts src/lib/curriculum-api.ts src/lib/curriculum-catalog.ts src/components/curriculum/catalog.tsx src/components/curriculum/plan-review.tsx src/stores/curriculum-store.ts src/styles/timely
git status --short   # среди staged нет CLAUDE.md, src/app/privacy/, settings/page.tsx, host-routing*, middleware.ts, src/app/page.tsx
git commit -F - <<'EOF'
feat(books): process books on Railway with a worker and fair limits

- Keep book vectors in the main database as halfvec(1536) and drop the second vector database from code
- Spend the student's limit only on scans and on the program: book vectors are recorded but not metered, scans reserve the whole run up front, all or nothing
- Profile chapters when the student asks for a program, after reserving the program itself
- Never leave a book hanging: a worker pulse, queued books are not stale, one hour ends with a clear error
- Read book files from the storage they were saved to and delete them with the book
- Show unrecognized scans on the book, offer reprocessing only before a program exists, warn before a program skips pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push origin main
```

- [ ] **Step 7: выкладка.**

```bash
gh api repos/beka4kaa/timely/commits/<sha>/status
```

Контексты `Vercel` и `positive-dedication - timely` должны быть в `success`. Затем `curl -s https://timely-production-7801.up.railway.app/health/` отвечает 200. В логе Railway миграции `0017`–`0020` и `ai_engine.0010` прошли.

---

### Задача 17: Хранилище, переменные, воркер, заполнение и проверка (шаги 6–12), затем CLAUDE.md

Все команды и значения отдаются владельцу. Переменные с секретами ставит владелец, или я через `railway variable set NAME --stdin --service <имя> --environment production --skip-deploys` с его «да».

- [ ] **Step 1: хранилище (шаг 6).** Выбор: R2-бакет `timely` или бакет Railway. У веба и воркера:
  - `CURRICULUM_S3_BUCKET`;
  - `CURRICULUM_S3_ENDPOINT_URL`;
  - `CURRICULUM_S3_REGION` (для R2 — `auto`);
  - `CURRICULUM_S3_ACCESS_KEY_ID`;
  - `CURRICULUM_S3_SECRET_ACCESS_KEY`;
  - `CURRICULUM_S3_SSE` пустой.

  Том на веб-сервис не вешать.

- [ ] **Step 2: переменные (шаг 7)**, до первого запуска воркера:
  - `EMBEDDING_MODEL=openai/text-embedding-3-small`;
  - `EMBEDDING_BASE_URL=https://openrouter.ai/api/v1`;
  - `OCR_MODEL=qwen/qwen3-vl-32b-instruct` — та же модель, что у `/api/ai/ocr`.

  Таймауты остаются по умолчанию.

  Отдельно владельцу, если он согласен: выключить Safety Retention в настройках OpenRouter (раздел документа «Конфиденциальность»).

- [ ] **Step 3: Redis и воркер (шаг 8).**
  - В проекте Railway: сервис Redis и второй сервис из того же репозитория и Dockerfile.
  - Стартовая команда воркера: `celery -A config worker --loglevel=info --concurrency=1`.
  - У воркера те же переменные, что у веба, плюс:
    - `RUN_MIGRATIONS=0`;
    - `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=3600`. По умолчанию Railway гасит старый контейнер сразу после SIGTERM, а так Celery успевает дообработать книгу при выкладке.
  - `CELERY_BROKER_URL=${{Redis.REDIS_URL}}` у веба и у воркера.
  - Healthcheck у воркера не задаётся.
  - Проверка: в логе воркера есть `celery@… ready` и задачи `curriculum.ingest_document` и `curriculum.embed_missing_chunks`.

- [ ] **Step 4: уборка (шаг 9).** Снять `VECTOR_DB_URL`, если он был.

- [ ] **Step 5: куски с домашнего компьютера (шаг 10)** — только если на шаге 4 задачи 16 нашлись готовые книги, чьи куски лежат только там. Порядок по документу:
  - `\copy (SELECT … WHERE document_id IN …)` только строк с совпадающей `processing_version`;
  - удаление и вставка тех же id одной транзакцией;
  - без ORM и без `curriculum_move_vectors`, которого больше нет.

- [ ] **Step 6: заполнить векторы (шаг 11).**
  ```bash
  railway ssh --service <воркер> -- python manage.py curriculum_embed --user <почта>
  ```
  Это проверка без вызовов. Затем то же с `--execute --max-usd 0.10 --usd-per-million-tokens 0.02`.

- [ ] **Step 7: проверка (шаг 12)**
  - `curriculum_index_stats --json` в контейнере воркера: `dense_search_works: true`.
  - В контейнере воркера:
    ```bash
    python manage.py shell -c "from curriculum.services.search import SearchRequest, search_chunks; b = search_chunks(SearchRequest(user_email='<почта владельца>', query='<слово из его книги>', document_ids=[], limit=5, mode='explain')); print([r.retrieval_method for r in b.results])"
    ```
    В списке есть хотя бы один `hybrid` или `dense`. Платный вызов эмбеддинга стоит копейки.
  - Вопрос в предмете с готовой книгой приходит с цитатами. Это проверка в приложении.
  - Небольшая книга проходит загрузку и обработку воркером до конца. `build_usage_summary(<почта>)["windows"]` до и после одинаковы.
  - Выкладка во время обработки: в логе воркера `Warm shutdown`, книга дообработана.
  - Когда в таблице будут книги нескольких учеников, `EXPLAIN` векторного запроса. При малой выдаче включить `hnsw.iterative_scan`.
  - Если Postgres-тесты задач 2–3 не гонялись, они проверяются здесь же через этот поиск.

- [ ] **Step 8: CLAUDE.md** — после зелёного шага 7. Правки по разделу документа «Что поменять в CLAUDE.md»:
  - §20: «RAG-библиотека», «Document ingestion», «Embeddings/retrieval» — «Работает в продакшене», недостающее: BGE-M3, reranker, PaddleOCR. «AI usage metering»: загрузка книги тратит лимит ученика только на сканы.
  - §7.4: сканы книг распознаёт модель из `OCR_MODEL`. Противоречие про Tailscale.
  - §15.4: Celery и Redis отдельным сервисом на Railway.

  В рабочем дереве у CLAUDE.md лежат правки Части 5, их не коммитить. Порядок:
  1. `cp CLAUDE.md $SP/claude-full.md`
  2. `git show HEAD:CLAUDE.md > CLAUDE.md`
  3. внести только правки Части 1 инструментом Edit;
  4. `git add CLAUDE.md`, коммит `docs(claude): books work in production` с подписью;
  5. правки Части 1 перенести и в `$SP/claude-full.md`, затем `cp $SP/claude-full.md CLAUDE.md`.

  Проверка: `git diff CLAUDE.md` показывает только правки Части 5. Пуш — после «да» владельца.
