import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, assertSafeBaseUrl } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(
	body: unknown,
	status = 200,
	extraHeaders: Record<string, string> = {},
): Response {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...extraHeaders,
	};
	return new Response(JSON.stringify(body), { status, headers });
}

function makeClient(
	overrides: Partial<{
		baseUrl: string;
		projectId: string;
		apiKey: string;
		onError: (e: ApiError) => never;
	}> = {},
): ApiClient {
	return new ApiClient({
		baseUrl: overrides.baseUrl ?? "https://app.example.com",
		apiKey: overrides.apiKey ?? "test-key",
		projectId: overrides.projectId ?? "proj-123",
		onError:
			overrides.onError ??
			((e) => {
				throw e;
			}),
	});
}

// ---------------------------------------------------------------------------
// assertSafeBaseUrl
// ---------------------------------------------------------------------------

describe("assertSafeBaseUrl", () => {
	describe("accepts safe URLs", () => {
		it("accepts https with a real domain", () => {
			expect(() => assertSafeBaseUrl("https://app.example.com")).not.toThrow();
		});

		it("accepts http://localhost:3000", () => {
			expect(() => assertSafeBaseUrl("http://localhost:3000")).not.toThrow();
		});

		it("accepts http://127.0.0.1:8123", () => {
			expect(() => assertSafeBaseUrl("http://127.0.0.1:8123")).not.toThrow();
		});

		it("accepts http://[::1]:3000", () => {
			expect(() => assertSafeBaseUrl("http://[::1]:3000")).not.toThrow();
		});

		it("accepts http://sub.localhost", () => {
			expect(() => assertSafeBaseUrl("http://sub.localhost")).not.toThrow();
		});

		it("accepts http://localhost. (trailing dot absolute FQDN form)", () => {
			expect(() => assertSafeBaseUrl("http://localhost.")).not.toThrow();
		});
	});

	describe("rejects insecure URLs with an 'Insecure' message", () => {
		it("rejects http://evil.example", () => {
			expect(() => assertSafeBaseUrl("http://evil.example")).toThrow(/Insecure/);
		});

		it("rejects http://localhost.attacker.example (look-alike host)", () => {
			expect(() => assertSafeBaseUrl("http://localhost.attacker.example")).toThrow(/Insecure/);
		});

		it("rejects URLs with userinfo (https://user@host)", () => {
			expect(() => assertSafeBaseUrl("https://user@host.example.com")).toThrow(/Insecure/);
		});
	});

	describe("rejects unparseable strings with an 'Invalid' message", () => {
		it("rejects an unparseable string", () => {
			expect(() => assertSafeBaseUrl("not a url")).toThrow(/Invalid/);
		});

		it("rejects an empty string", () => {
			expect(() => assertSafeBaseUrl("")).toThrow(/Invalid/);
		});

		it("rejects http://127.300.0.1 (malformed octet -- WHATWG parser throws 'Invalid', not 'Insecure')", () => {
			// The WHATWG URL parser rejects 127.300.0.1 outright (Invalid base URL),
			// so the malformed octet is never treated as loopback. The error message
			// distinguishes invalid-URL from insecure-URL as required.
			expect(() => assertSafeBaseUrl("http://127.300.0.1")).toThrow(/Invalid/);
		});
	});
});

// ---------------------------------------------------------------------------
// ApiClient constructor
// ---------------------------------------------------------------------------

describe("ApiClient constructor", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("strips trailing slashes from baseUrl", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		const client = makeClient({ baseUrl: "https://app.example.com///" });
		await client.get("/api/v1/content");
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://app.example.com/api/v1/content");
	});

	it("throws on an insecure base URL", () => {
		expect(() => makeClient({ baseUrl: "http://evil.example" })).toThrow(/Insecure/);
	});

	it("throws when BOTH apiKey and accessToken are provided", () => {
		expect(
			() =>
				new ApiClient({
					baseUrl: "https://app.example.com",
					apiKey: "fd_key",
					accessToken: "fdat_token",
					projectId: "",
					onError: (e: ApiError) => {
						throw e;
					},
				} as never),
		).toThrow(/Exactly one of apiKey or accessToken/);
	});

	it("throws when NEITHER apiKey nor accessToken is provided", () => {
		expect(
			() =>
				new ApiClient({
					baseUrl: "https://app.example.com",
					projectId: "",
					onError: (e: ApiError) => {
						throw e;
					},
				} as never),
		).toThrow(/Exactly one of apiKey or accessToken/);
	});

	it("treats empty-string credentials as absent", () => {
		expect(
			() =>
				new ApiClient({
					baseUrl: "https://app.example.com",
					apiKey: "",
					projectId: "",
					onError: (e) => {
						throw e;
					},
				}),
		).toThrow(/Exactly one of apiKey or accessToken/);
	});
});

// ---------------------------------------------------------------------------
// Bearer access token credential
// ---------------------------------------------------------------------------

describe("ApiClient with accessToken", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let client: ApiClient;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		client = new ApiClient({
			baseUrl: "https://app.example.com",
			accessToken: "fdat_test_token",
			projectId: "",
			onError: (e) => {
				throw e;
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends Authorization: Bearer and NO X-API-Key", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await client.get("/api/v1/content");
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer fdat_test_token");
		expect(headers["X-API-Key"]).toBeUndefined();
	});

	it("withProject preserves the Bearer credential", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		const derived = client.withProject("proj-2");
		await derived.get(derived.projectPath("status"));
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("proj-2");
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer fdat_test_token");
		expect(headers["X-API-Key"]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// get() transport
// ---------------------------------------------------------------------------

describe("ApiClient.get()", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let client: ApiClient;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		client = makeClient({ projectId: "proj-abc" });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns .data when success:true", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { foo: "bar" } }));
		const result = await client.get("/api/v1/content");
		expect(result).toEqual({ foo: "bar" });
	});

	it("sends X-API-Key header", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await client.get("/api/v1/content");
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-key");
	});

	it("sends Accept header", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await client.get("/api/v1/content");
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).Accept).toMatch(/application\/json/);
	});

	it("does NOT send Content-Type without a body", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await client.get("/api/v1/content");
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
	});

	it("sends X-Project-Id when path does NOT contain /projects/ and projectId is set", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await client.get("/api/v1/content");
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["X-Project-Id"]).toBe("proj-abc");
	});

	it("does NOT send X-Project-Id when path contains /projects/", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await client.get("/api/v1/projects/proj-abc/dashboard");
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["X-Project-Id"]).toBeUndefined();
	});

	it("does NOT send X-Project-Id when projectId is empty string", async () => {
		const noProjectClient = makeClient({ projectId: "" });
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await noProjectClient.get("/api/v1/content");
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["X-Project-Id"]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// post() transport
// ---------------------------------------------------------------------------

describe("ApiClient.post()", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let client: ApiClient;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		client = makeClient();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sets Content-Type: application/json when body is provided", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await client.post("/api/v1/projects/proj-123/alerts", { name: "test" });
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
	});

	it("serializes body as JSON", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		await client.post("/api/v1/projects/proj-123/alerts", { name: "test", value: 42 });
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.body).toBe(JSON.stringify({ name: "test", value: 42 }));
	});
});

// ---------------------------------------------------------------------------
// Redirect handling
// ---------------------------------------------------------------------------

describe("redirect handling", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let errors: ApiError[];
	let client: ApiClient;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		errors = [];
		client = makeClient({
			onError: (e) => {
				errors.push(e);
				throw e;
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("rejects a 302 response with ApiError mentioning redirect", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 302 }));
		await expect(client.get("/api/v1/content")).rejects.toBeInstanceOf(ApiError);
		expect(errors[0]?.message).toMatch(/redirect/i);
	});

	it("rejects a response with type 'opaqueredirect'", async () => {
		// Simulate a fetch opaqueredirect response object (redirect:'manual' + cross-origin)
		const opaqueResponse = {
			type: "opaqueredirect",
			status: 0,
			ok: false,
			headers: new Headers(),
			text: async () => "",
		} as unknown as Response;
		fetchMock.mockResolvedValue(opaqueResponse);
		await expect(client.get("/api/v1/content")).rejects.toBeInstanceOf(ApiError);
		expect(errors[0]?.message).toMatch(/redirect/i);
	});
});

// ---------------------------------------------------------------------------
// Non-JSON response
// ---------------------------------------------------------------------------

describe("non-JSON body", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let client: ApiClient;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		client = makeClient({
			onError: (e) => {
				throw e;
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("throws ApiError with 'non-JSON response' when body is not JSON", async () => {
		fetchMock.mockResolvedValue(new Response("not json at all", { status: 200 }));
		await expect(client.get("/api/v1/content")).rejects.toThrow(/non-JSON response/);
	});
});

// ---------------------------------------------------------------------------
// Error response handling
// ---------------------------------------------------------------------------

describe("error response handling", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let client: ApiClient;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		client = makeClient({
			onError: (e) => {
				throw e;
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("throws ApiError with RFC9457 detail as message on !response.ok", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					type: "https://errors.framedash.dev/rate-limited",
					title: "Rate limited",
					status: 429,
					detail: "Too many requests",
					error_category: "rate_limit",
					retryable: true,
					retry_after: 5,
				},
				429,
			),
		);
		let caught: ApiError | undefined;
		try {
			await client.get("/api/v1/content");
		} catch (e) {
			caught = e as ApiError;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect(caught?.message).toContain("Too many requests");
		expect(caught?.retryable).toBe(true);
		expect(caught?.retryAfter).toBe(5);
		expect(caught?.errorCategory).toBe("rate_limit");
	});

	it("throws ApiError with 'API operation failed' when success:false on 200", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: false }, 200));
		await expect(client.get("/api/v1/content")).rejects.toThrow(/API operation failed/);
	});

	it("falls back to title when detail is absent", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ type: "https://errors.framedash.dev/not-found", title: "Not found", status: 404 },
				404,
			),
		);
		await expect(client.get("/api/v1/content")).rejects.toThrow(/Not found/);
	});

	it("falls back to HTTP status string when neither detail nor title present", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ code: 403 }, 403));
		await expect(client.get("/api/v1/content")).rejects.toThrow(/HTTP 403/);
	});
});

// ---------------------------------------------------------------------------
// projectPath / withProject / currentProjectId
// ---------------------------------------------------------------------------

describe("projectPath", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("encodes the projectId in the path", () => {
		const client = makeClient({ projectId: "my project" });
		expect(client.projectPath("dashboard")).toBe("/api/v1/projects/my%20project/dashboard");
	});

	it("throws when projectId is empty", () => {
		const client = makeClient({ projectId: "" });
		expect(() => client.projectPath("dashboard")).toThrow(/projectId is required/);
	});

	it("currentProjectId getter returns the configured project ID", () => {
		const client = makeClient({ projectId: "proj-xyz" });
		expect(client.currentProjectId).toBe("proj-xyz");
	});
});

describe("withProject", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns a new client with the specified project ID", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }));
		const base = makeClient({ projectId: "proj-original" });
		const derived = base.withProject("proj-new");
		expect(derived.currentProjectId).toBe("proj-new");
	});

	it("the derived client makes requests with the new projectId in the path", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
		const base = makeClient({ projectId: "proj-original" });
		const derived = base.withProject("proj-new");
		await derived.get(derived.projectPath("dashboard"));
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("proj-new");
	});
});

// ---------------------------------------------------------------------------
// onError contract
// ---------------------------------------------------------------------------

describe("onError contract", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("calls onError with the ApiError and propagates the throw", async () => {
		const onError = vi.fn((e: ApiError): never => {
			throw e;
		});
		const client = makeClient({ onError });
		fetchMock.mockResolvedValue(jsonResponse({ success: false }, 500));
		await expect(client.get("/api/v1/content")).rejects.toBeInstanceOf(ApiError);
		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(ApiError);
	});

	it("defensive re-throw: if onError returns instead of throwing, the error is still thrown", async () => {
		// Cast as never to satisfy the type, but the function actually returns undefined
		const nonThrowingOnError = vi.fn((_e: ApiError): never => undefined as never);
		const client = makeClient({ onError: nonThrowingOnError });
		fetchMock.mockResolvedValue(jsonResponse({ success: false }, 500));
		await expect(client.get("/api/v1/content")).rejects.toBeInstanceOf(ApiError);
		expect(nonThrowingOnError).toHaveBeenCalledOnce();
	});
});
