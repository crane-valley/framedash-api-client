import { isIPv4 } from "node:net";

export * from "./queries.js";

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

/**
 * Exactly one credential: a project-bound API key (sent as X-API-Key) or an
 * OAuth 2.1 access token (sent as Authorization: Bearer). The `never`-typed
 * counterpart field makes passing both a compile-time error; the constructor
 * enforces the same invariant at runtime for plain-JS consumers.
 */
export type ApiClientCredential =
	| { apiKey: string; accessToken?: never }
	| { accessToken: string; apiKey?: never };

export type ApiClientOptions = {
	baseUrl: string;
	projectId: string;
	queryTimeoutMs?: number;
	onError: (error: ApiError) => never;
} & ApiClientCredential;

/**
 * Reject base URLs that would leak the credential. The API key or Bearer
 * token is attached as a header on every request, so the transport must be
 * https; http is permitted only for explicit loopback dev endpoints. Parsing
 * the host (instead of substring matching) also rejects look-alike hosts such
 * as http://localhost.attacker.example.
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
	const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
		return true;
	}
	// The entire 127.0.0.0/8 block is loopback (RFC 1122); isIPv4 rejects
	// malformed octets so e.g. "127.300.0.1" is not treated as loopback.
	return isIPv4(host) && host.startsWith("127.");
}

type ParsedJson = { ok: true; value: unknown } | { ok: false; error: ApiError };
type ParsedApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

function createRequestHeaders(
	credential: ApiClientCredential,
	path: string,
	projectId: string,
	hasBody: boolean,
): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/problem+json, application/json;q=0.9",
	};
	if (credential.apiKey !== undefined) {
		headers["X-API-Key"] = credential.apiKey;
	} else {
		headers.Authorization = `Bearer ${credential.accessToken}`;
	}

	if (!path.includes("/projects/") && projectId) {
		headers["X-Project-Id"] = projectId;
	}
	if (hasBody) {
		headers["Content-Type"] = "application/json";
	}
	return headers;
}

function getUnexpectedRedirectError(response: Response): ApiError | null {
	// Never follow a redirect: fetch would re-send the X-API-Key header to the
	// redirect target (undici strips only Authorization/Cookie/Proxy-Authorization
	// across a CROSS-origin redirect, not custom headers -- and a same-origin
	// redirect re-sends the Bearer token too). The API never 3xx's a
	// programmatic JSON request, so treat any redirect as an error.
	if (response.type !== "opaqueredirect" && (response.status < 300 || response.status >= 400)) {
		return null;
	}
	return new ApiError(
		`API returned an unexpected redirect (status ${response.status || "opaque"}); refusing to resend credentials to the redirect target`,
		response.status,
		response.headers,
	);
}

async function parseResponseJson(response: Response): Promise<ParsedJson> {
	const text = await response.text();
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return {
			ok: false,
			error: new ApiError(
				`API returned non-JSON response (${response.status}): ${text.slice(0, 200)}`,
				response.status,
				response.headers,
			),
		};
	}
}

function isSuccessfulEnvelope(value: unknown): value is { success: true; data: unknown } {
	return (
		typeof value === "object" && value !== null && (value as { success?: boolean }).success === true
	);
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function selectApiErrorMessage(obj: Record<string, unknown>, response: Response): string {
	if (typeof obj.detail === "string") return obj.detail;
	if (typeof obj.title === "string") return obj.title;
	return response.ok ? "API operation failed" : `HTTP ${response.status}`;
}

function getApiResponseError(response: Response, value: unknown): ApiError | null {
	if (response.ok && isSuccessfulEnvelope(value)) return null;
	const obj = asRecord(value);
	return new ApiError(
		`API error: ${selectApiErrorMessage(obj, response)}`,
		response.status,
		response.headers,
		parseProblemDetails(obj),
	);
}

async function parseApiResponse<T>(response: Response): Promise<ParsedApiResponse<T>> {
	const redirectError = getUnexpectedRedirectError(response);
	if (redirectError) return { ok: false, error: redirectError };

	const parsedJson = await parseResponseJson(response);
	if (!parsedJson.ok) return parsedJson;

	const responseError = getApiResponseError(response, parsedJson.value);
	if (responseError) return { ok: false, error: responseError };

	return { ok: true, data: (parsedJson.value as { data: T }).data };
}

export class ApiClient {
	private baseUrl: string;
	private credential: ApiClientCredential;
	private projectId: string;
	private queryTimeoutMs: number;
	private onError: (error: ApiError) => never;

	constructor(options: ApiClientOptions) {
		assertSafeBaseUrl(options.baseUrl);
		const queryTimeoutMs = options.queryTimeoutMs ?? 30_000;
		if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 1 || queryTimeoutMs > 2_147_483_647) {
			throw new Error("queryTimeoutMs must be an integer between 1 and 2147483647");
		}
		this.queryTimeoutMs = queryTimeoutMs;
		const hasApiKey = typeof options.apiKey === "string" && options.apiKey.length > 0;
		const hasAccessToken =
			typeof options.accessToken === "string" && options.accessToken.length > 0;
		if (hasApiKey === hasAccessToken) {
			throw new Error("Exactly one of apiKey or accessToken is required");
		}
		this.credential = hasApiKey
			? { apiKey: options.apiKey as string }
			: { accessToken: options.accessToken as string };
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
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

	get currentProjectId(): string {
		return this.projectId;
	}

	projectPath(suffix: string): string {
		if (!this.projectId) {
			throw new Error("projectId is required for project-scoped requests");
		}
		return `/api/v1/projects/${encodeURIComponent(this.projectId)}/${suffix}`;
	}

	withProject(projectId: string): ApiClient {
		return new ApiClient({
			baseUrl: this.baseUrl,
			projectId,
			queryTimeoutMs: this.queryTimeoutMs,
			onError: this.onError,
			...this.credential,
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
		const headers = createRequestHeaders(this.credential, path, this.projectId, body !== undefined);
		const timeoutMs =
			method === "POST" && path.split(/[?#]/, 1)[0] === "/api/v1/query"
				? this.queryTimeoutMs
				: 30_000;

		const response = await fetch(url, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
			redirect: "manual",
			signal: AbortSignal.timeout(timeoutMs),
		});
		const parsed = await parseApiResponse<T>(response);
		if (!parsed.ok) this.fail(parsed.error);
		return parsed.data;
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
