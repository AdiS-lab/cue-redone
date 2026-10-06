// Declarations as published in Links2004/arduinoWebSockets src/WebSocketsClient.h
#pragma once
#include "Arduino.h"
typedef enum { WStype_ERROR, WStype_DISCONNECTED, WStype_CONNECTED, WStype_TEXT, WStype_BIN, WStype_FRAGMENT_TEXT_START, WStype_FRAGMENT_BIN_START, WStype_FRAGMENT, WStype_FRAGMENT_FIN, WStype_PING, WStype_PONG } WStype_t;
class WebSocketsClient {
 public:
  typedef void (*WebSocketClientEvent)(WStype_t type, uint8_t *payload, size_t length);
  void begin(const char *host, uint16_t port, const char *url = "/", const char *protocol = "arduino") {}
  void onEvent(WebSocketClientEvent cb) {}
  void loop(void) {}
  bool sendTXT(const char *payload, size_t length = 0) { return true; }
  bool sendBIN(const uint8_t *payload, size_t length) { return true; }
  void setReconnectInterval(unsigned long time) {}
  void enableHeartbeat(uint32_t pingInterval, uint32_t pongTimeout, uint8_t disconnectTimeoutCount) {}
  bool isConnected(void) { return true; }
};
