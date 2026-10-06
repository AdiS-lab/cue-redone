// Qu ring firmware: ESP32-CAM (AI-Thinker, OV2640) + Grove button.
//
// Speaks the ring WebSocket protocol (src/vision/README.md) to the Qu hub's /phone endpoint,
// which relays everything to the browser:
//   board -> browser  "click" | "double" | "hold"            button gestures (decided here)
//   browser -> board  {"type":"capture","count":N}           take N JPEGs now
//   board -> browser  <binary JPEG> x N, then {"type":"burst-end"}
//   browser -> board  {"type":"feedback","kind":"captured"|"error"|...}  blink the LED / buzz
//
// The camera stays initialised between presses so a capture costs one frame time, not a sensor wake-up.
// Untested on hardware at the time of writing: verify pins, focus and timing on your board.
//
// Libraries: esp32 board package (includes esp_camera), "WebSockets" by Markus Sattler (arduinoWebSockets).
// Board: "AI Thinker ESP32-CAM", PSRAM enabled.

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include "esp_camera.h"
#include "secrets.h"

// ---------- hardware ----------
// AI-Thinker ESP32-CAM camera pins (from the esp32 CameraWebServer example)
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

#define FLASH_LED_PIN 4      // the bright white LED
#define STATUS_LED_PIN 33    // small red LED on the back, active LOW
#define BUTTON_PIN 13        // Grove button signal (SD card slot pins are free when no card is used)
#define BUTTON_ACTIVE_HIGH 1 // the Grove button module outputs HIGH while pressed
#define BUZZER_PIN -1        // optional Grove buzzer; -1 = none

// ---------- tuning ----------
// SVGA keeps each JPEG around 30-60 KB: fast over Wi-Fi and plenty for Claude (it downscales above ~1.15 MP).
// Use FRAMESIZE_XGA (1024x768) or FRAMESIZE_SXGA for small print, at the cost of upload time.
#define FRAME_SIZE FRAMESIZE_SVGA
#define JPEG_QUALITY 12          // 0-63, lower is better quality
#define HOLD_MS 550              // pressed this long = "hold" (sent while still held)
#define DOUBLE_GAP_MS 300        // a second press within this = "double"
// 1: send "click" the moment the button is released, then "double" if a second press follows. The app starts looking
//    immediately and "more" picks up that look, so no press waits for the double-press window.
// 0: wait DOUBLE_GAP_MS after a release to decide between click and double (adds that delay to every click).
#define CLICK_FIRST 1
#define DEBOUNCE_MS 25
#define MAX_BURST 5
// Heuristic: in the dark the OV2640's JPEGs get very small. If the first frame of a burst is smaller than this,
// switch the flash on and retake. Tune on your board (print sizes with Serial).
#define LOW_LIGHT_JPEG_BYTES 9000
#define FLASH_SETTLE_MS 120

WebSocketsClient ws;
bool connected = false;
volatile int pendingCapture = 0;

// ---------- feedback ----------
void statusLed(bool on) { digitalWrite(STATUS_LED_PIN, on ? LOW : HIGH); }

void blink(int times, int onMs, int offMs) {
  for (int i = 0; i < times; i++) {
    statusLed(true);
    if (BUZZER_PIN >= 0) digitalWrite(BUZZER_PIN, HIGH);
    delay(onMs);
    statusLed(false);
    if (BUZZER_PIN >= 0) digitalWrite(BUZZER_PIN, LOW);
    delay(offMs);
  }
}

void feedback(const char *kind) {
  if (strcmp(kind, "error") == 0) blink(3, 60, 60);
  else if (strcmp(kind, "captured") == 0) blink(1, 30, 0);
  else blink(1, 15, 0);  // on-target, highlight, select
}

// ---------- camera ----------
bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;
  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;
  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;
  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;
  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;
  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM;
  c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAME_SIZE;
  c.jpeg_quality = JPEG_QUALITY;
  c.fb_count = 2;                    // continuous mode: a fresh frame is always ready
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;  // never hand out a stale queued frame
  if (esp_camera_init(&c) != ESP_OK) return false;
  sensor_t *s = esp_camera_sensor_get();
  s->set_whitebal(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_exposure_ctrl(s, 1);
  s->set_lenc(s, 1);
  return true;
}

void sendBurst(int count) {
  count = constrain(count, 1, MAX_BURST);
  bool flash = false;
  for (int i = 0; i < count; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) break;
    if (i == 0 && !flash && fb->len < LOW_LIGHT_JPEG_BYTES) {
      // too dark: light it and retake this frame
      esp_camera_fb_return(fb);
      digitalWrite(FLASH_LED_PIN, HIGH);
      flash = true;
      delay(FLASH_SETTLE_MS);
      esp_camera_fb_return(esp_camera_fb_get());  // drop the frame exposed before the flash
      fb = esp_camera_fb_get();
      if (!fb) break;
    }
    Serial.printf("[qu] frame %d: %u bytes%s\n", i, (unsigned)fb->len, flash ? " (flash)" : "");
    ws.sendBIN(fb->buf, fb->len);
    esp_camera_fb_return(fb);
  }
  digitalWrite(FLASH_LED_PIN, LOW);
  ws.sendTXT("{\"type\":\"burst-end\"}");
}

// ---------- websocket ----------
void onWs(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      connected = true;
      Serial.println("[qu] connected to hub");
      blink(2, 40, 40);
      break;
    case WStype_DISCONNECTED:
      connected = false;
      Serial.println("[qu] hub disconnected");
      break;
    case WStype_TEXT: {
      String msg = String((const char *)payload, length);
      if (msg.indexOf("\"capture\"") >= 0) {
        int at = msg.indexOf("\"count\":");
        pendingCapture = at >= 0 ? msg.substring(at + 8).toInt() : 1;
        if (pendingCapture < 1) pendingCapture = 1;
      } else if (msg.indexOf("\"feedback\"") >= 0) {
        int at = msg.indexOf("\"kind\":\"");
        if (at >= 0) {
          int end = msg.indexOf('"', at + 8);
          feedback(msg.substring(at + 8, end).c_str());
        }
      }
      break;
    }
    default:
      break;
  }
}

// ---------- button gestures ----------
// click: released before HOLD_MS (sent at once with CLICK_FIRST, else after the double-press window)
// double: second press within DOUBLE_GAP_MS of the first release (with CLICK_FIRST, a "click" was already sent)
// hold: still pressed at HOLD_MS (sent immediately, so "ask" starts listening while you hold)
enum State { IDLE, DOWN, WAIT_SECOND, SECOND_DOWN, HELD };
State state = IDLE;
unsigned long since = 0;
bool lastRaw = false;
unsigned long rawChanged = 0;
bool stable = false;

bool pressed() {
  bool raw = digitalRead(BUTTON_PIN) == (BUTTON_ACTIVE_HIGH ? HIGH : LOW);
  unsigned long now = millis();
  if (raw != lastRaw) {
    lastRaw = raw;
    rawChanged = now;
  }
  if (now - rawChanged >= DEBOUNCE_MS) stable = raw;
  return stable;
}

void send(const char *action) {
  Serial.printf("[qu] %s\n", action);
  if (connected) ws.sendTXT(action);
  else blink(3, 60, 60);
}

void pollButton() {
  bool p = pressed();
  unsigned long now = millis();
  switch (state) {
    case IDLE:
      if (p) { state = DOWN; since = now; }
      break;
    case DOWN:
      if (!p) {
        if (CLICK_FIRST) send("click");
        state = WAIT_SECOND;
        since = now;
      }
      else if (now - since >= HOLD_MS) { send("hold"); state = HELD; }
      break;
    case WAIT_SECOND:
      if (p) { state = SECOND_DOWN; since = now; }
      else if (now - since >= DOUBLE_GAP_MS) {
        if (!CLICK_FIRST) send("click");
        state = IDLE;
      }
      break;
    case SECOND_DOWN:
      if (!p) { send("double"); state = IDLE; }
      break;
    case HELD:
      if (!p) state = IDLE;
      break;
  }
}

// ---------- main ----------
void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);
  pinMode(STATUS_LED_PIN, OUTPUT);
  statusLed(false);
  pinMode(BUTTON_PIN, BUTTON_ACTIVE_HIGH ? INPUT_PULLDOWN : INPUT_PULLUP);
  if (BUZZER_PIN >= 0) pinMode(BUZZER_PIN, OUTPUT);

  if (!initCamera()) {
    Serial.println("[qu] camera init failed");
    while (true) blink(1, 500, 500);
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // modem sleep adds 100+ ms to the first packet after idle
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[qu] Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.printf("\n[qu] %s\n", WiFi.localIP().toString().c_str());

  ws.begin(HUB_HOST, HUB_PORT, "/phone");
  ws.onEvent(onWs);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  ws.loop();
  pollButton();
  if (pendingCapture > 0) {
    int n = pendingCapture;
    pendingCapture = 0;
    sendBurst(n);
  }
}
