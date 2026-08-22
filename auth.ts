import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials } from "@earendil-works/pi-ai";

export function getEnvOrganizationId(): string | undefined {
  return process.env.KILO_ORG_ID || process.env.KILOCODE_ORGANIZATION_ID;
}

export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function readStoredKiloCredentials(): OAuthCredentials | undefined {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    if (!existsSync(authPath)) return undefined;
    const auth = JSON.parse(readFileSync(authPath, "utf8")) as {
      kilo?: { type?: string } & OAuthCredentials;
    };
    const cred = auth.kilo;
    if (cred?.type !== "oauth" || !cred.access) return undefined;
    return cred;
  } catch {
    return undefined;
  }
}

export function getCredentialOrganizationId(credentials?: OAuthCredentials): string | undefined {
  const accountId = credentials?.accountId;
  return typeof accountId === "string" && accountId.trim() ? accountId : undefined;
}

export function getEffectiveOrganizationId(credentials?: OAuthCredentials): string | undefined {
  return getCredentialOrganizationId(credentials) ?? getEnvOrganizationId();
}
