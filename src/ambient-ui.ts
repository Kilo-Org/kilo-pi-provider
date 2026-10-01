import type { KiloAccess } from "./api.ts";
import type { ResolvedKiloPreferences } from "./config.ts";
import { formatCredits } from "./format.ts";
import type { UsageStatusPresentation } from "./usage.ts";

export const KILO_STATUS_KEYS = [
	"kilo-credits",
	"kilo-usage-day",
	"kilo-usage-week",
	"kilo-usage-month",
	"kilo-usage-year",
] as const;

export type FooterChange = "install" | "remove" | "keep";

export interface AmbientKiloUiContext {
	hasUI: boolean;
	model?: { provider: string } | undefined;
	ui: { setFooter(factory: undefined): void };
}

export interface AmbientKiloUiOptions<Context extends AmbientKiloUiContext> {
	getPreferences(): ResolvedKiloPreferences;
	themeStatuses: {
		set(ctx: Context, key: string, text: string | undefined): void;
		clear(ctx: Context, keys: readonly string[]): void;
	};
	usageRefresher: {
		invalidate(): void;
		refresh(
			access: KiloAccess,
			periods: ResolvedKiloPreferences["usage"]["periods"],
			presentation: UsageStatusPresentation,
		): void;
	};
	installFooter(ctx: Context): void;
	fetchBalance(access: KiloAccess): Promise<number | null>;
}

export function isAmbientKiloUiVisible(
	provider: string | undefined,
	preferences: Pick<ResolvedKiloPreferences, "display">,
): boolean {
	return provider === "kilo" || preferences.display.showForOtherProviders;
}

export function planFooterChange(state: { visible: boolean; customFooter: boolean; installed: boolean }): FooterChange {
	const wanted = state.visible && state.customFooter;
	if (wanted === state.installed) return "keep";
	return wanted ? "install" : "remove";
}

/**
 * Owns the ambient Kilo UI (custom footer, credit and usage statuses) so Pi
 * lifecycle handlers only decide when to reconcile or refresh it.
 *
 * Every reconciliation advances a revision; refreshes started under an older
 * revision, or for a model that no longer shows Kilo UI, never publish.
 */
export function createAmbientKiloUi<Context extends AmbientKiloUiContext>(options: AmbientKiloUiOptions<Context>) {
	let footerInstalled = false;
	let revision = 0;

	const isVisible = (provider: string | undefined): boolean =>
		isAmbientKiloUiVisible(provider, options.getPreferences());

	const isCurrent = (ctx: Context, since: number): boolean => since === revision && isVisible(ctx.model?.provider);

	const refreshUsage = (ctx: Context, access: KiloAccess): void => {
		if (!ctx.hasUI || !isVisible(ctx.model?.provider)) return;
		const periods = options.getPreferences().usage.periods;
		if (periods.length === 0) return;
		options.usageRefresher.refresh(access, periods, {
			setStatus: (key, value) => options.themeStatuses.set(ctx, key, value),
		});
	};

	const refreshCredits = async (ctx: Context, access: KiloAccess, since = revision): Promise<void> => {
		if (!ctx.hasUI || !options.getPreferences().credits.enabled || !isCurrent(ctx, since)) return;
		try {
			const balance = await options.fetchBalance(access);
			if (balance === null || !isCurrent(ctx, since)) return;
			options.themeStatuses.set(ctx, "kilo-credits", `💰 ${formatCredits(balance)}`);
		} catch (error) {
			// Credits are a background status; never let them reject a Pi lifecycle handler.
			console.warn("[kilo] Failed to fetch balance:", error instanceof Error ? error.message : error);
		}
	};

	return {
		isVisible,
		currentRevision: (): number => revision,
		reconcile(ctx: Context, provider: string | undefined): boolean {
			revision += 1;
			const preferences = options.getPreferences();
			const visible = isAmbientKiloUiVisible(provider, preferences);
			if (!ctx.hasUI) return visible;

			const change = planFooterChange({
				visible,
				customFooter: preferences.footer.custom,
				installed: footerInstalled,
			});
			if (change === "install") {
				options.installFooter(ctx);
				footerInstalled = true;
			} else if (change === "remove") {
				ctx.ui.setFooter(undefined);
				footerInstalled = false;
			}

			if (!visible) {
				options.usageRefresher.invalidate();
				options.themeStatuses.clear(ctx, KILO_STATUS_KEYS);
			}
			return visible;
		},
		refreshUsage,
		refreshCredits,
		async refresh(ctx: Context, access: KiloAccess): Promise<void> {
			refreshUsage(ctx, access);
			await refreshCredits(ctx, access);
		},
		clearCredits(ctx: Context): void {
			if (ctx.hasUI) options.themeStatuses.set(ctx, "kilo-credits", undefined);
		},
	};
}
