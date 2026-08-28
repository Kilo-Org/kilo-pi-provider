import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));

test("declared Pi extension entry points exist", () => {
	expect(packageJson.pi.extensions).not.toHaveLength(0);

	for (const extension of packageJson.pi.extensions) {
		expect(existsSync(resolve(repositoryRoot, extension)), `${extension} does not exist`).toBe(true);
	}
});

test("provides the upstream Pi Biome check", () => {
	expect(packageJson.scripts.check).toBe("biome check --write --error-on-warnings .");
	expect(packageJson.devDependencies["@biomejs/biome"]).toBe("2.3.5");

	const biomeConfig = JSON.parse(readFileSync(resolve(repositoryRoot, "biome.json"), "utf8"));
	expect(biomeConfig).toMatchObject({
		linter: { enabled: true, rules: { recommended: true } },
		formatter: { enabled: true, indentStyle: "tab", indentWidth: 3, lineWidth: 120 },
	});
});

test("provides a Prek hook without running it during package installation", () => {
	expect(packageJson.scripts.prepare).toBeUndefined();
	expect(packageJson.devDependencies["@j178/prek"]).toBe("0.4.14");

	const prekConfig = readFileSync(resolve(repositoryRoot, "prek.toml"), "utf8");
	expect(prekConfig).toContain('entry = "npm run check"');
	expect(prekConfig).toContain("pass_filenames = false");
});

test("provides upstream-style V8 coverage reporting for source modules", () => {
	expect(packageJson.scripts["test:coverage"]).toBe("vitest run --coverage");
	expect(packageJson.devDependencies["@vitest/coverage-v8"]).toBe("4.1.9");

	const vitestConfig = readFileSync(resolve(repositoryRoot, "vitest.config.ts"), "utf8");
	expect(vitestConfig).toContain('provider: "v8"');
	expect(vitestConfig).toContain("all: true");
	expect(vitestConfig).toContain('include: ["src/**/*.ts"]');
	expect(vitestConfig).toContain('reporter: ["text", "html", "lcov"]');
});
