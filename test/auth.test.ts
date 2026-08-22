import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getAgentDir,
  getCredentialOrganizationId,
  getEffectiveOrganizationId,
  getEnvOrganizationId,
  readStoredKiloCredentials,
} from "../auth.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
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
