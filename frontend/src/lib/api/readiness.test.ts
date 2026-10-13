import { describe, expect, it } from "vitest";
import { parseReadiness } from "./readiness";

describe("installation readiness", () => {
  it("does not present an old response as ready", () => {
    expect(parseReadiness(undefined, "/connect").state).toBe("blocked");
  });

  it("rejects a ready badge when installation blockers remain", () => {
    expect(() => parseReadiness({ state: "ready", title: "Готово", blockers: ["Не перевірено двигун"] }, "/connect")).toThrow();
  });

  it("keeps a real technician action separate from controller contact", () => {
    expect(parseReadiness({
      state: "needs_local_confirmation", title: "Потрібна перевірка на місці",
      next_action: "Монтажник підтверджує обладнання", blockers: ["Підключення не підтверджено"],
    }, "/connect").state).toBe("needs_local_confirmation");
  });
});
