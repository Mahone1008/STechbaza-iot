import type { Metadata } from "next";
import type { ReactNode } from "react";

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

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uk">
      <body><AppProviders>{children}</AppProviders></body>
    </html>
  );
}
