FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl gnupg lsb-release && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://get.docker.com | sh

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY manager.py .

CMD ["python", "manager.py"]
