# Curriculum — дорожная карта и отслеживание

> Файл для подхвата работы новой сессией. **Обновлять в конце каждой сессии** —
> иначе он устареет за два дня и станет вредным.

## Что строим

Ученик говорит, что хочет выучить → загружает свой учебник (PDF или EPUB) →
система его разбирает, индексирует и векторизует → LLM строит программу, где
**каждая тема подтверждена ссылкой на источник** (`§2.1, стр. 34–37`) → ученик
утверждает план и учится по нему.

Ссылки на источник — единственное, что отличает curriculum от `/dashboard/program`,
который генерирует план из вручную забитых тем без опоры на материал.

---

## Текущее состояние

**Фазы 0–8 реализованы локально; PDF и EPUB проходят сквозной сценарий.**

- scoped backend: **536 тестов OK**, один настоящий PostgreSQL concurrency-test
  пропускается на SQLite
- фронтенд: `npm run test:curriculum` — **73 теста**; `tsc` и `lint` проходят
  (остались четыре старых warning вне curriculum)
- `makemigrations --check`, Django system check и `git diff --check` чисты
- изменения НЕ закоммичены; Phase-8 код и `ai_engine/0009` требуют обычного
  deploy/migrate перед тем, как считать их активными в production

Фронтенд есть: `/dashboard/curriculum` и `/dashboard/curriculum/plan/[planId]`.
Тяжёлая обработка асинхронная: production web и отдельный Celery worker работают
через TLS Redis addon; production mode fail-closed и не возвращается к обработке
книги внутри web-запроса при потере брокера.

Phase-7 data path проверен на живой Northflank PostgreSQL: pgvector 0.8.3,
`vector(1536)`, HNSW `vector_cosine_ops`, русский GIN FTS и 10 READY-векторов
canary-документа. Dense/hybrid benchmark выполнен на этой базе. Локальный SQLite
по-прежнему намеренно использует детерминированные fallback-retrievers.

### Как проверить вживую

Гейт `FullAccessGate` требует вошедшего пользователя. Если сессии в браузере нет,
страница молча уводит на `/dashboard/diary` — это не поломка. Для проверки без
входа помогает подстановка заголовка в рантайме (в консоли вкладки), исходники
трогать не нужно:

```js
const orig = window.fetch;
window.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  if (url.includes("localhost:8000")) {
    const h = new Headers(init.headers || {});
    h.set("X-User-Email", "<ваш email>");
    init = { ...init, headers: h };
  }
  return orig(input, init);
};
const send = XMLHttpRequest.prototype.send;   // загрузка файла идёт через XHR
XMLHttpRequest.prototype.send = function (b) {
  try { this.setRequestHeader("X-User-Email", "<ваш email>"); } catch (e) {}
  return send.call(this, b);
};
```

### Контракт для фронтенда (Фаза 3 опирается на него)

```
POST /api/curriculum/documents/upload/      201 {document, warnings[]}   multipart
POST /api/curriculum/documents/{id}/ingest/ 202 {document, job, poll_url}
GET  /api/curriculum/documents/{id}/status/ 200 см. ниже
```

```json
{
  "ingestion_status": "ready", "is_terminal": true,
  "step_index": 11, "step_total": 11, "progress": 1.0, "step_label": "Готов",
  "phase": "indexing", "phase_label": "Готовим поиск по книге",
  "phase_index": 3, "phase_total": 4,
  "document_id": "...", "job": {...}, "attempts": [...], "warnings": [],
  "stats": {"pages": 2, "sections": 3, "blocks": 10, "tasks": 2, "chunks": 10}
}
```

Все URL **со слешем на конце** (`APPEND_SLASH = False`).

### Фаза 1 — что сделано

| Что | Как проверено |
|---|---|
| `parser_classes` перенесён с класса на `@action upload` | Негативный прогон: с багом `PATCH` документа даёт `415 != 200` |
| Покрытие книги — пересечение значимых слов вместо точного равенства | Негативный прогон: перефразированный план давал `0 != 2` |
| Реальный `OpenRouterCourseReviewProvider` + консервативный выбор | 4 теста на выбор провайдера и 7 на разбор ответа |
| Одна попытка починки плана при блокерах валидатора | 6 тестов, включая «зря не вызывать» и «ровно один повтор» |

### Поправка к плану, найденная при реализации

`POST .../ingest/` с фронтенда **не** падал с 415, как утверждал план: action не
читает `request.data`, а парсеры DRF ленивые. Реально ломался только JSON-`PATCH`/`PUT`
по документу. Серьёзность в плане была завышена, починка всё равно нужна.

---

## Фазы

| # | Фаза | Статус | Оценка |
|---|---|---|---|
| 0 | Файл отслеживания | ✅ готово | 15 мин |
| 1 | Разблокировать (415, рецензент, покрытие) | ✅ готово | ~1 день |
| 2 | Async-форма API (202 + `/status/`) | ✅ готово | ~0.5 дня |
| 3 | **Сквозной фронтенд** | ✅ готово | 4–6 дней |
| 3b | Редизайн программы и персонализации | ✅ готово | ~1 день |
| 4a | S3/R2 хранилище | ✅ готово, бакет R2 подключён | ~0.5 дня |
| 4b | Celery + Redis + воркер | ✅ код готов, воркер не создан | 1.5–2 дня |
| 5 | Токенайзер + overlap | ✅ готово | ~1 день |
| 6 | EPUB + фабрика парсеров | ✅ готово | ~1.5 дня |
| 7 | pgvector + эмбеддинги + поиск | 🔄 код готов, расширение на проде стоит | 2–3 дня |
| 8 | Хвосты | ⬜ не начато | по потребности |

Легенда: ⬜ не начато · 🔄 в работе · ✅ готово · ⏸ отложено

**Первая точка, где живой человек проходит сценарий — после Фазы 3.**

---

### Фаза 0 — Файл отслеживания ✅

- [x] `backend/curriculum/ROADMAP.md`

---

### Фаза 1 — Разблокировать ✅

Без этого UI не заработает физически.

- [x] **1.1** `views.py:120` — `parser_classes` стоял на **классе**, значит на всех
      actions, и отбирал JSON у `PATCH`/`PUT` по документу → **415** (проверено
      негативным прогоном). Перенесено в `@action` для `upload`.
      Добавлены `test_document_patch_accepts_json` (собственно регрессия) и
      `test_ingest_accepts_json_content_type` (страховка на будущее).

      **Поправка к плану:** `POST .../ingest/` с фронтенда **не** падал — action не
      читает `request.data`, а парсеры DRF ленивые. Серьёзность в плане была
      завышена; починка всё равно нужна из-за PATCH.
- [x] **1.2** Рецензент умел только забраковать: фейк ставит `severity="blocker"`
      на тему без `objective`, любой блокер → `REJECTED` → `approve_plan` бросает
      `ValueError`. Одна забытая моделью цель = тупик.
      - [x] `OpenRouterCourseReviewProvider` — зеркало планировщика, роль
            `ROLE_COURSE_REVIEW`, зарегистрирован как `"openrouter"`.
            `get_review_provider()` теперь консервативен так же, как
            `get_planning_provider()`: реальная модель только при настроенной роли.
      - [x] `parse_review_response`: неизвестный `severity` понижается до `warning`,
            а не до блокера — модель, приславшая мусор в это поле, не должна
            получать право забраковать план. Отсутствующий `approved` выводится из
            наличия блокеров, а не считается одобрением.
      - [x] Одна попытка починки: `_plan_with_one_repair` в `plans.py`. Блокеры
            валидатора → повторный вызов с `repair_issues` → перевалидация.
            Ровно одна попытка: вторая почти не добавляет успеха, зато удваивает
            счёт и задержку. Падение планировщика на повторе → отдаём отчёт первой
            попытки (ученику нужны претензии валидатора, а не «модель недоступна»).
      - [x] `CoursePlanningRequest.repair_issues` **исключён из `input_hash()`**:
            хеш отвечает на вопрос «одинаковый ли вход у моделей в benchmark», а
            починка — свойство попытки, не входных данных.
      - [x] Факт починки виден в `outcome.warnings` как
            `plan_repaired_after_validation` — два платных вызова вместо одного не
            должны быть невидимой магией.
- [x] **1.3** Покрытие считалось точным casefold-равенством заголовков →
      перефразирующая модель давала 0% и `low_coverage` на каждом плане.
      Заменено на пересечение значимых слов: `_title_terms` (срезает номер раздела,
      регистр, стоп-слова вида «глава»/«раздел») + `_titles_match` с порогом 0.5
      **от меньшего множества** — иначе длинный заголовок книги никогда не совпадёт
      с короткой темой. Три теста, негативный прогон даёт `0 != 2`.

---

### Фаза 2 — Async-форма API ✅

Смысл: фронтенд пишется **один раз**. Исполнитель пока синхронный, в Фазе 4b меняется
на Celery без единой правки фронтенда.

- [x] `services/dispatch.py` — `enqueue_ingestion(document, *, processing_version, mode)`.
      Job-строка создаётся **до** возврата. Незавершённый job свежее `STALE_AFTER` не
      переставляется — защита от двойного клика. `resolve_mode()`: `auto` → celery при
      наличии брокера, иначе inline. Если в celery-режиме нет модуля задач
      или publish в Redis падает, job завершается с `queue_unavailable`: тяжёлого
      inline-fallback нет, чтобы не повторить OOM web-контейнера.
- [x] `progress.py` — источник правды о шагах: `INGESTION_STEPS`, `STEP_LABELS` (берутся
      у самих `TextChoices`, чтобы не разъехаться с моделью), `progress_for`,
      `is_terminal`, `PHASES` (11 шагов → 4 фазы для человека), `describe()`
- [x] `views.py`: `ingest` → **202** `{document, job, poll_url}`. Провал обработки — НЕ
      ошибка постановки, 202 отдаётся и в этом случае
- [x] `views.py`: `GET /documents/{id}/status/`. Метод назван `ingestion_status` с
      `url_path="status"` — иначе затенял бы импорт `rest_framework.status`
- [x] Миграция `0002_ingestionjob_celery_task_id_ingestionjob_warnings`
- [x] `ingest_document` персистит `outcome.warnings` на job
- [x] `IngestionAttemptSerializer` (не было), `warnings` в `IngestionJobSerializer`.
      `celery_task_id` наружу не отдаём
- [x] Настройки: `CURRICULUM_INGEST_MODE`, `CURRICULUM_INGEST_STALE_AFTER_SECONDS`,
      `CELERY_BROKER_URL` (читает `REDIS_URL`)
- [x] Правки тестов: `test_upload_then_ingest_flow` (200 → 202 + опрос),
      `test_failed_ingestion_returns_422_not_500` → `..._surfaces_in_status_not_500`,
      плюс 2 новых теста на `/status/`
- [x] `tests/test_dispatch.py` — 14 тестов

**Сигнатура `ingest_document` не тронута** — ~20 вызовов в тестах работают как прежде.

Проверено живым прогоном через HTTP: `201` → `202` с `poll_url` → `200` со статусом
`ready`, `progress: 1.0`, статистикой и 10 записанными переходами.

---

### Фаза 3 — Сквозной фронтенд ✅

**Сделано:** `curriculum-progress.ts` (23 теста, `npm run test:curriculum`),
`curriculum-api.ts`, `curriculum-store.ts`, `use-ingestion-polling.ts`, визард и все
шаги, страница, навигация. `tsc` и `lint` чисты.

**Сценарий пройден целиком в живом браузере на реальных моделях:**
цель → нормализация → подтверждение → загрузка учебника → обработка → генерация →
утверждение. Нормализация: «Хочу научиться решать задачи по механике за 10 класс»
→ «Физика / Механика, 10 класс». План: 2 модуля, 5 тем, 8 привязок к источникам,
прогноз финиша. После утверждения — статус `active` и запись на курс в базе.

**Найдено и починено по ходу живой проверки** (тесты этого не ловили):
1. Ошибка прерывания показывалась как «signal is aborted without reason» —
   английский текст DOMException. Теперь человеческое сообщение про таймаут.
2. Клиентский таймаут был равен серверному (180 с) — клиент обрывал запрос ровно
   тогда, когда сервер ещё мог ответить. Поднят до 300 с.
3. Ссылки на источник дублировались: «§1.2, стр. 1» три раза подряд.
   `uniqueSourceLabels` схлопывает.
4. Prerequisites показывались как `kinematics_basics` вместо названий тем.
5. `lint` поймал ошибку: пропс с именем `module` затеняет служебную переменную.

**Осталось на потом** (не блокирует): экран выбора между несколькими планами
одной цели, показ покрытия после перезагрузки страницы (сейчас `coverage_ratio`
приходит только в ответе генерации, и после релоада чип честно скрывается, а не
показывает 0%).

---

### Фаза 3b — Редизайн программы и персонализации ✅

**Зачем.** Экраны были написаны на четвёртом визуальном диалекте, которого в
приложении нет (`bg-card/50`, `border-amber-500/40`, стоковые `<Button>`). Плюс
два содержательных провала: чип «Покрытие книги 0%» врал на разноязычной паре
(учебник английский, план русский), а `plan.forecast` выбрасывался целиком.

**Сделано:**

- Программа переехала на свой роут `/dashboard/curriculum/plan/[planId]` —
  экран, к которому возвращаются каждый день, обязан иметь ссылку. Визард
  редиректит туда при `plan_review`/`done`; `PlanReview` из визарда удалён.
- Страница НЕ читает Zustand: `persist` хранит `planId`, который может
  относиться к другому плану, и по вставленной ссылке показал бы чужой курс.
  Свой хук `use-plan-page-data.ts`. Мост к стору односторонний: замечания
  рецензента видны только при `store.planId === planId`.
- Главный ход — **корешок книги** (`plan-ribbon.tsx` + `lib/curriculum-ribbon.ts`):
  полоса = весь учебник, отрезки тем по `sources[]`, тёплая шкала по модулям,
  непокрытые страницы штриховкой. Отвечает на вопрос, который список задать не
  может: что из книги в программу НЕ вошло. Процент покрытия заменён честным
  «Страниц в программе: 34 из 212».
- Прогноз выведен в тихую правую колонку (`plan-forecast-rail.tsx` +
  `lib/curriculum-forecast.ts`): ритм, три даты на микрошкале, блок срока,
  риск с текстовой подписью. Ни одного числа крупнее ~22px — герой на странице
  один.
- Персонализация: два `<select>` заменены парным слайдером
  (`level-span.tsx` + `lib/curriculum-levels.ts`). Инвариант «цель не ниже
  текущего» держится **выталкиванием**, а не блокировкой; пара живёт в одном
  объекте состояния.
- Весь раздел переведён на бумажный диалект (`CoffeePageShell`,
  `components/curriculum/paper.ts`). `AmbientBackground` убран — у шелла своя
  сетка, две давали двойное виньетирование.

**Ловушки, на которых это чуть не сломалось:**

1. `page_start`/`page_end` — `PositiveIntegerField(default=0)`, а НЕ nullable.
   «Страниц нет» приезжает **нулём**. Без этого у каждого документа вырос бы
   фантомный отрезок на нулевой странице, а фолбэк на разделы не сработал бы
   никогда. `buildRibbon` считает `null`, `undefined` и `0` одним и тем же.
2. В TS-интерфейсе `CoursePlan` не было полей `goal` и `document`, хотя DRF их
   отдаёт. Без них страница физически не может загрузить учебник и цель.
3. `desired_deadline_feasible` трёхзначен: `null` значит «срок не задавали».
   Приведение к `false` заставило бы панель заявить «не успеваете» там, где
   сроков не было.
4. Ось корешка **растёт**, а не обрезает: обрезать цитату по протухшему
   `page_count` значит молча удалить провенанс.
5. `GET /documents/{id}/sections/` отдаёт голый массив, без конверта `results`.

**Проверено в браузере** (стенд с фикстурой, 1280×900 и 375×812): взаимная
подсветка отрезок ↔ строка темы, ноль табстопов внутри корешка, инвариант
уровней в обе стороны с клавиатуры, живое объявление пролёта, отсутствие
горизонтальной прокрутки на 375px.

**Не проверено:** `prefers-reduced-motion` в живом браузере (CDP-эмуляция
запрещена в browse); в коде путь явный — `useReducedMotion()` → длительность 0.

---

### Фаза 3 — исходный чеклист

Транспорт: **напрямую в бэкенд** через `authFetch` + `BACKEND_URL`, как в
`components/nutrition/lib.ts` и `lib/contest-api.ts`. Снимает проблему multipart
(`backend-helpers.ts` умеет только JSON) и убирает потолок Next-прокси 180 с с
медленного `plans/generate/`.

- [ ] `src/lib/curriculum-api.ts` — типы в **snake_case из DRF** (как в `contest-api.ts`).
      `uploadDocument` через **XHR, не fetch** (у fetch нет события прогресса загрузки),
      `Content-Type` **не ставить** — boundary проставит браузер
- [ ] `src/lib/curriculum-progress.ts` + `.test.ts` — чистая логика: схлопывание фаз,
      расписание backoff, маппинг `error_code` → русский текст
- [ ] `src/stores/curriculum-store.ts` — Zustand + `persist`. В localStorage **только
      `step` и id**, никогда серверные объекты; `hydrateFromServer()` на маунте
- [ ] `src/app/dashboard/curriculum/page.tsx` — `FullAccessGate`, по образцу
      `dashboard/nutrition/page.tsx`
- [ ] `src/components/curriculum/curriculum-wizard.tsx`
- [ ] `goal-step.tsx`, `goal-confirm-step.tsx`
- [ ] `document-upload-step.tsx` + `pdf-dropzone.tsx`
- [ ] `ingestion-progress.tsx` + `ingestion-stepper.tsx`
- [ ] `plan-generation-step.tsx`
- [ ] `plan-review.tsx`, `plan-module-card.tsx`, `plan-topic-row.tsx`,
      `plan-issues.tsx`, `plan-forecast-card.tsx`
- [ ] `existing-plans-list.tsx`
- [ ] `src/config/dashboard-navigation.ts`: `dashboardPageMeta` + пункт меню +
      **добавить URL в `visibleNavigationRoutes` (строка 218)** — иначе не отрисуется

Экран ожидания: опрос 2 с → 5 с → 10 с, пауза при `visibilityState === 'hidden'`,
3 сетевые ошибки → «соединение потеряно, повторяем» и не сдаваться (редеплой посреди
обработки — норма). 11 шагов схлопнуть в 4 фазы для человека, сырой статус в
«подробности». Показывать прошедшее время и живые `stats`.

**Источники сделать визуально заметными, а не сноской** — это весь смысл фичи.

---

### Фаза 4a — S3/R2 ✅ (код)

**Жёсткое предусловие 4b:** воркер в отдельном контейнере Northflank не видит диск
web-контейнера → `storage_unavailable` на каждой задаче.

- [x] `S3FileStorage` по существующему `S3StorageSettings`, тот же Protocol →
      вызывающий код не изменился ни в одном месте
- [x] `boto3==1.35.99` в requirements, настройки `CURRICULUM_S3_*`
- [x] `get_storage()` выбирает S3 по одному признаку — непустому бакету
- [x] `tests/test_storage_s3.py` — 13 тестов со stub-клиентом, без сети

Решения, которые стоит помнить:

- **`ServerSideEncryption` по умолчанию НЕ отправляется.** Cloudflare R2 этот
  заголовок не принимает, и безусловный `AES256` превратил бы каждую загрузку в
  ошибку. AWS S3 с 2023 года шифрует объекты сам. Кому нужен явный SSE (`aws:kms`)
  — задаёт `CURRICULUM_S3_SSE`.
- **Ключи необязательны.** Пустые `ACCESS_KEY_ID`/`SECRET` означают обычную
  цепочку boto3 (переменные окружения, профиль, роль инстанса). Требовать их
  здесь значило бы запретить самый безопасный способ доступа.
- **Таймауты заданы явно** (5 с на соединение, 30 с на чтение, 3 попытки):
  зависший бакет иначе держит поток gunicorn до упора, а их всего 16
  (2 воркера × 8 тредов).
- **Ошибки не текут наружу**: botocore-исключения переводятся в `StorageError` с
  безопасным текстом, а «нет объекта» отличается от «хранилище недоступно».
- Удаление отсутствующего объекта — не ошибка: повторный вызов обязан приводить
  к тому же состоянию.

**Бакет заведён и проверен вживую.** Cloudflare R2, бакет `timely`, endpoint
`https://02b2d0aea9df4ed2c6ef424796bee440.r2.cloudflarestorage.com`, регион
`auto`. Аддон `bucket` в самом Northflank не подошёл: API отвечает
`This feature is not enabled for your account`.

Проверено с реальными кредами (объект после проверки удалён):
save → open с побайтовым совпадением → exists → подписанная ссылка → delete.
Затем сквозной прогон всего пайплайна через R2: PDF залит, статус `ready`,
2 страницы → 10 блоков → 10 фрагментов, предупреждений нет, и все 10 фрагментов
получили векторы `openai/text-embedding-3-small` на 1536 измерений. Один прогон
подтвердил разом фазы 4a, 5 и 7.

`CURRICULUM_S3_*` и `EMBEDDING_*` (7 переменных) положены в секрет-группу
Northflank `timely`. Работающий контейнер их пока не видит — подхватит при
следующем деплое, и это правильный порядок: прод крутит `main`, где кода S3 ещё
нет, поэтому до мержа переменные ничего не меняют.

Известный хвост, не блокирующий фазу: `signed_url()` не вызывается пока ниоткуда,
а у локального backend он возвращает маршрут `/api/curriculum/documents/file/...`,
которого в `urls.py` нет. Появится вместе с экраном «скачать исходник».

---

### Фаза 4b — Celery + Redis ✅ (код)

- [x] `backend/config/celery.py`, `backend/config/__init__.py` → `celery_app`
- [x] `backend/curriculum/tasks.py` — тонкий адаптер, границу брокера пересекает
      только UUID
- [x] Настройки: `CELERY_RESULT_BACKEND = None` (`IngestionJob` **и есть** хранилище
      результата), `acks_late`, `prefetch_multiplier=1`, `max_tasks_per_child=8`,
      `REJECT_ON_WORKER_LOST=False`
- [x] `docker-entrypoint.sh`: миграции под `if [ "${RUN_MIGRATIONS:-1}" = "1" ]`
- [x] `tests/test_tasks.py` — 10 тестов с `CELERY_TASK_ALWAYS_EAGER`
- [ ] Northflank: сервис `timely-worker` (действие в панели, см. ниже)

`services/dispatch.py` публикует задачу через `transaction.on_commit`, заранее пишет
её id в job и не откатывается на inline при ошибке брокера. Id также работает
как fencing-token: запоздавший старый воркер не может затереть новый запуск.

Решения, которые стоит помнить:

- **`rediss://` и TLS.** Redis-аддон Northflank отдаёт `rediss://`
  (`REDIS_MASTER_URL`, TLS включён), и без `ssl_cert_reqs` kombu падает при
  СТАРТЕ воркера, а не на первой задаче — по логам это почти не отлаживается,
  потому что процесс не доживает до полезной работы. Настройки сами добавляют
  `CELERY_BROKER_USE_SSL` для схемы `rediss://`, проверку сертификата НЕ
  отключая. Проверено: `redis://` → `broker_use_ssl: False`, `rediss://` →
  `{'ssl_cert_reqs': CERT_REQUIRED}`.
- **Northflank-префикс обязателен к учёту**: аддон `redis-cache` публикует
  `NF_REDIS_CACHE_REDIS_MASTER_URL`, а не голый `REDIS_MASTER_URL`. Настройки
  читают явный `CELERY_BROKER_URL` первым, затем стандартные имена и этот
  предсказуемый `NF_*_REDIS_MASTER_URL` fallback.
- **Только JSON, никакого pickle**: сообщение из скомпрометированного Redis
  иначе означает исполнение произвольного кода в воркере.
- **Ретраи только по типизированным временным кодам.** Ошибки файла, парсера и
  неизвестный `internal_error` не повторяются автоматически: после платного OCR
  это могло бы удвоить счёт. Временный отказ storage/provider получает не более
  трёх повторов с backoff; ошибка публикации в Redis фиксируется отдельно как
  `queue_unavailable` и никогда не запускает тяжёлый inline-fallback. Сейчас
  такой task-retry нужен только для `storage_unavailable`; OCR и embeddings
  имеют собственную локальную политику деградации и не перезапускают всю книгу.
- **`prefetch_multiplier=1`** не про справедливость, а про память: PDF целиком в
  RAM плюс растры страниц, и набранная впрок очередь означает OOM-kill на
  середине второй книги.

Что сделать в панели Northflank, чтобы это заработало:

1. В секрет-группу `timely` добавить `CELERY_BROKER_URL` = значение
   `REDIS_MASTER_URL` аддона `redis-cache` и `CURRICULUM_INGEST_MODE=celery`.
   Явный mode остаётся fail-closed, даже если связь с аддоном пропадёт.
2. Проверить worker-сервис из того же репозитория и `Dockerfile`:
   команда `celery -A config worker --loglevel=info --concurrency=1`,
   переменная `RUN_MIGRATIONS=0`, портов не открывать, память ≥ 1 ГБ.
3. Поднять web с 256 МБ (`nf-compute-10`) до 512 МБ (`nf-compute-20`):
   PDF больше не обрабатывается в web, но запас нужен для загрузки и API.

**Порядок важен: сначала Фаза 4a в проде (бакет), потом воркер.** Воркер в
отдельном контейнере не видит диск web-контейнера, и до переезда на S3 каждая
задача падала бы в `storage_unavailable`.

---

### Фаза 5 — Токенайзер + overlap ✅

- [x] `curriculum/tokenizer.py` — Protocol + `TiktokenTokenizer` (cl100k_base) +
      `HeuristicTokenizer` как фолбэк
- [x] Параметры в settings: `CHUNK_TARGET_TOKENS=500`, `CHUNK_MAX_TOKENS=650`,
      `CHUNK_OVERLAP_TOKENS=75`; `chunking` остался чистым — значения ему
      передаёт `services/ingestion.py`
- [x] Overlap **только внутри прогонов однотипной прозы**
- [x] `PROCESSING_VERSION` поднята до `1.1.0`
- [x] `tests/test_tokenizer.py` — 23 теста

Насколько эвристика врала (замер, из-за него фаза и нужна):
«Равномерное прямолинейное движение — это движение с постоянной скоростью тела.»
— **36 токенов** в cl100k_base против **20** по формуле «символы делить на 4».
То есть на кириллице фрагмент «в 350 токенов» весил около 630, и бюджет
контекста считался почти вдвое оптимистичнее реальности. На латинице ошибка
обратная: 60 символов → 11 реальных токенов против 15 по эвристике.

Как устроен overlap и почему он безопасен:

- Прозаические фрагменты копятся не в выход, а в **прогон** (`run`). Перекрытие
  добавляется в момент ЗАКРЫТИЯ прогона, а прогон рвётся на любом блоке, который
  прозой не является: определение, теорема, доказательство, пример, задача,
  решение, таблица, рисунок, заголовок и смена раздела. Это и есть гарантия из
  Решения №3 — текст решения физически не может оказаться в открытом фрагменте.
- Хвост берётся от **исходного** текста соседа, а не от уже дополненного, иначе
  перекрытия наслаиваются и третий фрагмент тащит кусок первого.
- `block_ids` и страницы остаются своими: заимствованный хвост — контекст для
  поиска, а не содержимое фрагмента. Иначе цитата начала бы указывать на
  страницы, где текста нет.

Грабли, найденные по ходу:

- **`tiktoken` качает файл кодировки при первом обращении.** В контейнере это
  поход в сеть посреди обработки книги, а при закрытом трафике — молчаливый
  откат на эвристику. Откат безопасен сам по себе, но МЕНЯЕТ границы фрагментов
  при той же `PROCESSING_VERSION`, то есть ломает главный контракт модуля:
  одинаковый вход обязан давать одинаковый `content_hash`. Закрыто двумя
  способами: `Dockerfile` прогревает кэш на сборке (`TIKTOKEN_CACHE_DIR`), а
  ingestion добавляет предупреждение `tokenizer_fallback_heuristic`, если
  откат всё же случился.
- **Тест на «перекрытия не накапливаются» был бесполезен**, пока блоки состояли
  из одинаковых слов: «слово0» встречается везде, и «притащено из первого
  фрагмента» неотличимо от «и так было во втором». Слова в фикстурах теперь
  уникальны для каждого блока.

---

### Фаза 6 — EPUB ✅

- [x] `curriculum/parsers.py` — Protocol `DocumentParser` + `resolve_parser` по
      magic-байтам. Неизвестный формат → `UnsupportedDocumentType`. PDF-ветка
      оборачивает существующий `extraction.py`, логика не дублируется
- [x] `curriculum/epub_extraction.py`: порядок по **spine**, `<h1>` → глава,
      `<h2>/<h3>` → раздел, выброшены `nav`/`script`/`style`/`svg`
- [x] Страницы для EPUB не выдумываются
- [x] `upload_validation.validate_upload` — единая точка входа с ветками PDF и
      EPUB; проверки ZIP: `mimetype` без сжатия, потолок распакованного размера
      и числа записей, запрет `..` в путях
- [x] Цитата без страниц: `Механика, §7.2` вместо `стр. 0`
- [x] `ebooklib`, `beautifulsoup4`, `lxml` в requirements
- [x] `tests/test_epub.py` — 21 тест

**Отступление от чеклиста: поля страниц НЕ сделаны nullable.** В проекте уже
принято, что «страницы нет» — это `0`: так считает `formatSource`, так считает
`buildRibbon` на фронтенде, так работает `_write_blocks`. Добавить рядом `null`
значило бы завести ВТОРОЕ обозначение того же самого и потом всюду проверять
оба. Ноль оставлен, и он честен: страницы с номером 0 в книгах не бывает, так
что информация не теряется.

Nullable сделано ровно там, где без него данные терялись: **`DocumentBlock.page`**
(миграция `0004`). Это FK, и без `null` блок EPUB было физически невозможно
записать — `_write_blocks` молча пропускал все блоки, а фрагменты ссылались в
`block_ids` на несуществующие строки. Тот самый висячий провенанс, против
которого раздел и существует. Поймано сквозным прогоном: «блоков: 0» при пяти
фрагментах.

Грабли, найденные по ходу:

- **`ebooklib.read_epub` требует ПУТЬ, а не файловый объект**: внутри зовёт
  `os.path.isdir` и роняет `TypeError`. Из хранилища (S3 или папка) приходят
  байты, пути не существует в принципе — отсюда временный файл с гарантированной
  уборкой.
- **XHTML разбирается HTML-парсером намеренно.** XML-парсер уважает пространство
  имён XHTML, и тогда `find_all("p")` не находит НИЧЕГО: теги там
  `{http://www.w3.org/1999/xhtml}p`.
- **Одного `PK\x03\x04` мало для опознания EPUB**: под него подходят docx, xlsx,
  jar и любой архив. Отличает EPUB несжатая запись `mimetype` в начале файла —
  по ней и проверяем. Побочный эффект: архив, не соблюдающий спецификацию,
  отсеивается раньше как «не EPUB».
- **Разметка маркеров переиспользована, а не написана заново.** «Задача 5.»,
  «Решение.», «Определение.» размечает `blocks.classify_text_run` — общий с PDF
  код. Вторая реализация неизбежно разошлась бы с первой, а от разметки
  `solution` зависит политика доступа.

---

### Фаза 7 — pgvector + эмбеддинги ✅

**Состояние на 2026-08-09: схема, canary-индексация и live smoke-benchmark
проверены на Northflank.**

**pgvector установлен на БОЕВОЙ базе Northflank** (`timely-data`,
PostgreSQL 18.4, расширение `vector` 0.8.3). Ставилось админской ролью аддона
(`EXTERNAL_POSTGRES_URI_ADMIN` из `northflank get addon credentials`), несмотря
на то что у `vector` стоит `trusted = false`, а роль не суперюзер, — Northflank
это разрешает. Рабочая роль Django расширение видит, `vector(1536)` пишет и
HNSW-индекс с `vector_cosine_ops` создаёт. Миграции `0003` и `0006` применены
на production; `docker-compose.yml` с образом pgvector из исходного чеклиста
не нужен.

Второй сервер, `100.105.19.20:5432/appdb` (PostgreSQL 16.14, pgvector 0.8.6,
домашний ПК `beka4ka-pc` в tailnet), боевой базой НЕ становится. Замер из самого
прод-контейнера через `northflank exec`, по 10 TCP-подключений:

| Куда | Медиана | Разброс |
|---|---|---|
| аддон Northflank | **4 мс** | 3–9 |
| beka4ka-pc через tailnet | **206 мс** | 206–210 |

Разница в 50 раз. Страница дашборда делает 15–40 запросов, то есть переезд
означал бы 3–8 секунд на страницу вместо 60–160 мс. База остаётся в Northflank.

Побочное открытие: под сервиса `timely` УЖЕ имеет доступ в tailnet — в
`main-service` нет ни одного бинарника Tailscale и нет SOCKS-прокси, но адрес
`100.105.19.20` из контейнера доступен. Значит, рядом работает сайдкар в
TUN-режиме, настроенный на уровне платформы. Тащить `tailscaled` в образ не надо
(второй клиент в том же сетевом пространстве только конфликтовал бы), а канал
пригодится там, где 200 мс не мешают: батчи эмбеддингов, локальные модели.

Сделано:

- `requirements.txt`: `pgvector==0.4.1` (клиентская часть; расширение на сервере).
- `models.KnowledgeChunk`: `embedding VectorField(1536)`, `embedding_model`,
  `embedded_at`; мёртвое `embedding_status` ожило — `choices` + `db_index`, плюс
  индекс `(document, embedding_status)` под выборку очереди.
- Миграция `0003_chunk_embeddings`: колонка создаётся ВЕЗДЕ (SQLite принимает
  произвольное имя типа), а расширение и HNSW — под гейтом
  `connection.vendor == "postgresql"`. `CREATE EXTENSION` выполняется только
  если расширения ещё нет: `appuser` не суперюзер, и безусловный вызов уронил
  бы миграцию там, где всё уже стоит.
- `curriculum/embeddings.py`: Protocol / Null / OpenAI-совместимый / фабрика.
  Батч 64, ограниченный backoff (3 попытки), проверка размерности и порядка
  ответа по полю `index`. Фабрика требует модель, базовый URL И ключ: забытый
  ключ должен давать честный `skipped`, а не поток 401 со статусом `failed`.
- `services/embedding_index.py`: `index_document_chunks` **не бросает никогда**,
  переиспользование по `(content_hash, embedding_model)`, потолок
  `CURRICULUM_MAX_EMBEDDED_CHUNKS`, упавший батч помечает `failed` только свои.
- Врезка в `_run_pipeline` — после закрытия `transaction.atomic()`, до
  `QUALITY_CHECK`: сетевой вызов не держит транзакцию.
- `retrieval.PgVectorDenseRetriever` + `get_dense_retriever()`: на SQLite отдаёт
  прежний `InMemoryDenseRetriever`, поэтому `test_retrieval.py` не потребовал
  ни одной правки.
- `POST /api/curriculum/search/`: режим фиксирован `STUDENT_READ_MODE` (клиент
  не выбирает себе политику доступа), векторы в ответе не возвращаются.
- `management/commands/curriculum_embed.py` с `--dry-run`, `--reset-failed` и
  оценкой стоимости до траты.
- `curriculum/tests/test_embeddings.py` покрывает provider, индексацию,
  model mismatch, бюджетные предохранители команды и выбор retriever.
- `CURRICULUM_EMBEDDINGS_ENABLED` в `config/settings.py`: под тест-раннером
  выключается всегда. Появился не из осторожности — как только
  `EMBEDDING_MODEL` попал в `.env`, прогон curriculum вырос с 1.3 до 70
  секунд и упал: пайплайн пошёл в сеть на ретраях.

Production activation выполнен безопасным canary:

- в web и worker заданы `EMBEDDING_MODEL=openai/text-embedding-3-small`,
  `EMBEDDING_BASE_URL=https://openrouter.ai/api/v1`; ключ берётся из
  `OPENROUTER_API_KEY`;
- live SQL подтвердил `vector` 0.8.3, `vector(1536)`, HNSW с
  `vector_cosine_ops` и миграции `0003`/`0006`;
- dry-run показал 10 фрагментов / 118 токенов / менее $0.0001, после budget gate
  все 10 получили READY-векторы, ошибок и пропусков нет;
- `curriculum_retrieval_eval` на трёх TOC-запросах: Recall@10/MRR@10 lexical
  0.333/0.333, dense 0.667/0.667, hybrid 0.667/0.667; утечка решений 0.
  Это smoke-set, а не замена размеченному benchmark на нескольких книгах.

Команды теперь fail-closed: `curriculum_embed` и `curriculum_retrieval_eval`
по умолчанию делают только dry-run; платный вызов требует `--execute` и проходит
через `--max-usd`. Смена модели автоматически выбирает READY-векторы другой
модели, а dense retrieval фильтрует строки по текущему `embedding_model`.

### Фаза 7 — проверенный чеклист ✅

- [x] Миграция: `VectorField(1536)`, HNSW-индекс и `CREATE EXTENSION` **под гейтом**
      `schema_editor.connection.vendor == "postgresql"` (тесты идут на SQLite).
      Оживить мёртвое `embedding_status` (choices + `db_index`), добавить
      `embedding_model`, `embedded_at`
- [x] Локальный fallback остаётся SQLite; реальный PostgreSQL/pgvector проверен
      на canary-базе Northflank, отдельный `docker-compose.yml` не нужен
- [x] `curriculum/embeddings.py` — зеркало `ocr.py`: Protocol / Null / Real / factory.
      `get_embedding_provider()` — первый реальный потребитель `ROLE_EMBEDDING`.
      Batch 64, ограниченный exponential backoff, без бесконечных ретраев
- [x] `services/embedding_index.py` — `index_document_chunks`, **никогда не бросает**.
      Переиспользование по `content_hash` (повторная загрузка книги = $0), потолок
      `CURRICULUM_MAX_EMBEDDED_CHUNKS`, упавший батч помечает `failed` только свои
- [x] Врезка в `_run_pipeline`: статус `INDEXING` уже существует. **После** закрытия
      `transaction.atomic()`, до `QUALITY_CHECK` — сетевой вызов не должен держать
      транзакцию
- [x] `PgVectorDenseRetriever` под существующим Protocol + `get_dense_retriever()`,
      который на SQLite отдаёт старый `InMemoryDenseRetriever` → `test_retrieval.py`
      не требует правок
- [x] `POST /api/curriculum/search/` — **векторы в ответе не возвращать**, политика
      доступа через существующий `apply_access_policy`, режим `solve`
- [x] `management/commands/curriculum_embed.py`: dry-run по умолчанию, явный
      `--execute`, `--max-usd`, смена модели и принудительный `--reindex-all`

Стоимость: учебник 400 страниц ≈ 200k токенов ⇒ **~$0.004**. Потолки нужны не для
экономии, а чтобы ограничить патологический документ.

---

### Фаза 8 — Хвосты ✅

- [x] Structured NDJSON logging событий ingestion через allowlist: без текста,
      email, filename/storage key, exception message и векторов
- [x] Покрытие из provenance: distinct непустые `section_path` в
      `CourseSourceBinding` против актуального TOC; дубли/unknown не раздувают
      метрику, смена processing version помечает её stale
- [x] Production lexical retriever на `to_tsvector('russian') @@ plainto_tsquery(...)`:
      endpoint выбирает его на PostgreSQL, а выражение совпадает с функциональным
      GIN-индексом; **для русского учебника морфология важнее exact-token fallback**
- [x] Метрика и quota guard для AI-backed curriculum actions; Celery восстанавливает
      `usage_scope`, поэтому OCR/embedding записываются на владельца документа.
      Worker admission дополнительно сериализован через короткую per-user reservation
      (`AIUsageQuotaState`, миграция `ai_engine/0009`), а отказ становится fenced
      terminal `ai_usage_limit_exceeded`. Каждый OCR/embedding/planning/provider-call
      также получает атомарный capacity lease до сетевого запроса; токены считаются
      локально с запасом, а lease снимается только после записи usage-event
- [x] Стриминг загрузки вместо `upload.read()`: Django спуливает >1 МБ на диск,
      валидатор читает bounded chunks, Local storage пишет атомарно, S3/R2 —
      через bounded `upload_fileobj`; PDF marker scan держит O(1) state, а EPUB
      проверяет EOCD/central directory и absolute/per-entry unpacked caps до того,
      как `ZipFile` создаст все `ZipInfo`; OCR-рендер ограничен по размеру страницы
- [x] README + curl-примеры upload → ingest → status → search

**Явно не делаем:** multimodal-таблицы, reranker как отдельную фичу,
Pinecone/Qdrant и hosted vector stores. OCR сканированных страниц уже встроен в
общий пайплайн; `ROLE_RERANKER` и `NoopReranker` оставляют расширение ранжирования
изолированным.

---

## Зафиксированные решения

Не перерешивать без явной просьбы пользователя.

1. **Стек — Django/DRF.** Исходная спека требовала FastAPI + SQLAlchemy + Alembic;
   в репозитории их нет, а `curriculum/` уже реализует ~80% спеки. Отдельный сервис
   означал бы вторую ORM на той же базе и Alembic рядом с Django-миграциями. Запрещено
   `AGENTS.md` и `CLAUDE.md`. Спека переложена на Django семантически.
2. **Curriculum — новое поколение**, `/dashboard/program` жив, но не развивается.
3. **Overlap только внутри однотипной прозы.** Спека требовала
   `CHUNK_OVERLAP_TOKENS=75`; наивное скользящее окно затащит текст решения в чанк с
   `solution_visibility="always"` — ученик увидит ответ. **13 тестов в 4 файлах**
   гарантируют обратное. Overlap не пересекает границу `solution`/`task`.
4. **RAG — pgvector + OpenRouter**, `openai/text-embedding-3-small` (проверено:
   эндпоинт `/api/v1/embeddings` существует, $0.02/M токенов, контекст 8K, 1536 dims).
5. **Async — Celery + Redis.** Redis-аддон на Northflank поднят, схема `rediss://`.
6. **Порядок — фундамент → UI → остальное.**
7. **PyMuPDF не тащим.** pypdfium2 уже работает и покрыт тестами; у pypdfium2
   BSD-лицензия против AGPL у PyMuPDF.

---

## Грабли

Пополнять по ходу.

- **Настроенный `.env` протекает в тесты — ТРИЖДЫ одна и та же болезнь.**
  Сперва `EMBEDDING_MODEL` увёл прогон в сеть (1.3 с → 70 с). Потом
  `CURRICULUM_S3_*` заставил тест выбора backend читать боевой ключ R2, а любой
  забывший `set_storage` тест начал бы писать мусор в настоящий бакет. Потом
  `REDIS_MASTER_URL` уронил **восемь** тестов разом: `resolve_mode` стал
  выбирать celery, и документы в inline-тестах перестали обрабатываться вовсе.
  Лечение одинаковое и теперь это конвенция проекта: рубильник в
  `config/settings.py`, гаснущий при `"test" in sys.argv`, плюс
  `@override_settings` в тех тестах, которые проверяют саму логику выбора.
  Рубильников три: `CURRICULUM_EMBEDDINGS_ENABLED`, `CURRICULUM_S3_ENABLED` и
  обнуление `CELERY_BROKER_URL`. **Заводя четвёртый внешний сервис, заводи и
  четвёртый рубильник — иначе тесты сломаются не сразу и не очевидно.**
- **У python.org-сборки Python на macOS нет корневых сертификатов.** Соединение
  с `rediss://` падает на `CERTIFICATE_VERIFY_FAILED: unable to get local issuer
  certificate`, и это выглядит как ошибка конфигурации TLS, хотя конфигурация
  верна. Лечится либо `Install Certificates.command` из папки Python, либо
  разово: `SSL_CERT_FILE=$(python -c 'import certifi; print(certifi.where())')`.
  В контейнере Debian системное хранилище на месте, поэтому проверку сертификата
  отключать НЕ надо — она и не отключена.

- **Настроенный провайдер в `.env` ломает тесты, если нет рубильника.** Стоило
  добавить `EMBEDDING_MODEL` в `.env`, как обработка книги в тестах пошла в сеть:
  прогон 1.3 с → 70 с и один упавший тест. Патчить провайдера в каждом файле, где
  запускается пайплайн, — путь в никуда (их уже четыре). Лечится флагом
  `CURRICULUM_EMBEDDINGS_ENABLED`, который `config/settings.py` гасит при
  `"test" in sys.argv`; тесты самой фабрики включают его обратно через
  `@override_settings`.
- **Тесты, читающие `os.environ`, зависят от чужого `.env`.**
  `test_embedding_role_does_not_fall_back_to_chat_model` проверял, что
  `ROLE_EMBEDDING` не откатывается на чат-модель, но делал это, полагаясь на
  ОТСУТСТВИЕ `EMBEDDING_MODEL` в окружении. После настройки роли тест стал
  проверять содержимое `.env` разработчика, а не поведение кода. Такие тесты
  обязаны сами снимать переменную на время прогона.

- **Эмбеддинг-моделей НЕТ в каталоге OpenRouter `/api/v1/models`.** В каталоге из
  четырёхсот моделей ни одной с «embed» в идентификаторе, поэтому правило проекта
  «проверь модель в `/api/v1/models`, прежде чем её ставить» (`CLAUDE.md`, про
  image-модели) здесь даёт ЛОЖНЫЙ вывод, что эмбеддингов у OpenRouter нет вовсе.
  Я на этом уже ошибся и успел записать неверное в код и в этот файл. Эндпоинт
  `/api/v1/embeddings` существует и совместим с OpenAI SDK: батч, поле `index`,
  `usage.cost`. Проверять надо запросом к самому эндпоинту:
  ```
  curl -s https://openrouter.ai/api/v1/embeddings -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"model":"openai/text-embedding-3-small","input":"проверка"}' | head -c 200
  ```
- **Размерность у моделей разная, а в схеме она зафиксирована.**
  `openai/text-embedding-3-small` — 1536 (совпадает с `vector(1536)` в миграции
  `0003`), `baai/bge-m3` — 1024, `qwen/qwen3-embedding-8b` — 4096. Смена модели
  на другую размерность — это новая миграция плюс переиндексация всех чанков, а
  не правка переменной окружения. Провайдер проверяет длину каждого вектора и
  отказывается писать чужую.

- **После `git pull` этой ветки обязательно `migrate`.** Миграция `0002` добавляет
  `IngestionJob.warnings` и `celery_task_id`. Тесты этого НЕ ловят: они поднимают
  свежую тестовую базу и применяют миграции автоматически. В dev-базе колонок нет,
  и `POST .../ingest/` падает с 500 (`column curriculum_ingestionjob.warnings does
  not exist`). Поймано живой проверкой в браузере, не тестами.
  ```
  cd backend && ./venv/bin/python manage.py migrate curriculum
  ```
- **Починка плана может выбить генерацию за таймаут gunicorn.** `_plan_with_one_repair`
  вызывает модель ДВАЖДЫ, а `COURSE_PLANNING_TIMEOUT` по умолчанию 180 с. Худший
  случай — около 360 с плюс поиск контекста, тогда как в проде стоит
  `gunicorn --timeout 200`: воркер будет убит по SIGABRT посреди запроса, и ученик
  получит оборванное соединение вместо плана. Наблюдалось локально: генерация не
  уложилась и в 180 с клиентского таймаута.
  Временная мера — клиентский таймаут поднят до 300 с. **Настоящее решение —
  перевести генерацию плана на ту же схему «задача + опрос», что и обработку
  учебника** (Фаза 4b), либо снизить `COURSE_PLANNING_TIMEOUT` и
  `COURSE_PLANNING_REASONING_EFFORT`.
- **Клиентский таймаут обязан быть больше серверного.** Равные значения означают,
  что клиент обрывает запрос ровно тогда, когда сервер ещё мог ответить.
- **Обрыв запроса на клиенте НЕ отменяет работу на сервере → дубли планов.**
  Воспроизведено: клиент отвалился по таймауту, пользователь нажал «Построить
  программу» ещё раз, и в базе оказалось ДВА плана по одной паре цель+документ —
  один утверждённый и один осиротевший (созданы с разницей в 8 секунд, второй был
  поздним ответом первого запроса). Это тот же класс проблемы, что «P0 —
  стабильность повторных запросов» в `CLAUDE.md` про доску.
  Чинится тем же приёмом, что и обработка учебника: идемпотентность по паре
  (цель, документ, версия) плюс «задача + опрос» вместо долгого запроса. Отдельно
  нужен экран выбора, если планов у цели несколько.
- **Тесты гонять через `./venv/bin/python`, не `python3`.** Системный python 3.14 без
  `pypdfium2` → `ModuleNotFoundError` на импорте `urls.py`. Команда в `CLAUDE.md`
  указана как `python3` и в этом виде не работает:
  ```
  cd backend && DATABASE_URL=sqlite:////tmp/timely-curriculum.sqlite3 \
    ./venv/bin/python manage.py test curriculum -v 1
  ```
- **`APPEND_SLASH = False`** + DRF router ⇒ все URL фронтенда со слешем на конце.
  Тот же класс баг, про который уже есть длинный комментарий в `next.config.js`.
- **`rediss://` требует явной TLS-настройки.** Kombu на схеме `rediss` требует
  `ssl_cert_reqs`, иначе Celery падает при **старте**, а не на первой задаче.
  Либо `?ssl_cert_reqs=required` в URL, либо `CELERY_BROKER_USE_SSL`.
- **У Celery-воркера нет `AIUsageContextMiddleware`**, поэтому `record_model_usage`
  молча выбросит каждое списание — он возвращает `None` при пустом `user_email`.
  Тело задачи обязано быть внутри `usage_scope(user_email=..., feature=...)`,
  иначе расход на OCR и эмбеддинги выглядит нулевым.
- **`tiktoken` при первом использовании скачивает BPE-файл по сети.** В закрытом
  контейнере упадёт в рантайме. Лечится `TIKTOKEN_CACHE_DIR` + прогревом на
  `docker build`, плюс тихий фолбэк на `HeuristicTokenizer`.
- **`visibleNavigationRoutes`** в `src/config/dashboard-navigation.ts:218` — это
  allowlist из 7 роутов. Новая страница без записи в нём не появится в меню.
- **`X-User-Email` не верифицируется нигде в приложении.** Не регрессия, но curriculum
  поднимает ставки: чужие учебники + извлечённые решения задач.
- **Пароль Redis / любые креды — только в `.env`** (в `.gitignore`, строка 29) и в
  переменные Northflank. В этот файл, в `.env.example` и в коммиты — никогда.

---

## Команды

```bash
# тесты curriculum
cd backend && DATABASE_URL=sqlite:////tmp/timely-curriculum.sqlite3 \
  ./venv/bin/python manage.py test curriculum -v 1
```

```bash
# фронтенд
npm run type-check && npm run lint
```

```bash
# ручная загрузка учебника (обработка синхронная, это основной путь до Фазы 4b)
cd backend && ./venv/bin/python manage.py curriculum_ingest_pdf book.pdf \
  --user-email me@example.com
```

Полный план: `~/.claude/plans/enumerated-gathering-storm.md`
