@AGENTS.md

# Timely — контекст проекта для Claude

## Обязательное правило

Перед любыми изменениями прочитай `AGENTS.md` целиком. Его требования по архитектуре,
безопасности, тестированию и Vector DSL имеют приоритет над этим файлом.

Одно исключение: Phase 5 в `AGENTS.md` («Do not integrate into main production
pipeline yet») УЖЕ ВЫПОЛНЕН — пользователь дал явное разрешение, и
`vector_pipeline.py` подключён к `/api/ai/illustration` за фича-флагом. Остальные
требования `AGENTS.md`, включая запрет на model-generated geometry, действуют
без изменений.

Не коммить изменения без прямой просьбы пользователя. Репозиторий сейчас содержит
много незавершённых пользовательских изменений и untracked-файлов: не удаляй, не
перезаписывай и не откатывай их.

## Что такое Timely

Timely — полнофункциональная образовательная платформа для школьников и студентов:

- дневник, расписание, оценки и домашние задания;
- цели, привычки, достижения, задачи и календарь;
- учебные программы, интервальное повторение и таймер фокуса;
- AI Tutor;
- интерактивная научная доска `/dashboard/whiteboard`.

Текущий основной фокус разработки — научная доска. Пользователь должен иметь
возможность попросить AI объяснить тему, получить аккуратную научную схему, двигать
элементы и подписи, отменять действия и продолжать работу как на современной
whiteboard-доске.

## Технологии

### Frontend

- Next.js 15, React 18, TypeScript;
- Tailwind CSS, shadcn/ui, Radix UI;
- Zustand для состояния;
- Framer Motion и dnd-kit;
- KaTeX для формул;
- frontend запускается на `http://localhost:3000`.

### Backend

- Django 6 и Django REST Framework;
- PostgreSQL в production, SQLite допустим для изолированных тестов;
- OpenAI-compatible API и внешние image-generation providers;
- OpenCV для обработки изображений и fallback SVG → PNG;
- backend запускается на `http://localhost:8000`.

## Важные каталоги

```text
src/app/dashboard/whiteboard/       Страница научной доски
src/components/whiteboard/          Canvas, узлы, иллюстрации, подписи и выноски
src/stores/whiteboard.ts            Состояние доски и история

backend/ai_engine/                  AI-логика и API доски
backend/ai_engine/canvas_analyzer.py
                                    Семантический анализ содержимого canvas
backend/ai_engine/image_enrichment.py
                                    Растровый image-generation путь (Seedream 4.5)
backend/ai_engine/illustration_pipeline.py
                                    Растровый pipeline: генерация + vision-грунтинг
backend/ai_engine/vector_pipeline.py
                                    Детерминированный путь: planner → layout → SVG/PNG
backend/ai_engine/vector_renderer.py
                                    Детерминированный Vector DSL → SVG/PNG
backend/ai_engine/illustration_views.py
                                    POST /api/ai/illustration: сначала вектор, потом растр
backend/ai_engine/label_layout.py   Раскладка подписей (только растровый путь)
backend/ai_engine/test_vector_dsl.py
                                    Фокусные тесты Vector DSL и vector_pipeline
```

## Текущее состояние научной доски

### Уже реализовано

Vector DSL:

- Детерминированный Vector DSL версии `0.1` со строгой валидацией.
- Backend-рендеринг SVG без raw SVG/path/point passthrough от модели.
- Компоненты: оси, функции, тела, поверхности, векторы, углы, подписи,
  dimension lines, connectors и trajectories.
- SVG → PNG через заменяемый converter с OpenCV fallback.
- Эталонная схема наклонной плоскости:
  - одна плоскость;
  - один брусок;
  - один угол `30°`;
  - ровно три силы: `mg`, `N`, `f`;
  - один наконечник на каждой стрелке;
  - отсутствие пересечений подписей со стрелками.

Geometry-only режим и подписи структурой:

- `VectorRenderer(emit_text=False)` рисует SVG **без единого `<text>`**.
- `render_with_labels()` отдаёт `(svg, labels)`, где labels — контракт фронтенда:
  `{content, target_kind, x, y, arrow_to:{x, y}}` в процентах 0–100.
- `arrow_to` считается арифметикой, а не vision-грунтингом: для силы это
  СЕРЕДИНА ДРЕВКА (anchor `<id>.mid`), для угла — середина дуги, для тела и
  поверхности — центр.
- Позиции текста по-прежнему выбирает коллизионный солвер рендерера, поэтому
  подписи приезжают на доску уже разложенными.

Production-интеграция (за фича-флагом):

- `vector_pipeline.try_build_vector_illustration()` — Qwen semantic planner →
  строгая валидация `scientific_scene_plan` → physics/layout normalization →
  compact Seedream prompt → опциональный Qwen visual critic → backend-owned
  SVG overlay. Исключения наружу не летят.
- Planner и critic: `qwen/qwen3.7-plus`; image generator:
  `bytedance-seed/seedream-4.5`. Все три роли используют текущий OpenRouter key.
- A/B-режимы: `legacy`, `planner`, `planner_critic`, `deterministic`.
  Production default — `legacy`, поэтому новые Qwen-вызовы не происходят без
  явного переключения `DIAGRAM_PIPELINE_MODE`.
- Для поддерживаемой механики Seedream получает только детерминированную
  structure reference. Стрелки, дуга угла, точные контуры и labels вычисляет
  backend; Seedream не является источником геометрии.
- Critic проверяет финальный preview, но его ответ калибруется относительно
  backend-owned overlay: Qwen не может потребовать от Seedream дорисовать
  подписи, стрелки или угол. Исходный ответ сохраняется в `critic_raw` для
  аудита, а решение принимает очищенный `critic`.
- Подключён в `illustration_views.py` ПЕРЕД `_enrich_command`. Рестайл
  (`reference_image_url`) через вектор не идёт.
- Старый `ILLUSTRATION_VECTOR_PIPELINE` сохранён как совместимый alias для
  `deterministic`; основной переключатель — `DIAGRAM_PIPELINE_MODE`.

Растровый путь:

- `IMAGE_GEN_MODEL = google/gemini-3-pro-image` (Nano Banana Pro).
  Прежняя `bytedance-seed/seedream-4.5` УДАЛЕНА с OpenRouter: её нет в
  `/api/v1/models`, а запрос отвечает 404 «No endpoints found that support the
  requested output modalities», из-за чего падала любая генерация. Прежде чем
  ставить сюда модель, проверь, что она есть в `/api/v1/models`.
- Gemini-image мультимодальная (`output_modalities: ["image","text"]`), поэтому
  в `_is_image_only_model` она НЕ входит. Туда попадают только чисто
  image-модели (Seedream был такой) → `modalities: ["image"]`.
- `TEXT_FREE_TERMINAL` добавляется в конец промпта для любой чистой
  image-модели.
- FLUX выпилен из репозитория полностью: ни кода, ни веток, ни тестов.

Подписи на фронтенде:

- Подписи двигаются напрямую, без отдельного move-handle.
- Подпись можно утащить ЗА рамку картинки: `OUT_OF_FRAME_MARGIN_PCT = 50` в
  `src/lib/illustration-contrast.ts` (±50 п.п. по каждой оси). CSS-обрезки в
  дереве иллюстрации нет и не было — держал их ровно этот clamp.
- Автоматическая раскладка (`BOUNDS`) по-прежнему держит подписи внутри кадра:
  за рамку уходит только ручное перемещение.
- Вручную поставленной подписи разрешена бо́льшая ширина (`maxWidth` 70% против
  34%), иначе текст на поле рвался на строки.
- `ai-chat.tsx` при доезде растра сохраняет `manual_position` по совпадению
  `content`, а не по индексу.
- Выноска отсутствует по умолчанию и появляется только после ручного перемещения
  подписи; двойной клик возвращает автоматическое положение.
- Выноски нейтральные: серые, тонкие, малоконтрастные в idle и более заметные в
  active-состоянии.
- Убран отдельный значок перемещения, фиолетовая рамка, glow и AI-подсветка.

### Проверенный baseline

- 58 focused Vector DSL / planner / critic тестов проходят, 1 внешний тест
  ожидаемо пропущен.
- Весь `ai_engine`: 129 тестов проходят, 2 внешних теста пропущены.
- Пять повторных вызовов `render_with_labels` дают идентичные SVG И labels.
- `npm run type-check` проходит.
- `npm run lint` проходит с пятью существующими warnings вне нового pipeline.
- `git diff --check` проходит.
- Проверено в живом браузере: подпись «Нормальная реакция N» утащена целиком за
  левый край кадра (не обрезана), выноска продолжает указывать на середину
  древка зелёной стрелки `N`; двойной клик возвращает подпись и убирает выноску.

### Что пока не завершено

Детерминированный `scene_plan → vector_layout` путь пока берётся ТОЛЬКО за
наклонную плоскость (`INCLINED_PLANE_CONTEXT_RE`), потому что `angle_arc` в
рендерере поддерживает лишь пару `[surface, "horizontal"]`. В режимах
`planner`/`planner_critic` Qwen может планировать и другие научные сцены, но без
поддерживаемого `vector_layout` они остаются растровыми. Биология, круговорот
воды и сложные процессы по-прежнему рисуются Seedream.

Что Seedream даёт и чего не даёт (проверено вживую на эталонном сюжете):

- текст побеждён полностью — в кадре ноль букв, в отличие от прежней модели,
  которая впечатывала «Fikicn», «Filek», «Porgls»;
- геометрия — нет: двусторонняя вертикальная стрелка, тяжесть вверх, пунктирные
  построения, купол во весь кадр вместо маленькой дуги `30°`.

В новом пути этот риск закрывается строгим plan validator, visual critic и
backend-owned overlay. В `legacy` и в сюжетах без Vector DSL те же ограничения
растровой генерации всё ещё остаются.

Не завершено также:

- deterministic normalization пока покрывает только free-body diagram на
  наклонной плоскости; остальные `scene_kind` валидируются, но не компилируются
  в Vector DSL;
- `canvas_analyzer.ALLOWED_VECTOR_COMPONENTS` шире, чем
  `vector_renderer._COMPONENT_TYPES` (лишние `field_lines`, `ray`,
  `circuit_symbol`, `point`): такой layout пройдёт валидацию и упадёт на рендере.
  Промпт планировщика в `vector_pipeline` перечисляет только рендерящиеся типы,
  но сам `canvas_analyzer` не тронут;
- board-LLM (`z-ai/glm-4.6v`) нестабильно отдаёт команду `image_with_labels`: в
  проверке дважды подряд вернула то сырой JSON в чат, то доску вообще без
  картинки. Это НЕ связано с векторным путём, но именно этим определяется, как
  часто пользователь его увидит.

## Архитектура научных схем

Реализовано (`vector_pipeline.py`, за `DIAGRAM_PIPELINE_MODE`):

```text
Запрос пользователя
    ↓
Qwen semantic planner           qwen/qwen3.7-plus
    ↓
scientific_scene_plan JSON
    ↓
strict validation + physics/layout normalization
    ↓
vector_layout (если сюжет поддержан)
    ↓
deterministic structure PNG → compact Seedream styling
    ↓
backend deterministic contours/arrows/angle overlay
    ↓
Qwen visual critic              только в planner_critic
    ↓
base_image_url + labels[] + overlay_svg_url
    ↓
frontend whiteboard             labels — отдельный перетаскиваемый DOM-слой
```

Fallback:

- planner недоступен → прежний `_enrich_command`;
- critic недоступен → стилизованный Seedream preview;
- Seedream недоступен или critic отверг стиль → deterministic SVG/PNG;
- `legacy` → прежний pipeline без Qwen.

Ключевой принцип: генеративная модель может влиять на оформление, но не на научную
геометрию и смысл.

## Правила генерации

### Что разрешено LLM

LLM может возвращать только семантические компоненты:

- `surface`, `body`, `vector`;
- `axis`, `curve`;
- `label`, `math_label`;
- `angle_arc`, `dimension_line`;
- `connector`, `trajectory`.

LLM должна описывать отношения:

- `on`;
- `attach_to`;
- `parallel_to`;
- `perpendicular_to`;
- `up_slope`, `down_slope`, `outward`;
- именованные anchors.

### Что запрещено LLM

- raw SVG;
- SVG path data;
- Bézier control points;
- массивы X/Y-точек;
- произвольные пиксельные координаты;
- `<script>`, `<foreignObject>`, embedded images;
- внешние URL внутри layout;
- model-generated geometry для стрелок, углов и подписей.

### Роль image-модели

`IMAGE_GEN_MODEL = google/gemini-3-pro-image` (раньше Seedream 4.5, снята с
OpenRouter). У image-модели сейчас три роли:

1. Основной генератор для всего, что НЕ покрывает Vector DSL: сцены, биология,
   круговорот воды, процессы.
2. Fallback, когда planner-путь отказался и запрос ушёл в legacy.
3. Стилизатор детерминированной структуры в режимах `planner` и
   `planner_critic`.

В роли стилизатора модель для схемы наклонной плоскости должна рисовать только:

- белый фон;
- одну наклонную плоскость;
- один брусок, который касается плоскости.

Она не должна рисовать текст, формулы, стрелки, силы, угол, легенду, рамку,
дополнительные предметы или декоративные детали.

Выбранный пользователем `flat / 2_5d / 3d / sketch` и палитра добавляются в
короткий позитивный prompt отдельной компактной фразой; старый длинный negative
contract в planner-пути не используется.

Если стилизация не удалась, нужно вернуть чистый детерминированный SVG/PNG.

Важно про модальности: Seedream — ЧИСТО image-модель и отклоняет запрос с
`modalities: ["image", "text"]` (404 «No endpoints found that support the
requested output modalities»). Любая новая image-модель должна быть добавлена в
`_is_image_only_model`, иначе генерация отвалится целиком.

## Визуальный стандарт

Ориентир — простота и точность Figure Labs:

- строгая учебная схема, а не художественная иллюстрация;
- один объект изображается один раз;
- тонкие чистые линии;
- короткий и понятный угол у основания плоскости;
- вес `mg` направлен строго вертикально вниз;
- нормальная реакция `N` перпендикулярна плоскости;
- трение `f` параллельно плоскости;
- никакой внешней силы, если пользователь её не просил;
- никаких двусторонних или дублированных стрелок;
- подписи не пересекают стрелки, объекты и друг друга;
- спокойная типографика без дешёвой обводки;
- никакого фиолетового AI-glow, sparkle-иконок и текста вроде
  «AI готов к новой схеме»;
- светлая и тёмная темы должны выглядеть нейтрально и профессионально.

## Текущие задачи

### P0 — расширить покрытие Vector DSL

Двухэтапная интеграция сделана (`vector_pipeline.py`,
`DIAGRAM_PIPELINE_MODE`, fallback в legacy/deterministic). Осталось:

1. Перевести production с `legacy` на `planner_critic` после обкатки и
   измерения стоимости/latency на живой доске.
2. Расширить `angle_arc` за пределы пары `[surface, "horizontal"]` — сейчас это
   главный ограничитель покрытия.
3. Добавить в гейтинг остальные механические сюжеты (`MECHANICS_DIAGRAM_CONTEXT_RE`),
   когда рендерер их потянет.
4. Свести `canvas_analyzer.ALLOWED_VECTOR_COMPONENTS` с
   `vector_renderer._COMPONENT_TYPES`: сейчас первый шире и пропускает layout,
   который упадёт на рендере.
5. Логировать долю фолбэков в растр — по ней судить, можно ли доверять
   планировщику.
6. Не ломать текущие не-scientific image-generation сценарии.

### P0 — стабильность повторных запросов

1. Устранить наложение новой схемы на предыдущую при повторном запросе.
2. Добавить request/session identifier и защиту от позднего ответа старого запроса.
3. Сделать политику размещения явной: replace, append или regenerate.
4. Заблокировать повторную отправку либо корректно отменять предыдущий запрос.
5. Проверить, что смена стиля применяется к текущей схеме каждый раз.

### P1 — подписи и коллизии

Сделано: прямое перетаскивание без move-handle; магнитная привязка к `arrow_to`;
leader line только после ручного перемещения; вынос подписи за рамку кадра;
сохранение `manual_position` при доезде растра; Undo/Redo (каждый drop —
один шаг истории, `{ history: "record" }`).

Осталось:

1. Проверить, что ручные позиции переживают resize узла и смену темы.
2. Учесть подписи, ушедшие за рамку, в `getElementBounds` / «показать всю доску»
   — сейчас они намеренно не влияют на габариты узла и в fit-to-view не попадают.
3. Подпись, свисающая на соседний узел, не может оказаться поверх него:
   `DraggableBoardNode` создаёт stacking context через `transform: scale()`.
   Косметика, проявляется только на плотной доске.
4. Redo не подключён к клавиатуре: `redoElementAction` в сторе есть, обработчика
   `Ctrl/Cmd+Shift+Z` нет.

### P1 — UX доски

1. Проверить полноценный `Ctrl/Cmd+Z` для текста, графов, иллюстраций и drag.
2. Довести инструменты создания текста и графиков до рабочего состояния.
3. Использовать строгую профессиональную типографику без рукописного AI-стиля.
4. Упростить левую панель и убрать неиспользуемые индикаторы.
5. Сделать верхние кнопки функциональными либо скрыть их.
6. Убрать декоративные AI-сообщения, sparkle-иконки и лишние статусы.
7. Проверить responsive layout при открытой панели AI Tutor.

### P1 — benchmark моделей

Частично закрыто выбором Seedream 4.5 (текст побеждён, геометрия — нет), но
формального замера на пяти повторах не было. Сравнивать на одинаковых prompts,
seed, размере и входном SVG/PNG:

- `google/gemini-3-pro-image` (Nano Banana Pro — текущая; именно её показывает
  бейдж у Figure Labs);
- `google/gemini-3.1-flash-image` (дешевле, кандидат);
- `openai/gpt-5-image` (контроль).

`bytedance-seed/seedream-4.5` из сравнения выбыла: её больше нет на OpenRouter.

Мерить нужно на НЕ-механических сюжетах: механику теперь рисует Vector DSL, и
там результат от image-модели не зависит.

Оценивать отдельно:

- сохранение геометрии;
- отсутствие собственного текста;
- отсутствие лишних стрелок;
- визуальную чистоту;
- стабильность пяти повторов;
- latency и стоимость.

Не выбирать модель только по красоте одного изображения.

## Критерии готовности эталонной схемы

Для запроса «Нарисуй брусок на наклонной плоскости с углом 30° и покажи все
силы» результат считается корректным, если:

1. Есть ровно одна плоскость и один брусок.
2. Есть ровно три force-vector: `mg`, `N`, `f`.
3. `mg` вертикален, `N` перпендикулярен, `f` параллелен плоскости.
4. У каждой силы ровно один наконечник.
5. Есть один небольшой угол `30°`.
6. Нет внешней силы и лишних объектов.
7. Подписи не пересекают стрелки.
8. Текст не встроен в растровую подложку — в кадре ноль букв, все подписи
   являются DOM-элементами.
9. Пять одинаковых запросов сохраняют одну структуру.
10. Результат корректен в светлой и тёмной темах.
11. Любую подпись можно утащить за рамку кадра, и выноска продолжает указывать
    на свой объект; двойной клик возвращает автоматическое положение.

Пункты 1–9 и 11 проверены на векторном пути. Пункт 10 в тёмной теме на живой
доске ещё не проверялся.

## Команды запуска

### Frontend

```bash
cd /Users/bekzhan/Documents/projects/timely
npm run dev
```

### Backend

```bash
cd /Users/bekzhan/Documents/projects/timely/backend
./venv/bin/python manage.py runserver 0.0.0.0:8000
```

Режимы научных схем:

```bash
DIAGRAM_PIPELINE_MODE=legacy ./venv/bin/python manage.py runserver 0.0.0.0:8000
DIAGRAM_PIPELINE_MODE=planner ./venv/bin/python manage.py runserver 0.0.0.0:8000
DIAGRAM_PIPELINE_MODE=planner_critic ./venv/bin/python manage.py runserver 0.0.0.0:8000
DIAGRAM_PIPELINE_MODE=deterministic ./venv/bin/python manage.py runserver 0.0.0.0:8000
```

Также доступны готовые configurations `frontend` и `backend` в
`.claude/launch.json`.

## Команды проверки

### Frontend

```bash
npm run type-check
npm run lint
```

### Vector DSL, vector_pipeline и AI analyzer

```bash
cd backend
DATABASE_URL=sqlite:////tmp/timely-vector-tests.sqlite3 \
  python3 manage.py test \
  ai_engine.test_glm_analyzer \
  ai_engine.test_vector_dsl \
  ai_engine.tests.VectorRendererGeometryTests -v 1
```

`ai_engine.test_vector_dsl` теперь включает `VectorGeometryOnlyLabelTests`
(растр без текста, подписи структурой, якоря на середине древка) и
`VectorPipelineTests` / `ScientificPlannerCriticPipelineTests` (strict JSON,
physics, critic, A/B modes и фолбэки). Весь безопасный `ai_engine`:

```bash
cd backend
DATABASE_URL=sqlite:////tmp/timely-vector-tests.sqlite3 \
  python3 manage.py test ai_engine -v 1
```

Не запускай голый `python3 manage.py test`, пока root-level `test_img*.py` не
переведены под `if __name__ == "__main__"` или не исключены из discovery: эти
старые ad-hoc скрипты выполняют реальные OpenRouter-запросы на import.

### Общая проверка diff

```bash
git diff --check
git status --short
```

Реальные provider-тесты должны быть opt-in и пропускаться без credentials. Никогда
не печатай API-ключи или содержимое секретных env-файлов.

## Правила работы в текущем репозитории

1. Сначала инспектируй существующие модули и тесты.
2. Не создавай параллельную архитектуру, если подходящий модуль уже существует.
3. Не удаляй untracked-файлы: часть активной разработки ещё не добавлена в Git.
4. Не делай `git reset --hard`, `git checkout --` или массовое форматирование.
5. Не изменяй unrelated-файлы.
6. Используй строгую валидацию на границе LLM → backend.
7. Геометрические helpers должны быть чистыми и тестируемыми.
8. Все внешние image-generation вызовы должны иметь timeout, fallback и
   контролируемый feature flag.
9. Перед завершением запускай фокусные тесты, TypeScript type-check и
   `git diff --check`.
10. В отчёте перечисляй изменённые файлы, команды, результаты, skips и известные
    риски.

### Грабли, на которые уже наступали

- **LaTeX внутри JSON.** Board-DSL просит подписи вида `$30^\circ$`, а команды
  LaTeX начинаются с бэкслеша, который в JSON обязан быть удвоен. Модель пишет
  его одинарным, и это ломалось ДВУМЯ разными способами:
  1. `\c`, `\a`, `\v` — невалидный escape, `json.loads` падает, `_extract_json`
     возвращает `None`, и скилл уходит в ветку «модель не выдала JSON». Итог:
     пользователь видит в чате простыню сырого JSON вместо доски.
  2. `\t`, `\f`, `\b`, `\n`, `\r` — ВАЛИДНЫЕ escape'ы. `$\theta$` парсится
     успешно и молча превращается в `$<таб>heta$`. Ошибки нет, подпись битая.
     Так же ломались `\frac`, `\beta`, `\nu`, `\rho`.

  Лечится в `draw_views._extract_json`: `_escape_latex_in_math_spans` удваивает
  одиночные бэкслеши внутри `$...$`, `_repair_json_escapes` чинит остальные.
  Обе функции сканируют escape-ПАРАМИ — наивное «бэкслеш + lookahead» удваивает
  вторую половину уже корректного `\\circ` и ломает то, что работало.
  Регрессия закрыта `ExtractJsonLatexEscapeTests`.
- Ветка «модель не выдала JSON» в `skills/board.py` теперь ЛОГИРУЕТ причину
  (finish_reason, длину, края ответа). Раньше отказ был молчаливым, и отладить
  его было нечем. Не убирай это логирование.
- Инлайновый `color` в `CREATE_TEXT` перебивает классы рендерера
  (`text-slate-950 dark:text-zinc-100`). В `whiteboard-lecture-layout` был зашит
  `#f8fafc` — в тёмной теме нормально, в светлой текст лекции невидим на
  светлом холсте. Цвет для текста доски не задавай: пусть работает тема.
- `cairosvg` стоит в venv, а нативной `libcairo` на машине НЕТ. Импорт падает с
  `OSError`, а не `ImportError`, поэтому `svg_to_png_bytes` ловит любое
  исключение и уходит в OpenCV-fallback. Не сужай этот `except` обратно.
- Векторный путь тоже ходит в сеть: планировщик — это запрос к OpenRouter.
  При обрыве DNS он вернёт `None`, растровый фолбэк упадёт следом, и на доске
  будет «Не удалось сгенерировать иллюстрацию». Детерминирован ТОЛЬКО рендер,
  не весь путь.
- OpenCV-fallback рисует текст через `cv2.putText` только для ASCII, то есть
  кириллица молча пропадает из PNG. На векторном пути это неважно (текста в
  растре нет), но при рендере с `emit_text=True` про это надо помнить.
- Порт 3000 часто уже занят собственным dev-сервером пользователя — Next
  молча уходит на 3001. Проверяй, какой сервер ты на самом деле смотришь, и не
  убивай чужой процесс.
- Папки в `src/app/`, начинающиеся с `_`, Next считает приватными и не
  маршрутизирует: временная страница-стенд по такому пути даст 404.
- `tsc` держит инкрементальный кэш в `tsconfig.tsbuildinfo`, а Next генерирует
  типы в `.next/types/app/**`. После удаления временного роута нужно снести и то,
  и другое, иначе `npm run type-check` будет ругаться на несуществующий файл.
