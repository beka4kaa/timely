#!/bin/bash

# 🚀 Быстрое исправление OAuth для production

echo "🔧 Быстрое исправление Google OAuth для production..."
echo ""

# Получаем production домен
read -p "📝 Введите ваш PRODUCTION домен (например: https://myapp.vercel.app): " PRODUCTION_DOMAIN

# Валидация домена
if [[ ! $PRODUCTION_DOMAIN =~ ^https:// ]]; then
    echo "❌ Домен должен начинаться с https://"
    echo "📝 Пример: https://myapp.vercel.app"
    exit 1
fi

echo ""
echo "🔄 Обновляю локальные файлы для продакшена..."

# Создаем .env.production с правильными настройками
cat > .env.production << EOF
# Production Environment Variables
NEXTAUTH_SECRET=tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg=
NEXTAUTH_URL=$PRODUCTION_DOMAIN

# Google OAuth - используем те же креды
GOOGLE_CLIENT_ID=843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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

# Database
DATABASE_URL="file:./dev.db"

# Gemini AI
GEMINI_API_KEY=AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ
EOF

echo "✅ .env.production создан с правильными настройками"

# Создаем файл с командами для разных хостингов
cat > deploy-commands.txt << EOF
🚀 КОМАНДЫ ДЛЯ ДЕПЛОЯ (выберите ваш хостинг):

📦 VERCEL:
vercel env add production NEXTAUTH_URL $PRODUCTION_DOMAIN
vercel env add production NEXTAUTH_SECRET tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg=
vercel env add production GOOGLE_CLIENT_ID 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com
vercel env add production GOOGLE_CLIENT_SECRET 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
vercel env add production GEMINI_API_KEY AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ
vercel --prod

📦 NETLIFY:
# В админке Netlify → Site Settings → Environment Variables добавьте:
NEXTAUTH_URL = $PRODUCTION_DOMAIN
NEXTAUTH_SECRET = tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg=
GOOGLE_CLIENT_ID = 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET = 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
GEMINI_API_KEY = AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ

📦 RAILWAY:
# В Railway → Environment добавьте переменные выше

📦 RENDER:
# В Render → Environment добавьте переменные выше
EOF

echo ""
echo "📋 КРИТИЧЕСКИ ВАЖНО - GOOGLE CONSOLE:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔗 Откройте: https://console.cloud.google.com/apis/credentials"
echo ""
echo "1️⃣ Найдите ваш OAuth Client ID: 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa"
echo ""
echo "2️⃣ В 'Authorized JavaScript origins' добавьте:"
echo "    $PRODUCTION_DOMAIN"
echo ""
echo "3️⃣ В 'Authorized redirect URIs' добавьте:"
echo "    $PRODUCTION_DOMAIN/api/auth/callback/google"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "📁 Создал файлы:"
echo "   ✅ .env.production - правильные production настройки"
echo "   ✅ deploy-commands.txt - команды для вашего хостинга"

echo ""
echo "🚀 СЛЕДУЮЩИЕ ШАГИ:"
echo "1. Откройте Google Console по ссылке выше"
echo "2. Добавьте URLs как указано"
echo "3. Выполните команды из deploy-commands.txt для вашего хостинга"
echo "4. Деплойте проект"
echo "5. Тестируйте на $PRODUCTION_DOMAIN/debug-oauth"

echo ""
echo "⏱️ Время исправления: 2-3 минуты"
echo "🎯 После этого OAuth будет работать!"