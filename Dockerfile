FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml README.md ./
COPY src ./src
COPY web ./web
RUN pip install --no-cache-dir ".[azure]"
EXPOSE 80
CMD ["uvicorn", "matchcopilot.api.app:app", "--host", "0.0.0.0", "--port", "80"]
