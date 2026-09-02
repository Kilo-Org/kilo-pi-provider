import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/compat";

const openAIResponses = openAIResponsesApi();

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Kilo may receive a non-standard Responses error from an upstream gateway
 * with `error.type` but no required `error.code`. Preserve the failure while
 * supplying the field expected by the OpenAI Responses parser.
 */
export function normalizeResponseFailedEvent(event: unknown): unknown {
	if (!isJsonObject(event) || event.type !== "response.failed") return event;

	const response = event.response;
	if (!isJsonObject(response)) return event;

	const error = response.error;
	if (!isJsonObject(error) || (error.code !== undefined && error.code !== null)) return event;
	if (typeof error.type !== "string" || error.type.length === 0) return event;

	return {
		...event,
		response: {
			...response,
			error: {
				...error,
				code: error.type,
			},
		},
	};
}

function sseData(line: string): string | undefined {
	if (!line.startsWith("data:")) return undefined;
	const value = line.slice("data:".length);
	return value.startsWith(" ") ? value.slice(1) : value;
}

export function normalizeSseEvent(eventText: string): string {
	if (!eventText.includes("response.failed")) return eventText;

	const lines = eventText.split(/\r\n|\r|\n/u);
	const payload = lines.flatMap((line) => {
		const data = sseData(line);
		return data === undefined ? [] : [data];
	});
	if (payload.length === 0) return eventText;

	try {
		const event = JSON.parse(payload.join("\n")) as unknown;
		const normalized = normalizeResponseFailedEvent(event);
		if (normalized === event) return eventText;

		let wroteData = false;
		return lines
			.flatMap((line) => {
				if (sseData(line) === undefined) return [line];
				if (wroteData) return [];
				wroteData = true;
				return [`data: ${JSON.stringify(normalized)}`];
			})
			.join("\n");
	} catch {
		return eventText;
	}
}

function normalizeSseBody(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	// Keep CRLF atomic so regex backtracking cannot mistake one line ending for a blank line.
	const eventSeparator = /(?:\r\n|\r(?!\n)|(?<!\r)\n)(?:\r\n|\r(?!\n)|(?<!\r)\n)/u;
	let buffered = "";

	function emitEvents(controller: TransformStreamDefaultController<Uint8Array>): void {
		for (;;) {
			const separator = eventSeparator.exec(buffered);
			if (!separator) return;

			const eventText = buffered.slice(0, separator.index);
			controller.enqueue(encoder.encode(`${normalizeSseEvent(eventText)}${separator[0]}`));
			buffered = buffered.slice(separator.index + separator[0].length);
		}
	}

	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				buffered += decoder.decode(chunk, { stream: true });
				emitEvents(controller);
			},
			flush(controller) {
				buffered += decoder.decode();
				emitEvents(controller);
				if (buffered.length > 0) controller.enqueue(encoder.encode(buffered));
			},
		}),
	);
}

export function normalizeResponsesFetch(fetchImplementation: typeof fetch): typeof fetch {
	return async (input, init) => {
		const response = await fetchImplementation(input, init);
		if (!response.body || !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
			return response;
		}

		return new Response(normalizeSseBody(response.body), {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};
}

export function streamKiloResponses(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	return openAIResponses.streamSimple(model, context, {
		...options,
		fetch: normalizeResponsesFetch(options?.fetch ?? globalThis.fetch),
	});
}
