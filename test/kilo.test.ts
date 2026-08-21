import { mkdtempSync, rmSync } from "node:fs";
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

test("registers anonymous free models from the Kilo catalog", async () => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "kilo-pi-provider-test-"));
  temporaryDirectories.push(agentDirectory);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
  vi.stubEnv("KILO_API_KEY", "");
  vi.stubEnv("KILO_ORG_ID", "");
  vi.stubEnv("KILOCODE_ORGANIZATION_ID", "");

  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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
    ),
  );
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
