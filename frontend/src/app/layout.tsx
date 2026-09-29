import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";

import { AppProviders } from "@/components/providers";

import "./globals.css";
import "./auth.css";
import "./access.css";

export const metadata: Metadata = {
  title: {
    default: "KERUMO",
    template: "%s · KERUMO",
  },
  description: "Модульна платформа дистанційного контролю насосів і промислового обладнання.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Each HTML response needs its own CSP nonce; no static/shared authenticated shell.
  await connection();
  return (
    <html lang="uk">
      <body><AppProviders>{children}</AppProviders></body>
    </html>
  );
}
