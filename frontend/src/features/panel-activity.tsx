"use client";
import { createContext, useContext, type ReactNode } from "react";

const PanelActivity = createContext(true);

/** Keep drafts mounted while suspending every query in an inactive section. */
export function DeviceSection({ name, active, children }: { name: string; active: boolean; children: ReactNode }) {
  return <PanelActivity.Provider value={active}>
    <section id={`device-section-${name}`} role="tabpanel" aria-labelledby={`device-tab-${name}`} hidden={!active} tabIndex={0}>
      {children}
    </section>
  </PanelActivity.Provider>;
}

export function usePanelActivity() { return useContext(PanelActivity); }
