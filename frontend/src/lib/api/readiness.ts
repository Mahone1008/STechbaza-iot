import { invalidResponse, isRecord, requiredString } from "./access";

export type InstallationReadiness = {
  state:
    | "needs_equipment"
    | "awaiting_controller"
    | "needs_local_confirmation"
    | "needs_commissioning"
    | "ready"
    | "offline"
    | "blocked";
  title: string;
  next_action: string | null;
  blockers: string[];
};

const states = new Set([
  "needs_equipment", "awaiting_controller", "needs_local_confirmation", "needs_commissioning", "ready", "offline", "blocked",
]);

export function parseReadiness(value: unknown, path: string): InstallationReadiness {
  if (value === undefined || value === null) {
    return {
      state: "blocked",
      title: "Готовність ще не підтверджено",
      next_action: "Монтажник має перевірити підключення та готовність обладнання.",
      blockers: ["Потрібне актуальне підтвердження готовності"],
    };
  }
  if (!isRecord(value) || !states.has(String(value.state))) return invalidResponse(path, "installation readiness");
  if (
    !Array.isArray(value.blockers) || value.blockers.length > 20 ||
    value.blockers.some((item) => typeof item !== "string" || !item.trim() || item.length > 1000)
  ) return invalidResponse(path, "installation blockers");
  if (value.state === "ready" && value.blockers.length) return invalidResponse(path, "ready installation without blockers");
  return {
    state: value.state as InstallationReadiness["state"],
    title: requiredString(value, "title", path),
    next_action: value.next_action == null ? null : requiredString(value, "next_action", path),
    blockers: value.blockers as string[],
  };
}
