#!/bin/bash

# 🚨 Точное исправление для timelyplan.me OAuth

echo "🔧 Исправление OAuth для timelyplan.me..."
echo ""

# Проверяем текущие настройки Vercel
echo "1️⃣ Проверяем текущие Vercel environment variables..."
echo ""

if command -v vercel >/dev/null 2>&1; then
    echo "📋 Текущие переменные в Vercel:"
    vercel env ls --scope=production 2>/dev/null || echo "   ❌ Vercel CLI не найден или не авторизован"
else
    echo "   ❌ Vercel CLI не установлен"
    echo "   📝 Установите: npm i -g vercel"
fi

echo ""
echo "2️⃣ Обновляем/добавляем правильные переменные..."

# Функция для добавления переменных
add_vercel_env() {
    local key=$1
    local value=$2
    echo "   ➕ Добавляем $key..."
    echo "$value" | vercel env add "$key" production --force 2>/dev/null || echo "   ⚠️  Ошибка добавления $key"
}

if command -v vercel >/dev/null 2>&1; then
    echo "🔄 Обновляем переменные в Vercel..."
    
    # Удаляем старые если есть и добавляем новые
    vercel env rm NEXTAUTH_URL production --yes 2>/dev/null
    vercel env rm NEXTAUTH_SECRET production --yes 2>/dev/null
    vercel env rm GOOGLE_CLIENT_ID production --yes 2>/dev/null
    vercel env rm GOOGLE_CLIENT_SECRET production --yes 2>/dev/null
    vercel env rm GEMINI_API_KEY production --yes 2>/dev/null
    
    # Добавляем правильные переменные
    add_vercel_env "NEXTAUTH_URL" "https://timelyplan.me"
    add_vercel_env "NEXTAUTH_SECRET" "tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg="
    add_vercel_env "GOOGLE_CLIENT_ID" "843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com"
    add_vercel_env "GOOGLE_CLIENT_SECRET" "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"
    add_vercel_env "GEMINI_API_KEY" "AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ"
    
    echo ""
    echo "✅ Переменные обновлены в Vercel"
else
    echo "❌ Vercel CLI недоступен"
    echo ""
    echo "📝 ДОБАВЬТЕ ВРУЧНУЮ в Vercel Dashboard:"
    echo "   NEXTAUTH_URL = https://timelyplan.me"
    echo "   NEXTAUTH_SECRET = tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg="
    echo "   GOOGLE_CLIENT_ID = 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com"
    echo "   GOOGLE_CLIENT_SECRET = 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"
    echo "   GEMINI_API_KEY = AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ"
fi

echo ""
echo "3️⃣ Проверяем Google Console настройки..."
echo ""
echo "🔗 Откройте: https://console.cloud.google.com/apis/credentials"
echo "📋 Client ID: 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa"
echo ""
echo "✅ Authorized JavaScript origins должно содержать:"
echo "   https://timelyplan.me"
echo ""
echo "✅ Authorized redirect URIs должно содержать:"
echo "   https://timelyplan.me/api/auth/callback/google"

echo ""
echo "4️⃣ Деплоим обновления..."

if command -v vercel >/dev/null 2>&1; then
    echo "🚀 Запускаем production deployment..."
    vercel --prod --force
    echo "✅ Deployment завершен"
else
    echo "📝 Сделайте manual deployment в Vercel Dashboard"
fi

echo ""
echo "5️⃣ Ждем пропагацию изменений..."
echo "⏱️  Подождите 2-3 минуты для применения изменений..."

echo ""
echo "6️⃣ Тестируем..."
echo "🧪 Откройте в ИНКОГНИТО: https://timelyplan.me/auth/signin"
echo "🧪 Попробуйте войти через Google"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ЕСЛИ НЕ РАБОТАЕТ:"
echo "1. Проверьте что все переменные есть в Vercel"
echo "2. Убедитесь что Google Console содержит правильные URLs"
echo "3. Очистите кэш браузера"
echo "4. Попробуйте другой браузер"