import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getEnvironmentPreferences, loadKiloPreferences, mergeKiloPreferences } from "../src/config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	vi.unstubAllEnvs();
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("merges global, project, and environment preferences in precedence order", () => {
	expect(
		mergeKiloPreferences(
			{ footer: { custom: false }, credits: { enabled: false }, usage: { periods: ["week"] } },
			{ credits: { enabled: true } },
			{ credits: { enabled: false }, usage: { periods: ["day", "month"] } },
		),
	).toEqual({ footer: { custom: false }, credits: { enabled: false }, usage: { periods: ["day", "month"] } });
});

test.each([
	["KILO_USAGE=day,week", { KILO_USAGE: "day,week" }, ["day", "week"]],
	["legacy truthy KILO_USAGE", { KILO_USAGE: "true" }, ["day"]],
	["disabled KILO_USAGE", { KILO_USAGE: "0" }, []],
])("parses %s", (_name, environment, periods) => {
	expect(getEnvironmentPreferences(environment).usage?.periods).toEqual(periods);
});

test("uses defaults for unrecognized boolean environment values", () => {
	expect(getEnvironmentPreferences({ KILO_CUSTOM_FOOTER: "maybe", KILO_SHOW_CREDITS: "unexpected" })).toMatchObject({
		footer: { custom: true },
		credits: { enabled: true },
	});
});

describe("loadKiloPreferences", () => {
	function createDirectory(): string {
		const directory = mkdtempSync(join(tmpdir(), "kilo-config-test-"));
		temporaryDirectories.push(directory);
		return directory;
	}

	function writeConfig(root: string, config: unknown): void {
		const directory = join(root, "extensions", "kilo-pi-provider");
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "config.json"), typeof config === "string" ? config : JSON.stringify(config));
	}

	test("uses trusted project preferences over global preferences", () => {
		const agentDirectory = createDirectory();
		const cwd = createDirectory();
		writeConfig(agentDirectory, { credits: { enabled: false }, usage: { periods: ["week"] } });
		writeConfig(join(cwd, ".pi"), { credits: { enabled: true }, usage: { periods: ["day", "month"] } });

		expect(loadKiloPreferences({ agentDirectory, cwd, projectTrusted: true, environment: {} })).toEqual({
			footer: { custom: true },
			credits: { enabled: true },
			usage: { periods: ["day", "month"] },
		});
	});

	test("ignores untrusted project preferences and lets environment override config", () => {
		const agentDirectory = createDirectory();
		const cwd = createDirectory();
		writeConfig(agentDirectory, { credits: { enabled: false } });
		writeConfig(join(cwd, ".pi"), { credits: { enabled: true } });

		expect(
			loadKiloPreferences({
				agentDirectory,
				cwd,
				projectTrusted: false,
				environment: { KILO_SHOW_CREDITS: "true", KILO_CUSTOM_FOOTER: "0", KILO_USAGE: "day,week" },
			}),
		).toEqual({ footer: { custom: false }, credits: { enabled: true }, usage: { periods: ["day", "week"] } });
	});

	test("ignores nested values that are not objects", () => {
		const agentDirectory = createDirectory();
		const cwd = createDirectory();
		writeConfig(agentDirectory, { footer: true, credits: [], usage: "day" });

		expect(loadKiloPreferences({ agentDirectory, cwd, projectTrusted: false, environment: {} })).toEqual({
			footer: { custom: true },
			credits: { enabled: true },
			usage: { periods: [] },
		});
	});

	test.each(["{", "null", "[]"])("falls back to defaults for invalid config: %s", (config) => {
		const agentDirectory = createDirectory();
		const cwd = createDirectory();
		writeConfig(agentDirectory, config);

		expect(loadKiloPreferences({ agentDirectory, cwd, projectTrusted: false, environment: {} })).toEqual({
			footer: { custom: true },
			credits: { enabled: true },
			usage: { periods: [] },
		});
	});
});
