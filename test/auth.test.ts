import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  abortableSleep,
  getAgentDir,
  getCredentialOrganizationId,
  initiateDeviceAuth,
  pollDeviceAuth,
  selectKiloOrganization,
  getEffectiveOrganizationId,
  getEnvOrganizationId,
  readStoredKiloCredentials,
} from "../auth.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("device authorization", () => {
  test("initiates device authorization with the exact POST request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: "code", verificationUrl: "url", expiresIn: 60 }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await initiateDeviceAuth();

    expect(fetchMock).toHaveBeenCalledWith("https://api.kilo.ai/api/device-auth/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  });

  test("returns parsed device authorization success", async () => {
    const response = { code: "code", verificationUrl: "url", expiresIn: 60 };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 })),
    );

    await expect(initiateDeviceAuth()).resolves.toEqual(response);
  });

  test("throws the exact rate-limit message", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 })));

    await expect(initiateDeviceAuth()).rejects.toThrow(
      "Too many pending authorization requests. Please try again later.",
    );
  });

  test("throws the exact generic initiation status message", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(initiateDeviceAuth()).rejects.toThrow(
      "Failed to initiate device authorization: 500",
    );
  });

  test("polls the exact code endpoint and parses OK responses", async () => {
    const response = { status: "approved", token: "token", userEmail: "user@example.com" };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollDeviceAuth("code value")).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("https://api.kilo.ai/api/device-auth/codes/code value");
  });

  test.each([
    [202, { status: "pending" }],
    [403, { status: "denied" }],
    [410, { status: "expired" }],
  ])("maps status %s exactly", async (status, expected) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })));

    await expect(pollDeviceAuth("code")).resolves.toEqual(expected);
  });

  test("throws the exact generic poll failure", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(pollDeviceAuth("code")).rejects.toThrow(
      "Failed to poll device authorization: 500",
    );
  });

  test("resolves after the requested interval", async () => {
    vi.useFakeTimers();
    const promise = abortableSleep(3000);
    await vi.advanceTimersByTimeAsync(2999);
    let settled = false;
    void promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBeUndefined();
  });

  test("rejects immediately when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortableSleep(3000, controller.signal)).rejects.toThrow("Login cancelled");
  });

  test("rejects on mid-wait abort and clears the pending timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const promise = abortableSleep(3000, controller.signal);

    controller.abort();

    await expect(promise).rejects.toThrow("Login cancelled");
    expect(clearTimeoutSpy).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
  });
});

describe("getAgentDir", () => {
  test("uses PI_CODING_AGENT_DIR when set", () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", "/custom/agent");

    expect(getAgentDir()).toBe("/custom/agent");
  });

  test("falls back to the homedir agent directory", () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", "");

    expect(getAgentDir()).toBe(join(homedir(), ".pi", "agent"));
  });
});

describe("readStoredKiloCredentials", () => {
  function withAuthFile(contents: string): string {
    const directory = mkdtempSync(join("/tmp", "kilo-auth-test-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "auth.json"), contents);
    vi.stubEnv("PI_CODING_AGENT_DIR", directory);
    return directory;
  }

  test("returns valid OAuth credentials", () => {
    withAuthFile(JSON.stringify({ kilo: { type: "oauth", access: "token" } }));

    expect(readStoredKiloCredentials()).toEqual({ type: "oauth", access: "token" });
  });

  test.each([
    ["missing file", undefined],
    ["malformed JSON", "{"],
    ["non-OAuth", JSON.stringify({ kilo: { type: "api_key", access: "token" } })],
    ["missing access", JSON.stringify({ kilo: { type: "oauth" } })],
    ["empty access", JSON.stringify({ kilo: { type: "oauth", access: "" } })],
    ["absent kilo", JSON.stringify({ other: {} })],
  ])("returns undefined for %s", (_name, contents) => {
    if (contents === undefined) {
      const directory = mkdtempSync(join("/tmp", "kilo-auth-test-"));
      temporaryDirectories.push(directory);
      vi.stubEnv("PI_CODING_AGENT_DIR", directory);
    } else {
      withAuthFile(contents);
    }

    expect(readStoredKiloCredentials()).toBeUndefined();
  });
});

describe("selectKiloOrganization", () => {
  test("fetches the profile with the token and reports progress", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ organizations: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onProgress = vi.fn();

    await selectKiloOrganization("access-token", { onProgress });

    expect(fetchMock).toHaveBeenCalledWith("https://api.kilo.ai/api/profile", {
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
    });
    expect(onProgress).toHaveBeenCalledWith("Fetching Kilo profile...");
  });

  test("returns a matching environment organization without prompting", async () => {
    vi.stubEnv("KILO_ORG_ID", "org-2");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ organizations: [{ id: "org-2", name: "Org 2" }] }), {
          status: 200,
        }),
      ),
    );
    const onSelect = vi.fn();

    await expect(selectKiloOrganization("token", { onSelect })).resolves.toBe("org-2");
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("returns the environment fallback without onSelect or organizations", async () => {
    vi.stubEnv("KILO_ORG_ID", "env-org");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ organizations: [] }), { status: 200 }),
      ),
    );

    await expect(selectKiloOrganization("token", {})).resolves.toBe("env-org");
  });

  test("offers personal first and formats organization roles exactly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            organizations: [
              { id: "org-1", name: "First", role: "admin" },
              { id: "org-2", name: "Second" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const onSelect = vi.fn().mockResolvedValue("org-2");

    await selectKiloOrganization("token", { onSelect });

    expect(onSelect).toHaveBeenCalledWith({
      message: "Select Kilo account",
      options: [
        { id: "personal", label: "Personal Account" },
        { id: "org-1", label: "First (admin)" },
        { id: "org-2", label: "Second" },
      ],
    });
  });

  test.each([undefined, "personal"])("returns undefined for cancel or personal: %j", async (selected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ organizations: [{ id: "org-1", name: "Org 1" }] }), {
          status: 200,
        }),
      ),
    );
    const onSelect = vi.fn().mockResolvedValue(selected);

    await expect(selectKiloOrganization("token", { onSelect })).resolves.toBeUndefined();
  });

  test("returns the selected organization ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ organizations: [{ id: "org-1", name: "Org 1" }] }), {
          status: 200,
        }),
      ),
    );

    await expect(
      selectKiloOrganization("token", { onSelect: vi.fn().mockResolvedValue("org-1") }),
    ).resolves.toBe("org-1");
  });

  test("logs the exact warning and returns environment fallback on profile failure", async () => {
    vi.stubEnv("KILO_ORG_ID", "env-org");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("network failure")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(selectKiloOrganization("token", {})).resolves.toBe("env-org");
    expect(warn).toHaveBeenCalledWith(
      "[kilo] Failed to fetch profile for organization selection:",
      "network failure",
    );
  });
});

describe("organization helpers", () => {
  test.each([
    ["KILO_ORG_ID", "primary", "fallback", "primary"],
    ["KILOCODE_ORGANIZATION_ID", "", "fallback", "fallback"],
  ])("getEnvOrganizationId uses %s", (_name, kilo, kilocode, expected) => {
    vi.stubEnv("KILO_ORG_ID", kilo);
    vi.stubEnv("KILOCODE_ORGANIZATION_ID", kilocode);

    expect(getEnvOrganizationId()).toBe(expected);
  });

  test("getEnvOrganizationId returns undefined when both are absent", () => {
    const kilo = process.env.KILO_ORG_ID;
    const kilocode = process.env.KILOCODE_ORGANIZATION_ID;
    delete process.env.KILO_ORG_ID;
    delete process.env.KILOCODE_ORGANIZATION_ID;

    try {
      expect(getEnvOrganizationId()).toBeUndefined();
    } finally {
      if (kilo === undefined) delete process.env.KILO_ORG_ID;
      else process.env.KILO_ORG_ID = kilo;
      if (kilocode === undefined) delete process.env.KILOCODE_ORGANIZATION_ID;
      else process.env.KILOCODE_ORGANIZATION_ID = kilocode;
    }
  });

  test("returns a nonempty account ID untrimmed", () => {
    expect(getCredentialOrganizationId({ accountId: "  organization-id  " } as never)).toBe(
      "  organization-id  ",
    );
  });

  test.each([undefined, "   "])("returns undefined for missing or whitespace account ID: %j", (accountId) => {
    expect(getCredentialOrganizationId({ accountId } as never)).toBeUndefined();
  });

  test("prefers credential organization over environment", () => {
    vi.stubEnv("KILO_ORG_ID", "env-id");

    expect(getEffectiveOrganizationId({ accountId: "credential-id" } as never)).toBe("credential-id");
  });

  test("falls back to environment organization", () => {
    vi.stubEnv("KILO_ORG_ID", "env-id");

    expect(getEffectiveOrganizationId()).toBe("env-id");
  });

  test("returns undefined when credential and environment organizations are absent", () => {
    const kilo = process.env.KILO_ORG_ID;
    const kilocode = process.env.KILOCODE_ORGANIZATION_ID;
    delete process.env.KILO_ORG_ID;
    delete process.env.KILOCODE_ORGANIZATION_ID;

    try {
      expect(getEffectiveOrganizationId()).toBeUndefined();
    } finally {
      if (kilo === undefined) delete process.env.KILO_ORG_ID;
      else process.env.KILO_ORG_ID = kilo;
      if (kilocode === undefined) delete process.env.KILOCODE_ORGANIZATION_ID;
      else process.env.KILOCODE_ORGANIZATION_ID = kilocode;
    }
  });
});
