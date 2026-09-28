import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TelemetryChart } from "./telemetry-chart";
import { seriesFixture } from "../../tests/fixtures/series";
import { seriesWindow } from "@/lib/api/telemetry-series";
it("renders disconnected paths, zero, exact table counts and timezone", () => {
  const data = seriesFixture(seriesWindow(180, 60), undefined, undefined, true);
  const html = renderToStaticMarkup(<TelemetryChart series={data} timezone="Europe/Kyiv" />);
  expect(html.match(/<path /g)).toHaveLength(2); expect(html).toContain("Europe/Kyiv"); expect(html).toContain("Часткові дані"); expect(html).toContain("<td>0</td>"); expect(html).toContain("<td>—</td>");
});
it("normalizes large finite values without overflowing SVG coordinates", () => {
  const data = seriesFixture(seriesWindow(180, 60), undefined, undefined, true);
  Object.assign(data.buckets[0]!, { minimum: -1e308, maximum: 1e308, average: 0 });
  const html = renderToStaticMarkup(<TelemetryChart series={data} timezone="UTC" />);
  expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
});
