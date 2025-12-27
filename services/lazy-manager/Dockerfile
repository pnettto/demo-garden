# Expects a local build
# GOOS=linux GOARCH=amd64 go build -o manager .

FROM alpine:latest
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /app
COPY manager . 
CMD ["./manager"]