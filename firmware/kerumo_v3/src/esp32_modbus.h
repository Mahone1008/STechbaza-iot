#pragma once
#include "core.h"
#include "vfd_driver.h"
#include <Arduino.h>

namespace kerumo {
class Modbus final : public Bus {
  HardwareSerial &serial_;
  const bool controlEnabled_;
  uint32_t quietUntil = 0;
  bool exchange(uint16_t address, uint16_t value, bool write, uint16_t &result) {
    // Only this task owns UART. Allow delayed frames to drain after a timeout.
    while (static_cast<int32_t>(millis() - quietUntil) < 0) {
      while (serial_.available())
        serial_.read();
      delay(1);
    }
    delay(5);
    while (serial_.available())
      serial_.read();
    uint8_t request[8] = {1,
                          static_cast<uint8_t>(write ? 6 : 3),
                          static_cast<uint8_t>(address >> 8),
                          static_cast<uint8_t>(address),
                          static_cast<uint8_t>(write ? value >> 8 : 0),
                          static_cast<uint8_t>(write ? value : 1),
                          0,
                          0};
    uint16_t crc = modbusCrc(request, 6);
    request[6] = crc & 255;
    request[7] = crc >> 8;
    serial_.write(request, 8);
    serial_.flush();
    uint8_t response[16]{};
    size_t count = 0;
    const uint32_t start = millis();
    uint32_t last = start;
    while (static_cast<uint32_t>(millis() - start) < 250) {
      while (serial_.available()) {
        int byte = serial_.read();
        if (count < sizeof(response))
          response[count++] = byte;
        last = millis();
      }
      if (count >= 5 && static_cast<uint32_t>(millis() - last) >= 5)
        break;
      delay(1);
    }
    bool ok = write ? writeResponse(response, count, request) : readResponse(response, count, 1, result);
    if (!ok)
      quietUntil = millis() + 250;
    return ok;
  }

public:
  Modbus(HardwareSerial &serial, bool controlEnabled) : serial_(serial), controlEnabled_(controlEnabled) {}
  bool read(uint16_t address, uint16_t &value) override { return exchange(address, 0, false, value); }
  bool write(uint16_t address, uint16_t value) override {
    if (!controlEnabled_)
      return false; // a second, transport-level read-only guard
    uint16_t unused{};
    return exchange(address, value, true, unused);
  }
};
} // namespace kerumo
