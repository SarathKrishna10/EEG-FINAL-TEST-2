# ESP32 Firmware — Deployment Update Guide

This document describes the changes needed in your Arduino sketch to connect the
ESP32 to the **deployed** NeuroGuard relay service instead of a local IP address.

---

## 1 · Change the POST target URL

Find the section in your `.ino` file that sends EEG data and replace the local IP
with the public HTTPS URL of your Render-hosted relay.

```cpp
// ── BEFORE (local network) ────────────────────────────────────────────────────
const char* serverUrl = "http://192.168.x.x:8888/eeg";

// ── AFTER (deployed Render service) ───────────────────────────────────────────
const char* serverUrl = "https://<your-render-app>.onrender.com/eeg";
```

> **Replace** `<your-render-app>` with the actual subdomain shown in your Render
> dashboard, e.g. `neuroguard-relay.onrender.com`.

---

## 2 · Enable HTTPS / SSL

Render serves all apps over HTTPS. The standard `HTTPClient` on ESP32 can verify
the server certificate or skip verification for simplicity during development.

### Option A — Skip certificate verification (quick, development only)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// In your loop / send function:
WiFiClientSecure client;
client.setInsecure();           // ← disables cert verification

HTTPClient http;
http.begin(client, "https://<your-render-app>.onrender.com/eeg");
http.addHeader("Content-Type", "text/plain");

String payload = String(fp1) + "," + String(fp2) + "\n";
int httpCode = http.POST(payload);
http.end();
```

### Option B — Pin the server's root CA (recommended for production)

1. Obtain Render's root CA certificate (Let's Encrypt ISRG Root X1).
2. Store it as a `const char*` in your sketch.
3. Call `client.setCACert(rootCACertificate)` instead of `client.setInsecure()`.

```cpp
const char* rootCACertificate = R"EOF(
-----BEGIN CERTIFICATE-----
<paste ISRG Root X1 PEM here>
-----END CERTIFICATE-----
)EOF";

WiFiClientSecure client;
client.setCACert(rootCACertificate);
```

---

## 3 · Minimal full example

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

const char* ssid       = "YOUR_WIFI_SSID";
const char* password   = "YOUR_WIFI_PASSWORD";
const char* serverUrl  = "https://<your-render-app>.onrender.com/eeg";

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi connected");
}

void loop() {
  // --- Read EEG ADC values ---
  int fp1Raw = analogRead(34);   // adjust pin as needed
  int fp2Raw = analogRead(35);

  if (WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure client;
    client.setInsecure();        // swap for setCACert() in production

    HTTPClient http;
    http.begin(client, serverUrl);
    http.addHeader("Content-Type", "text/plain");

    // Send one or more "fp1,fp2\n" lines per request (batch for efficiency)
    String body = String(fp1Raw) + "," + String(fp2Raw) + "\n";
    int code = http.POST(body);

    if (code > 0) {
      Serial.printf("[POST] %d\n", code);
    } else {
      Serial.printf("[POST] Error: %s\n", http.errorToString(code).c_str());
    }
    http.end();
  }

  delay(8);   // ~125 Hz → 128 samples/sec to match model training rate
}
```

---

## 4 · Environment variables summary

| Variable set on | Key | Example value |
|---|---|---|
| **Render** (relay service) | `PORT` | auto-injected by Render |
| **Render** (Express backend) | `CORS_ORIGIN` | `https://your-app.vercel.app` |
| **Vercel** (frontend) | `VITE_API_BASE_URL` | `https://your-backend.onrender.com` |
| **Arduino sketch** | `serverUrl` | `https://your-relay.onrender.com/eeg` |
