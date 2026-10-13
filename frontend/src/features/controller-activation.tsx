"use client";

import type { Route } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";

export function ControllerActivation({ id }: { id: string }) {
  return (
    <Card title="Увійдіть, щоб активувати контролер">
      <p>Після входу введіть пароль із закритої картки й оберіть місце встановлення контролера.</p>
      <div className="ui-row">
        <Link
          className="button button-primary"
          href={`/login?returnTo=${encodeURIComponent(`/connect/${id}`)}` as Route}
        >
          Увійти
        </Link>
        <Link className="button button-secondary" href={`/register?controller=${id}` as Route}>
          Створити обліковий запис
        </Link>
      </div>
      <p>Один обліковий запис підходить для всіх ваших контролерів.</p>
    </Card>
  );
}
