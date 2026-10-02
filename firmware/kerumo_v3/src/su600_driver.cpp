#include "su600_driver.h"
#include <cmath>

namespace kerumo {
bool Su600Config::profileOk() const { return readOk && protocol==0 && address==1 && serial==0 && responseDelay<=200; }
bool Su600Config::controlOk() const {
  return profileOk() && runSource==2 && frequencySource==6 && maxRaw==500 && upperRaw==500 && lowerRaw==0 && scaleRaw==100;
}
bool Su600Config::extendedTestOk() const {
  // SU600A bench: keypad F5.00=1001 is register 0x1001 (decimal 4097).
  // Each keypad digit occupies four bits; decimal /100 and %10 are incorrect.
  // F6.02 is an ordinary numeric register in 0.1 s, not packed digits.
  // These are communication checks, not a certification of motor protection or wiring.
  const unsigned overload=protection&0xF;
  const unsigned pidBreak=(protection>>4)&0xF;
  const unsigned lossAction=(protection>>8)&0xF;
  const unsigned suppression=(protection>>12)&0xF;
  return controlOk() && protectionReadOk && timeoutRaw>=50 && timeoutRaw<=100 && autoReset==0 &&
    overload==1 && pidBreak<=1 && (lossAction==0 || lossAction==2) && suppression<=1;
}
Su600Config readConfig(Bus& bus) {
  Su600Config result{};
  const uint16_t addresses[] = {0x0002,0x0003,0x0004,0x0005,0x0006,0x0600,0x0601,0x0602,0x0603,0x0604,0x0605};
  uint16_t* values[] = {&result.runSource,&result.frequencySource,&result.maxRaw,&result.upperRaw,&result.lowerRaw,
    &result.address,&result.serial,&result.timeoutRaw,&result.responseDelay,&result.scaleRaw,&result.protocol};
  result.readOk=true;
  for (size_t i=0;i<11;++i) if (!bus.read(addresses[i],*values[i])) { result.readOk=false; break; }
  // Optional for the old read-only/60 s bench; required before an extended test.
  if (result.readOk) result.protectionReadOk=bus.read(0x0500,result.protection) && bus.read(0x0408,result.autoReset);
  return result;
}
bool frequencyWord(double hz, const Su600Config& config, uint16_t& result) {
  if (!config.controlOk() || !std::isfinite(hz) || hz<0 || hz>50) return false;
  result=static_cast<uint16_t>(std::lround(hz/(config.maxRaw/10.0)*10000.0)); return true;
}
bool stopped(uint16_t state, uint16_t output) { return (state&3)==2 && output==0; }
bool runningForward(uint16_t state) { return (state&3)==1 && (state&8) && !(state&16); }

bool Su600Driver::controlOk() const {
  return config_.controlOk() && std::isfinite(minHz_) && std::isfinite(maxHz_) &&
    minHz_>=0 && minHz_<maxHz_ && maxHz_<=50;
}
bool Su600Driver::frequencyAllowed(double hz) const {
  uint16_t word{};
  return controlOk() && hz>=minHz_ && hz<=maxHz_ && frequencyWord(hz,config_,word);
}
bool Su600Driver::recoveryAllowed() {
  uint16_t protocol{};
  return profileOk() && bus_.read(0x0605,protocol) && protocol==0;
}
bool Su600Driver::readState(DriveState& value) {
  uint16_t raw{};
  if (!bus_.read(0x2101,raw)) return false;
  value={raw,(raw&3)==2,(raw&3)==1,runningForward(raw)};
  return true;
}
bool Su600Driver::scaled(uint16_t address, double divisor, double& value) {
  uint16_t raw{};
  if (!bus_.read(address,raw)) return false;
  value=raw/divisor;
  return true;
}
bool Su600Driver::setFrequency(double hz) {
  uint16_t word{};
  return frequencyAllowed(hz) && frequencyWord(hz,config_,word) && bus_.write(0x2001,word);
}
} // namespace kerumo
