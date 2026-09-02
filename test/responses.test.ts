import { readFileSync } from "node:fs";
import { isRetryableAssistantError, type Model } from "@earendil-works/pi-ai";
import { afterEach, expect, test, vi } from "vitest";
import {
	normalizeResponseFailedEvent,
	normalizeResponsesFetch,
	normalizeSseEvent,
	streamKiloResponses,
} from "../src/responses.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

const model: Model<"openai-responses"> = {
	id: "gpt-test",
	name: "Responses Test Model",
	api: "openai-responses",
	provider: "kilo",
	baseUrl: "https://api.kilo.ai/api/openrouter",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 16_000,
};

test("classifies malformed Responses failures by their error type", async () => {
	const fixture = readFileSync(new URL("./fixtures/malformed-response-failed.sse", import.meta.url), "utf8");
	const responseFetch = vi.fn<typeof fetch>().mockResolvedValue(
		new Response(fixture, {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		}),
	);
	const stream = streamKiloResponses(
		model,
		{ messages: [{ role: "user", content: "Reply with OK", timestamp: 0 }] },
		{ apiKey: "test-key", fetch: responseFetch, maxRetries: 0 },
	);
	const events = [];
	for await (const event of stream) events.push(event);
	const result = await stream.result();

	expect(responseFetch).toHaveBeenCalledOnce();
	expect(events.at(-1)?.type).toBe("error");
	expect(result).toMatchObject({
		content: [{ type: "text", text: "OK" }],
		stopReason: "error",
		rawStopReason: "failed",
		errorMessage: "server_error: An error occurred",
	});
	expect(isRetryableAssistantError(result)).toBe(true);
});

test("normalizes multiline failure events across transport chunks", async () => {
	const chunks = [
		"event: response.failed\r",
		'\ndata: {"type":"response.failed",\r\n',
		'data: "sequence_number":0,\r\n',
		'data: "response":{"status":"failed","error":{"type":"server_error","message":"An error occurred"}}}\r\n',
		"\r\n: stream closed\r\n",
	];
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	const responseFetch = vi.fn<typeof fetch>().mockResolvedValue(
		new Response(body, {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		}),
	);

	const result = await streamKiloResponses(
		model,
		{ messages: [] },
		{ apiKey: "test-key", fetch: responseFetch },
	).result();

	expect(result).toMatchObject({
		stopReason: "error",
		rawStopReason: "failed",
		errorMessage: "server_error: An error occurred",
	});
});

test("does not overwrite a standard Responses error code", () => {
	const event = {
		type: "response.failed",
		response: {
			error: {
				type: "server_error",
				code: "rate_limit_exceeded",
				message: "Slow down",
			},
		},
	};

	expect(normalizeResponseFailedEvent(event)).toBe(event);
});

test("treats a null Responses error code as absent", () => {
	const event = {
		type: "response.failed",
		response: { error: { type: "server_error", code: null, message: "Try again" } },
	};

	expect(normalizeResponseFailedEvent(event)).toMatchObject({
		response: { error: { type: "server_error", code: "server_error", message: "Try again" } },
	});
});

test.each([
	["a primitive", null],
	["an array", []],
	["another event", { type: "response.completed" }],
	["a missing response", { type: "response.failed" }],
	["an invalid response", { type: "response.failed", response: null }],
	["a missing error", { type: "response.failed", response: {} }],
	["an invalid error", { type: "response.failed", response: { error: [] } }],
	["a missing error type", { type: "response.failed", response: { error: { message: "No type" } } }],
	["an empty error type", { type: "response.failed", response: { error: { type: "", message: "Empty type" } } }],
])("leaves %s unchanged", (_name, event) => {
	expect(normalizeResponseFailedEvent(event)).toBe(event);
});

test.each([
	["an unrelated event", 'event: response.completed\ndata: {"type":"response.completed"}'],
	["a failure event without data", "event: response.failed"],
	["a failure event with invalid JSON", "event: response.failed\ndata: response.failed{"],
	[
		"a standard failure event",
		'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"type":"server_error","code":"server_error","message":"Try again"}}}',
	],
])("preserves %s byte-for-byte", (_name, eventText) => {
	expect(normalizeSseEvent(eventText)).toBe(eventText);
});

test("normalizes an SSE data field without a space after its colon", () => {
	const eventText =
		'event: response.failed\ndata:{"type":"response.failed","response":{"status":"failed","error":{"type":"server_error","message":"Try again"}}}';

	expect(normalizeSseEvent(eventText)).toContain(
		'data: {"type":"response.failed","response":{"status":"failed","error":{"type":"server_error","message":"Try again","code":"server_error"}}}',
	);
});

test.each([
	["a bodyless response", new Response(null, { status: 204 })],
	["a response without a content type", new Response("plain text")],
	["a non-SSE response", new Response("{}", { headers: { "Content-Type": "application/json" } })],
])("does not wrap %s", async (_name, response) => {
	const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response);

	await expect(normalizeResponsesFetch(fetchImplementation)("https://example.test")).resolves.toBe(response);
});

test("uses the global fetch implementation when none is supplied", async () => {
	const failure =
		'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"type":"server_error","message":"Try again"}}}\n\n';
	const fetchImplementation = vi
		.fn<typeof fetch>()
		.mockResolvedValue(new Response(failure, { headers: { "Content-Type": "text/event-stream" } }));
	vi.stubGlobal("fetch", fetchImplementation);

	const result = await streamKiloResponses(model, { messages: [] }, { apiKey: "test-key" }).result();

	expect(fetchImplementation).toHaveBeenCalledOnce();
	expect(result).toMatchObject({ stopReason: "error", errorMessage: "server_error: Try again" });
});
