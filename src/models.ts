import type { Api } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { KILO_API_BASE } from "./api.ts";

const KILO_OPENROUTER_BASE = `${KILO_API_BASE}/api/openrouter`;

export interface OpenRouterModel {
	id: string;
	name: string;
	context_length: number;
	max_completion_tokens?: number | null;
	pricing?: {
		prompt?: string | null;
		completion?: string | null;
		input_cache_write?: string | null;
		input_cache_read?: string | null;
	};
	architecture?: {
		input_modalities?: string[] | null;
		output_modalities?: string[] | null;
	};
	top_provider?: { max_completion_tokens?: number | null };
	supported_parameters?: string[];
	opencode?: {
		family?: string;
		prompt?: string;
		variants?: Record<
			string,
			{
				reasoning?: {
					enabled?: boolean;
					effort?: string;
				};
				verbosity?: string;
			}
		>;
		ai_sdk_provider?: string;
	};
}

export function parsePrice(price: string | null | undefined): number {
	if (!price) return 0;
	const parsed = parseFloat(price);
	if (Number.isNaN(parsed)) return 0;
	// OpenRouter prices are per-token; Pi expects per-million-token
	return parsed * 1_000_000;
}

export function isFreeModel(m: OpenRouterModel): boolean {
	const prompt = parseFloat(m.pricing?.prompt ?? "1");
	const completion = parseFloat(m.pricing?.completion ?? "1");
	if (prompt !== 0 || completion !== 0) return false;
	// Zero pricing alone isn't reliable (some models report "0" but require auth).
	// Use the :free suffix (OpenRouter convention), Kilo-native models (no vendor
	// prefix), or known Kilo/OpenRouter free routers.
	if (m.id === "kilo-auto/free") return true;
	if (m.id.includes(":free")) return true;
	if (!m.id.includes("/")) return true;
	if (m.id.startsWith("kilo/") || m.id.startsWith("openrouter/")) return true;
	return false;
}

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

type KiloModelCompat = {
	thinkingFormat?: "openrouter";
	cacheControlFormat?: "anthropic";
	requiresReasoningContentOnAssistantMessages?: boolean;
	supportsStore?: boolean;
	sendSessionIdHeader?: boolean;
	supportsLongCacheRetention?: boolean;
};

function shouldUseResponsesApi(m: OpenRouterModel): boolean {
	const aiSdkProvider = m.opencode?.ai_sdk_provider;
	if (aiSdkProvider === "openai") return true;

	// Some model metadata may arrive before ai_sdk_provider is populated. KiloCode
	// routes current OpenAI reasoning/frontier models through the Responses API;
	// using chat completions for these yields: "please use any of: responses".
	const id = m.id.toLowerCase();
	const shortId = id.includes("/") ? (id.split("/").pop() ?? id) : id;
	return (
		shortId === "gpt-5" ||
		shortId.startsWith("gpt-5.") ||
		shortId.startsWith("gpt-5-") ||
		shortId.startsWith("o1") ||
		shortId.startsWith("o3") ||
		shortId.startsWith("o4")
	);
}

function getKiloModelCompat(m: OpenRouterModel, api: Api | undefined): ProviderModelConfig["compat"] {
	if (api === "openai-responses") {
		return {
			// Kilo/OpenRouter-compatible responses endpoints do not need OpenAI's
			// session_id header, and long prompt-cache retention is provider-specific.
			sendSessionIdHeader: false,
			supportsLongCacheRetention: false,
		} as ProviderModelConfig["compat"];
	}

	const compat: KiloModelCompat = {
		// Kilo's gateway is OpenRouter-compatible, but it uses api.kilo.ai so
		// pi-ai's URL/provider auto-detection cannot infer OpenRouter model quirks.
		thinkingFormat: "openrouter",
		supportsStore: false,
	};

	if (m.id.startsWith("anthropic/")) {
		compat.cacheControlFormat = "anthropic";
	}

	if (m.id === "deepseek/deepseek-v4-flash" || m.id === "deepseek/deepseek-v4-pro") {
		compat.requiresReasoningContentOnAssistantMessages = true;
	}

	return compat as ProviderModelConfig["compat"];
}

function mapVariantEffort(
	variants: NonNullable<OpenRouterModel["opencode"]>["variants"],
	key: string,
): string | undefined {
	const variant = variants?.[key];
	if (!variant) return undefined;
	const reasoning = variant.reasoning;
	if (!reasoning) return key;
	if (reasoning.enabled === false || reasoning.effort === "none") return "none";
	return reasoning.effort ?? key;
}

function thinkingLevelMapFromVariants(
	variants: NonNullable<OpenRouterModel["opencode"]>["variants"],
): ProviderModelConfig["thinkingLevelMap"] | undefined {
	if (!variants || Object.keys(variants).length === 0) return undefined;

	const map: Partial<Record<PiThinkingLevel, string | null>> = {};
	const off = mapVariantEffort(variants, "none") ?? mapVariantEffort(variants, "instant");
	if (off !== undefined) map.off = off;

	for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
		const effort = mapVariantEffort(variants, level);
		map[level] = effort === undefined ? null : effort;
	}

	return map as ProviderModelConfig["thinkingLevelMap"];
}

function getKiloThinkingLevelMap(m: OpenRouterModel): ProviderModelConfig["thinkingLevelMap"] | undefined {
	const fromVariants = thinkingLevelMapFromVariants(m.opencode?.variants);
	if (/^deepseek\/deepseek-v4-(flash|pro)(?:-|$)/.test(m.id)) {
		return { ...fromVariants, max: "max" };
	}
	if (fromVariants) return fromVariants;

	// Safety net for the current frontier OpenAI model while Kilo/OpenRouter
	// model metadata is catching up.
	if (m.id.includes("gpt-5.5")) {
		return {
			off: "none",
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
		};
	}

	return undefined;
}

export function mapOpenRouterModel(m: OpenRouterModel): ProviderModelConfig {
	const inputModalities = m.architecture?.input_modalities ?? ["text"];
	const supportsImages = inputModalities.includes("image");
	const supportsReasoning = m.supported_parameters?.includes("reasoning") ?? false;
	const maxTokens =
		m.top_provider?.max_completion_tokens ?? m.max_completion_tokens ?? Math.ceil(m.context_length * 0.2);
	const api = shouldUseResponsesApi(m) ? ("openai-responses" as const) : ("openai-completions" as const);

	return {
		id: m.id,
		name: m.name,
		api,
		...(api === "openai-responses" ? { baseUrl: KILO_OPENROUTER_BASE } : {}),
		reasoning: supportsReasoning,
		input: supportsImages ? ["text", "image"] : ["text"],
		cost: {
			input: parsePrice(m.pricing?.prompt),
			output: parsePrice(m.pricing?.completion),
			cacheRead: parsePrice(m.pricing?.input_cache_read),
			cacheWrite: parsePrice(m.pricing?.input_cache_write),
		},
		contextWindow: m.context_length,
		maxTokens: maxTokens,
		thinkingLevelMap: getKiloThinkingLevelMap(m),
		compat: getKiloModelCompat(m, api),
	};
}
