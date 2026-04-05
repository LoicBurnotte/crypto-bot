FROM python:3.11-slim

WORKDIR /app

# Copy everything first so cache is always invalidated when source changes
COPY . .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
