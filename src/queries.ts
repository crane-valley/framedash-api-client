/**
 * Pure path-builder functions for Framedash project-scoped REST endpoints.
 *
 * Each function returns the suffix passed to ApiClient.projectPath() (or a
 * bare absolute path for non-project endpoints). Param ordering and
 * only-set-when-truthy semantics are preserved so callers get byte-identical
 * URLs for identical inputs.
 */

// ---------------------------------------------------------------------------
// Shared analytics opts
// ---------------------------------------------------------------------------

export interface DaysOpts {
	/** Time period in days. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	days?: number | string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Build the project-scoped suffix for the dashboard endpoint.
 * Example: buildDashboardPath({ days: 7 }) -> "dashboard?days=7"
 */
export function buildDashboardPath(opts: DaysOpts = {}): string {
	const params = new URLSearchParams();
	if (opts.days) params.set("days", String(opts.days));
	const qs = params.toString();
	return qs ? `dashboard?${qs}` : "dashboard";
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Build the project-scoped suffix for the retention endpoint.
 * Example: buildRetentionPath({ days: 30 }) -> "retention?days=30"
 */
export function buildRetentionPath(opts: DaysOpts = {}): string {
	const params = new URLSearchParams();
	if (opts.days) params.set("days", String(opts.days));
	const qs = params.toString();
	return qs ? `retention?${qs}` : "retention";
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export interface FunnelOpts {
	/** Comma-separated event names (required by the API). */
	steps: string;
	/** Time period in days. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	days?: number | string;
	/** Conversion window in seconds. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	window?: number | string;
}

/**
 * Build the project-scoped suffix for the funnels endpoint.
 * steps is set first, then days, then window -- preserving the param order
 * established by the original CLI and MCP implementations.
 * Example: buildFunnelPath({ steps: "login,purchase", days: 7 }) -> "funnels?steps=login%2Cpurchase&days=7"
 */
export function buildFunnelPath(opts: FunnelOpts): string {
	const params = new URLSearchParams();
	params.set("steps", opts.steps);
	if (opts.days) params.set("days", String(opts.days));
	if (opts.window) params.set("window", String(opts.window));
	return `funnels?${params}`;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface InsightsOpts {
	/** Metric to aggregate (e.g. "count" or "unique_players"). */
	metric: string;
	/** Dimension to group by (e.g. "event_name", "platform"). */
	groupBy: string;
	/** Time period in days. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	days?: number | string;
	/** Max groups to return. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	limit?: number | string;
	/** Filter by event name. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	eventName?: string;
}

/**
 * Build the project-scoped suffix for the insights endpoint.
 * Param order: metric, groupBy, days, limit, eventName.
 */
export function buildInsightsPath(opts: InsightsOpts): string {
	const params = new URLSearchParams({ metric: opts.metric, groupBy: opts.groupBy });
	if (opts.days) params.set("days", String(opts.days));
	if (opts.limit) params.set("limit", String(opts.limit));
	if (opts.eventName) params.set("eventName", opts.eventName);
	return `insights?${params}`;
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

export interface HeatmapOpts {
	/** Map ID to query. */
	mapId: string;
	/** Cell size. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	cellSize?: number | string;
	/** Time period in days. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	days?: number | string;
	/** Filter by event name. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	eventName?: string;
}

/**
 * Build the project-scoped suffix for the heatmap endpoint.
 * Param order: mapId, cellSize, days, eventName.
 */
export function buildHeatmapPath(opts: HeatmapOpts): string {
	const params = new URLSearchParams({ mapId: opts.mapId });
	if (opts.cellSize) params.set("cellSize", String(opts.cellSize));
	if (opts.days) params.set("days", String(opts.days));
	if (opts.eventName) params.set("eventName", opts.eventName);
	return `heatmap?${params}`;
}

// ---------------------------------------------------------------------------
// Builds / regression
// ---------------------------------------------------------------------------

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

/**
 * Build the project-scoped suffix for the builds list endpoint.
 * Param order: days, buildId, fresh.
 * Example: buildBuildsPath({ days: 30 }) -> "builds?days=30"
 */
export function buildBuildsPath(opts: BuildsListOpts = {}): string {
	const params = new URLSearchParams();
	if (opts.days) params.set("days", String(opts.days));
	if (opts.buildId) params.set("buildId", opts.buildId);
	if (opts.fresh) params.set("fresh", "1");
	const qs = params.toString();
	return qs ? `builds?${qs}` : "builds";
}

export interface BuildCompareOpts {
	/** build_id to compare against (the known-good build). */
	baseline: string;
	/** build_id under test (the new build). */
	candidate: string;
	/** Time period in days. Appended only when truthy (an empty string, numeric 0, or undefined is omitted), matching the sibling path builders. */
	days?: number | string;
	/** Restrict the comparison to one map. Only appended when set (truthy). */
	mapId?: string;
	/** Restrict the comparison to one platform. Only appended when set (truthy). */
	platform?: string;
	/**
	 * Bypass the server's comparison cache for a live read. Only appended when
	 * true. Used by the CI gate (`framedash run-profile-test`) so a re-run for
	 * the same build IDs is not served a cached, pre-ingest comparison.
	 */
	fresh?: boolean;
}

/**
 * Build the project-scoped suffix for the build-comparison endpoint.
 * Param order: baseline, candidate, days, mapId, platform, fresh.
 * Example: buildBuildComparePath({ baseline: "a", candidate: "b", days: 30 })
 *   -> "builds/compare?baseline=a&candidate=b&days=30"
 */
export function buildBuildComparePath(opts: BuildCompareOpts): string {
	const params = new URLSearchParams({ baseline: opts.baseline, candidate: opts.candidate });
	if (opts.days) params.set("days", String(opts.days));
	if (opts.mapId) params.set("mapId", opts.mapId);
	if (opts.platform) params.set("platform", opts.platform);
	if (opts.fresh) params.set("fresh", "1");
	return `builds/compare?${params}`;
}

// ---------------------------------------------------------------------------
// Content (non-project-scoped: /api/v1/content)
// ---------------------------------------------------------------------------

export interface ContentListOpts {
	/** Filter by content type. Only appended when set (truthy); 0/empty values are treated as unset, matching the original CLI/MCP behavior. */
	type?: string;
}

/**
 * Build the absolute path for the content list endpoint.
 * Example: buildContentPath({ type: "event" }) -> "/api/v1/content?type=event"
 */
export function buildContentPath(opts: ContentListOpts = {}): string {
	if (opts.type) {
		return `/api/v1/content?${new URLSearchParams({ type: opts.type })}`;
	}
	return "/api/v1/content";
}
