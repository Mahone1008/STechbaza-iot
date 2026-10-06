const lifecycleLabels: Record<string, string> = {
  active: "Активний",
  provisioning: "Налаштовується",
  maintenance: "На обслуговуванні",
  provisioned: "Готовий до підключення",
  unclaimed: "Очікує активації",
  suspended: "Доступ призупинено",
  decommissioned: "Виведений з експлуатації",
  retired: "Виведений з експлуатації",
};

export function deviceLifecycleLabel(value: string) {
  return lifecycleLabels[value] ?? "Потребує перевірки";
}
