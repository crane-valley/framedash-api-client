/**
 * Each function returns the suffix passed to ApiClient.projectPath() (or a bare absolute path
 * for non-project endpoints). Param ordering and only-set-when-truthy semantics are preserved
 * so callers get byte-identical URLs for identical inputs.
 */

export interface DaysOpts {
	days?: number | string;
}

export function buildDashboardPath(opts: DaysOpts = {}): string {
	const params = new URLSearchParams();
	if (opts.days) params.set("days", String(opts.days));
	const qs = params.toString();
	return qs ? `dashboard?${qs}` : "dashboard";
}

export function buildRetentionPath(opts: DaysOpts = {}): string {
	const params = new URLSearchParams();
	if (opts.days) params.set("days", String(opts.days));
	const qs = params.toString();
	return qs ? `retention?${qs}` : "retention";
}

export interface FunnelOpts {
	steps: string;
	days?: number | string;
	window?: number | string;
}

export function buildFunnelPath(opts: FunnelOpts): string {
	const params = new URLSearchParams();
	params.set("steps", opts.steps);
	if (opts.days) params.set("days", String(opts.days));
	if (opts.window) params.set("window", String(opts.window));
	return `funnels?${params}`;
}

export interface InsightsOpts {
	metric: string;
	groupBy: string;
	days?: number | string;
	limit?: number | string;
	eventName?: string;
}

export function buildInsightsPath(opts: InsightsOpts): string {
	const params = new URLSearchParams({ metric: opts.metric, groupBy: opts.groupBy });
	if (opts.days) params.set("days", String(opts.days));
	if (opts.limit) params.set("limit", String(opts.limit));
	if (opts.eventName) params.set("eventName", opts.eventName);
	return `insights?${params}`;
}

export interface HeatmapOpts {
	mapId: string;
	cellSize?: number | string;
	days?: number | string;
	eventName?: string;
}

export function buildHeatmapPath(opts: HeatmapOpts): string {
	const params = new URLSearchParams({ mapId: opts.mapId });
	if (opts.cellSize) params.set("cellSize", String(opts.cellSize));
	if (opts.days) params.set("days", String(opts.days));
	if (opts.eventName) params.set("eventName", opts.eventName);
	return `heatmap?${params}`;
}

// Builds / regression

export interface BuildsListOpts extends DaysOpts {
	/**
	 * Restrict the list to a single build_id. Only appended when set. CI ingest
	 * waits scope the poll to the candidate so it is always returned, regardless
	 * of the server's newest-50 cap (a re-run of an older build_id could
	 * otherwise fall outside the capped list and never be seen).
	 */
	buildId?: string;
	/**
	 * Bypass the server's aggregation cache for a live read. Only appended when
	 * true. Used by CI ingest waits (`framedash run-profile-test`) that must see
	 * real-time build state rather than the ~60s dashboard cache.
	 */
	fresh?: boolean;
}

export function buildBuildsPath(opts: BuildsListOpts = {}): string {
	const params = new URLSearchParams();
	if (opts.days) params.set("days", String(opts.days));
	if (opts.buildId) params.set("buildId", opts.buildId);
	if (opts.fresh) params.set("fresh", "1");
	const qs = params.toString();
	return qs ? `builds?${qs}` : "builds";
}

export interface BuildCompareOpts {
	baseline: string;
	candidate: string;
	days?: number | string;
	mapId?: string;
	platform?: string;
	/**
	 * Bypass the server's comparison cache for a live read. Only appended when
	 * true. Used by the CI gate (`framedash run-profile-test`) so a re-run for
	 * the same build IDs is not served a cached, pre-ingest comparison.
	 */
	fresh?: boolean;
}

export function buildBuildComparePath(opts: BuildCompareOpts): string {
	const params = new URLSearchParams({ baseline: opts.baseline, candidate: opts.candidate });
	if (opts.days) params.set("days", String(opts.days));
	if (opts.mapId) params.set("mapId", opts.mapId);
	if (opts.platform) params.set("platform", opts.platform);
	if (opts.fresh) params.set("fresh", "1");
	return `builds/compare?${params}`;
}

export interface ContentListOpts {
	type?: string;
}

export function buildContentPath(opts: ContentListOpts = {}): string {
	if (opts.type) {
		return `/api/v1/content?${new URLSearchParams({ type: opts.type })}`;
	}
	return "/api/v1/content";
}
