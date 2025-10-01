#!/bin/bash

# 🚨 Экстренная диагностика OAuth для timelyplan.me

echo "🚨 КРИТИЧЕСКАЯ ДИАГНОСТИКА OAuth"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "❌ ОБНАРУЖЕНА ОШИБКА: HTTP 400 при OAuth"
echo "🎯 Это означает проблему с Google Console настройками"

echo ""
echo "🔍 ПРОВЕРЬТЕ ПРЯМО СЕЙЧАС:"
echo ""

echo "1️⃣ GOOGLE CONSOLE НАСТРОЙКИ:"
echo "   🔗 https://console.cloud.google.com/apis/credentials"
echo "   📋 Client ID: 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa"
echo ""
echo "   ✅ В 'Authorized JavaScript origins' должно быть:"
echo "      https://timelyplan.me"
echo ""
echo "   ✅ В 'Authorized redirect URIs' должно быть:"
echo "      https://timelyplan.me/api/auth/callback/google"

echo ""
echo "2️⃣ VERCEL ENVIRONMENT VARIABLES:"
echo "   Откройте Vercel Dashboard → Settings → Environment Variables"
echo "   Проверьте что есть:"
echo ""
echo "   NEXTAUTH_URL = https://timelyplan.me"
echo "   GOOGLE_CLIENT_ID = 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com"
echo "   GOOGLE_CLIENT_SECRET = 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"

echo ""
echo "3️⃣ ТЕСТ ПРЯМО В БРАУЗЕРЕ:"
echo "   📱 Откройте: https://timelyplan.me/auth/signin"
echo "   📱 В ИНКОГНИТО режиме!"
echo "   📱 Откройте DevTools → Network tab"
echo "   📱 Попробуйте войти через Google"
echo "   📱 Посмотрите на ошибки в Network tab"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚡ ЭКСТРЕННОЕ РЕШЕНИЕ:"
echo ""
echo "Если настройки правильные, но не работает:"
echo "1. Создайте НОВЫЙ Google OAuth Client"  
echo "2. Обновите креды в Vercel"
echo "3. Подождите 2-3 минуты"
echo "4. Тестируйте снова"

echo ""
echo "📞 99% проблем решается правильными настройками Google Console!"

# Открываем Google Console автоматически (если на Mac)
if command -v open >/dev/null 2>&1; then
    echo ""
    read -p "🔗 Открыть Google Console автоматически? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "https://console.cloud.google.com/apis/credentials"
        echo "✅ Google Console открыт в браузере"
    fi
fi