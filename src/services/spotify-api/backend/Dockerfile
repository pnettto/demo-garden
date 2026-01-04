FROM denoland/deno:debian

WORKDIR /app

# Not really needed, just to be explicit
ENV DENO_DIR=/deno-dir

COPY deno.json* deno.lock* ./
RUN --mount=type=cache,target=/deno-dir \
    deno install --entrypoint deno.json

COPY . .

RUN --mount=type=cache,target=/deno-dir \
    deno cache --reload main.ts

EXPOSE 8000

CMD ["run", "--allow-net", "--allow-read", "--allow-write=./db", "--allow-env", "--unstable-kv", "main.ts"]