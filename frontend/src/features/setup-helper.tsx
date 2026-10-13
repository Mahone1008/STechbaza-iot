"use client";

import { useEffect, useState } from "react";
import { Button, Card, PageHeader, StatusBadge } from "@/components/ui";
import { apiErrorDisplayMessage, apiRequest } from "@/lib/api";
import {
  parseSetupHelper,
  helperProofId,
  setupScope,
  setupSnapshotKey,
  type SetupEquipment,
  type SetupHelperRead,
  type SetupSnapshot,
} from "@/lib/api/setup";
import { useEmailLinkToken } from "./email-link";
import { useAccountAction } from "./use-account-action";
import { SetupEquipmentForm } from "./setup-equipment-form";
import "./connect.css";

export function SetupHelperPage() {
  const token = useEmailLinkToken();
  return (
    <main className="connect-page">
      <PageHeader
        title="Допомога з налаштуванням"
        description="Підготуйте дані установки для перевірки її власником."
      />
      <SetupHelperWithToken key={token} token={token} />
    </main>
  );
}

function SetupHelperWithToken({ token }: { token: string }) {
  const valid = /^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/u.test(token);
  const [data, setData] = useState<SetupHelperRead | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [formVersion, setFormVersion] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAccountAction();
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    // Цей обмежений запит використовує лише доказ із посилання, без cookies і сесії облікового запису.
    void apiRequest({
      path: "/api/v1/setup-help/inspect",
      method: "POST",
      csrf: true,
      credentials: "omit",
      body: { token },
      signal: controller.signal,
    })
      .then((value) => {
        const result = parseSetupHelper(value, helperProofId(token));
        if (!controller.signal.aborted) {
          setData(result);
          setLoadError("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setLoadError(apiErrorDisplayMessage(cause));
      });
    return () => controller.abort();
  }, [token, valid, refresh]);
  const save = (equipment: SetupEquipment, original: SetupSnapshot) =>
    void run(async () => {
      if (!data || loadError || setupSnapshotKey(original) !== setupSnapshotKey(data)) return;
      const result = await apiRequest({
        path: "/api/v1/setup-help/draft",
        method: "PUT",
        csrf: true,
        credentials: "omit",
        body: { token, ...setupScope(original), equipment },
      });
      setData(parseSetupHelper(result, data.helper_id));
      setSubmitted(true);
      setFormVersion((value) => value + 1);
    });
  if (!token)
    return (
      <Card title="Посилання від власника">
        <p role="status">Відкрийте повне посилання, яке надав власник контролера.</p>
      </Card>
    );
  if (!valid)
    return (
      <Card title="Посилання недійсне">
        <p role="alert">Попросіть власника створити нове посилання для допомоги.</p>
      </Card>
    );
  return (
    <Card title={data ? `Контролер ${data.serial_number}` : "Перевірка посилання"}>
      <div className="connect-fields">
        {loadError && (
          <>
            <p role="alert">{loadError} Якщо доступ завершено або відкликано, власник може створити нове посилання.</p>
            <Button onClick={() => setRefresh((value) => value + 1)} disabled={busy}>
              Перевірити посилання
            </Button>
          </>
        )}
        {!data && !loadError && <p role="status">Перевіряємо доступ…</p>}
        {data && (
          <>
            <p>
              Доступ діє до {new Date(data.expires_at).toLocaleString("uk-UA")}. Ви готуєте пропозицію для власника
              цього контролера.
            </p>
            <p className="help-copy">
              Збереження не змінює налаштування контролера. Власник звірить дані, перевірить монтаж на місці й прийме
              установку.
            </p>
            <ul className="setup-checks" aria-label="Перевірки установки">
              {data.checks.map((check) => (
                <li key={check.code}>
                  <StatusBadge
                    tone={check.status === "passed" ? "success" : check.status === "blocked" ? "warning" : "info"}
                  >
                    {check.title}
                  </StatusBadge>
                  {check.detail && <p>{check.detail}</p>}
                </li>
              ))}
            </ul>
            {submitted && (
              <p className="notice notice-success" role="status">
                Дані передано власнику на перевірку. Він побачить їх у підключенні контролера.
              </p>
            )}
            <SetupEquipmentForm
              key={formVersion}
              snapshot={data}
              profiles={data.profiles}
              busy={busy}
              available={!loadError}
              onSave={save}
              onReload={() => setFormVersion((value) => value + 1)}
              submitLabel="Передати дані власнику"
            />
            <Button onClick={() => setRefresh((value) => value + 1)} disabled={busy}>
              Оновити стан установки
            </Button>
          </>
        )}
        {error && <p role="alert">{error} Оновіть стан установки перед повторною перевіркою даних.</p>}
      </div>
    </Card>
  );
}
