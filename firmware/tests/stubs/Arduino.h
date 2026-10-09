#pragma once
#include <cstddef>
#include <cstdint>
#include <deque>
#include <vector>

inline uint32_t testMillis = 0;
inline uint32_t millis() { return testMillis; }
inline void delay(uint32_t ms) { testMillis += ms; }

// Deterministic UART peer for exercising the actual ESP32 Modbus adapter.
class HardwareSerial {
public:
  std::vector<uint8_t> reply, request;
  unsigned writes = 0;
  int available() const { return static_cast<int>(received_.size()); }
  int read() {
    if (received_.empty()) return -1;
    const uint8_t byte = received_.front();
    received_.pop_front();
    return byte;
  }
  size_t write(const uint8_t *data, size_t size) {
    ++writes;
    request.assign(data, data + size);
    received_.assign(reply.begin(), reply.end());
    return size;
  }
  void flush() {}

private:
  std::deque<uint8_t> received_;
};
