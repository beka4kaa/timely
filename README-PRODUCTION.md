# 🕐 Timely - Time Schedule Platform

> Современная Next.js платформа для управления временем с аутентификацией и базой данных

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3.0-38B2AC)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.0-2D3748)](https://prisma.io/)
[![NextAuth.js](https://img.shields.io/badge/NextAuth.js-4.0-purple)](https://next-auth.js.org/)

## ✨ Функционал

- 🔐 **Полная аутентификация**: Google OAuth + Email/Password
- 📊 **Dashboard**: Персонализированная панель управления
- 📅 **Календарь**: Планирование событий и задач
- ✅ **Задачи**: Система управления делами
- 🎯 **Цели**: Планирование и трекинг целей
- 🏆 **Достижения**: Галерея успехов
- 🤔 **Саморазвитие**: Работа с рефлексией

## 🛠 Технологический стек

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **UI**: shadcn/ui, Radix UI, Lucide Icons
- **Backend**: Next.js API Routes, NextAuth.js
- **Database**: Prisma ORM + SQLite/PostgreSQL
- **Authentication**: NextAuth.js (Google OAuth, Credentials)
- **Validation**: Zod
- **Security**: bcryptjs для хеширования паролей

## 🚀 Установка и запуск

### 1. Клонирование репозитория

\`\`\`bash
git clone https://github.com/beka4kaa/timely.git
cd timely
\`\`\`

### 2. Установка зависимостей

\`\`\`bash
npm install
\`\`\`

### 3. Настройка переменных окружения

Создайте файл \`.env.local\`:

\`\`\`env
# NextAuth.js
NEXTAUTH_SECRET=your-nextauth-secret-here
NEXTAUTH_URL=http://localhost:3000

# Google OAuth (создайте в Google Cloud Console)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Database
DATABASE_URL="file:./dev.db"
\`\`\`

### 4. Настройка базы данных

\`\`\`bash
# Генерация Prisma Client
npx prisma generate

# Применение миграций
npx prisma db push
\`\`\`

### 5. Запуск в режиме разработки

\`\`\`bash
npm run dev
\`\`\`

Откройте [http://localhost:3000](http://localhost:3000) в браузере.

## 🔧 Настройка Google OAuth

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите Google+ API
4. Создайте OAuth 2.0 Client ID
5. Добавьте authorized redirect URIs:
   - \`http://localhost:3000/api/auth/callback/google\`
   - \`https://yourdomain.com/api/auth/callback/google\`
6. Скопируйте Client ID и Client Secret в \`.env.local\`

## 📦 Команды

\`\`\`bash
# Разработка
npm run dev

# Сборка
npm run build

# Продакшен
npm run start

# Проверка типов
npm run type-check

# Линтинг
npm run lint

# База данных
npm run db:generate    # Генерация Prisma Client
npm run db:push        # Применение схемы к БД
npm run db:studio      # Prisma Studio
\`\`\`

## 🚀 Деплой

### Vercel (Рекомендуется)

1. Подключите репозиторий к [Vercel](https://vercel.com)
2. Добавьте переменные окружения:
   - \`NEXTAUTH_SECRET\`
   - \`NEXTAUTH_URL\`
   - \`GOOGLE_CLIENT_ID\`
   - \`GOOGLE_CLIENT_SECRET\`
   - \`DATABASE_URL\`
3. Деплой произойдет автоматически

### Docker

\`\`\`bash
# Сборка образа
docker build -t timely .

# Запуск контейнера
docker run -p 3000:3000 --env-file .env.local timely
\`\`\`

## 📊 Структура проекта

\`\`\`
src/
├── app/                    # App Router страницы
│   ├── api/               # API маршруты
│   ├── auth/              # Страницы аутентификации
│   ├── dashboard/         # Защищенные страницы
│   └── globals.css        # Глобальные стили
├── components/            # React компоненты
│   ├── ui/               # shadcn/ui компоненты
│   └── dashboard/        # Компоненты dashboard
├── lib/                  # Утилиты и конфигурация
│   ├── auth.ts          # NextAuth конфигурация
│   ├── prisma.ts        # Prisma Client
│   └── utils.ts         # Утилиты
├── types/               # TypeScript типы
└── styles/             # Дополнительные стили
\`\`\`

## 🔒 Безопасность

- ✅ Хеширование паролей с bcryptjs
- ✅ JWT токены с NextAuth.js
- ✅ Middleware для защиты маршрутов
- ✅ Валидация входных данных с Zod
- ✅ CSRF защита
- ✅ Secure headers в Next.js

## 🧪 Тестирование API

### Регистрация пользователя

\`\`\`bash
curl -X POST http://localhost:3000/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123"
  }'
\`\`\`

### Проверка аутентификации

\`\`\`bash
curl http://localhost:3000/api/auth/session
\`\`\`

## 🤝 Участие в разработке

1. Fork репозитория
2. Создайте feature ветку (\`git checkout -b feature/amazing-feature\`)
3. Commit изменения (\`git commit -m 'Add amazing feature'\`)
4. Push в ветку (\`git push origin feature/amazing-feature\`)
5. Создайте Pull Request

## 📝 Лицензия

Этот проект лицензирован под MIT License - смотрите [LICENSE](LICENSE) файл.

## 🙏 Благодарности

- [Next.js](https://nextjs.org/) - React фреймворк
- [NextAuth.js](https://next-auth.js.org/) - Аутентификация
- [Prisma](https://prisma.io/) - Database ORM
- [shadcn/ui](https://ui.shadcn.com/) - UI компоненты
- [Tailwind CSS](https://tailwindcss.com/) - CSS фреймворк

---

Разработано с ❤️ для продуктивности и личностного роста