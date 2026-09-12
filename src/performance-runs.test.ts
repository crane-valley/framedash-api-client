import { describe, expect, it } from "vitest";
import {
	comparePerformanceRuns,
	isPerformanceRunId,
	type PerformanceRunEvent,
	readPerformanceRun,
} from "./performance-runs.js";

const BASE = "a1111111-1111-4111-8111-111111111111";
const CANDIDATE = "b2222222-2222-4222-8222-222222222222";

function events(id = BASE, bin = 80): [PerformanceRunEvent, PerformanceRunEvent] {
	const histogram = Array<number>(256).fill(0);
	histogram[bin] = 1200;
	const attributes: Record<string, string> = {
		"pr.v": "1",
		"pr.id": id,
		"pr.method": "unity-update-stopwatch-v1",
		"pr.sdk": "0.1.8",
		"pr.scenario": "route-a",
		"pr.hardware": "lab-pc-a",
		"pr.graphics": "high-vsync-off",
		"pr.resolution": "1920x1080",
		"pr.configuration": "release",
		"pr.commit": "abc123",
		"pr.branch": "main",
		"pr.warmup": "120",
		"pr.target": "1200",
	};
	const start = {
		event_name: "perf_run_start",
		build_id: "build-a",
		platform: "WindowsPlayer",
		engine_version: "6000.0",
		timestamp_us: "1000000",
		attributes,
		metrics: {},
	};
	const endAttributes = { ...attributes, "pr.state": "complete" };
	for (let i = 0; i < 8; i++)
		endAttributes[`pr.hist.${i}` as keyof typeof endAttributes] = histogram
			.slice(i * 32, (i + 1) * 32)
			.join(",");
	return [
		start,
		{
			...start,
			event_name: "perf_run_end",
			timestamp_us: "30000000",
			attributes: endAttributes,
			metrics: {
				"pr.samples": 1200,
				"pr.dropped": 0,
				"pr.warmup_seen": 120,
				"pr.duration_ms": bin === 79 ? 18900 : 19500,
				"pr.hitch_16": 0,
				"pr.hitch_33": 0,
				"pr.hitch_50": 0,
				"pr.hitch_100": 0,
			},
		},
	];
}

describe("performance run evidence", () => {
	it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"])("rejects UUIDs with trailing %j", (suffix) => {
		expect(isPerformanceRunId(BASE + suffix)).toBe(false);
	});
	it("rejects zero duration for positive samples even in the first histogram bin", () => {
		const rows = events();
		const histogram = Array<number>(256).fill(0);
		histogram[0] = 1200;
		for (let i = 0; i < 8; i++)
			rows[1].attributes[`pr.hist.${i}`] = histogram.slice(i * 32, (i + 1) * 32).join(",");
		rows[1].metrics["pr.duration_ms"] = 0;
		expect(readPerformanceRun(BASE, rows).status).toBe("invalid");
	});
	it("keeps a tail-only slowdown visible when the median is unchanged", () => {
		const rows = events(CANDIDATE);
		const histogram = Array<number>(256).fill(0);
		histogram[80] = 1180;
		histogram[121] = 20;
		for (let i = 0; i < 8; i++)
			rows[1].attributes[`pr.hist.${i}`] = histogram.slice(i * 32, (i + 1) * 32).join(",");
		rows[1].metrics["pr.duration_ms"] = 21175;
		rows[1].metrics["pr.hitch_16"] = 20;
		rows[1].metrics["pr.hitch_33"] = 20;
		rows[1].metrics["pr.hitch_50"] = 20;
		const result = comparePerformanceRuns(
			readPerformanceRun(BASE, events()),
			readPerformanceRun(CANDIDATE, rows),
		);
		expect(result.status).toBe("comparable");
		expect(result.quantiles?.p50.candidate).toEqual(result.quantiles?.p50.baseline);
		expect(result.quantiles?.p99.deltaMs).toEqual([83, 88]);
		expect(result.candidate.hitches?.[2]?.count).toBe(20);
	});
	it("keeps same-build reruns distinct and reports histogram intervals", () => {
		const result = comparePerformanceRuns(
			readPerformanceRun(BASE, events()),
			readPerformanceRun(CANDIDATE, events(CANDIDATE)),
		);
		expect(result.status).toBe("comparable");
		expect(result.baseline.metadata?.buildId).toBe(result.candidate.metadata?.buildId);
		expect(result.quantiles?.p99.baseline).toEqual([16, 17]);
	});
	it("never interprets legacy snapshots or a missing end as a complete run", () => {
		expect(readPerformanceRun(BASE, []).status).toBe("missing");
		expect(readPerformanceRun(BASE, events().slice(0, 1)).status).toBe("incomplete");
	});
	it.each([
		"pr.hardware",
		"pr.graphics",
		"pr.resolution",
		"pr.scenario",
		"pr.configuration",
		"pr.warmup",
		"pr.target",
		"pr.method",
	])("rejects changed condition %s", (key) => {
		const candidate = events(CANDIDATE);
		for (const row of candidate) row.attributes[key] = "different";
		expect(
			comparePerformanceRuns(
				readPerformanceRun(BASE, events()),
				readPerformanceRun(CANDIDATE, candidate),
			).status,
		).toBe("inconclusive");
	});
	it.each([
		"pr.hist.0",
		"pr.commit",
		"pr.branch",
		"pr.hardware",
	])("rejects missing required data %s", (key) => {
		const rows = events();
		delete rows[1].attributes[key];
		expect(readPerformanceRun(BASE, rows).status).toBe("invalid");
	});
	it("rejects partial, dropped and undersampled measurements", () => {
		for (const [key, value] of [
			["pr.samples", 1199],
			["pr.dropped", 1],
			["pr.warmup_seen", 119],
		] as const) {
			const rows = events();
			rows[1].metrics[key] = value;
			expect(readPerformanceRun(BASE, rows).status).not.toBe("complete");
		}
		const rows = events();
		rows[1].attributes["pr.state"] = "incomplete";
		expect(readPerformanceRun(BASE, rows).status).toBe("incomplete");
	});
	it("deduplicates identical delivery retries but rejects reused identities", () => {
		const rows = events();
		expect(readPerformanceRun(BASE, [...rows, ...rows]).status).toBe("complete");
		expect(
			readPerformanceRun(BASE, [...rows, { ...rows[0], timestamp_us: "2000000" }]).status,
		).toBe("invalid");
	});
	it("rejects histogram corruption, nonfinite metrics and impossible time order", () => {
		const corrupt = events();
		corrupt[1].attributes["pr.hist.7"] = "0";
		expect(readPerformanceRun(BASE, corrupt).status).toBe("invalid");
		const nonfinite = events();
		nonfinite[1].metrics["pr.duration_ms"] = Number.NaN;
		expect(readPerformanceRun(BASE, nonfinite).status).toBe("invalid");
		const reversed = events();
		reversed[1].timestamp_us = "1";
		expect(readPerformanceRun(BASE, reversed).status).toBe("invalid");
	});
	it("shows unchanged-repeat variation and refuses a changed-build repeat", () => {
		const repeatId = "c3333333-3333-4333-8333-333333333333";
		const repeat = readPerformanceRun(repeatId, events(repeatId, 79));
		const result = comparePerformanceRuns(
			readPerformanceRun(BASE, events()),
			readPerformanceRun(CANDIDATE, events(CANDIDATE)),
			repeat,
		);
		expect(result.repeatVariation?.p99).toEqual([-1.5, 0]);
		const changed = events(repeatId);
		for (const row of changed) row.build_id = "different-build";
		expect(
			comparePerformanceRuns(
				result.baseline,
				result.candidate,
				readPerformanceRun(repeatId, changed),
			).status,
		).toBe("inconclusive");
	});
});
