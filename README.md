# Microservices Demo

This project consists of a Python FastAPI app, a Go worker, a MySQL database, and Caddy as a reverse proxy.

## Project Structure

- `services/python-app`: FastAPI application that interacts with MySQL and the Go worker.
- `services/go-worker`: Go application that performs data processing tasks.
- `docker-compose.yml`: Orchestrates the services.
- `Caddyfile`: Configures the reverse proxy.

## Deployment to GCP VM (e2-micro)

This project is configured to deploy automatically via GitHub Actions.

### 1. VM Preparation

Run the setup script on your VM to install Docker and configure swap space:

```bash
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/scripts/setup_vm.sh
chmod +x setup_vm.sh
./setup_vm.sh
```

### 2. GitHub Secrets

Add the following secrets to your GitHub repository (`Settings > Secrets and variables > Actions`):

- `VM_IP`: The public IP of your GCP VM.
- `VM_USER`: The username for SSH access (e.g., `pedronetto`).
- `SSH_PRIVATE_KEY`: Your private SSH key (generated via `ssh-keygen`). Ensure the public key is in `~/.ssh/authorized_keys` on the VM.

### 3. Automatic Deployment

Every push to the `main` branch will trigger the deployment workflow, which pulls the latest code and restarts the containers using `docker compose up -d --build`.

### Local Testing

```bash
docker compose up -d --build
# Access at http://localhost/process-data (locally)
# Production: https://demos.pnetto.com/process-data
```
