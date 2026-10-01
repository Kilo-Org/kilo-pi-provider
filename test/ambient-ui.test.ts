import { afterEach, describe, expect, test, vi } from "vitest";
import { createAmbientKiloUi, isAmbientKiloUiVisible, KILO_STATUS_KEYS, planFooterChange } from "../src/ambient-ui.ts";
import type { KiloAccess } from "../src/api.ts";
import type { ResolvedKiloPreferences } from "../src/config.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

const access: KiloAccess = { token: "access-token", organizationId: "organization-id" };

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createFixture(options: { hasUI?: boolean; provider?: string } = {}) {
	const preferences: ResolvedKiloPreferences = {
		display: { showForOtherProviders: false },
		footer: { custom: true },
		credits: { enabled: true },
		usage: { periods: [] },
	};
	const ctx = {
		hasUI: options.hasUI ?? true,
		model: { provider: options.provider ?? "kilo" },
		ui: { setFooter: vi.fn() },
	};
	const themeStatuses = { set: vi.fn(), clear: vi.fn() };
	const usageRefresher = { invalidate: vi.fn(), refresh: vi.fn() };
	const installFooter = vi.fn();
	const fetchBalance = vi.fn<(access: KiloAccess) => Promise<number | null>>().mockResolvedValue(12.34);
	const ambientUi = createAmbientKiloUi({
		getPreferences: () => preferences,
		themeStatuses,
		usageRefresher,
		installFooter,
		fetchBalance,
	});

	return { ambientUi, ctx, fetchBalance, installFooter, preferences, themeStatuses, usageRefresher };
}

describe("isAmbientKiloUiVisible", () => {
	test.each([
		["kilo", false, true],
		["other", false, false],
		[undefined, false, false],
		["other", true, true],
		[undefined, true, true],
	])("provider %s with showForOtherProviders=%s is visible: %s", (provider, showForOtherProviders, expected) => {
		expect(isAmbientKiloUiVisible(provider, { display: { showForOtherProviders } })).toBe(expected);
	});
});

describe("planFooterChange", () => {
	test.each([
		[true, true, false, "install"],
		[true, true, true, "keep"],
		[true, false, true, "remove"],
		[true, false, false, "keep"],
		[false, true, true, "remove"],
		[false, true, false, "keep"],
		[false, false, true, "remove"],
		[false, false, false, "keep"],
	] as const)("visible=%s custom=%s installed=%s plans %s", (visible, customFooter, installed, expected) => {
		expect(planFooterChange({ visible, customFooter, installed })).toBe(expected);
	});
});

describe("reconcile", () => {
	test("installs the custom footer once while Kilo UI is visible", () => {
		const fixture = createFixture();

		expect(fixture.ambientUi.reconcile(fixture.ctx, "kilo")).toBe(true);
		expect(fixture.ambientUi.reconcile(fixture.ctx, "kilo")).toBe(true);

		expect(fixture.installFooter).toHaveBeenCalledOnce();
		expect(fixture.installFooter).toHaveBeenCalledWith(fixture.ctx);
		expect(fixture.ctx.ui.setFooter).not.toHaveBeenCalled();
	});

	test("removes the custom footer when Kilo UI is hidden", () => {
		const fixture = createFixture();
		fixture.ambientUi.reconcile(fixture.ctx, "kilo");

		expect(fixture.ambientUi.reconcile(fixture.ctx, "other")).toBe(false);

		expect(fixture.ctx.ui.setFooter).toHaveBeenCalledWith(undefined);
	});

	test("removes the custom footer when it is disabled", () => {
		const fixture = createFixture();
		fixture.ambientUi.reconcile(fixture.ctx, "kilo");
		fixture.preferences.footer.custom = false;

		fixture.ambientUi.reconcile(fixture.ctx, "kilo");

		expect(fixture.ctx.ui.setFooter).toHaveBeenCalledWith(undefined);
	});

	test("clears statuses and cancels usage refreshes when Kilo UI is hidden", () => {
		const fixture = createFixture();

		fixture.ambientUi.reconcile(fixture.ctx, "other");

		expect(fixture.themeStatuses.clear).toHaveBeenCalledWith(fixture.ctx, KILO_STATUS_KEYS);
		expect(KILO_STATUS_KEYS).toEqual([
			"kilo-credits",
			"kilo-usage-day",
			"kilo-usage-week",
			"kilo-usage-month",
			"kilo-usage-year",
		]);
		expect(fixture.usageRefresher.invalidate).toHaveBeenCalledOnce();
	});

	test("keeps statuses while Kilo UI is visible", () => {
		const fixture = createFixture();

		fixture.ambientUi.reconcile(fixture.ctx, "kilo");

		expect(fixture.themeStatuses.clear).not.toHaveBeenCalled();
		expect(fixture.usageRefresher.invalidate).not.toHaveBeenCalled();
	});

	test("reports visibility without touching UI when no interactive UI exists", () => {
		const fixture = createFixture({ hasUI: false });

		expect(fixture.ambientUi.reconcile(fixture.ctx, "kilo")).toBe(true);
		expect(fixture.ambientUi.reconcile(fixture.ctx, "other")).toBe(false);

		expect(fixture.installFooter).not.toHaveBeenCalled();
		expect(fixture.ctx.ui.setFooter).not.toHaveBeenCalled();
		expect(fixture.themeStatuses.clear).not.toHaveBeenCalled();
		expect(fixture.usageRefresher.invalidate).not.toHaveBeenCalled();
	});

	test("advances the revision", () => {
		const fixture = createFixture();
		const before = fixture.ambientUi.currentRevision();

		fixture.ambientUi.reconcile(fixture.ctx, "kilo");

		expect(fixture.ambientUi.currentRevision()).toBe(before + 1);
	});
});

describe("refresh", () => {
	test("starts a usage refresh that publishes through theme statuses", async () => {
		const fixture = createFixture();
		fixture.preferences.usage.periods = ["day"];

		await fixture.ambientUi.refresh(fixture.ctx, access);

		expect(fixture.usageRefresher.refresh).toHaveBeenCalledWith(access, ["day"], {
			setStatus: expect.any(Function),
		});
		fixture.usageRefresher.refresh.mock.calls[0]?.[2].setStatus("kilo-usage-day", "💸 $1.00 today");
		expect(fixture.themeStatuses.set).toHaveBeenCalledWith(fixture.ctx, "kilo-usage-day", "💸 $1.00 today");
	});

	test("skips usage when no periods are configured", async () => {
		const fixture = createFixture();

		await fixture.ambientUi.refresh(fixture.ctx, access);

		expect(fixture.usageRefresher.refresh).not.toHaveBeenCalled();
	});

	test("publishes formatted credits", async () => {
		const fixture = createFixture();

		await fixture.ambientUi.refresh(fixture.ctx, access);

		expect(fixture.fetchBalance).toHaveBeenCalledWith(access);
		expect(fixture.themeStatuses.set).toHaveBeenCalledWith(fixture.ctx, "kilo-credits", "💰 $12.34");
	});

	test("skips the balance request when credits are disabled", async () => {
		const fixture = createFixture();
		fixture.preferences.credits.enabled = false;

		await fixture.ambientUi.refresh(fixture.ctx, access);

		expect(fixture.fetchBalance).not.toHaveBeenCalled();
	});

	test("does not publish an unavailable balance", async () => {
		const fixture = createFixture();
		fixture.fetchBalance.mockResolvedValue(null);

		await fixture.ambientUi.refresh(fixture.ctx, access);

		expect(fixture.themeStatuses.set).not.toHaveBeenCalled();
	});

	test.each([
		["no interactive UI exists", { hasUI: false }],
		["the current model hides Kilo UI", { provider: "other" }],
	])("does nothing when %s", async (_name, options) => {
		const fixture = createFixture(options);
		fixture.preferences.usage.periods = ["day"];

		await fixture.ambientUi.refresh(fixture.ctx, access);

		expect(fixture.usageRefresher.refresh).not.toHaveBeenCalled();
		expect(fixture.fetchBalance).not.toHaveBeenCalled();
	});

	test("discards credits when reconciliation happens during the balance request", async () => {
		const fixture = createFixture();
		const balance = deferred<number | null>();
		fixture.fetchBalance.mockReturnValue(balance.promise);

		const refresh = fixture.ambientUi.refresh(fixture.ctx, access);
		fixture.ambientUi.reconcile(fixture.ctx, "kilo");
		balance.resolve(99.99);
		await refresh;

		expect(fixture.themeStatuses.set).not.toHaveBeenCalled();
	});

	test("discards credits when the provider changes during the balance request", async () => {
		const fixture = createFixture();
		const balance = deferred<number | null>();
		fixture.fetchBalance.mockReturnValue(balance.promise);

		const refresh = fixture.ambientUi.refresh(fixture.ctx, access);
		fixture.ctx.model.provider = "other";
		balance.resolve(99.99);
		await refresh;

		expect(fixture.themeStatuses.set).not.toHaveBeenCalled();
	});

	test("never rejects when the balance request fails", async () => {
		const fixture = createFixture();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		fixture.fetchBalance.mockRejectedValue(new Error("network failure"));

		await expect(fixture.ambientUi.refresh(fixture.ctx, access)).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalledWith("[kilo] Failed to fetch balance:", "network failure");
		expect(fixture.themeStatuses.set).not.toHaveBeenCalled();
	});
});

describe("refreshCredits", () => {
	test("skips the balance request for a revision that is no longer current", async () => {
		const fixture = createFixture();
		const revision = fixture.ambientUi.currentRevision();
		fixture.ambientUi.reconcile(fixture.ctx, "kilo");

		await fixture.ambientUi.refreshCredits(fixture.ctx, access, revision);

		expect(fixture.fetchBalance).not.toHaveBeenCalled();
	});

	test("publishes credits for the current revision", async () => {
		const fixture = createFixture();
		fixture.ambientUi.reconcile(fixture.ctx, "kilo");

		await fixture.ambientUi.refreshCredits(fixture.ctx, access, fixture.ambientUi.currentRevision());

		expect(fixture.themeStatuses.set).toHaveBeenCalledWith(fixture.ctx, "kilo-credits", "💰 $12.34");
	});
});

describe("clearCredits", () => {
	test("clears the credit status in an interactive UI", () => {
		const fixture = createFixture();

		fixture.ambientUi.clearCredits(fixture.ctx);

		expect(fixture.themeStatuses.set).toHaveBeenCalledWith(fixture.ctx, "kilo-credits", undefined);
	});

	test("does nothing without an interactive UI", () => {
		const fixture = createFixture({ hasUI: false });

		fixture.ambientUi.clearCredits(fixture.ctx);

		expect(fixture.themeStatuses.set).not.toHaveBeenCalled();
	});
});
