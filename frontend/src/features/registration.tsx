"use client";

import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, PageHeader, TextField } from "@/components/ui";
import { apiErrorDisplayMessage, apiRequest } from "@/lib/api";
import { useAuthSession } from "./auth-session";
import { CreatePersonalAccount } from "./create-personal-account";
import { useEmailLinkToken } from "./email-link";
import { useAccountAction } from "./use-account-action";

export function RegistrationPage() {
  const params = useSearchParams();
  const controller = params.get("controller");
  const controllerId = controller && /^[0-9a-f-]{36}$/i.test(controller) ? controller : null;
  const { session, authorizedRequest } = useAuthSession();
  const token = useEmailLinkToken();
  const [email, setEmail] = useState("");
  const [inspected, setInspected] = useState<{ token: string; email?: string; error?: string } | null>(null);
  const verifiedEmail = inspected?.token === token ? inspected.email : undefined;
  const linkError = inspected?.token === token ? inspected.error : undefined;
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAccountAction();
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<{ email: string }>({
      path: "/api/v1/auth/registration/inspect",
      method: "POST",
      csrf: true,
      credentials: "include",
      body: { token },
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setInspected({ token, email: result.email });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setInspected({ token, error: apiErrorDisplayMessage(cause) });
      });
    return () => controller.abort();
  }, [token]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const temporary = session.status === "authenticated" && session.email?.startsWith("kr-") && controllerId;
      const options = {
        path: temporary ? `/api/v1/connect/${controllerId}/account-registration` : "/api/v1/auth/registration/start",
        method: "POST" as const,
        csrf: true,
        credentials: "include" as const,
        body: { email, controller_id: controllerId },
      };
      if (temporary) await authorizedRequest(options);
      else await apiRequest(options);
      setSent(true);
    });
  };
  return (
    <main className="connect-page">
      <PageHeader
        title="Особистий обліковий запис"
        description="Один доступ для ваших організацій, об’єктів і контролерів."
      />
      <Card title={token ? "Підтвердження пошти" : "Почнімо з вашої пошти"}>
        {token ? (
          linkError ? (
            <div className="connect-fields">
              <p role="alert">{linkError}</p>
              <Button
                onClick={() =>
                  window.location.assign(controllerId ? `/register?controller=${controllerId}` : "/register")
                }
              >
                Запросити новий лист
              </Button>
            </div>
          ) : verifiedEmail ? (
            <CreatePersonalAccount key={token} token={token} email={verifiedEmail} />
          ) : (
            <p role="status">Перевіряємо посилання…</p>
          )
        ) : (
          <form className="connect-fields" onSubmit={submit}>
            <p>
              Підтвердьте пошту посиланням із листа, потім створіть особистий пароль. Пароль із шильдика знадобиться для
              активації контролера.
            </p>
            <TextField
              label="Електронна пошта"
              type="email"
              required
              maxLength={320}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {sent && (
              <p className="notice notice-info" role="status">
                Якщо ця пошта ще не зареєстрована, відкрийте лист KERUMO й підтвердьте її протягом години. Якщо
                обліковий запис уже є, перейдіть до входу.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Надсилаємо…" : sent ? "Надіслати новий лист" : "Підтвердити пошту"}
            </Button>
          </form>
        )}
      </Card>
      <Link
        href={(controllerId ? `/login?returnTo=${encodeURIComponent(`/connect/${controllerId}`)}` : "/login") as Route}
      >
        Уже маєте обліковий запис? Увійти
      </Link>
    </main>
  );
}
