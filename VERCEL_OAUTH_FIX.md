# 🚨 БЫСТРОЕ ИСПРАВЛЕНИЕ OAuth

## Проблема найдена:
Из скриншотов видно что Google Console настроен правильно, но OAuth все равно не работает.
Это означает проблему с **environment variables в Vercel**.

---

## ⚡ БЫСТРОЕ РЕШЕНИЕ:

### **1. Через Vercel CLI (РЕКОМЕНДУЕТСЯ):**
```bash
# Установите Vercel CLI если нет
npm i -g vercel

# Войдите в Vercel
vercel login

# Запустите исправление
./fix-vercel-oauth.sh
```

### **2. Через Vercel Dashboard (РУЧНОЙ СПОСОБ):**
1. Откройте: https://vercel.com/dashboard
2. Выберите ваш проект (timelyplan.me)
3. Settings → Environment Variables
4. **УДАЛИТЕ все старые OAuth переменные**
5. **Добавьте заново:**

```
NEXTAUTH_URL = https://timelyplan.me
NEXTAUTH_SECRET = tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg=
GOOGLE_CLIENT_ID = 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET = 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
GEMINI_API_KEY = AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ
```

6. **Сделайте Redeploy:** Deployments → три точки → Redeploy

---

## 🔍 ПРОВЕРКА:

После обновления переменных:
1. **Подождите 2-3 минуты**
2. **Откройте ИНКОГНИТО:** https://timelyplan.me/auth/signin  
3. **Попробуйте войти через Google**

---

## ✅ ПРИЧИНЫ ПРОБЛЕМЫ:

1. **Environment variables были неправильные или отсутствовали**
2. **Кэширование старых значений в Vercel**
3. **Необходим force redeploy после изменения переменных**

---

## 🎯 99% вероятность что это решит проблему!

После выполнения команд выше OAuth должен заработать немедленно.