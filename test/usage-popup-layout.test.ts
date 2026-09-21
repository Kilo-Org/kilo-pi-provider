import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";

import type { KiloUsageEntry } from "../src/api.ts";
import { formatTokens } from "../src/format.ts";
import { calculateUsageTable, createUsagePopup } from "../src/usage.ts";

const now = new Date("2026-08-22T12:00:00.000Z");
const width = 80;
const entries: KiloUsageEntry[] = [
	{
		date: "2026-08-22",
		model: "kilo/very-long-model-name-that-must-truncate",
		totalCostMicrodollars: 45_300_000,
		totalInputTokens: 45_300_000,
		totalOutputTokens: 1_500,
		totalCacheHitTokens: 999_000,
		totalCacheWriteTokens: 10_000,
	},
	{
		date: "2026-08-21",
		model: "kilo/code",
		totalCostMicrodollars: 1_250_000,
		totalInputTokens: 100,
		totalOutputTokens: 1_000,
		totalCacheHitTokens: 10,
		totalCacheWriteTokens: 10,
	},
	{
		date: "2026-08-01",
		model: "kilo/code",
		totalCostMicrodollars: 2_000_000,
		totalInputTokens: 2_000,
		totalOutputTokens: 1_000,
		totalCacheHitTokens: 30,
		totalCacheWriteTokens: 20,
	},
	{
		date: "2026-01-01",
		model: "kilo/legacy",
		totalCostMicrodollars: 5_000_000,
		totalInputTokens: 5,
		totalOutputTokens: 6,
		totalCacheHitTokens: 7,
		totalCacheWriteTokens: 8,
	},
];

const usageRows = [
	"Period                        Spend      Input Output Cache read Cache write",
	"──────────────────────────── ────── ────────── ────── ────────── ───────────",
	"Today                        $45.30        45M   1.5k       999k         10k",
	"This week · Aug 17–23        $46.55        45M   2.5k       999k         10k",
	"August 2026                  $48.55        45M   3.5k       999k         10k",
	"2026                         $53.55        45M   3.5k       999k         10k",
];

const modelRows = [
	"Model                         Spend      Input Output Cache read Cache write",
	"──────────────────────────── ────── ────────── ────── ────────── ───────────",
	"kilo/very-long-model-name-t… $45.30        45M   1.5k       999k         10k",
	"kilo/legacy                   $5.00          5      6          7           8",
	"kilo/code                     $3.25       2.1k   2.0k         40          30",
];

function createPopup() {
	return createUsagePopup({
		theme: { fg: (_tone: string, text: string) => text },
		onClose: vi.fn(),
		entries,
		now: () => now,
	});
}

describe("usage popup table layout contract", () => {
	test("uses the shared compact token format at its unit boundaries", () => {
		expect([999, 1_000, 9_999, 10_000, 999_999, 1_000_000, 9_999_999, 10_000_000].map(formatTokens)).toEqual([
			"999",
			"1.0k",
			"10.0k",
			"10k",
			"1000k",
			"1.0M",
			"10.0M",
			"10M",
		]);
	});

	test("calculates exact aligned Usage rows at a screenshot-like width", () => {
		expect(calculateUsageTable(entries, now, 76)).toEqual(usageRows);
	});

	test("calculates exact spend-sorted Models rows and truncates only its model column", () => {
		expect(calculateUsageTable(entries, now, 76, "models")).toEqual(modelRows);
	});

	test("omits only Models whose current-year aggregate has no spend or token activity", () => {
		const filterEntries: KiloUsageEntry[] = [
			{
				date: "2026-02-01",
				model: "kilo/all-zero",
				totalCostMicrodollars: 0,
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalCacheHitTokens: 0,
				totalCacheWriteTokens: 0,
			},
			{
				date: "2026-02-01",
				model: "kilo/free-with-tokens",
				totalCostMicrodollars: 0,
				totalInputTokens: 12,
				totalOutputTokens: 0,
				totalCacheHitTokens: 0,
				totalCacheWriteTokens: 0,
			},
			{
				date: "2026-02-01",
				model: "kilo/tiny-cost",
				totalCostMicrodollars: 1,
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalCacheHitTokens: 0,
				totalCacheWriteTokens: 0,
			},
			{
				date: "2026-02-01",
				model: "kilo/cache-only",
				totalCostMicrodollars: 0,
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalCacheHitTokens: 3,
				totalCacheWriteTokens: 4,
			},
			{
				date: "2026-02-01",
				model: "kilo/aggregated-activity",
				totalCostMicrodollars: 0,
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalCacheHitTokens: 0,
				totalCacheWriteTokens: 0,
			},
			{
				date: "2026-02-02",
				model: "kilo/aggregated-activity",
				totalCostMicrodollars: 0,
				totalInputTokens: 0,
				totalOutputTokens: 5,
				totalCacheHitTokens: 0,
				totalCacheWriteTokens: 0,
			},
		];

		const modelTable = calculateUsageTable(filterEntries, now, 100, "models").join("\n");
		expect(modelTable).not.toContain("kilo/all-zero");
		for (const model of ["kilo/free-with-tokens", "kilo/tiny-cost", "kilo/cache-only", "kilo/aggregated-activity"])
			expect(modelTable).toContain(model);
		expect(modelTable).toContain("$0.00");

		const popup = createUsagePopup({
			theme: { fg: (_tone: string, text: string) => text },
			onClose: vi.fn(),
			entries: filterEntries,
			now: () => now,
		});
		popup.handleInput("\t");
		const renderedModels = popup.render(104).join("\n");
		expect(renderedModels).not.toContain("kilo/all-zero");
		expect(renderedModels).toContain("kilo/aggregated-activity");
	});

	test("frames normal-width content with one interior padding column and equal visible widths", () => {
		const output = createPopup().render(width);
		const content = output.slice(1, -1);
		expect(output[0]).toBe(`┌${"─".repeat(width - 2)}┐`);
		expect(output.at(-1)).toBe(`└${"─".repeat(width - 2)}┘`);
		expect(content.slice(0, 9).map((line) => line.slice(2, -2).trimEnd())).toEqual([
			"[Usage]  Models",
			"",
			...usageRows,
			"",
		]);
		for (const line of output) expect(visibleWidth(line)).toBe(width);
		for (const line of content) {
			expect(line).toMatch(/^│ /);
			expect(line).toMatch(/ │$/);
		}
	});

	test("sanitizes ANSI model labels before terminal-safe truncation", () => {
		const ansiEntries: KiloUsageEntry[] = [
			{ ...entries[0]!, model: "\u001b[31m模型🧪-very-long\u001b[0m\u001b]8;;https://example.test\u0007-name" },
		];
		const rows = calculateUsageTable(ansiEntries, now, 60, "models");
		expect(rows[2]).toContain("模型🧪-very…");
		expect(rows[2]).not.toContain("\u001b");
		expect(rows[2]).toMatch(/\$45\.30\s+45M\s+1\.5k\s+999k\s+10k$/);
		for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(60);
	});

	test("uses terminal-safe truncation for Unicode model names", () => {
		const unicodeEntries: KiloUsageEntry[] = [{ ...entries[0]!, model: "模型🧪-very-long-model-name" }];
		const rows = calculateUsageTable(unicodeEntries, now, 60, "models");
		for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(60);
		expect(rows[2]).toContain("…");
	});

	test("uses a stacked fallback before the first padded table viewport", () => {
		const popup = createPopup();
		expect(popup.render(59).slice(0, 5)).toEqual([
			"┌─────────────────────────────────────────────────────────┐",
			"│ [Usage]  Models                                         │",
			"│                                                         │",
			"│ Today: $45.30                                           │",
			"│ I 45300000 O 1500 R 999000 W 10000                      │",
		]);
		expect(popup.render(60)[3]).toContain("Period");
	});

	test("never overflows with oversized formatted values", () => {
		const oversized: KiloUsageEntry[] = [{ ...entries[0]!, totalCostMicrodollars: 1e100, totalInputTokens: 1e100 }];
		for (const narrowWidth of [1, 24, 48])
			for (const row of calculateUsageTable(oversized, now, narrowWidth))
				expect(visibleWidth(row)).toBeLessThanOrEqual(narrowWidth);
	});

	test("renders the full framed Models table at width 80", () => {
		const popup = createPopup();
		popup.handleInput("\t");
		expect(popup.render(80)).toEqual([
			"┌──────────────────────────────────────────────────────────────────────────────┐",
			"│ Usage  [Models]                                                              │",
			"│                                                                              │",
			"│ Current year · 2026                                                          │",
			"│                                                                              │",
			"│ Model                         Spend      Input Output Cache read Cache write │",
			"│ ──────────────────────────── ────── ────────── ────── ────────── ─────────── │",
			"│ kilo/very-long-model-name-t… $45.30        45M   1.5k       999k         10k │",
			"│ kilo/legacy                   $5.00          5      6          7           8 │",
			"│ kilo/code                     $3.25       2.1k   2.0k         40          30 │",
			"│                                                                              │",
			"│ Tab/←/→ switch • Esc close                                                   │",
			"└──────────────────────────────────────────────────────────────────────────────┘",
		]);
	});

	const usageAt80 = [
		"┌──────────────────────────────────────────────────────────────────────────────┐",
		"│ [Usage]  Models                                                              │",
		"│                                                                              │",
		"│ Period                        Spend      Input Output Cache read Cache write │",
		"│ ──────────────────────────── ────── ────────── ────── ────────── ─────────── │",
		"│ Today                        $45.30        45M   1.5k       999k         10k │",
		"│ This week · Aug 17–23        $46.55        45M   2.5k       999k         10k │",
		"│ August 2026                  $48.55        45M   3.5k       999k         10k │",
		"│ 2026                         $53.55        45M   3.5k       999k         10k │",
		"│                                                                              │",
		"│ Tab/←/→ switch • Esc close                                                   │",
		"└──────────────────────────────────────────────────────────────────────────────┘",
	];

	test("renders the full framed Usage table at width 80", () => {
		expect(createPopup().render(80)).toEqual(usageAt80);
	});

	const fallbackAt59 = [
		"┌─────────────────────────────────────────────────────────┐",
		"│ [Usage]  Models                                         │",
		"│                                                         │",
		"│ Today: $45.30                                           │",
		"│ I 45300000 O 1500 R 999000 W 10000                      │",
		"│ This week · Aug 17–23: $46.55                           │",
		"│ I 45300100 O 2500 R 999010 W 10010                      │",
		"│ August 2026: $48.55                                     │",
		"│ I 45302100 O 3500 R 999040 W 10030                      │",
		"│ 2026: $53.55                                            │",
		"│ I 45302105 O 3506 R 999047 W 10038                      │",
		"│                                                         │",
		"│ Tab/←/→ switch • Esc close                              │",
		"└─────────────────────────────────────────────────────────┘",
	];
	const tableAt60 = [
		"┌──────────────────────────────────────────────────────────┐",
		"│ [Usage]  Models                                          │",
		"│                                                          │",
		"│ Period    Spend      Input Output Cache read Cache write │",
		"│ ──────── ────── ────────── ────── ────────── ─────────── │",
		"│ Today    $45.30        45M   1.5k       999k         10k │",
		"│ This we… $46.55        45M   2.5k       999k         10k │",
		"│ August … $48.55        45M   3.5k       999k         10k │",
		"│ 2026     $53.55        45M   3.5k       999k         10k │",
		"│                                                          │",
		"│ Tab/←/→ switch • Esc close                               │",
		"└──────────────────────────────────────────────────────────┘",
	];
	test("locks both tab renderings at fallback and table viewports", () => {
		const modelsAt59 = [
			"┌─────────────────────────────────────────────────────────┐",
			"│ Usage  [Models]                                         │",
			"│                                                         │",
			"│ Current year · 2026                                     │",
			"│                                                         │",
			"│ kilo/very-long-model-name-that-must-truncate: $45.30    │",
			"│ I 45300000 O 1500 R 999000 W 10000                      │",
			"│ kilo/legacy: $5.00                                      │",
			"│ I 5 O 6 R 7 W 8                                         │",
			"│ kilo/code: $3.25                                        │",
			"│ I 2100 O 2000 R 40 W 30                                 │",
			"│                                                         │",
			"│ Tab/←/→ switch • Esc close                              │",
			"└─────────────────────────────────────────────────────────┘",
		];
		const modelsAt60 = [
			"┌──────────────────────────────────────────────────────────┐",
			"│ Usage  [Models]                                          │",
			"│                                                          │",
			"│ Current year · 2026                                      │",
			"│                                                          │",
			"│ Model     Spend      Input Output Cache read Cache write │",
			"│ ──────── ────── ────────── ────── ────────── ─────────── │",
			"│ kilo/ve… $45.30        45M   1.5k       999k         10k │",
			"│ kilo/le…  $5.00          5      6          7           8 │",
			"│ kilo/co…  $3.25       2.1k   2.0k         40          30 │",
			"│                                                          │",
			"│ Tab/←/→ switch • Esc close                               │",
			"└──────────────────────────────────────────────────────────┘",
		];
		for (const [viewport, usage, models] of [
			[59, fallbackAt59, modelsAt59],
			[60, tableAt60, modelsAt60],
		] as const) {
			const popup = createPopup();
			expect(popup.render(viewport)).toEqual(usage);
			popup.handleInput("\t");
			expect(popup.render(viewport)).toEqual(models);
		}
	});

	test.each([
		[new Date("2026-09-16T12:00:00.000Z"), "This week · Sep 14–20"],
		[new Date("2026-09-30T12:00:00.000Z"), "This week · Sep 28–Oct 4"],
		[new Date("2027-01-01T12:00:00.000Z"), "This week · Dec 28–Jan 3"],
	])("uses concise UTC week labels across calendar boundaries", (weekNow, label) => {
		const popup = createUsagePopup({
			theme: { fg: (_tone: string, text: string) => text },
			onClose: vi.fn(),
			entries,
			now: () => weekNow,
		});
		expect(popup.render(80).join("\n")).toContain(label);
	});

	test("keeps every table line within genuinely narrow widths", () => {
		const popup = createPopup();
		for (const narrowWidth of [1, 8, 24]) {
			for (const line of popup.render(narrowWidth)) expect(visibleWidth(line)).toBeLessThanOrEqual(narrowWidth);
			popup.handleInput("\t");
			for (const line of popup.render(narrowWidth)) expect(visibleWidth(line)).toBeLessThanOrEqual(narrowWidth);
			popup.handleInput("\t");
		}
	});
});
