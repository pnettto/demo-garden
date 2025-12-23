FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod init go-worker || true # Initialize if not already, ignore if it is.
RUN go mod tidy
RUN go build -o /go-worker main.go

FROM alpine:latest
WORKDIR /app
COPY --from=builder /go-worker .
EXPOSE 8080
CMD ["./go-worker"]
