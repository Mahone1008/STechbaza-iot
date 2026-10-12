#include "../kerumo_v3/src/esp32_modbus.h"
#include <cassert>
#include <cstdio>
#include <limits>

using namespace kerumo;

int main() {
  HardwareSerial uart;
  Modbus bus(uart, false);
  uint16_t value = 77;
  assert(!bus.read(0x1000, value) && value == 77);
  assert(bus.diagnostics().noReply == 1 && bus.diagnostics().lastReceived == 0);
  const unsigned sent = uart.writes;
  assert(!bus.write(0x2000, 1) && uart.writes == sent); // ReadOnly never sends FC06.

  uart.reply = {1, 3, 2, 0, 0, 0, 0};
  const uint16_t crc = modbusCrc(uart.reply.data(), 5);
  uart.reply[5] = crc & 255;
  uart.reply[6] = crc >> 8;
  assert(bus.read(0x1001, value) && value == 0); // A real zero is not missing.
  assert(bus.diagnostics().valid == 1 && bus.diagnostics().lastReceived == 7);
  assert(uart.request[1] == 3 && uart.request[2] == 0x10 && uart.request[3] == 1);

  uart.reply[6] ^= 1;
  value = 77;
  assert(!bus.read(0x1002, value) && value == 77);
  assert(bus.diagnostics().invalid == 1 && bus.diagnostics().lastReceived == 7);
  uart.reply = {1, 0x83, 2, 0, 0}; // Slave exception is a received, invalid reading.
  assert(!bus.read(0x1003, value));
  assert(bus.diagnostics().invalid == 2 && bus.diagnostics().lastReceived == 5);

  // Timeout and quiet-period logic must also work across millis wraparound.
  HardwareSerial silent;
  Modbus wrapping(silent, false);
  testMillis = std::numeric_limits<uint32_t>::max() - 100;
  const uint32_t start = testMillis;
  assert(!wrapping.read(0x1000, value));
  assert(static_cast<uint32_t>(testMillis - start) == 255);
  const uint32_t afterTimeout = testMillis;
  assert(!wrapping.read(0x1001, value));
  assert(static_cast<uint32_t>(testMillis - afterTimeout) == 505);
  assert(wrapping.diagnostics().requests == 2 && wrapping.diagnostics().noReply == 2);
  assert(bus.diagnostics().requests == 4 && bus.diagnostics().lastRegister == 0x1003);
  std::puts("PASS: actual Modbus adapter silence/zero/CRC/exception, ReadOnly writes and millis wrap");
}
