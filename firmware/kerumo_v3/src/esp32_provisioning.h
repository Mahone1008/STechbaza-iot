#pragma once
#include "provisioning.h"
#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>

namespace kerumo {
// Локальна мережа налаштування не має RUN endpoint і не передає пароль Wi-Fi у хмару.
class Provisioning {
  Preferences prefs_;
  WebServer web_{80};
  String csrf_, controllerId_, bootstrap_, api_, ca_, apPassword_, pending_;
  uint32_t portalAt_{}, polledAt_{};
  bool portal_{}, bindRequested_{}, restoreRequested_{}, cellular_{};

  bool validEnrollment(JsonDocument &doc) {
    if (std::strcmp(doc["state"] | "", "configured") != 0 || !enrollmentFields(doc, controllerId_.c_str())) return false;
    const String nextManifest = doc["manifest"] | "", nextHash = doc["configuration_hash"] | "";
    if (nextManifest.isEmpty()) return nextHash.isEmpty();
    EquipmentBinding binding{};
    const char *nextUid = doc["device_uid"] | "";
    if (!parseEquipment(nextManifest.c_str(), nextManifest.length(), nextUid, binding)) return false;
    uint8_t digest[32]; char actual[65]{};
    if (mbedtls_sha256(reinterpret_cast<const unsigned char *>(nextManifest.c_str()), nextManifest.length(), digest, 0) != 0) return false;
    for (size_t i=0;i<32;++i) snprintf(actual+i*2,3,"%02x",digest[i]);
    return nextHash == actual;
  }

  bool localRequest(bool mutation = false) {
    const IPAddress peer = web_.client().remoteIP();
    if (!portal_ || web_.client().localIP() != WiFi.softAPIP() ||
        peer[0] != 192 || peer[1] != 168 || peer[2] != 4 || peer[3] < 2 ||
        web_.hostHeader() != "192.168.4.1") return false;
    if (!mutation) return true;
    const String origin = web_.header("Origin");
    return (origin.isEmpty() || origin == "http://192.168.4.1") && web_.arg("csrf") == csrf_;
  }
  void requestedPage(const char *message) {
    String body = F("<!doctype html><html lang='uk'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>KERUMO · Перевірка</title><style>body{font:17px system-ui;max-width:34rem;margin:2rem auto;padding:1rem}a{display:inline-block;padding:1rem;border:1px solid #a6b3bf;border-radius:8px}</style><h1>Перевірка установки</h1><p>");
    body += message;
    body += F("</p><p><a href='/'>Повернутися до налаштування</a></p></html>");
    web_.sendHeader("Cache-Control", "no-store");
    web_.sendHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    web_.send(202, "text/html; charset=utf-8", body);
  }
  void page() {
    if (!localRequest()) { web_.send(403); return; }
    String body = F("<!doctype html><html lang='uk'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>KERUMO · Налаштування</title><style>body{font:17px system-ui;background:#f3f5f7;color:#142433;max-width:34rem;margin:2rem auto;padding:1rem}"
      "section{background:white;border-radius:16px;padding:1.3rem;margin:1rem 0}input,button{box-sizing:border-box;width:100%;padding:.8rem;margin:.4rem 0 1rem;border:1px solid #a6b3bf;border-radius:8px}"
      "button{background:#173b53;color:white}small{color:#4c5d6b}</style><h1>KERUMO</h1><p>Локальне налаштування контролера</p>");
    if (cellular_) {
      body += F("<section><h2>Підключення через 4G</h2><p>Інтернет надходить через SIM-картку. Домашній Wi-Fi не потрібен.</p>"
        "<small>Ця локальна мережа потрібна лише для підтвердження обладнання. Наявність інтернету перевірте в кабінеті.</small></section>");
    } else {
      body += F("<section><h2>Підключення до Wi-Fi</h2><form method='post' action='/wifi'><input type='hidden' name='csrf' value='");
      body += csrf_;
      body += F("'><label>Назва мережі (SSID)<input name='ssid' required maxlength='32' autocomplete='off'></label>"
        "<label>Пароль Wi-Fi<input name='password' type='password' required minlength='8' maxlength='63' autocomplete='new-password'></label>"
        "<button>Зберегти та перезапустити</button></form><small>Пароль залишається тільки в контролері. Після перезапуску керування вимкнено.</small></section>");
    }
    body += F("<section><h2>Підтвердження обладнання</h2><p>Звірте шильдик у кабінеті, зупиніть двигун і перевірте безпечність установки. Контролер перевірить STOP та 0 Гц.</p>"
      "<form method='post' action='/bind'><input type='hidden' name='csrf' value='");
    body += csrf_;
    body += F("'><button>Підтвердити монтаж</button></form><small>Підтвердження не запускає двигун. Керування стане доступним після дозволу на сервері й перевірки контролера.</small></section>");
    if (confirmed()) {
      body += F("<section><h2>Відновлення після блокування пуску</h2><p>Після місцевого DISARM перевірте установку. Ця дія прибирає місцеве блокування, але не запускає двигун і не замінює серверний дозвіл.</p>"
        "<form method='post' action='/enable'><input type='hidden' name='csrf' value='");
      body += csrf_;
      body += F("'><button>Дозволити керування після перевірки</button></form></section>");
    }
    body += F(
      "<form method='post' action='/close'><input type='hidden' name='csrf' value='");
    body += csrf_;
    body += F("'><button>Завершити налаштування</button></form></html>");
    web_.sendHeader("Cache-Control", "no-store");
    web_.sendHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    web_.send(200, "text/html; charset=utf-8", body);
  }
public:
  String uid, password, host, manifest, hash;
  uint16_t port{8883};
  uint32_t revision{};
  bool enabled{}, suspended{true};
  ServerControlGrant grant;

  bool begin(const char *controllerId, const char *bootstrap, const char *api, const char *ca, const char *apPassword,
             bool cellularTransport = false) {
    enabled = true;
    cellular_ = cellularTransport;
    controllerId_ = controllerId; bootstrap_ = bootstrap; api_ = api; ca_ = ca; apPassword_ = apPassword;
    if (!validUuid(controllerId) || bootstrap_.length() < 32 || !api_.startsWith("https://") ||
        apPassword_.length() < 12 || apPassword_.length() > 63 || ca_.isEmpty() || !prefs_.begin("kerumo-connect", false)) return false;
    uint8_t factoryDigest[32]; char factoryHash[65]{};
    if (mbedtls_sha256(reinterpret_cast<const unsigned char *>(bootstrap_.c_str()), bootstrap_.length(), factoryDigest, 0) != 0) return false;
    for (size_t i=0;i<32;++i) snprintf(factoryHash+i*2,3,"%02x",factoryDigest[i]);
    if (prefs_.getString("factory", "") != factoryHash) {
      // Перевипуск заводського ключа прибирає мережу й кеш минулого покупця,
      // але не стирає safety journal: нова прив'язка потребує локального STOP.
      for (const char *key : {"active", "confirmed", "ssid", "wifi"})
        if (prefs_.isKey(key) && !prefs_.remove(key)) return false;
      if (prefs_.putString("factory", factoryHash) != 64) return false;
    }
    JsonDocument cached;
    const String raw = prefs_.getString("active", "");
    if (raw.length() && !deserializeJson(cached, raw) && validEnrollment(cached)) load(cached);
    suspended = true; // Після boot потрібен чинний серверний дозвіл; кеш не відновлює доступ сам.
    const String ssid = prefs_.getString("ssid", ""), pass = prefs_.getString("wifi", "");
    if (cellular_) {
      WiFi.mode(WIFI_OFF);
    } else {
      WiFi.mode(WIFI_STA);
      WiFi.setAutoReconnect(true);
      if (ssid.length()) WiFi.begin(ssid.c_str(), pass.c_str());
    }
    pinMode(0, INPUT_PULLUP);
    const char *headers[] = {"Origin"};
    web_.collectHeaders(headers, 1);
    web_.on("/", HTTP_GET, [this]() { page(); });
    web_.on("/wifi", HTTP_POST, [this]() {
      if (cellular_) { web_.send(403); return; }
      const String ssid = web_.arg("ssid"), pass = web_.arg("password");
      if (!localRequest(true) || ssid.length() < 1 || ssid.length() > 32 || pass.length() < 8 || pass.length() > 63) { web_.send(400); return; }
      if (prefs_.putString("ssid", ssid) != ssid.length() || prefs_.putString("wifi", pass) != pass.length()) { web_.send(503); return; }
      web_.send(200, "text/plain; charset=utf-8", "Збережено. Поверніться до домашньої мережі та кабінету KERUMO.");
      delay(300); ESP.restart();
    });
    web_.on("/bind", HTTP_POST, [this]() {
      if (!localRequest(true)) { web_.send(403); return; }
      if (suspended || manifest.isEmpty() || hash.length() != 64) {
        web_.send(409, "text/plain; charset=utf-8", "Спочатку дочекайтеся підключення до сервера та збережіть обладнання в кабінеті.");
        return;
      }
      bindRequested_ = true;
      requestedPage("Запит передано. Контролер перевірить STOP. Поверніться до налаштування, завершіть його та перевірте паспорт у кабінеті.");
    });
    web_.on("/close", HTTP_POST, [this]() {
      if (!localRequest(true)) { web_.send(403); return; }
      web_.send(200, "text/plain; charset=utf-8", "Налаштування завершено. Поверніться до кабінету.");
      portalAt_ = millis() - 600000;
    });
    web_.on("/enable", HTTP_POST, [this]() {
      if (!localRequest(true)) { web_.send(403); return; }
      if (suspended || !confirmed()) { web_.send(409); return; }
      restoreRequested_ = true;
      requestedPage("Запит передано. Контролер перевірить STOP. Поверніться до налаштування, завершіть його та перевірте готовність у кабінеті.");
    });
    web_.onNotFound([this]() { web_.send(404); });
    if (!cellular_ && ssid.isEmpty()) openPortal();
    return true;
  }
  void load(JsonDocument &doc) {
    uid = doc["device_uid"] | ""; password = doc["mqtt_password"] | "";
    host = doc["mqtt_host"] | ""; port = doc["mqtt_port"] | 8883;
    manifest = doc["manifest"] | ""; hash = doc["configuration_hash"] | "";
    revision = doc["credential_revision"] | 0;
    grant.read(doc, false);
  }
  bool confirmed() {
    char receipt[192];
    return manifest.length() && localConfirmationKey(receipt, sizeof(receipt), uid.c_str(), hash.c_str(), revision) &&
        prefs_.getString("confirmed", "") == receipt;
  }
  bool confirm() {
    char receipt[192];
    return manifest.length() && localConfirmationKey(receipt, sizeof(receipt), uid.c_str(), hash.c_str(), revision) &&
        prefs_.putString("confirmed", receipt) == std::strlen(receipt);
  }
  bool activePortal() const { return portal_; }
  bool takeBind() { const bool result = bindRequested_; bindRequested_ = false; return result; }
  bool takeRestore() { const bool result = restoreRequested_; restoreRequested_ = false; return result; }
  bool buttonHeld() {
    static uint32_t pressed = 0;
    static bool handled = false;
    if (digitalRead(0) != LOW) { pressed = 0; handled = false; return false; }
    if (!pressed) pressed = millis();
    if (!handled && millis() - pressed >= 3000) { handled = true; return true; }
    return false;
  }
  void openPortal() {
    if (portal_) return;
    char random[33];
    for (int i=0; i<4; ++i) snprintf(random+i*8, 9, "%08lx", static_cast<unsigned long>(esp_random()));
    csrf_ = random;
    // LTE does not create a station/DHCP route. PPP remains the Internet path.
    WiFi.mode(cellular_ ? WIFI_AP : WIFI_AP_STA);
    const String ssid = "KERUMO-" + controllerId_.substring(0, 8);
    if (!WiFi.softAP(ssid.c_str(), apPassword_.c_str(), 1, false, 1)) return;
    portal_ = true; portalAt_ = millis(); web_.begin();
    Serial.println("LOCAL SETUP: http://192.168.4.1 (10 min); control DISARMED");
  }
  void loop() {
    if (!portal_) return;
    web_.handleClient();
    if (millis() - portalAt_ >= 600000) {
      web_.stop(); WiFi.softAPdisconnect(true); WiFi.mode(cellular_ ? WIFI_OFF : WIFI_STA); portal_ = false;
      polledAt_ = 0; // Revalidate the server grant after local commissioning.
    }
  }
  bool pollDue(bool safeToChange) const {
    return !portal_ && safeToChange && (!polledAt_ || millis()-polledAt_ >= 30000);
  }
  // The new blob is staged in RAM. Persist only after a fresh STOP readback:
  // a brownout during HTTPS cannot switch identities while motion is possible.
  bool commitPending() {
    return pending_.length() && prefs_.putString("active", pending_) == pending_.length();
  }
  // true: конфігурація змінилася; потрібні DISARM, новий STOP, commit та restart.
  bool poll(const char *firmware, const char *capability, bool safeToChange) {
    if (!pollDue(safeToChange)) return false;
    polledAt_ = millis();
    WiFiClientSecure tls; tls.setCACert(ca_.c_str()); tls.setHandshakeTimeout(5);
    HTTPClient http; http.setTimeout(2500); http.setConnectTimeout(2500);
    if (!http.begin(tls, api_ + "/api/v1/bootstrap/" + controllerId_ + "/configuration")) return false;
    http.addHeader("Authorization", "Bearer " + bootstrap_);
    http.addHeader("Content-Type", "application/json");
    JsonDocument contact;
    contact["firmware_version"] = firmware;
    contact["network_transport"] = cellular_ ? "lte" : "wifi";
    contact["control_capability"] = capability;
    String request;
    serializeJson(contact, request);
    const int status = http.POST(request);
    if (status >= 400 && status < 500) { suspended = true; grant.current = false; http.end(); return false; }
    if (status != 200 || http.getSize() <= 0 || http.getSize() > 8192) {
      if (status == 200) { suspended = true; grant.current = false; }
      http.end(); return false;
    }
    const String raw = http.getString(); http.end();
    JsonDocument doc;
    if (deserializeJson(doc, raw, DeserializationOption::NestingLimit(3))) { suspended = true; grant.current = false; return false; }
    const String state = doc["state"] | "";
    if (state != "configured") { suspended = true; grant.current = false; return false; }
    const String nextUid = doc["device_uid"] | "", nextManifest = doc["manifest"] | "";
    if (!validEnrollment(doc) || !enrollmentRevisionAllowed(doc, controllerId_.c_str(), uid.c_str(), revision)) {
      suspended = true;
      grant.current = false;
      return false;
    }
    const bool changed = uid != nextUid || manifest != nextManifest || hash != (doc["configuration_hash"] | "") ||
        revision != (doc["credential_revision"] | 0U) || host != (doc["mqtt_host"] | "") ||
        password != (doc["mqtt_password"] | "") || port != (doc["mqtt_port"] | 8883U);
    if (changed) { pending_ = raw; grant.current = false; }
    else {
      // Grants are applied in RAM, independently of the immutable manifest.
      // Persist only the anti-rollback watermark; boot still requires live HTTPS.
      if (!grant.read(doc, true)) { suspended = true; return false; }
      if (prefs_.getString("active", "") != raw && prefs_.putString("active", raw) != raw.length()) {
        suspended = true; grant.current = false; return false;
      }
    }
    suspended = changed;
    // Runtime identity незмінна між boot: VFD task читає ті самі UID/hash.
    // Новий blob завантажиться після перезапуску, без спільного String mutation.
    return changed;
  }
};
} // namespace kerumo
