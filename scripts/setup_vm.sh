#!/bin/bash

# Update the local package index to ensure the latest versions are known
sudo apt-get update
# Install prerequisites for downloading and verifying external repositories
sudo apt-get install -y ca-certificates curl gnupg
# Create a directory for storing GPG keys with specific permissions
sudo install -m 0755 -d /etc/apt/keyrings

# Download Docker's official GPG public key for package verification
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
# Ensure the Docker GPG key is readable by all users
sudo chmod a+r /etc/apt/keyrings/docker.asc
# Add the Docker repository to the system sources list using the system's architecture and version
echo \
"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \ 
$(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Download and convert the gVisor GPG key into a format APT can use
sudo curl -fsSL https://gvisor.dev/archive.key -o /etc/apt/keyrings/gvisor.asc
# Ensure the GVisor GPG key is readable by all users
sudo chmod a+r /etc/apt/keyrings/gvisor.asc
# Add the gVisor repository to the system sources list
echo \
"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/gvisor.asc] https://storage.googleapis.com/gvisor/releases \ 
release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null

# Refresh package lists to include the newly added Docker and gVisor repositories
sudo apt-get update
# Install the Docker engine, CLI, container runtime, and the gVisor 'runsc' runtime
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin runsc

# Update the Docker daemon configuration to include gVisor as a known runtime
sudo runsc install
# Restart the Docker service to apply the new runtime configuration
sudo systemctl restart docker

# Add the current user to the 'docker' group to allow running containers without sudo
sudo usermod -aG docker $USER

# Pre-allocate a 2GB file to serve as virtual memory (swap)
sudo fallocate -l 2G /swapfile
# Restrict read/write permissions of the swap file to the root user for security
sudo chmod 600 /swapfile
# Format the allocated file as a Linux swap area
sudo mkswap /swapfile
# Enable the swap file for immediate use by the operating system
sudo swapon /swapfile
# Append the swap file entry to the filesystem table to ensure it persists after reboot
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Start SSL certs
docker compose run --rm --entrypoint "certbot" certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email pedro@pnetto.com \
  --agree-tos \
  --no-eff-email \
  -d demos.pnetto.com
docker compose exec nginx nginx -s reload

# Docker management aliases
cat << 'EOF' >> ~/.bashrc
alias dps='docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}"'
alias drs="docker compose --profile '*' down --remove-orphans && docker compose up -d --build --remove-orphans"
EOF
source ~/.bashrc

echo "VM Prep Complete!"