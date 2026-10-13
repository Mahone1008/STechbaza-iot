"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AccessContextProvider } from "@/features/access-context";
import { AuthSessionProvider } from "@/features/auth-session";
import { createKerumoQueryClient } from "@/lib/api";

export function AppProviders({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(createKerumoQueryClient);
  const pathname = usePathname();
  // Тимчасове посилання помічника не потребує відновлення облікового запису чи контексту організації.
  if (pathname === "/setup-help") return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <AccessContextProvider>{children}</AccessContextProvider>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}
