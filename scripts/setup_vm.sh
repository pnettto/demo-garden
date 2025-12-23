#!/bin/bash

# 1. Update and Install Docker
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
sudo apt-get update
sudo apt-get install -y docker-ce docker-compose-plugin

# 2. Add current user to docker group
sudo usermod -aG docker $USER

# 3. CRITICAL: Create Swap File for e2-micro (1GB RAM is not enough for building)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

echo "VM Prep Complete! Please log out and back in for docker group changes to take effect."
