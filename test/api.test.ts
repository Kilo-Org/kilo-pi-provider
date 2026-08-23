import { afterEach, describe, expect, test, vi } from "vitest";
import {
	fetchKiloBalance,
	fetchKiloProfile,
	KILO_API_BASE,
	KILO_ORG_HEADER,
	withOrganizationHeader,
} from "../src/api.ts";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("withOrganizationHeader", () => {
	test("returns the original object when there is no organization", () => {
		const headers = { Authorization: "Bearer token" };

		expect(withOrganizationHeader(headers)).toBe(headers);
	});

	test("adds the organization header with the exact spelling and value", () => {
		expect(withOrganizationHeader({}, "organization-id")).toEqual({
			[KILO_ORG_HEADER]: "organization-id",
		});
		expect(KILO_ORG_HEADER).toBe("X-KiloCode-OrganizationId");
	});

	test("preserves existing headers", () => {
		expect(
			withOrganizationHeader(
				{ Authorization: "Bearer token", "Content-Type": "application/json" },
				"organization-id",
			),
		).toEqual({
			Authorization: "Bearer token",
			"Content-Type": "application/json",
			"X-KiloCode-OrganizationId": "organization-id",
		});
	});

	test("does not mutate the input when adding an organization", () => {
		const headers = { Authorization: "Bearer token" };

		withOrganizationHeader(headers, "organization-id");

		expect(headers).toEqual({ Authorization: "Bearer token" });
	});
});

describe("fetchKiloProfile", () => {
	test("fetches the default profile URL with bearer and content-type headers", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify({ email: "user@example.com" }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await fetchKiloProfile("access-token");

		expect(fetchMock).toHaveBeenCalledWith(`${KILO_API_BASE}/api/profile`, {
			headers: {
				Authorization: "Bearer access-token",
				"Content-Type": "application/json",
			},
		});
	});

	test("returns the parsed profile on success", async () => {
		const profile = {
			user: { email: "user@example.com", name: "User" },
			organizations: [{ id: "org-id", name: "Organization", role: "member" }],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(profile), { status: 200 })),
		);

		await expect(fetchKiloProfile("access-token")).resolves.toEqual(profile);
	});

	test("throws the exact error for a non-OK response", async () => {
		vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })));

		await expect(fetchKiloProfile("access-token")).rejects.toThrow("Failed to fetch Kilo profile: 503");
	});

	test("propagates a fetch rejection unchanged", async () => {
		const error = new Error("network failure");
		vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(error));

		await expect(fetchKiloProfile("access-token")).rejects.toBe(error);
	});
});

describe("fetchKiloBalance", () => {
	test("fetches the balance URL with bearer and content-type headers", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify({ balance: 12.34 }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await fetchKiloBalance("access-token");

		expect(fetchMock).toHaveBeenCalledWith(`${KILO_API_BASE}/api/profile/balance`, {
			headers: {
				Authorization: "Bearer access-token",
				"Content-Type": "application/json",
			},
		});
	});

	test("includes the organization header when supplied", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify({ balance: 12.34 }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await fetchKiloBalance("access-token", "organization-id");

		expect(fetchMock).toHaveBeenCalledWith(`${KILO_API_BASE}/api/profile/balance`, {
			headers: {
				Authorization: "Bearer access-token",
				"Content-Type": "application/json",
				"X-KiloCode-OrganizationId": "organization-id",
			},
		});
	});

	test("omits the organization header when absent", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify({ balance: 12.34 }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await fetchKiloBalance("access-token");

		expect(fetchMock.mock.calls[0]?.[1]).toEqual({
			headers: {
				Authorization: "Bearer access-token",
				"Content-Type": "application/json",
			},
		});
	});

	test("preserves a zero balance on success", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ balance: 0 }), { status: 200 })),
		);

		await expect(fetchKiloBalance("access-token")).resolves.toBe(0);
	});

	test("returns the balance on success", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ balance: 12.34 }), { status: 200 })),
		);

		await expect(fetchKiloBalance("access-token")).resolves.toBe(12.34);
	});

	test("returns null when the successful response has no balance", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
		);

		await expect(fetchKiloBalance("access-token")).resolves.toBeNull();
	});

	test("returns null for a non-OK response", async () => {
		vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })));

		await expect(fetchKiloBalance("access-token")).resolves.toBeNull();
	});

	test("returns null when fetch rejects", async () => {
		vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("network failure")));

		await expect(fetchKiloBalance("access-token")).resolves.toBeNull();
	});
});
