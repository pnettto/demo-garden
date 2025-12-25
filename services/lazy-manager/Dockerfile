FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y docker.io curl && rm -rf /var/lib/apt/lists/*
RUN curl -SL https://github.com/docker/compose/releases/download/v2.26.1/docker-compose-linux-aarch64 -o /usr/local/bin/docker-compose && \
    chmod +x /usr/local/bin/docker-compose

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY manager.py .

CMD ["python", "manager.py"]
