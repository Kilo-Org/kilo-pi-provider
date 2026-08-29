import { afterEach, describe, expect, test, vi } from "vitest";
import type { KiloAccess, KiloUsageEntry } from "../src/api.ts";
import { createUsageRefresher, getRequestedUsagePeriods, getUsageFetchPeriod, sumUsageForDay } from "../src/usage.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

const access: KiloAccess = { token: "access-token" };
const today = new Date("2026-08-22T12:00:00.000Z");

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("getRequestedUsagePeriods", () => {
	test.each(["1", "true", "TRUE", "yes", " day "])("enables daily usage for %j", (value) => {
		vi.stubEnv("KILO_USAGE", value);

		expect(getRequestedUsagePeriods()).toEqual(["day"]);
	});

	test.each([undefined, "", "0", "false", "no", "week", "unexpected"])("disables usage for %j", (value) => {
		if (value === undefined) {
			vi.stubEnv("KILO_USAGE", "");
		} else {
			vi.stubEnv("KILO_USAGE", value);
		}

		expect(getRequestedUsagePeriods()).toEqual([]);
	});
});

describe("getUsageFetchPeriod", () => {
	test("uses a rolling week for daily usage because the API has no day period", () => {
		expect(getUsageFetchPeriod(["day"])).toBe("week");
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
		vi.stubEnv("KILO_USAGE", "day");
		const fetchUsageEntries = vi.fn().mockResolvedValue([{ date: "2026-08-22", totalCostMicrodollars: 1_234_567 }]);
		const setStatus = vi.fn();
		const refresher = createUsageRefresher({ fetchUsageEntries, now: () => today });

		refresher.refresh(access, { setStatus, accent: (text) => text });

		await vi.waitFor(() => {
			expect(setStatus).toHaveBeenCalledWith("kilo-usage-day", "💸 $1.23 today");
		});
		expect(fetchUsageEntries).toHaveBeenCalledWith(access, "week");
	});

	test("coalesces active refreshes and applies only the most recent result", async () => {
		vi.stubEnv("KILO_USAGE", "1");
		const first = deferred<KiloUsageEntry[] | null>();
		const second = deferred<KiloUsageEntry[] | null>();
		const fetchUsageEntries = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const setStatus = vi.fn();
		const refresher = createUsageRefresher({ fetchUsageEntries, now: () => today });
		const presentation = { setStatus, accent: (text: string) => text };

		refresher.refresh(access, presentation);
		refresher.refresh({ token: "newest-token" }, presentation);
		refresher.refresh({ token: "newest-token" }, presentation);

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
