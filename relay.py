import os
import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

AI_SERVICE_URL = "https://eeg-final-test-2-production.up.railway.app"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/eeg")
async def receive_eeg(request: Request):
    body = await request.body()
    payload = body.decode().strip()
    if not payload:
        return {"ok": True, "samples": 0}
    lines = [l.strip() for l in payload.split('\n') if l.strip()]
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{AI_SERVICE_URL}/eeg/ingest",
                content=payload,
                headers={"Content-Type": "text/plain"},
                timeout=3.0
            )
            if r.status_code == 200:
                print(f"[Relay] Forwarded {len(lines)} samples to Railway")
            else:
                print(f"[Relay] Railway returned {r.status_code}")
    except Exception as e:
        print(f"[Relay] Error: {e}")
    return {"ok": True, "samples": len(lines)}

@app.get("/status")
async def relay_status():
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{AI_SERVICE_URL}/health", timeout=5.0)
            return {"relay": "online", "railway_ai": "reachable", "health": r.json()}
    except Exception as e:
        return {"relay": "online", "railway_ai": "unreachable", "error": str(e)}

if __name__ == "__main__":
    print("=" * 55)
    print("  NeuroGuard Relay")
    print(f"  ESP32 -> http://<your-pc-ip>:8888/eeg")
    print(f"  -> {AI_SERVICE_URL}/eeg/ingest")
    print("=" * 55)
    uvicorn.run(app, host="0.0.0.0", port=8888)
