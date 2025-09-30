# 🔐 Настройка Google OAuth - Инструкция

## 📋 Пошаговая настройка Google OAuth

### 1. 🌐 Создание проекта в Google Cloud Console

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите Google+ API для вашего проекта

### 2. 🔑 Настройка OAuth 2.0

1. Перейдите в **APIs & Services** → **Credentials**
2. Нажмите **Create Credentials** → **OAuth 2.0 Client IDs**
3. Выберите **Application type**: Web application
4. Добавьте **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google` (для разработки)
   - `https://yourdomain.com/api/auth/callback/google` (для продакшена)

### 3. ⚙️ Конфигурация переменных окружения

Обновите файл `.env.local`:

```env
# NextAuth.js
NEXTAUTH_SECRET=your-secret-key-here-change-in-production
NEXTAUTH_URL=http://localhost:3000

# Google OAuth (замените на реальные значения)
GOOGLE_CLIENT_ID=your-google-client-id-from-console
GOOGLE_CLIENT_SECRET=your-google-client-secret-from-console
```

### 4. 🔒 Получение Client ID и Secret

1. После создания OAuth клиента скопируйте:
   - **Client ID** → `GOOGLE_CLIENT_ID`
   - **Client Secret** → `GOOGLE_CLIENT_SECRET`
2. Сохраните их в `.env.local`

## 🚀 Использование

### Доступные методы входа:

1. **Google OAuth**:
   - Нажмите "Войти через Google" на странице входа
   - Автоматическое создание аккаунта при первом входе
   - Использование данных Google профиля

2. **Обычная аутентификация**:
   - Тестовые аккаунты:
     - `admin@example.com` / `admin123`
     - `user@example.com` / `user123`

### Функции системы:

✅ **OAuth через Google** - безопасный вход через Google аккаунт
✅ **Обычная аутентификация** - вход по email/паролю
✅ **Автоматическое создание пользователей** - при первом входе через Google
✅ **Защита маршрутов** - middleware проверяет авторизацию
✅ **Управление сессией** - автоматический выход и перенаправления
✅ **Адаптивный UI** - современный интерфейс входа

## 🛠️ Техническая реализация

### Используемые технологии:
- **NextAuth.js v4** - полная система аутентификации
- **Google Provider** - OAuth 2.0 интеграция
- **JWT токены** - безопасное управление сессиями
- **Next.js Middleware** - защита маршрутов
- **TypeScript** - типизированные интерфейсы

### Архитектура:
- **Session-based auth** с JWT токенами
- **Middleware protection** для защищенных страниц
- **Automatic redirects** для неавторизованных пользователей
- **Role-based access** (готовность для расширения)

## 🔧 Настройка для продакшена

1. **Обновите NEXTAUTH_URL**:
   ```env
   NEXTAUTH_URL=https://yourdomain.com
   ```

2. **Создайте безопасный secret**:
   ```bash
   openssl rand -base64 32
   ```

3. **Обновите redirect URIs** в Google Console:
   ```
   https://yourdomain.com/api/auth/callback/google
   ```

4. **Настройте HTTPS** для продакшен домена

## 🎯 Результат

✅ **Готовая система аутентификации** с Google OAuth
✅ **Безопасная архитектура** с JWT и middleware
✅ **Современный UX** с красивым интерфейсом
✅ **Масштабируемое решение** для расширения функций

**Система готова к использованию!** 🎉

## 📝 Примечания

- При первом входе через Google автоматически создается аккаунт
- Роли пользователей можно настроить в callbacks
- Для продакшена рекомендуется настроить базу данных
- Поддерживается как светлая, так и темная тема