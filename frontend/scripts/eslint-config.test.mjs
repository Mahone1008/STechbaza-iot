import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { ESLint } from "eslint";

import config from "../eslint.config.mjs";

let workspace;
const originalCwd = process.cwd();
const reactVersion = createRequire(import.meta.url)("react/package.json").version;

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), "kerumo-eslint-"));
  for (const app of ["buyer", "factory"]) {
    const route = join(workspace, "apps", app, "src", "pages");
    await mkdir(route, { recursive: true });
    await writeFile(join(route, `${app}.tsx`), "export default function Page() { return null; }\n");
  }
  await writeFile(join(workspace, "apps", "README.txt"), "Not a Next.js root\n");
  process.chdir(join(workspace, "apps", "buyer"));
});

after(async () => {
  process.chdir(originalCwd);
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

// Справжнє правило Next.js має й далі знаходити маршрути після заміни glob.
// Override обмежено версією plugin: його єдиний fast-glob виклик —
// globSync(pattern, { onlyDirectories: true }) у get-root-dirs.
const roots = [
  ["default working directory", () => undefined, ["buyer"]],
  ["explicit current directory", () => ".", ["buyer"]],
  ["relative directory", () => "../factory", ["factory"]],
  ["absolute directory", () => join(workspace, "apps", "factory"), ["factory"]],
  ["wildcard", () => "../*", ["buyer", "factory"]],
  ["brace alternatives", () => "../{buyer,factory}", ["buyer", "factory"]],
  ["directory array", () => ["../buyer", "../factory"], ["buyer", "factory"]],
  ["Windows separators", () => "..\\factory", ["factory"]],
];

for (const [name, rootDir, routes] of roots) {
  test(`Next.js internal-link rule keeps working with ${name}`, async () => {
    const root = rootDir();
    const eslint = new ESLint({
      cwd: join(workspace, "apps", "buyer"),
      overrideConfigFile: true,
      overrideConfig: [
        ...config,
        { settings: { react: { version: reactVersion }, next: root === undefined ? {} : { rootDir: root } } },
      ],
    });
    const anchors = routes.map((route) => `<a href="/${route}">${route}</a>`).join("");
    const [result] = await eslint.lintText(
      `export default function Page() { return <>${anchors}<a href="https://example.com">External</a></>; }`,
      { filePath: "src/probe.tsx" },
    );
    assert.equal(result.fatalErrorCount, 0);
    assert.equal(result.messages.length, routes.length);
    for (const message of result.messages) {
      assert.equal(message.ruleId, "@next/next/no-html-link-for-pages");
      assert.equal(message.severity, 2);
    }
    for (const route of routes) {
      assert.ok(result.messages.some((message) => message.message.includes(`/${route}/`)));
    }
  });
}
