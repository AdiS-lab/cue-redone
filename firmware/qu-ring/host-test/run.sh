#!/bin/sh
# Host-side check of the firmware without the ESP32 toolchain:
#   1. type-checks qu-ring.ino against stub headers that mirror the published Arduino / arduinoWebSockets / esp32-camera APIs
#   2. simulates the button state machine (click / double / hold / debounce) with a fake clock
# It does not prove the sketch builds for the ESP32 or works on hardware; it catches logic and typing mistakes.
set -e
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$here/../qu-ring.ino" "$work/sketch.cpp"
cp "$here/../secrets.example.h" "$work/secrets.h"
cp "$here/gestures.cpp" "$here/camstub.cpp" "$work/"
cd "$work"
${CXX:-g++} -std=gnu++17 -fsyntax-only -Wall -Wextra -Wno-unused-parameter -I"$here/stubs" sketch.cpp
${CXX:-g++} -std=gnu++17 -Wno-unused-parameter -I"$here/stubs" -o gestures gestures.cpp camstub.cpp
./gestures
