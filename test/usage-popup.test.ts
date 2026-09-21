import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";

import { createUsagePopup } from "../src/usage.ts";

interface UsageFixtureEntry {
	date: string;
	model: string;
	totalCostMicrodollars: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheWriteTokens: number;
	totalCacheHitTokens: number;
}

interface PopupFixtureOptions {
	entries?: UsageFixtureEntry[] | null;
	error?: string;
	onClose?: () => void;
	now?: Date;
}

const entries: UsageFixtureEntry[] = [
	{
		date: "2026-08-22",
		model: "kilo/code",
		totalCostMicrodollars: 1_250_000,
		totalInputTokens: 100,
		totalOutputTokens: 200,
		totalCacheWriteTokens: 30,
		totalCacheHitTokens: 40,
	},
	{
		date: "2026-08-21",
		model: "kilo/reasoning",
		totalCostMicrodollars: 750_000,
		totalInputTokens: 50,
		totalOutputTokens: 60,
		totalCacheWriteTokens: 70,
		totalCacheHitTokens: 80,
	},
	{
		date: "2026-08-01",
		model: "kilo/code",
		totalCostMicrodollars: 2_000_000,
		totalInputTokens: 90,
		totalOutputTokens: 10,
		totalCacheWriteTokens: 20,
		totalCacheHitTokens: 30,
	},
	{
		date: "2026-01-01",
		model: "kilo/legacy",
		totalCostMicrodollars: 5_000_000,
		totalInputTokens: 5,
		totalOutputTokens: 6,
		totalCacheWriteTokens: 7,
		totalCacheHitTokens: 8,
	},
	{
		date: "2025-12-31",
		model: "kilo/prior-year",
		totalCostMicrodollars: 99_000_000,
		totalInputTokens: 1,
		totalOutputTokens: 1,
		totalCacheWriteTokens: 1,
		totalCacheHitTokens: 1,
	},
	{
		date: "2026-01-02",
		model: "kilo/low-spend",
		totalCostMicrodollars: 10_000,
		totalInputTokens: 1,
		totalOutputTokens: 1,
		totalCacheWriteTokens: 1,
		totalCacheHitTokens: 1,
	},
];

function createPopup(options: PopupFixtureOptions = {}) {
	return createUsagePopup({
		theme: { fg: (_tone: string, text: string) => text },
		onClose: options.onClose ?? vi.fn(),
		entries: options.entries === undefined ? [] : options.entries,
		error: options.error,
		now: () => options.now ?? new Date("2026-08-22T12:00:00.000Z"),
	});
}

describe("usage popup", () => {
	test("spaces loading, error, and empty states inside the popup", () => {
		expect(createPopup({ entries: null }).render(80)).toEqual([
			"┌──────────────────────────────────────────────────────────────────────────────┐",
			"│ [Usage]  Models                                                              │",
			"│                                                                              │",
			"│ Loading usage…                                                               │",
			"│                                                                              │",
			"│ Tab/←/→ switch • Esc close                                                   │",
			"└──────────────────────────────────────────────────────────────────────────────┘",
		]);
		for (const [popup, message] of [
			[createPopup({ error: "Network unavailable" }), "Network unavailable"],
			[createPopup(), "No usage available"],
		] as const) {
			const rendered = popup.render(80);
			expect(rendered.slice(1, -1).map((line) => line.slice(2, -2).trimEnd())).toEqual([
				"[Usage]  Models",
				"",
				message,
				"",
				"Tab/←/→ switch • Esc close",
			]);
		}
		for (const [popup, message] of [
			[createPopup({ entries: null }), "Loading usage…"],
			[createPopup({ error: "Network unavailable" }), "Network unavailable"],
			[createPopup(), "No usage available"],
		] as const) {
			popup.handleInput("\t");
			const rendered = popup.render(80);
			expect(rendered.slice(1, -1).map((line) => line.slice(2, -2).trimEnd())).toEqual([
				"Usage  [Models]",
				"",
				"Current year · 2026",
				"",
				message,
				"",
				"Tab/←/→ switch • Esc close",
			]);
		}
	});

	test("shows four UTC Usage periods with spend and token totals", () => {
		const output = createPopup({ entries }).render(100).join("\n");
		expect(output).toMatch(/Today[\s\S]*\$1\.25[\s\S]*100[\s\S]*200/);
		expect(output).toMatch(/This week[\s\S]*\$2\.00[\s\S]*150[\s\S]*260/);
		expect(output).toMatch(/August 2026[\s\S]*\$4\.00[\s\S]*240[\s\S]*270/);
		expect(output).toMatch(/2026[\s\S]*\$9\.01[\s\S]*246[\s\S]*277[\s\S]*159[\s\S]*128/);
	});

	test("sorts yearly model rows by spend", () => {
		const popup = createPopup({ entries });
		popup.handleInput("\t");
		const output = popup.render(100).join("\n");
		expect(output.indexOf("kilo/legacy")).toBeLessThan(output.indexOf("kilo/code"));
		expect(output.indexOf("kilo/code")).toBeLessThan(output.indexOf("kilo/reasoning"));
		expect(output).not.toContain("kilo/prior-year");
	});

	test("preserves long UTC period labels and spend in the narrow fallback", () => {
		const output = createPopup({ entries, now: new Date("2026-09-30T12:00:00.000Z") })
			.render(24)
			.join("\n");
		expect(output).toContain("This week · Sep 28–Oc…");
		expect(output).toContain("$0.00");
		for (const spend of ["$0.00", "$9.01"]) expect(output).toContain(spend);
	});

	test("toggles tabs with repeated tab and directional navigation", () => {
		const popup = createPopup({ entries });
		for (const key of ["\t", "\t", "\x1b[C", "\x1b[D", "\x1b[Z"]) {
			popup.handleInput(key);
			const output = popup.render(80).join("\n");
			expect(output).toMatch(/\[Usage\]|\[Models\]/);
			expect(output).not.toContain("[Models ·");
		}
	});

	test("keeps every active model in the narrow stacked Models view", () => {
		const popup = createPopup({
			entries: [
				...entries,
				{
					date: "2026-01-03",
					model: "kilo/fourth-active",
					totalCostMicrodollars: 1,
					totalInputTokens: 0,
					totalOutputTokens: 0,
					totalCacheWriteTokens: 0,
					totalCacheHitTokens: 0,
				},
			],
		});
		popup.handleInput("\t");
		const output = popup.render(24).join("\n");
		for (const model of ["kilo/legacy", "kilo/code", "kilo/reasoning", "kilo/fourth-active"])
			expect(output).toContain(model);
		expect(output).not.toMatch(/\d+ (more|omitted)/i);
		for (const line of output.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
	});

	test("shows an explicit Models empty state when no current-year model has activity", () => {
		const inactiveEntries: UsageFixtureEntry[] = [
			{
				date: "2026-08-22",
				model: "kilo/all-zero",
				totalCostMicrodollars: 0,
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalCacheWriteTokens: 0,
				totalCacheHitTokens: 0,
			},
			{ ...entries[0]!, date: "2025-12-31", model: "kilo/prior-year" },
		];
		for (const [width, message] of [
			[24, "No model usage\navailable"],
			[80, "No model usage available"],
		] as const) {
			const popup = createPopup({ entries: inactiveEntries });
			popup.handleInput("\t");
			const output = popup.render(width).join("\n");
			expect(output).toContain("Usage  [Models]");
			expect(output).toContain("Current year · 2026");
			for (const line of message.split("\n")) expect(output).toContain(line);
			expect(output).toContain("Tab/←/→ switch");
		}
	});

	test("uses semantic theme colors, help text, and display-safe widths", () => {
		const fg = vi.fn((_tone: string, text: string) => text);
		const popup = createUsagePopup({
			theme: { fg },
			onClose: vi.fn(),
			entries,
			now: () => new Date("2026-08-22T12:00:00.000Z"),
		});
		for (const state of [createPopup({ entries: null }), createPopup({ error: "offline" }), popup]) {
			for (const width of [1, 8, 24, 48, 100])
				for (const line of state.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		expect(popup.render(100).join("\n")).toContain("Esc close");
		expect(fg).toHaveBeenCalledWith("border", expect.any(String));
		expect(fg).toHaveBeenCalledWith("accent", expect.any(String));
		expect(fg).toHaveBeenCalledWith("muted", expect.any(String));
		popup.handleInput("\t");
		popup.render(100);
		expect(fg).toHaveBeenCalledWith("muted", "Current year · 2026");
		expect(fg).toHaveBeenCalledWith("accent", "[Models]");
		expect(fg).not.toHaveBeenCalledWith("accent", expect.stringContaining("2026"));
		const error = createUsagePopup({ theme: { fg }, onClose: vi.fn(), entries: [], error: "offline" });
		error.render(100);
		expect(fg).toHaveBeenCalledWith("error", "offline");
		const themed = vi.fn((_tone: string, text: string) => text);
		const oversized = createUsagePopup({
			theme: { fg: themed },
			onClose: vi.fn(),
			entries: [{ ...entries[0]!, totalCostMicrodollars: 1e100, totalInputTokens: 1e100 }],
			now: () => new Date("2026-08-22T12:00:00.000Z"),
		});
		oversized.render(80);
		for (const [tone, text] of themed.mock.calls)
			if (text.includes("$") || text.includes("Input") || text.includes("Output") || text.includes("Cache"))
				expect(tone).not.toBe("border");
	});

	test("closes for Escape and Ctrl+C", () => {
		const onClose = vi.fn();
		const popup = createPopup({ onClose });
		popup.handleInput("\x1b");
		popup.handleInput("\x03");
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
