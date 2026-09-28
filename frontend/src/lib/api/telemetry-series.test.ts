import { describe, expect, it } from "vitest";
import { seriesFixture } from "../../../tests/fixtures/series";
import { overviewDevice, overviewFixture, overviewOrg } from "../../../tests/fixtures/overview";
import { parseOverview } from "./overview";
import { parseSeries, seriesChannels, seriesWindow } from "./telemetry-series";
const window = seriesWindow(3600, 60, Date.parse("2026-09-28T12:00:00Z"));
const channel = { key: "pressure.bar", unit: "bar", source: "values", data_type: "number", supports_series: true };
const parse = (data: unknown) => parseSeries(data, overviewDevice.id, channel, window);
describe("history contract", () => {
  it("keeps zero, partial buckets and gaps with complete counts", () => {
    const parsed = parse(seriesFixture(window, undefined, undefined, true));
    expect(parsed.buckets[0]!.average).toBe(0); expect(parsed.buckets[1]!.average).toBeNull(); expect(parsed.buckets[2]!.status).toBe("partial");
    expect(parsed.message_count).toBe(3); expect(parsed.sample_count).toBe(2);
  });
  it("selects only assigned supported numeric series channels", () => {
    const overview = parseOverview(overviewFixture(), overviewDevice, overviewOrg);
    expect(seriesChannels(overview).map((c) => c.key)).toEqual(["pressure.bar"]);
    overview.modules[0]!.channels[0] = { ...overview.modules[0]!.channels[0]!, supports_series: false };
    expect(seriesChannels(overview)).toEqual([]);
  });
  it("rejects wrong identity, metric, units, basis and response range", () => {
    for (const patch of [{ device_id: overviewOrg }, { metric: "other" }, { unit: "Hz" }, { time_basis: "reported_at" }, { start: "2026-09-28T00:00:00Z" }, { bucket_seconds: 300 }]) expect(() => parse({ ...seriesFixture(window), ...patch })).toThrow();
  });
  it("rejects truncated history, noncontiguous buckets and inconsistent totals", () => {
    const data = seriesFixture(window); data.buckets.pop(); expect(() => parse(data)).toThrow();
    const second = seriesFixture(window); second.buckets[1]!.start = second.buckets[0]!.start; expect(() => parse(second)).toThrow();
    expect(() => parse({ ...seriesFixture(window), message_count: 1 })).toThrow();
    expect(() => parse({ ...seriesFixture(window), max_messages: 100001 })).toThrow();
  });
  it("rejects fake zeros, booleans, nonfinite aggregates and incoherent status", () => {
    for (const patch of [{ average: 0 }, { average: false }, { average: Infinity }, { sample_count: -1 }, { status: "ok" }]) {
      const data = seriesFixture(window); Object.assign(data.buckets[0]!, patch); expect(() => parse(data)).toThrow();
    }
    const data = seriesFixture(window, undefined, undefined, true); data.buckets[0]!.average = 2; expect(() => parse(data)).toThrow();
  });
  it("bounds periods and buckets and sends explicit UTC timestamps", () => {
    expect(window.start).toBe("2026-09-28T11:00:00.000Z");
    for (const [seconds, bucket] of [[604801, 3600], [604800, 1], [0, 60], [3600, 0], [3600, 1.5]]) expect(() => seriesWindow(seconds!, bucket!)).toThrow();
    expect(seriesWindow(604800, 3600).bucket_seconds).toBe(3600);
  });
});
