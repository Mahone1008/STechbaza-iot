#pragma once
// Generated locally by scripts/prepare-v3.ps1. Do not commit config.local.h.
#define KERUMO_WIFI_SSID "CHANGE_ME"
#define KERUMO_WIFI_PASSWORD "CHANGE_ME"
#define KERUMO_MQTT_HOST "192.168.31.100"
#define KERUMO_MQTT_PORT 8883
#define KERUMO_DEVICE_UID "KERUMO-V3-SU600-001"
#define KERUMO_MQTT_PASSWORD "CHANGE_ME"
#define KERUMO_MQTT_CA ""
// Manual mode requires local ARM after reboot/reconnect; no automatic start.
#define KERUMO_ENABLE_CONTROL false
// Opt in only after commissioning motor protection, wiring and independent stopping.
// ARM SU600 TEST: no duration cap; normal STOP retains permission in this powered session.
#define KERUMO_ENABLE_EXTENDED_TEST false
// Optional commissioned operation: checks grant permission without Serial ARM.
// Requires CONTROL + EXTENDED_TEST; START still requires a fresh website command.
// DISARM inhibits permission for this boot. No automatic motor/program restart.
#define KERUMO_ENABLE_REMOTE_OPERATION false
