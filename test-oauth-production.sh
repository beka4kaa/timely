#!/bin/bash

# 🧪 OAuth Production Test Script

echo "🔍 Testing OAuth Configuration for Production..."

# Получаем домен для тестирования
if [ -z "$1" ]; then
    read -p "📝 Enter your production domain (e.g., https://myapp.vercel.app): " DOMAIN
else
    DOMAIN=$1
fi

echo ""
echo "🧪 Testing OAuth endpoints for: $DOMAIN"
echo "----------------------------------------"

# Тест 1: Проверяем доступность API
echo "1️⃣ Testing NextAuth API..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DOMAIN/api/auth/session")
if [ $STATUS -eq 200 ]; then
    echo "   ✅ NextAuth API available (HTTP $STATUS)"
else
    echo "   ❌ NextAuth API error (HTTP $STATUS)"
fi

# Тест 2: Проверяем providers
echo ""
echo "2️⃣ Testing OAuth providers..."
PROVIDERS=$(curl -s "$DOMAIN/api/auth/providers" | grep -o '"google"' | wc -l)
if [ $PROVIDERS -gt 0 ]; then
    echo "   ✅ Google provider configured"
else
    echo "   ❌ Google provider not found"
fi

# Тест 3: Проверяем environment variables
echo ""
echo "3️⃣ Testing server configuration..."
curl -s "$DOMAIN/api/auth/debug-env" | grep -q '"status":"OK"'
if [ $? -eq 0 ]; then
    echo "   ✅ Server configuration OK"
else
    echo "   ❌ Server configuration issues found"
fi

# Тест 4: Проверяем redirect URL
echo ""
echo "4️⃣ Testing OAuth redirect URL..."
EXPECTED_REDIRECT="$DOMAIN/api/auth/callback/google"
echo "   📋 Expected redirect URI: $EXPECTED_REDIRECT"
echo "   📝 Make sure this URL is added to Google Console"

# Тест 5: Проверяем HTTPS
echo ""
echo "5️⃣ Testing HTTPS..."
if [[ $DOMAIN == https://* ]]; then
    echo "   ✅ Using HTTPS"
else
    echo "   ❌ Not using HTTPS - OAuth requires HTTPS in production"
fi

echo ""
echo "🔗 Useful links for debugging:"
echo "   🔍 Debug page: $DOMAIN/debug-oauth"
echo "   🚨 Error logs: $DOMAIN/api/auth/error-log"
echo "   ⚙️ Server config: $DOMAIN/api/auth/debug-env"
echo "   👤 Test sign-in: $DOMAIN/auth/signin"

echo ""
echo "📋 Google Console Checklist:"
echo "   1. Authorized JavaScript origins: $DOMAIN"
echo "   2. Authorized redirect URIs: $DOMAIN/api/auth/callback/google"
echo "   3. OAuth consent screen configured"
echo "   4. Correct Client ID and Secret in environment variables"

echo ""
echo "🎯 Next steps if OAuth still doesn't work:"
echo "   1. Open $DOMAIN/debug-oauth in browser"
echo "   2. Check server logs for detailed errors"
echo "   3. Verify Google Console settings match exactly"
echo "   4. Try incognito mode to avoid cache issues"