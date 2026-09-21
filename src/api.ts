import Type from "typebox";
import Value from "typebox/value";
export const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
const KILO_PROFILE_ENDPOINT = `${KILO_API_BASE}/api/profile`;
export const KILO_ORG_HEADER = "X-KiloCode-OrganizationId";
const USAGE_FETCH_TIMEOUT_MS = 10_000;

export interface KiloAccess {
	token: string;
	organizationId?: string;
}

export function withOrganizationHeader(
	headers: Record<string, string>,
	organizationId?: string,
): Record<string, string> {
	if (!organizationId) return headers;
	return { ...headers, [KILO_ORG_HEADER]: organizationId };
}

export interface KiloOrganization {
	id: string;
	name: string;
	role?: string;
}

export interface KiloProfile {
	user?: { email?: string; name?: string };
	email?: string;
	name?: string;
	organizations?: KiloOrganization[];
}

export async function fetchKiloProfile(token: string): Promise<KiloProfile> {
	const response = await fetch(KILO_PROFILE_ENDPOINT, {
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch Kilo profile: ${response.status}`);
	}

	return (await response.json()) as KiloProfile;
}

interface KiloBalance {
	balance?: number;
}

export type KiloUsageFetchPeriod = "week" | "month" | "year" | "all";

const BaseUsageRow = Type.Object({ date: Type.String(), total_cost: Type.Number() });
const GroupedUsageRow = Type.Object({
	date: Type.String(),
	total_cost: Type.Number(),
	model: Type.Optional(Type.Unknown()),
	total_input_tokens: Type.Optional(Type.Unknown()),
	total_output_tokens: Type.Optional(Type.Unknown()),
	total_cache_write_tokens: Type.Optional(Type.Unknown()),
	total_cache_hit_tokens: Type.Optional(Type.Unknown()),
});
const UsageString = Type.String();
const UsageNumber = Type.Number();
type BaseUsageRow = Type.Static<typeof BaseUsageRow>;
type GroupedUsageRow = Type.Static<typeof GroupedUsageRow>;

export interface KiloUsageEntry {
	date: string;
	totalCostMicrodollars: number;
	model?: string;
	totalInputTokens?: number;
	totalOutputTokens?: number;
	totalCacheWriteTokens?: number;
	totalCacheHitTokens?: number;
}

export interface KiloUsageRequestOptions {
	groupByModel?: boolean;
	signal?: AbortSignal;
}

function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function fetchKiloUsageEntries(
	access: KiloAccess,
	period: KiloUsageFetchPeriod,
	options: KiloUsageRequestOptions = {},
): Promise<KiloUsageEntry[] | null> {
	try {
		const viewType = access.organizationId ?? "personal";
		const query = new URLSearchParams({ period, viewType });
		if (options.groupByModel) query.set("groupByModel", "true");
		const timeout = AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS);
		const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
		const response = await fetch(`${KILO_PROFILE_ENDPOINT}/usage?${query}`, {
			headers: withOrganizationHeader({ Authorization: `Bearer ${access.token}` }, access.organizationId),
			signal,
		});
		if (!response.ok) return null;

		const data = (await response.json()) as { usage?: unknown };
		if (!Array.isArray(data.usage)) return null;

		return data.usage.flatMap((entry) => {
			if (!Value.Check(BaseUsageRow, entry)) return [];
			const base: BaseUsageRow = Value.Decode(BaseUsageRow, entry);
			if (!isIsoDate(base.date) || !Number.isFinite(base.total_cost)) return [];
			if (!options.groupByModel) return [{ date: base.date, totalCostMicrodollars: base.total_cost }];
			const row: GroupedUsageRow = Value.Decode(GroupedUsageRow, entry);
			return [
				{
					date: base.date,
					totalCostMicrodollars: base.total_cost,
					model: Value.Check(UsageString, row.model) ? row.model : "Unknown model",
					totalInputTokens: Value.Check(UsageNumber, row.total_input_tokens) ? row.total_input_tokens : 0,
					totalOutputTokens: Value.Check(UsageNumber, row.total_output_tokens) ? row.total_output_tokens : 0,
					totalCacheWriteTokens: Value.Check(UsageNumber, row.total_cache_write_tokens)
						? row.total_cache_write_tokens
						: 0,
					totalCacheHitTokens: Value.Check(UsageNumber, row.total_cache_hit_tokens)
						? row.total_cache_hit_tokens
						: 0,
				},
			];
		});
	} catch {
		return null;
	}
}

export async function fetchKiloBalance(token: string, organizationId?: string): Promise<number | null> {
	try {
		const response = await fetch(`${KILO_PROFILE_ENDPOINT}/balance`, {
			headers: withOrganizationHeader(
				{
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				organizationId,
			),
		});

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as KiloBalance;
		return data.balance ?? null;
	} catch {
		return null;
	}
}
