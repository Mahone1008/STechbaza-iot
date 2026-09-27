import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, DataTable, StatusBadge, TextField, type TableColumn } from "@/components/ui";

describe("KERUMO UI primitives", () => {
  it("renders semantic button and status content", () => {
    const markup = renderToStaticMarkup(
      <div>
        <Button variant="danger" disabled>Зупинити</Button>
        <StatusBadge tone="warning">Застарілі дані</StatusBadge>
      </div>,
    );

    expect(markup).toContain("button-danger");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Зупинити");
    expect(markup).toContain("status-warning");
    expect(markup).toContain("Застарілі дані");
  });

  it("connects labels, hints and validation state", () => {
    const markup = renderToStaticMarkup(
      <TextField label="Назва пристрою" hint="Видима користувачам організації" defaultValue="Насосна станція №1" />,
    );

    expect(markup).toContain("Назва пристрою");
    expect(markup).toContain("Видима користувачам організації");
    expect(markup).toContain("aria-describedby");
    expect(markup).toContain("Насосна станція №1");
  });

  it("does not turn an empty collection into fake rows", () => {
    type Row = { id: string; name: string };
    const columns: readonly TableColumn<Row>[] = [
      { key: "name", header: "Пристрій", render: (row) => row.name },
    ];
    const markup = renderToStaticMarkup(
      <DataTable<Row> caption="Пристрої" rows={[]} columns={columns} emptyMessage="Пристроїв немає." />,
    );

    expect(markup).toContain("Пристроїв немає.");
    expect(markup).toContain("colSpan=\"1\"");
  });
});
