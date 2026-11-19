import type { Dictionary } from "../types";

// Страницы, которые рисует сервер: вход, регистрация, ошибка входа, публичный чат, «не найдено»
// и политика конфиденциальности. Политику переводить строго по смыслу: на ней только то, что
// правда включено (см. CLAUDE.md §13.6).

const en: Dictionary = {
  // app/auth/signin, app/auth/register
  "Вход": "Sign in",
  "Вход | TimelyPlan": "Sign in | TimelyPlan",
  "Войдите в TimelyPlan, чтобы открыть дневник, цели, расписание и учебные инструменты.":
    "Sign in to TimelyPlan to open your diary, goals, schedule and study tools.",
  "Регистрация": "Sign up",
  "Регистрация | TimelyPlan": "Sign up | TimelyPlan",
  "Создайте аккаунт TimelyPlan для дневника, целей, расписания и учебных инструментов.":
    "Create a TimelyPlan account for your diary, goals, schedule and study tools.",
  "Ошибка входа через Google": "Couldn’t sign in with Google",
  "С возвращением": "Welcome back",
  "Войди через Google, чтобы продолжить учёбу с того места, где остановился.":
    "Sign in with Google to pick up your studies where you left off.",
  "Нет аккаунта?": "No account?",
  "Создать аккаунт": "Create one",
  "Открываем Google…": "Opening Google…",
  "Продолжить с Google": "Continue with Google",
  "Войти без аккаунта (dev)": "Enter without an account (dev)",
  "Создай аккаунт": "Create an account",
  "Один шаг через Google — и можно задавать первый вопрос тьютору.":
    "One step with Google — and you can ask the tutor your first question.",
  "Уже есть аккаунт?": "Already have an account?",
  "Войти": "Sign in",
  "Демо": "Demo",

  // components/auth/auth-shell.tsx
  "Слайм Timely": "Timely slime",
  "Скрыть пароль": "Hide password",
  "Показать пароль": "Show password",

  // app/auth/error/page.tsx
  "Ошибка OAuth авторизации": "OAuth sign-in error",
  "Не удалось начать процесс авторизации через Google": "Couldn’t start signing in with Google",
  "Проверьте что GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET правильно установлены":
    "Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set correctly",
  "Убедитесь что NEXTAUTH_URL соответствует текущему домену": "Make sure NEXTAUTH_URL matches the current domain",
  "Проверьте настройки в Google Cloud Console": "Check the settings in Google Cloud Console",
  "Ошибка OAuth callback": "OAuth callback error",
  "Google вернул ошибку при авторизации": "Google returned an error while signing in",
  "Проверьте что redirect URI в Google Console правильный": "Check that the redirect URI in Google Console is correct",
  "Формат: https://yourdomain.com/api/auth/callback/google": "Format: https://yourdomain.com/api/auth/callback/google",
  "Убедитесь что домен добавлен в Authorized origins": "Make sure the domain is added to Authorized origins",
  "Ошибка создания аккаунта": "Couldn’t create the account",
  "Не удалось создать аккаунт в базе данных": "Couldn’t create the account in the database",
  "Проверьте подключение к базе данных": "Check the database connection",
  "Убедитесь что схема Prisma актуальна": "Make sure the Prisma schema is up to date",
  "Проверьте логи сервера для деталей": "Check the server logs for details",
  "Ошибка создания email аккаунта": "Couldn’t create an email account",
  "Проблема с созданием аккаунта через email": "Something went wrong creating an account by email",
  "Проверьте что email provider настроен": "Check that the email provider is set up",
  "Убедитесь что SMTP настройки правильные": "Make sure the SMTP settings are correct",
  "Общая ошибка callback": "General callback error",
  "Неопределенная ошибка в процессе авторизации": "An unknown error happened while signing in",
  "Проверьте все environment variables": "Check all environment variables",
  "Убедитесь что NEXTAUTH_SECRET установлен": "Make sure NEXTAUTH_SECRET is set",
  "Аккаунт не связан": "Account not linked",
  "Email уже используется другим провайдером": "This email is already used with another sign-in method",
  "Войдите через тот же провайдер, что использовали ранее": "Sign in with the same method you used before",
  "Или используйте другой email адрес": "Or use a different email address",
  "Ошибка входа по email": "Email sign-in error",
  "Не удалось отправить email для входа": "Couldn’t send the sign-in email",
  "Проверьте email настройки": "Check the email settings",
  "Убедитесь что SMTP сервер доступен": "Make sure the SMTP server is reachable",
  "Неверные учетные данные": "Wrong credentials",
  "Email или пароль неправильные": "The email or password is wrong",
  "Проверьте email и пароль": "Check your email and password",
  "Убедитесь что аккаунт существует": "Make sure the account exists",
  "Требуется авторизация": "Sign-in required",
  "Для доступа к этой странице нужно войти в систему": "You need to sign in to open this page",
  "Войдите в систему": "Sign in",
  "Проверьте что сессия не истекла": "Check that your session hasn’t expired",
  "Не получилось войти": "Couldn’t sign in",
  "Произошла неожиданная ошибка при авторизации.": "Something unexpected went wrong while signing in.",
  "Если ошибка повторяется, напишите администратору.": "If it keeps happening, write to the administrator.",
  "Код ошибки:": "Error code:",
  "Что можно проверить": "What to check",
  "Попробовать снова": "Try again",
  "Загрузка…": "Loading…",

  // app/not-found.tsx
  "Такой страницы нет": "This page doesn’t exist",
  "Возможно, ссылка устарела или в адресе опечатка.": "The link may be out of date, or there’s a typo in the address.",

  // app/share, components/chat/shared-chat-view.tsx, components/chat/markdown-message.tsx
  "Разговор с тьютором": "Chat with the tutor",
  "Что такое Timely": "What is Timely",
  "Разговор не загрузился. Проверь интернет и обнови страницу.":
    "The chat didn’t load. Check your connection and refresh the page.",
  "Открываю разговор…": "Opening the chat…",
  "Ссылки больше нет": "This link is gone",
  "Её удалили, или в адресе ошибка.": "It was deleted, or there’s a mistake in the address.",
  "Разговор с тьютором Timely, {date}": "A chat with the Timely tutor, {date}",
  "Разговор с тьютором Timely": "A chat with the Timely tutor",
  "Timely помогает учиться: план на день, тьютор и повторение.": "Timely helps you study: a plan for the day, a tutor and review.",
  "Попробовать": "Try it",
  "Помощник {label}": "Assistant: {label}",

  // app/privacy/page.tsx
  "Конфиденциальность": "Privacy",
  "Что видит ИИ-тьютор Timely, куда уходят данные ученика и как их удалить.":
    "What the Timely AI tutor sees, where a student’s data goes and how to delete it.",
  "Что видит ИИ-тьютор, куда уходят твои данные и как их удалить.":
    "What the AI tutor sees, where your data goes and how to delete it.",
  "Что видит тьютор": "What the tutor sees",
  "Чтобы помогать с учёбой, тьютор в чате и в мини-окне видит учебные данные твоего аккаунта:":
    "To help you study, the tutor in the chat and in the mini chat sees the study data in your account:",
  "расписание занятий и занятое время;": "your study schedule and busy time;",
  "дневник: уроки, задания, оценки и заметки;": "your diary: lessons, assignments, grades and notes;",
  "цели, привычки и темы на повторение;": "goals, habits and topics due for review;",
  "время в помодоро;": "your Pomodoro time;",
  "предметы и занятия по ним.": "subjects and their study sessions.",
  "Ещё он видит твоё сообщение и этот разговор. Почту, имя и данные для входа тьютор не получает.":
    "It also sees your message and this conversation. The tutor doesn’t get your email, name or sign-in details.",
  "Кто готовит ответы": "Who prepares the answers",
  "Ответы готовит внешний сервис ИИ. Ему уходит только то, что нужно для ответа. Запросы чата, мини-окна и помощника плана мы отправляем только исполнителям, которые обещают не хранить запросы после ответа. Если такого исполнителя сейчас нет, тьютор не ответит, но запрос туда, где его хранят, не уйдёт.":
    "Answers are prepared by an external AI service. It gets only what the answer needs. Requests from the chat, the mini chat and the plan assistant go only to providers that promise not to keep requests after answering. If no such provider is available right now, the tutor won’t answer, but the request won’t go anywhere that keeps it.",
  "Полной тайны мы не обещаем. Сервис проверяет все запросы на материалы о насилии над детьми, и такие запросы могут храниться по закону.":
    "We don’t promise complete secrecy. The service checks all requests for child sexual abuse material, and such requests may be kept as the law requires.",
  "Что идёт обычным путём": "What goes the usual way",
  "Остальные функции с ИИ пока работают обычным путём, и там запросы могут храниться по правилам исполнителя. Это составление ритма занятий по твоей цели и уровню и фото еды.":
    "Other AI features still go the usual way, where requests may be kept under the provider’s rules. These are building a study rhythm from your goal and level, and food photos.",
  "Загрузка учебников сейчас выключена. Когда мы её включим, разбор книг, фото страниц и программа курса по книге тоже пойдут обычным путём, и мы заранее допишем это сюда.":
    "Textbook uploads are turned off for now. When we turn them on, reading books, page photos and the course built from a book will also go the usual way, and we’ll add that here in advance.",
  "Что хранится и как это удалить": "What is stored and how to delete it",
  "Учебные данные и разговоры с тьютором хранятся в базе Timely.":
    "Study data and conversations with the tutor are stored in the Timely database.",
  "Разговор с тьютором можно удалить самому в списке чатов.":
    "You can delete a conversation with the tutor yourself from the chat list.",
  "Если отметишь ответ «нравится» или «не нравится», мы сохраним оценку вместе с вопросом и ответом, чтобы делать тьютора лучше. Удалишь чат — его оценки удалятся вместе с ним.":
    "If you mark an answer with “like” or “dislike”, we keep the rating together with the question and answer to make the tutor better. Delete the chat, and its ratings are deleted with it.",
  "Разговором можно поделиться ссылкой. По ней видно только текст сообщений, без источников из книг, и только то, что было на момент, когда ссылку создали или обновили. Ссылку можно удалить, и по ней больше ничего не откроется.":
    "You can share a conversation with a link. It shows only the text of the messages, without sources from books, and only what was there when the link was created or updated. You can delete the link, and nothing will open from it any more.",
  "Мы считаем, сколько ты пользуешься ИИ, чтобы работал лимит.": "We count how much you use the AI so that the usage limit works.",
  "Удалить аккаунт и все данные можно по письму на": "To delete your account and all your data, write to",
  "Кнопки для этого пока нет.": "There’s no button for this yet.",
  "Изменения подтверждаешь ты": "You confirm every change",
  "Тьютор сам ничего не меняет. Он показывает карточку, и записывается она только после «Применить». Почти всё можно вернуть кнопкой «Вернуть как было». Удаление привычки, темы или предмета вернуть нельзя, и карточка говорит об этом заранее.":
    "The tutor doesn’t change anything by itself. It shows a card, and the card is saved only after “Apply”. Almost everything can be undone with “Undo”. Deleting a habit, topic or subject can’t be undone, and the card says so in advance.",
  "Тьютор это ИИ": "The tutor is an AI",
  "Он не человек и может ошибаться. Важное лучше проверить по учебнику или у учителя.":
    "It isn’t a person and can make mistakes. Check anything important in your textbook or with your teacher.",
  "Вопросы о данных:": "Questions about your data:",
  "Обновлено 18 ноября 2026 года.": "Updated 18 November 2026.",
};

export default en;
