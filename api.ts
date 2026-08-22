export const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
export const KILO_PROFILE_ENDPOINT = `${KILO_API_BASE}/api/profile`;
export const KILO_ORG_HEADER = "X-KiloCode-OrganizationId";

export function withOrganizationHeader(
  headers: Record<string, string>,
  organizationId?: string,
): Record<string, string> {
  if (!organizationId) return headers;
  return { ...headers, [KILO_ORG_HEADER]: organizationId };
}

export interface KiloOrganization {
  id: string;
  name: string;
  role?: string;
}

export interface KiloProfile {
  user?: { email?: string; name?: string };
  email?: string;
  name?: string;
  organizations?: KiloOrganization[];
}

export async function fetchKiloProfile(token: string): Promise<KiloProfile> {
  const response = await fetch(KILO_PROFILE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Kilo profile: ${response.status}`);
  }

  return (await response.json()) as KiloProfile;
}
