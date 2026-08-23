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

test("installs a Prek hook that runs the Biome check", () => {
	expect(packageJson.scripts.prepare).toBe("prek install");
	expect(packageJson.devDependencies["@j178/prek"]).toBe("0.4.14");

	const prekConfig = readFileSync(resolve(repositoryRoot, "prek.toml"), "utf8");
	expect(prekConfig).toContain('entry = "npm run check"');
	expect(prekConfig).toContain("pass_filenames = false");
});
