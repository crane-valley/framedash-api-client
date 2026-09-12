export const PERFORMANCE_RUN_METHOD = "unity-update-stopwatch-v1";
export const PERFORMANCE_RUN_MIN_SAMPLES = 1000;
export const PERFORMANCE_RUN_MAX_SAMPLES = 1_000_000;
export const PERFORMANCE_RUN_ROW_LIMIT = 16;
export const PERFORMANCE_RUN_HITCH_THRESHOLDS = [1000 / 60, 1000 / 30, 50, 100] as const;

export interface PerformanceRunEvent {
	event_name: string;
	build_id: string;
	platform: string;
	engine_version: string;
	timestamp_us: string;
	attributes: Record<string, string>;
	metrics: Record<string, number>;
}

export interface PerformanceRunMetadata {
	buildId: string;
	commit: string;
	branch: string;
	scenario: string;
	hardware: string;
	graphics: string;
	resolution: string;
	configuration: string;
	platform: string;
	engineVersion: string;
	method: string;
	sdkVersion: string;
	warmupFrames: number;
	targetFrames: number;
}

export type MillisecondInterval = [number, number];
export interface PerformanceRun {
	runId: string;
	status: "missing" | "incomplete" | "invalid" | "complete";
	reasons: string[];
	metadata?: PerformanceRunMetadata;
	startedAtUs?: string;
	endedAtUs?: string;
	samples?: number;
	droppedSamples?: number;
	warmupSamples?: number;
	durationMs?: number;
	quantiles?: Record<"p50" | "p95" | "p99", MillisecondInterval>;
	hitches?: { thresholdMs: number; count: number; per1000Frames: number }[];
}

export function isPerformanceRunId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
	);
}

function label(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim().length > 0 &&
		value.length <= 128 &&
		![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	);
}

function integer(value: unknown, max = PERFORMANCE_RUN_MAX_SAMPLES): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

function decimal(value: unknown): number {
	return typeof value === "string" && /^(0|[1-9][0-9]{0,6})$/.test(value)
		? Number(value)
		: Number.NaN;
}

export function performanceHistogramBounds(index: number): MillisecondInterval {
	const group = Math.floor(index / 16);
	const lower = group === 0 ? 0 : 2 ** (group - 1);
	const width = group === 0 ? 1 / 16 : lower / 16;
	return [lower + (index % 16) * width, lower + ((index % 16) + 1) * width];
}

function metadata(row: PerformanceRunEvent): PerformanceRunMetadata | undefined {
	const a = row.attributes;
	const fields = {
		buildId: row.build_id,
		commit: a["pr.commit"],
		branch: a["pr.branch"],
		scenario: a["pr.scenario"],
		hardware: a["pr.hardware"],
		graphics: a["pr.graphics"],
		resolution: a["pr.resolution"],
		configuration: a["pr.configuration"],
		platform: row.platform,
		engineVersion: row.engine_version,
		method: a["pr.method"],
		sdkVersion: a["pr.sdk"],
	};
	const warmupFrames = decimal(a["pr.warmup"]);
	const targetFrames = decimal(a["pr.target"]);
	if (
		a["pr.v"] !== "1" ||
		fields.method !== PERFORMANCE_RUN_METHOD ||
		!Object.values(fields).every(label) ||
		!integer(warmupFrames, 60_000) ||
		!integer(targetFrames) ||
		targetFrames < PERFORMANCE_RUN_MIN_SAMPLES
	)
		return;
	return { ...fields, warmupFrames, targetFrames } as PerformanceRunMetadata;
}

function signature(row: PerformanceRunEvent): string {
	const sorted = (map: Record<string, unknown>) =>
		Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
	return JSON.stringify([
		row.event_name,
		row.build_id,
		row.platform,
		row.engine_version,
		row.timestamp_us,
		sorted(row.attributes),
		sorted(row.metrics),
	]);
}

function readHistogram(attributes: Record<string, string>): number[] | undefined {
	const histogram: number[] = [];
	for (let i = 0; i < 8; i++) {
		const chunk = attributes[`pr.hist.${i}`];
		if (typeof chunk !== "string" || chunk.length > 255) return;
		const counts = chunk.split(",").map(decimal);
		if (counts.length !== 32 || !counts.every((n) => integer(n))) return;
		histogram.push(...counts);
	}
	return histogram;
}

function validDuration(histogram: number[], duration: number, wallTimeMs: number): boolean {
	const durationBounds = histogram.reduce<MillisecondInterval>(
		(sum, count, i) => {
			const bounds = performanceHistogramBounds(i);
			return [sum[0] + count * bounds[0], sum[1] + count * bounds[1]];
		},
		[0, 0],
	);
	// Duration is carried as a Float32 by the Unity wire model.
	const tolerance = Math.max(1, duration * 0.000001);
	return (
		duration + tolerance >= durationBounds[0] &&
		duration - tolerance <= durationBounds[1] &&
		duration - tolerance <= wallTimeMs
	);
}

function readHitches(
	histogram: number[],
	samples: number,
	metrics: Record<string, number>,
): PerformanceRun["hitches"] {
	const hitchKeys = ["pr.hitch_16", "pr.hitch_33", "pr.hitch_50", "pr.hitch_100"];
	const hitches: NonNullable<PerformanceRun["hitches"]> = [];
	for (const [i, thresholdMs] of PERFORMANCE_RUN_HITCH_THRESHOLDS.entries()) {
		const count = metrics[hitchKeys[i] ?? ""];
		if (!integer(count, samples) || count > (hitches.at(-1)?.count ?? samples)) return;
		const possible = histogram.reduce<MillisecondInterval>(
			(sum, n, bin) => {
				const [lower, upper] = performanceHistogramBounds(bin);
				return [sum[0] + (lower > thresholdMs ? n : 0), sum[1] + (upper > thresholdMs ? n : 0)];
			},
			[0, 0],
		);
		if (count < possible[0] || count > possible[1]) return;
		hitches.push({ thresholdMs, count, per1000Frames: samples ? (count * 1000) / samples : 0 });
	}
	return hitches;
}

function histogramQuantiles(histogram: number[], samples: number): PerformanceRun["quantiles"] {
	if (samples === 0) return;
	const quantile = (q: number): MillisecondInterval => {
		let total = 0;
		for (const [i, count] of histogram.entries()) {
			total += count;
			if (total >= Math.ceil(samples * q)) return performanceHistogramBounds(i);
		}
		return [0, 0];
	};
	return { p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99) };
}

type RunMeasurement = Required<
	Pick<PerformanceRun, "samples" | "droppedSamples" | "warmupSamples" | "durationMs" | "hitches">
> &
	Pick<PerformanceRun, "quantiles">;

function readMeasurement(
	end: PerformanceRunEvent,
	meta: PerformanceRunMetadata,
	startedAtUs: string,
): RunMeasurement | string {
	const histogram = readHistogram(end.attributes);
	if (!histogram) return "invalid_histogram";
	const samples = end.metrics["pr.samples"];
	const droppedSamples = end.metrics["pr.dropped"];
	const warmupSamples = end.metrics["pr.warmup_seen"];
	const durationMs = end.metrics["pr.duration_ms"];
	if (
		!integer(samples) ||
		!integer(droppedSamples) ||
		!integer(warmupSamples, meta.warmupFrames) ||
		samples + droppedSamples > meta.targetFrames ||
		histogram.reduce((a, b) => a + b, 0) !== samples ||
		typeof durationMs !== "number" ||
		!Number.isFinite(durationMs) ||
		durationMs < 0 ||
		(samples > 0 && durationMs === 0)
	)
		return "invalid_sample_accounting";
	const wallTimeMs = Number(BigInt(end.timestamp_us) - BigInt(startedAtUs)) / 1000;
	if (!validDuration(histogram, durationMs, wallTimeMs)) return "invalid_duration";
	const hitches = readHitches(histogram, samples, end.metrics);
	if (!hitches) return "invalid_hitch_counts";
	return {
		samples,
		droppedSamples,
		warmupSamples,
		durationMs,
		hitches,
		quantiles: histogramQuantiles(histogram, samples),
	};
}

function completionReasons(
	measurement: RunMeasurement,
	meta: PerformanceRunMetadata,
	state: string,
): string[] {
	const reasons: string[] = [];
	if (state !== "complete") reasons.push("explicitly_incomplete");
	if (measurement.warmupSamples !== meta.warmupFrames) reasons.push("warmup_incomplete");
	if (measurement.samples < meta.targetFrames) reasons.push("measurement_window_incomplete");
	if (measurement.droppedSamples > 0) reasons.push("dropped_samples");
	if (measurement.samples < PERFORMANCE_RUN_MIN_SAMPLES) reasons.push("insufficient_samples");
	return reasons;
}

function validRecord(row: PerformanceRunEvent, runId: string): boolean {
	return (
		!!row &&
		!!row.attributes &&
		!!row.metrics &&
		row.attributes["pr.id"] === runId &&
		["perf_run_start", "perf_run_end"].includes(row.event_name) &&
		typeof row.timestamp_us === "string" &&
		/^[1-9][0-9]{0,17}$/.test(row.timestamp_us)
	);
}

export function readPerformanceRun(runId: string, rows: PerformanceRunEvent[]): PerformanceRun {
	const invalid = (reason: string): PerformanceRun => ({
		runId,
		status: "invalid",
		reasons: [reason],
	});
	if (!isPerformanceRunId(runId)) return invalid("invalid_run_id");
	if (rows.length > PERFORMANCE_RUN_ROW_LIMIT) return invalid("too_many_records");
	if (rows.length === 0) return { runId, status: "missing", reasons: ["no_records_in_window"] };
	if (!rows.every((row) => validRecord(row, runId))) return invalid("invalid_record");
	const unique = [...new Map(rows.map((row) => [signature(row), row])).values()];
	const starts = unique.filter((row) => row.event_name === "perf_run_start");
	const ends = unique.filter((row) => row.event_name === "perf_run_end");
	if (starts.length > 1 || ends.length > 1) return invalid("conflicting_records");
	const start = starts[0];
	const end = ends[0];
	if (!start) return { runId, status: "incomplete", reasons: ["missing_start"] };
	const meta = metadata(start);
	if (!meta) return invalid("invalid_metadata");
	const result: PerformanceRun = {
		runId,
		status: "incomplete",
		reasons: ["missing_end"],
		metadata: meta,
		startedAtUs: start.timestamp_us,
	};
	if (!end) return result;
	if (JSON.stringify(metadata(end)) !== JSON.stringify(meta))
		return invalid("metadata_changed_during_run");
	if (BigInt(end.timestamp_us) <= BigInt(start.timestamp_us)) return invalid("invalid_time_order");
	const state = end.attributes["pr.state"];
	if (state !== "complete" && state !== "incomplete") return invalid("invalid_completion_state");
	const measurement = readMeasurement(end, meta, start.timestamp_us);
	if (typeof measurement === "string") return invalid(measurement);
	const reasons = completionReasons(measurement, meta, state);
	return {
		...result,
		...measurement,
		endedAtUs: end.timestamp_us,
		status: reasons.length ? "incomplete" : "complete",
		reasons,
	};
}

const CONDITIONS: (keyof PerformanceRunMetadata)[] = [
	"scenario",
	"hardware",
	"graphics",
	"resolution",
	"configuration",
	"platform",
	"engineVersion",
	"method",
	"sdkVersion",
	"warmupFrames",
	"targetFrames",
];
const QUANTILES = ["p50", "p95", "p99"] as const;
export interface PerformanceRunComparison {
	status: "comparable" | "inconclusive";
	reasons: string[];
	baseline: PerformanceRun;
	candidate: PerformanceRun;
	repeat?: PerformanceRun;
	quantiles?: Record<
		"p50" | "p95" | "p99",
		{ baseline: MillisecondInterval; candidate: MillisecondInterval; deltaMs: MillisecondInterval }
	>;
	repeatVariation?: Record<"p50" | "p95" | "p99", MillisecondInterval>;
}

function conditionMismatches(
	baseline: PerformanceRun,
	run: PerformanceRun,
	name: string,
): string[] {
	if (!baseline.metadata || !run.metadata) return [];
	const baseMetadata = baseline.metadata;
	const runMetadata = run.metadata;
	return CONDITIONS.filter((field) => baseMetadata[field] !== runMetadata[field]).map(
		(field) => `${name}_condition_mismatch:${field}`,
	);
}

export function comparePerformanceRuns(
	baseline: PerformanceRun,
	candidate: PerformanceRun,
	repeat?: PerformanceRun,
): PerformanceRunComparison {
	const reasons: string[] = [];
	const runs = [baseline, candidate, ...(repeat ? [repeat] : [])];
	if (new Set(runs.map((r) => r.runId)).size !== runs.length) reasons.push("run_ids_must_differ");
	for (const [i, run] of runs.entries()) {
		if (run.status !== "complete" || !run.metadata || !run.quantiles)
			reasons.push(`${["baseline", "candidate", "repeat"][i]}_not_complete`);
		if (i > 0)
			reasons.push(...conditionMismatches(baseline, run, i === 1 ? "candidate" : "repeat"));
	}
	if (
		repeat?.metadata &&
		baseline.metadata &&
		(repeat.metadata.buildId !== baseline.metadata.buildId ||
			repeat.metadata.commit !== baseline.metadata.commit)
	)
		reasons.push("repeat_build_must_match_baseline");
	const result: PerformanceRunComparison = {
		status: reasons.length ? "inconclusive" : "comparable",
		reasons,
		baseline,
		candidate,
		...(repeat && { repeat }),
	};
	const baselineQuantiles = baseline.quantiles;
	const candidateQuantiles = candidate.quantiles;
	const repeatQuantiles = repeat?.quantiles;
	if (reasons.length || !baselineQuantiles || !candidateQuantiles) return result;
	const delta = (b: MillisecondInterval, c: MillisecondInterval): MillisecondInterval => [
		c[0] - b[1],
		c[1] - b[0],
	];
	result.quantiles = Object.fromEntries(
		QUANTILES.map((q) => [
			q,
			{
				baseline: baselineQuantiles[q],
				candidate: candidateQuantiles[q],
				deltaMs: delta(baselineQuantiles[q], candidateQuantiles[q]),
			},
		]),
	) as PerformanceRunComparison["quantiles"];
	if (repeatQuantiles)
		result.repeatVariation = Object.fromEntries(
			QUANTILES.map((q) => [q, delta(baselineQuantiles[q], repeatQuantiles[q])]),
		) as PerformanceRunComparison["repeatVariation"];
	return result;
}
