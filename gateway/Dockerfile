FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# All config (DATABASE_URL, JWT_SECRET, COOKIE_SECURE, FRONTEND_URL, PORT) comes
# from the environment via app.config.Settings — nothing is baked into the image.
ENV PORT=8085
# One worker is one Python process and therefore one core, which is what the browse
# benchmark saturates first. The gateway holds no per-request state, so unlike visdom
# it needs no sticky routing to scale: more workers is the whole fix.
ENV GATEWAY_WORKERS=1
EXPOSE 8085
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port \"${PORT}\" --workers \"${GATEWAY_WORKERS}\""]
