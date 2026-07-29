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

# Collect static files
RUN python manage.py collectstatic --noinput

# Миграции выполняет entrypoint при СТАРТЕ, а не на этапе сборки: во время
# docker build боевой базы ещё нет (и быть не должно).
RUN chmod +x /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Expose port
EXPOSE 8080

# Run the application (Shell form to expand $PORT)
# --timeout must exceed the longest client-side AI call timeout configured in
# the app (TEXT_LLM_TIMEOUT / skills/board.py both allow up to 180s) — gunicorn's
# default 30s worker timeout kills the whole worker via SIGABRT mid-request
# before Django's own try/except fallback logic ever runs.
#
# --worker-class gthread + --threads: /api/ai/chat/stream/ держит соединение
# открытым всё время генерации (SSE). С gunicorn'овским дефолтом в ОДИН
# синхронный воркер первый же открытый стрим заблокировал бы весь бэкенд —
# включая логин и загрузку дашборда. Треды дают параллельные стримы, не требуя
# переписывать синхронные Django-вьюхи и openai SDK на async.
CMD gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --timeout 200 \
    --worker-class gthread --workers 2 --threads 8