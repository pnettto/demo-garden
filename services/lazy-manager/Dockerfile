# 2-step process, build first, then reload docker
# Build command: 
# GOOS=linux go build -o manager main.go
FROM alpine:latest
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /app
COPY manager .
CMD ["./manager"]

# 1-step process, no need to build (happens in docker container)
# FROM golang:1.24-alpine AS builder
# WORKDIR /app
# COPY go.mod go.sum ./
# RUN go mod download
# COPY main.go ./
# RUN CGO_ENABLED=0 GOOS=linux go build -o manager main.go

# # Final stage
# FROM alpine:latest
# # Install docker-cli and compose plugin
# RUN apk add --no-cache docker-cli docker-cli-compose
# WORKDIR /app
# COPY --from=builder /app/manager .
# CMD ["./manager"]