#pragma once
#include <cstdint>

namespace kerumo {
struct Bus {
  virtual ~Bus() = default;
  virtual bool read(uint16_t address, uint16_t& value) = 0;
  virtual bool write(uint16_t address, uint16_t value) = 0;
};

struct DriveState {
  uint16_t raw{}; // Opaque diagnostic value; the control core never decodes it.
  bool stopped{}, running{}, forward{};
};
inline bool confirmedStopped(const DriveState& state, double outputHz) {
  return state.stopped && outputHz==0;
}
struct DriveSample {
  uint16_t fault{};
  DriveState state{};
  double setHz{}, outputHz{}, currentA{}, voltageV{};
  bool ok[6]{}; // fault, state, set Hz, output Hz, A, V
};

// The core knows physical quantities and operations, not register addresses,
// F/P groups, wire scaling or manufacturer-specific state words.
class VfdDriver {
 public:
  virtual ~VfdDriver() = default;
  virtual const char* profileId() const = 0;
  virtual unsigned profileVersion() const = 0;
  virtual void refreshConfig() = 0;
  virtual bool profileOk() const = 0;
  virtual bool controlOk() const = 0;
  virtual bool extendedTestOk() const = 0;
  virtual bool recoveryAllowed() = 0;
  virtual bool frequencyAllowed(double hz) const = 0;
  virtual bool readFault(uint16_t& value) = 0;
  virtual bool readState(DriveState& value) = 0;
  virtual bool readSetHz(double& value) = 0;
  virtual bool readOutputHz(double& value) = 0;
  virtual bool readCurrentA(double& value) = 0;
  virtual bool readVoltageV(double& value) = 0;
  virtual bool startForward() = 0;
  virtual bool stop() = 0;
  virtual bool setFrequency(double hz) = 0;
  DriveSample sample() {
    DriveSample value{};
    if (!profileOk()) return value;
    value.ok[0]=readFault(value.fault); value.ok[1]=readState(value.state);
    value.ok[2]=readSetHz(value.setHz); value.ok[3]=readOutputHz(value.outputHz);
    value.ok[4]=readCurrentA(value.currentA); value.ok[5]=readVoltageV(value.voltageV);
    return value;
  }
};
} // namespace kerumo
