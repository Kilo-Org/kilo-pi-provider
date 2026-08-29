import { afterEach, expect, test, vi } from "vitest";
import type { FooterContext, FooterExtensionAPI } from "../src/footer.ts";
import { installCustomFooter, usesCustomFooter } from "../src/footer.ts";

afterEach(() => {
	vi.unstubAllEnvs();
});

test.each([
	[undefined, true],
	["1", true],
	["true", true],
	["unexpected", true],
	["0", false],
	["false", false],
	["FALSE", false],
	[" no ", false],
])("usesCustomFooter returns %s for KILO_CUSTOM_FOOTER=%s", (value, expected) => {
	vi.stubEnv("KILO_CUSTOM_FOOTER", value);
	expect(usesCustomFooter()).toBe(expected);
});

type FooterModel = NonNullable<FooterContext["model"]>;
type FooterEntries = ReturnType<FooterContext["sessionManager"]["getEntries"]>;
type FooterContextUsage = ReturnType<FooterContext["getContextUsage"]>;

function createFooter({
	model = { id: "kilo-model", provider: "kilo", contextWindow: 100_000 },
	entries = [],
	contextUsage = { contextWindow: 100_000, percent: 25 },
	sessionName,
	branch,
	statuses = new Map<string, string>(),
	providerCount = 1,
	thinkingLevel = "off",
	usingOAuth = false,
	creditsEnabled = true,
}: {
	model?: object | null | undefined;
	entries?: object[];
	contextUsage?: object | null | undefined;
	sessionName?: string;
	branch?: string;
	statuses?: Map<string, string>;
	providerCount?: number;
	thinkingLevel?: ReturnType<FooterExtensionAPI["getThinkingLevel"]> | null;
	usingOAuth?: boolean;
	creditsEnabled?: boolean;
} = {}) {
	const setFooter = vi.fn();
	const requestRender = vi.fn();
	const unsubscribe = vi.fn();
	const theme = { fg: vi.fn((_tone: string, text: string) => text) };
	const footerModel = (model ?? undefined) as FooterModel | undefined;
	const sessionEntries = entries as FooterEntries;
	const footerContextUsage = (contextUsage ?? undefined) as FooterContextUsage;
	const context = {
		model: footerModel,
		ui: { setFooter },
		sessionManager: { getEntries: () => sessionEntries, getSessionName: () => sessionName },
		getContextUsage: () => footerContextUsage,
		modelRegistry: { isUsingOAuth: () => usingOAuth },
	} satisfies FooterContext;
	// Exercise the legacy fallback even though Pi's current type is always a ThinkingLevel.
	const pi = {
		getThinkingLevel: (() => thinkingLevel) as FooterExtensionAPI["getThinkingLevel"],
	} satisfies FooterExtensionAPI;

	installCustomFooter(pi, context, creditsEnabled);
	const footer = setFooter.mock.calls[0]?.[0]({ requestRender }, theme, {
		onBranchChange: (listener: () => void) => {
			listener();
			return unsubscribe;
		},
		getGitBranch: () => branch,
		getExtensionStatuses: () => statuses,
		getAvailableProviderCount: () => providerCount,
	});
	return { footer, requestRender, theme, unsubscribe };
}

test("renders assistant token totals, costs, statuses, and model information", () => {
	const { footer } = createFooter({
		entries: [
			{
				type: "message",
				message: {
					role: "assistant",
					usage: {
						input: 1500,
						output: 12_000,
						cacheRead: 1_500_000,
						cacheWrite: 10_000_000,
						cost: { total: 1.2 },
					},
				},
			},
			{ type: "message", message: { role: "user" } },
		],
		statuses: new Map([
			["kilo-credits", "💰 $12.34"],
			["kilo-usage-day", "💸 $1.23 today"],
			["kilo-usage-week", "week"],
			["kilo-usage-month", "month"],
			["kilo-usage-year", "year"],
		]),
		providerCount: 2,
	});

	expect(footer.render(200)[1]).toContain(
		"↑1.5k ↓12k R1.5M W10M $1.200 25.0%/100k (auto) 💰 $12.34 💸 $1.23 today week month year",
	);
	expect(footer.render(200)[1]).toContain("(kilo) kilo-model");
});

test("subscribes to branch changes and disposes the subscription", () => {
	const { footer, requestRender, unsubscribe } = createFooter();
	expect(requestRender).toHaveBeenCalledOnce();
	footer.invalidate();
	footer.dispose();
	expect(unsubscribe).toHaveBeenCalledOnce();
});

test("formats the path, unknown context, subscription thinking, and warning context", () => {
	vi.stubEnv("HOME", process.cwd().slice(0, -"refactor-extract-custom-footer".length));
	const { footer, theme } = createFooter({
		model: { id: "reasoning-model", provider: "kilo", contextWindow: 999, reasoning: true },
		contextUsage: { contextWindow: 999, percent: null },
		sessionName: "session",
		branch: "main",
		thinkingLevel: "high",
		usingOAuth: true,
	});

	const [path, stats] = footer.render(200);
	expect(path).toContain("~");
	expect(path).toContain("(main) • session");
	expect(stats).toContain("$0.000 (sub) ?/999 (auto)");
	expect(stats).toContain("reasoning-model • high");
	expect(theme.fg).not.toHaveBeenCalledWith("warning", expect.anything());
});

test.each([
	[75, "warning"],
	[95, "error"],
])("colors %s%% context usage as %s", (percent, tone) => {
	const { footer, theme } = createFooter({ contextUsage: { contextWindow: 1000, percent } });
	footer.render(200);
	expect(theme.fg).toHaveBeenCalledWith(tone, `${percent.toFixed(1)}%/1.0k (auto)`);
});

test("omits disabled credits and handles a missing model and context usage", () => {
	vi.stubEnv("HOME", "");
	vi.stubEnv("USERPROFILE", "");
	const { footer } = createFooter({
		model: null,
		contextUsage: null,
		statuses: new Map([["kilo-credits", "💰 hidden"]]),
		creditsEnabled: false,
	});
	const stats = footer.render(200)[1];
	expect(stats).toContain("0.0%/0 (auto)");
	expect(stats).toContain("no-model");
	expect(stats).not.toContain("💰 hidden");
});

test.each<[ReturnType<FooterExtensionAPI["getThinkingLevel"]> | null]>([["off"], [null]])(
	"labels %s thinking level as off",
	(thinkingLevel) => {
		const { footer } = createFooter({
			model: { id: "reasoning-model", provider: "kilo", contextWindow: 1000, reasoning: true },
			thinkingLevel,
		});
		expect(footer.render(200)[1]).toContain("reasoning-model • thinking off");
	},
);

test("truncates path, stats, provider, and model output at narrow widths", () => {
	const { footer } = createFooter({
		model: { id: "very-long-reasoning-model", provider: "kilo", contextWindow: 1_000_000 },
		contextUsage: { contextWindow: 1_000_000, percent: 1 },
		entries: [
			{
				type: "message",
				message: {
					role: "assistant",
					usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
				},
			},
		],
		providerCount: 2,
	});
	expect(footer.render(18)[0]).toContain("...");
	expect(footer.render(5)[0].length).toBe(5);
	expect(footer.render(10)[1]).toContain("...");
	expect(footer.render(35)[1]).toContain("very-long");
});
