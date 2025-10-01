#!/bin/bash

# 🚀 Настройка OAuth для localhost + timelyplan.me

echo "🔧 Настройка OAuth для разработки и production..."
echo ""
echo "🎯 Домены:"
echo "  📱 Разработка: http://localhost:3000"  
echo "  🌐 Production: https://timelyplan.me"
echo ""

echo "📋 ШАГИ НАСТРОЙКИ:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "1️⃣ GOOGLE CONSOLE SETUP:"
echo "🔗 Откройте: https://console.cloud.google.com/apis/credentials"
echo "🔍 Найдите Client ID: 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa"
echo ""
echo "✅ В 'Authorized JavaScript origins' добавьте:"
echo "   http://localhost:3000"
echo "   https://localhost:3000" 
echo "   https://timelyplan.me"
echo ""
echo "✅ В 'Authorized redirect URIs' добавьте:"
echo "   http://localhost:3000/api/auth/callback/google"
echo "   https://localhost:3000/api/auth/callback/google"
echo "   https://timelyplan.me/api/auth/callback/google"

echo ""
echo "2️⃣ ФАЙЛЫ СОЗДАНЫ:"
echo "   ✅ .env.production - настройки для timelyplan.me"
echo "   ✅ .env.local - оставлен localhost для разработки"

echo ""
echo "3️⃣ ВЫБЕРИТЕ ВАШ ХОСТИНГ:"
echo ""

# Определяем хостинг
PS3="Выберите ваш хостинг: "
options=("Vercel" "Netlify" "Railway" "Render" "Другой" "Пропустить")
select opt in "${options[@]}"
do
    case $opt in
        "Vercel")
            echo ""
            echo "📦 VERCEL КОМАНДЫ:"
            echo "vercel env add NEXTAUTH_URL https://timelyplan.me"
            echo "vercel env add NEXTAUTH_SECRET tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg="
            echo "vercel env add GOOGLE_CLIENT_ID 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com"
            echo "vercel env add GOOGLE_CLIENT_SECRET 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"
            echo "vercel env add GEMINI_API_KEY AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ"
            echo "vercel domains add timelyplan.me"
            echo "vercel --prod"
            break
            ;;
        "Netlify")
            echo ""
            echo "📦 NETLIFY ИНСТРУКЦИИ:"
            echo "1. Site Settings → Environment Variables"
            echo "2. Добавьте переменные:"
            echo "   NEXTAUTH_URL = https://timelyplan.me"
            echo "   NEXTAUTH_SECRET = tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg="
            echo "   GOOGLE_CLIENT_ID = 843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com"
            echo "   GOOGLE_CLIENT_SECRET = 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"
            echo "   GEMINI_API_KEY = AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ"
            echo "3. Domain settings → Add custom domain: timelyplan.me"
            break
            ;;
        "Railway"|"Render"|"Другой")
            echo ""
            echo "📦 ENVIRONMENT VARIABLES:"
            echo "Добавьте в настройки хостинга:"
            echo "NEXTAUTH_URL=https://timelyplan.me"
            echo "NEXTAUTH_SECRET=tixkNf0yILh7PgdmUkEqXsa5QjBdt8lYURh36aoeYCg="
            echo "GOOGLE_CLIENT_ID=843575412842-ak2vrt66id4597n5pc2cqc17qgan0afa.apps.googleusercontent.com"
            echo "GOOGLE_CLIENT_SECRET=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"
            echo "GEMINI_API_KEY=AIzaSyD_4WE4l1dDbKYSOE38UspUh4sDB9lfOTQ"
            break
            ;;
        "Пропустить")
            echo "Настройку хостинга пропущена"
            break
            ;;
        *) echo "Неверный выбор $REPLY";;
    esac
done

echo ""
echo "4️⃣ DNS НАСТРОЙКИ ДЛЯ timelyplan.me:"
echo "   📝 Добавьте CNAME запись в вашем DNS провайдере"
echo "   📝 Направьте timelyplan.me на ваш хостинг"

echo ""
echo "5️⃣ ТЕСТИРОВАНИЕ:"
echo "   🧪 Локально: npm run dev → http://localhost:3000/auth/signin"
echo "   🧪 Production: https://timelyplan.me/auth/signin"
echo "   🔍 Debug: https://timelyplan.me/debug-oauth"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ НАСТРОЙКА ЗАВЕРШЕНА!"
echo "🎯 OAuth будет работать на localhost И timelyplan.me"
echo "⏱️ Время выполнения: 5-10 минут"