FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init go-worker && \
    go mod tidy && \
    go build -o /go-worker main.go

FROM alpine:latest
WORKDIR /app
COPY --from=builder /go-worker .
EXPOSE 8080
CMD ["./go-worker"]