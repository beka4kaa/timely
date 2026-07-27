<p align="center">
  <img src="public/logo.svg" alt="TimelyPlan Logo" width="80" />
</p>

<h1 align="center">TimelyPlan</h1>

<p align="center">
  <strong>A student-focused school diary, schedule planner, and academic toolkit</strong>
</p>

<p align="center">
  <a href="https://app.timelyplan.me"><img src="https://img.shields.io/badge/Live_App-app.timelyplan.me-brightgreen?style=for-the-badge" alt="Live App" /></a>
</p>

<p align="center">
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" alt="Next.js 15" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript 5" /></a>
  <a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?logo=tailwind-css" alt="Tailwind CSS" /></a>
  <a href="https://www.djangoproject.com"><img src="https://img.shields.io/badge/Django-6-092E20?logo=django" alt="Django 6" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
</p>

---

## Overview

**TimelyPlan** is a full-stack web application designed for students to manage their school life. It provides an interactive weekly diary, class schedule builder, grade tracker, AI-powered study assistant, and more — all in a modern, mobile-friendly interface with dark/light theme support.

**Live:** [timelyplan.me](https://timelyplan.me) (landing) → [app.timelyplan.me](https://app.timelyplan.me) (the app itself)

---

## Features

| Module | Description |
|--------|-------------|
| **📓 Diary** | Weekly diary with lessons, homework, grades, and YouTube links per day |
| **📅 Schedule** | Multi-template class schedule builder with CSV import/export and drag-and-drop |
| **📊 Grades** | Grade tracker with subject-level statistics, yearly averages, and sticky columns on mobile |
| **🤖 AI Assistant** | Gemini-powered chat for study help and learning program generation |
| **📋 Study Planner** | Day-by-day planner with lesson blocks, segments (theory + practice), and a focus timer |
| **🎯 Goals & Achievements** | SMART goal tracking with milestones, progress bars, and achievement collection |
| **📅 Calendar** | Monthly event calendar with categories and color coding |
| **✅ Tasks** | Task management with priorities, categories, and filtering |
| **🧠 Mind (SRS)** | Spaced-repetition flashcard system for subjects and topics |
| **🤔 Self-Work** | Reflection journal, insecurity tracker, and personal growth planner |

Additional capabilities:
- **Google OAuth & credential-based authentication** via NextAuth.js
- **PWA support** — installable on mobile with custom icons and manifest
- **Undo system** — Ctrl+Z support with toast-based undo for destructive actions
- **Dark / light theme** with system preference detection

---

## Tech Stack

### Frontend

| Technology | Purpose |
|-----------|---------|
| [Next.js 15](https://nextjs.org) (App Router) | React framework with SSR/SSG |
| [TypeScript](https://typescriptlang.org) | Type-safe development |
| [Tailwind CSS](https://tailwindcss.com) | Utility-first styling |
| [shadcn/ui](https://ui.shadcn.com) + [Radix UI](https://radix-ui.com) | Accessible component primitives |
| [Framer Motion](https://www.framer.com/motion/) | Animations |
| [dnd-kit](https://dndkit.com) | Drag-and-drop |
| [Recharts](https://recharts.org) | Charts and data visualization |
| [date-fns](https://date-fns.org) | Date manipulation |
| [Zod](https://zod.dev) | Schema validation |
| [Sonner](https://sonner.emilkowal.dev) | Toast notifications |

### Backend

| Technology | Purpose |
|-----------|---------|
| [Django 6](https://djangoproject.com) + [DRF](https://django-rest-framework.org) | REST API |
| [PostgreSQL](https://postgresql.org) | Production database |
| [Gunicorn](https://gunicorn.org) | WSGI HTTP server |
| [Google Generative AI](https://ai.google.dev) | Gemini integration for AI features |

### Infrastructure

| Service | Purpose |
|---------|---------|
| [Vercel](https://vercel.com) | Frontend hosting (both `timelyplan.me` and `app.timelyplan.me` on one project) |
| [Northflank](https://northflank.com) | Backend hosting |
| [Docker](https://docker.com) | Backend containerization |

---

## Project Structure

```
├── src/                          # Next.js frontend
│   ├── app/                      # App Router pages & API routes
│   │   ├── api/                  # Next.js API routes (auth, diary, AI, etc.)
│   │   ├── auth/                 # Authentication pages (sign-in, register)
│   │   └── dashboard/            # Protected app pages
│   │       ├── diary/            # Diary, grades
│   │       ├── schedule/         # Class schedule builder
│   │       ├── study/            # Study planner with timer
│   │       ├── calendar/         # Event calendar
│   │       ├── tasks/            # Task management
│   │       ├── goals/            # Goal tracking
│   │       ├── achievements/     # Achievement collection
│   │       ├── ai/               # AI assistant chat
│   │       ├── review/           # SRS review sessions
│   │       ├── self-work/        # Reflection & growth
│   │       └── profile/          # User profile
│   ├── components/               # React components
│   │   ├── ui/                   # shadcn/ui primitives
│   │   ├── diary/                # Diary-specific components
│   │   ├── dashboard/            # Dashboard feature components
│   │   ├── study-planner/        # Study planner components
│   │   ├── mind/                 # SRS/flashcard components
│   │   └── providers/            # Context providers
│   ├── contexts/                 # React contexts (auth, diary header)
│   ├── hooks/                    # Custom React hooks
│   ├── lib/                      # Utilities, API clients, stores
│   │   ├── auth.ts               # NextAuth.js configuration
│   │   ├── diary-store.ts        # Diary state management
│   │   ├── diary-grades.ts       # Grade calculation logic
│   │   ├── diary-undo.ts         # Undo system
│   │   ├── backend-api.ts        # Backend API client
│   │   └── srs.ts                # Spaced repetition algorithm
│   └── types/                    # TypeScript type definitions
│
├── backend/                      # Django REST API
│   ├── config/                   # Django settings & URLs
│   ├── accounts/                 # User management
│   ├── diary/                    # Diary models, views, serializers
│   ├── planner/                  # Day planner API
│   ├── mind/                     # SRS/flashcard API
│   └── ai_engine/                # Gemini AI integration
│
├── public/                       # Static assets (icons, logos)
├── middleware.ts                  # NextAuth route protection
├── next.config.js                # Next.js config with API rewrites
├── tailwind.config.js            # Tailwind CSS configuration
├── Dockerfile                    # Backend Docker image
└── package.json                  # Frontend dependencies & scripts
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.11 (for backend)
- **PostgreSQL** (for production; backend uses Django ORM)

### 1. Clone the repository

```bash
git clone https://github.com/beka4kaa/timely.git
cd timely
```

### 2. Set up the frontend

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env.local
# Edit .env.local with your credentials (see Environment Variables below)

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Set up the backend (optional for local dev)

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Start the server
python manage.py runserver
```

The backend runs at [http://localhost:8000](http://localhost:8000).

### Environment Variables

Create a `.env.local` file in the project root:

```env
# NextAuth.js
NEXTAUTH_SECRET=<random-32-char-secret>
NEXTAUTH_URL=http://localhost:3000

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>

# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:8000
# BACKEND_URL overrides NEXT_PUBLIC_API_URL when set (used on Vercel)

# AI features (see backend/.env.example for the full list — vision,
# board/LLM, nutrition-photo providers, etc.)
OPENROUTER_API_KEY=<your-openrouter-api-key>
```

In production (Vercel), `NEXTAUTH_URL` must be **`https://app.timelyplan.me`**, not the apex domain — the app and all auth routes live on the subdomain, while `timelyplan.me` itself only redirects to it. See [src/lib/auth.ts](src/lib/auth.ts) for how the session cookie is shared across both hosts.

#### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and configure the OAuth consent screen
3. Create an **OAuth 2.0 Client ID** (Web application)
4. Add authorized redirect URIs for every host you use:
   - `http://localhost:3000/api/auth/callback/google` (local dev)
   - `https://app.timelyplan.me/api/auth/callback/google` (production)
5. Copy Client ID and Client Secret to `.env.local` (or the Vercel project's env vars)

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Run TypeScript type checking |

---

## Deployment

### Frontend (Vercel)

1. Connect the repository to [Vercel](https://vercel.com)
2. Add both domains to the project: `timelyplan.me` (apex, landing page) and `app.timelyplan.me` (the app) — one Vercel project serves both
3. Add all environment variables from `.env.production.example`, setting `NEXTAUTH_URL=https://app.timelyplan.me`
4. Deploy automatically on push to `main`

### Backend (Northflank / Docker)

```bash
# Build Docker image
docker build -t timelyplan-backend .

# Run container
docker run -p 8000:8000 --env-file backend/.env timelyplan-backend
```

Or deploy directly to [Northflank](https://northflank.com) from the repository. The frontend's `next.config.js` proxies `/api/*` to the Northflank service URL by default when building on Vercel; override it with `BACKEND_URL` or `NEXT_PUBLIC_API_URL` if your Northflank service URL differs.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## Author

**Bekzhan** — [@beka4kaa](https://github.com/beka4kaa)
