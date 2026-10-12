"use client";

import type { Route } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";

export function ControllerActivation({ id }: { id: string }) {
  return (
    <Card title="Підключіть контролер до свого облікового запису">
      <p>
        Увійдіть у свій обліковий запис або створіть його вперше. Потім введіть одноразовий пароль із закритої картки та
        оберіть об’єкт.
      </p>
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
      <p>Один обліковий запис підходить для кількох контролерів. Двоетапний вхід можна ввімкнути за бажанням.</p>
    </Card>
  );
}
