FROM node:24-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    FRONTEND_DIST=/app/frontend/dist

WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/alembic.ini backend/docker-entrypoint.sh ./
COPY backend/app ./app
COPY --from=frontend /build/frontend/dist /app/frontend/dist

# A fresh named volume inherits this ownership, so the app never needs root.
RUN useradd --uid 10001 --no-create-home board && mkdir -p /data && chown board /data
USER board
EXPOSE 8000

ENTRYPOINT ["sh", "/app/backend/docker-entrypoint.sh"]
