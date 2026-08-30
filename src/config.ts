import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Type from "typebox";
import Value from "typebox/value";

export const KILO_USAGE_PERIODS = ["day", "week", "month", "year"] as const;
export type KiloUsageDisplayPeriod = (typeof KILO_USAGE_PERIODS)[number];

const FooterPreferences = Type.Object({ custom: Type.Optional(Type.Boolean()) });
const CreditsPreferences = Type.Object({ enabled: Type.Optional(Type.Boolean()) });
const UsagePreferences = Type.Object({
	periods: Type.Optional(Type.Array(Type.Enum(KILO_USAGE_PERIODS))),
});
// Validate sections separately so one malformed section does not discard valid siblings.
const PreferencesRoot = Type.Object({});

export type KiloPreferences = {
	footer?: Type.Static<typeof FooterPreferences>;
	credits?: Type.Static<typeof CreditsPreferences>;
	usage?: Type.Static<typeof UsagePreferences>;
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

function isUsagePeriod(value: string): value is KiloUsageDisplayPeriod {
	return KILO_USAGE_PERIODS.some((period) => period === value);
}

function readKiloPreferences(path: string): KiloPreferences {
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!Value.Check(PreferencesRoot, parsed)) return {};

		const footer = "footer" in parsed && Value.Check(FooterPreferences, parsed.footer) ? parsed.footer : undefined;
		const credits =
			"credits" in parsed && Value.Check(CreditsPreferences, parsed.credits) ? parsed.credits : undefined;
		const usage = "usage" in parsed && Value.Check(UsagePreferences, parsed.usage) ? parsed.usage : undefined;

		return {
			footer: footer?.custom === undefined ? undefined : { custom: footer.custom },
			credits: credits?.enabled === undefined ? undefined : { enabled: credits.enabled },
			usage: usage?.periods === undefined ? undefined : { periods: usage.periods },
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
		footer: { custom: environmentBoolean(environment.KILO_PI_CUSTOM_FOOTER, true) },
		credits: { enabled: environmentBoolean(environment.KILO_PI_SHOW_CREDITS, true) },
		usage: { periods: environmentUsagePeriods(environment.KILO_PI_USAGE) },
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
