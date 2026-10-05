export type AvailabilityState = "online" | "stale" | "offline" | "new";

type DeviceSummary = {
  id: string;
  name: string;
  site: string;
  uid: string;
  availability: AvailabilityState;
  lastSeen: string;
  mode: "Дистанційний" | "Локальний" | "Не визначено";
  alarmCount: number;
};

export type DeviceMetric = {
  key: string;
  label: string;
  value: string;
  unit: string;
  meta: string;
  quality: "fresh" | "stale" | "missing" | "invalid";
};

export type DeviceDetail = DeviceSummary & {
  running: boolean;
  dataQuality: "fresh" | "stale" | "missing";
  generatedAt: string;
  metrics: readonly DeviceMetric[];
  modules: readonly string[];
};

const devices: readonly DeviceSummary[] = [
  {
    id: "north-pump",
    name: "Насосна станція №1",
    site: "Поле Північ",
    uid: "TB-DEMO-PUMP-001",
    availability: "online",
    lastSeen: "щойно",
    mode: "Дистанційний",
    alarmCount: 1,
  },
  {
    id: "reservoir-pump",
    name: "Насос резервуара",
    site: "Центральний вузол",
    uid: "TB-DEMO-PUMP-002",
    availability: "stale",
    lastSeen: "8 хв тому",
    mode: "Дистанційний",
    alarmCount: 0,
  },
  {
    id: "well-controller",
    name: "Контролер свердловини",
    site: "Свердловина №3",
    uid: "TB-DEMO-WELL-003",
    availability: "offline",
    lastSeen: "2 год тому",
    mode: "Локальний",
    alarmCount: 1,
  },
  {
    id: "fertigation-node",
    name: "Вузол фертигації",
    site: "Поле Південь",
    uid: "TB-DEMO-FERT-004",
    availability: "new",
    lastSeen: "даних ще немає",
    mode: "Не визначено",
    alarmCount: 0,
  },
] as const;

const fallbackDevice: DeviceDetail = {
  ...devices[0]!,
  running: true,
  dataQuality: "fresh",
  generatedAt: "27.09.2026, 14:52:08",
  metrics: [
    { key: "frequency", label: "Частота", value: "42.5", unit: "Hz", meta: "Оновлено 4 с тому", quality: "fresh" },
    { key: "current", label: "Струм", value: "8.4", unit: "A", meta: "У робочому діапазоні", quality: "fresh" },
    { key: "pressure", label: "Тиск", value: "3.2", unit: "bar", meta: "Поріг попередження 2.5 bar", quality: "fresh" },
    { key: "level", label: "Рівень води", value: "68", unit: "%", meta: "Тенденція стабільна", quality: "fresh" },
  ],
  modules: ["Керування VFD", "Стан VFD", "Тиск", "Рівень води"],
};

const deviceDetails: Record<string, DeviceDetail> = {
  "north-pump": fallbackDevice,
  "reservoir-pump": {
    ...devices[1]!,
    running: false,
    dataQuality: "stale",
    generatedAt: "27.09.2026, 14:44:12",
    metrics: [
      { key: "frequency", label: "Частота", value: "0", unit: "Hz", meta: "Пакет 8 хв тому", quality: "stale" },
      { key: "current", label: "Струм", value: "0", unit: "A", meta: "Пакет 8 хв тому", quality: "stale" },
      { key: "pressure", label: "Тиск", value: "2.8", unit: "bar", meta: "Пакет 8 хв тому", quality: "stale" },
      { key: "level", label: "Рівень води", value: "—", unit: "%", meta: "Показник відсутній", quality: "missing" },
    ],
    modules: ["Керування VFD", "Стан VFD", "Тиск"],
  },
  "well-controller": {
    ...devices[2]!,
    running: false,
    dataQuality: "stale",
    generatedAt: "27.09.2026, 12:51:30",
    metrics: [
      { key: "frequency", label: "Частота", value: "0", unit: "Hz", meta: "Історичне значення", quality: "stale" },
      { key: "current", label: "Струм", value: "0", unit: "A", meta: "Історичне значення", quality: "stale" },
      {
        key: "pressure",
        label: "Тиск",
        value: "—",
        unit: "bar",
        meta: "Немає достовірного значення",
        quality: "missing",
      },
      { key: "level", label: "Рівень води", value: "41", unit: "%", meta: "Історичне значення", quality: "stale" },
    ],
    modules: ["Стан VFD", "Рівень води"],
  },
  "fertigation-node": {
    ...devices[3]!,
    running: false,
    dataQuality: "missing",
    generatedAt: "—",
    metrics: [
      { key: "frequency", label: "Частота", value: "—", unit: "Hz", meta: "Модуль не встановлено", quality: "missing" },
      { key: "current", label: "Струм", value: "—", unit: "A", meta: "Модуль не встановлено", quality: "missing" },
      {
        key: "pressure",
        label: "Тиск",
        value: "—",
        unit: "bar",
        meta: "Телеметрія ще не надходила",
        quality: "missing",
      },
      {
        key: "level",
        label: "Рівень води",
        value: "—",
        unit: "%",
        meta: "Телеметрія ще не надходила",
        quality: "missing",
      },
    ],
    modules: ["Майбутній модуль дозування"],
  },
};

export function getDevice(deviceId: string): DeviceDetail {
  return deviceDetails[deviceId] ?? fallbackDevice;
}
