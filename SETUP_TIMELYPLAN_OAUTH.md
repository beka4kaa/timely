# 🔧 Настройка Google OAuth для localhost + timelyplan.me

## 🎯 ЦЕЛЬ: OAuth работает и локально, и на production сайте

### 🔗 Google Console Setup:
**Откройте:** https://console.cloud.google.com/apis/credentials
**Найдите Client ID:** `843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa`

---

## 📋 НАСТРОЙКИ В GOOGLE CONSOLE:

### ✅ **Authorized JavaScript origins:**
```
http://localhost:3000
https://localhost:3000
https://timelyplan.me
```

### ✅ **Authorized redirect URIs:**
```
http://localhost:3000/api/auth/callback/google
https://localhost:3000/api/auth/callback/google
https://timelyplan.me/api/auth/callback/google
```

---

## 🚀 ДЕПЛОЙ НА ХОСТИНГ:

### 📦 **Если используете Vercel:**
```bash
vercel env add NEXTAUTH_URL https://timelyplan.me
vercel env add NEXTAUTH_SECRET tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg=
vercel env add GOOGLE_CLIENT_ID 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com
vercel env add GOOGLE_CLIENT_SECRET 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
vercel env add GEMINI_API_KEY AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ

# Custom domain setup
vercel domains add timelyplan.me
```

### 📦 **Если используете Netlify:**
```bash
# В Site Settings → Environment Variables добавьте:
NEXTAUTH_URL = https://timelyplan.me
NEXTAUTH_SECRET = tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg=
GOOGLE_CLIENT_ID = 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET = 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
GEMINI_API_KEY = AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ

# Custom domain setup в Netlify → Domain settings
```

### 📦 **Если другой хостинг:**
- Добавьте все environment variables как указано выше
- Настройте custom domain `timelyplan.me`

---

## 🧪 ТЕСТИРОВАНИЕ:

### **Локально:**
1. `npm run dev` - должно работать на localhost:3000
2. Тест: http://localhost:3000/auth/signin

### **Production:**
1. Деплой на хостинг с domain `timelyplan.me`
2. Тест: https://timelyplan.me/auth/signin
3. Debug: https://timelyplan.me/debug-oauth

---

## 🔥 БЫСТРЫЕ КОМАНДЫ:

### **Vercel с custom domain:**
```bash
# 1. Deploy
vercel --prod

# 2. Add domain
vercel domains add timelyplan.me

# 3. Set DNS
# Добавьте CNAME record: timelyplan.me → your-app.vercel.app
```

### **Netlify с custom domain:**
```bash
# 1. Deploy
netlify deploy --prod

# 2. В админке Netlify → Domain settings → Add custom domain
# 3. Настройте DNS согласно инструкциям Netlify
```

---

## ✅ ФИНАЛЬНЫЙ ЧЕКЛИСТ:

- [ ] Google Console: добавлены оба домена в origins
- [ ] Google Console: добавлены redirect URIs для обоих доменов  
- [ ] Environment variables установлены на хостинге
- [ ] Custom domain `timelyplan.me` настроен
- [ ] DNS записи настроены
- [ ] HTTPS сертификат активен
- [ ] Тестирование на обоих доменах пройдено

## 🎯 РЕЗУЛЬТАТ:
- ✅ Локальная разработка: `http://localhost:3000` 
- ✅ Production сайт: `https://timelyplan.me`
- ✅ OAuth работает на обоих!