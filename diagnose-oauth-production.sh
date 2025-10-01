#!/bin/bash

# 🔍 Диагностика OAuth проблемы для timelyplan.me

echo "🚨 ДИАГНОСТИКА OAuth НА PRODUCTION"
echo "Сайт: https://timelyplan.me"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "🧪 1. ТЕСТИРОВАНИЕ ENDPOINTS..."

# Проверяем NextAuth API
echo "   📡 Проверяем NextAuth API..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://timelyplan.me/api/auth/session" 2>/dev/null)
if [ $STATUS -eq 200 ]; then
    echo "   ✅ NextAuth API работает (HTTP $STATUS)"
else
    echo "   ❌ NextAuth API ошибка (HTTP $STATUS)"
fi

# Проверяем providers
echo "   📡 Проверяем providers..."
PROVIDERS_RESPONSE=$(curl -s "https://timelyplan.me/api/auth/providers" 2>/dev/null)
if echo "$PROVIDERS_RESPONSE" | grep -q "google"; then
    echo "   ✅ Google provider найден"
else
    echo "   ❌ Google provider НЕ найден"
fi

# Проверяем debug endpoint
echo "   📡 Проверяем конфигурацию сервера..."
DEBUG_RESPONSE=$(curl -s "https://timelyplan.me/api/auth/debug-env" 2>/dev/null)
if echo "$DEBUG_RESPONSE" | grep -q '"status":"OK"'; then
    echo "   ✅ Конфигурация сервера OK"
else
    echo "   ❌ Проблемы с конфигурацией сервера"
fi

echo ""
echo "🔍 2. ПРОВЕРКА GOOGLE CONSOLE НАСТРОЕК..."
echo ""
echo "   📋 ОБЯЗАТЕЛЬНО ПРОВЕРЬТЕ В GOOGLE CONSOLE:"
echo "   🔗 https://console.cloud.google.com/apis/credentials"
echo ""
echo "   Client ID: 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa"
echo ""
echo "   ✅ Authorized JavaScript origins ДОЛЖНЫ содержать:"
echo "      https://timelyplan.me"
echo ""  
echo "   ✅ Authorized redirect URIs ДОЛЖНЫ содержать:"
echo "      https://timelyplan.me/api/auth/callback/google"

echo ""
echo "🚨 3. ЧАСТЫЕ ПРОБЛЕМЫ И РЕШЕНИЯ:"
echo ""
echo "   ❌ Проблема: redirect_uri_mismatch"
echo "   ✅ Решение: Проверить точное совпадение redirect URI в Google Console"
echo ""
echo "   ❌ Проблема: invalid_client"  
echo "   ✅ Решение: Проверить GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET в Vercel"
echo ""
echo "   ❌ Проблема: access_denied"
echo "   ✅ Решение: Добавить timelyplan.me в Authorized origins"

echo ""
echo "🔧 4. ДЕЙСТВИЯ ПРЯМО СЕЙЧАС:"
echo ""
echo "   1️⃣ Откройте Google Console по ссылке выше"
echo "   2️⃣ Найдите ваш Client ID"
echo "   3️⃣ Убедитесь что есть:"
echo "      - Authorized origin: https://timelyplan.me"
echo "      - Redirect URI: https://timelyplan.me/api/auth/callback/google"
echo "   4️⃣ Сохраните изменения в Google Console"
echo "   5️⃣ Подождите 1-2 минуты"
echo "   6️⃣ Тестируйте: https://timelyplan.me/auth/signin"

echo ""
echo "🧪 5. ДОПОЛНИТЕЛЬНАЯ ДИАГНОСТИКА:"
echo "   🔍 Debug page: https://timelyplan.me/debug-oauth"
echo "   🚨 Error logs: https://timelyplan.me/api/auth/error-log"

echo ""
echo "📱 6. ТЕСТИРОВАНИЕ В БРАУЗЕРЕ:"
echo "   - Откройте https://timelyplan.me в ИНКОГНИТО режиме"
echo "   - Попробуйте войти через Google"
echo "   - Проверьте Network tab в DevTools для ошибок"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 ЕСЛИ НИЧЕГО НЕ ПОМОГАЕТ:"
echo "📞 Скиньте скриншот настроек Google Console"
echo "📞 И ошибку из Network tab браузера"