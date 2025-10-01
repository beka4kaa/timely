# 🚨 URGENT: Google OAuth Production Fix

## Если OAuth НЕ РАБОТАЕТ на продакшене, проверьте ЭТО:

### 🔥 КРИТИЧЕСКИ ВАЖНО:

1. **NEXTAUTH_URL точно совпадает с доменом?**
   ```bash
   # ❌ НЕПРАВИЛЬНО
   NEXTAUTH_URL=http://localhost:3000
   
   # ✅ ПРАВИЛЬНО  
   NEXTAUTH_URL=https://your-actual-domain.com
   ```

2. **Google Console: redirect URI правильный?**
   ```
   Должен быть: https://your-domain.com/api/auth/callback/google
   НЕ: http://localhost:3000/api/auth/callback/google
   ```

3. **Google Console: origin добавлен?**
   ```
   Authorized JavaScript origins:
   https://your-domain.com
   ```

### 🔍 БЫСТРАЯ ДИАГНОСТИКА:

1. **Откройте:** `https://your-domain.com/debug-oauth`
2. **Проверьте:** `https://your-domain.com/api/auth/debug-env`
3. **Тестируйте:** `./test-oauth-production.sh https://your-domain.com`

### 🛠 ЧАСТЫЕ ОШИБКИ И РЕШЕНИЯ:

#### ❌ "redirect_uri_mismatch"
- Google Console → Credentials → ваш Client ID
- Authorized redirect URIs → добавить: `https://your-domain.com/api/auth/callback/google`

#### ❌ "invalid_client"  
- Проверьте environment variables на хостинге
- GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET правильные?

#### ❌ "access_denied"
- Authorized JavaScript origins → добавить: `https://your-domain.com`
- Очистить cookies и попробовать в incognito

#### ❌ "Configuration error"
- NEXTAUTH_URL = точный production домен
- NEXTAUTH_SECRET установлен
- Все env vars присутствуют на хостинге

### 🚀 БЫСТРЫЕ КОМАНДЫ:

**Vercel:**
```bash
vercel env add NEXTAUTH_URL
# Введите: https://your-app.vercel.app
```

**Netlify:**
- Site Settings → Environment Variables  
- Add: `NEXTAUTH_URL = https://your-site.netlify.app`

**Railway/Render:**
- Environment section
- Add all variables from .env.local

### 📱 МОБИЛЬНОЕ ТЕСТИРОВАНИЕ:

1. Откройте сайт на телефоне
2. Попробуйте войти через Google
3. Проверьте в incognito режиме

### 🔗 ПОЛЕЗНЫЕ ССЫЛКИ:

- Debug page: `/debug-oauth`  
- Error page: `/auth/error`
- Google Console: https://console.cloud.google.com/apis/credentials
- NextAuth docs: https://next-auth.js.org/configuration/options

---

## ⚡ ЭКСТРЕННОЕ РЕШЕНИЕ:

Если ничего не помогает:
1. Создайте НОВЫЙ Google OAuth Client
2. Обновите GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET  
3. Добавьте правильные URLs в новый Client
4. Переверьте всё заново

**Время решения: 5-10 минут** ✨