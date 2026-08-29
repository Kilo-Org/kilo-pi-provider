import { expect, test, vi } from "vitest";
import { installCustomFooter, usesCustomFooter } from "../src/footer.ts";

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
	vi.unstubAllEnvs();
});

test("installs a footer which displays Kilo statuses", () => {
	const setFooter = vi.fn();
	const context = {
		model: { id: "kilo-model", provider: "kilo", contextWindow: 100_000 },
		ui: { setFooter },
		sessionManager: { getEntries: () => [], getSessionName: () => undefined },
		getContextUsage: () => ({ contextWindow: 100_000, percent: 25 }),
		modelRegistry: { isUsingOAuth: () => false },
	};
	const pi = { getThinkingLevel: () => "off" };

	installCustomFooter(pi as never, context as never, true);

	const footer = setFooter.mock.calls[0]?.[0](
		{ requestRender: vi.fn() },
		{ fg: vi.fn((_tone, text) => text) },
		{
			onBranchChange: () => vi.fn(),
			getGitBranch: () => undefined,
			getExtensionStatuses: () => new Map([["kilo-credits", "💰 $12.34"]]),
			getAvailableProviderCount: () => 1,
		},
	);
	expect(footer.render(200)[1]).toContain("💰 $12.34");
});
