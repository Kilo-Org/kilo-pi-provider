import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { fetchKiloProfile, type KiloProfile } from "./api.ts";

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

export async function selectKiloOrganization(
  token: string,
  callbacks: OAuthLoginCallbacks,
): Promise<string | undefined> {
  let profile: KiloProfile;
  try {
    callbacks.onProgress?.("Fetching Kilo profile...");
    profile = await fetchKiloProfile(token);
  } catch (error) {
    console.warn(
      "[kilo] Failed to fetch profile for organization selection:",
      error instanceof Error ? error.message : error,
    );
    return getEnvOrganizationId();
  }

  const organizations = profile.organizations ?? [];
  const envOrganizationId = getEnvOrganizationId();
  if (envOrganizationId && organizations.some((org) => org.id === envOrganizationId)) {
    return envOrganizationId;
  }
  if (!callbacks.onSelect || organizations.length === 0) {
    return envOrganizationId;
  }

  const selected = await callbacks.onSelect({
    message: "Select Kilo account",
    options: [
      { id: "personal", label: "Personal Account" },
      ...organizations.map((org) => ({
        id: org.id,
        label: `${org.name}${org.role ? ` (${org.role})` : ""}`,
      })),
    ],
  });

  if (!selected || selected === "personal") return undefined;
  return selected;
}
