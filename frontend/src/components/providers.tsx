"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createKerumoQueryClient } from "@/lib/api";

export function AppProviders({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(createKerumoQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
