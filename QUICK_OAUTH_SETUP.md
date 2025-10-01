# ⚡ БЫСТРАЯ НАСТРОЙКА OAuth для localhost + timelyplan.me

## 🎯 1. Google Console (ОБЯЗАТЕЛЬНО!)
**Откройте:** https://console.cloud.google.com/apis/credentials  
**Client ID:** `843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa`

### ✅ Authorized JavaScript origins:
```
http://localhost:3000
https://localhost:3000
https://timelyplan.me
```

### ✅ Authorized redirect URIs:
```
http://localhost:3000/api/auth/callback/google
https://localhost:3000/api/auth/callback/google
https://timelyplan.me/api/auth/callback/google
```

---

## 🚀 2. Environment Variables на хостинге:
```bash
NEXTAUTH_URL=https://timelyplan.me
NEXTAUTH_SECRET=tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg=
GOOGLE_CLIENT_ID=843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
GEMINI_API_KEY=AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ
```

---

## 🌐 3. Custom Domain Setup:
- **Vercel:** `vercel domains add timelyplan.me`
- **Netlify:** Domain Settings → Add custom domain
- **DNS:** CNAME `timelyplan.me` → ваш хостинг URL

---

## ✅ 4. Тест:
- **Локально:** http://localhost:3000/auth/signin
- **Production:** https://timelyplan.me/auth/signin

**⏱️ Время: 5 минут | Результат: OAuth работает везде! 🎉**