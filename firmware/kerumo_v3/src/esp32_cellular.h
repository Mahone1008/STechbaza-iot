#pragma once

#include "cellular.h"
#include <Arduino.h>
#include <PPP.h>
#include <esp_err.h>
// Arduino's esp_modem_api.h exposes generated C++ string/PdpContext declarations
// unsuitable for consumers. This C ABI is the same one used by PPP.cpp.
extern "C" esp_err_t esp_modem_set_flow_control(esp_modem_dce_t *, int, int);
extern "C" esp_err_t esp_modem_get_signal_quality(esp_modem_dce_t *, int &, int &);

namespace kerumo {

// A7670E exposes standard PDP / dial-up AT commands. GENERIC uses these rather
// than assuming firmware compatibility with a different SIMCom modem model.
// This adapter still requires physical acceptance on the user's A7670E revision.
class A7670Port : public CellularPort {
public:
  bool begin(const char *apn) override {
    if (!PPP.setApn(apn) || !PPP.setPins(4, 5, -1, -1, ESP_MODEM_FLOW_CONTROL_NONE) ||
        !PPP.begin(PPP_MODEM_GENERIC, 2, 115200)) {
      Serial.println("LTE: UART initialization failed; retry in 10 seconds");
      return false;
    }
    // Only TX, RX and GND are wired. Disable modem-side hardware flow control.
    if (esp_modem_set_flow_control(PPP.handle(), 0, 0) != ESP_OK) {
      Serial.println("LTE: could not disable UART flow control");
      return false;
    }
    Serial.printf("LTE: AT ready; firmware=%s\n", PPP.cmd("AT+CGMR", 1000).c_str());
    signalValid_ = false;
    return true;
  }
  bool registered() override {
    if (!PPP.attached())
      return false;
    int csq = 99, ber = 99;
    signalValid_ = esp_modem_get_signal_quality(PPP.handle(), csq, ber) == ESP_OK && csqDbm(csq, dbm_);
    signalAt_ = millis();
    Serial.println("LTE: packet service attached; starting PPP");
    return true;
  }
  bool enterData() override {
    // No CMUX assumption and no AT commands injected into the PPP byte stream.
    if (!PPP.mode(ESP_MODEM_MODE_DATA)) {
      Serial.println("LTE: PPP dial failed; inspect APN and modem firmware");
      return false;
    }
    return true;
  }
  bool online() const override { return PPP.connected() && PPP.hasIP(); }
  void end() override {
    signalValid_ = false;
    PPP.end();
  }
  bool signal(int16_t &dbm) const {
    if (!online() || !signalValid_ || static_cast<uint32_t>(millis() - signalAt_) >= 30000)
      return false;
    dbm = dbm_;
    return true;
  }

private:
  bool signalValid_ = false;
  int16_t dbm_ = 0;
  uint32_t signalAt_ = 0;
};

} // namespace kerumo
