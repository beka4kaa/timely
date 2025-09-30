# Настройка Google OAuth для Time Schedule Platform

## Получение Google OAuth учетных данных

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите Google+ API:
   - Перейдите в "APIs & Services" > "Library"
   - Найдите и включите "Google+ API"

4. Создайте OAuth 2.0 Client ID:
   - Перейдите в "APIs & Services" > "Credentials"
   - Нажмите "Create Credentials" > "OAuth client ID"
   - Выберите "Web application"
   - Добавьте authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - `http://localhost:3000/api/auth/callback/google` (для разработки)

5. Скопируйте Client ID и Client Secret

## Настройка переменных окружения

Обновите файл `.env` в корне проекта:

```env
# NextAuth.js Configuration
NEXTAUTH_SECRET=your-secret-key-here-change-in-production
NEXTAUTH_URL=http://localhost:3000

# Google OAuth Configuration  
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here

# Database
DATABASE_URL="file:./dev.db"
```

## Важные замечания

- Замените `your-secret-key-here-change-in-production` на случайную строку для production
- Замените `your-google-client-id-here` на ваш Google Client ID
- Замените `your-google-client-secret-here` на ваш Google Client Secret
- Для production замените `http://localhost:3000` на ваш домен

## Функциональность

После настройки у вас будет:

✅ **Полная система аутентификации**
- Вход через Google OAuth
- Защищенные маршруты
- Управление сессиями

✅ **Расширенный календарь**
- Планирование по временным промежуткам
- Множественные виды (месяц/неделя/день)
- Категории и приоритеты событий
- Поиск и фильтрация

✅ **Серверная часть с базой данных**
- Хранение пользователей и событий в SQLite
- API маршруты с аутентификацией
- Prisma ORM для работы с данными

✅ **Современный UI/UX**
- Responsive дизайн
- shadcn/ui компоненты
- Темная/светлая тема
- Анимации и переходы

## Запуск проекта

```bash
npm run dev
```

Перейдите на http://localhost:3000 и используйте систему!