import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import {
	mapOpenRouterModel,
	mergeKiloCatalogModels,
	type OpenRouterModel,
	selectKiloCatalogModels,
} from "../src/models.ts";

const modelWithGatewayVariants: OpenRouterModel = {
	id: "acme/reasoning-model",
	name: "Acme Reasoning Model",
	context_length: 128_000,
	supported_parameters: ["reasoning"],
	opencode: {
		variants: {
			none: { reasoning: { enabled: false } },
			high: { reasoning: { effort: "high" } },
			xhigh: { reasoning: { effort: "xhigh" } },
		},
	},
};

const freeCatalogModel: OpenRouterModel = {
	id: "acme/free-model:free",
	name: "Acme Free Model",
	context_length: 32_000,
	pricing: { prompt: "0", completion: "0" },
};

const paidCatalogModel: OpenRouterModel = {
	id: "acme/paid-model",
	name: "Acme Paid Model",
	context_length: 64_000,
	pricing: { prompt: "0.000001", completion: "0.000002" },
};

const imageCatalogModel: OpenRouterModel = {
	...freeCatalogModel,
	id: "acme/image-model:free",
	architecture: { output_modalities: ["text", "image"] },
};

describe("selectKiloCatalogModels", () => {
	test("maps selected models with the OpenRouter model mapper", () => {
		expect(selectKiloCatalogModels([paidCatalogModel], {})).toEqual([mapOpenRouterModel(paidCatalogModel)]);
	});

	test("excludes models that generate images", () => {
		const selected = selectKiloCatalogModels([imageCatalogModel, freeCatalogModel], {});

		expect(selected.map((model) => model.id)).toEqual([freeCatalogModel.id]);
	});

	test("excludes paid models when only free models are requested", () => {
		const selected = selectKiloCatalogModels([freeCatalogModel, paidCatalogModel], { freeOnly: true });

		expect(selected.map((model) => model.id)).toEqual([freeCatalogModel.id]);
	});

	test("keeps paid models by default", () => {
		const selected = selectKiloCatalogModels([freeCatalogModel, paidCatalogModel], {});

		expect(selected.map((model) => model.id)).toEqual([freeCatalogModel.id, paidCatalogModel.id]);
	});
});

const kiloTemplate: Model<Api> = {
	id: "kilo/template",
	name: "Kilo Template",
	api: "openai-responses",
	provider: "kilo",
	baseUrl: "https://api.kilo.ai/api/gateway",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000,
	maxTokens: 100,
	headers: { "X-KILOCODE-EDITORNAME": "Pi" },
	samplingParams: { temperature: 0.2 },
};

const otherProviderModel: Model<Api> = { ...kiloTemplate, id: "other/model", provider: "other" };

describe("mergeKiloCatalogModels", () => {
	const catalog = [mapOpenRouterModel(paidCatalogModel)];

	test("returns the registered models when the catalog is empty", () => {
		const models = [kiloTemplate, otherProviderModel];

		expect(mergeKiloCatalogModels(models, [])).toBe(models);
	});

	test("returns the registered models when no Kilo template exists", () => {
		const models = [otherProviderModel];

		expect(mergeKiloCatalogModels(models, catalog)).toBe(models);
	});

	test("replaces Kilo models after preserving other providers", () => {
		const merged = mergeKiloCatalogModels([kiloTemplate, otherProviderModel, kiloTemplate], catalog);

		expect(merged.map((model) => `${model.provider}:${model.id}`)).toEqual([
			"other:other/model",
			`kilo:${paidCatalogModel.id}`,
		]);
	});

	test("applies catalog capabilities to the Kilo template", () => {
		const [catalogModel] = catalog;

		expect(mergeKiloCatalogModels([kiloTemplate], catalog)).toEqual([
			{
				...kiloTemplate,
				id: catalogModel?.id,
				name: catalogModel?.name,
				api: catalogModel?.api,
				reasoning: catalogModel?.reasoning,
				input: catalogModel?.input,
				cost: catalogModel?.cost,
				contextWindow: catalogModel?.contextWindow,
				maxTokens: catalogModel?.maxTokens,
				thinkingLevelMap: catalogModel?.thinkingLevelMap,
				headers: undefined,
				compat: catalogModel?.compat,
			},
		]);
	});

	test("uses catalog API routing when present", () => {
		const responsesModel = mapOpenRouterModel({ ...paidCatalogModel, opencode: { ai_sdk_provider: "openai" } });

		expect(mergeKiloCatalogModels([kiloTemplate], [responsesModel])[0]).toMatchObject({
			api: "openai-responses",
			baseUrl: "https://api.kilo.ai/api/openrouter",
		});
	});

	test("falls back to template API routing when the catalog omits it", () => {
		const catalogModel = { ...mapOpenRouterModel(paidCatalogModel), api: undefined, baseUrl: undefined };

		expect(mergeKiloCatalogModels([kiloTemplate], [catalogModel])[0]).toMatchObject({
			api: kiloTemplate.api,
			baseUrl: kiloTemplate.baseUrl,
		});
	});

	test("adds the organization header when an organization is selected", () => {
		expect(mergeKiloCatalogModels([kiloTemplate], catalog, "organization-id")[0]?.headers).toEqual({
			"X-KiloCode-OrganizationId": "organization-id",
		});
	});
});

describe("mapOpenRouterModel", () => {
	test("routes OpenAI models to Responses and other models to chat completions", () => {
		const completionsModel = mapOpenRouterModel(modelWithGatewayVariants);
		const responsesModel = mapOpenRouterModel({
			...modelWithGatewayVariants,
			opencode: { ...modelWithGatewayVariants.opencode, ai_sdk_provider: "openai" },
		});

		expect(completionsModel.api).toBe("openai-completions");
		expect(completionsModel.baseUrl).toBeUndefined();
		expect(responsesModel.api).toBe("openai-responses");
		expect(responsesModel.baseUrl).toBe("https://api.kilo.ai/api/openrouter");
	});

	test("uses gateway-compatible Responses session affinity and cache settings", () => {
		const model = mapOpenRouterModel({
			...modelWithGatewayVariants,
			opencode: { ...modelWithGatewayVariants.opencode, ai_sdk_provider: "openai" },
		});

		expect(model.compat).toEqual({
			sessionAffinityFormat: "openai-nosession",
			supportsLongCacheRetention: false,
		});
	});

	test("maps gateway thinking variants", () => {
		expect(mapOpenRouterModel(modelWithGatewayVariants).thinkingLevelMap).toEqual({
			off: "none",
			minimal: null,
			low: null,
			medium: null,
			high: "high",
			xhigh: "xhigh",
			max: null,
		});
	});

	test.each([
		"deepseek/deepseek-v4-flash",
		"deepseek/deepseek-v4-flash-0731",
		"deepseek/deepseek-v4-pro",
		"deepseek/deepseek-v4-pro-0813",
	])("exposes max thinking for %s when the gateway omits it", (id) => {
		expect(mapOpenRouterModel({ ...modelWithGatewayVariants, id }).thinkingLevelMap).toEqual({
			off: "none",
			minimal: null,
			low: null,
			medium: null,
			high: "high",
			xhigh: "xhigh",
			max: "max",
		});
	});
});
