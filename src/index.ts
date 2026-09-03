/**
 * Kilo Provider Extension
 *
 * Provides access to 300+ AI models via the Kilo Gateway (OpenRouter-compatible).
 * Uses device code flow for browser-based authentication.
 *
 * Usage:
 *   pi install git:github.com/Kilo-Org/kilo-pi-provider
 *   # Then /login kilo, or set KILO_API_KEY=...
 */

import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { isFreeModel, mapOpenRouterModel, type OpenRouterModel, parsePrice } from "./models.ts";

export { parsePrice };

import type { ExtensionAPI, ExtensionContext, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
	fetchKiloBalance,
	fetchKiloUsageEntries,
	KILO_API_BASE,
	KILO_ORG_HEADER,
	withOrganizationHeader,
} from "./api.ts";
import {
	getEffectiveOrganizationId,
	getEnvOrganizationId,
	getKiloAccess,
	loginKilo,
	refreshKiloToken,
} from "./auth.ts";
import { loadKiloPreferences } from "./config.ts";
import { installCustomFooter } from "./footer.ts";
import { streamKiloResponses } from "./responses.ts";

import { createUsageRefresher } from "./usage.ts";

// =============================================================================
// Constants
// =============================================================================

const KILO_GATEWAY_BASE = `${KILO_API_BASE}/api/gateway`;
const MODELS_FETCH_TIMEOUT_MS = 10_000;
const KILO_TOS_URL = "https://kilo.ai/terms";
const KILO_STATUS_KEYS = [
	"kilo-credits",
	"kilo-usage-day",
	"kilo-usage-week",
	"kilo-usage-month",
	"kilo-usage-year",
] as const;

function formatCredits(balance: number): string {
	if (balance >= 1000) {
		return `$${(balance / 1000).toFixed(1)}k`;
	} else {
		return `$${balance.toFixed(2)}`;
	}
}

// =============================================================================
// Dynamic Model Loading
// =============================================================================

async function fetchKiloModels(options?: {
	token?: string;
	organizationId?: string;
	freeOnly?: boolean;
}): Promise<ProviderModelConfig[]> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"User-Agent": "pi-kilo-provider",
	};
	if (options?.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}
	const organizationId = options?.organizationId;
	const requestHeaders = withOrganizationHeader(headers, organizationId);
	const modelsUrl = organizationId
		? `${KILO_API_BASE}/api/organizations/${encodeURIComponent(organizationId)}/models`
		: `${KILO_GATEWAY_BASE}/models`;

	const response = await fetch(modelsUrl, {
		headers: requestHeaders,
		signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
	}

	const json = (await response.json()) as { data?: OpenRouterModel[] };
	if (!json.data || !Array.isArray(json.data)) {
		throw new Error("Invalid models response: missing data array");
	}

	return json.data
		.filter((m) => {
			// Skip image generation models
			const outputMods = m.architecture?.output_modalities ?? [];
			if (outputMods.includes("image")) return false;
			// When unauthenticated, only show free models
			if (options?.freeOnly && !isFreeModel(m)) return false;
			return true;
		})
		.map(mapOpenRouterModel);
}

// =============================================================================
// Provider Config
// =============================================================================

const KILO_PROVIDER_CONFIG = {
	baseUrl: KILO_GATEWAY_BASE,
	apiKey: "$KILO_API_KEY",
	// Pi applies a custom streamSimple only to models whose API matches this one.
	// mapOpenRouterModel assigns both Responses and chat-completions APIs explicitly.
	api: "openai-responses" as const,
	streamSimple: streamKiloResponses,
	headers: {
		"X-KILOCODE-EDITORNAME": "Pi",
		"User-Agent": "pi-kilo-provider",
	},
};

function makeProviderConfig(organizationId?: string) {
	return {
		...KILO_PROVIDER_CONFIG,
		headers: withOrganizationHeader(KILO_PROVIDER_CONFIG.headers, organizationId),
	};
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const startupAccess = getKiloAccess();
	let preferences = loadKiloPreferences({ cwd: process.cwd(), projectTrusted: false });

	let kiloFooterInstalled = false;
	const shouldShowAmbientKiloUi = (provider: string | undefined): boolean =>
		provider === "kilo" || preferences.display.showForOtherProviders;

	const clearAmbientKiloStatuses = (ctx: ExtensionContext): void => {
		for (const key of KILO_STATUS_KEYS) ctx.ui.setStatus(key, undefined);
	};

	const reconcileAmbientKiloUi = (ctx: ExtensionContext, provider: string | undefined): boolean => {
		const visible = shouldShowAmbientKiloUi(provider);
		if (!ctx.hasUI) return visible;

		if (visible && preferences.footer.custom && !kiloFooterInstalled) {
			installCustomFooter(pi, ctx, preferences.credits.enabled);
			kiloFooterInstalled = true;
		} else if ((!visible || !preferences.footer.custom) && kiloFooterInstalled) {
			ctx.ui.setFooter(undefined);
			kiloFooterInstalled = false;
		}

		if (!visible) clearAmbientKiloStatuses(ctx);
		return visible;
	};

	// Fetch models at load time so the provider is immediately usable for
	// --list-models, --model selection, and print mode before session_start fires.
	let freeModels: ProviderModelConfig[] = [];
	let cachedAllModels: ProviderModelConfig[] = [];
	const usageRefresher = createUsageRefresher({ fetchUsageEntries: fetchKiloUsageEntries });
	try {
		if (startupAccess) {
			cachedAllModels = await fetchKiloModels({
				token: startupAccess.token,
				organizationId: startupAccess.organizationId,
			});
			freeModels = cachedAllModels.length > 0 ? cachedAllModels : [];
		} else {
			freeModels = await fetchKiloModels({ freeOnly: true });
		}
	} catch (error) {
		console.warn("[kilo] Failed to fetch models at startup:", error instanceof Error ? error.message : error);
		if (freeModels.length === 0) {
			try {
				freeModels = await fetchKiloModels({ freeOnly: true });
			} catch {}
		}
	}

	function makeOAuthConfig() {
		return {
			name: "Kilo",
			login: async (callbacks: OAuthLoginCallbacks) => {
				const cred = await loginKilo(callbacks);
				// Cache full models so modifyModels can use them during the
				// modelRegistry.refresh() that runs right after login returns.
				try {
					const organizationId = getEffectiveOrganizationId(cred);
					cachedAllModels = await fetchKiloModels({ token: cred.access, organizationId });
				} catch (error) {
					console.warn(
						"[kilo] Failed to fetch models after login:",
						error instanceof Error ? error.message : error,
					);
				}
				return cred;
			},
			refreshToken: refreshKiloToken,
			getApiKey: (cred: OAuthCredentials) => cred.access,
			// Called by modelRegistry.refresh() when credentials exist.
			// After logout, credentials are removed so this won't be called,
			// leaving only the free models from config.models.
			modifyModels: (models: Model<Api>[], cred: OAuthCredentials) => {
				if (cachedAllModels.length === 0) return models;
				const organizationId = getEffectiveOrganizationId(cred);
				const orgHeaders = organizationId ? { [KILO_ORG_HEADER]: organizationId } : undefined;
				// Use an existing kilo model as a template for provider metadata
				const template = models.find((m) => m.provider === "kilo");
				if (!template) return models;
				const nonKilo = models.filter((m) => m.provider !== "kilo");
				const fullModels = cachedAllModels.map((m) => ({
					...template,
					id: m.id,
					name: m.name,
					api: m.api ?? template.api,
					baseUrl: m.baseUrl ?? template.baseUrl,
					reasoning: m.reasoning,
					input: m.input,
					cost: m.cost,
					contextWindow: m.contextWindow,
					maxTokens: m.maxTokens,
					thinkingLevelMap: m.thinkingLevelMap,
					headers: orgHeaders,
					compat: m.compat,
				}));
				return [...nonKilo, ...fullModels];
			},
		};
	}

	// Always register with free models. modifyModels upgrades to full list
	// when credentials exist, and naturally falls back after logout.
	pi.registerProvider("kilo", {
		...makeProviderConfig(getEnvOrganizationId()),
		models: freeModels,
		oauth: makeOAuthConfig(),
	});

	// After session starts, pre-fetch all models if already logged in so
	// modifyModels has data to work with. Also fetch and display credits.
	pi.on("session_start", async (_event, ctx) => {
		preferences = loadKiloPreferences({
			cwd: ctx.cwd ?? process.cwd(),
			projectTrusted: ctx.isProjectTrusted?.() ?? false,
		});
		const access = getKiloAccess();
		const usagePeriods = preferences.usage.periods;

		if (!reconcileAmbientKiloUi(ctx, ctx.model?.provider)) return;

		// Clear a stale credit status after logout when an interactive UI is available.
		if (!access) {
			if (ctx.hasUI) ctx.ui.setStatus("kilo-credits", undefined);
			return;
		}

		if (ctx.hasUI && usagePeriods.length > 0) {
			usageRefresher.refresh(access, usagePeriods, {
				setStatus: (key, value) => ctx.ui.setStatus(key, value),
				accent: (text) => ctx.ui.theme.fg("accent", text),
			});
		}

		try {
			cachedAllModels = await fetchKiloModels({
				token: access.token,
				organizationId: access.organizationId,
			});
		} catch (error) {
			console.warn(
				"[kilo] Failed to fetch models at session start:",
				error instanceof Error ? error.message : error,
			);
			return;
		}
		if (cachedAllModels.length > 0) {
			// Re-register to trigger modifyModels with the cached data.
			ctx.modelRegistry.registerProvider("kilo", {
				...makeProviderConfig(access.organizationId),
				models: freeModels,
				oauth: makeOAuthConfig(),
			});
		}

		// Fetch and display credits balance when enabled and an interactive UI is available.
		if (ctx.hasUI && preferences.credits.enabled) {
			try {
				const balance = await fetchKiloBalance(access.token, access.organizationId);
				if (balance !== null) {
					const theme = ctx.ui.theme;
					ctx.ui.setStatus("kilo-credits", theme.fg("accent", `💰 ${formatCredits(balance)}`));
				}
			} catch (error) {
				console.warn("[kilo] Failed to fetch balance:", error instanceof Error ? error.message : error);
			}
		}
	});

	// Update credits display when model changes to a Kilo model
	pi.on("model_select", async (event, ctx) => {
		if (!reconcileAmbientKiloUi(ctx, event.model.provider)) return;
		if (event.model.provider !== "kilo" && !preferences.display.showForOtherProviders) return;

		const access = getKiloAccess();
		if (!access) return;

		if (!ctx.hasUI || !preferences.credits.enabled) return;

		try {
			const balance = await fetchKiloBalance(access.token, access.organizationId);
			if (balance !== null) {
				const theme = ctx.ui.theme;
				ctx.ui.setStatus("kilo-credits", theme.fg("accent", `💰 ${formatCredits(balance)}`));
			}
		} catch (error) {
			console.warn(
				"[kilo] Failed to fetch balance on model select:",
				error instanceof Error ? error.message : error,
			);
		}
	});

	// Refresh credits and opt-in usage after each turn.
	pi.on("turn_end", async (_event, ctx) => {
		if (!shouldShowAmbientKiloUi(ctx.model?.provider)) return;

		const access = getKiloAccess();
		const usagePeriods = preferences.usage.periods;
		if (!access || !ctx.hasUI) return;

		if (usagePeriods.length > 0) {
			usageRefresher.refresh(access, usagePeriods, {
				setStatus: (key, value) => ctx.ui.setStatus(key, value),
				accent: (text) => ctx.ui.theme.fg("accent", text),
			});
		}

		if (!preferences.credits.enabled) return;

		try {
			const balance = await fetchKiloBalance(access.token, access.organizationId);
			if (balance !== null) {
				const theme = ctx.ui.theme;
				ctx.ui.setStatus("kilo-credits", theme.fg("accent", `💰 ${formatCredits(balance)}`));
			}
		} catch (error) {
			console.warn("[kilo] Failed to fetch balance on turn end:", error instanceof Error ? error.message : error);
		}
	});

	// On first use of a Kilo model without login, print ToS notice.
	let tosShown = false;

	pi.on("before_agent_start", async (_event, ctx) => {
		if (tosShown) return;
		if (ctx.model?.provider !== "kilo") return;

		if (getKiloAccess()) {
			tosShown = true;
			return;
		}

		tosShown = true;

		return {
			message: {
				customType: "kilo",
				content: `By using Kilo, you agree to the Terms of Service: ${KILO_TOS_URL}`,
				display: true,
			},
		};
	});
}
