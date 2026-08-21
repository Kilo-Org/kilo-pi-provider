import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import kiloExtension from "../kilo.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const catalogResponse = () =>
  new Response(
    JSON.stringify({
      data: [
        {
          id: "acme/code-model:free",
          name: "Acme Code Model",
          context_length: 128_000,
          max_completion_tokens: 16_000,
          pricing: { prompt: "0", completion: "0" },
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          supported_parameters: ["reasoning"],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

test("registers anonymous free models from the Kilo catalog", async () => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "kilo-pi-provider-test-"));
  temporaryDirectories.push(agentDirectory);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
  vi.stubEnv("KILO_API_KEY", "");
  vi.stubEnv("KILO_ORG_ID", "");
  vi.stubEnv("KILOCODE_ORGANIZATION_ID", "");

  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(catalogResponse());
  vi.stubGlobal("fetch", fetchMock);

  const registerProvider = vi.fn();
  const on = vi.fn();

  await kiloExtension({ registerProvider, on } as never);

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.kilo.ai/api/gateway/models");
  expect(registerProvider).toHaveBeenCalledWith(
    "kilo",
    expect.objectContaining({
      baseUrl: "https://api.kilo.ai/api/gateway",
      apiKey: "$KILO_API_KEY",
      models: [
        expect.objectContaining({
          id: "acme/code-model:free",
          name: "Acme Code Model",
          reasoning: true,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 16_000,
        }),
      ],
    }),
  );
});

test("loads the organization catalog with stored OAuth credentials", async () => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "kilo-pi-provider-test-"));
  temporaryDirectories.push(agentDirectory);
  writeFileSync(
    join(agentDirectory, "auth.json"),
    JSON.stringify({
      kilo: {
        type: "oauth",
        access: "stored-access-token",
        accountId: "organization-id",
      },
    }),
  );
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
  vi.stubEnv("KILO_API_KEY", "");
  vi.stubEnv("KILO_ORG_ID", "");
  vi.stubEnv("KILOCODE_ORGANIZATION_ID", "");

  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(catalogResponse());
  vi.stubGlobal("fetch", fetchMock);

  await kiloExtension({ registerProvider: vi.fn(), on: vi.fn() } as never);

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.kilo.ai/api/organizations/organization-id/models",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer stored-access-token",
        "X-KiloCode-OrganizationId": "organization-id",
      }),
    }),
  );
});
