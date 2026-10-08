#pragma once

#include <cstdint>

namespace kerumo {

// CSQ=99 is unknown, not a measured weak signal. CSQ=0/31 are censored endpoints.
inline bool csqDbm(int csq, int16_t &dbm) {
  if (csq < 0 || csq > 31)
    return false;
  dbm = static_cast<int16_t>(-113 + 2 * csq);
  return true;
}

class CellularPort {
public:
  virtual ~CellularPort() = default;
  virtual bool begin(const char *apn) = 0;
  virtual bool registered() = 0;
  virtual bool enterData() = 0;
  virtual bool online() const = 0;
  virtual void end() = 0;
};

// Only the network task touches the port. The independent VFD task retains its
// existing network lease and STOP handling while AT / PPP operations wait.
class CellularLink {
public:
  enum class Stage { Backoff, Registration, Address, Online };
  CellularLink(CellularPort &port, const char *apn) : port_(port), apn_(apn) {}

  bool tick(uint32_t now) {
    switch (stage_) {
    case Stage::Backoff:
      if (attempted_ && static_cast<uint32_t>(now - since_) < 10000)
        return false;
      attempted_ = true;
      if (!port_.begin(apn_)) {
        retry(now);
        return false;
      }
      stage_ = Stage::Registration;
      since_ = now;
      checked_ = now - 2000;
      return false;
    case Stage::Registration:
      if (static_cast<uint32_t>(now - since_) >= 120000) {
        retry(now);
        return false;
      }
      if (static_cast<uint32_t>(now - checked_) >= 2000) {
        checked_ = now;
        if (port_.registered()) {
          if (!port_.enterData()) {
            retry(now);
            return false;
          }
          stage_ = Stage::Address;
          since_ = now;
        }
      }
      return false;
    case Stage::Address:
      if (port_.online()) {
        stage_ = Stage::Online;
        return true;
      }
      if (static_cast<uint32_t>(now - since_) >= 60000)
        retry(now);
      return false;
    case Stage::Online:
      if (port_.online())
        return true;
      retry(now);
      return false;
    }
    return false;
  }
  Stage stage() const { return stage_; }

private:
  void retry(uint32_t now) {
    port_.end();
    stage_ = Stage::Backoff;
    since_ = now;
  }
  CellularPort &port_;
  const char *apn_;
  Stage stage_ = Stage::Backoff;
  bool attempted_ = false;
  uint32_t since_ = 0, checked_ = 0;
};

} // namespace kerumo
