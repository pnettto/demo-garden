#!/bin/bash
set -e

echo "Stopping existing containers..."
docker stop demo-garden 2>/dev/null || true
docker rm demo-garden 2>/dev/null || true

echo "Starting Base VM container..."

docker rm -f demo-garden || true

docker run --privileged -d \
  --cgroupns host \
  -v "$(pwd):/workspace" \
  -e GH_PAT="$GH_PAT" \
  -e GH_ACTOR="$GH_ACTOR" \
  -v demo-garden-docker-data:/var/lib/docker \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -p 80:80 \
  -p 443:443 \
  --name demo-garden \
  demo-garden-image \
  bash -c "echo \$GH_PAT | docker login ghcr.io -u \$GH_ACTOR --password-stdin && \
          docker compose pull && \
          export DOCKER_HOST=unix:///var/run/docker.sock && \ 
          docker compose up -d --no-build --force-recreate --remove-orphans \ 
          docker image prune -f"