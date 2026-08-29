import { describe, expect, test, vi } from "vitest";
import type { KiloAccess, KiloUsageEntry } from "../src/api.ts";
import { createUsageRefresher, getUsageFetchPeriod, sumUsageForDay } from "../src/usage.ts";

const access: KiloAccess = { token: "access-token" };
const today = new Date("2026-08-22T12:00:00.000Z");

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("getUsageFetchPeriod", () => {
	test.each([
		[["day"], "week"],
		[["month"], "month"],
		[["year"], "year"],
	])("uses %s for %s usage", (periods, fetchPeriod) => {
		expect(getUsageFetchPeriod(periods)).toBe(fetchPeriod);
	});
});

describe("sumUsageForDay", () => {
	test("sums only rows for the requested UTC date", () => {
		const entries: KiloUsageEntry[] = [
			{ date: "2026-08-22", totalCostMicrodollars: 1_250_000 },
			{ date: "2026-08-22", totalCostMicrodollars: 750_000 },
			{ date: "2026-08-21", totalCostMicrodollars: 9_000_000 },
		];

		expect(sumUsageForDay(entries, today)).toBe(2_000_000);
	});
});

describe("createUsageRefresher", () => {
	test("publishes the daily status after a background refresh", async () => {
		const fetchUsageEntries = vi.fn().mockResolvedValue([{ date: "2026-08-22", totalCostMicrodollars: 1_234_567 }]);
		const setStatus = vi.fn();
		const refresher = createUsageRefresher({ fetchUsageEntries, now: () => today });

		refresher.refresh(access, ["day"], { setStatus, accent: (text) => text });

		await vi.waitFor(() => {
			expect(setStatus).toHaveBeenCalledWith("kilo-usage-day", "💸 $1.23 today");
		});
		expect(fetchUsageEntries).toHaveBeenCalledWith(access, "week");
	});

	test.each([
		["week", "week", "💸 $2.00 this week"],
		["month", "month", "💸 $2.00 this month"],
		["year", "year", "💸 $2.00 this year"],
	] as const)("publishes %s usage from every returned entry", async (period, fetchPeriod, expectedStatus) => {
		const fetchUsageEntries = vi.fn().mockResolvedValue([
			{ date: "2026-08-22", totalCostMicrodollars: 1_250_000 },
			{ date: "2026-08-21", totalCostMicrodollars: 750_000 },
		]);
		const setStatus = vi.fn();
		const refresher = createUsageRefresher({ fetchUsageEntries, now: () => today });

		refresher.refresh(access, [period], { setStatus, accent: (text) => text });

		await vi.waitFor(() => {
			expect(setStatus).toHaveBeenCalledWith(`kilo-usage-${period}`, expectedStatus);
		});
		expect(fetchUsageEntries).toHaveBeenCalledWith(access, fetchPeriod);
	});

	test("does not fetch usage for an empty period list", () => {
		const fetchUsageEntries = vi.fn();
		const refresher = createUsageRefresher({ fetchUsageEntries });

		refresher.refresh(access, [], { setStatus: vi.fn(), accent: (text) => text });

		expect(fetchUsageEntries).not.toHaveBeenCalled();
	});

	test("does not publish a status when the usage endpoint has no entries", async () => {
		const fetchUsageEntries = vi.fn().mockResolvedValue(null);
		const setStatus = vi.fn();
		const refresher = createUsageRefresher({ fetchUsageEntries });

		refresher.refresh(access, ["day"], { setStatus, accent: (text) => text });

		await vi.waitFor(() => expect(fetchUsageEntries).toHaveBeenCalledOnce());
		expect(setStatus).not.toHaveBeenCalled();
	});

	test("coalesces active refreshes and applies only the most recent result", async () => {
		const first = deferred<KiloUsageEntry[] | null>();
		const second = deferred<KiloUsageEntry[] | null>();
		const fetchUsageEntries = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const setStatus = vi.fn();
		const refresher = createUsageRefresher({ fetchUsageEntries, now: () => today });
		const presentation = { setStatus, accent: (text: string) => text };

		refresher.refresh(access, ["day"], presentation);
		refresher.refresh({ token: "newest-token" }, ["day"], presentation);
		refresher.refresh({ token: "newest-token" }, ["day"], presentation);

		expect(fetchUsageEntries).toHaveBeenCalledTimes(1);
		first.resolve([{ date: "2026-08-22", totalCostMicrodollars: 1_000_000 }]);
		await vi.waitFor(() => expect(fetchUsageEntries).toHaveBeenCalledTimes(2));
		expect(setStatus).not.toHaveBeenCalledWith("kilo-usage-day", "💸 $1.00 today");

		second.resolve([{ date: "2026-08-22", totalCostMicrodollars: 2_000_000 }]);
		await vi.waitFor(() => {
			expect(setStatus).toHaveBeenCalledWith("kilo-usage-day", "💸 $2.00 today");
		});
		expect(fetchUsageEntries).toHaveBeenLastCalledWith({ token: "newest-token" }, "week");
	});
});
