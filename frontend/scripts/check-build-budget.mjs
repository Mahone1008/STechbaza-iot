import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

async function walk(path) {
  return (await Promise.all((await readdir(path, { withFileTypes: true })).map((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  }))).flat();
}
const files = (await walk(".next/static")).filter((file) => file.endsWith(".js"));
if (!files.length) throw new Error("Build JavaScript is missing; run npm run build first.");
const chunks = await Promise.all(files.map(async (file) => {
  const body = await readFile(file);
  return { file: file.replaceAll("\\", "/"), bytes: body.length, gzipBytes: gzipSync(body).length };
}));
const total = chunks.reduce((n, chunk) => n + chunk.gzipBytes, 0);
const largest = Math.max(...chunks.map((chunk) => chunk.gzipBytes));
const report = {
  kind: "frontend-test-baseline", productionRelease: false,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  node: process.version, buildId: (await readFile(".next/BUILD_ID", "utf8")).trim(),
  dependencies: JSON.parse(await readFile("package.json", "utf8")).dependencies,
  // Sum of independently gzipped chunks, not a browser transfer or backend load test.
  totalGzipBytes: total, largestGzipBytes: largest,
  budgets: { totalGzipBytes: 350 * 1024, largestGzipBytes: 120 * 1024 },
  chunks: chunks.sort((a, b) => b.gzipBytes - a.gzipBytes),
};
await mkdir("artifacts/stage14", { recursive: true });
await writeFile("artifacts/stage14/build-budget.json", JSON.stringify(report, null, 2) + "\n");
console.log(`Build budget: ${chunks.length} chunks, gzip total ${total} / ${report.budgets.totalGzipBytes}, largest ${largest} / ${report.budgets.largestGzipBytes} bytes`);
if (total > report.budgets.totalGzipBytes || largest > report.budgets.largestGzipBytes) throw new Error("Frontend build budget exceeded.");
