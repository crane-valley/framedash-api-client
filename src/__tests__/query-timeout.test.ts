import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../index.js";

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), ms);
		return controller.signal;
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function makeClient(options: { baseUrl?: string; queryTimeoutMs?: number } = {}) {
	return new ApiClient({
		baseUrl: "http://localhost:3000",
		apiKey: "test-key",
		projectId: "project-1",
		onError: (error) => {
			throw error;
		},
		...options,
	});
}

function delayedResponse(delayMs: number) {
	const fetch = vi.fn(
		(_url: unknown, options: RequestInit) =>
			new Promise<Response>((resolve, reject) => {
				const timer = setTimeout(
					() => resolve(new Response(JSON.stringify({ success: true, data: { rowCount: 1 } }))),
					delayMs,
				);
				options.signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						reject(options.signal?.reason);
					},
					{ once: true },
				);
			}),
	);
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

describe("query request timeout", () => {
	it.each([
		"http://localhost:3000",
		"http://localhost:3000/proxy",
	])("allows an opted-in query through %s to take 69 seconds without an HTTP retry", async (baseUrl) => {
		const fetch = delayedResponse(69_000);
		const client = makeClient({ baseUrl, queryTimeoutMs: 120_000 }).withProject("project-2");
		const result = client
			.post("/api/v1/query?format=json", { sql: "SELECT 1" })
			.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(69_000);
		expect(await result).toEqual({ rowCount: 1 });
		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0]?.[0]).toBe(`${baseUrl}/api/v1/query?format=json`);
	});

	it.each([
		["/api/v1/query", undefined, 30_000],
		["/api/v1/query", 120_000, 120_000],
		["/api/v1/alerts", 120_000, 30_000],
		["/api/v1/query-export", 120_000, 30_000],
	])("aborts %s with queryTimeoutMs=%s at %s ms", async (path, queryTimeoutMs, timeout) => {
		const fetch = delayedResponse(180_000);
		const settled = vi.fn();
		const result = makeClient({ queryTimeoutMs })
			.post(path, {})
			.then(settled, (error: unknown) => {
				settled();
				return error;
			});
		await vi.advanceTimersByTimeAsync(timeout - 1);
		expect(settled).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toHaveBeenCalledOnce();
		expect(await result).toMatchObject({ name: "TimeoutError" });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("keeps GET requests on the query path at 30 seconds when opted in", async () => {
		const fetch = delayedResponse(69_000);
		const result = expect(
			makeClient({ queryTimeoutMs: 120_000 }).get("/api/v1/query"),
		).rejects.toMatchObject({ name: "TimeoutError" });
		await vi.advanceTimersByTimeAsync(30_000);
		await result;
		expect(fetch).toHaveBeenCalledOnce();
	});

	it.each([
		null as unknown as number,
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		2_147_483_648,
	])("rejects an invalid query timeout of %s", (queryTimeoutMs) => {
		expect(() => makeClient({ queryTimeoutMs })).toThrow("queryTimeoutMs");
	});
});
