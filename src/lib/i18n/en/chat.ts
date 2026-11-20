import type { Dictionary } from "../types";

const en: Dictionary = {
  // components/chat/ask-stages.ts
  "Ищу в книге": "Searching the book",
  "Нашёл {n} фрагмент|Нашёл {n} фрагмента|Нашёл {n} фрагментов": "Found {n} passage|Found {n} passages",
  "В книге не нашлось": "Nothing found in the book",
  "Думаю": "Thinking",
  "фрагмент|фрагмента|фрагментов": "passage|passages",
  "Остановлено": "Stopped",
  "Тьютор ничего не ответил. Попробуй спросить ещё раз.": "The tutor didn’t reply. Try asking again.",
  "Этой книги больше нет. Выбери другую и спроси ещё раз.": "This book is gone. Pick another one and ask again.",
  "Нет связи с сервером. Проверь интернет и попробуй ещё раз.": "Can’t reach the server. Check your internet and try again.",
  "Тьютор сейчас не отвечает. Попробуй ещё раз через минуту.": "The tutor isn’t answering right now. Try again in a minute.",
  "Лимит AI-токенов исчерпан. Дождитесь обновления лимита.": "AI limit reached. Wait for it to reset.",

  // components/chat/ask-turn.tsx
  "В книге этого нет, отвечаю своими словами": "This isn’t in the book, so I’m answering in my own words",
  "Скопировать ответ": "Copy answer",
  "Скопировать": "Copy",
  "Остановить чтение": "Stop reading",
  "Прочитать вслух": "Read aloud",
  "Остановить": "Stop",
  "Хороший ответ": "Good answer",
  "Плохой ответ": "Bad answer",
  "Ответить заново": "Answer again",
  "Источник": "Source",
  "Показать в источниках": "Show in sources",

  // components/chat/board-stages.ts
  "Разбираю вопрос": "Reading your question",
  "Строю схему": "Drawing a diagram",
  "Уточняю вопрос": "Clarifying the question",

  // components/chat/chat-list.tsx
  "Чаты не загрузились.": "Chats didn’t load.",
  "Ещё раз": "Try again",
  "Здесь появятся твои разговоры.": "Your conversations will show up here.",
  "Удалить чат?": "Delete chat?",
  "Да": "Yes",
  "Нет": "No",
  "Переименовать чат «{title}»": "Rename chat “{title}”",
  "Удалить чат «{title}»": "Delete chat “{title}”",
  "Действия с чатом «{title}»": "Actions for chat “{title}”",
  "Название чата": "Chat name",

  // components/chat/chat-modes.ts
  "Обычный": "Regular",
  "Просто поболтать и спросить что угодно": "Just chat and ask anything",
  "Спроси о чём угодно": "Ask anything",
  "Планирование": "Planning",
  "Выбрать цель и разложить путь к ней по дням": "Pick a goal and split the way to it into days",
  "Что нужно успеть?": "What do you need to get done?",
  "Наводящая помощь": "Guided help",
  "Не решает за тебя, ведёт подсказками": "Doesn’t solve it for you, guides with hints",
  "Какую задачу разберём?": "Which problem shall we work on?",
  "Дай подсказку": "Give me a hint",
  "Покажи решение": "Show the solution",
  "Брейншторм": "Brainstorm",
  "Ищет идеи вместе с тобой, текст пишешь сам": "Looks for ideas with you, you write the text",
  "О чём подумаем?": "What shall we think about?",
  "Подкинь идею": "Give me an idea",
  "Проверь меня": "Quiz me",
  "Спрашивает и смотрит, что ты помнишь": "Asks questions to see what you remember",
  "Какую тему проверить?": "Which topic should I check?",
  "Цель: «{title}», срок {due}. Разложи на шаги.": "Goal: “{title}”, due {due}. Break it into steps.",
  "Цель: «{title}». Разложи на шаги.": "Goal: “{title}”. Break it into steps.",

  // components/chat/chat-page.tsx
  "Объясни тему простыми словами": "Explain a topic in simple words",
  "Объясни простыми словами: ": "Explain in simple words: ",
  "Составь план на неделю": "Make a plan for the week",
  "Помоги с задачей": "Help me with a problem",
  "Помоги с задачей: ": "Help me with a problem: ",
  "Как перестать откладывать?": "How do I stop procrastinating?",
  "{n} книга|{n} книги|{n} книг": "{n} book|{n} books",
  "книга обрабатывается": "book is being processed",
  "Цели не загрузились ({status})": "Goals didn’t load ({status})",
  "Добавь в план по цели «{goal}»: {steps}": "Add to my plan for the goal “{goal}”: {steps}",
  "Добавь в план: {steps}": "Add to my plan: {steps}",
  "Переписка": "Conversation",
  "Открываю разговор": "Opening the conversation",
  "Режим:": "Mode:",
  "К какой цели идём?": "Which goal are we working toward?",
  "Добавить в план": "Add to plan",
  "Источники": "Sources",
  "Этот чат открыть не получилось. Возможно, его уже удалили.": "Couldn’t open this chat. It may have been deleted.",
  "О чём поговорим?": "What shall we talk about?",
  "Цели не загрузились.": "Goals didn’t load.",
  "Поставить цель": "Set a goal",
  "до {due}": "by {due}",

  // components/chat/chat-usage.ts
  "низкое": "low",
  "высокое": "high",
  "максимальное": "max",
  "Быстрая": "Fast",
  "Умная": "Smart",
  "{n}\u00a0тыс.": "{n}k",
  "{n}\u00a0млн": "{n}M",
  "меньше $0,0001": "less than $0.0001",
  "вход {n}": "input {n}",
  "выход {n}": "output {n}",
  "из них рассуждение {n}": "of which reasoning {n}",
  "из кэша {n}": "from cache {n}",
  "примерно": "about",
  "{model}, рассуждение {level}: {parts}": "{model}, reasoning {level}: {parts}",

  // components/chat/composer.tsx
  "Слушаю…": "Listening…",
  "Сообщение": "Message",
  "Хватит слушать": "Stop listening",
  "Режим: {name}": "Mode: {name}",
  "Режим, Shift+Tab переключает": "Mode, Shift+Tab switches",
  "Режим тьютора": "Tutor mode",
  "Насколько глубоко думать": "How deeply to think",
  "Насколько глубоко думать: {name}": "How deeply to think: {name}",
  "Контекст: {used} из {total} токенов. В него идут {hint}.": "Context: {used} of {total} tokens. It includes {hint}.",
  "{used} из {total}": "{used} of {total}",
  "По какой книге отвечать. Смена книги начинает новый разговор": "Which book to answer from. Changing the book starts a new conversation",
  "Книга": "Book",
  "Обычный разговор": "Regular conversation",
  "Книги не загрузились": "Books didn’t load",
  "Добавить книгу": "Add a book",

  // components/chat/share-chat.tsx
  "Поделиться чатом": "Share chat",
  "Проверяю, есть ли ссылка…": "Checking for a link…",
  "Ссылка на чат": "Chat link",
  "Скопировано": "Copied",
  "Новые сообщения попадут по ссылке после «Обновить».": "New messages will appear at the link after you press “Update”.",
  "Удалить ссылку": "Delete link",
  "Ссылку откроет любой, у кого она есть. Источников из книг по ней не видно.": "Anyone with the link can open it. Sources from books aren’t shown.",
  "Создать ссылку": "Create link",
  "Не получилось. Проверь интернет и попробуй ещё раз.": "Didn’t work. Check your internet and try again.",

  // components/chat/sources-panel.tsx
  "{n} страница|{n} страницы|{n} страниц": "{n} page|{n} pages",
  "Страница": "Page",
  "стр. {pages}": "p. {pages}",
  "К ответу": "To the answer",
  "Ссылок на эту книгу: {n}": "References to this book: {n}",
  "Когда ответ опрётся на книгу, здесь появятся её страницы.": "When an answer relies on the book, its pages will show up here.",

  // components/chat/thinking-note.tsx
  "{n} секунду|{n} секунды|{n} секунд": "{n} second|{n} seconds",
  "{n}с": "{n}s",
  "ход рассуждений": "reasoning",
  "Думал {time}": "Thought for {time}",
  "Ход работы": "Progress",

  // lib/time-ago.ts
  "{n} минуту назад|{n} минуты назад|{n} минут назад": "{n} minute ago|{n} minutes ago",
  "{n} час назад|{n} часа назад|{n} часов назад": "{n} hour ago|{n} hours ago",

  // lib/speakable.ts
  "$1 делить на $2": "$1 divided by $2",
  "корень из $1": "square root of $1",
  "в степени": "to the power of",
  "умножить на": "times",
  "меньше или равно": "less than or equal to",
  "больше или равно": "greater than or equal to",
  "не равно": "not equal to",
  "пи": "pi",
  "бесконечность": "infinity",
  "Пример кода пропускаю.": "Skipping the code example.",

  // lib/ask-level.ts
  "Быстрая модель, отвечает сразу": "Fast model, answers right away",
  "Быстрая модель, думает дольше": "Fast model, thinks longer",
  "Умная модель, думает дольше и тратит больше": "Smart model, thinks longer and uses more",

  // lib/ai-limit.ts
  "сегодня в {time}": "today at {time}",
  "завтра в {time}": "tomorrow at {time}",
  "{date} в {time}": "{date} at {time}",
  "Лимит запросов закончился. Попробуй ещё раз позже.": "Request limit reached. Try again later.",
  "Лимит запросов закончился. Он обновится {when}.": "Request limit reached. It will reset {when}.",

  // lib/book-label.ts
  "стр. {n}": "p. {n}",
  "стр. {from}–{to}": "p. {from}–{to}",

  // lib/image-model-selection.ts
  "Быстрая и недорогая генерация": "Fast and affordable generation",
  "Более точная генерация сложных схем": "More accurate generation of complex diagrams",
  "быстрее и дешевле": "faster and cheaper",
  "рекомендуется": "recommended",
  "лучше для финального результата": "better for the final result",
  "{model} сейчас недоступна. Повторите запрос позже.": "{model} is unavailable right now. Try again later.",
  "{model} сейчас недоступна. Попробуйте {other} или повторите запрос позже.": "{model} is unavailable right now. Try {other} or try again later.",

  // lib/chat-folders.ts
  "Общие": "General",
};

export default en;
