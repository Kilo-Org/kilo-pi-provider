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

export interface KiloUsageEntry {
	date: string;
	totalCostMicrodollars: number;
}

function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function fetchKiloUsageEntries(
	access: KiloAccess,
	period: KiloUsageFetchPeriod,
): Promise<KiloUsageEntry[] | null> {
	try {
		const viewType = access.organizationId ?? "personal";
		const response = await fetch(
			`${KILO_PROFILE_ENDPOINT}/usage?period=${period}&viewType=${encodeURIComponent(viewType)}`,
			{
				headers: withOrganizationHeader({ Authorization: `Bearer ${access.token}` }, access.organizationId),
				signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
			},
		);
		if (!response.ok) return null;

		const data = (await response.json()) as { usage?: unknown };
		if (!Array.isArray(data.usage)) return null;

		return data.usage.flatMap((entry) => {
			if (!entry || typeof entry !== "object") return [];
			const { date, total_cost: totalCost } = entry as { date?: unknown; total_cost?: unknown };
			if (!isIsoDate(date) || typeof totalCost !== "number" || !Number.isFinite(totalCost)) return [];
			return [{ date, totalCostMicrodollars: totalCost }];
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
