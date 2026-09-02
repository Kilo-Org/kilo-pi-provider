import { describe, expect, test } from "vitest";
import { mapOpenRouterModel, type OpenRouterModel } from "../src/models.ts";

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
