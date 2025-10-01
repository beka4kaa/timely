#!/bin/bash

# 🚀 Production Deployment Script для Google OAuth

echo "🔧 Настройка production deployment для Google OAuth..."

# Получаем домен от пользователя
read -p "📝 Введите ваш production домен (например: https://myapp.vercel.app): " PRODUCTION_DOMAIN

# Проверяем что домен начинается с https://
if [[ ! $PRODUCTION_DOMAIN == https://* ]]; then
    echo "❌ Домен должен начинаться с https://"
    exit 1
fi

echo "🔍 Создаю production environment файл..."

# Создаем .env.production
cat > .env.production << EOF
# Production Environment Variables
NEXTAUTH_SECRET=tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg=
NEXTAUTH_URL=$PRODUCTION_DOMAIN

# Google OAuth
GOOGLE_CLIENT_ID=843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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

# Database
DATABASE_URL="file:./dev.db"

# Gemini AI  
GEMINI_API_KEY=AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ
EOF

echo "✅ .env.production создан!"

echo ""
echo "📋 СЛЕДУЮЩИЕ ШАГИ:"
echo ""
echo "1. 🔧 В Google Cloud Console (https://console.cloud.google.com/apis/credentials):"
echo "   - Добавьте в 'Authorized JavaScript origins':"
echo "     $PRODUCTION_DOMAIN"
echo ""
echo "   - Добавьте в 'Authorized redirect URIs':"
echo "     $PRODUCTION_DOMAIN/api/auth/callback/google"
echo ""
echo "2. 🚀 При деплое на Vercel:"
echo "   vercel env add NEXTAUTH_URL"
echo "   # Введите: $PRODUCTION_DOMAIN"
echo ""
echo "3. 🚀 При деплое на Netlify:"
echo "   - Зайдите в Site Settings → Environment Variables"
echo "   - Добавьте NEXTAUTH_URL = $PRODUCTION_DOMAIN"
echo ""
echo "4. 🧪 Тестирование:"
echo "   - Откройте $PRODUCTION_DOMAIN в инкогнито режиме"
echo "   - Попробуйте войти через Google"
echo ""

echo "🎉 Готово! Теперь Google OAuth должен работать на production."