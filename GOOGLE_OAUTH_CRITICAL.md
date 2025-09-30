# 🔑 Настройка Google OAuth - Важная информация

## ⚠️ Внимание к типу учетных данных

Вы предоставили ключ: `AIzaSyCSlC6klOGFNWJ6MBNUb6U8mLE3GMod_1Q`

**Это Google API ключ, но для OAuth нам нужны Client ID и Client Secret!**

## 📋 Что нужно сделать

### 1. Перейдите в Google Cloud Console
🔗 https://console.cloud.google.com/

### 2. Настройте OAuth 2.0
1. Выберите ваш проект или создайте новый
2. Перейдите в **APIs & Services** → **Credentials**
3. Нажмите **Create Credentials** → **OAuth client ID**
4. Выберите **Web application**
5. Добавьте authorized redirect URIs:
   ```
   http://localhost:3000/api/auth/callback/google
   ```

### 3. Получите правильные учетные данные
После создания OAuth client ID вы получите:
- **Client ID** (начинается с цифр, заканчивается на `.apps.googleusercontent.com`)
- **Client Secret** (короткая случайная строка)

### 4. Обновите .env файл
```env
# Замените эти значения на полученные от Google:
GOOGLE_CLIENT_ID=ваш-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=ваш-client-secret
```

## 🚀 После настройки

1. Перезапустите сервер разработки:
```bash
npm run dev
```

2. Перейдите на http://localhost:3000
3. Нажмите "Войти через Google"
4. Система должна перенаправить вас на Google для авторизации

## 🛡️ Безопасность

- **НЕ** коммитьте `.env` файл в git
- Client Secret держите в секрете
- Для production используйте переменные окружения на сервере

## ❓ Если возникают проблемы

1. Проверьте, что redirect URI точно совпадает
2. Убедитесь, что OAuth consent screen настроен
3. Проверьте, что Google+ API включен (если требуется)

**Текущий статус:** API ключ добавлен как Client ID, но нужен настоящий OAuth Client ID для работы аутентификации.