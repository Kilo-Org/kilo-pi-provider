import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import kiloExtension, { parsePrice, usesCustomFooter } from "../src/index.ts";

const temporaryDirectories: string[] = [];
let agentDirectory: string;

beforeEach(() => {
	agentDirectory = mkdtempSync(join(tmpdir(), "kilo-pi-provider-test-"));
	temporaryDirectories.push(agentDirectory);
	writeFileSync(join(agentDirectory, "auth.json"), "{}");
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
	vi.stubEnv("KILO_API_KEY", "");
	vi.stubEnv("KILO_ORG_ID", "");
	vi.stubEnv("KILOCODE_ORGANIZATION_ID", "");
	vi.stubEnv("KILO_CUSTOM_FOOTER", "0");
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();

	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function setAuth(auth: object): void {
	writeFileSync(join(agentDirectory, "auth.json"), JSON.stringify(auth));
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
	setAuth({ kilo: { type: "oauth", access: "stored-access-token" } });

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
	setAuth({
		kilo: { type: "oauth", access: "stored-access-token", accountId: "organization-id" },
	});

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

type ExtensionHandler = (event: unknown, context: unknown) => Promise<unknown>;

function handler(on: ReturnType<typeof vi.fn>, event: string): ExtensionHandler {
	const registered = on.mock.calls.find(([name]) => name === event)?.[1] as ExtensionHandler | undefined;
	if (!registered) throw new Error(`${event} handler not registered`);
	return registered;
}

function createRuntime(options: { auth?: object; apiKey?: string; organizationId?: string; balance?: number } = {}) {
	if (options.auth) setAuth(options.auth);
	vi.stubEnv("KILO_API_KEY", options.apiKey ?? "");
	vi.stubEnv("KILO_ORG_ID", options.organizationId ?? "");
	const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
		if (String(input).endsWith("/balance")) {
			return new Response(JSON.stringify({ balance: options.balance ?? 12.34 }), { status: 200 });
		}
		return catalogResponse();
	});
	vi.stubGlobal("fetch", fetchMock);
	const on = vi.fn();
	const setStatus = vi.fn();
	const context = {
		hasUI: true,
		ui: { setStatus, theme: { fg: vi.fn((_tone, text) => text) } },
		modelRegistry: { registerProvider: vi.fn() },
	};

	return { context, fetchMock, on, setStatus };
}

test("session_start refreshes the API-key catalog and credits", async () => {
	const runtime = createRuntime({ apiKey: "api-key", organizationId: "org-id" });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, "session_start")({}, runtime.context);

	expect(runtime.fetchMock.mock.calls).toEqual([
		[
			"https://api.kilo.ai/api/organizations/org-id/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer api-key",
					"X-KiloCode-OrganizationId": "org-id",
				}),
			}),
		],
		[
			"https://api.kilo.ai/api/organizations/org-id/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer api-key",
					"X-KiloCode-OrganizationId": "org-id",
				}),
			}),
		],
		[
			"https://api.kilo.ai/api/profile/balance",
			expect.objectContaining({
				headers: {
					Authorization: "Bearer api-key",
					"Content-Type": "application/json",
					"X-KiloCode-OrganizationId": "org-id",
				},
			}),
		],
	]);
	expect(runtime.setStatus).toHaveBeenCalledWith("kilo-credits", "💰 $12.34");
});

test.each([
	["model_select", { model: { provider: "kilo" } }],
	["turn_end", {}],
])("%s refreshes API-key credits", async (event, payload) => {
	const runtime = createRuntime({ apiKey: "api-key", organizationId: "org-id" });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, event)(payload, runtime.context);

	expect(runtime.fetchMock.mock.calls[1]).toEqual([
		"https://api.kilo.ai/api/profile/balance",
		expect.objectContaining({
			headers: {
				Authorization: "Bearer api-key",
				"Content-Type": "application/json",
				"X-KiloCode-OrganizationId": "org-id",
			},
		}),
	]);
	expect(runtime.setStatus).toHaveBeenCalledWith("kilo-credits", "💰 $12.34");
});

test.each([
	["session_start", {}, {}, {}, 1, "kilo-credits"],
	["session_start", {}, { apiKey: "api-key" }, { hasUI: false }, 2, undefined],
	["model_select", { model: { provider: "other" } }, { apiKey: "api-key" }, {}, 1, undefined],
	["turn_end", {}, { apiKey: "api-key" }, { hasUI: false }, 1, undefined],
])(
	"%s skips credit work when access, UI, or Kilo model requirements are unmet",
	async (event, payload, runtimeOptions, contextOverrides, expectedFetchCount, expectedStatus) => {
		const runtime = createRuntime(runtimeOptions);
		const context = { ...runtime.context, ...contextOverrides };

		await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
		await handler(runtime.on, event)(payload, context);

		expect(runtime.fetchMock).toHaveBeenCalledTimes(expectedFetchCount);
		if (expectedStatus) {
			expect(runtime.setStatus).toHaveBeenCalledWith(expectedStatus, undefined);
		} else {
			expect(runtime.setStatus).not.toHaveBeenCalled();
		}
	},
);

test.each([
	["API key", {}, "api-key", undefined],
	["OAuth", { kilo: { type: "oauth", access: "oauth-token" } }, "", undefined],
	[
		"unauthenticated",
		{},
		"",
		{
			message: {
				customType: "kilo",
				content: "By using Kilo, you agree to the Terms of Service: https://kilo.ai/terms",
				display: true,
			},
		},
	],
])("before_agent_start handles %s Kilo access", async (_name, auth, apiKey, expected) => {
	const runtime = createRuntime({ auth, apiKey });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	const beforeAgentStart = handler(runtime.on, "before_agent_start");
	await expect(beforeAgentStart({}, { model: { provider: "kilo" } })).resolves.toEqual(expected);
	await expect(beforeAgentStart({}, { model: { provider: "kilo" } })).resolves.toBeUndefined();
});

test("before_agent_start does not consume the notice for another provider", async () => {
	const runtime = createRuntime();

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	const beforeAgentStart = handler(runtime.on, "before_agent_start");
	await expect(beforeAgentStart({}, { model: { provider: "other" } })).resolves.toBeUndefined();
	await expect(beforeAgentStart({}, { model: { provider: "kilo" } })).resolves.toMatchObject({
		message: { customType: "kilo", display: true },
	});
});
