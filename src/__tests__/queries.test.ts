import { describe, expect, it } from "vitest";
import {
	buildBuildComparePath,
	buildBuildsPath,
	buildContentPath,
	buildDashboardPath,
	buildFunnelPath,
	buildHeatmapPath,
	buildInsightsPath,
	buildRetentionPath,
} from "../queries.js";

// ---------------------------------------------------------------------------
// buildDashboardPath
// ---------------------------------------------------------------------------

describe("buildDashboardPath", () => {
	it("returns bare path when called with no opts", () => {
		expect(buildDashboardPath()).toBe("dashboard");
	});

	it("returns bare path when days is undefined", () => {
		expect(buildDashboardPath({})).toBe("dashboard");
	});

	it("omits days when 0 (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildDashboardPath({ days: 0 })).toBe("dashboard");
	});

	it("appends days as a query string when provided as number", () => {
		expect(buildDashboardPath({ days: 7 })).toBe("dashboard?days=7");
	});

	it("appends days as a query string when provided as string", () => {
		expect(buildDashboardPath({ days: "30" })).toBe("dashboard?days=30");
	});

	it("matches CLI default behavior (caller passes string '30')", () => {
		// CLI: new URLSearchParams({ days: (values.days as string) ?? "30" })
		// which always sets days; the caller passes "30" as the fallback.
		const daysValue: string | undefined = undefined;
		expect(buildDashboardPath({ days: daysValue ?? "30" })).toBe("dashboard?days=30");
	});
});

// ---------------------------------------------------------------------------
// buildRetentionPath
// ---------------------------------------------------------------------------

describe("buildRetentionPath", () => {
	it("returns bare path when called with no opts", () => {
		expect(buildRetentionPath()).toBe("retention");
	});

	it("returns bare path when days is undefined", () => {
		expect(buildRetentionPath({})).toBe("retention");
	});

	it("omits days when 0 (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildRetentionPath({ days: 0 })).toBe("retention");
	});

	it("appends days when provided", () => {
		expect(buildRetentionPath({ days: 14 })).toBe("retention?days=14");
	});

	it("matches CLI default behavior (caller passes string '30')", () => {
		const daysValue: string | undefined = undefined;
		expect(buildRetentionPath({ days: daysValue ?? "30" })).toBe("retention?days=30");
	});
});

// ---------------------------------------------------------------------------
// buildFunnelPath
// ---------------------------------------------------------------------------

describe("buildFunnelPath", () => {
	it("sets steps and nothing else when days/window omitted", () => {
		expect(buildFunnelPath({ steps: "login,purchase" })).toBe("funnels?steps=login%2Cpurchase");
	});

	it("sets steps, then days, when days is provided", () => {
		expect(buildFunnelPath({ steps: "login,purchase", days: 7 })).toBe(
			"funnels?steps=login%2Cpurchase&days=7",
		);
	});

	it("sets steps, days, then window, when all three provided", () => {
		expect(buildFunnelPath({ steps: "a,b,c", days: 30, window: 86400 })).toBe(
			"funnels?steps=a%2Cb%2Cc&days=30&window=86400",
		);
	});

	it("sets steps and window without days when days omitted", () => {
		expect(buildFunnelPath({ steps: "a,b", window: 3600 })).toBe("funnels?steps=a%2Cb&window=3600");
	});

	it("percent-encodes special chars in step names", () => {
		// Comma is the separator used by callers; it must be encoded in the param value
		// so the API can split on commas at the top level.
		const path = buildFunnelPath({ steps: "step one,step/two" });
		expect(path).toBe("funnels?steps=step+one%2Cstep%2Ftwo");
	});

	it("preserves param order: steps first", () => {
		const path = buildFunnelPath({ steps: "a,b", days: 7, window: 3600 });
		const qs = path.split("?")[1] ?? "";
		const keys = [...new URLSearchParams(qs).keys()];
		expect(keys).toEqual(["steps", "days", "window"]);
	});

	it("omits days when 0 (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildFunnelPath({ steps: "a,b", days: 0 })).toBe("funnels?steps=a%2Cb");
	});

	it("omits window when 0 (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildFunnelPath({ steps: "a,b", window: 0 })).toBe("funnels?steps=a%2Cb");
	});
});

// ---------------------------------------------------------------------------
// buildInsightsPath
// ---------------------------------------------------------------------------

describe("buildInsightsPath", () => {
	it("sets metric and groupBy with no optional params", () => {
		expect(buildInsightsPath({ metric: "count", groupBy: "event_name" })).toBe(
			"insights?metric=count&groupBy=event_name",
		);
	});

	it("appends days when provided", () => {
		expect(buildInsightsPath({ metric: "count", groupBy: "platform", days: 30 })).toBe(
			"insights?metric=count&groupBy=platform&days=30",
		);
	});

	it("appends limit when provided", () => {
		expect(buildInsightsPath({ metric: "unique_players", groupBy: "event_name", limit: 20 })).toBe(
			"insights?metric=unique_players&groupBy=event_name&limit=20",
		);
	});

	it("appends eventName when provided", () => {
		expect(buildInsightsPath({ metric: "count", groupBy: "platform", eventName: "purchase" })).toBe(
			"insights?metric=count&groupBy=platform&eventName=purchase",
		);
	});

	it("appends all optional params in order: days, limit, eventName", () => {
		const path = buildInsightsPath({
			metric: "count",
			groupBy: "platform",
			days: 7,
			limit: 10,
			eventName: "login",
		});
		expect(path).toBe("insights?metric=count&groupBy=platform&days=7&limit=10&eventName=login");
	});

	it("preserves param order: metric, groupBy, days, limit, eventName", () => {
		const path = buildInsightsPath({
			metric: "count",
			groupBy: "platform",
			days: 7,
			limit: 10,
			eventName: "login",
		});
		const qs = path.split("?")[1] ?? "";
		const keys = [...new URLSearchParams(qs).keys()];
		expect(keys).toEqual(["metric", "groupBy", "days", "limit", "eventName"]);
	});

	it("omits limit when 0 (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildInsightsPath({ metric: "count", groupBy: "platform", limit: 0 })).toBe(
			"insights?metric=count&groupBy=platform",
		);
	});

	it("omits eventName when empty string (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildInsightsPath({ metric: "count", groupBy: "platform", eventName: "" })).toBe(
			"insights?metric=count&groupBy=platform",
		);
	});
});

// ---------------------------------------------------------------------------
// buildHeatmapPath
// ---------------------------------------------------------------------------

describe("buildHeatmapPath", () => {
	it("sets mapId and nothing else when optional params omitted", () => {
		expect(buildHeatmapPath({ mapId: "map-abc" })).toBe("heatmap?mapId=map-abc");
	});

	it("appends cellSize when provided", () => {
		expect(buildHeatmapPath({ mapId: "map-abc", cellSize: 25 })).toBe(
			"heatmap?mapId=map-abc&cellSize=25",
		);
	});

	it("appends days when provided", () => {
		expect(buildHeatmapPath({ mapId: "map-abc", days: 7 })).toBe("heatmap?mapId=map-abc&days=7");
	});

	it("appends eventName when provided", () => {
		expect(buildHeatmapPath({ mapId: "map-abc", eventName: "death" })).toBe(
			"heatmap?mapId=map-abc&eventName=death",
		);
	});

	it("appends all optional params in order: mapId, cellSize, days, eventName", () => {
		const path = buildHeatmapPath({ mapId: "map-abc", cellSize: 10, days: 14, eventName: "kill" });
		expect(path).toBe("heatmap?mapId=map-abc&cellSize=10&days=14&eventName=kill");
	});

	it("percent-encodes the mapId", () => {
		expect(buildHeatmapPath({ mapId: "map abc" })).toBe("heatmap?mapId=map+abc");
	});

	it("omits cellSize when 0 (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildHeatmapPath({ mapId: "map-abc", cellSize: 0 })).toBe("heatmap?mapId=map-abc");
	});

	it("omits eventName when empty string (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildHeatmapPath({ mapId: "map-abc", eventName: "" })).toBe("heatmap?mapId=map-abc");
	});
});

// ---------------------------------------------------------------------------
// buildContentPath
// ---------------------------------------------------------------------------

describe("buildContentPath", () => {
	it("returns bare path when called with no opts", () => {
		expect(buildContentPath()).toBe("/api/v1/content");
	});

	it("returns bare path when type is undefined", () => {
		expect(buildContentPath({})).toBe("/api/v1/content");
	});

	it("appends type as a query string when provided", () => {
		expect(buildContentPath({ type: "event" })).toBe("/api/v1/content?type=event");
	});

	it("percent-encodes the type value", () => {
		expect(buildContentPath({ type: "my type" })).toBe("/api/v1/content?type=my+type");
	});

	it("returns bare path when type is empty string (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildContentPath({ type: "" })).toBe("/api/v1/content");
	});
});

// ---------------------------------------------------------------------------
// buildBuildsPath
// ---------------------------------------------------------------------------

describe("buildBuildsPath", () => {
	it("returns bare path when called with no opts", () => {
		expect(buildBuildsPath()).toBe("builds");
	});

	it("returns bare path when days is undefined", () => {
		expect(buildBuildsPath({})).toBe("builds");
	});

	it("omits days when 0 (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildBuildsPath({ days: 0 })).toBe("builds");
	});

	it("appends days when provided", () => {
		expect(buildBuildsPath({ days: 30 })).toBe("builds?days=30");
	});

	it("appends fresh=1 only when fresh is true", () => {
		expect(buildBuildsPath({ fresh: true })).toBe("builds?fresh=1");
		expect(buildBuildsPath({ days: 30, fresh: true })).toBe("builds?days=30&fresh=1");
		expect(buildBuildsPath({ fresh: false })).toBe("builds");
	});

	it("appends buildId when set, in order days, buildId, fresh", () => {
		expect(buildBuildsPath({ buildId: "v1" })).toBe("builds?buildId=v1");
		expect(buildBuildsPath({ days: 30, buildId: "v1", fresh: true })).toBe(
			"builds?days=30&buildId=v1&fresh=1",
		);
	});
});

// ---------------------------------------------------------------------------
// buildBuildComparePath
// ---------------------------------------------------------------------------

describe("buildBuildComparePath", () => {
	it("sets baseline and candidate with no optional params", () => {
		expect(buildBuildComparePath({ baseline: "a", candidate: "b" })).toBe(
			"builds/compare?baseline=a&candidate=b",
		);
	});

	it("appends days when provided", () => {
		expect(buildBuildComparePath({ baseline: "a", candidate: "b", days: 30 })).toBe(
			"builds/compare?baseline=a&candidate=b&days=30",
		);
	});

	it("appends mapId and platform when provided", () => {
		expect(
			buildBuildComparePath({
				baseline: "a",
				candidate: "b",
				mapId: "lobby",
				platform: "Windows",
			}),
		).toBe("builds/compare?baseline=a&candidate=b&mapId=lobby&platform=Windows");
	});

	it("preserves param order: baseline, candidate, days, mapId, platform", () => {
		const path = buildBuildComparePath({
			baseline: "a",
			candidate: "b",
			days: 7,
			mapId: "m",
			platform: "p",
		});
		const qs = path.split("?")[1] ?? "";
		const keys = [...new URLSearchParams(qs).keys()];
		expect(keys).toEqual(["baseline", "candidate", "days", "mapId", "platform"]);
	});

	it("percent-encodes baseline and candidate values", () => {
		expect(buildBuildComparePath({ baseline: "v 1", candidate: "v/2" })).toBe(
			"builds/compare?baseline=v+1&candidate=v%2F2",
		);
	});

	it("omits days when 0 (truthy semantics, matching original CLI/MCP behavior)", () => {
		expect(buildBuildComparePath({ baseline: "a", candidate: "b", days: 0 })).toBe(
			"builds/compare?baseline=a&candidate=b",
		);
	});

	it("appends fresh=1 last only when fresh is true", () => {
		expect(buildBuildComparePath({ baseline: "a", candidate: "b", fresh: true })).toBe(
			"builds/compare?baseline=a&candidate=b&fresh=1",
		);
		expect(buildBuildComparePath({ baseline: "a", candidate: "b", fresh: false })).toBe(
			"builds/compare?baseline=a&candidate=b",
		);
		const keys = [
			...new URLSearchParams(
				buildBuildComparePath({
					baseline: "a",
					candidate: "b",
					days: 7,
					mapId: "m",
					platform: "p",
					fresh: true,
				}).split("?")[1] ?? "",
			).keys(),
		];
		expect(keys).toEqual(["baseline", "candidate", "days", "mapId", "platform", "fresh"]);
	});
});
