#pragma once
#include "vfd_driver.h"

namespace kerumo {
// Verified against SU-600-24.12.18 and the SU600A-5RG1-B bench.
// These configuration reads do not automatically identify the manufacturer/model.
struct Su600Config {
  uint16_t runSource{}, frequencySource{}, maxRaw{}, upperRaw{}, lowerRaw{};
  uint16_t address{}, serial{}, timeoutRaw{}, responseDelay{}, scaleRaw{}, protocol{};
  bool readOk{};
  uint16_t protection{}, autoReset{};
  bool protectionReadOk{};
  bool profileOk() const;
  bool controlOk() const;
  bool extendedTestOk() const;
};
Su600Config readConfig(Bus& bus);
bool frequencyWord(double hz, const Su600Config& config, uint16_t& result);
bool stopped(uint16_t state, uint16_t outputFrequency);
bool runningForward(uint16_t state);

class Su600Driver final : public VfdDriver {
 public:
  explicit Su600Driver(Bus& bus, double minHz=0, double maxHz=50)
      : bus_(bus), minHz_(minHz), maxHz_(maxHz) {}
  const char* profileId() const override { return "suswe.su600.modbus"; }
  void setInstallationLimits(double minHz,double maxHz) { minHz_=minHz; maxHz_=maxHz; }
  unsigned profileVersion() const override { return 1; }
  void refreshConfig() override;
  bool profileOk() const override { return config_.profileOk(); }
  bool controlOk() const override;
  bool extendedTestOk() const override { return controlOk() && config_.extendedTestOk(); }
  bool recoveryAllowed() override;
  bool frequencyAllowed(double hz) const override;
  bool readFault(uint16_t& value) override { return bus_.read(0x2100,value); }
  bool readState(DriveState& value) override;
  bool readSetHz(double& value) override { return scaled(0x2102,100,value); }
  bool readOutputHz(double& value) override { return scaled(0x2103,100,value); }
  bool readCurrentA(double& value) override { return scaled(0x2104,10,value); }
  bool readVoltageV(double& value) override { return scaled(0x2106,10,value); }
  bool startForward() override { return controlOk() && bus_.write(0x2000,0x0012); }
  bool stop() override { return profileOk() && bus_.write(0x2000,0x0001); }
  bool setFrequency(double hz) override;
  DriveSettings settings() const override { return settings_; }
  bool settingsReady() const override;
  bool sourceAllowed(bool remote) const override;
  bool readSetting(const char* code, uint16_t& value) override;
  bool writeSetting(const char* code, uint16_t value) override;
  bool writeSourcePart(bool run, bool remote) override;
  bool clearRemoteFrequency() override { return settingsReady() && bus_.write(0x2001, 0); }
  const Su600Config& config() const { return config_; }
 private:
  bool scaled(uint16_t address, double divisor, double& value);
  Bus& bus_;
  double minHz_, maxHz_;
  Su600Config config_{};
  DriveSettings settings_{};
};
} // namespace kerumo
