FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
COPY frontend/ ./frontend/
COPY static/college-header.png ./static/college-header.png
RUN npm --prefix frontend run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY data/ ./data/
COPY --from=frontend /app/static/ ./static/
ENV APP_ENV=production \
    DATABASE_PATH=/data/vlab.db
VOLUME /data
EXPOSE 8000
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-8000} --workers 1 --access-logfile - --error-logfile - app:app"]
