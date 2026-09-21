import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchKiloUsageEntries, KILO_API_BASE } from "../src/api.ts";

interface UsageApiFixtureRow {
	date: string;
	total_cost: number;
	model?: string | number;
	total_input_tokens?: number | string;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("popup usage API contract", () => {
	test("opts into a grouped yearly organization request while remaining timeout-bounded", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify({ usage: [] }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		await fetchKiloUsageEntries({ token: "access-token", organizationId: "organization-id" }, "year", {
			groupByModel: true,
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`${KILO_API_BASE}/api/profile/usage?period=year&viewType=organization-id&groupByModel=true`,
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	test("leaves ambient requests ungrouped", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ usage: [{ date: "2026-08-22", total_cost: 1, model: "ignored" }] }), {
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		await expect(fetchKiloUsageEntries({ token: "access-token" }, "week")).resolves.toEqual([
			{ date: "2026-08-22", totalCostMicrodollars: 1 },
		]);
		expect(fetchMock).toHaveBeenCalledWith(
			`${KILO_API_BASE}/api/profile/usage?period=week&viewType=personal`,
			expect.any(Object),
		);
	});

	test("normalizes missing or malformed model and token fields to popup-safe defaults", async () => {
		const row: UsageApiFixtureRow = { date: "2026-08-22", total_cost: 1, model: 2, total_input_tokens: "bad" };
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ usage: [row] }), { status: 200 })),
		);
		await expect(fetchKiloUsageEntries({ token: "access-token" }, "year", { groupByModel: true })).resolves.toEqual([
			{
				date: "2026-08-22",
				model: "Unknown model",
				totalCostMicrodollars: 1,
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalCacheWriteTokens: 0,
				totalCacheHitTokens: 0,
			},
		]);
	});
});
