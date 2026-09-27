"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { AccessContextProvider } from "@/features/access-context";
import { AuthSessionProvider } from "@/features/auth-session";
import { createKerumoQueryClient } from "@/lib/api";

export function AppProviders({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(createKerumoQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <AccessContextProvider>{children}</AccessContextProvider>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}
