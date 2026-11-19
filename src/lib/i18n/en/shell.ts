import type { Dictionary } from "../types";

const en: Dictionary = {
  // config/dashboard-navigation.ts
  "Сейчас": "Now",
  "Тьютор": "Tutor",
  "Неделя": "Week",
  "Помодоро": "Pomodoro",
  "Учёба": "Study",
  "Слабые темы": "Weak topics",
  "Научная доска": "Science board",
  "Рост": "Growth",
  "Цели": "Goals",
  "Привычки": "Habits",
  "Соревнования": "Competitions",
  "Контесты": "Contests",
  "Рейтинг": "Leaderboard",

  // components/shell/sidebar.tsx
  "Я": "Me",
  "{count} к повторению": "{count} to review",
  "Книга ещё обрабатывается": "The book is still being processed",
  "Ученик": "Student",
  "Навигация": "Navigation",
  "Timely, на главную": "Timely home",
  "Развернуть панель": "Expand sidebar",
  "Свернуть панель": "Collapse sidebar",
  "Идёт занятие": "Session in progress",
  "Назад в меню": "Back to menu",
  "Чаты": "Chats",
  "Сменить тему": "Change theme",

  // components/shell/account-menu.tsx
  "Профиль и настройки": "Profile and settings",
  "Аккаунт": "Account",
  "Профиль": "Profile",
  "Настройки": "Settings",
  "Друзья": "Friends",
  "скоро": "soon",
  "Выйти": "Sign out",

  // components/shell/menu-button.tsx
  "Меню": "Menu",

  // components/shell/mascot
  "Спросить": "Ask",
  "Скрыть": "Hide",
  "Остановить": "Stop",
  "Открыть": "Open",
  "Маскот Timely, нажми, чтобы попросить о помощи": "Timely mascot, tap to ask for help",
  "Застрял на текущем деле? Спроси, разберёмся.": "Stuck on what you’re doing? Ask and we’ll figure it out.",
  "Нажми «В план», и я поставлю задание в свободное окно.": "Tap “Add to plan” and I’ll put the assignment in a free slot.",
  "Скажи, что поменялось, и я перестрою неделю. Можно указать урок курсором.":
    "Tell me what changed and I’ll rearrange the week. You can point at a lesson with the cursor.",
  "Напиши, что сегодня изучил, а темы я заполню сам.": "Write what you studied today, and I’ll fill in the topics.",
  "Напиши цель своими словами, срок и привычки подберу сам.":
    "Describe your goal in your own words, and I’ll pick the deadline and habits.",
  "Сделал сегодня, нажми на карточку. Один день, один квадратик.": "Done it today? Tap the card. One day, one square.",
  "Спрашивай о чём угодно, не только по книге.": "Ask about anything, not just the book.",
  "Выдели что угодно на доске и спроси.": "Select anything on the board and ask.",
  "Загрузи учебник, и я буду отвечать по его страницам.": "Upload a textbook and I’ll answer from its pages.",
  "Добавь предмет, и я помогу поставить по нему занятия.": "Add a subject and I’ll help you schedule study sessions for it.",
  "Спроси по этой главе, отвечу со ссылкой на страницу.": "Ask about this chapter and I’ll answer with a page reference.",
  "На контесте я молчу, такие правила. Зато потом разберём всё.":
    "I stay quiet during a contest, those are the rules. Afterwards we’ll go over everything.",
  "Рейтинг растёт от задач без подсказок.": "Your rating grows with problems solved without hints.",
  "Я рядом и не отвечаю, пока идёт сессия.": "I’m here, but I stay quiet while a session is on.",
  "Нажми на дни или баллы, покажу подробнее.": "Tap the days or points and I’ll show you more.",
  "Всё, что я помню, можно удалить здесь же.": "Anything I remember can be deleted right here.",
  "Нужна помощь? Спроси.": "Need help? Ask.",
  "з": "z",

  // components/shell/quick
  "Убрать: {label}": "Remove: {label}",
  "Указать урок курсором": "Point at a lesson with the cursor",
  "Указать": "Point",
  "Хватит слушать": "Stop listening",
  "Сказать голосом": "Speak",
  "Чем помочь?": "How can I help?",
  "Слушаю…": "Listening…",
  "Быстрый запрос": "Quick ask",
  "Esc, чтобы закрыть": "Esc to close",
  "Отправить": "Send",
  "Прикрепить": "Attach",

  // components/shell/view-tracker.tsx, components/settings/settings-panel.tsx
  "Одна тема ждёт повторения": "One topic is due for review",
  "Тем ждут повторения: {n}": "Topics due for review: {n}",
  "Пора повторить": "Time to review",

  // components/settings
  "Как в системе": "System",
  "Светлая": "Light",
  "Тёмная": "Dark",
  "Чат с тьютором": "Tutor chat",
  "Насколько глубоко думать": "How deeply to think",
  "В поле чата: Instant, Medium или High": "In the chat box: Instant, Medium or High",
  "Показывать выбор Instant, Medium, High": "Show the Instant, Medium, High picker",
  "Контекст и токены": "Context and tokens",
  "Окно контекста в поле чата, токены и цена под ответами": "Context window in the chat box, tokens and cost under answers",
  "Показывать контекст и токены": "Show context and tokens",
  "Что видит тьютор и куда уходят данные": "What the tutor sees and where your data goes",
  "Так выглядит напоминание": "This is what a reminder looks like",
  "Здесь браузер не показывает уведомления из вкладки.": "This browser doesn’t show notifications from a tab.",
  "Придут, пока Timely открыт в браузере": "They arrive while Timely is open in your browser",
  "Этот браузер не умеет показывать уведомления": "This browser can’t show notifications",
  "Запрещены в настройках браузера. Разреши их там": "Blocked in your browser settings. Allow them there",
  "Напоминания": "Reminders",
  "Через слайма": "Through the slime",
  "Плашка над ним, когда пора повторить тему": "A note above it when a topic is due for review",
  "Напоминать через слайма": "Remind me through the slime",
  "Уведомления": "Notifications",
  "Присылать уведомления браузера": "Send browser notifications",
  "Как выглядит уведомление": "What a notification looks like",
  "сейчас": "now",
  "Пробное уведомление": "Test notification",
  "Не загрузилось. Обнови страницу": "Didn’t load. Refresh the page",
  "Другие ученики видят «{name}», страну, баллы и рейтинг по предметам":
    "Other students see “{name}”, your country, points and subject ratings",
  "Сейчас тебя видишь только ты. Если включишь, другие увидят «{name}», страну, баллы и рейтинг по предметам":
    "Right now only you can see this. If you turn it on, others will see “{name}”, your country, points and subject ratings",
  "Не сохранилось. Попробуй ещё раз.": "Didn’t save. Try again.",
  "Кто меня видит": "Who can see me",
  "Показывать меня в рейтинге": "Show me on the leaderboard",
  "Группы": "Groups",
  "В группу вступают только сами, по коду от её создателя. Таблицу видят только участники, а показ в рейтинге на группы не влияет":
    "People join a group themselves, with a code from its creator. Only members see its table, and the leaderboard setting doesn’t affect groups",
  "Почту, описание, дни и часы фокуса другие ученики не видят.":
    "Other students don’t see your email, bio, or focus days and hours.",
  "Тема оформления": "Theme",
  "Цвет акцента": "Accent colour",
  "Язык": "Language",
  "Язык и оформление": "Language and appearance",
  "Меню, кнопки и ответы тьютора": "Menus, buttons and the tutor’s answers",
  "Кнопка отправки, переключатели и выбранное": "Send button, switches and selected items",
  "Открыть профиль": "Open profile",
  "Выход": "Sign out",
  "Выйти из аккаунта": "Sign out of your account",
  "Админ-панель": "Admin panel",
  "Аккаунт, кто тебя видит, язык, тема и цвет": "Account, who can see you, language, theme and colour",
  "Ритм таймера, звонок и уведомления": "Timer rhythm, bell and notifications",
  "Слайм": "Slime",
  "Чат с тьютором и напоминания": "Tutor chat and reminders",
  "Разделы настроек": "Settings sections",
  "Закрыть настройки": "Close settings",

  // lib/accent.ts
  "Синий": "Blue",
  "Фиолетовый": "Violet",
  "Зелёный": "Green",
  "Оранжевый": "Orange",
  "Розовый": "Pink",
  "Без цвета": "No colour",

  // components/ui, components/full-access-gate.tsx
  "Загрузка": "Loading",
  "Выберите дату": "Pick a date",
  "Раздел закрыт": "Section closed",
  "Доступ к этому разделу выключен для вашего аккаунта. Его включает администратор.":
    "This section is turned off for your account. An administrator can turn it on.",
  "На главную": "Go home",
};

export default en;
