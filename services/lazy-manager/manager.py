import os
import time
import asyncio
import threading
import subprocess
import docker
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
from typing import Dict

app = FastAPI()
client = docker.from_env()

PROJECT_NAME = os.getenv("PROJECT_NAME", "demos")
APP_DIR = os.getenv("APP_DIR", "/app-dir")
IDLE_TIMEOUT = int(os.getenv("IDLE_TIMEOUT", "10"))

# State tracking for multiple services
service_activity: Dict[str, float] = {}
service_request_count: Dict[str, int] = {}
service_locks: Dict[str, asyncio.Lock] = {}
stats_lock = threading.Lock()
locks_registry_lock = threading.Lock()

def get_service_lock(service_name: str) -> asyncio.Lock:
    with locks_registry_lock:
        if service_name not in service_locks:
            service_locks[service_name] = asyncio.Lock()
        return service_locks[service_name]

def update_activity(service_name: str, delta: int):
    global service_activity, service_request_count
    with stats_lock:
        service_request_count[service_name] = service_request_count.get(service_name, 0) + delta
        service_activity[service_name] = time.time()

def get_container(service_name: str):
    try:
        for container in client.containers.list(all=True):
            if container.labels.get('com.docker.compose.service') == service_name:
                return container
    except Exception as e:
        print(f"Error finding container {service_name}: {e}", flush=True)
    return None

async def ensure_service_running(service_name: str):
    container = get_container(service_name)
    if not container or container.status != "running":
        async with get_service_lock(service_name):
            # Re-check status inside lock
            container = get_container(service_name)
            if not container or container.status != "running":
                print(f"Starting service: {service_name}", flush=True)
                subprocess.run(
                    ["docker-compose", "-p", PROJECT_NAME, "up", "-d", service_name],
                    cwd=APP_DIR,
                    check=True
                )
                
                # Wait for container to be ready
                for _ in range(30):
                    container = get_container(service_name)
                    if container and container.status == "running":
                        await asyncio.sleep(2) # Grace period
                        break
                    await asyncio.sleep(1)
                else:
                    raise Exception(f"Service {service_name} failed to start")

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy(request: Request, path: str):
    target_service = request.headers.get("x-target-service")
    target_port = request.headers.get("x-target-port")
    
    if not target_service or not target_port:
        return Response(content="Missing X-Target-Service or X-Target-Port headers", status_code=400)

    update_activity(target_service, 1)
    try:
        await ensure_service_running(target_service)
        
        url = f"http://{target_service}:{target_port}/{path}"
        
        # Force raw responses from backend to avoid compression issues in proxy
        method = request.method
        headers = dict(request.headers)
        headers.pop("host", None)
        headers.pop("x-target-service", None)
        headers.pop("x-target-port", None)
        headers.pop("accept-encoding", None) 
        
        body = await request.body()
        
        async with httpx.AsyncClient() as client_http:
            try:
                # Forward request and get response
                # httpx decompresses by default, which is what we want for simplicity
                response = await client_http.request(
                    method,
                    url,
                    headers=headers,
                    content=body,
                    params=request.query_params,
                    timeout=60.0
                )
                
                # Filter headers
                resp_headers = {}
                excluded_headers = [
                    "connection", "keep-alive", "proxy-authenticate", 
                    "proxy-authorization", "te", "trailers", 
                    "transfer-encoding", "upgrade",
                    "content-encoding", "content-length" # Let FastAPI handle these
                ]
                for name, value in response.headers.items():
                    if name.lower() not in excluded_headers:
                        resp_headers[name] = value
                
                return Response(
                    content=response.content,
                    status_code=response.status_code,
                    headers=resp_headers
                )
            except Exception as e:
                print(f"Error proxying to {target_service}: {e}", flush=True)
                return Response(content=f"Proxy error for {target_service}: {str(e)}", status_code=502)
    finally:
        update_activity(target_service, -1)

def monitor_services():
    while True:
        # Check again every 10 seconds
        time.sleep(10)
        now = time.time()
        
        # Discover containers with the 'lazy=true' label
        try:
            for container in client.containers.list():
                labels = container.labels
                service_name = labels.get('com.docker.compose.service')
                
                if labels.get('lazy') == 'true' and service_name:
                    with stats_lock:
                        # Only track if not already being tracked
                        if service_name not in service_activity:
                            print(f"Discovered lazy service: {service_name}, starting idle timer", flush=True)
                            service_activity[service_name] = now
        except Exception as e:
            print(f"Monitor discovery error: {e}", flush=True)

        with stats_lock:
            # Create a list of candidates to avoid resizing dict during iteration
            for service_name, last_active in list(service_activity.items()):
                # Skip if we are currently handling a request (last_active might be old, 
                # but request_count ensures safety)
                count = service_request_count.get(service_name, 0)
                if count > 0:
                    continue
                    
                idle_time = now - last_active
                if idle_time > IDLE_TIMEOUT:
                    container = get_container(service_name)
                    if container:
                        if container.status == "running":
                            print(f"Idle timeout reached ({idle_time:.1f}s > {IDLE_TIMEOUT}s). Stopping lazy service {service_name}...", flush=True)
                            try:
                                container.stop(timeout=10)
                                print(f"Stopped {service_name}", flush=True)
                            except Exception as e:
                                print(f"Error stopping {service_name}: {e}", flush=True)
                        else:
                            # Container is already stopped/exited, we can stop tracking it
                            del service_activity[service_name]
                    else:
                        # Container not found, stop tracking
                        del service_activity[service_name]

if __name__ == "__main__":
    threading.Thread(target=monitor_services, daemon=True).start()
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
