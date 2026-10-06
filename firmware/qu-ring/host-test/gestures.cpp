#include "sketch.cpp"  // qu-ring.ino, copied by run.sh
#include <cassert>
#include <iostream>

// Hold the pin at `level` for `ms`, polling every 5 ms like loop() would.
static void hold(int level, int ms) {
  for (int t = 0; t < ms; t += 5) { stub_pin = level; stub_now += 5; pollButton(); }
}
static std::vector<std::string> actions() {
  std::vector<std::string> out;
  for (auto &l : Serial.lines) if (l.rfind("[qu] ", 0) == 0 && l.find("frame") == std::string::npos) out.push_back(l.substr(5, l.size() - 6));
  Serial.lines.clear();
  return out;
}
static void expect(const char *name, std::vector<std::string> got, std::vector<std::string> want) {
  bool ok = got == want;
  std::cout << (ok ? "PASS  " : "FAIL  ") << name << "  [";
  for (auto &g : got) std::cout << g << " ";
  std::cout << "]\n";
  if (!ok) std::exit(1);
}

int main() {
  connected = true;
  hold(0, 100); actions();
  hold(1, 80); hold(0, 40);
  expect("short press sends click on release, 40 ms later (debounce), before the double window ends", actions(), {"click"});
  hold(0, 400);
  expect("no extra event after the window", actions(), {});
  hold(1, 80); hold(0, 100); hold(1, 80); hold(0, 50);
  expect("two presses within 300 ms: click then double", actions(), {"click", "double"});
  hold(0, 500); actions();
  hold(1, 600);
  expect("hold fires while still pressed", actions(), {"hold"});
  hold(1, 1000); hold(0, 400);
  expect("releasing a hold sends nothing more", actions(), {});
  hold(1, 10); hold(0, 10); hold(1, 10); hold(0, 400);
  expect("10 ms bounce is ignored (debounce 25 ms)", actions(), {});
  hold(1, 80); hold(0, 350); hold(1, 80); hold(0, 400);
  expect("presses 350 ms apart are two clicks", actions(), {"click", "click"});
  return 0;
}
