import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createUsageCommandHandler } from "../src/index.ts";

interface UsageCommandFixtureContext {
	hasUI: boolean;
	mode: "tui" | "print";
	ui: UsageCommandFixtureUi;
}

interface KeybindingsFixture {}

interface UsageCommandFixtureUi {
	custom(
		factory: (
			tui: { requestRender(): void },
			theme: { fg(tone: string, text: string): string },
			keybindings: KeybindingsFixture,
			done: (result: undefined) => void,
		) => MountedPopup,
		options: { overlay: boolean; overlayOptions: { anchor: "center" } },
	): Promise<void>;
	notify(message: string, type: "warning"): void;
}

interface MountedPopup extends Component {
	handleInput(data: string): void;
}

interface CustomUiHarness {
	ui: UsageCommandFixtureUi;
	mounted(): MountedPopup | undefined;
	requestRender: ReturnType<typeof vi.fn>;
}

function createCustomUiHarness(): CustomUiHarness {
	let component: MountedPopup | undefined;
	let finish: (() => void) | undefined;
	const requestRender = vi.fn();
	return {
		ui: {
			custom: vi.fn(
				(factory) =>
					new Promise<void>((resolve) => {
						finish = resolve;
						component = factory({ requestRender }, { fg: (_tone: string, text: string) => text }, {}, () =>
							finish?.(),
						);
					}),
			),
			notify: vi.fn(),
		},
		mounted: () => component,
		requestRender,
	};
}

function createContext(mode: "tui" | "print", hasUI: boolean): UsageCommandFixtureContext {
	const harness = createCustomUiHarness();
	return { hasUI, mode, ui: harness.ui };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("/kilo-usage command", () => {
	test("rejects a non-TUI invocation without opening a popup", async () => {
		const context = createContext("print", true);
		const handler = createUsageCommandHandler({ getAccess: () => ({ token: "access-token" }) });
		await handler(context);
		expect(context.ui.notify).toHaveBeenCalledWith(expect.any(String), "warning");
	});

	test("rejects unauthenticated TUI invocation with a notification", async () => {
		const context = createContext("tui", true);
		const handler = createUsageCommandHandler({ getAccess: () => undefined });
		await handler(context);
		expect(context.ui.notify).toHaveBeenCalledWith(expect.any(String), "warning");
	});

	test("renders loaded usage while the overlay stays open until Escape", async () => {
		const harness = createCustomUiHarness();
		let resolveFetch: (entries: { date: string; totalCostMicrodollars: number }[]) => void = () => {};
		const fetchUsageEntries = vi.fn(
			() =>
				new Promise<{ date: string; totalCostMicrodollars: number }[]>((resolve) => {
					resolveFetch = resolve;
				}),
		);
		const handler = createUsageCommandHandler({ getAccess: () => ({ token: "access-token" }), fetchUsageEntries });
		let settled = false;
		const running = handler({ hasUI: true, mode: "tui", ui: harness.ui }).then(() => {
			settled = true;
		});
		await vi.waitFor(() => expect(harness.mounted()).toBeDefined());
		expect(harness.mounted()?.render(80).join("\n")).toMatch(/loading/i);
		resolveFetch([{ date: "2026-08-22", totalCostMicrodollars: 1 }]);
		await vi.waitFor(() => expect(harness.requestRender).toHaveBeenCalled());
		expect(harness.mounted()?.render(80).join("\n")).toMatch(/Today/);
		expect(settled).toBe(false);
		harness.mounted()?.handleInput("\x1b");
		await running;
	});

	test("aborts a pending usage request and resolves the overlay on Escape", async () => {
		const harness = createCustomUiHarness();
		let aborted = false;
		const fetchUsageEntries = vi.fn(
			(_access: { token: string }, _period: "year", options: { signal: AbortSignal }) =>
				new Promise<never>((_resolve, reject) => {
					options.signal.addEventListener("abort", () => {
						aborted = true;
						reject(new Error("aborted"));
					});
				}),
		);
		const handler = createUsageCommandHandler({ getAccess: () => ({ token: "access-token" }), fetchUsageEntries });
		const running = handler({ hasUI: true, mode: "tui", ui: harness.ui });
		await vi.waitFor(() => expect(harness.mounted()).toBeDefined());
		harness.mounted()?.handleInput("\x1b");
		await running;
		expect(aborted).toBe(true);
	});

	test("mounts a centered loading popup and fetches yearly organization usage", async () => {
		const harness = createCustomUiHarness();
		let requestSignal: AbortSignal | undefined;
		const fetchUsageEntries = vi.fn(
			async (
				_access: { token: string; organizationId?: string },
				_period: "year",
				options: { groupByModel: boolean; signal: AbortSignal },
			) => {
				requestSignal = options.signal;
				return [];
			},
		);
		const handler = createUsageCommandHandler({
			getAccess: () => ({ token: "access-token", organizationId: "organization-id" }),
			fetchUsageEntries,
		});
		const context: UsageCommandFixtureContext = { hasUI: true, mode: "tui", ui: harness.ui };

		const running = handler(context);
		await vi.waitFor(() => expect(harness.mounted()).toBeDefined());
		expect(harness.ui.custom).toHaveBeenCalledWith(expect.any(Function), {
			overlay: true,
			overlayOptions: { anchor: "center" },
		});
		expect(fetchUsageEntries).toHaveBeenCalledTimes(1);
		expect(fetchUsageEntries).toHaveBeenCalledWith(
			{ token: "access-token", organizationId: "organization-id" },
			"year",
			expect.objectContaining({ groupByModel: true, signal: expect.any(AbortSignal) }),
		);
		harness.mounted()?.handleInput("\x1b");
		expect(requestSignal?.aborted).toBe(true);
		await running;
	});

	test("shows an error when the usage request resolves without entries", async () => {
		const harness = createCustomUiHarness();
		const handler = createUsageCommandHandler({
			getAccess: () => ({ token: "access-token" }),
			fetchUsageEntries: async () => null,
		});
		const running = handler({ hasUI: true, mode: "tui", ui: harness.ui });
		await vi.waitFor(() => expect(harness.mounted()?.render(80).join("\n")).toContain("Unable to load usage."));
		expect(harness.requestRender).toHaveBeenCalled();
		harness.mounted()?.handleInput("\x1b");
		await running;
	});

	test("updates the mounted popup when the usage request fails", async () => {
		const harness = createCustomUiHarness();
		const handler = createUsageCommandHandler({
			getAccess: () => ({ token: "access-token" }),
			fetchUsageEntries: async () => {
				throw new Error("offline");
			},
		});
		const running = handler({ hasUI: true, mode: "tui", ui: harness.ui });
		await vi.waitFor(() => expect(harness.mounted()).toBeDefined());
		await vi.waitFor(() => expect(harness.mounted()?.render(80).join("\n")).toContain("Unable to load usage."));
		expect(harness.requestRender).toHaveBeenCalled();
		harness.mounted()?.handleInput("\x1b");
		await running;
	});
});
