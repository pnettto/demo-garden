# Microservices Demo

This project consists of a Python FastAPI app, a Go worker, a MySQL database, and Caddy as a reverse proxy.

## Project Structure

- `services/python-app`: FastAPI application that interacts with MySQL and the Go worker.
- `services/go-worker`: Go application that performs data processing tasks.
- `docker-compose.yml`: Orchestrates the services.
- `Caddyfile`: Configures the reverse proxy.

## Getting Started

1. Ensure you have Docker and Docker Compose installed.
2. Run `docker compose up -d --build` to start the services.
3. The Python API will be available at `http://localhost/process-data` (proxied by Caddy on port 80).
