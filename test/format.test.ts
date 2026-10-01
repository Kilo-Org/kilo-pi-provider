import { describe, expect, test } from "vitest";
import { formatCredits } from "../src/format.ts";

describe("formatCredits", () => {
	test.each([
		[0, "$0.00"],
		[12.34, "$12.34"],
		[999.99, "$999.99"],
		[1_000, "$1.0k"],
		[12_345, "$12.3k"],
	])("formats %s as %s", (balance, expected) => {
		expect(formatCredits(balance)).toBe(expected);
	});
});
