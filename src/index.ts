import { isIPv4 } from "node:net";

export * from "./queries.js";

/** RFC 9457 Problem Details fields parsed from API error responses. */
export interface ProblemDetails {
	type?: string;
	title?: string;
	status?: number;
	detail?: string;
	instance?: string;
	error_category?: string;
	retryable?: boolean;
	retry_after?: number;
}

/** Error details from an API response. */
export class ApiError extends Error {
	public readonly problem: ProblemDetails;

	constructor(
		message: string,
		public readonly status: number,
		public readonly headers: Headers,
		problem?: ProblemDetails,
	) {
		super(message);
		this.name = "ApiError";
		this.problem = problem ?? {};
	}

	get retryable(): boolean {
		return this.problem.retryable === true;
	}

	get retryAfter(): number | undefined {
		return this.problem.retry_after;
	}

	get errorCategory(): string | undefined {
		return this.problem.error_category;
	}
}

export interface ApiClientOptions {
	baseUrl: string;
	apiKey: string;
	projectId: string;
	onError: (error: ApiError) => never;
}

/**
 * Reject base URLs that would leak the API key. The key is attached as an
 * X-API-Key header on every request, so the transport must be https; http is
 * permitted only for explicit loopback dev endpoints. Parsing the host (instead
 * of substring matching) also rejects look-alike hosts such as
 * http://localhost.attacker.example.
 */
export function assertSafeBaseUrl(baseUrl: string): void {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new Error(`Invalid base URL: ${JSON.stringify(baseUrl)}`);
	}
	// Reject userinfo (e.g. https://app.framedash.dev@evil.example): the scheme
	// and host checks below would pass on the real host while the request -- and
	// the X-API-Key header -- actually go to the host after the '@'.
	if (parsed.username || parsed.password) {
		throw new Error(`Insecure base URL ${JSON.stringify(baseUrl)}: must not embed credentials.`);
	}
	if (parsed.protocol === "https:") return;
	if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) return;
	throw new Error(
		`Insecure base URL ${JSON.stringify(baseUrl)}: must be https (http allowed only for localhost/loopback).`,
	);
}

function isLoopbackHost(hostname: string): boolean {
	// Strip IPv6 brackets and an optional trailing dot (valid absolute FQDN form).
	const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
		return true;
	}
	// The entire 127.0.0.0/8 block is loopback (RFC 1122); isIPv4 rejects
	// malformed octets so e.g. "127.300.0.1" is not treated as loopback.
	return isIPv4(host) && host.startsWith("127.");
}

/** REST API client for the Framedash Developer Platform. */
export class ApiClient {
	private baseUrl: string;
	private apiKey: string;
	private projectId: string;
	private onError: (error: ApiError) => never;

	constructor(options: ApiClientOptions) {
		assertSafeBaseUrl(options.baseUrl);
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.apiKey = options.apiKey;
		this.projectId = options.projectId;
		this.onError = options.onError;
	}

	async get<T = unknown>(path: string): Promise<T> {
		return this.request<T>("GET", path);
	}

	async post<T = unknown>(path: string, body?: unknown): Promise<T> {
		return this.request<T>("POST", path, body);
	}

	async patch<T = unknown>(path: string, body: unknown): Promise<T> {
		return this.request<T>("PATCH", path, body);
	}

	async delete<T = unknown>(path: string): Promise<T> {
		return this.request<T>("DELETE", path);
	}

	/** The current project ID (may be empty if not configured). */
	get currentProjectId(): string {
		return this.projectId;
	}

	/** Build a project-scoped API path: /api/v1/projects/{projectId}/{suffix} */
	projectPath(suffix: string): string {
		if (!this.projectId) {
			throw new Error("projectId is required for project-scoped requests");
		}
		return `/api/v1/projects/${encodeURIComponent(this.projectId)}/${suffix}`;
	}

	/** Create a new client with a different project ID. */
	withProject(projectId: string): ApiClient {
		return new ApiClient({
			baseUrl: this.baseUrl,
			apiKey: this.apiKey,
			projectId,
			onError: this.onError,
		});
	}

	/** Call onError and throw defensively in case the callback returns instead of throwing. */
	private fail(error: ApiError): never {
		this.onError(error);
		// Defensive: onError is typed as never, but guard against non-compliant callbacks
		throw error;
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {
			"X-API-Key": this.apiKey,
			Accept: "application/problem+json, application/json;q=0.9",
		};

		if (!path.includes("/projects/") && this.projectId) {
			headers["X-Project-Id"] = this.projectId;
		}

		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}

		const response = await fetch(url, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
			redirect: "manual",
			signal: AbortSignal.timeout(30_000),
		});

		// Never follow a redirect: fetch would re-send the X-API-Key header to the
		// redirect target (undici strips only Authorization/Cookie/Proxy-Authorization
		// across a cross-origin redirect, not custom headers). The API never 3xx's a
		// programmatic JSON request, so treat any redirect as an error.
		if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
			this.fail(
				new ApiError(
					`API returned an unexpected redirect (status ${response.status || "opaque"}); refusing to resend credentials to the redirect target`,
					response.status,
					response.headers,
				),
			);
		}

		const text = await response.text();
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			this.fail(
				new ApiError(
					`API returned non-JSON response (${response.status}): ${text.slice(0, 200)}`,
					response.status,
					response.headers,
				),
			);
		}

		if (
			!response.ok ||
			typeof json !== "object" ||
			json === null ||
			(json as { success?: boolean }).success !== true
		) {
			const obj =
				typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
			const problem = parseProblemDetails(obj);
			const msg =
				typeof obj.detail === "string"
					? obj.detail
					: typeof obj.title === "string"
						? obj.title
						: response.ok
							? "API operation failed"
							: `HTTP ${response.status}`;
			this.fail(new ApiError(`API error: ${msg}`, response.status, response.headers, problem));
		}

		return (json as { data: T }).data;
	}
}

function parseProblemDetails(obj: Record<string, unknown>): ProblemDetails {
	const p: ProblemDetails = {};
	if (typeof obj.type === "string") p.type = obj.type;
	if (typeof obj.title === "string") p.title = obj.title;
	if (typeof obj.status === "number") p.status = obj.status;
	if (typeof obj.detail === "string") p.detail = obj.detail;
	if (typeof obj.instance === "string") p.instance = obj.instance;
	if (typeof obj.error_category === "string") p.error_category = obj.error_category;
	if (typeof obj.retryable === "boolean") p.retryable = obj.retryable;
	if (typeof obj.retry_after === "number") p.retry_after = obj.retry_after;
	return p;
}
