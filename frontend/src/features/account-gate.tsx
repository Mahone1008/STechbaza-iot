"use client";
import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { useAuthSession } from "./auth-session";

export function AccountGate({ children, returnTo }: { children: ReactNode; returnTo: string }) {
  const { session, refreshSession, logout } = useAuthSession();
  if (session.status === "restoring" || session.status === "logging-out")
    return <p role="status">Перевіряємо сесію…</p>;
  if (session.status === "anonymous")
    return (
      <Card title="Підключення до вашого облікового запису">
        <p>Увійдіть або зареєструйтеся. Після входу продовжимо з цього місця.</p>
        <div className="ui-row">
          <Link className="button button-primary" href={`/login?returnTo=${encodeURIComponent(returnTo)}` as Route}>
            Увійти
          </Link>
          <Link
            className="button button-secondary"
            href={`/register?returnTo=${encodeURIComponent(returnTo)}` as Route}
          >
            Створити обліковий запис
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
