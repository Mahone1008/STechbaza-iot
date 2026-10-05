"use client";
import { useAccountAction } from "./use-account-action";
import Link from "next/link";
import { ControllerQr } from "@/components/controller-qr";
import { FactoryControllerActions } from "./factory-controller-actions";
import { useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button, Card, PageHeader, TextField } from "@/components/ui";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
import { AccountGate } from "./account-gate";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";

type Schema = components["schemas"];
const fields = [
  ["serial_number", "Серійний номер", 96],
  ["hardware_model", "Модель контролера", 80],
  ["hardware_revision", "Апаратна ревізія", 80],
  ["batch", "Партія", 80],
  ["test_reference", "Номер протоколу заводської перевірки", 160],
] as const;

export function FactoryPage() {
  return (
    <main className="connect-page">
      <PageHeader
        title="Заводський реєстр"
        description="Попередня реєстрація контролерів та постачання. Доступ лише адміністратору платформи з двоетапним входом."
      />
      <AccountGate returnTo="/factory">
        <FactoryRegister />
      </AccountGate>
      <div className="ui-row">
        <Link href="/account/security">Безпека облікового запису</Link>
        <Link href="/devices">До пристроїв</Link>
      </div>
    </main>
  );
}

function FactoryRegister() {
  const { authorizedRequest, session } = useAuthSession();
  const [values, setValues] = useState<Record<string, string>>({
    hardware_model: "KERUMO V3",
  });
  const [passed, setPassed] = useState(false);
  const [secrets, setSecrets] = useState<Schema["FactorySecrets"] | null>(null);
  const [labelUrl, setLabelUrl] = useState("");
  const [readyLabelUrl, setReadyLabelUrl] = useState<string | null>(null);
  const [printBuyer, setPrintBuyer] = useState(false);
  const printLabel = (buyer: boolean) => {
    flushSync(() => setPrintBuyer(buyer));
    window.print();
  };
  const [distributor, setDistributor] = useState("");
  const [reference, setReference] = useState("");
  const [offset, setOffset] = useState(0);
  const key = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const query = usePanelQuery({
    queryKey: ["factory", key, offset],
    intervalMs: 0,
    queryFn: (signal) =>
      authorizedRequest<Schema["FactoryRead"][]>({
        path: "/api/v1/factory/controllers",
        query: { limit: 25, offset },
        signal,
      }),
  });
  const { busy, error, run: perform } = useAccountAction(() => query.refresh());
  const downloadKit = () => {
    if (!secrets) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              ...secrets,
              public_url: labelUrl,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `factory-${secrets.controller.serial_number}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const registerController = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void perform(async () => {
      const created = await authorizedRequest<Schema["FactorySecrets"]>({
        path: "/api/v1/factory/controllers",
        method: "POST",
        body: { ...values, factory_test_passed: passed },
      });
      setSecrets(created);
      setLabelUrl(`${window.location.origin}${created.qr_path}`);
    });
  };

  const recordShipment = (item: Schema["FactoryRead"]) =>
    void perform(async () => {
      await authorizedRequest({
        path: `/api/v1/factory/controllers/${item.id}/shipments`,
        method: "POST",
        body: { distributor, reference },
      });
    });

  if (query.isError)
    return (
      <Card title="Реєстр недоступний">
        <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
        <Button onClick={query.refresh}>Перевірити доступ</Button>
      </Card>
    );
  if (!query.data) return <p role="status">Перевіряємо права…</p>;
  return (
    <>
      <Card title="Зареєструвати контролер">
        {secrets ? (
          <div className="connect-fields">
            <p>Контролер зареєстровано. Завантажте приватний заводський комплект: повторно ключі не показуються.</p>
            <div className="factory-label factory-public-label">
              <ControllerQr url={labelUrl} onReady={setReadyLabelUrl} />
              <strong>KERUMO · {secrets.controller.serial_number}</strong>
              <p>{labelUrl}</p>
            </div>
            <TextField
              label="Публічне посилання для QR"
              value={labelUrl}
              maxLength={500}
              type="url"
              onChange={(event) => setLabelUrl(event.target.value)}
              hint="Для сканування телефоном вкажіть захищену адресу сайту, доступну з телефона."
            />
            <Button disabled={readyLabelUrl !== labelUrl} onClick={() => printLabel(false)}>
              Друкувати публічний QR
            </Button>
            <Button disabled={readyLabelUrl !== labelUrl} onClick={() => printLabel(true)}>
              Друкувати закриту етикетку покупця
            </Button>
            <details open={printBuyer || undefined} data-buyer-print={printBuyer ? "true" : "false"}>
              <summary>Закрита картка покупця</summary>
              <div className="factory-label factory-private-label">
                <ControllerQr url={labelUrl} onReady={setReadyLabelUrl} />
                <strong>KERUMO · {secrets.controller.serial_number}</strong>
                <p>{labelUrl}</p>
                <p>
                  Логін: <code className="recovery-key">{secrets.login}</code>
                </p>
                <p>
                  Одноразовий пароль активації: <code className="recovery-key">{secrets.password}</code>
                </p>
                <p>Локальна мережа: KERUMO-{secrets.controller.id.slice(0, 8)}</p>
                <p>
                  Пароль налаштування: <code className="recovery-key">{secrets.setup_password}</code>
                </p>
              </div>
              <p>Картку передають покупцеві окремо. Заводський ключ залишається лише у виробника та в контролері.</p>
            </details>
            <Button onClick={downloadKit}>Завантажити заводський комплект</Button>
            <p>
              Комплект містить приватний ключ контролера. Закриту етикетку з паролем передають лише покупцеві; публічний
              QR не містить даних входу.
            </p>
            <Button
              onClick={() => {
                setSecrets(null);
                setValues((current) => ({ ...current, serial_number: "" }));
                setPassed(false);
              }}
            >
              Комплект збережено
            </Button>
          </div>
        ) : (
          <form onSubmit={registerController}>
            {fields.map(([name, label, max]) => (
              <TextField
                key={name}
                required
                label={label}
                value={values[name] ?? ""}
                maxLength={max}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [name]: event.target.value,
                  }))
                }
              />
            ))}
            <label className="ui-row">
              <input required type="checkbox" checked={passed} onChange={(event) => setPassed(event.target.checked)} />
              Контролер пройшов заводську перевірку
            </label>
            <Button variant="primary" type="submit" disabled={busy || !passed}>
              Зареєструвати і видати ключі
            </Button>
          </form>
        )}
      </Card>
      <Card title="Постачання">
        <div className="connect-fields">
          <TextField
            label="Оптовик або отримувач партії"
            value={distributor}
            maxLength={160}
            onChange={(event) => setDistributor(event.target.value)}
          />
          <TextField
            label="Номер документа постачання"
            value={reference}
            maxLength={160}
            onChange={(event) => setReference(event.target.value)}
          />
        </div>
        <p>Запис постачання не надає оптовику доступу до даних покупців.</p>
        <ul className="device-events">
          {query.data.map((item) => (
            <li key={item.id}>
              <strong>
                {item.serial_number} · {item.batch}
              </strong>
              <p>
                {item.status === "ready"
                  ? "Готовий до активації"
                  : item.status === "claimed"
                    ? "Активований покупцем"
                    : "Недоступний"}{" "}
                · {item.distributor ?? "Постачання не зазначено"}
              </p>
              {item.status === "ready" && (
                <Button
                  disabled={busy || distributor.trim().length < 2 || !reference.trim()}
                  onClick={() => recordShipment(item)}
                >
                  Записати постачання
                </Button>
              )}
              <FactoryControllerActions
                controller={item}
                onChanged={query.refresh}
                onKit={(kit) => {
                  setSecrets(kit);
                  setLabelUrl(`${window.location.origin}${kit.qr_path}`);
                }}
              />
            </li>
          ))}
        </ul>
        <div className="ui-row">
          <Button disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 25))}>
            Попередні контролери
          </Button>
          <Button disabled={query.data.length < 25 || query.isFetching} onClick={() => setOffset(offset + 25)}>
            Наступні контролери
          </Button>
        </div>
      </Card>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
