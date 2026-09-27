"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, Card, PageHeader, SelectField, StatusBadge, TextField } from "@/components/ui";

export function UiKitShowcase() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <PageHeader eyebrow="Design system · Stage 9.2" title="Базові компоненти" description="Один набір tokens і primitives для наступних функціональних екранів." />

      <div className="ui-grid">
        <Card title="Кнопки" description="Primary використовується лише для головної дії поточного контексту.">
          <div className="ui-row">
            <Button variant="primary">Primary</Button><Button variant="secondary">Secondary</Button><Button variant="danger">Danger</Button><Button variant="ghost">Ghost</Button><Button disabled>Disabled</Button>
          </div>
        </Card>

        <Card title="Стани" description="Колір доповнюється текстом і формою.">
          <div className="ui-row">
            <StatusBadge tone="success">Online</StatusBadge><StatusBadge tone="warning">Застарілі дані</StatusBadge><StatusBadge tone="danger">Offline</StatusBadge><StatusBadge tone="info">Acknowledged</StatusBadge><StatusBadge>Немає даних</StatusBadge>
          </div>
        </Card>

        <Card title="Поля форми" description="Видимі label, hint, error і focus state.">
          <div className="ui-stack">
            <TextField label="Назва пристрою" defaultValue="Насосна станція №1" hint="Відображається користувачам організації." />
            <SelectField label="Режим" defaultValue="remote"><option value="remote">Дистанційний</option><option value="local">Локальний</option></SelectField>
            <TextField label="Некоректне поле" defaultValue=" " error="Значення не може складатися лише з пробілів." />
          </div>
        </Card>

        <Card title="Підтвердження" description="Dialog повертає focus і не ототожнює натискання з фізичним Result.">
          <div className="ui-stack"><div className="notice notice-warning">Критичні write-actions завжди мають контекст і confirmation.</div><Button variant="primary" onClick={() => setDialogOpen(true)}>Відкрити dialog</Button></div>
        </Card>
      </div>

      <ConfirmDialog open={dialogOpen} title="Підтвердити демонстраційну дію" description="Це перевірка базового dialog-компонента. Жодна команда не надсилається." confirmLabel="Підтвердити" onConfirm={() => undefined} onClose={() => setDialogOpen(false)} />
    </>
  );
}
