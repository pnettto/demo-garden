FROM denoland/deno:bin AS deno_bin
FROM node:20-slim AS node_bin

FROM debian:bookworm-slim

COPY --from=deno_bin /deno /usr/local/bin/deno
COPY --from=node_bin /usr/local/bin/node /usr/local/bin/node

RUN apt-get update && apt-get install -y \
    python3-minimal \
    sqlite3 \
    bash \
    bubblewrap \
    && rm -rf /var/lib/apt/lists/*

# Create user and directories
RUN groupadd -r deno && \
    useradd -m -r -g deno deno && \
    mkdir -p /opt/app /workspace && \
    chown deno:deno /opt/app /workspace

# Set app directory
WORKDIR /opt/app

# Cache deps only (if you have imports)
COPY deps.ts .
ENV DENO_DIR=/v8cache
RUN mkdir -p $DENO_DIR && chown deno:deno $DENO_DIR
USER deno
RUN deno cache deps.ts

# Copy app LAST so Docker invalidates on change
COPY main.ts .

EXPOSE 8000

CMD ["deno", "run", \
    "--allow-net=:8000", \
    "--allow-run", \
    "--allow-env", \
    "--allow-write=/tmp,/workspace", \
    "--allow-read=/lib64,/tmp,/workspace,/opt/app,/lib64", \
    "/opt/app/main.ts"]