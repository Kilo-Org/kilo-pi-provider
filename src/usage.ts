import type { KiloAccess, KiloUsageEntry, KiloUsageFetchPeriod } from "./api.ts";
import type { KiloUsageDisplayPeriod } from "./config.ts";

export type { KiloUsageDisplayPeriod } from "./config.ts";

const USAGE_STATUS_PREFIX = "kilo-usage-";

export interface UsageStatusPresentation {
	setStatus(key: string, value: string | undefined): void;
	accent(text: string): string;
}

interface UsageRefreshRequest {
	access: KiloAccess;
	periods: KiloUsageDisplayPeriod[];
	presentation: UsageStatusPresentation;
	revision: number;
}

interface UsageRefresherOptions {
	fetchUsageEntries(access: KiloAccess, period: KiloUsageFetchPeriod): Promise<KiloUsageEntry[] | null>;
	now?(): Date;
}

export function getUsageFetchPeriod(periods: KiloUsageDisplayPeriod[]): KiloUsageFetchPeriod {
	if (periods.includes("year")) return "year";
	if (periods.includes("month")) return "month";
	return "week";
}

export function sumUsageForDay(entries: KiloUsageEntry[], date: Date): number {
	return sumUsageForPeriod(entries, "day", date);
}

function startOfUtcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function nextPeriodBoundary(period: KiloUsageDisplayPeriod, now: Date): [string, string] {
	const start = startOfUtcDay(now);
	if (period === "week") {
		const daysSinceMonday = (start.getUTCDay() + 6) % 7;
		start.setUTCDate(start.getUTCDate() - daysSinceMonday);
	} else if (period === "month") {
		start.setUTCDate(1);
	} else if (period === "year") {
		start.setUTCMonth(0, 1);
	}

	const end = new Date(start);
	if (period === "day") end.setUTCDate(end.getUTCDate() + 1);
	if (period === "week") end.setUTCDate(end.getUTCDate() + 7);
	if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
	if (period === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
	return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

export function sumUsageForPeriod(entries: KiloUsageEntry[], period: KiloUsageDisplayPeriod, now: Date): number {
	const [start, end] = nextPeriodBoundary(period, now);
	return entries
		.filter((entry) => entry.date >= start && entry.date < end)
		.reduce((total, entry) => total + entry.totalCostMicrodollars, 0);
}

function formatUsage(microdollars: number, period: KiloUsageDisplayPeriod): string {
	const label =
		period === "day" ? "today" : period === "week" ? "this week" : period === "month" ? "this month" : "this year";
	return `💸 $${(microdollars / 1_000_000).toFixed(2)} ${label}`;
}

function getUsageStatusKey(period: KiloUsageDisplayPeriod): string {
	return `${USAGE_STATUS_PREFIX}${period}`;
}

export function createUsageRefresher(options: UsageRefresherOptions) {
	const now = options.now ?? (() => new Date());
	let running = false;
	let queued: UsageRefreshRequest | undefined;
	let revision = 0;

	async function run(request: UsageRefreshRequest): Promise<void> {
		try {
			const entries = await options.fetchUsageEntries(request.access, getUsageFetchPeriod(request.periods));
			if (!entries || request.revision !== revision) return;

			for (const period of request.periods) {
				const spend = sumUsageForPeriod(entries, period, now());
				request.presentation.setStatus(
					getUsageStatusKey(period),
					request.presentation.accent(formatUsage(spend, period)),
				);
			}
		} catch {
			// Usage is a background status; never let it reject a Pi lifecycle handler.
		} finally {
			if (queued) {
				const next = queued;
				queued = undefined;
				void run(next);
			} else {
				running = false;
			}
		}
	}

	return {
		refresh(access: KiloAccess, periods: KiloUsageDisplayPeriod[], presentation: UsageStatusPresentation): void {
			if (periods.length === 0) return;

			revision += 1;
			const request = { access, periods, presentation, revision };
			if (running) {
				queued = request;
				return;
			}

			running = true;
			void run(request);
		},
	};
}
