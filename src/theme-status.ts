import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const THEME_SYNC_WIDGET_KEY = "kilo-theme-sync";
const THEME_SYNC_WIDGET_OPTIONS = { placement: "belowEditor" } as const;

type ThemeStatusContext = Pick<ExtensionContext, "hasUI" | "mode"> & {
	ui: Pick<ExtensionContext["ui"], "setStatus" | "setWidget"> & {
		theme: Pick<ExtensionContext["ui"]["theme"], "fg" | "getFgAnsi">;
	};
};

/**
 * Publishes themed status strings while retaining their raw text so colors can
 * be regenerated when Pi invalidates mounted components after a theme change.
 */
export function createThemeStatusPublisher() {
	const statusText = new Map<string, string>();

	const set = (ctx: ThemeStatusContext, key: string, text: string | undefined): void => {
		if (text === undefined) {
			statusText.delete(key);
			ctx.ui.setStatus(key, undefined);
			return;
		}

		statusText.set(key, text);
		ctx.ui.setStatus(key, ctx.ui.theme.fg("accent", text));
	};

	return {
		set,
		clear(ctx: ThemeStatusContext, keys: readonly string[]): void {
			statusText.clear();
			for (const key of keys) ctx.ui.setStatus(key, undefined);
		},
		install(ctx: ThemeStatusContext): void {
			if (!ctx.hasUI || ctx.mode !== "tui") return;

			ctx.ui.setWidget(
				THEME_SYNC_WIDGET_KEY,
				(_tui, theme) => {
					let accent = theme.getFgAnsi("accent");
					return {
						render: () => [],
						invalidate() {
							const nextAccent = theme.getFgAnsi("accent");
							if (nextAccent === accent) return;
							accent = nextAccent;
							for (const [key, text] of statusText) set(ctx, key, text);
						},
					};
				},
				THEME_SYNC_WIDGET_OPTIONS,
			);
		},
		dispose(ctx: ThemeStatusContext): void {
			statusText.clear();
			if (ctx.mode === "tui") ctx.ui.setWidget(THEME_SYNC_WIDGET_KEY, undefined, THEME_SYNC_WIDGET_OPTIONS);
		},
	};
}
