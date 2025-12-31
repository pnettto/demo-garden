FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init parallelism-worker && \
    go mod tidy && \
    go build -o /parallelism-worker main.go

FROM alpine:latest
WORKDIR /app
COPY --from=builder /parallelism-worker .
EXPOSE 8000
CMD ["./parallelism-worker"]