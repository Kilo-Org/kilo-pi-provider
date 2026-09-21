import { Key, matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { KiloAccess, KiloUsageEntry, KiloUsageFetchPeriod } from "./api.ts";
import type { KiloUsageDisplayPeriod } from "./config.ts";
import { formatTokens } from "./format.ts";

export type { KiloUsageDisplayPeriod } from "./config.ts";

const USAGE_STATUS_PREFIX = "kilo-usage-";

export interface UsageStatusPresentation {
	setStatus(key: string, value: string | undefined): void;
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
				request.presentation.setStatus(getUsageStatusKey(period), formatUsage(spend, period));
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
		invalidate(): void {
			revision += 1;
			queued = undefined;
		},
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

export interface UsagePopupOptions {
	theme: { fg(tone: string, text: string): string };
	onClose(): void;
	entries: KiloUsageEntry[] | null;
	error?: string;
	now?(): Date;
}

interface UsageSummary {
	spend: number;
	input: number;
	output: number;
	cacheWrite: number;
	cacheHit: number;
}

function addSummary(total: UsageSummary, entry: KiloUsageEntry): UsageSummary {
	return {
		spend: total.spend + entry.totalCostMicrodollars,
		input: total.input + (entry.totalInputTokens ?? 0),
		output: total.output + (entry.totalOutputTokens ?? 0),
		cacheWrite: total.cacheWrite + (entry.totalCacheWriteTokens ?? 0),
		cacheHit: total.cacheHit + (entry.totalCacheHitTokens ?? 0),
	};
}

function summarize(entries: KiloUsageEntry[]): UsageSummary {
	return entries.reduce(addSummary, { spend: 0, input: 0, output: 0, cacheWrite: 0, cacheHit: 0 });
}

function isZeroSummary(summary: UsageSummary): boolean {
	return (
		summary.spend === 0 &&
		summary.input === 0 &&
		summary.output === 0 &&
		summary.cacheHit === 0 &&
		summary.cacheWrite === 0
	);
}

type UsageTableView = "usage" | "models";

type UsageTableRow = {
	label: string;
	summary: UsageSummary;
};

const tableHeaders: TableCells = ["Period", "Spend", "Input", "Output", "Cache read", "Cache write"];

function formatSpend(microdollars: number): string {
	return `$${(microdollars / 1_000_000).toFixed(2)}`;
}

function dateFromUtcBoundary(boundary: string): Date {
	return new Date(`${boundary}T00:00:00.000Z`);
}

const shortUtcMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longUtcMonths = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function usagePeriodLabel(period: KiloUsageDisplayPeriod, start: string, end: string): string {
	if (period === "day") return "Today";
	const startDate = dateFromUtcBoundary(start);
	if (period === "month") return `${longUtcMonths[startDate.getUTCMonth()]} ${startDate.getUTCFullYear()}`;
	if (period === "year") return String(startDate.getUTCFullYear());
	const endDate = dateFromUtcBoundary(end);
	endDate.setUTCDate(endDate.getUTCDate() - 1);
	const startMonth = shortUtcMonths[startDate.getUTCMonth()]!;
	const endMonth = shortUtcMonths[endDate.getUTCMonth()]!;
	return `This week · ${startMonth} ${startDate.getUTCDate()}–${startMonth === endMonth ? "" : `${endMonth} `}${endDate.getUTCDate()}`;
}

function usageTableRows(entries: KiloUsageEntry[], now: Date): UsageTableRow[] {
	const periods: KiloUsageDisplayPeriod[] = ["day", "week", "month", "year"];
	return periods.map((period) => {
		const [start, end] = nextPeriodBoundary(period, now);
		return {
			label: usagePeriodLabel(period, start, end),
			summary: summarize(entries.filter((entry) => entry.date >= start && entry.date < end)),
		};
	});
}

function modelTableRows(entries: KiloUsageEntry[], now: Date): UsageTableRow[] {
	const [start, end] = nextPeriodBoundary("year", now);
	const totals = new Map<string, UsageSummary>();
	for (const entry of entries.filter((item) => item.date >= start && item.date < end)) {
		const model = entry.model ?? "Unknown model";
		totals.set(
			model,
			addSummary(totals.get(model) ?? { spend: 0, input: 0, output: 0, cacheWrite: 0, cacheHit: 0 }, entry),
		);
	}
	return [...totals.entries()]
		.filter(([, summary]) => !isZeroSummary(summary))
		.sort((left, right) => right[1].spend - left[1].spend)
		.map(([label, summary]) => ({ label, summary }));
}

function pad(value: string, width: number, align: "left" | "right"): string {
	const clipped = stripTerminalSequences(truncateToWidth(value, width, "…"));
	const spaces = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	return align === "left" ? `${clipped}${spaces}` : `${spaces}${clipped}`;
}

type TableCells = [string, string, string, string, string, string];

function tableValues(rows: UsageTableRow[]): TableCells[] {
	return rows.map((row) => [
		stripTerminalSequences(row.label),
		formatSpend(row.summary.spend),
		formatTokens(row.summary.input),
		formatTokens(row.summary.output),
		formatTokens(row.summary.cacheHit),
		formatTokens(row.summary.cacheWrite),
	]);
}

function stackedRows(rows: UsageTableRow[], width: number): string[] {
	return rows.flatMap((row) => {
		const fields = [
			`I ${row.summary.input}`,
			`O ${row.summary.output}`,
			`R ${row.summary.cacheHit}`,
			`W ${row.summary.cacheWrite}`,
		];
		const label = stripTerminalSequences(row.label);
		const spend = formatSpend(row.summary.spend);
		const summary = `${label}: ${spend}`;
		const lines =
			visibleWidth(summary) <= width
				? [summary]
				: [
						stripTerminalSequences(truncateToWidth(label, width, "…")),
						stripTerminalSequences(truncateToWidth(spend, width, "…")),
					];
		let current = "";
		for (const field of fields) {
			const next = current ? `${current} ${field}` : field;
			if (current && visibleWidth(next) > width) {
				lines.push(stripTerminalSequences(truncateToWidth(current, width, "…")));
				current = field;
			} else current = next;
		}
		if (current) lines.push(stripTerminalSequences(truncateToWidth(current, width, "…")));
		return lines;
	});
}

function formatTable(rows: UsageTableRow[], width: number, headers: TableCells): UsageTableLayout {
	const values = tableValues(rows);
	const numericWidths = [
		Math.max(6, visibleWidth(headers[1]), ...values.map((value) => visibleWidth(value[1]))),
		Math.max(10, visibleWidth(headers[2]), ...values.map((value) => visibleWidth(value[2]))),
		Math.max(6, visibleWidth(headers[3]), ...values.map((value) => visibleWidth(value[3]))),
		Math.max(10, visibleWidth(headers[4]), ...values.map((value) => visibleWidth(value[4]))),
		Math.max(11, visibleWidth(headers[5]), ...values.map((value) => visibleWidth(value[5]))),
	] as const;
	const requiredWidth = numericWidths.reduce((total, value) => total + value, 0) + 6;
	if (width < requiredWidth) return { rows: stackedRows(rows, width) };
	const widths = [width - requiredWidth + 1, ...numericWidths] as const;
	const formatRow = (value: TableCells): string =>
		value.map((cell, index) => pad(cell, widths[index] ?? 1, index === 0 ? "left" : "right")).join(" ");
	const separator = widths.map((columnWidth) => "─".repeat(columnWidth)).join(" ");
	return { rows: [formatRow(headers), separator, ...values.map(formatRow)], separatorIndex: 1 };
}

interface UsageTableLayout {
	rows: string[];
	separatorIndex?: number;
}

function calculateUsageTableLayout(
	entries: KiloUsageEntry[],
	now: Date,
	width: number,
	view: UsageTableView = "usage",
): UsageTableLayout {
	const rows = view === "models" ? modelTableRows(entries, now) : usageTableRows(entries, now);
	const headers: TableCells =
		view === "models" ? ["Model", "Spend", "Input", "Output", "Cache read", "Cache write"] : tableHeaders;
	return formatTable(rows, Math.max(1, width), headers);
}

/** Returns unthemed, display-width-safe rows for the Usage or Models table. */
export function calculateUsageTable(
	entries: KiloUsageEntry[],
	now: Date,
	width: number,
	view: UsageTableView = "usage",
): string[] {
	return calculateUsageTableLayout(entries, now, width, view).rows;
}

export function createUsagePopup(options: UsagePopupOptions) {
	let models = false;
	let entries = options.entries;
	let error = options.error;
	const now = options.now ?? (() => new Date());
	const line = (text: string, width: number): string => truncateToWidth(text, width);
	const contentWidth = (width: number): number => (width < 5 ? width : width >= 56 ? width - 4 : width - 2);
	const frame = (content: string[], width: number): string[] => {
		if (width < 5) return content.map((item) => line(item, width));
		const inner = contentWidth(width);
		const padded = inner === width - 4;
		const border = options.theme.fg("border", "│");
		const top = options.theme.fg("border", `┌${"─".repeat(width - 2)}┐`);
		const bottom = options.theme.fg("border", `└${"─".repeat(width - 2)}┘`);
		return [
			top,
			...content.map((item) => {
				const clipped = line(item, inner);
				const spaces = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
				return padded ? `${border} ${clipped}${spaces} ${border}` : `${border}${clipped}${spaces}${border}`;
			}),
			bottom,
		].map((item) => truncateToWidth(item, width));
	};
	const render = (width: number): string[] => {
		const renderNow = now();
		const [yearStart] = nextPeriodBoundary("year", renderNow);
		const tabs = models
			? `${options.theme.fg("muted", "Usage")}  ${options.theme.fg("accent", "[Models]")}`
			: `${options.theme.fg("accent", "[Usage]")}  ${options.theme.fg("muted", "Models")}`;
		const prefix = models
			? [tabs, "", options.theme.fg("muted", `Current year · ${yearStart.slice(0, 4)}`), ""]
			: [tabs, ""];
		if (error)
			return frame(
				[...prefix, options.theme.fg("error", error), "", options.theme.fg("muted", "Tab/←/→ switch • Esc close")],
				width,
			);
		if (entries === null)
			return frame(
				[
					...prefix,
					options.theme.fg("muted", "Loading usage…"),
					"",
					options.theme.fg("muted", "Tab/←/→ switch • Esc close"),
				],
				width,
			);
		if (entries.length === 0)
			return frame(
				[
					...prefix,
					options.theme.fg("muted", "No usage available"),
					"",
					options.theme.fg("muted", "Tab/←/→ switch • Esc close"),
				],
				width,
			);
		const populatedEntries = entries;
		const modelRows = modelTableRows(populatedEntries, renderNow);
		if (models && modelRows.length === 0) {
			const emptyMessage = "No model usage available";
			const emptyLines =
				contentWidth(width) < visibleWidth(emptyMessage) ? ["No model usage", "available"] : [emptyMessage];
			return frame(
				[
					...prefix,
					...emptyLines.map((message) => options.theme.fg("muted", message)),
					"",
					options.theme.fg("muted", "Tab/←/→ switch • Esc close"),
				],
				width,
			);
		}
		const tableWidth = contentWidth(width);
		if (tableWidth >= 56) {
			const layout = calculateUsageTableLayout(populatedEntries, renderNow, tableWidth, models ? "models" : "usage");
			return frame(
				[
					...prefix,
					...layout.rows.map((row, index) =>
						index === layout.separatorIndex ? options.theme.fg("border", row) : row,
					),
					"",
					options.theme.fg("muted", "Tab/←/→ switch • Esc close"),
				],
				width,
			);
		}
		if (!models) {
			return frame(
				[
					...prefix,
					...stackedRows(usageTableRows(populatedEntries, renderNow), tableWidth),
					"",
					options.theme.fg("muted", "Tab/←/→ switch • Esc close"),
				],
				width,
			);
		}
		return frame(
			[
				...prefix,
				...stackedRows(modelRows, tableWidth),
				"",
				options.theme.fg("muted", "Tab/←/→ switch • Esc close"),
			],
			width,
		);
	};
	return {
		render,
		invalidate(): void {},
		setState(nextEntries: KiloUsageEntry[] | null, nextError?: string): void {
			entries = nextEntries;
			error = nextError;
		},
		handleInput(data: string): void {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) options.onClose();
			if (
				matchesKey(data, Key.tab) ||
				matchesKey(data, Key.shift("tab")) ||
				matchesKey(data, Key.right) ||
				matchesKey(data, Key.left)
			)
				models = !models;
		},
	};
}
