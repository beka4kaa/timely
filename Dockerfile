FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements from the backend folder
COPY backend/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code into the container
COPY backend/ .

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Кодировка токенайзера — В ОБРАЗ, а не при первом запросе.
#
# `tiktoken` качает файл кодировки при первом обращении и кладёт в кэш. В
# контейнере это означало бы поход в сеть посреди обработки книги, а при
# закрытом исходящем трафике — молчаливый откат на эвристику. Откат сам по себе
# безопасен, но он МЕНЯЕТ границы фрагментов, то есть один и тот же учебник при
# одной `PROCESSING_VERSION` разбивался бы по-разному в зависимости от того,
# достучался ли контейнер до CDN. Прогрев на сборке убирает и сеть, и эту
# недетерминированность.
ENV TIKTOKEN_CACHE_DIR=/app/.tiktoken-cache
RUN python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"

# Collect static files
RUN python manage.py collectstatic --noinput

# Миграции выполняет entrypoint при СТАРТЕ, а не на этапе сборки: во время
# docker build боевой базы ещё нет (и быть не должно).
RUN chmod +x /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Expose port
EXPOSE 8080

# Run the application (Shell form to expand $PORT)
# --timeout must exceed the longest server-side work configured in the app —
# gunicorn's default 30s worker timeout kills the whole worker via SIGABRT
# mid-request before Django's own try/except fallback logic ever runs.
#
# 360s, not 200s: course-plan generation runs inside a single request and makes
# up to three sequential model calls (planner → repair → reviewer). It caps
# itself at CURRICULUM_PLAN_DEADLINE_SECONDS (300s) and degrades by skipping
# steps, so this is the outer boundary that must never be the one to fire.
# Ordering that must hold: model timeout < plan deadline < gunicorn < client.
#
# --worker-class gthread + --threads: /api/ai/chat/stream/ держит соединение
# открытым всё время генерации (SSE). С gunicorn'овским дефолтом в ОДИН
# синхронный воркер первый же открытый стрим заблокировал бы весь бэкенд —
# включая логин и загрузку дашборда. Треды дают параллельные стримы, не требуя
# переписывать синхронные Django-вьюхи и openai SDK на async.
CMD gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --timeout 360 \
    --worker-class gthread --workers 2 --threads 8