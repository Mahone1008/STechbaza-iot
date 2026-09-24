# TechBaza Technology Stack

This document fixes the baseline technology stack for the TechBaza IoT Pump Control platform.

## 1. Field controller

- **MCU:** ESP32-S3
- **Firmware language/framework:** C++ with PlatformIO / Arduino framework for the prototype stages
- **Industrial bus:** RS485
- **Device protocol:** Modbus RTU
- **Connectivity:** Wi-Fi for development, 4G/LTE for field deployments
- **Cloud protocol:** MQTT over TLS
- **Local fallback:** the controller must retain safe local behavior if Internet/cloud connectivity is lost

## 2. MQTT layer

- **Protocol:** MQTT
- **Broker:** Eclipse Mosquitto for development and first production deployment
- **Security:** TLS, per-device credentials, topic-level authorization
- **Message model:** telemetry, state, commands, acknowledgements and events are separated into distinct topics

MQTT is used between field controllers and the server. Modbus RTU remains local between the ESP32 controller and the VFD/sensors.

## 3. Backend

- **Language:** Python
- **Framework:** FastAPI
- **API style:** REST for the web application; WebSocket/SSE can be added for live updates
- **MQTT integration:** backend service subscribes to device telemetry/events and publishes commands
- **Validation:** Pydantic models
- **Database access:** SQLAlchemy
- **Migrations:** Alembic

The backend is the central business-logic layer. It must not hardcode one fixed hardware configuration for every customer.

## 4. Database

- **Database:** PostgreSQL
- **Model:** capability-driven / modular
- **Stores:** users, organizations, sites, devices, hardware modules, installed capabilities, telemetry, commands, alarms, events and audit history

Each controller/site can have a different set of installed sensors and modules. The backend and frontend must derive available functions from the actual assigned hardware.

## 5. Frontend

- **Language:** TypeScript
- **Framework:** React with Next.js
- **UI approach:** responsive web application
- **Live data:** API plus WebSocket/SSE where required
- **Authorization:** role- and organization-aware UI
- **Capability-driven interface:** only controls/widgets supported by the installed hardware are shown

Primary roles:
- customer;
- service engineer;
- administrator.

## 6. Infrastructure

- **Containers:** Docker
- **Local orchestration:** Docker Compose
- **Reverse proxy / HTTPS:** Caddy or Nginx
- **Services:** frontend, backend, PostgreSQL, MQTT broker
- **Secrets:** environment variables / secret files, never committed to Git
- **Deployment target:** Linux VPS/server for the first production version

## 7. Simulator

A software simulator will emulate field devices so the cloud platform can be tested without a physical VFD or pump.

It should be able to emulate:
- online/offline state;
- frequency;
- current;
- pressure and other optional sensors;
- VFD faults;
- alarms;
- command acknowledgements.

## 8. Data path

```text
Pump / motor
    ↑
VFD
    ↕ Modbus RTU / RS485
ESP32-S3 controller
    ↕ MQTT over TLS (Wi-Fi or 4G)
MQTT broker
    ↕
FastAPI backend
    ↕
PostgreSQL
    ↕
Next.js frontend
    ↓
Customer / service / admin
```

## 9. Important architecture rule

TechBaza is a **modular constructor**, not a fixed hardware bundle.

The common platform is shared, while every installation may have a different set of optional sensors, actuators and modules. The backend, database and frontend must reflect the actual hardware assigned to each device/site instead of assuming that all customers have the same capabilities.
