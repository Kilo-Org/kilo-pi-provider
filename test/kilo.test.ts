import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import kiloExtension, { parsePrice, usesCustomFooter } from "../kilo.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();

	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function isolateAuth(auth: object = {}): void {
	const agentDirectory = mkdtempSync(join(tmpdir(), "kilo-pi-provider-test-"));
	temporaryDirectories.push(agentDirectory);
	writeFileSync(join(agentDirectory, "auth.json"), JSON.stringify(auth));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
	vi.stubEnv("KILO_API_KEY", "");
	vi.stubEnv("KILO_ORG_ID", "");
	vi.stubEnv("KILOCODE_ORGANIZATION_ID", "");
	vi.stubEnv("KILO_CUSTOM_FOOTER", "0");
}

async function runSessionStart(on: ReturnType<typeof vi.fn>, context: object): Promise<void> {
	const handler = on.mock.calls.find(([event]) => event === "session_start")?.[1] as
		| ((event: unknown, context: unknown) => Promise<void>)
		| undefined;
	if (!handler) throw new Error("session_start handler not registered");
	await handler({}, context);
}

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

test.each([
	[undefined, true],
	["1", true],
	["true", true],
	["unexpected", true],
	["0", false],
	["false", false],
	["FALSE", false],
	[" no ", false],
])("usesCustomFooter returns %s for KILO_CUSTOM_FOOTER=%s", (value, expected) => {
	if (value === undefined) {
		vi.stubEnv("KILO_CUSTOM_FOOTER", "");
	} else {
		vi.stubEnv("KILO_CUSTOM_FOOTER", value);
	}

	expect(usesCustomFooter()).toBe(expected);
});

test("parsePrice returns zero for an invalid price", () => {
	expect(parsePrice("not-a-number")).toBe(0);
});

async function customFooterWasInstalled(customFooter: string): Promise<boolean> {
	const agentDirectory = mkdtempSync(join(tmpdir(), "kilo-pi-provider-test-"));
	temporaryDirectories.push(agentDirectory);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
	vi.stubEnv("KILO_CUSTOM_FOOTER", customFooter);
	vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(catalogResponse()));

	const on = vi.fn();
	const setFooter = vi.fn();
	await kiloExtension({ registerProvider: vi.fn(), on } as never);

	const sessionStartHandlers = on.mock.calls
		.filter(([event]) => event === "session_start")
		.map(([, handler]) => handler as (event: unknown, context: unknown) => Promise<void>);
	const context = { hasUI: true, ui: { setFooter, setStatus: vi.fn() } };
	await Promise.all(sessionStartHandlers.map((handler) => handler({}, context)));

	return setFooter.mock.calls.length > 0;
}

test("does not install the custom footer when disabled", async () => {
	await expect(customFooterWasInstalled("0")).resolves.toBe(false);
});

test("installs the custom footer by default", async () => {
	await expect(customFooterWasInstalled("")).resolves.toBe(true);
});

test("exposes Kilo credits when the custom footer is disabled", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "kilo-pi-provider-test-"));
	temporaryDirectories.push(agentDirectory);
	writeFileSync(
		join(agentDirectory, "auth.json"),
		JSON.stringify({
			kilo: { type: "oauth", access: "stored-access-token" },
		}),
	);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
	vi.stubEnv("KILO_CUSTOM_FOOTER", "0");

	const fetchMock = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(catalogResponse())
		.mockResolvedValueOnce(catalogResponse())
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ balance: 12.34 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	vi.stubGlobal("fetch", fetchMock);

	const on = vi.fn();
	const setStatus = vi.fn();
	await kiloExtension({ registerProvider: vi.fn(), on } as never);

	const sessionStartHandlers = on.mock.calls
		.filter(([event]) => event === "session_start")
		.map(([, handler]) => handler as (event: unknown, context: unknown) => Promise<void>);
	const context = {
		hasUI: true,
		ui: { setFooter: vi.fn(), setStatus, theme: { fg: vi.fn((_tone, text) => text) } },
		modelRegistry: { registerProvider: vi.fn() },
	};
	await Promise.all(sessionStartHandlers.map((handler) => handler({}, context)));

	expect(setStatus).toHaveBeenCalledWith("kilo-credits", "💰 $12.34");
	expect(context.ui.setFooter).not.toHaveBeenCalled();
});

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

test("loads the organization catalog with KILO_API_KEY", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "kilo-pi-provider-test-"));
	temporaryDirectories.push(agentDirectory);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
	vi.stubEnv("KILO_API_KEY", "environment-api-key");
	vi.stubEnv("KILO_ORG_ID", "organization-id");
	vi.stubEnv("KILOCODE_ORGANIZATION_ID", "");

	const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(catalogResponse());
	vi.stubGlobal("fetch", fetchMock);

	await kiloExtension({ registerProvider: vi.fn(), on: vi.fn() } as never);

	expect(fetchMock).toHaveBeenCalledOnce();
	expect(fetchMock).toHaveBeenCalledWith(
		"https://api.kilo.ai/api/organizations/organization-id/models",
		expect.objectContaining({
			headers: expect.objectContaining({
				Authorization: "Bearer environment-api-key",
				"X-KiloCode-OrganizationId": "organization-id",
			}),
		}),
	);
});

test("session_start refreshes the catalog and credits for API-key-only access", async () => {
	isolateAuth();
	vi.stubEnv("KILO_API_KEY", "api-key");
	const fetchMock = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(catalogResponse())
		.mockResolvedValueOnce(catalogResponse())
		.mockResolvedValueOnce(new Response(JSON.stringify({ balance: 12.34 }), { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
	const on = vi.fn();
	const setStatus = vi.fn();

	await kiloExtension({ registerProvider: vi.fn(), on } as never);
	await runSessionStart(on, {
		hasUI: true,
		ui: { setStatus, theme: { fg: vi.fn((_tone, text) => text) } },
		modelRegistry: { registerProvider: vi.fn() },
	});

	expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.kilo.ai/api/gateway/models");
	expect(fetchMock.mock.calls[1]?.[1]).toEqual(
		expect.objectContaining({
			headers: expect.objectContaining({ Authorization: "Bearer api-key" }),
		}),
	);
	expect(fetchMock.mock.calls[2]?.[0]).toBe("https://api.kilo.ai/api/profile/balance");
	expect(setStatus).toHaveBeenCalledWith("kilo-credits", "💰 $12.34");
});

test("session_start uses the API key organization for catalog and balance", async () => {
	isolateAuth();
	vi.stubEnv("KILO_API_KEY", "api-key");
	vi.stubEnv("KILO_ORG_ID", "org-id");
	const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
		if (String(input).endsWith("/balance")) {
			return new Response(JSON.stringify({ balance: 12.34 }), { status: 200 });
		}
		return catalogResponse();
	});
	vi.stubGlobal("fetch", fetchMock);
	const on = vi.fn();
	const context = {
		hasUI: true,
		ui: { setStatus: vi.fn(), theme: { fg: vi.fn((_tone, text) => text) } },
		modelRegistry: { registerProvider: vi.fn() },
	};

	await kiloExtension({ registerProvider: vi.fn(), on } as never);
	await runSessionStart(on, context);

	expect(fetchMock.mock.calls[1]).toEqual([
		"https://api.kilo.ai/api/organizations/org-id/models",
		expect.objectContaining({
			headers: expect.objectContaining({
				Authorization: "Bearer api-key",
				"X-KiloCode-OrganizationId": "org-id",
			}),
		}),
	]);
	expect(fetchMock.mock.calls[2]?.[1]).toEqual(
		expect.objectContaining({
			headers: {
				Authorization: "Bearer api-key",
				"Content-Type": "application/json",
				"X-KiloCode-OrganizationId": "org-id",
			},
		}),
	);
});

test("session_start prefers OAuth credentials and account organization over API-key env values", async () => {
	isolateAuth({ kilo: { type: "oauth", access: "oauth-token", accountId: "account-org" } });
	vi.stubEnv("KILO_API_KEY", "api-key");
	vi.stubEnv("KILO_ORG_ID", "env-org");
	const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
		if (String(input).endsWith("/balance")) {
			return new Response(JSON.stringify({ balance: 12.34 }), { status: 200 });
		}
		return catalogResponse();
	});
	vi.stubGlobal("fetch", fetchMock);
	const on = vi.fn();
	const context = {
		hasUI: true,
		ui: { setStatus: vi.fn(), theme: { fg: vi.fn((_tone, text) => text) } },
		modelRegistry: { registerProvider: vi.fn() },
	};

	await kiloExtension({ registerProvider: vi.fn(), on } as never);
	await runSessionStart(on, context);

	for (const call of fetchMock.mock.calls.slice(0, 2)) {
		expect(call[0]).toBe("https://api.kilo.ai/api/organizations/account-org/models");
		expect(call[1]).toEqual(
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer oauth-token",
					"X-KiloCode-OrganizationId": "account-org",
				}),
			}),
		);
	}
	expect(fetchMock.mock.calls[2]).toEqual([
		"https://api.kilo.ai/api/profile/balance",
		expect.objectContaining({
			headers: {
				Authorization: "Bearer oauth-token",
				"Content-Type": "application/json",
				"X-KiloCode-OrganizationId": "account-org",
			},
		}),
	]);
});

test("session_start clears credits and makes no authenticated request without auth", async () => {
	isolateAuth();
	const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(catalogResponse());
	vi.stubGlobal("fetch", fetchMock);
	const on = vi.fn();
	const setStatus = vi.fn();

	await kiloExtension({ registerProvider: vi.fn(), on } as never);
	await runSessionStart(on, { hasUI: true, ui: { setStatus }, modelRegistry: { registerProvider: vi.fn() } });

	expect(fetchMock).toHaveBeenCalledOnce();
	expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.kilo.ai/api/gateway/models");
	expect(setStatus).toHaveBeenCalledWith("kilo-credits", undefined);
});

test("session_start refreshes the catalog without balance work when UI is unavailable", async () => {
	isolateAuth();
	vi.stubEnv("KILO_API_KEY", "api-key");
	const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(catalogResponse());
	vi.stubGlobal("fetch", fetchMock);
	const on = vi.fn();
	const setStatus = vi.fn();

	await kiloExtension({ registerProvider: vi.fn(), on } as never);
	await runSessionStart(on, {
		hasUI: false,
		ui: { setStatus },
		modelRegistry: { registerProvider: vi.fn() },
	});

	expect(fetchMock).toHaveBeenCalledTimes(2);
	expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.kilo.ai/api/gateway/models");
	expect(setStatus).not.toHaveBeenCalled();
});
