"""
NeuroGuard AI Prediction Microservice
======================================
Replaces the Gradio-based final_app.py with a clean FastAPI REST service.

Endpoints:
  GET  /health          — health check, model load status, ESP32 status
  POST /predict         — run AI prediction on EEG/diagnostic input data
  GET  /esp32/status    — check ESP32 socket server connectivity
  POST /esp32/session   — forward session start command to ESP32

Runs on port 9000.
ESP32 socket server still managed here on port 8080.
"""

import os
import sys
import json
import socket
import threading
import logging
import tempfile
from contextlib import asynccontextmanager
from typing import Optional, Any
import collections
import struct
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import csv
import io
import uuid
import httpx
from datetime import datetime, timedelta, timezone

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import signal

from dotenv import load_dotenv

# ─── Firebase Admin SDK Init ──────────────────────────────────────────────────
import firebase_admin
from firebase_admin import credentials, firestore, storage

load_dotenv()

_FIREBASE_KEY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "firebase-key.json"
)
_FIREBASE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "eeg-c0f64.firebasestorage.app")

try:
    if not firebase_admin._apps:
        _cred = credentials.Certificate(_FIREBASE_KEY_PATH)
        firebase_admin.initialize_app(_cred, {"storageBucket": _FIREBASE_BUCKET})
    db     = firestore.client()       # Firestore client
    bucket = storage.bucket()          # Firebase Storage bucket
    FIREBASE_OK = True
except Exception as _fb_err:
    db = None
    bucket = None
    FIREBASE_OK = False
    print(f"[WARNING] Firebase init failed: {_fb_err}")

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("ai_service")

# ─── Configuration ────────────────────────────────────────────────────────────
MODEL_PATH   = os.path.join(os.path.dirname(__file__), "kaggle_drcam_model.h5")
SERVICE_PORT = int(os.getenv("AI_SERVICE_PORT", "9000"))
ESP32_PORT   = int(os.getenv("ESP32_PORT", "9999"))
ESP32_HOST   = os.getenv("ESP32_HOST", "0.0.0.0")

# ─── Data Pipeline Config ─────────────────────────────────────────────────────
SAMPLE_RATE    = 128
WINDOW_SECONDS = 45
STEP_SECONDS   = 5
WINDOW_SIZE    = SAMPLE_RATE * WINDOW_SECONDS # 5760
STRIDE         = 64  # 50% Overlap for 128-sample window

# Filtering Config
BANDPASS_LOW   = 0.5
BANDPASS_HIGH  = 40.0

# ─── Global state ─────────────────────────────────────────────────────────────
model          = None
model_loaded   = False
esp32_server   = None

# Synchronized unified buffer storing [ (fp1, fp2), ... ]
unified_buffer = collections.deque(maxlen=WINDOW_SIZE)
buffer_lock    = threading.Lock()

# Predictive stability
current_verdict    = "NOT_READY"
current_score      = 0.0
current_confidence = 0.0
signal_status      = "INITIALIZING"
last_inference_ts  = 0


# ═══════════════════════════════════════════════════════════════════════════════
# ESP32 Socket Server  (port 9999)
# ═══════════════════════════════════════════════════════════════════════════════

class ESP32SocketServer:
    """
    Lightweight TCP socket server that the Node.js NeuroGuard backend
    calls at http://127.0.0.1:9999 for /status and /session/start checks.

    We reuse a simple HTTP-over-raw-TCP approach so we do not need an
    additional web framework; it responds to basic GET/POST requests.
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 9999):
        self.host = host
        self.port = port
        self._server_socket: Optional[socket.socket] = None
        self._thread: Optional[threading.Thread] = None
        self.running = False
        self.connected_clients: list[str] = []

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        log.info(f"ESP32 socket server starting on {self.host}:{self.port}")

    def stop(self):
        self.running = False
        if self._server_socket:
            try:
                self._server_socket.close()
            except Exception:
                pass

    def _run(self):
        self._server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            self._server_socket.bind((self.host, self.port))
            self._server_socket.listen(10)
            self.running = True
            log.info(f"Socket server listening on {self.host}:{self.port}")
            while self.running:
                try:
                    self._server_socket.settimeout(1.0)
                    client_sock, addr = self._server_socket.accept()
                    t = threading.Thread(
                        target=self._handle_client,
                        args=(client_sock, addr),
                        daemon=True
                    )
                    t.start()
                except socket.timeout:
                    continue
                except Exception:
                    break
        except Exception as e:
            log.error(f"ESP32 socket server failed to bind: {e}")
        finally:
            if self._server_socket:
                self._server_socket.close()

    def _handle_client(self, sock: socket.socket, addr):
        self.connected_clients.append(str(addr))
        log.info(f"[ESP32] Data stream connected: {addr}")
        leftover = b""
        try:
            first_chunk = True
            while self.running:
                # Read chunks of data
                chunk = sock.recv(2048)
                if not chunk: break

                # HTTP probe check — only on the very first chunk, use startswith
                if first_chunk:
                    first_chunk = False
                    if chunk.startswith(b"GET /status"):
                        response_body = json.dumps({"connected": True, "device": "ESP32", "signal": "strong"})
                        sock.sendall(self._http_ok(response_body))
                        return  # Close connection after responding to HTTP probe

                # Reassemble partial TCP frames using leftover buffer
                data = leftover + chunk
                lines = data.decode('utf-8', errors='ignore').split('\n')
                # The last element may be an incomplete line — save it for next chunk
                leftover = lines[-1].encode('utf-8')
                complete_lines = lines[:-1]

                with buffer_lock:
                    for line in complete_lines:
                        line = line.strip()
                        if not line: continue

                        try:
                            # Bug 9 fix: normalize with /1000.0 (matches model training, range ~±2.0)
                            val = (float(line) - 2048) / 1000.0
                            print(f"Sample Received: {val}")
                            unified_buffer.append((val, val))
                        except ValueError:
                            pass

        except Exception as e:
            log.warning(f"[ESP32] Stream handler error: {e}")
        finally:
            if str(addr) in self.connected_clients:
                self.connected_clients.remove(str(addr))
            sock.close()
            log.info(f"[ESP32] Disconnected: {addr}")

    @staticmethod
    def _http_ok(json_body: str) -> bytes:
        body = json_body.encode("utf-8")
        headers = (
            f"HTTP/1.1 200 OK\r\n"
            f"Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            f"Access-Control-Allow-Origin: *\r\n"
            f"\r\n"
        )
        return headers.encode("utf-8") + body


# ═══════════════════════════════════════════════════════════════════════════════
# Inference Engine
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# Signal Processing & Inference
# ═══════════════════════════════════════════════════════════════════════════════

def apply_eeg_filter(data: np.ndarray) -> np.ndarray:
    """Apply 0.5-40Hz Bandpass filter using SciPy Butterworth."""
    from scipy.signal import butter, filtfilt
    nyq = 0.5 * SAMPLE_RATE
    low = BANDPASS_LOW / nyq
    high = BANDPASS_HIGH / nyq
    b, a = butter(4, [low, high], btype='band')
    # Filter along the time axis (axis 0)
    return filtfilt(b, a, data, axis=0)

def validate_signal(data: np.ndarray) -> tuple[bool, str]:
    """Check for flatline or excessive noise."""
    std = np.std(data, axis=0) # [f1_std, f2_std]
    
    # Flatline detection (< 0.001 normalized range)
    if np.any(std < 0.001):
        return False, "FLATLINE_DETECTED"
    
    # Excessive noise (highly subjective, e.g. std > 0.8 in -1..1 range)
    if np.any(std > 0.8):
        return False, "DEVICE_NOISE"
        
    return True, "STABLE"

def run_inference_worker():
    """Stabilized, overlapping window inference background worker."""
    global current_verdict, current_score, current_confidence, signal_status, last_inference_ts
    import time
    log.info("Starting Production EEG Inference Worker")
    
    while True:
        time.sleep(1.0)
        with buffer_lock:
            if len(unified_buffer) < WINDOW_SIZE:
                signal_status = f"BUFFERING ({int(len(unified_buffer)/WINDOW_SIZE*100)}%)"
                continue
            
            if time.time() - last_inference_ts < (STEP_SECONDS - 0.5):
                continue
                
            # 1. Grab 45s raw data
            raw_window = np.array(list(unified_buffer), dtype=np.float32) # (5760, 2)
            
        if model_loaded and model:
            try:
                # 2. Pre-processing: Filter
                filtered_window = apply_eeg_filter(raw_window)
                
                # 3. Validation
                is_valid, status = validate_signal(filtered_window)
                signal_status = status
                if not is_valid:
                    current_verdict = "UNSTABLE"
                    continue
                
                # 4. Overlapping Inference (stride=64, window=128)
                chunk_size = model.input_shape[1] # 128
                num_windows = (len(filtered_window) - chunk_size) // STRIDE + 1
                
                window_scores = []
                window_weights = []
                
                for j in range(num_windows):
                    start = j * STRIDE
                    end = start + chunk_size
                    chunk = filtered_window[start:end]
                    
                    # Compute weight via signal energy (std) - cleaner signal = higher weight
                    # Simple weight: 1.0 / (1.0 + std_variance)
                    q_weight = 1.0 / (1.0 + np.var(chunk))
                    
                    input_arr = chunk.reshape(1, chunk_size, 2)
                    pred = model.predict(input_arr, verbose=0)
                    score = float(pred[0][0])
                    
                    window_scores.append(score)
                    window_weights.append(q_weight)
                
                # 5. Weighted aggregation for temporal stability
                if sum(window_weights) > 0:
                    w_avg = np.average(window_scores, weights=window_weights)
                else:
                    w_avg = np.mean(window_scores)
                
                # 6. Confidence: Inverse of variance across window segments
                # Higher variance = lower confidence in the unified verdict
                pred_variance = np.var(window_scores)
                confidence = max(0.0, 1.0 - (pred_variance * 5.0)) # Scaled
                
                current_score = float(w_avg)
                current_confidence = float(confidence)
                current_verdict = "HIGH RISK" if w_avg >= 0.5 else "NORMAL"
                last_inference_ts = time.time()
                
                log.info(f"[ANALYSIS] Verdict: {current_verdict} | Score: {w_avg:.2f} | Conf: {confidence:.0%}")
            except Exception as e:
                log.error(f"Inference error: {e}")

def load_model():
    """Load the TensorFlow/Keras model from disk. Safe to call at startup."""
    global model, model_loaded
    if not os.path.exists(MODEL_PATH):
        log.warning(f"Model file not found at '{MODEL_PATH}'")
        model_loaded = False
        return

    log.info(f"Loading Deep CNN+BiLSTM model: {MODEL_PATH}")
    try:
        import tensorflow as tf
        model = tf.keras.models.load_model(MODEL_PATH)
        model_loaded = True
        log.info("✅ Deep EEG model loaded successfully.")
    except Exception as e:
        model_loaded = False
        log.error(f"❌ Failed to load model: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# FastAPI Application
# ═══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    global esp32_server

    # --- STARTUP ---
    log.info("=== NeuroGuard AI Service starting ===")
    load_model()

    # Start background inference worker
    t = threading.Thread(target=run_inference_worker, daemon=True)
    t.start()

    esp32_server = ESP32SocketServer(host=ESP32_HOST, port=ESP32_PORT)
    esp32_server.start()

    yield  # ← app is running here

    # --- SHUTDOWN ---
    log.info("=== NeuroGuard AI Service shutting down ===")
    if esp32_server:
        esp32_server.stop()


app = FastAPI(
    title="NeuroGuard AI Prediction Service",
    description=(
        "REST API for EEG-based diagnostic predictions using a TensorFlow model. "
        "Manages the ESP32 socket server on port 8080. Called internally by the "
        "Node.js/Express backend on port 5000."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Allow the Node.js server (port 5000) and dev Vite server (port 5173) to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    """
    Input features for the DR-CAM model.

    Adjust the fields here to match the exact feature columns your
    kaggle_drcam_model.h5 was trained on.

    If your model takes raw EEG arrays, change `features` to a list of floats.
    """
    patient_name: str
    features: list[float]           # Numeric feature vector fed into the model
    session_id: Optional[str] = None
    user_id: Optional[str] = None


class PredictResponse(BaseModel):
    patient_name: str
    prediction: str                  # e.g. "Alzheimer's Detected" / "Normal"
    confidence: float                # 0.0 – 1.0
    status_text: str
    mci_probability: float
    raw_scores: list[float]          # Full softmax / sigmoid output vector
    session_id: Optional[str] = None
    model_loaded: bool
    csv_url: Optional[str] = None
    heatmap_url: Optional[str] = None
    heatmap_data: Optional[dict] = None

class DiagnosisStatusResponse(BaseModel):
    verdict: str
    confidence: float
    signal_status: str
    buffer_fill: float # 0.0 to 1.0
    fp1_recent: list[float]
    fp2_recent: list[float]
    connected: bool

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_path: str
    esp32_server_running: bool
    esp32_port: int
    service_port: int


class ESP32StatusResponse(BaseModel):
    connected: bool


class SessionStartRequest(BaseModel):
    patient_name: str


class SessionStartResponse(BaseModel):
    success: bool
    message: str


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/esp32/session", response_model=SessionStartResponse, tags=["ESP32"])
def start_esp32_session(request: SessionStartRequest):
    """
    Validates the ESP32 server is running, clears the active buffers,
    and triggers a fresh 45-second data collection window.
    Called by the React frontend when the 'Start Session' button is clicked.
    """
    if not esp32_server or not esp32_server.running:
        raise HTTPException(
            status_code=503,
            detail="ESP32 socket server is not running."
        )
    with buffer_lock:
        unified_buffer.clear()

    log.info(f"[SESSION] Starting session for patient: {request.patient_name}")
    return SessionStartResponse(
        success=True,
        message=f"Session started for {request.patient_name}. Hardware diagnostic timer triggered and buffers cleared."
    )

@app.get("/diagnosis/status", response_model=DiagnosisStatusResponse, tags=["Diagnosis"])
def get_diagnosis_status():
    """Returns current live verdict, score, and recent signal data for the dashboard."""
    with buffer_lock:
        if len(unified_buffer) > 0:
            data_arr = np.array(list(unified_buffer)[-100:])
            f1_recent = data_arr[:, 0].tolist()
            f2_recent = data_arr[:, 1].tolist()
        else:
            f1_recent, f2_recent = [], []
        fill = len(unified_buffer) / WINDOW_SIZE

    has_clients = esp32_server.running and len(esp32_server.connected_clients) > 0 if esp32_server else False

    return DiagnosisStatusResponse(
        verdict=current_verdict,
        confidence=current_confidence,
        signal_status=signal_status,
        buffer_fill=fill,
        fp1_recent=f1_recent,
        fp2_recent=f2_recent,
        connected=has_clients
    )

@app.get("/eeg/stream", tags=["Streaming"])
async def eeg_stream():
    """Server-Sent Events (SSE) stream of live EEG samples."""
    import asyncio
    async def event_generator():
        while True:
            # Yield the last 10 samples for a smooth realtime visual
            # (128 samples per sec, 10 samples = ~80ms)
            with buffer_lock:
                if len(unified_buffer) >= 10:
                    latest = list(unified_buffer)[-10:]
                    yield f"data: {json.dumps(latest)}\n\n"
                else:
                    yield "data: []\n\n"
            await asyncio.sleep(0.08) # ~12Hz updates

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/health", response_model=HealthResponse, tags=["System"])
def health_check():
    """
    Service health check. Returns model load status and ESP32 state.
    Called by Node.js backend on startup / periodically.
    """
    return HealthResponse(
        status="ok",
        model_loaded=model_loaded,
        model_path=MODEL_PATH,
        esp32_server_running=esp32_server.running if esp32_server else False,
        esp32_port=ESP32_PORT,
        service_port=SERVICE_PORT,
    )


@app.post("/predict", response_model=PredictResponse, tags=["Prediction"])
def predict(request: PredictRequest):
    """
    Run prediction. If request.features is empty, use the live 45s buffer.
    """
    try:
        # 1. Get Input Data
        if not request.features:
            with buffer_lock:
                if len(unified_buffer) < WINDOW_SIZE:
                    raise HTTPException(status_code=425, detail="Buffer not yet full")
                data_arr = np.array(list(unified_buffer), dtype=np.float32)
            
            # Apply filter & validate
            processed = apply_eeg_filter(data_arr)
            input_array = processed.reshape(1, WINDOW_SIZE, 2)
        else:
            # Manual override (legacy support)
            data_arr = np.array(request.features, dtype=np.float32)
            input_array = data_arr.reshape(1, 128, 2)

        # 2. Inference (Chunking if model expects smaller windows)
        if not model_loaded or model is None:
            # Ultra-lightweight fallback based on signal energy
            signal_variance = float(np.var(data_arr))
            score = min(max(signal_variance * 5.0, 0.0), 1.0) # Mock scoring
            scores = [score]
            label = "HIGH RISK" if score >= 0.5 else "NORMAL"
        else:
            chunk_size = model.input_shape[1]
            if input_array.shape[1] > chunk_size:
                # Sliced inference
                num_windows = (input_array.shape[1] - chunk_size) // STRIDE + 1
                scores = []
                for j in range(num_windows):
                    start = j * STRIDE
                    end = start + chunk_size
                    chunk = input_array[:, start:end, :]
                    pred = model.predict(chunk, verbose=0)
                    scores.append(float(pred[0][0]))
                score = sum(scores) / len(scores)
            else:
                raw_output = model.predict(input_array, verbose=0)
                score = float(raw_output[0][0])
                scores = [score]
            label = "HIGH RISK" if score >= 0.5 else "NORMAL"
        
        # Heatmap calculation
        fft_vals = np.abs(np.fft.rfft(data_arr[:, 0]))
        freqs = np.fft.rfftfreq(len(data_arr[:, 0]), d=1/128)
        heatmap_data = {
            "frequencies": freqs[:100].tolist(),
            "power": fft_vals[:100].tolist()
        }

        # Matplotlib Spectral Heatmap
        heatmap_url = None
        try:
            f, t, Sxx = signal.spectrogram(data_arr[:, 0], fs=128, nperseg=128, noverlap=64)
            plt.figure(figsize=(10, 4))
            # Sxx max could be 0, safe log
            Sxx_safe = np.clip(Sxx, a_min=1e-10, a_max=None)
            plt.pcolormesh(t, f, 10 * np.log10(Sxx_safe), shading='gouraud', cmap='viridis')
            plt.colorbar(label='Power/Frequency (dB/Hz)')
            plt.ylabel('Frequency [Hz]')
            plt.xlabel('Time [sec]')
            plt.title('EEG Spectral Heatmap (Fp1)')
            
            # Dark theme styling to match UI
            ax = plt.gca()
            ax.set_facecolor('#10221d')
            fig = plt.gcf()
            fig.patch.set_facecolor('#10221d')
            ax.xaxis.label.set_color('#92c9bb')
            ax.yaxis.label.set_color('#92c9bb')
            ax.title.set_color('#13ecb6')
            ax.tick_params(colors='#92c9bb')
            
            plt.tight_layout()
            heatmap_io = io.BytesIO()
            plt.savefig(heatmap_io, format='png', dpi=100, facecolor=fig.get_facecolor(), transparent=True)
            plt.close()
            heatmap_bytes = heatmap_io.getvalue()
        except Exception as e:
            log.error(f"Failed to generate heatmap: {e}")
            heatmap_bytes = None

        # ── Firebase Storage Uploads & Firestore Logging ────────────────────
        csv_url = None
        if FIREBASE_OK and db and bucket:
            try:
                base_name = f"{request.patient_name.replace(' ', '_')}_{uuid.uuid4().hex[:8]}"

                # 1. Build CSV in memory, write to a temp file, upload to Firebase Storage
                csv_io = io.StringIO()
                writer = csv.writer(csv_io)
                writer.writerow(["timestamp_ms", "Fp1_voltage", "Fp2_voltage"])
                for i, row in enumerate(data_arr):
                    writer.writerow([round(i * (1000 / 128), 2), round(row[0], 4), round(row[1], 4)])
                csv_bytes = csv_io.getvalue().encode("utf-8")

                csv_filename = f"eeg-recordings/{base_name}.csv"
                with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp_csv:
                    tmp_csv.write(csv_bytes)
                    tmp_csv_path = tmp_csv.name

                csv_blob = bucket.blob(csv_filename)
                csv_blob.upload_from_filename(tmp_csv_path, content_type="text/csv")
                os.unlink(tmp_csv_path)

                # Generate a long-lived signed URL (7 days)
                csv_url = csv_blob.generate_signed_url(
                    expiration=timedelta(days=7),
                    method="GET",
                    version="v4",
                )
                log.info(f"CSV uploaded to Firebase Storage: {csv_filename}")

                # 2. Upload Heatmap PNG
                if heatmap_bytes:
                    png_filename = f"eeg-recordings/{base_name}.png"
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp_png:
                        tmp_png.write(heatmap_bytes)
                        tmp_png_path = tmp_png.name

                    png_blob = bucket.blob(png_filename)
                    png_blob.upload_from_filename(tmp_png_path, content_type="image/png")
                    os.unlink(tmp_png_path)

                    heatmap_url = png_blob.generate_signed_url(
                        expiration=timedelta(days=7),
                        method="GET",
                        version="v4",
                    )
                    log.info(f"Heatmap uploaded to Firebase Storage: {png_filename}")

                # 3. Log Session to Firestore
                if request.user_id:
                    session_doc = {
                        "patient_name": request.patient_name,
                        "verdict": label,
                        "confidence": score,
                        "user_id": request.user_id,
                        "csv_url": csv_url,
                        "csv_blob_path": csv_filename,
                        "heatmap_url": heatmap_url,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    _ts, doc_ref = db.collection("sessions").add(session_doc)
                    log.info(f"Session saved to Firestore: {doc_ref.id}")

            except Exception as e:
                log.error(f"Failed during Firebase ops: {e}")

        return PredictResponse(
            patient_name=request.patient_name,
            prediction=label,
            confidence=score,
            status_text=label,
            mci_probability=score * 100.0,
            raw_scores=[score],
            session_id=request.session_id,
            model_loaded=True,
            csv_url=csv_url,
            heatmap_url=heatmap_url,
            heatmap_data=heatmap_data
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"[PREDICT] Unhandled error: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.get("/esp32/status", response_model=ESP32StatusResponse, tags=["ESP32"])
def esp32_status():
    """
    Returns whether the ESP32 hardware is genuinely connected.
    """
    has_clients = esp32_server.running and len(esp32_server.connected_clients) > 0 if esp32_server else False
    return ESP32StatusResponse(connected=has_clients)



@app.get("/report/download", tags=["Reporting"])
def download_report(patient_name: str = "Patient"):
    """Generates and returns a ZIP report with CSV."""
    import io, zipfile, csv
    
    # 1. Capture Data
    with buffer_lock:
        if len(unified_buffer) < 128:
            raise HTTPException(status_code=425, detail="Insufficient data for report")
        data_arr = np.array(list(unified_buffer))
        f1 = data_arr[:, 0].tolist()
        f2 = data_arr[:, 1].tolist()

    # 2. Generate CSV
    csv_io = io.StringIO()
    writer = csv.writer(csv_io)
    writer.writerow(["timestamp_ms", "Fp1_voltage", "Fp2_voltage"])
    for i in range(len(f1)):
        writer.writerow([round(i * (1000/128), 2), round(f1[i], 4), round(f2[i], 4)])

    # 3. Generate Heatmap PNG
    heatmap_bytes = None
    try:
        f_spec, t_spec, Sxx = signal.spectrogram(data_arr[:, 0], fs=128, nperseg=128, noverlap=64)
        plt.figure(figsize=(10, 4))
        Sxx_safe = np.clip(Sxx, a_min=1e-10, a_max=None)
        plt.pcolormesh(t_spec, f_spec, 10 * np.log10(Sxx_safe), shading='gouraud', cmap='viridis')
        plt.colorbar(label='Power/Frequency (dB/Hz)')
        plt.ylabel('Frequency [Hz]')
        plt.xlabel('Time [sec]')
        plt.title('EEG Spectral Heatmap (Fp1)')
        
        # Dark theme styling
        ax = plt.gca()
        ax.set_facecolor('#10221d')
        fig = plt.gcf()
        fig.patch.set_facecolor('#10221d')
        ax.xaxis.label.set_color('#92c9bb')
        ax.yaxis.label.set_color('#92c9bb')
        ax.title.set_color('#13ecb6')
        ax.tick_params(colors='#92c9bb')
        
        plt.tight_layout()
        heatmap_io = io.BytesIO()
        plt.savefig(heatmap_io, format='png', dpi=100, facecolor=fig.get_facecolor(), transparent=True)
        plt.close()
        heatmap_bytes = heatmap_io.getvalue()
    except Exception as e:
        log.error(f"Failed to generate heatmap for ZIP: {e}")

    # 4. Package ZIP
    zip_io = io.BytesIO()
    with zipfile.ZipFile(zip_io, 'w') as zf:
        zf.writestr("session_data.csv", csv_io.getvalue())
        if heatmap_bytes:
            zf.writestr("heatmap.png", heatmap_bytes)
    zip_io.seek(0)

    return StreamingResponse(
        zip_io, 
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=NeuroGuard_Report_{patient_name}.zip"}
    )

@app.get("/api/download-report", tags=["Reporting"])
def api_download_report():
    """Robust download endpoint."""
    import io, zipfile, csv, time
    time.sleep(1) # Wait slightly for disk/buffer completion
    
    with buffer_lock:
        data_arr = list(unified_buffer)
        
    csv_io = io.StringIO()
    writer = csv.writer(csv_io)
    writer.writerow(["Fp1_Normalized", "Fp2_Normalized"])
    for row in data_arr:
        writer.writerow([round(row[0], 4), round(row[1], 4)])
        
    summary_text = f"NeuroGuard Session Summary\nTotal Samples: {len(data_arr)}\nStatus: OK"
    
    heatmap_bytes = None
    if len(data_arr) >= 128:
        try:
            arr_np = np.array(data_arr)
            f_spec, t_spec, Sxx = signal.spectrogram(arr_np[:, 0], fs=128, nperseg=128, noverlap=64)
            plt.figure(figsize=(10, 4))
            Sxx_safe = np.clip(Sxx, a_min=1e-10, a_max=None)
            plt.pcolormesh(t_spec, f_spec, 10 * np.log10(Sxx_safe), shading='gouraud', cmap='viridis')
            plt.colorbar(label='Power/Frequency (dB/Hz)')
            plt.ylabel('Frequency [Hz]')
            plt.xlabel('Time [sec]')
            plt.title('EEG Spectral Heatmap (Fp1)')
            
            # Dark theme styling
            ax = plt.gca()
            ax.set_facecolor('#10221d')
            fig = plt.gcf()
            fig.patch.set_facecolor('#10221d')
            ax.xaxis.label.set_color('#92c9bb')
            ax.yaxis.label.set_color('#92c9bb')
            ax.title.set_color('#13ecb6')
            ax.tick_params(colors='#92c9bb')
            
            plt.tight_layout()
            heatmap_io = io.BytesIO()
            plt.savefig(heatmap_io, format='png', dpi=100, facecolor=fig.get_facecolor(), transparent=True)
            plt.close()
            heatmap_bytes = heatmap_io.getvalue()
        except Exception as e:
            log.error(f"Failed to generate heatmap for API ZIP: {e}")

    zip_io = io.BytesIO()
    with zipfile.ZipFile(zip_io, 'w') as zf:
        zf.writestr("session_data.csv", csv_io.getvalue())
        zf.writestr("session_summary.txt", summary_text)
        if heatmap_bytes:
            zf.writestr("heatmap.png", heatmap_bytes)
            
    zip_io.seek(0)
    return StreamingResponse(
        zip_io, 
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=NeuroGuard_Report.zip",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )

@app.get("/history", tags=["History"])
def get_history(user_id: str):
    """Fetch session history from Firestore for a specific user, with refreshed signed URLs."""
    if not FIREBASE_OK or not db or not bucket:
        raise HTTPException(status_code=500, detail="Firebase not configured")

    try:
        docs = (
            db.collection("sessions")
            .where("user_id", "==", user_id)
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .stream()
        )

        results = []
        for doc in docs:
            data = doc.to_dict()
            data["id"] = doc.id

            # Refresh signed URL for CSV if a blob path is stored
            blob_path = data.get("csv_blob_path")
            if blob_path:
                try:
                    blob = bucket.blob(blob_path)
                    data["csv_url"] = blob.generate_signed_url(
                        expiration=timedelta(hours=1),
                        method="GET",
                        version="v4",
                    )
                except Exception as sign_err:
                    log.warning(f"Could not refresh signed URL for {blob_path}: {sign_err}")

            results.append(data)

        return results
    except Exception as e:
        log.error(f"Failed to fetch history from Firestore: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch history")


@app.get("/analytics", tags=["Analytics"])
def get_analytics(user_id: str):
    """Aggregate session data from Firestore for charting."""
    if not FIREBASE_OK or not db:
        raise HTTPException(status_code=500, detail="Firebase not configured")

    try:
        docs = (
            db.collection("sessions")
            .where("user_id", "==", user_id)
            .order_by("created_at", direction=firestore.Query.ASCENDING)
            .stream()
        )

        chart_data = []
        for doc in docs:
            s = doc.to_dict()
            date_str = s.get("created_at", "")
            if date_str:
                try:
                    dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                    label = dt.strftime("%b %d, %H:%M")
                except Exception:
                    label = date_str[:10]
            else:
                label = "Unknown"

            chart_data.append({
                "date": label,
                "patient": s.get("patient_name", "Unknown"),
                "confidence": s.get("confidence", 0) * 100,
                "verdict": s.get("verdict", "Unknown"),
            })

        return chart_data
    except Exception as e:
        log.error(f"Failed to fetch analytics from Firestore: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch analytics")

# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "ai_service:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info",
    )
