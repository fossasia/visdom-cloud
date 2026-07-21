FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# All config (DATABASE_URL, JWT_SECRET, COOKIE_SECURE, FRONTEND_URL, PORT) comes
# from the environment via app.config.Settings — nothing is baked into the image.
ENV PORT=8085
EXPOSE 8085
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port \"${PORT}\""]
