# 🔧 Google OAuth Production Deployment Guide

## 🚨 Основные причины проблем с Google OAuth на production:

### 1. **Неправильный NEXTAUTH_URL**
```bash
# ❌ Неправильно (localhost)
NEXTAUTH_URL=http://localhost:3000

# ✅ Правильно (ваш домен)
NEXTAUTH_URL=https://your-app.vercel.app
NEXTAUTH_URL=https://your-domain.com
```

### 2. **Google Console - Authorized URLs**
В [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

**Authorized JavaScript origins:**
```
https://your-domain.com
https://your-app.vercel.app
```

**Authorized redirect URIs:**
```
https://your-domain.com/api/auth/callback/google
https://your-app.vercel.app/api/auth/callback/google
```

### 3. **Vercel Environment Variables**
Если деплоите на Vercel:
```bash
vercel env add NEXTAUTH_URL
# Введите: https://your-app.vercel.app

vercel env add NEXTAUTH_SECRET
# Введите ваш секрет

vercel env add GOOGLE_CLIENT_ID
# Введите ваш Client ID

vercel env add GOOGLE_CLIENT_SECRET  
# Введите ваш Client Secret
```

### 4. **Netlify Environment Variables**
Если деплоите на Netlify:
- Зайдите в Site Settings → Environment Variables
- Добавьте все переменные из .env.local
- Обновите NEXTAUTH_URL на production URL

### 5. **Распространенные ошибки:**

**Error: redirect_uri_mismatch**
- Проверьте что redirect URI в Google Console точно совпадает
- Формат: `https://domain.com/api/auth/callback/google`

**Error: invalid_client**  
- Неправильный Client ID или Client Secret
- Проверьте переменные окружения на production

**Error: access_denied**
- Проверьте что домен добавлен в Authorized origins
- Убедитесь что NEXTAUTH_URL правильный

### 6. **Отладка на production:**

```typescript
// Добавьте в src/lib/auth.ts для отладки
console.log('Production Auth Check:', {
  nextAuthUrl: process.env.NEXTAUTH_URL,
  hasClientId: !!process.env.GOOGLE_CLIENT_ID,
  hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
  environment: process.env.NODE_ENV
})
```

### 7. **Checklist для production:**

- [ ] NEXTAUTH_URL указывает на production домен
- [ ] Google Console: добавлен production домен в Authorized origins  
- [ ] Google Console: добавлен redirect URI с production доменом
- [ ] Environment variables настроены на хостинге
- [ ] Домен использует HTTPS (не HTTP)
- [ ] Кэш браузера очищен после изменений

### 8. **Тестирование:**
1. Откройте production сайт в инкогнито
2. Попробуйте войти через Google
3. Проверьте Network tab в DevTools для ошибок
4. Проверьте логи на хостинге

## 🔗 Полезные ссылки:
- [NextAuth.js Production Guide](https://next-auth.js.org/deployment)
- [Google OAuth Setup](https://console.cloud.google.com/apis/credentials)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)