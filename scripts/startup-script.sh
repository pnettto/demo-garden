#!/bin/bash
export DEBIAN_FRONTEND=noninteractive

# Update and Install Docker/gVisor
apt-get update
apt-get install -y ca-certificates curl gnupg dnsutils
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list
curl -fsSL https://gvisor.dev/archive.key -o /etc/apt/keyrings/gvisor.asc
chmod a+r /etc/apt/keyrings/gvisor.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/gvisor.asc] https://storage.googleapis.com/gvisor/releases release main" | tee /etc/apt/sources.list.d/gvisor.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin runsc

# Init gVisor and Swap
runsc install
systemctl restart docker
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Aliases
cat << 'AL' > /etc/profile.d/docker_aliases.sh
alias dps='docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}"'
alias drs="docker compose --profile '*' down --remove-orphans && docker compose up -d --build --remove-orphans"
AL
