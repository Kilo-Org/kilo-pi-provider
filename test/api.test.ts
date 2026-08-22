import { afterEach, describe, expect, test, vi } from "vitest";
import { KILO_ORG_HEADER, fetchKiloProfile, withOrganizationHeader } from "../api.ts";

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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ email: "user@example.com" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchKiloProfile("access-token");

    expect(fetchMock).toHaveBeenCalledWith("https://api.kilo.ai/api/profile", {
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
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(profile), { status: 200 }),
      ),
    );

    await expect(fetchKiloProfile("access-token")).resolves.toEqual(profile);
  });

  test("throws the exact error for a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(fetchKiloProfile("access-token")).rejects.toThrow(
      "Failed to fetch Kilo profile: 503",
    );
  });

  test("propagates a fetch rejection unchanged", async () => {
    const error = new Error("network failure");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(error));

    await expect(fetchKiloProfile("access-token")).rejects.toBe(error);
  });
});
