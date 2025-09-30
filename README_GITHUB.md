# 🕐 Timely - Time Schedule Platform

> Современная платформа управления временем с расширенным календарем и Google OAuth аутентификацией

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3.0-38B2AC)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748)](https://prisma.io/)

## ✨ Основные возможности

### 📅 **Расширенный календарь**
- Планирование по временным промежуткам (часы/минуты)
- Множественные виды: месяц, неделя, день
- Категории, приоритеты, цветовая кодировка
- Повторяющиеся события
- Поиск и фильтрация

### 🔐 **Полная аутентификация**
- Google OAuth интеграция
- NextAuth.js система
- Защищенные маршруты
- Управление сессиями

### 💾 **Серверная часть**
- SQLite база данных (Prisma ORM)
- Защищенные API маршруты
- CRUD операции для событий
- Валидация данных

### 🎨 **Современный UI/UX**
- shadcn/ui компоненты
- Responsive дизайн
- Темная/светлая тема
- Анимации и переходы

## 🚀 Быстрый старт

### 1. Клонирование и установка
```bash
git clone https://github.com/beka4kaa/timely.git
cd timely
npm install
```

### 2. Настройка базы данных
```bash
npx prisma generate
npx prisma db push
```

### 3. Переменные окружения
Создайте файл `.env` в корне проекта:
```env
# Database
DATABASE_URL="file:./dev.db"

# NextAuth.js Configuration
NEXTAUTH_SECRET=your-super-secret-key-here
NEXTAUTH_URL=http://localhost:3000

# Google OAuth (получите в Google Cloud Console)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### 4. Настройка Google OAuth
1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте проект и включите Google+ API
3. Создайте OAuth 2.0 Client ID
4. Добавьте redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Получите Client ID и Client Secret
6. Обновите `.env` файл

### 5. Запуск приложения
```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) в браузере.

## 🛠️ Технологический стек

- **Frontend**: Next.js 14, React 18, TypeScript
- **Backend**: Next.js API Routes, Prisma ORM  
- **Database**: SQLite (dev), PostgreSQL (production ready)
- **Auth**: NextAuth.js + Google OAuth
- **UI**: shadcn/ui + Tailwind CSS
- **Icons**: Lucide React
- **Dates**: date-fns

## 📁 Структура проекта

```
src/
├── app/                    # Next.js 14 App Router
│   ├── api/               # API маршруты
│   ├── dashboard/         # Защищенные страницы
│   └── (auth)/            # Страницы аутентификации
├── components/            # Переиспользуемые компоненты
│   ├── ui/               # shadcn/ui компоненты
│   ├── dashboard/        # Dashboard компоненты
│   └── auth/             # Auth компоненты
├── lib/                  # Утилиты и конфигурация
│   ├── auth.ts           # NextAuth конфигурация
│   └── prisma.ts         # Prisma клиент
└── types/                # TypeScript типы
```

## 📋 Доступные команды

```bash
npm run dev          # Запуск сервера разработки
npm run build        # Сборка для продакшн
npm start            # Запуск продакшн версии
npm run lint         # Проверка кода
```

## 🔒 Безопасность

- ✅ NextAuth.js сессии
- ✅ Защищенные API routes
- ✅ Валидация данных
- ✅ CSRF защита
- ✅ Secure cookies

## 🎯 Дорожная карта

- [ ] PostgreSQL адаптер для продакшн
- [ ] Push notifications
- [ ] Mobile приложение
- [ ] Calendar синхронизация (Google Calendar, Outlook)
- [ ] Team collaboration features
- [ ] Advanced analytics dashboard

## 🤝 Участие в разработке

1. Форкните репозиторий
2. Создайте feature ветку (`git checkout -b feature/amazing-feature`)
3. Внесите изменения и закоммитьте (`git commit -m 'Add amazing feature'`)
4. Запушьте ветку (`git push origin feature/amazing-feature`) 
5. Откройте Pull Request

## 📄 Лицензия

MIT License - см. [LICENSE](LICENSE) файл.

## 👨‍💻 Автор

**Bekzhan** - [@beka4kaa](https://github.com/beka4kaa)

## 🙏 Благодарности

- [Next.js](https://nextjs.org/) - React фреймворк
- [NextAuth.js](https://next-auth.js.org/) - Аутентификация
- [Prisma](https://prisma.io/) - Database ORM
- [shadcn/ui](https://ui.shadcn.com/) - UI компоненты
- [Tailwind CSS](https://tailwindcss.com/) - CSS фреймворк

---

⭐ Поставьте звезду, если проект понравился!