FROM debian:bookworm

# 1. Install prerequisites
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    iptables \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# 2. Add Docker's official GPG key and repository
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

# 3. Add gVisor's GPG key and repository
RUN curl -fsSL https://gvisor.dev/archive.key -o /etc/apt/keyrings/gvisor.asc && \
    chmod a+r /etc/apt/keyrings/gvisor.asc && \
    echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/gvisor.asc] https://storage.googleapis.com/gvisor/releases \
    release main" | tee /etc/apt/sources.list.d/gvisor.list > /dev/null

# 4. Install Docker and gVisor
RUN apt-get update && apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    runsc \
    && rm -rf /var/lib/apt/lists/*

# 5. Configure gVisor (runsc) as a runtime
RUN runsc install

# 6. Add convenience aliases from the script
RUN echo 'alias dps="docker ps --format \"table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}\""' >> /root/.bashrc && \
    echo 'alias drs="docker compose --profile '\''*'\'' down --remove-orphans && docker compose up -d --build --remove-orphans"' >> /root/.bashrc

# 7. Setup entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# 8. Define volume for Docker persistence
VOLUME /var/lib/docker

WORKDIR /workspace

# 9. Copy project files (Optional, assuming bind mount for dev, but good for completeness)
COPY . /workspace

# 10. Expose ports for Nginx
EXPOSE 80 443

ENTRYPOINT ["entrypoint.sh"]
# Default command: Start the environment
CMD ["docker", "compose", "up"]
