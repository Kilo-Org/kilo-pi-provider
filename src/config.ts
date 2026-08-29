import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const KILO_USAGE_PERIODS = ["day", "week", "month", "year"] as const;
export type KiloUsageDisplayPeriod = (typeof KILO_USAGE_PERIODS)[number];

export type KiloPreferences = {
	footer?: { custom?: boolean };
	credits?: { enabled?: boolean };
	usage?: { periods?: KiloUsageDisplayPeriod[] };
};

export type ResolvedKiloPreferences = {
	footer: { custom: boolean };
	credits: { enabled: boolean };
	usage: { periods: KiloUsageDisplayPeriod[] };
};

const CONFIG_DIRECTORY = "kilo-pi-provider";
const DEFAULT_PREFERENCES: ResolvedKiloPreferences = {
	footer: { custom: true },
	credits: { enabled: true },
	usage: { periods: [] },
};

function isUsagePeriod(value: unknown): value is KiloUsageDisplayPeriod {
	return typeof value === "string" && KILO_USAGE_PERIODS.includes(value as KiloUsageDisplayPeriod);
}

type PreferencesObject = {
	footer?: unknown;
	credits?: unknown;
	usage?: unknown;
};

function isPreferencesObject(value: unknown): value is PreferencesObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readKiloPreferences(path: string): KiloPreferences {
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isPreferencesObject(parsed)) return {};
		const footer = isPreferencesObject(parsed.footer) ? parsed.footer : undefined;
		const credits = isPreferencesObject(parsed.credits) ? parsed.credits : undefined;
		const usage = isPreferencesObject(parsed.usage) ? parsed.usage : undefined;
		return {
			footer: typeof footer?.custom === "boolean" ? { custom: footer.custom } : undefined,
			credits: typeof credits?.enabled === "boolean" ? { enabled: credits.enabled } : undefined,
			usage:
				Array.isArray(usage?.periods) && usage.periods.every(isUsagePeriod)
					? { periods: usage.periods }
					: undefined,
		};
	} catch {
		return {};
	}
}

function getConfigPath(root: string): string {
	return join(root, "extensions", CONFIG_DIRECTORY, "config.json");
}

function environmentBoolean(value: string | undefined, defaultValue: boolean): boolean | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "") return undefined;
	if (["1", "true", "yes"].includes(normalized)) return true;
	if (["0", "false", "no"].includes(normalized)) return false;
	return defaultValue;
}

function environmentUsagePeriods(value: string | undefined): KiloUsageDisplayPeriod[] | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "") return undefined;
	if (["1", "true", "yes"].includes(normalized)) return ["day"];
	if (["0", "false", "no"].includes(normalized)) return [];
	const periods = normalized
		.split(",")
		.map((period) => period.trim())
		.filter(Boolean);
	return periods.length > 0 && periods.every(isUsagePeriod) ? [...new Set(periods)] : [];
}

export function getEnvironmentPreferences(environment: NodeJS.ProcessEnv = process.env): KiloPreferences {
	return {
		footer: { custom: environmentBoolean(environment.KILO_CUSTOM_FOOTER, true) },
		credits: { enabled: environmentBoolean(environment.KILO_SHOW_CREDITS, true) },
		usage: { periods: environmentUsagePeriods(environment.KILO_USAGE) },
	};
}

export function mergeKiloPreferences(
	global: KiloPreferences,
	project: KiloPreferences | undefined,
	environment: KiloPreferences,
): ResolvedKiloPreferences {
	return {
		footer: {
			custom:
				environment.footer?.custom ??
				project?.footer?.custom ??
				global.footer?.custom ??
				DEFAULT_PREFERENCES.footer.custom,
		},
		credits: {
			enabled:
				environment.credits?.enabled ??
				project?.credits?.enabled ??
				global.credits?.enabled ??
				DEFAULT_PREFERENCES.credits.enabled,
		},
		usage: {
			periods:
				environment.usage?.periods ??
				project?.usage?.periods ??
				global.usage?.periods ??
				DEFAULT_PREFERENCES.usage.periods,
		},
	};
}

export function loadKiloPreferences(options: {
	agentDirectory?: string;
	cwd: string;
	projectTrusted: boolean;
	environment?: NodeJS.ProcessEnv;
}): ResolvedKiloPreferences {
	const agentDirectory = options.agentDirectory ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const global = readKiloPreferences(getConfigPath(agentDirectory));
	const project = options.projectTrusted ? readKiloPreferences(getConfigPath(join(options.cwd, ".pi"))) : undefined;
	return mergeKiloPreferences(global, project, getEnvironmentPreferences(options.environment));
}
