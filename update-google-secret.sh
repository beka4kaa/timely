#!/bin/bash

# 🚀 Быстрое обновление нового Google Client Secret

echo "🔄 Обновляем Google Client Secret в Vercel..."
echo "🆕 Новый секрет: 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"
echo ""

# Команды для Vercel CLI
echo "📋 КОМАНДЫ ДЛЯ VERCEL CLI:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "# 1. Войдите в Vercel (если не вошли)"
echo "vercel login"
echo ""

echo "# 2. Обновите Google Client Secret"
echo "vercel env add GOOGLE_CLIENT_SECRET production"
echo "# Когда спросит значение, введите:"
echo "# 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"
echo ""

echo "# 3. Принудительный redeploy"
echo "vercel --prod --force"

echo ""
echo "📱 РУЧНАЯ НАСТРОЙКА ЧЕРЕЗ VERCEL DASHBOARD:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. https://vercel.com/dashboard"
echo "2. Выберите проект → Settings → Environment Variables"
echo "3. Найдите GOOGLE_CLIENT_SECRET → Edit"
echo "4. Замените на: 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"
echo "5. Save → Deployments → Redeploy"

echo ""
echo "🧪 ТЕСТИРОВАНИЕ:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Подождите 2-3 минуты после deployment"
echo "2. Откройте ИНКОГНИТО: https://timelyplan.me/auth/signin"
echo "3. Попробуйте войти через Google"
echo ""

echo "✅ С новым Client Secret OAuth должен заработать!"

# Автоматическое выполнение если Vercel CLI доступен
if command -v vercel >/dev/null 2>&1; then
    echo ""
    read -p "🚀 Выполнить обновление автоматически? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🔄 Обновляем GOOGLE_CLIENT_SECRET..."
        echo "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" | vercel env add GOOGLE_CLIENT_SECRET production --force
        echo "🚀 Деплоим обновления..."
        vercel --prod --force
        echo ""
        echo "✅ Готово! Тестируйте OAuth через 2-3 минуты"
    fi
else
    echo ""
    echo "❌ Vercel CLI не найден. Используйте ручной способ выше."
fi