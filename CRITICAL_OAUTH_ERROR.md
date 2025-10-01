# 🚨 КРИТИЧЕСКАЯ ОШИБКА OAuth найдена!

## ❌ **Проблема обнаружена:**
- NextAuth API возвращает HTTP 400 при попытке авторизации через Google
- Это означает проблему с конфигурацией OAuth

## 🔍 **Вероятные причины:**

### 1. **Google Console - неправильные URL** (САМОЕ ЧАСТОЕ!)
В Google Console должно быть ТОЧНО:
```
Authorized JavaScript origins:
https://timelyplan.me

Authorized redirect URIs:
https://timelyplan.me/api/auth/callback/google
```

### 2. **Неправильные креды в Vercel**
Проверьте в Vercel environment variables:
- `GOOGLE_CLIENT_ID` должен быть точно: `843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com`
- `GOOGLE_CLIENT_SECRET` должен быть точно: `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`

### 3. **Кэш Google Console**
После изменений в Google Console подождите 2-5 минут

---

## ⚡ **СРОЧНЫЕ ДЕЙСТВИЯ:**

### **Шаг 1: Проверьте Google Console**
1. Откройте: https://console.cloud.google.com/apis/credentials
2. Найдите Client ID: `843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa`
3. Нажмите на него для редактирования
4. Убедитесь что есть:
   - **Authorized JavaScript origins:** `https://timelyplan.me`
   - **Authorized redirect URIs:** `https://timelyplan.me/api/auth/callback/google`

### **Шаг 2: Проверьте Vercel Environment Variables**
1. Откройте Vercel Dashboard
2. Перейдите в Settings → Environment Variables
3. Убедитесь что все переменные правильные (см. выше)

### **Шаг 3: Тест в инкогнито**
1. Откройте https://timelyplan.me в инкогнито режиме
2. Попробуйте войти через Google
3. Если ошибка - откройте DevTools → Network tab
4. Посмотрите на ошибку в запросе к `/api/auth/signin/google`

---

## 🔧 **Если проблема остается:**

### **Создайте НОВЫЙ Google OAuth Client:**
1. Google Console → Create Credentials → OAuth Client ID
2. Application type: Web application
3. Name: `timelyplan-new`
4. Authorized JavaScript origins: `https://timelyplan.me`
5. Authorized redirect URIs: `https://timelyplan.me/api/auth/callback/google`
6. Обновите в Vercel новые `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`

---

## 📞 **Нужна помощь?**
Пришлите скриншоты:
1. Настроек Google Console для вашего Client ID
2. Environment variables в Vercel
3. Ошибки из Network tab браузера

**HTTP 400 = проблема с настройками, НЕ с кодом!** 🎯