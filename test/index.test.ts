import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import kiloExtension, { parsePrice } from "../src/index.ts";

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
	vi.stubEnv("KILO_PI_CUSTOM_FOOTER", "0");
	vi.stubEnv("KILO_PI_SHOW_CREDITS", "");
	vi.stubEnv("KILO_PI_USAGE", "");
	vi.stubEnv("KILO_PI_SHOW_FOR_OTHER_PROVIDERS", "");
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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

test("parsePrice returns zero for an invalid price", () => {
	expect(parsePrice("not-a-number")).toBe(0);
});

async function customFooterWasInstalled(customFooter: string): Promise<boolean> {
	vi.stubEnv("KILO_PI_CUSTOM_FOOTER", customFooter);
	vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(catalogResponse()));

	const on = vi.fn();
	const setFooter = vi.fn();
	await kiloExtension({ registerProvider: vi.fn(), on } as never);

	const sessionStartHandlers = on.mock.calls
		.filter(([event]) => event === "session_start")
		.map(([, handler]) => handler as (event: unknown, context: unknown) => Promise<void>);
	const context = { model: { provider: "kilo" }, hasUI: true, ui: { setFooter, setStatus: vi.fn() } };
	await Promise.all(sessionStartHandlers.map((handler) => handler({}, context)));

	return setFooter.mock.calls.length > 0;
}

test("does not install the custom footer when disabled", async () => {
	await expect(customFooterWasInstalled("0")).resolves.toBe(false);
});

test("installs the custom footer by default", async () => {
	await expect(customFooterWasInstalled("")).resolves.toBe(true);
});

test("hides ambient Kilo UI at startup for another provider", async () => {
	const runtime = createRuntime({ apiKey: "api-key", provider: "other" });
	vi.stubEnv("KILO_PI_CUSTOM_FOOTER", "1");
	vi.stubEnv("KILO_PI_USAGE", "day");

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await Promise.all(handlers(runtime.on, "session_start").map((run) => run({}, runtime.context)));

	expect(runtime.context.ui.setFooter).not.toHaveBeenCalled();
	for (const key of ["kilo-credits", "kilo-usage-day", "kilo-usage-week", "kilo-usage-month", "kilo-usage-year"]) {
		expect(runtime.setStatus).toHaveBeenCalledWith(key, undefined);
	}
	expect(runtime.fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/models"))).toHaveLength(2);
	expect(runtime.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/balance"))).toBe(false);
	expect(runtime.fetchMock.mock.calls.some(([url]) => String(url).includes("/usage?"))).toBe(false);
});

test("model selection hides and restores ambient Kilo UI", async () => {
	const runtime = createRuntime({ apiKey: "api-key" });
	vi.stubEnv("KILO_PI_CUSTOM_FOOTER", "1");

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await Promise.all(handlers(runtime.on, "session_start").map((run) => run({}, runtime.context)));
	expect(runtime.context.ui.setFooter).toHaveBeenLastCalledWith(expect.any(Function));

	runtime.context.model.provider = "other";
	await handler(runtime.on, "model_select")({ model: { provider: "other" } }, runtime.context);
	expect(runtime.context.ui.setFooter).toHaveBeenLastCalledWith(undefined);
	expect(runtime.setStatus).toHaveBeenCalledWith("kilo-credits", undefined);

	runtime.context.model.provider = "kilo";
	await handler(runtime.on, "model_select")({ model: { provider: "kilo" } }, runtime.context);
	expect(runtime.context.ui.setFooter).toHaveBeenLastCalledWith(expect.any(Function));
	expect(runtime.setStatus).toHaveBeenLastCalledWith("kilo-credits", "💰 $12.34");
});

test("selecting a Kilo model immediately restores configured usage status", async () => {
	vi.stubEnv("KILO_PI_USAGE", "day");
	const runtime = createRuntime({
		apiKey: "api-key",
		provider: "other",
		usage: { usage: [{ date: new Date().toISOString().slice(0, 10), total_cost: 4_000_000 }] },
	});

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	runtime.context.model.provider = "kilo";
	await handler(runtime.on, "model_select")({ model: { provider: "kilo" } }, runtime.context);

	await vi.waitFor(() => {
		expect(runtime.setStatus).toHaveBeenCalledWith("kilo-usage-day", "💸 $4.00 today");
	});
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
		model: { provider: "kilo" },
		hasUI: true,
		ui: { setFooter: vi.fn(), setStatus, theme: { fg: vi.fn((_tone, text) => text) } },
		modelRegistry: { registerProvider: vi.fn() },
	};
	await Promise.all(sessionStartHandlers.map((handler) => handler({}, context)));

	expect(setStatus).toHaveBeenCalledWith("kilo-credits", "💰 $12.34");
	expect(context.ui.setFooter).not.toHaveBeenCalled();
});

test("does not fetch or display credits when KILO_PI_SHOW_CREDITS is disabled", async () => {
	const runtime = createRuntime({ apiKey: "api-key" });
	const configDirectory = join(agentDirectory, "extensions", "kilo-pi-provider");
	mkdirSync(configDirectory, { recursive: true });
	writeFileSync(join(configDirectory, "config.json"), JSON.stringify({ credits: { enabled: false } }));

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, "session_start")({}, runtime.context);
	await handler(runtime.on, "model_select")({ model: { provider: "kilo" } }, runtime.context);
	await handler(runtime.on, "turn_end")({}, runtime.context);

	expect(runtime.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/balance"))).toBe(false);
	expect(runtime.setStatus).not.toHaveBeenCalledWith("kilo-credits", expect.anything());
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
			api: "openai-responses",
			streamSimple: expect.any(Function),
			models: [
				expect.objectContaining({
					id: "acme/code-model:free",
					name: "Acme Code Model",
					api: "openai-completions",
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

function handlers(on: ReturnType<typeof vi.fn>, event: string): ExtensionHandler[] {
	return on.mock.calls.filter(([name]) => name === event).map(([, run]) => run as ExtensionHandler);
}

function handler(on: ReturnType<typeof vi.fn>, event: string): ExtensionHandler {
	const registered = on.mock.calls.find(([name]) => name === event)?.[1] as ExtensionHandler | undefined;
	if (!registered) throw new Error(`${event} handler not registered`);
	return registered;
}

function createRuntime(
	options: {
		auth?: object;
		apiKey?: string;
		organizationId?: string;
		balance?: number;
		balanceResponse?: Promise<Response>;
		usage?: unknown;
		usageResponse?: Promise<Response>;
		provider?: string;
	} = {},
) {
	if (options.auth) setAuth(options.auth);
	vi.stubEnv("KILO_API_KEY", options.apiKey ?? "");
	vi.stubEnv("KILO_ORG_ID", options.organizationId ?? "");
	const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
		const url = String(input);
		if (url.endsWith("/balance")) {
			return (
				options.balanceResponse ??
				new Response(JSON.stringify({ balance: options.balance ?? 12.34 }), { status: 200 })
			);
		}
		if (url.includes("/usage?")) {
			return options.usageResponse ?? new Response(JSON.stringify(options.usage ?? { usage: [] }), { status: 200 });
		}
		return catalogResponse();
	});
	vi.stubGlobal("fetch", fetchMock);
	const on = vi.fn();
	const setStatus = vi.fn();
	const context = {
		model: { provider: options.provider ?? "kilo" },
		hasUI: true,
		ui: { setFooter: vi.fn(), setStatus, theme: { fg: vi.fn((_tone, text) => text) } },
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
	["model_select", { model: { provider: "other" } }, { apiKey: "api-key" }, {}, 1, "kilo-credits"],
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

test("does not request usage or set a usage status by default", async () => {
	const runtime = createRuntime({ apiKey: "api-key" });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, "session_start")({}, runtime.context);
	await handler(runtime.on, "turn_end")({}, runtime.context);

	expect(runtime.fetchMock.mock.calls.some(([url]) => String(url).includes("/usage?"))).toBe(false);
	expect(runtime.setStatus).not.toHaveBeenCalledWith("kilo-usage-day", expect.anything());
});

test.each(["1", "true", "yes", "day"])("%s enables daily usage status refreshes", async (value) => {
	vi.stubEnv("KILO_PI_USAGE", value);
	const runtime = createRuntime({
		apiKey: "api-key",
		usage: { usage: [{ date: new Date().toISOString().slice(0, 10), total_cost: 1_234_567 }] },
	});

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, "session_start")({}, runtime.context);

	await vi.waitFor(() => {
		expect(runtime.setStatus).toHaveBeenCalledWith("kilo-usage-day", "💸 $1.23 today");
	});
	expect(runtime.fetchMock.mock.calls.some(([url]) => String(url).includes("/usage?period=week"))).toBe(true);
});

test("turn_end skips ambient API calls for another provider", async () => {
	vi.stubEnv("KILO_PI_USAGE", "day");
	const runtime = createRuntime({ apiKey: "api-key", provider: "other" });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, "turn_end")({}, runtime.context);

	expect(runtime.fetchMock).toHaveBeenCalledTimes(1);
	expect(runtime.setStatus).not.toHaveBeenCalled();
});

test("the display override keeps turn-related ambient API calls enabled", async () => {
	vi.stubEnv("KILO_PI_SHOW_FOR_OTHER_PROVIDERS", "1");
	vi.stubEnv("KILO_PI_USAGE", "day");
	const runtime = createRuntime({ apiKey: "api-key", provider: "other" });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, "turn_end")({}, runtime.context);

	await vi.waitFor(() => expect(runtime.fetchMock).toHaveBeenCalledTimes(3));
});

test("turn_end schedules an enabled daily usage refresh", async () => {
	vi.stubEnv("KILO_PI_USAGE", "day");
	const runtime = createRuntime({
		apiKey: "api-key",
		usage: { usage: [{ date: new Date().toISOString().slice(0, 10), total_cost: 2_000_000 }] },
	});

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, "turn_end")({}, runtime.context);

	await vi.waitFor(() => {
		expect(runtime.setStatus).toHaveBeenCalledWith("kilo-usage-day", "💸 $2.00 today");
	});
});

test("switching providers prevents an in-flight balance refresh from republishing status", async () => {
	const balanceResponse = deferred<Response>();
	const runtime = createRuntime({ apiKey: "api-key", balanceResponse: balanceResponse.promise });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	const turnEnd = handler(runtime.on, "turn_end")({}, runtime.context);
	runtime.context.model.provider = "other";
	await handler(runtime.on, "model_select")({ model: { provider: "other" } }, runtime.context);

	balanceResponse.resolve(new Response(JSON.stringify({ balance: 99.99 }), { status: 200 }));
	await turnEnd;
	expect(runtime.setStatus).not.toHaveBeenCalledWith("kilo-credits", "💰 $99.99");
});

test("switching providers prevents an in-flight usage refresh from republishing status", async () => {
	vi.stubEnv("KILO_PI_USAGE", "day");
	const usageResponse = deferred<Response>();
	const runtime = createRuntime({ apiKey: "api-key", usageResponse: usageResponse.promise });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await handler(runtime.on, "turn_end")({}, runtime.context);
	runtime.context.model.provider = "other";
	await handler(runtime.on, "model_select")({ model: { provider: "other" } }, runtime.context);

	usageResponse.resolve(
		new Response(
			JSON.stringify({ usage: [{ date: new Date().toISOString().slice(0, 10), total_cost: 3_000_000 }] }),
			{ status: 200 },
		),
	);
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(runtime.setStatus).not.toHaveBeenCalledWith("kilo-usage-day", "💸 $3.00 today");
});

test("turn_end does not wait for an enabled usage response", async () => {
	vi.stubEnv("KILO_PI_USAGE", "day");
	const usageResponse = deferred<Response>();
	const runtime = createRuntime({ apiKey: "api-key", usageResponse: usageResponse.promise });

	await kiloExtension({ registerProvider: vi.fn(), on: runtime.on } as never);
	await expect(handler(runtime.on, "turn_end")({}, runtime.context)).resolves.toBeUndefined();
	expect(runtime.fetchMock.mock.calls.some(([url]) => String(url).includes("/usage?"))).toBe(true);

	usageResponse.resolve(
		new Response(
			JSON.stringify({ usage: [{ date: new Date().toISOString().slice(0, 10), total_cost: 3_000_000 }] }),
			{ status: 200 },
		),
	);
	await vi.waitFor(() => {
		expect(runtime.setStatus).toHaveBeenCalledWith("kilo-usage-day", "💸 $3.00 today");
	});
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
