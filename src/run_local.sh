#!/bin/bash
set -e

echo "Starting Base VM container..."

docker rm -f demo-garden || true

docker run --privileged -d \
  --cgroupns host \
  -v "$(pwd):/workspace" \
  -v demo-garden-docker-data:/var/lib/docker \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -p 80:80 \
  -p 443:443 \
  --name demo-garden \
  demo-garden-image \
  bash -c "export DOCKER_HOST=unix:///var/run/docker.sock && docker compose --profile lazy build && docker compose up"