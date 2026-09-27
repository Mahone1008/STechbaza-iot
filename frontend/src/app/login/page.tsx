import type { Metadata } from "next";

import { LoginPanel } from "@/features/login";

export const metadata: Metadata = { title: "Вхід" };

export default function LoginPage() {
  return <LoginPanel />;
}
