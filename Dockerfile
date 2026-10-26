# 1. React broadcast UI
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

# 2. API + agents
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml README.md ./
COPY src ./src
COPY web ./web
COPY --from=frontend /fe/dist ./frontend/dist
RUN pip install --no-cache-dir ".[azure]"
EXPOSE 80
CMD ["uvicorn", "matchcopilot.api.app:app", "--host", "0.0.0.0", "--port", "80"]
