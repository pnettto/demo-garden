#!/bin/bash
set -e

# Warning if not privileged (common pitfall for DinD)
if [ ! -w "/sys" ]; then
    echo "WARNING: /sys is not writable. Docker daemon might fail. Run with --privileged."
fi

echo "Starting Docker daemon..."
# Remove pid file if it exists (container restart)
rm -f /var/run/docker.pid

# Start dockerd in background
dockerd > /var/log/dockerd.log 2>&1 &
DOCKER_PID=$!

# Wait for Docker to be ready
echo "Waiting for Docker to be ready..."
timeout=30
while ! docker info >/dev/null 2>&1; do
    timeout=$((timeout - 1))
    if [ $timeout -eq 0 ]; then
        echo "Timed out waiting for Docker to start."
        cat /var/log/dockerd.log
        exit 1
    fi
    sleep 1
done

echo "Docker is running."

# Run the user's command
echo "Executing: $@"
exec "$@"
