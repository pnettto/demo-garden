FROM denoland/deno:debian

RUN apt-get update && apt-get install -y \
    python3 \
    nodejs \
    sqlite3 \
    bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY main.ts .

RUN deno cache main.ts

EXPOSE 8000
CMD ["run", "--allow-net", "--allow-run", "--allow-env", "main.ts"]