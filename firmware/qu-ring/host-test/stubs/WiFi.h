#pragma once
#include "Arduino.h"
#define WIFI_STA 1
#define WL_CONNECTED 3
struct IPAddress { String toString() const { return String("0.0.0.0"); } };
struct WiFiT {
  void mode(int) {}
  void setSleep(bool) {}
  void begin(const char *, const char *) {}
  int status() { return WL_CONNECTED; }
  IPAddress localIP() { return {}; }
};
inline WiFiT WiFi;
