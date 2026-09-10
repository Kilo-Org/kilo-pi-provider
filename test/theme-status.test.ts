import { expect, test, vi } from "vitest";
import { createThemeStatusPublisher } from "../src/theme-status.ts";

function createFixture(mode: "tui" | "rpc" = "tui", hasUI = true) {
	let accent = "dark";
	const setStatus = vi.fn();
	const setWidget = vi.fn();
	const theme = {
		fg: vi.fn((tone: string, text: string) => `<${accent}:${tone}>${text}</${accent}>`),
		getFgAnsi: vi.fn(() => accent),
	};
	const context = { hasUI, mode, ui: { setStatus, setWidget, theme } };

	return {
		context,
		setStatus,
		setWidget,
		theme,
		setAccent(value: string) {
			accent = value;
		},
	};
}

test("recolors published statuses when Pi invalidates the theme sync component", () => {
	const fixture = createFixture();
	const publisher = createThemeStatusPublisher();
	publisher.install(fixture.context);
	publisher.set(fixture.context, "kilo-credits", "💰 $12.34");

	expect(fixture.setWidget).toHaveBeenCalledWith("kilo-theme-sync", expect.any(Function), {
		placement: "belowEditor",
	});
	expect(fixture.setStatus).toHaveBeenLastCalledWith("kilo-credits", "<dark:accent>💰 $12.34</dark>");

	const factory = fixture.setWidget.mock.calls[0]?.[1];
	const component = factory({}, fixture.theme);
	fixture.setAccent("light");
	component.invalidate();

	expect(component.render()).toEqual([]);
	expect(fixture.setStatus).toHaveBeenLastCalledWith("kilo-credits", "<light:accent>💰 $12.34</light>");
});

test("does not republish statuses for unrelated component invalidations", () => {
	const fixture = createFixture();
	const publisher = createThemeStatusPublisher();
	publisher.install(fixture.context);
	publisher.set(fixture.context, "kilo-credits", "credits");

	const factory = fixture.setWidget.mock.calls[0]?.[1];
	const component = factory({}, fixture.theme);
	component.invalidate();

	expect(fixture.setStatus).toHaveBeenCalledOnce();
});

test("clears raw status state and removes the sync component on disposal", () => {
	const fixture = createFixture();
	const publisher = createThemeStatusPublisher();
	publisher.install(fixture.context);
	publisher.set(fixture.context, "kilo-credits", "credits");

	const factory = fixture.setWidget.mock.calls[0]?.[1];
	const component = factory({}, fixture.theme);
	publisher.dispose(fixture.context);
	fixture.setAccent("light");
	component.invalidate();

	expect(fixture.setStatus).toHaveBeenCalledOnce();
	expect(fixture.setWidget).toHaveBeenLastCalledWith("kilo-theme-sync", undefined, {
		placement: "belowEditor",
	});
});

test("does not mount a TUI component in RPC mode", () => {
	const fixture = createFixture("rpc");
	const publisher = createThemeStatusPublisher();
	publisher.install(fixture.context);

	expect(fixture.setWidget).not.toHaveBeenCalled();
});

test("does not mount a TUI component without a UI", () => {
	const fixture = createFixture("tui", false);
	const publisher = createThemeStatusPublisher();
	publisher.install(fixture.context);

	expect(fixture.setWidget).not.toHaveBeenCalled();
});

test("clears published statuses and forgets their raw text", () => {
	const fixture = createFixture();
	const publisher = createThemeStatusPublisher();
	publisher.install(fixture.context);
	publisher.set(fixture.context, "kilo-credits", "credits");
	publisher.clear(fixture.context, ["kilo-credits", "kilo-usage-day"]);

	const factory = fixture.setWidget.mock.calls[0]?.[1];
	const component = factory({}, fixture.theme);
	fixture.setAccent("light");
	component.invalidate();

	expect(fixture.setStatus).toHaveBeenNthCalledWith(2, "kilo-credits", undefined);
	expect(fixture.setStatus).toHaveBeenNthCalledWith(3, "kilo-usage-day", undefined);
	expect(fixture.setStatus).toHaveBeenCalledTimes(3);
});

test("clearing one status removes it from later theme refreshes", () => {
	const fixture = createFixture();
	const publisher = createThemeStatusPublisher();
	publisher.install(fixture.context);
	publisher.set(fixture.context, "kilo-credits", "credits");
	publisher.set(fixture.context, "kilo-credits", undefined);

	const factory = fixture.setWidget.mock.calls[0]?.[1];
	const component = factory({}, fixture.theme);
	fixture.setAccent("light");
	component.invalidate();

	expect(fixture.setStatus).toHaveBeenCalledTimes(2);
	expect(fixture.setStatus).toHaveBeenLastCalledWith("kilo-credits", undefined);
});
