import type { KiloAccess, KiloUsageEntry, KiloUsageFetchPeriod } from "./api.ts";

export type KiloUsageDisplayPeriod = "day" | "week" | "month" | "year";

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

export function getRequestedUsagePeriods(): KiloUsageDisplayPeriod[] {
	const value = process.env.KILO_USAGE?.trim().toLowerCase();
	return ["1", "true", "yes", "day"].includes(value ?? "") ? ["day"] : [];
}

export function getUsageFetchPeriod(periods: KiloUsageDisplayPeriod[]): KiloUsageFetchPeriod {
	if (periods.includes("year")) return "year";
	if (periods.includes("month")) return "month";
	return "week";
}

export function sumUsageForDay(entries: KiloUsageEntry[], date: Date): number {
	const today = date.toISOString().slice(0, 10);
	return entries
		.filter((entry) => entry.date === today)
		.reduce((total, entry) => total + entry.totalCostMicrodollars, 0);
}

function sumUsage(entries: KiloUsageEntry[]): number {
	return entries.reduce((total, entry) => total + entry.totalCostMicrodollars, 0);
}

function formatUsage(microdollars: number, period: KiloUsageDisplayPeriod): string {
	const label =
		period === "day" ? "today" : period === "week" ? "this week" : period === "month" ? "this month" : "this year";
	return `💸 $${(microdollars / 1_000_000).toFixed(2)} ${label}`;
}

function getUsageStatusKey(period: KiloUsageDisplayPeriod): string {
	return `${USAGE_STATUS_PREFIX}${period}`;
}

function clearUsageStatuses(presentation: UsageStatusPresentation): void {
	for (const period of ["day", "week", "month", "year"] as const) {
		presentation.setStatus(getUsageStatusKey(period), undefined);
	}
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
				const spend = period === "day" ? sumUsageForDay(entries, now()) : sumUsage(entries);
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
		refresh(access: KiloAccess, presentation: UsageStatusPresentation): void {
			const periods = getRequestedUsagePeriods();
			if (periods.length === 0) {
				revision += 1;
				queued = undefined;
				clearUsageStatuses(presentation);
				return;
			}

			revision += 1;
			const request = { access, periods, presentation, revision };
			if (running) {
				queued = request;
				return;
			}

			running = true;
			void run(request);
		},
		clear(presentation: UsageStatusPresentation): void {
			revision += 1;
			queued = undefined;
			clearUsageStatuses(presentation);
		},
	};
}
