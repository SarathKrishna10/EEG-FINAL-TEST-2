import os
import asyncio
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ FIX: Point to the AI service's actual Railway public URL
# Set this as an environment variable in Railway dashboard:
# AI_SERVICE_URL = https://your-ai-service.up.railway.app
AI_SERVICE_URL = os.environ.get("AI_SERVICE_URL", "http://localhost:9000")

print(f"[Relay] AI Service URL: {AI_SERVICE_URL}")


@app.post("/eeg")
async def receive_eeg(request: Request):
    """
    ESP32 posts batches of EEG samples here.
    Format: "value\nvalue\n..." (one raw ADC integer per line).

    All lines are forwarded as a single batched POST to /eeg/ingest on the
    AI service.  Batching keeps the per-request HTTP overhead low even at
    128 Hz — the ESP32 typically sends 8-32 samples per POST, not one at a
    time, so a single forwarding call is sufficient.
    """
    body = await request.body()
    text = body.decode("utf-8", errors="ignore").strip()

    if not text:
        return {"ok": True, "accepted": 0}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f"{AI_SERVICE_URL}/eeg/ingest",
                content=text.encode("utf-8"),
                headers={"Content-Type": "text/plain"},
            )
            result = r.json() if r.status_code == 200 else {"ok": False, "status": r.status_code}
    except Exception as e:
        print(f"[Relay] ✗ Failed to forward to AI service: {e}")
        return {"ok": False, "error": str(e)}

    return result


@app.get("/proxy/{path:path}")
async def proxy_get(path: str, request: Request):
    """Proxy GET requests to AI service REST API."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            params = dict(request.query_params)
            r = await client.get(f"{AI_SERVICE_URL}/{path}", params=params)
            return r.json()
        except Exception as e:
            print(f"[Relay] Proxy GET error: {e}")
            return {"error": str(e)}


@app.post("/proxy/{path:path}")
async def proxy_post(path: str, request: Request):
    """Proxy POST requests to AI service REST API."""
    body = await request.body()
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            r = await client.post(
                f"{AI_SERVICE_URL}/{path}",
                content=body,
                headers={"Content-Type": "application/json"}
            )
            return r.json()
        except Exception as e:
            print(f"[Relay] Proxy POST error: {e}")
            return {"error": str(e)}


@app.get("/health")
async def health():
    """Check relay health and AI service reachability."""
    ai_ok = False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{AI_SERVICE_URL}/health")
            ai_ok = r.status_code == 200
    except Exception:
        pass
    return {
        "relay": "ok",
        "ai_service_url": AI_SERVICE_URL,
        "ai_service_reachable": ai_ok
    }


async def handle_tcp_connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    addr = writer.get_extra_info('peername')
    print(f"[Relay TCP] Connection established from {addr}")
    
    # We can reuse a single client session per TCP connection for efficiency,
    # or just create a new one. Creating one for the lifetime of the connection is better.
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            while True:
                data = await reader.readline()
                if not data:
                    break
                
                line = data.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                
                try:
                    await client.post(
                        f"{AI_SERVICE_URL}/eeg/ingest",
                        content=(line + '\n').encode("utf-8"),
                        headers={"Content-Type": "text/plain"}
                    )
                except httpx.RequestError as exc:
                    print(f"[Relay TCP] ✗ Failed to forward to AI service: {exc}")
        except Exception as e:
            print(f"[Relay TCP] Connection error: {e}")
        finally:
            print(f"[Relay TCP] Connection closed from {addr}")
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass


@app.on_event("startup")
async def startup_event():
    tcp_port = int(os.environ.get("TCP_PORT", "9999"))
    server = await asyncio.start_server(handle_tcp_connection, '0.0.0.0', tcp_port)
    print(f"[Relay] TCP server listening on 0.0.0.0:{tcp_port}")
    asyncio.create_task(server.serve_forever())


if __name__ == "__main__":
    _relay_port = int(os.environ.get("PORT", "8888"))
    print("=" * 55)
    print("  NeuroGuard Cloud Relay v3")
    print(f"  ESP32  → HTTP POST :{_relay_port}/eeg")
    print(f"  Relay  → HTTP forward to {AI_SERVICE_URL}/eeg/ingest")
    print(f"  Proxy  → :{_relay_port}/proxy/* → {AI_SERVICE_URL}")
    print("=" * 55)
    uvicorn.run(app, host="0.0.0.0", port=_relay_port)
