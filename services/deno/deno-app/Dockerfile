FROM denoland/deno:debian
WORKDIR /app
COPY main.ts .
RUN deno cache main.ts
COPY . .
EXPOSE 8000
CMD ["run", "--allow-net", "--allow-read", "main.ts"]
