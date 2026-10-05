import { QueryClient } from "@tanstack/react-query";

import { isApiError } from "./errors";
import { apiQueryKeys, type SessionScope } from "./query-keys";

const NO_AUTOMATIC_RETRY = new Set([
  "unauthorized",
  "forbidden",
  "not-found",
  "conflict",
  "validation",
  "rate-limited",
  "aborted",
  "invalid-response",
]);

function shouldRetryApiQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (isApiError(error) && NO_AUTOMATIC_RETRY.has(error.kind)) return false;
  return true;
}

export function createKerumoQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: 5 * 60 * 1_000,
        retry: shouldRetryApiQuery,
        retryDelay: (attemptIndex: number) => Math.min(1_000 * 2 ** attemptIndex, 5_000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export async function clearSessionCache(queryClient: QueryClient, scope: SessionScope): Promise<void> {
  const queryKey = apiQueryKeys.sessionRoot(scope);
  await queryClient.cancelQueries({ queryKey });
  queryClient.removeQueries({ queryKey });
}

export async function clearAllSessionCaches(queryClient: QueryClient): Promise<void> {
  const queryKey = apiQueryKeys.allSessionsRoot();
  await queryClient.cancelQueries({ queryKey });
  queryClient.removeQueries({ queryKey });
}
