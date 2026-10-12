#pragma once
// Copy to lte_config.local.h only for the pre-registered V4 bench.
// scripts/prepare-v4.ps1 generates the actual endpoint, CA and credentials.
#undef KERUMO_USE_LTE
#define KERUMO_USE_LTE true
#define KERUMO_MODEM_APN "internet"
#undef KERUMO_MQTT_HOST
#define KERUMO_MQTT_HOST "CHANGE_ME"
#undef KERUMO_MQTT_PORT
#define KERUMO_MQTT_PORT 8883
#undef KERUMO_DEVICE_UID
#define KERUMO_DEVICE_UID "KERUMO-V3-SU600-001"
#undef KERUMO_MQTT_PASSWORD
#define KERUMO_MQTT_PASSWORD "CHANGE_ME"
#undef KERUMO_MQTT_CA
#define KERUMO_MQTT_CA ""
// First LTE acceptance cannot inherit enabled control from the old Wi-Fi config.
#undef KERUMO_ENABLE_CONTROL
#define KERUMO_ENABLE_CONTROL false
#undef KERUMO_ENABLE_EXTENDED_TEST
#define KERUMO_ENABLE_EXTENDED_TEST false
#undef KERUMO_ENABLE_REMOTE_OPERATION
#define KERUMO_ENABLE_REMOTE_OPERATION false
