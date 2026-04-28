import asyncio
import socket
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

AI_SERVICE_URL = "http://127.0.0.1:9000"
AI_TCP_HOST    = "127.0.0.1"
AI_TCP_PORT    = 9999

# Persistent TCP connection to AI service
tcp_sock = None

def get_tcp_socket():
    """Get or create a persistent TCP connection to the AI service."""
    global tcp_sock
    try:
        if tcp_sock is not None:
            # Test if still alive
            tcp_sock.sendall(b"")
        return tcp_sock
    except Exception:
        tcp_sock = None

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        s.connect((AI_TCP_HOST, AI_TCP_PORT))
        s.settimeout(None)
        tcp_sock = s
        print(f"[Relay] ✓ TCP connected to AI service on {AI_TCP_HOST}:{AI_TCP_PORT}")
        return tcp_sock
    except Exception as e:
        print(f"[Relay] ✗ TCP connection failed: {e}")
        print(f"[Relay]   Is ai_service.py running on port {AI_TCP_PORT}?")
        tcp_sock = None
        return None

@app.post("/eeg")
async def receive_eeg(request: Request):
    """
    ESP32 posts batches of EEG samples here.
    Format: "fp1,fp2\nfp1,fp2\n..." (multiple lines per request)
    We forward each line over TCP to the AI service.
    """
    global tcp_sock
    body = await request.body()
    lines = body.decode().strip().split('\n')

    sock = get_tcp_socket()
    if sock is None:
        # Try once more
        sock = get_tcp_socket()

    if sock is not None:
        try:
            for line in lines:
                line = line.strip()
                if line:
                    sock.sendall((line + '\n').encode())
        except Exception as e:
            print(f"[Relay] TCP send error: {e} — reconnecting next request")
            try:
                sock.close()
            except Exception:
                pass
            tcp_sock = None

    return {"ok": True}

@app.get("/proxy/{path:path}")
async def proxy_get(path: str, request: Request):
    """Proxy GET requests to AI service REST API."""
    async with httpx.AsyncClient() as client:
        try:
            params = dict(request.query_params)
            r = await client.get(
                f"{AI_SERVICE_URL}/{path}",
                params=params,
                timeout=10.0
            )
            return r.json()
        except Exception as e:
            return {"error": str(e)}

@app.post("/proxy/{path:path}")
async def proxy_post(path: str, request: Request):
    """Proxy POST requests to AI service REST API."""
    body = await request.body()
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                f"{AI_SERVICE_URL}/{path}",
                content=body,
                headers={"Content-Type": "application/json"},
                timeout=20.0
            )
            return r.json()
        except Exception as e:
            return {"error": str(e)}

@app.on_event("startup")
async def startup():
    """Try to connect to AI service TCP on startup."""
    print("[Relay] Connecting to AI service TCP...")
    get_tcp_socket()

@app.on_event("shutdown")
async def shutdown():
    """Close TCP socket on shutdown."""
    global tcp_sock
    if tcp_sock:
        tcp_sock.close()
        tcp_sock = None

if __name__ == "__main__":
    print("=" * 55)
    print("  NeuroGuard Local Relay v2")
    print("  ESP32  → HTTP POST :8888/eeg")
    print("  Relay  → TCP forward to AI service :9999")
    print("  Proxy  → HTTP :8888/proxy/* → AI service :9000")
    print("=" * 55)
    uvicorn.run(app, host="0.0.0.0", port=8888)