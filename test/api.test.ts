import { describe, expect, test } from "vitest";
import { KILO_ORG_HEADER, withOrganizationHeader } from "../api.ts";

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
