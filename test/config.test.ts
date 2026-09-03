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
	).toEqual({
		display: { showForOtherProviders: false },
		footer: { custom: false },
		credits: { enabled: false },
		usage: { periods: ["day", "month"] },
	});
});

test("hides ambient Kilo UI for other providers by default", () => {
	expect(mergeKiloPreferences({}, undefined, {}).display.showForOtherProviders).toBe(false);
});

test.each([
	["KILO_PI_USAGE=day,week", { KILO_PI_USAGE: "day,week" }, ["day", "week"]],
	["legacy truthy KILO_PI_USAGE", { KILO_PI_USAGE: "true" }, ["day"]],
	["disabled KILO_PI_USAGE", { KILO_PI_USAGE: "0" }, []],
])("parses %s", (_name, environment, periods) => {
	expect(getEnvironmentPreferences(environment).usage?.periods).toEqual(periods);
});

test.each(["1", "true", "yes"])(
	"KILO_PI_SHOW_FOR_OTHER_PROVIDERS=%s shows ambient Kilo UI for other providers",
	(value) => {
		expect(
			mergeKiloPreferences({}, undefined, getEnvironmentPreferences({ KILO_PI_SHOW_FOR_OTHER_PROVIDERS: value }))
				.display.showForOtherProviders,
		).toBe(true);
	},
);

test("uses defaults for unrecognized boolean environment values", () => {
	expect(
		getEnvironmentPreferences({ KILO_PI_CUSTOM_FOOTER: "maybe", KILO_PI_SHOW_CREDITS: "unexpected" }),
	).toMatchObject({
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
			display: { showForOtherProviders: false },
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
				environment: { KILO_PI_SHOW_CREDITS: "true", KILO_PI_CUSTOM_FOOTER: "0", KILO_PI_USAGE: "day,week" },
			}),
		).toEqual({
			display: { showForOtherProviders: false },
			footer: { custom: false },
			credits: { enabled: true },
			usage: { periods: ["day", "week"] },
		});
	});

	test("ignores nested values that are not objects", () => {
		const agentDirectory = createDirectory();
		const cwd = createDirectory();
		writeConfig(agentDirectory, { footer: true, credits: [], usage: "day" });

		expect(loadKiloPreferences({ agentDirectory, cwd, projectTrusted: false, environment: {} })).toEqual({
			display: { showForOtherProviders: false },
			footer: { custom: true },
			credits: { enabled: true },
			usage: { periods: [] },
		});
	});

	test("keeps valid sections when a sibling section is invalid", () => {
		const agentDirectory = createDirectory();
		const cwd = createDirectory();
		writeConfig(agentDirectory, {
			footer: { custom: false },
			credits: { enabled: "yes" },
			usage: { periods: ["day", "invalid"] },
		});

		expect(loadKiloPreferences({ agentDirectory, cwd, projectTrusted: false, environment: {} })).toEqual({
			display: { showForOtherProviders: false },
			footer: { custom: false },
			credits: { enabled: true },
			usage: { periods: [] },
		});
	});

	test("ignores unknown properties in valid sections", () => {
		const agentDirectory = createDirectory();
		const cwd = createDirectory();
		writeConfig(agentDirectory, {
			footer: { custom: false, unknown: 123 },
			credits: { enabled: false, unknown: 123 },
			usage: { periods: [], unknown: 123 },
			unknown: 123,
		});

		expect(loadKiloPreferences({ agentDirectory, cwd, projectTrusted: false, environment: {} })).toEqual({
			display: { showForOtherProviders: false },
			footer: { custom: false },
			credits: { enabled: false },
			usage: { periods: [] },
		});
	});

	test("ignores sections whose known property is absent", () => {
		const agentDirectory = createDirectory();
		const cwd = createDirectory();
		writeConfig(agentDirectory, { footer: {}, credits: {}, usage: {} });

		expect(loadKiloPreferences({ agentDirectory, cwd, projectTrusted: false, environment: {} })).toEqual({
			display: { showForOtherProviders: false },
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
			display: { showForOtherProviders: false },
			footer: { custom: true },
			credits: { enabled: true },
			usage: { periods: [] },
		});
	});
});
