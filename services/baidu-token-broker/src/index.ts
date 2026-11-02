/**
 * Stateless Baidu OAuth token broker.
 *
 * The production handler has no persistence and deliberately contains no
 * logging calls. User authorization codes and tokens only live for the
 * lifetime of a request.
 */

const BAIDU_TOKEN_ENDPOINT = "https://openapi.baidu.com/oauth/2.0/token";

const DEFAULT_UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_UPSTREAM_BODY_BYTES = 64 * 1024;
const MAX_CODE_LENGTH = 2_048;
const MAX_REFRESH_TOKEN_LENGTH = 8_192;
const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_BUILD_REVISION_LENGTH = 128;
const OAUTH_COORDINATE_FINGERPRINT_PREFIX =
  "baidu-oauth-coordinate-v1\n";
const BAIDU_CALLBACK_PATH = "/oauth/baidu/callback";
const BAIDU_CALLBACK_SCRIPT_PATH = "/oauth/baidu/return-to-app.js";
const BAIDU_CALLBACK_STYLES_PATH = "/oauth/baidu/return-to-app.css";
const BAIDU_CALLBACK_FALLBACK_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>返回皮皮课堂</title>
  <link rel="stylesheet" href="${BAIDU_CALLBACK_STYLES_PATH}">
</head>
<body>
  <main class="card">
    <div class="mascot" aria-hidden="true">🦜</div>
    <p class="eyebrow">百度网盘授权完成</p>
    <h1>回到皮皮课堂</h1>
    <p class="hint">这部手机没有自动切回应用，请点击下面的按钮继续。</p>
    <a id="open-app" class="button" href="#" aria-disabled="true">返回皮皮课堂</a>
    <p class="privacy">授权码只会交给本机的皮皮课堂，不会保存在这个页面。</p>
  </main>
  <script src="${BAIDU_CALLBACK_SCRIPT_PATH}" defer></script>
</body>
</html>`;

// The response remains byte-for-byte static: OAuth values are read from the browser address only
// and encoded into an Android package-scoped intent after the page has loaded. They never enter
// this service's rendered HTML, logs, storage, or asset requests.
const BAIDU_CALLBACK_RETURN_SCRIPT = `(() => {
  "use strict";
  const button = document.getElementById("open-app");
  if (!(button instanceof HTMLAnchorElement)) return;
  const query = new URLSearchParams(window.location.search).toString();
  const suffix = query.length > 0 ? "?" + query : "";
  button.href = "intent://oauth/baidu/callback" + suffix +
    "#Intent;scheme=pipiclassroom;package=com.pipiclassroom.app;end";
  button.removeAttribute("aria-disabled");
})();`;

const BAIDU_CALLBACK_RETURN_STYLES = `:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, "Noto Sans SC", sans-serif;
  background: #fffaf7;
  color: #10192d;
}
* { box-sizing: border-box; }
body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(circle at top, #fff1e8 0, #fffaf7 48%);
}
.card {
  width: min(100%, 430px);
  padding: 36px 28px 30px;
  border: 1px solid #f6dfd0;
  border-radius: 32px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(76, 46, 30, .10);
  text-align: center;
}
.mascot { font-size: 58px; line-height: 1; }
.eyebrow {
  margin: 20px 0 8px;
  color: #c65426;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: .08em;
}
h1 { margin: 0; font-size: 32px; line-height: 1.25; }
.hint { margin: 16px auto 26px; color: #68738a; line-height: 1.7; }
.button {
  display: block;
  width: 100%;
  padding: 16px 20px;
  border-radius: 18px;
  background: #ff7a3d;
  color: #fff;
  font-size: 18px;
  font-weight: 800;
  text-decoration: none;
  box-shadow: 0 8px 18px rgba(255, 122, 61, .24);
}
.button[aria-disabled="true"] { opacity: .55; pointer-events: none; }
.privacy { margin: 20px 4px 0; color: #8992a4; font-size: 12px; line-height: 1.6; }
`;

const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  Expires: "0",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
});

export interface Env {
  BAIDU_CLIENT_ID?: string;
  BAIDU_CLIENT_SECRET?: string;
  BAIDU_REDIRECT_URI?: string;
  BUILD_REVISION?: string;
  TOKEN_EXCHANGE_ENABLED?: string;
  TOKEN_IP_RATE_LIMITER?: RateLimitBinding;
  TOKEN_APP_RATE_LIMITER?: RateLimitBinding;
}

export interface RateLimitBinding {
  limit(options: Readonly<{ key: string }>): Promise<Readonly<{ success: boolean }>>;
}

interface BrokerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface RateLimitBindings {
  app: RateLimitBinding;
  ip: RateLimitBinding;
}

interface AuthorizationCodeRequest {
  grant_type: "authorization_code";
  code: string;
}

interface RefreshTokenRequest {
  grant_type: "refresh_token";
  refresh_token: string;
}

interface DeviceTokenRequest { grant_type: "device_token"; code: string; }
interface DeviceCodeRequest { grant_type: "device_code"; }
type TokenRequest = AuthorizationCodeRequest | RefreshTokenRequest | DeviceTokenRequest | DeviceCodeRequest;
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface AppOptions {
  /** Test seam for a mocked upstream. Production uses globalThis.fetch. */
  fetchImpl?: FetchLike;
  /** Test seam for fast timeout tests. Production uses eight seconds. */
  upstreamTimeoutMs?: number;
}

export interface BrokerApp {
  fetch(request: Request, env: Env): Promise<Response>;
}

class BodyTooLargeError extends Error {}
class InvalidUtf8Error extends Error {}

function jsonResponse(
  body: Readonly<Record<string, unknown>>,
  status = 200,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", "application/json; charset=utf-8");

  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function htmlResponse(
  body: string,
  status = 200,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", "text/html; charset=utf-8");
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(body, { status, headers });
}

function staticAssetResponse(body: string, contentType: string): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", contentType);
  return new Response(body, { status: 200, headers });
}

function errorResponse(
  status: number,
  error: string,
  message: string,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  return jsonResponse({ error, message }, status, extraHeaders);
}

function headResponse(response: Response): Response {
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }

  return /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
    contentType,
  );
}

function hasOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(record, key))
  );
}

function isOpaqueCredential(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function parseTokenRequest(value: unknown): TokenRequest | null {
  if (!isRecord(value) || typeof value["grant_type"] !== "string") {
    return null;
  }

  if (value["grant_type"] === "device_token") {
    return hasOnlyKeys(value, ["grant_type", "code"]) && isOpaqueCredential(value["code"], MAX_CODE_LENGTH)
      ? { grant_type: "device_token", code: value["code"] } : null;
  }

  if (value["grant_type"] === "authorization_code") {
    if (
      !hasOnlyKeys(value, ["grant_type", "code"]) ||
      !isOpaqueCredential(value["code"], MAX_CODE_LENGTH)
    ) {
      return null;
    }

    return {
      grant_type: "authorization_code",
      code: value["code"],
    };
  }

  if (value["grant_type"] === "refresh_token") {
    if (
      !hasOnlyKeys(value, ["grant_type", "refresh_token"]) ||
      !isOpaqueCredential(value["refresh_token"], MAX_REFRESH_TOKEN_LENGTH)
    ) {
      return null;
    }

    return {
      grant_type: "refresh_token",
      refresh_token: value["refresh_token"],
    };
  }

  return null;
}

async function readLimitedUtf8(
  stream: ReadableStream<Uint8Array> | null,
  contentLengthHeader: string | null,
  maxBytes: number,
): Promise<string> {
  if (contentLengthHeader !== null && /^\d+$/u.test(contentLengthHeader)) {
    const declaredLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      throw new BodyTooLargeError();
    }
  }

  if (stream === null) {
    return "";
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best effort. Nothing from the error is logged.
        }
        throw new BodyTooLargeError();
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return text;
  } catch (error: unknown) {
    if (error instanceof BodyTooLargeError) {
      throw error;
    }
    throw new InvalidUtf8Error();
  } finally {
    reader.releaseLock();
  }
}

async function readClientPayload(request: Request): Promise<unknown> {
  const text = await readLimitedUtf8(
    request.body,
    request.headers.get("Content-Length"),
    MAX_REQUEST_BODY_BYTES,
  );

  if (text.length === 0) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

function parseConfig(env: Env): BrokerConfig | null {
  const clientId = env.BAIDU_CLIENT_ID;
  const clientSecret = env.BAIDU_CLIENT_SECRET;
  const redirectUri = env.BAIDU_REDIRECT_URI;

  if (
    !isOpaqueCredential(clientId, MAX_CREDENTIAL_LENGTH) ||
    !isOpaqueCredential(clientSecret, MAX_CREDENTIAL_LENGTH) ||
    typeof redirectUri !== "string" ||
    redirectUri.length === 0 ||
    redirectUri.length > MAX_CREDENTIAL_LENGTH ||
    redirectUri.trim() !== redirectUri ||
    /[\u0000-\u001f\u007f]/u.test(redirectUri)
  ) {
    return null;
  }

  if (redirectUri !== "oob") {
    try {
      const parsedRedirect = new URL(redirectUri);
      if (parsedRedirect.protocol !== "https:" && parsedRedirect.protocol !== "http:") {
        return null;
      }
    } catch {
      return null;
    }
  }

  return { clientId, clientSecret, redirectUri };
}

function parseBuildRevision(env: Env): string | null {
  const revision = env.BUILD_REVISION;
  if (
    typeof revision !== "string" ||
    revision.length === 0 ||
    revision.length > MAX_BUILD_REVISION_LENGTH ||
    !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/u.test(revision)
  ) {
    return null;
  }

  return revision;
}

function concatenateBytes(
  parts: readonly Uint8Array<ArrayBufferLike>[],
): Uint8Array<ArrayBuffer> {
  const byteLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const result: Uint8Array<ArrayBuffer> = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

/**
 * Returns a stable, non-secret identifier for the exact OAuth client ID and
 * redirect URI. Length-prefixed UTF-8 fields make the input unambiguous and
 * keep this algorithm straightforward to reproduce in release tooling.
 */
export async function oauthCoordinateFingerprint(
  clientId: string,
  redirectUri: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const clientIdBytes = encoder.encode(clientId);
  const redirectUriBytes = encoder.encode(redirectUri);
  const payload = concatenateBytes([
    encoder.encode(OAUTH_COORDINATE_FINGERPRINT_PREFIX),
    encoder.encode(`${clientIdBytes.byteLength}:`),
    clientIdBytes,
    encoder.encode(","),
    encoder.encode(`${redirectUriBytes.byteLength}:`),
    redirectUriBytes,
    encoder.encode(","),
  ]);
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", payload),
  );
  const hexadecimal = Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hexadecimal}`;
}

function isRateLimitBinding(value: unknown): value is RateLimitBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "limit") === "function"
  );
}

function parseRateLimitBindings(env: Env): RateLimitBindings | null {
  if (
    !isRateLimitBinding(env.TOKEN_IP_RATE_LIMITER) ||
    !isRateLimitBinding(env.TOKEN_APP_RATE_LIMITER)
  ) {
    return null;
  }

  return {
    app: env.TOKEN_APP_RATE_LIMITER,
    ip: env.TOKEN_IP_RATE_LIMITER,
  };
}

function isRateLimitResult(value: unknown): value is Readonly<{ success: boolean }> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "success") === "boolean"
  );
}

function connectingIp(request: Request): string | null {
  const value = request.headers.get("CF-Connecting-IP");
  if (
    value === null ||
    value.length === 0 ||
    value.length > 64 ||
    value.trim() !== value ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    return null;
  }

  return value;
}

function unavailableResponse(): Response {
  return errorResponse(
    503,
    "service_unavailable",
    "OAuth service configuration is unavailable.",
    { "Retry-After": "60" },
  );
}

/** Only the exact environment string `true` opens the token-exchange path. */
export function isTokenExchangeEnabled(env: Env): boolean {
  return env.TOKEN_EXCHANGE_ENABLED === "true";
}

/** Shared fail-closed response used before a token request body is consumed. */
export function tokenExchangeDisabledResponse(): Response {
  return unavailableResponse();
}

async function enforceRateLimits(
  request: Request,
  bindings: RateLimitBindings,
): Promise<Response | null> {
  const ip = connectingIp(request);
  if (ip === null) {
    // A production Worker route is Cloudflare-fronted and therefore always has
    // this platform-owned header. Do not fall back to a spoofable forwarding header.
    return unavailableResponse();
  }

  try {
    // Check the narrow bucket first so one abusive source cannot consume the
    // whole app bucket after its own allowance has already been exhausted.
    const ipResult: unknown = await bindings.ip.limit({ key: `ip:${ip}` });
    if (!isRateLimitResult(ipResult)) {
      return unavailableResponse();
    }
    if (!ipResult.success) {
      return errorResponse(
        429,
        "rate_limited",
        "Too many token requests. Try again later.",
        { "Retry-After": "60" },
      );
    }

    // This namespace belongs to one fixed Baidu client configuration. Its
    // constant key caps aggregate traffic per Cloudflare location.
    const appResult: unknown = await bindings.app.limit({
      key: "baidu-token-broker:v1",
    });
    if (!isRateLimitResult(appResult)) {
      return unavailableResponse();
    }
    if (!appResult.success) {
      return errorResponse(
        429,
        "rate_limited",
        "Too many token requests. Try again later.",
        { "Retry-After": "60" },
      );
    }
  } catch {
    // A broken or unavailable protection binding must never fail open.
    return unavailableResponse();
  }

  return null;
}

function buildUpstreamUrl(
  request: TokenRequest,
  config: BrokerConfig,
): URL {
  if (request.grant_type === "device_code") {
    const url = new URL("https://openapi.baidu.com/oauth/2.0/device/code");
    url.searchParams.set("response_type", "device_code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("scope", "basic,netdisk");
    return url;
  }
  const url = new URL(BAIDU_TOKEN_ENDPOINT);
  url.searchParams.set("grant_type", request.grant_type);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("client_secret", config.clientSecret);

  if (request.grant_type === "authorization_code") {
    url.searchParams.set("code", request.code);
    url.searchParams.set("redirect_uri", config.redirectUri);
  } else if (request.grant_type === "device_token") {
    url.searchParams.set("code", request.code);
  } else {
    url.searchParams.set("refresh_token", request.refresh_token);
  }

  return url;
}

function isValidExpiresIn(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function sanitizeSuccessfulTokenResponse(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    !isOpaqueCredential(value["access_token"], MAX_REFRESH_TOKEN_LENGTH) ||
    !isOpaqueCredential(value["refresh_token"], MAX_REFRESH_TOKEN_LENGTH) ||
    !isValidExpiresIn(value["expires_in"])
  ) {
    return null;
  }

  const response: Record<string, unknown> = {
    access_token: value["access_token"],
    expires_in: value["expires_in"],
    refresh_token: value["refresh_token"],
  };

  if (Object.hasOwn(value, "scope")) {
    const scope = value["scope"];
    if (
      typeof scope !== "string" ||
      scope.length === 0 ||
      scope.length > MAX_CREDENTIAL_LENGTH ||
      scope.trim() !== scope ||
      /[\u0000-\u001f\u007f]/u.test(scope)
    ) {
      return null;
    }
    response["scope"] = scope;
  }

  if (Object.hasOwn(value, "token_type")) {
    const tokenType = value["token_type"];
    if (
      typeof tokenType !== "string" ||
      tokenType.length === 0 ||
      tokenType.length > 64 ||
      !/^[A-Za-z][A-Za-z0-9._~-]*$/u.test(tokenType)
    ) {
      return null;
    }
    response["token_type"] = tokenType;
  }

  return response;
}

function sanitizeDeviceCodeResponse(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isOpaqueCredential(value["device_code"], MAX_CODE_LENGTH) ||
      !isOpaqueCredential(value["user_code"], 128) || !isValidExpiresIn(value["expires_in"]) ||
      value["expires_in"] > 3600 || !isValidExpiresIn(value["interval"]) || value["interval"] > 120) return null;
  try {
    const verification = new URL(String(value["verification_url"]));
    const qr = new URL(String(value["qrcode_url"]));
    if ([verification, qr].some(url => url.protocol !== "https:" || url.hostname !== "openapi.baidu.com" ||
        url.username || url.password || url.port || url.hash) || verification.pathname !== "/device" ||
        !qr.pathname.startsWith("/device/qrcode/")) return null;
    return { device_code: value["device_code"], user_code: value["user_code"],
      verification_url: verification.href, qrcode_url: qr.href,
      expires_in: value["expires_in"], interval: Math.max(10, value["interval"]) };
  } catch { return null; }
}

function providerErrorResponse(
  value: unknown,
  upstreamStatus: number,
  tokenRequest: TokenRequest,
): Response {
  const providerError =
    isRecord(value) && typeof value["error"] === "string"
      ? value["error"].toLowerCase()
      : "";
  const providerDescription =
    isRecord(value) && typeof value["error_description"] === "string"
      ? value["error_description"].trim().toLowerCase()
      : "";

  if (tokenRequest.grant_type === "device_token" &&
      ["authorization_pending", "slow_down", "authorization_declined", "access_denied", "expired_token"].includes(providerError)) {
    return errorResponse(400, providerError, "Device authorization is pending, denied, or expired.");
  }

  if (providerError === "invalid_grant") {
    return errorResponse(
      400,
      "invalid_grant",
      "The authorization code or refresh token is invalid or expired.",
    );
  }

  if (providerError === "expired_token") {
    return errorResponse(
      400,
      "expired_token",
      "The refresh token is expired or can no longer be used.",
    );
  }

  if (
    providerError === "invalid_request" &&
    tokenRequest.grant_type === "refresh_token" &&
    /^invalid\s+refresh\s+token(?:\b|:)/u.test(providerDescription)
  ) {
    // Baidu documents this provider-specific combination for an unusable
    // refresh token. Scope the mapping to both grant and description so a
    // different invalid_request (for example a provider/config regression)
    // remains an operational failure instead of signing the user out.
    return errorResponse(
      400,
      "invalid_grant",
      "The refresh token is invalid or can no longer be used.",
    );
  }

  if (providerError === "temporarily_unavailable" || upstreamStatus === 503) {
    return errorResponse(
      503,
      "oauth_provider_unavailable",
      "The OAuth provider is temporarily unavailable.",
      { "Retry-After": "5" },
    );
  }

  return errorResponse(
    502,
    "oauth_provider_error",
    "The OAuth provider rejected the token request.",
  );
}

async function requestBaiduToken(
  tokenRequest: TokenRequest,
  config: BrokerConfig,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstreamResponse = await fetchImpl(
      buildUpstreamUrl(tokenRequest, config),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      },
    );

    const upstreamText = await readLimitedUtf8(
      upstreamResponse.body,
      upstreamResponse.headers.get("Content-Length"),
      MAX_UPSTREAM_BODY_BYTES,
    );

    let upstreamValue: unknown;
    try {
      upstreamValue = JSON.parse(upstreamText) as unknown;
    } catch {
      return errorResponse(
        502,
        "invalid_provider_response",
        "The OAuth provider returned an invalid response.",
      );
    }

    if (
      !upstreamResponse.ok ||
      (isRecord(upstreamValue) && Object.hasOwn(upstreamValue, "error"))
    ) {
      return providerErrorResponse(
        upstreamValue,
        upstreamResponse.status,
        tokenRequest,
      );
    }

    const sanitizedResponse = tokenRequest.grant_type === "device_code"
      ? sanitizeDeviceCodeResponse(upstreamValue) : sanitizeSuccessfulTokenResponse(upstreamValue);
    if (sanitizedResponse === null) {
      return errorResponse(
        502,
        "invalid_provider_response",
        "The OAuth provider returned an invalid response.",
      );
    }

    return jsonResponse(sanitizedResponse);
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      return errorResponse(
        504,
        "oauth_provider_timeout",
        "The OAuth provider did not respond in time.",
      );
    }

    if (error instanceof BodyTooLargeError || error instanceof InvalidUtf8Error) {
      return errorResponse(
        502,
        "invalid_provider_response",
        "The OAuth provider returned an invalid response.",
      );
    }

    return errorResponse(
      502,
      "oauth_provider_unreachable",
      "The OAuth provider could not be reached.",
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function createApp(options: AppOptions = {}): BrokerApp {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("upstreamTimeoutMs must be a positive integer");
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/healthz") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return errorResponse(
            405,
            "method_not_allowed",
            "Only GET and HEAD are allowed for this endpoint.",
            { Allow: "GET, HEAD" },
          );
        }

        if (url.search.length > 0) {
          return errorResponse(
            400,
            "query_not_allowed",
            "Query parameters are not accepted.",
          );
        }

        if (request.method === "HEAD") {
          return headResponse(jsonResponse({ status: "ok" }));
        }

        return jsonResponse({ status: "ok" });
      }

      if (url.pathname === BAIDU_CALLBACK_PATH) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return errorResponse(
            405,
            "method_not_allowed",
            "Only GET and HEAD are allowed for this endpoint.",
            { Allow: "GET, HEAD" },
          );
        }

        // The Android SDK normally intercepts this redirect before the network
        // request. If a browser reaches the fallback, never parse, exchange, or
        // reflect its one-time code/state query values.
        const response = htmlResponse(BAIDU_CALLBACK_FALLBACK_HTML, 200, {
          "Content-Security-Policy":
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; " +
            "form-action 'none'; script-src 'self'; style-src 'self'",
        });
        return request.method === "HEAD" ? headResponse(response) : response;
      }

      if (
        url.pathname === BAIDU_CALLBACK_SCRIPT_PATH ||
        url.pathname === BAIDU_CALLBACK_STYLES_PATH
      ) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return errorResponse(
            405,
            "method_not_allowed",
            "Only GET and HEAD are allowed for this endpoint.",
            { Allow: "GET, HEAD" },
          );
        }
        if (url.search.length > 0) {
          return errorResponse(
            400,
            "query_not_allowed",
            "Query parameters are not accepted.",
          );
        }
        const response = url.pathname === BAIDU_CALLBACK_SCRIPT_PATH
          ? staticAssetResponse(
            BAIDU_CALLBACK_RETURN_SCRIPT,
            "application/javascript; charset=utf-8",
          )
          : staticAssetResponse(
            BAIDU_CALLBACK_RETURN_STYLES,
            "text/css; charset=utf-8",
          );
        return request.method === "HEAD" ? headResponse(response) : response;
      }

      if (url.pathname === "/readyz") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return errorResponse(
            405,
            "method_not_allowed",
            "Only GET and HEAD are allowed for this endpoint.",
            { Allow: "GET, HEAD" },
          );
        }

        if (url.search.length > 0) {
          return errorResponse(
            400,
            "query_not_allowed",
            "Query parameters are not accepted.",
          );
        }

        const enabled = isTokenExchangeEnabled(env);
        const config = enabled ? parseConfig(env) : null;
        const revision = enabled ? parseBuildRevision(env) : null;
        const rateLimitBindings = enabled ? parseRateLimitBindings(env) : null;
        let fingerprint: string | null = null;
        if (config !== null && revision !== null && rateLimitBindings !== null) {
          try {
            fingerprint = await oauthCoordinateFingerprint(
              config.clientId,
              config.redirectUri,
            );
          } catch {
            // Cryptographic metadata is part of the readiness contract. If it
            // cannot be computed, fail closed without exposing exception text.
          }
        }

        const response =
          fingerprint !== null && revision !== null
            ? jsonResponse({
                status: "ready",
                oauth_coordinate_fingerprint: fingerprint,
                build_revision: revision,
              })
            : jsonResponse(
                { status: "not_ready" },
                503,
                { "Retry-After": "60" },
              );
        return request.method === "HEAD" ? headResponse(response) : response;
      }

      const deviceCode = url.pathname === "/oauth/device/code";
      if (url.pathname !== "/oauth/token" && !deviceCode) {
        return errorResponse(404, "not_found", "Endpoint not found.");
      }

      // This permanent kill switch is deliberately checked before method,
      // query, content-type, body parsing, rate limiting, or upstream access.
      // Every value except the exact string `true` fails closed.
      if (!isTokenExchangeEnabled(env)) {
        return tokenExchangeDisabledResponse();
      }

      if (request.method !== "POST") {
        return errorResponse(
          405,
          "method_not_allowed",
          "Only POST is allowed for this endpoint.",
          { Allow: "POST" },
        );
      }

      if (url.search.length > 0) {
        return errorResponse(
          400,
          "query_not_allowed",
          "Query parameters are not accepted; send credentials in the JSON body.",
        );
      }

      if (!isJsonContentType(request.headers.get("Content-Type"))) {
        return errorResponse(
          415,
          "unsupported_media_type",
          "Content-Type must be application/json with UTF-8 encoding.",
        );
      }

      let rawPayload: unknown;
      try {
        rawPayload = await readClientPayload(request);
      } catch (error: unknown) {
        if (error instanceof BodyTooLargeError) {
          return errorResponse(
            413,
            "payload_too_large",
            "Request body is too large.",
          );
        }

        return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
      }

      const tokenRequest: TokenRequest | null = deviceCode
        ? isRecord(rawPayload) && Object.keys(rawPayload).length === 0 ? { grant_type: "device_code" } : null
        : parseTokenRequest(rawPayload);
      if (tokenRequest === null) {
        return errorResponse(
          400,
          "invalid_request",
          "Request body does not match a supported token grant schema.",
        );
      }

      const config = parseConfig(env);
      const rateLimitBindings = parseRateLimitBindings(env);
      if (config === null || rateLimitBindings === null) {
        return unavailableResponse();
      }

      const rateLimitResponse = await enforceRateLimits(
        request,
        rateLimitBindings,
      );
      if (rateLimitResponse !== null) {
        return rateLimitResponse;
      }

      return requestBaiduToken(
        tokenRequest,
        config,
        fetchImpl,
        timeoutMs,
      );
    },
  };
}

export default createApp();
