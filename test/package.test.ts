import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
);

test("declared Pi extension entry points exist", () => {
  expect(packageJson.pi.extensions).not.toHaveLength(0);

  for (const extension of packageJson.pi.extensions) {
    expect(existsSync(resolve(repositoryRoot, extension)), `${extension} does not exist`).toBe(true);
  }
});
