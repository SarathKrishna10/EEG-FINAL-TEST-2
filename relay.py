import os
import uvicorn
import firebase_admin
from firebase_admin import firestore
from fastapi import FastAPI, Request, HTTPException
import requests

app = FastAPI()

# Initialize Firebase Admin SDK
if not firebase_admin._apps:
    firebase_admin.initialize_app()

db = firestore.client()
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL")

@app.post("/eeg/ingest")
async def ingest_eeg(request: Request):
    try:
        # Read incoming raw body
        body = await request.body()
        data_line = body.decode().strip()
        
        # 1. Update system status in Firestore
        db.collection("systems").document("current_status").set({
            "status": "online",
            "last_active": firestore.SERVER_TIMESTAMP
        }, merge=True)
        
        # 2. Forward single-channel data to AI Service
        if AI_SERVICE_URL:
            requests.post(
                f"{AI_SERVICE_URL}/eeg/ingest",
                data=data_line,
                headers={"Content-Type": "text/plain"},
                timeout=3
            )
            
        return {"status": "success", "message": "Data processed"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)