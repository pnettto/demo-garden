FROM denoland/deno:debian
WORKDIR /app
COPY . .
RUN deno cache main.ts
EXPOSE 8000
CMD ["run", "--allow-net", "--allow-read", "main.ts"]
