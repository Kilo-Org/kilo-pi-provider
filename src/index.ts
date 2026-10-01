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
import { type KiloChatModelConfig, mergeKiloCatalogModels, parsePrice, selectKiloCatalogModels } from "./models.ts";

export { parsePrice };

import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { createAmbientKiloUi } from "./ambient-ui.ts";
import {
	fetchKiloBalance,
	fetchKiloModelCatalog,
	fetchKiloUsageEntries,
	KILO_GATEWAY_BASE,
	type KiloAccess,
	type KiloModelCatalogRequest,
	type KiloUsageEntry,
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
import { createThemeStatusPublisher } from "./theme-status.ts";

import { createUsagePopup, createUsageRefresher } from "./usage.ts";

// =============================================================================
// Constants
// =============================================================================

const KILO_TOS_URL = "https://kilo.ai/terms";

// =============================================================================
// Dynamic Model Loading
// =============================================================================

async function fetchKiloModels(
	options: KiloModelCatalogRequest & { freeOnly?: boolean } = {},
): Promise<KiloChatModelConfig[]> {
	return selectKiloCatalogModels(await fetchKiloModelCatalog(options), options);
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

export type KiloExtensionApi = Pick<ExtensionAPI, "getThinkingLevel" | "on" | "registerProvider" | "registerCommand">;

interface UsagePopupComponent {
	invalidate(): void;
	setState(entries: KiloUsageEntry[] | null, error?: string): void;
	handleInput(data: string): void;
	render(width: number): string[];
}
export interface UsageCommandContext {
	hasUI: boolean;
	mode: string;
	ui: {
		custom(
			factory: (
				tui: { requestRender(): void },
				theme: Pick<Theme, "fg">,
				keybindings: Pick<KeybindingsManager, never>,
				done: (result: undefined) => void,
			) => UsagePopupComponent,
			options: { overlay: boolean; overlayOptions: { anchor: "center" } },
		): Promise<void>;
		notify(message: string, type: "warning"): void;
	};
}

export interface UsageCommandOptions {
	getAccess(): KiloAccess | undefined;
	fetchUsageEntries?(
		access: KiloAccess,
		period: "year",
		options: { groupByModel: true; signal: AbortSignal },
	): Promise<KiloUsageEntry[] | null>;
}

export function createUsageCommandHandler(options: UsageCommandOptions) {
	return async (ctx: UsageCommandContext): Promise<void> => {
		if (!ctx.hasUI || ctx.mode !== "tui") {
			ctx.ui.notify("Usage is available only in the interactive TUI.", "warning");
			return;
		}
		const access = options.getAccess();
		if (!access) {
			ctx.ui.notify("Sign in to Kilo to view usage.", "warning");
			return;
		}
		const controller = new AbortController();
		let popup: UsagePopupComponent | undefined;
		let loadedEntries: KiloUsageEntry[] | null | undefined;
		let loadError: string | undefined;
		let tui: { requestRender(): void } | undefined;
		let done: ((result: undefined) => void) | undefined;
		const close = (): void => {
			controller.abort();
			done?.(undefined);
		};
		const fetchResult = (options.fetchUsageEntries ?? fetchKiloUsageEntries)(access, "year", {
			groupByModel: true,
			signal: controller.signal,
		})
			.then((entries) => {
				if (entries === null) {
					loadError = "Unable to load usage.";
					popup?.setState(null, loadError);
				} else {
					loadedEntries = entries;
					popup?.setState(entries);
				}
				tui?.requestRender();
			})
			.catch(() => {
				loadError = "Unable to load usage.";
				popup?.setState(null, loadError);
				tui?.requestRender();
			});
		await ctx.ui.custom(
			(nextTui, theme, _keybindings, nextDone) => {
				tui = nextTui;
				done = nextDone;
				popup = createUsagePopup({ theme, onClose: close, entries: loadedEntries ?? null, error: loadError });
				return popup;
			},
			{ overlay: true, overlayOptions: { anchor: "center" } },
		);
		await fetchResult;
	};
}

export default async function (pi: KiloExtensionApi) {
	const startupAccess = getKiloAccess();
	let preferences = loadKiloPreferences({ cwd: process.cwd(), projectTrusted: false });

	const themeStatuses = createThemeStatusPublisher();
	const ambientUi = createAmbientKiloUi<ExtensionContext>({
		getPreferences: () => preferences,
		themeStatuses,
		usageRefresher: createUsageRefresher({ fetchUsageEntries: fetchKiloUsageEntries }),
		installFooter: (ctx) => installCustomFooter(pi, ctx, preferences.credits.enabled),
		fetchBalance: (access) => fetchKiloBalance(access.token, access.organizationId),
	});

	// Fetch models at load time so the provider is immediately usable for
	// --list-models, --model selection, and print mode before session_start fires.
	let freeModels: KiloChatModelConfig[] = [];
	let cachedAllModels: KiloChatModelConfig[] = [];
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
			modifyModels: (models: Model<Api>[], cred: OAuthCredentials) =>
				mergeKiloCatalogModels(models, cachedAllModels, getEffectiveOrganizationId(cred)),
		};
	}

	// Always register with free models. modifyModels upgrades to full list
	// when credentials exist, and naturally falls back after logout.
	pi.registerProvider("kilo", {
		...makeProviderConfig(getEnvOrganizationId()),
		models: freeModels,
		oauth: makeOAuthConfig(),
	});

	pi.registerCommand("kilo-usage", {
		description: "Show Kilo usage",
		handler: async (_args, ctx) => createUsageCommandHandler({ getAccess: getKiloAccess })(ctx),
	});

	// After session starts, pre-fetch all models if already logged in so
	// modifyModels has data to work with. Also fetch and display credits.
	pi.on("session_start", async (_event, ctx) => {
		themeStatuses.install(ctx);
		preferences = loadKiloPreferences({
			cwd: ctx.cwd ?? process.cwd(),
			projectTrusted: ctx.isProjectTrusted?.() ?? false,
		});
		const access = getKiloAccess();
		ambientUi.reconcile(ctx, ctx.model?.provider);
		const sessionStartRevision = ambientUi.currentRevision();

		// Clear a stale credit status after logout.
		if (!access) {
			ambientUi.clearCredits(ctx);
			return;
		}

		ambientUi.refreshUsage(ctx, access);

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

		// Skip credits if the model changed while the catalog was loading.
		await ambientUi.refreshCredits(ctx, access, sessionStartRevision);
	});

	// Reconcile and refresh ambient Kilo UI when the selected model changes.
	pi.on("model_select", async (event, ctx) => {
		if (!ambientUi.reconcile(ctx, event.model.provider)) return;

		const access = getKiloAccess();
		if (access) await ambientUi.refresh(ctx, access);
	});

	// Refresh credits and opt-in usage after each turn.
	pi.on("turn_end", async (_event, ctx) => {
		if (!ambientUi.isVisible(ctx.model?.provider)) return;

		const access = getKiloAccess();
		if (access) await ambientUi.refresh(ctx, access);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		themeStatuses.dispose(ctx);
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
