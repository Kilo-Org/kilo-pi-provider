import { expect, test, vi } from "vitest";
import { usesCustomFooter } from "../src/footer.ts";

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
	vi.stubEnv("KILO_CUSTOM_FOOTER", value);
	expect(usesCustomFooter()).toBe(expected);
	vi.unstubAllEnvs();
});
