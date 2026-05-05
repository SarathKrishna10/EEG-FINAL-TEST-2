#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ── EDIT THESE ───────────────────────────────────────────────
const char* ssid      = "Sarath's S20 FE";
const char* password  = "12345678";
const char* serverUrl = "https://eeg-final-test-2-production-e9ea.up.railway.app/eeg/ingest";
// ─────────────────────────────────────────────────────────────

// --- Pins ---
// Single BioAmp EXG Pill on GPIO34 — its output is mirrored to both
// fp1 and fp2 in the batch (set DUAL_AMP=true if you wire a second Pill).
const int FP1_PIN = 34;
const int FP2_PIN = 35;
const int LED_PIN = 2;
const bool DUAL_AMP = false;  // false = single Pill mirrored to both channels

// --- Batch config ---
// Send 32 samples per HTTP request
// At 125Hz, that's one request every ~256ms — stable and efficient
const int BATCH_SIZE   = 32;
const int SAMPLE_DELAY = 8;    // ms — ~125 Hz

// --- State ---
int  fp1Batch[32];
int  fp2Batch[32];
int  batchIdx  = 0;
long sampleCnt = 0;

WiFiClientSecure wifiClient;

// ─────────────────────────────────────────────
void blink(int n, int ms = 120) {
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_PIN, HIGH); delay(ms);
    digitalWrite(LED_PIN, LOW);  delay(ms);
  }
}

void connectWiFi() {
  Serial.printf("\n[WiFi] Connecting to %s", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    if (++tries > 40) {
      Serial.println("\n[WiFi] TIMEOUT — restarting...");
      ESP.restart();
    }
  }

  digitalWrite(LED_PIN, LOW);
  wifiClient.setInsecure(); // Skip SSL verification for Railway HTTPS

  // Force Google + Cloudflare DNS — local ISP/hotspot DNS often fails
  // to resolve newly-generated Railway subdomains for hours.
  IPAddress dns1(8, 8, 8, 8);
  IPAddress dns2(1, 1, 1, 1);
  WiFi.config(WiFi.localIP(), WiFi.gatewayIP(), WiFi.subnetMask(), dns1, dns2);

  Serial.println("\n[WiFi] Connected!");
  Serial.printf("[WiFi] ESP32 IP : %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("[WiFi] Gateway  : %s\n", WiFi.gatewayIP().toString().c_str());
  Serial.printf("[WiFi] DNS1     : %s\n", WiFi.dnsIP(0).toString().c_str());
  Serial.printf("[WiFi] DNS2     : %s\n", WiFi.dnsIP(1).toString().c_str());
  Serial.printf("[WiFi] RSSI     : %d dBm\n", WiFi.RSSI());
  Serial.printf("[WiFi] Server   : %s\n", serverUrl);
  blink(3);
}

void sendBatch() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Lost — reconnecting...");
    connectWiFi();
    return;
  }

  // Build plain text payload: "fp1,fp2\nfp1,fp2\n..."
  String payload = "";
  for (int i = 0; i < BATCH_SIZE; i++) {
    payload += String(fp1Batch[i]) + "," + String(fp2Batch[i]) + "\n";
  }

  HTTPClient http;
  http.begin(wifiClient, serverUrl);
  http.addHeader("Content-Type", "text/plain");
  http.setTimeout(5000); // 5s timeout

  int code = http.POST(payload);

  if (code == 200) {
    // Heartbeat blink every 50 batches (~6 seconds)
    if ((sampleCnt / BATCH_SIZE) % 50 == 0) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    }
  } else if (code > 0) {
    Serial.printf("[HTTP] Error: %d\n", code);
  } else {
    Serial.printf("[HTTP] Failed: %s\n", HTTPClient::errorToString(code).c_str());
    Serial.println("[HTTP] Railway may be sleeping — will retry next batch");
    blink(2, 200);
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  analogSetAttenuation(ADC_11db);
  analogReadResolution(12);

  Serial.println("==========================================");
  Serial.println("  NeuroGuard ESP32 — Direct to Railway");
  Serial.println("  Fp1: GPIO34 | Fp2: GPIO35");
  Serial.println("  Mode: HTTPS batch → Railway AI");
  Serial.println("==========================================");

  connectWiFi();
  digitalWrite(LED_PIN, HIGH); // Solid = ready
  Serial.println("[INFO] Streaming started!");
}

void loop() {
  // Read EEG channels — single-Pill setup mirrors GPIO34 to both columns
  int fp1Sample = analogRead(FP1_PIN);
  int fp2Sample = DUAL_AMP ? analogRead(FP2_PIN) : fp1Sample;
  fp1Batch[batchIdx] = fp1Sample;
  fp2Batch[batchIdx] = fp2Sample;
  batchIdx++;
  sampleCnt++;

  // Send when batch is full
  if (batchIdx >= BATCH_SIZE) {
    batchIdx = 0;
    sendBatch();
  }

  // Serial debug every ~2 seconds
  if (sampleCnt % 256 == 0) {
    Serial.printf("[EEG] #%ld | Fp1:%4d Fp2:%4d | RSSI:%d dBm | Batches:%ld\n",
                  sampleCnt,
                  fp1Batch[0],
                  fp2Batch[0],
                  WiFi.RSSI(),
                  sampleCnt / BATCH_SIZE);
  }

  delay(SAMPLE_DELAY);
}
