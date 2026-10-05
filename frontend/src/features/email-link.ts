"use client";

import { useEffect, useState } from "react";

/** Keep the mail proof in this page's memory, clear the fragment before navigation. */
export function useEmailLinkToken() {
  const [token, setToken] = useState("");
  useEffect(() => {
    const capture = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (!value) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      queueMicrotask(() => setToken(value));
    };
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);
  return token;
}

export function downloadAccountAccess(email: string, password: string, recoveryKey: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ login: email, password, recovery_key: recoveryKey }, null, 2)], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "kerumo-personal-access.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
