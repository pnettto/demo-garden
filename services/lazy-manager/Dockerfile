FROM python:3.11-slim AS deps
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
RUN apt-get update && apt-get install -y curl gnupg lsb-release && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://get.docker.com | sh
COPY manager.py .
CMD ["python", "manager.py"]
