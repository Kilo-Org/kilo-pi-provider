export function usesCustomFooter(): boolean {
	const value = process.env.KILO_CUSTOM_FOOTER?.trim().toLowerCase();
	return !["0", "false", "no"].includes(value ?? "");
}
