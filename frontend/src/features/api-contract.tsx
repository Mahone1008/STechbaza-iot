"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, StatusBadge } from "@/components/ui";
import {
  apiConfig,
  apiErrorDisplayMessage,
  apiQueryKeys,
  getBackendHealth,
  isApiError,
} from "@/lib/api";

function ErrorDetails({ error }: { error: unknown }) {
  if (!isApiError(error)) {
    return <div className="notice notice-warning">{apiErrorDisplayMessage(error)}</div>;
  }

  return (
    <div className="ui-stack">
      <div className="notice notice-warning">{apiErrorDisplayMessage(error)}</div>
      <div className="table-secondary">
        kind: <code>{error.kind}</code>
        {error.status ? <> · HTTP {error.status}</> : null}
        {error.retryAfterSeconds !== null ? <> · retry-after {error.retryAfterSeconds}s</> : null}
      </div>
    </div>
  );
}

export function ApiContractPanel() {
  const queryClient = useQueryClient();
  const healthQuery = useQuery({
    queryKey: apiQueryKeys.health(),
    queryFn: ({ signal }) => getBackendHealth(signal),
    enabled: false,
    retry: false,
  });

  const untouched = healthQuery.fetchStatus === "idle" && healthQuery.data === undefined && !healthQuery.error;

  return (
    <Card
      title="API adapter і контракт"
      description="Реальний /health запит перевіряє timeout, cancel та окремий error-state. Інші екрани поки залишаються на demo data."
    >
      <div className="ui-stack">
        <div className="control-state">
          <div>
            <strong>Backend: {apiConfig.baseUrl}</strong>
            <div className="table-secondary">Timeout: {apiConfig.timeoutMs / 1_000} с · credentials include · cache no-store</div>
          </div>
          {healthQuery.isFetching ? <StatusBadge tone="info">Запит виконується</StatusBadge> : null}
          {healthQuery.data ? <StatusBadge tone="success">API доступний</StatusBadge> : null}
          {healthQuery.error ? <StatusBadge tone="danger">Помилка API</StatusBadge> : null}
          {untouched ? <StatusBadge>Не перевірено</StatusBadge> : null}
        </div>

        <div className="ui-row">
          <Button variant="primary" onClick={() => void healthQuery.refetch()} disabled={healthQuery.isFetching}>
            Перевірити API
          </Button>
          <Button
            variant="secondary"
            onClick={() => void queryClient.cancelQueries({ queryKey: apiQueryKeys.health() })}
            disabled={!healthQuery.isFetching}
          >
            Скасувати запит
          </Button>
          <Button
            variant="ghost"
            onClick={() => queryClient.removeQueries({ queryKey: apiQueryKeys.health() })}
            disabled={untouched}
          >
            Очистити стан
          </Button>
        </div>

        {healthQuery.data ? (
          <div className="notice notice-info">
            Backend відповів: <strong>{healthQuery.data.status}</strong> · service {healthQuery.data.service} · version {healthQuery.data.version}
          </div>
        ) : null}
        {healthQuery.error ? <ErrorDetails error={healthQuery.error} /> : null}
        {untouched ? (
          <div className="notice">
            Порожній список і збій API — різні стани. До першої перевірки тут немає ані даних, ані помилки.
          </div>
        ) : null}
      </div>
    </Card>
  );
}
