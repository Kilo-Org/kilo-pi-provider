import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

/** The Pi extension surface consumed by the custom footer. */
export type FooterContext = Pick<
	ExtensionContext,
	"model" | "ui" | "sessionManager" | "getContextUsage" | "modelRegistry"
>;
export type FooterExtensionAPI = Pick<ExtensionAPI, "getThinkingLevel">;

export function usesCustomFooter(): boolean {
	const value = process.env.KILO_CUSTOM_FOOTER?.trim().toLowerCase();
	return !["0", "false", "no"].includes(value ?? "");
}

export function installCustomFooter(pi: FooterExtensionAPI, ctx: FooterContext, creditsEnabled: boolean): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

		const formatTokens = (count: number): string => {
			if (count < 1000) return count.toString();
			if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
			if (count < 1000000) return `${Math.round(count / 1000)}k`;
			if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
			return `${Math.round(count / 1000000)}M`;
		};

		return {
			dispose() {
				unsubBranch();
			},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model;

				let totalInput = 0;
				let totalOutput = 0;
				let totalCacheRead = 0;
				let totalCacheWrite = 0;
				let totalCost = 0;
				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						totalInput += entry.message.usage.input;
						totalOutput += entry.message.usage.output;
						totalCacheRead += entry.message.usage.cacheRead;
						totalCacheWrite += entry.message.usage.cacheWrite;
						totalCost += entry.message.usage.cost.total;
					}
				}

				const contextUsage = ctx.getContextUsage();
				const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
				const contextPercentValue = contextUsage?.percent ?? 0;
				const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

				let pwd = process.cwd();
				const home = process.env.HOME || process.env.USERPROFILE;
				if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
				const branch = footerData.getGitBranch();
				if (branch) pwd = `${pwd} (${branch})`;
				const sessionName = ctx.sessionManager.getSessionName();
				if (sessionName) pwd = `${pwd} • ${sessionName}`;

				if (pwd.length > width) {
					const half = Math.floor(width / 2) - 2;
					if (half > 1) {
						pwd = `${pwd.slice(0, half)}...${pwd.slice(-(half - 1))}`;
					} else {
						pwd = pwd.slice(0, Math.max(1, width));
					}
				}

				const statsParts: string[] = [];
				if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
				if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
				if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
				if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

				const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
				if (totalCost || usingSubscription) {
					statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
				}

				const autoIndicator = " (auto)";
				const contextPercentDisplay =
					contextPercent === "?"
						? `?/${formatTokens(contextWindow)}${autoIndicator}`
						: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;

				let contextPercentStr: string;
				if (contextPercentValue > 90) {
					contextPercentStr = theme.fg("error", contextPercentDisplay);
				} else if (contextPercentValue > 70) {
					contextPercentStr = theme.fg("warning", contextPercentDisplay);
				} else {
					contextPercentStr = contextPercentDisplay;
				}
				statsParts.push(contextPercentStr);

				const extensionStatuses = footerData.getExtensionStatuses();
				const creditsStatus = extensionStatuses.get("kilo-credits");
				if (creditsEnabled && creditsStatus) statsParts.push(creditsStatus);
				for (const period of ["day", "week", "month", "year"]) {
					const usageStatus = extensionStatuses.get(`kilo-usage-${period}`);
					if (usageStatus) statsParts.push(usageStatus);
				}

				let statsLeft = statsParts.join(" ");
				let statsLeftWidth = visibleWidth(statsLeft);

				const modelName = model?.id || "no-model";
				let rightSideWithoutProvider = modelName;
				if (model?.reasoning) {
					const thinkingLevel = pi.getThinkingLevel();
					rightSideWithoutProvider =
						thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
				}

				let rightSide = rightSideWithoutProvider;
				if (footerData.getAvailableProviderCount() > 1 && model) {
					rightSide = `(${model.provider}) ${rightSideWithoutProvider}`;
					if (statsLeftWidth + 2 + visibleWidth(rightSide) > width) {
						rightSide = rightSideWithoutProvider;
					}
				}

				if (statsLeftWidth > width) {
					const plainStatsLeft = statsLeft.replace(/\x1b\[[0-9;]*m/g, "");
					statsLeft = `${plainStatsLeft.substring(0, width - 3)}...`;
					statsLeftWidth = visibleWidth(statsLeft);
				}

				const rightSideWidth = visibleWidth(rightSide);
				const totalNeeded = statsLeftWidth + 2 + rightSideWidth;

				let statsLine: string;
				if (totalNeeded <= width) {
					const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
					statsLine = statsLeft + padding + rightSide;
				} else {
					const availableForRight = width - statsLeftWidth - 2;
					if (availableForRight > 3) {
						const plainRight = rightSide.replace(/\x1b\[[0-9;]*m/g, "");
						const truncatedRight = plainRight.substring(0, availableForRight);
						const padding = " ".repeat(width - statsLeftWidth - truncatedRight.length);
						statsLine = statsLeft + padding + truncatedRight;
					} else {
						statsLine = statsLeft;
					}
				}

				const dimStatsLeft = theme.fg("dim", statsLeft);
				const remainder = statsLine.slice(statsLeft.length);
				const dimRemainder = theme.fg("dim", remainder);

				return [theme.fg("dim", pwd), dimStatsLeft + dimRemainder];
			},
		};
	});
}
