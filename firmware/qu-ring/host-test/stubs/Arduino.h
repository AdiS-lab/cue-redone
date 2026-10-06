// Host-side stubs: just enough of the Arduino/ESP32 API surface used by qu-ring.ino to type-check it.
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdio>
#include <string>
#include <vector>
#include <cstdarg>
#include <cstdlib>
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define INPUT_PULLDOWN 3
inline void pinMode(int, int) {}
inline void digitalWrite(int, int) {}
inline int stub_pin = 0;
inline int digitalRead(int) { return stub_pin; }
inline void delay(unsigned long) {}
inline unsigned long stub_now = 0;
inline unsigned long millis() { return stub_now; }
template <class T> T constrain(T x, T a, T b) { return x < a ? a : x > b ? b : x; }
class String {
 public:
  std::string s;
  String() {}
  String(const char *p) : s(p) {}
  String(const char *p, size_t n) : s(p, n) {}
  int indexOf(const char *t, int from = 0) const { auto i = s.find(t, from); return i == std::string::npos ? -1 : (int)i; }
  int indexOf(char c, int from = 0) const { auto i = s.find(c, from); return i == std::string::npos ? -1 : (int)i; }
  String substring(int a) const { return String(s.substr(a).c_str()); }
  String substring(int a, int b) const { return String(s.substr(a, b - a).c_str()); }
  long toInt() const { return std::atol(s.c_str()); }
  const char *c_str() const { return s.c_str(); }
};
struct SerialT {
  void begin(long) {}
  void print(const char *) {}
  void println(const char *) {}
  std::vector<std::string> lines;
  int printf(const char *f, ...) { char b[256]; va_list a; va_start(a, f); vsnprintf(b, sizeof b, f, a); va_end(a); lines.push_back(b); return 0; }
};
inline SerialT Serial;
