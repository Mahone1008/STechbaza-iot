"use client";
import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button, Card } from "@/components/ui";
import { useAuthSession } from "./auth-session";

export function AccountGate({ children, returnTo }: { children: ReactNode; returnTo: string }) {
  const { session, refreshSession, logout } = useAuthSession();
  const router = useRouter();
  const loggedOut = session.status === "anonymous" && session.reason === "logout";
  useEffect(() => {
    if (loggedOut) router.replace("/login?loggedOut=1");
  }, [loggedOut, router]);
  if (loggedOut) return <p role="status">Переходимо до форми входу…</p>;
  if (session.status === "restoring" || session.status === "logging-out")
    return <p role="status">Перевіряємо сесію…</p>;
  if (session.status === "anonymous")
    return (
      <Card title="Підключення до вашого облікового запису">
        <p>Увійдіть за виданими логіном і паролем. Для першого підключення відкрийте QR контролера.</p>
        <div className="ui-row">
          <Link className="button button-primary" href={`/login?returnTo=${encodeURIComponent(returnTo)}` as Route}>
            Увійти
          </Link>
          <Link className="button button-secondary" href="/connect">
            Активувати контролер за QR
          </Link>
        </div>
      </Card>
    );
  if (session.status !== "authenticated")
    return (
      <Card title="Не вдалося підтвердити сесію">
        <div className="ui-row">
          <Button onClick={() => void refreshSession()}>Повторити</Button>
          <Button onClick={() => void logout()}>Вийти</Button>
        </div>
      </Card>
    );
  return children;
}
