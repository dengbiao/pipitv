/// <reference types="node" />

/**
 * Hardened Node.js adapter for the platform-neutral broker application.
 *
 * The dedicated reverse-proxy ingress is the only production peer. It
 * overwrites X-Broker-Client-IP with the socket peer IP; every conventional
 * forwarding header supplied by a client is ignored here. The current VPS
 * uses Nginx, while the standalone-port deployment keeps Caddy as an option.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  closeSync,
  constants as fileSystemConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createApp,
  isTokenExchangeEnabled,
  tokenExchangeDisabledResponse,
  type BrokerApp,
  type Env,
  type RateLimitBinding,
} from "./index.js";

export const CADDY_CLIENT_IP_HEADER = "x-broker-client-ip";
export const IP_RATE_LIMIT = 10;
export const APP_RATE_LIMIT = 120;
export const RATE_LIMIT_WINDOW_MS = 60_000;

const IP_RATE_LIMIT_CAPACITY = 4_096;
const APP_RATE_LIMIT_CAPACITY = 1;
const MAX_RATE_LIMIT_KEY_LENGTH = 128;

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_HEADER_COUNT = 64;
const MAX_REQUEST_TARGET_LENGTH = 4_096;
const HEADERS_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
const HANDLER_TIMEOUT_MS = 15_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 20_000;
const MAX_REQUESTS_PER_SOCKET = 100;
const GRACEFUL_SHUTDOWN_MS = 10_000;
const MAX_CLIENT_SECRET_BYTES = 4_098;
const MAX_SECRET_FILE_PATH_LENGTH = 4_096;

const IGNORED_PROXY_HEADERS = new Set([
  "cf-connecting-ip",
  "forwarded",
  "x-forwarded-for",
  "x-real-ip",
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const ADAPTER_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

type Clock = () => number;

export interface FixedWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
  capacity: number;
  now?: Clock;
}

/**
 * A process-local, globally aligned fixed-window limiter with a hard key cap.
 * New keys are denied when the cap is full; active entries are never evicted
 * to make an abusive source fail open.
 */
export class FixedWindowRateLimiter implements RateLimitBinding {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #capacity: number;
  readonly #now: Clock;
  readonly #counts = new Map<string, number>();
  #windowId: number | null = null;

  constructor(options: FixedWindowRateLimiterOptions) {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit <= 0 ||
      !Number.isSafeInteger(options.windowMs) ||
      options.windowMs <= 0 ||
      !Number.isSafeInteger(options.capacity) ||
      options.capacity <= 0 ||
      (options.now !== undefined && typeof options.now !== "function")
    ) {
      throw new TypeError("Invalid fixed-window rate limiter options");
    }

    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#capacity = options.capacity;
    this.#now = options.now ?? Date.now;
  }

  get entryCount(): number {
    return this.#counts.size;
  }

  async limit(options: Readonly<{ key: string }>): Promise<Readonly<{ success: boolean }>> {
    try {
      const key = options.key;
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > MAX_RATE_LIMIT_KEY_LENGTH ||
        /[\u0000-\u0020\u007f]/u.test(key)
      ) {
        return { success: false };
      }

      const now = this.#now();
      if (!Number.isSafeInteger(now) || now < 0) {
        return { success: false };
      }

      const windowId = Math.floor(now / this.#windowMs);
      if (this.#windowId !== null && windowId < this.#windowId) {
        return { success: false };
      }
      if (windowId !== this.#windowId) {
        this.#counts.clear();
        this.#windowId = windowId;
      }

      const count = this.#counts.get(key);
      if (count === undefined) {
        if (this.#counts.size >= this.#capacity) {
          return { success: false };
        }
        this.#counts.set(key, 1);
        return { success: true };
      }

      if (count >= this.#limit) {
        return { success: false };
      }

      this.#counts.set(key, count + 1);
      return { success: true };
    } catch {
      return { success: false };
    }
  }
}

export interface NodeServerOptions {
  app?: BrokerApp;
  env?: Env;
  processEnv?: NodeJS.ProcessEnv;
  now?: Clock;
  handlerTimeoutMs?: number;
}

class RequestBodyTooLargeError extends Error {}
class RequestDeadlineError extends Error {}
class InvalidSecretFileError extends Error {}

function adapterErrorResponse(
  response: ServerResponse,
  status: number,
  error: string,
  message: string,
  closeConnection = false,
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  if (closeConnection) {
    response.shouldKeepAlive = false;
    response.setHeader("Connection", "close");
  }

  response.writeHead(status, ADAPTER_RESPONSE_HEADERS);
  response.end(JSON.stringify({ error, message }));
}

function trustedClientIp(request: IncomingMessage): string | null {
  const values: string[] = [];

  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (
      name !== undefined &&
      value !== undefined &&
      name.toLowerCase() === CADDY_CLIENT_IP_HEADER
    ) {
      values.push(value);
    }
  }

  if (values.length !== 1) {
    return null;
  }

  const value = values[0];
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > 45 ||
    isIP(value) === 0
  ) {
    return null;
  }

  return value;
}

function webHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [rawName, rawValue] of Object.entries(request.headers)) {
    const name = rawName.toLowerCase();
    if (
      name === CADDY_CLIENT_IP_HEADER ||
      name === "host" ||
      IGNORED_PROXY_HEADERS.has(name) ||
      HOP_BY_HOP_HEADERS.has(name) ||
      rawValue === undefined
    ) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        headers.append(name, value);
      }
    } else {
      headers.set(name, rawValue);
    }
  }

  const clientIp = trustedClientIp(request);
  if (clientIp !== null) {
    headers.set("CF-Connecting-IP", clientIp);
  }

  return headers;
}

function requestBody(
  request: IncomingMessage,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
      request.off("error", onError);
      signal.removeEventListener("abort", onDeadline);

      if (error !== undefined) {
        request.pause();
        reject(error);
        return;
      }

      const body = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(body);
    };

    const onData = (chunk: Buffer): void => {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_REQUEST_BODY_BYTES) {
        finish(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => finish();
    const onAborted = (): void => finish(new RequestDeadlineError());
    const onError = (): void => finish(new RequestDeadlineError());
    const onDeadline = (): void => finish(new RequestDeadlineError());

    const declaredLength = request.headers["content-length"];
    if (declaredLength !== undefined) {
      if (!/^\d+$/u.test(declaredLength)) {
        finish(new RequestBodyTooLargeError());
        return;
      }
      const parsedLength = Number(declaredLength);
      if (
        !Number.isSafeInteger(parsedLength) ||
        parsedLength > MAX_REQUEST_BODY_BYTES
      ) {
        finish(new RequestBodyTooLargeError());
        return;
      }
    }

    if (signal.aborted) {
      finish(new RequestDeadlineError());
      return;
    }

    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
    signal.addEventListener("abort", onDeadline, { once: true });
  });
}

function bodyArrayBuffer(body: Uint8Array): ArrayBuffer | undefined {
  if (body.byteLength === 0) {
    return undefined;
  }

  return body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  ) as ArrayBuffer;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new RequestDeadlineError());
    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        reject(new Error("Broker request failed"));
      },
    );
  });
}

async function writeWebResponse(
  source: Response,
  destination: ServerResponse,
): Promise<void> {
  if (destination.destroyed || destination.writableEnded) {
    return;
  }

  const headers: Record<string, string> = {};
  source.headers.forEach((value, name) => {
    headers[name] = value;
  });

  const body = new Uint8Array(await source.arrayBuffer());
  if (destination.destroyed || destination.writableEnded) {
    return;
  }

  destination.writeHead(source.status, headers);
  destination.end(body);
}

function invalidSecretFile(): Error {
  return new InvalidSecretFileError("Invalid BAIDU_CLIENT_SECRET_FILE");
}

function readClientSecretFile(filePath: string): string {
  if (
    filePath.length === 0 ||
    filePath.length > MAX_SECRET_FILE_PATH_LENGTH ||
    filePath.trim() !== filePath ||
    !isAbsolute(filePath) ||
    /[\u0000-\u001f\u007f]/u.test(filePath)
  ) {
    throw invalidSecretFile();
  }

  let descriptor: number | undefined;
  try {
    const pathStats = lstatSync(filePath);
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
      throw invalidSecretFile();
    }

    descriptor = openSync(
      filePath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    );
    const stats = fstatSync(descriptor);
    if (
      !stats.isFile() ||
      stats.dev !== pathStats.dev ||
      stats.ino !== pathStats.ino ||
      stats.size <= 0 ||
      stats.size > MAX_CLIENT_SECRET_BYTES
    ) {
      throw invalidSecretFile();
    }

    const permissions = stats.mode & 0o7777;
    const effectiveUserId = process.geteuid?.();
    const isProductionMount =
      stats.uid === 0 &&
      permissions === 0o444;
    const isPrivateLocalFile =
      effectiveUserId !== undefined &&
      stats.uid === effectiveUserId &&
      (permissions === 0o400 || permissions === 0o600);
    if (!isProductionMount && !isPrivateLocalFile) {
      throw invalidSecretFile();
    }

    const bytes = readFileSync(descriptor);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CLIENT_SECRET_BYTES) {
      throw invalidSecretFile();
    }
    let secret: string;
    try {
      secret = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw invalidSecretFile();
    }

    if (secret.endsWith("\r\n")) {
      secret = secret.slice(0, -2);
    } else if (secret.endsWith("\n")) {
      secret = secret.slice(0, -1);
    }
    if (
      secret.length === 0 ||
      secret.length > 4_096 ||
      secret.trim() !== secret ||
      /[\u0000-\u001f\u007f]/u.test(secret)
    ) {
      throw invalidSecretFile();
    }

    return secret;
  } catch (error: unknown) {
    if (error instanceof InvalidSecretFileError) {
      throw error;
    }
    throw invalidSecretFile();
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function clientSecret(source: NodeJS.ProcessEnv): string | undefined {
  const inlineSecret = source["BAIDU_CLIENT_SECRET"];
  const secretFile = source["BAIDU_CLIENT_SECRET_FILE"];
  if (inlineSecret !== undefined && secretFile !== undefined) {
    throw new Error(
      "BAIDU_CLIENT_SECRET and BAIDU_CLIENT_SECRET_FILE cannot both be set",
    );
  }
  if (secretFile !== undefined) {
    return readClientSecretFile(secretFile);
  }
  return inlineSecret;
}

function makeRuntimeEnv(source: NodeJS.ProcessEnv, now: Clock): Env {
  const env: Env = {
    TOKEN_IP_RATE_LIMITER: new FixedWindowRateLimiter({
      limit: IP_RATE_LIMIT,
      windowMs: RATE_LIMIT_WINDOW_MS,
      capacity: IP_RATE_LIMIT_CAPACITY,
      now,
    }),
    TOKEN_APP_RATE_LIMITER: new FixedWindowRateLimiter({
      limit: APP_RATE_LIMIT,
      windowMs: RATE_LIMIT_WINDOW_MS,
      capacity: APP_RATE_LIMIT_CAPACITY,
      now,
    }),
  };

  if (source["BAIDU_CLIENT_ID"] !== undefined) {
    env.BAIDU_CLIENT_ID = source["BAIDU_CLIENT_ID"];
  }
  if (source["TOKEN_EXCHANGE_ENABLED"] !== undefined) {
    env.TOKEN_EXCHANGE_ENABLED = source["TOKEN_EXCHANGE_ENABLED"];
  }
  // A disabled deployment may mount an empty placeholder. Do not open or
  // validate any secret source until the exact opt-in value enables exchange.
  if (isTokenExchangeEnabled(env)) {
    const resolvedClientSecret = clientSecret(source);
    if (resolvedClientSecret !== undefined) {
      env.BAIDU_CLIENT_SECRET = resolvedClientSecret;
    }
  }
  if (source["BAIDU_REDIRECT_URI"] !== undefined) {
    env.BAIDU_REDIRECT_URI = source["BAIDU_REDIRECT_URI"];
  }
  if (source["BUILD_REVISION"] !== undefined) {
    env.BUILD_REVISION = source["BUILD_REVISION"];
  }

  return env;
}

function validatePositiveTimeout(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("handlerTimeoutMs must be a positive integer");
  }
}

export function createNodeServer(options: NodeServerOptions = {}): Server {
  const app = options.app ?? createApp();
  const now = options.now ?? Date.now;
  const env = options.env ?? makeRuntimeEnv(options.processEnv ?? process.env, now);
  const handlerTimeoutMs = options.handlerTimeoutMs ?? HANDLER_TIMEOUT_MS;
  validatePositiveTimeout(handlerTimeoutMs);

  const server = createServer(
    {
      headersTimeout: HEADERS_TIMEOUT_MS,
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
      maxHeaderSize: MAX_HEADER_BYTES,
      requestTimeout: REQUEST_TIMEOUT_MS,
    },
    (request, response) => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), handlerTimeoutMs);
      let bodyComplete = false;

      const abortForDisconnect = (): void => {
        if (!response.writableFinished) {
          controller.abort();
        }
      };
      request.once("aborted", abortForDisconnect);
      response.once("close", abortForDisconnect);

      const handle = async (): Promise<void> => {
        try {
          if (
            request.rawHeaders.length / 2 > MAX_HEADER_COUNT ||
            (request.url?.length ?? 0) > MAX_REQUEST_TARGET_LENGTH
          ) {
            const status =
              request.rawHeaders.length / 2 > MAX_HEADER_COUNT ? 431 : 414;
            adapterErrorResponse(
              response,
              status,
              status === 431 ? "request_headers_too_large" : "uri_too_long",
              "The request exceeds the server limits.",
              true,
            );
            return;
          }

          const url = new URL(request.url ?? "/", "http://broker.internal");

          // Fail before attaching request-body listeners. Closing keep-alive
          // prevents an unread request body from being reused as a new request.
          if (
            (url.pathname === "/oauth/token" || url.pathname === "/oauth/device/code") &&
            !isTokenExchangeEnabled(env)
          ) {
            request.pause();
            response.shouldKeepAlive = false;
            response.setHeader("Connection", "close");
            await abortable(
              writeWebResponse(tokenExchangeDisabledResponse(), response),
              controller.signal,
            );
            return;
          }

          const body = await requestBody(request, controller.signal);
          bodyComplete = true;
          const init: RequestInit = {
            headers: webHeaders(request),
            method: request.method ?? "GET",
            signal: controller.signal,
          };
          const bufferedBody = bodyArrayBuffer(body);
          if (
            bufferedBody !== undefined &&
            init.method !== "GET" &&
            init.method !== "HEAD"
          ) {
            init.body = bufferedBody;
          }

          const result = await abortable(
            app.fetch(new Request(url, init), env),
            controller.signal,
          );
          await abortable(
            writeWebResponse(result, response),
            controller.signal,
          );
        } catch (error: unknown) {
          if (error instanceof RequestBodyTooLargeError) {
            adapterErrorResponse(
              response,
              413,
              "payload_too_large",
              "Request body is too large.",
              true,
            );
            return;
          }

          if (error instanceof RequestDeadlineError) {
            adapterErrorResponse(
              response,
              bodyComplete ? 504 : 408,
              bodyComplete ? "request_timeout" : "request_body_timeout",
              "The request did not complete in time.",
              true,
            );
            return;
          }

          adapterErrorResponse(
            response,
            503,
            "service_unavailable",
            "The service is temporarily unavailable.",
            true,
          );
        } finally {
          clearTimeout(deadline);
          request.off("aborted", abortForDisconnect);
          response.off("close", abortForDisconnect);
        }
      };

      void handle();
    },
  );

  server.maxHeadersCount = MAX_HEADER_COUNT;
  server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;
  server.setTimeout(SOCKET_TIMEOUT_MS, (socket) => socket.destroy());
  return server;
}

interface ListenConfig {
  host: string;
  port: number;
}

function listenConfig(source: NodeJS.ProcessEnv): ListenConfig {
  const host = source["BROKER_HOST"] ?? "0.0.0.0";
  const rawPort = source["BROKER_PORT"] ?? "8080";

  if (
    host.length === 0 ||
    host.length > 253 ||
    /[\u0000-\u0020\u007f/\\]/u.test(host) ||
    !/^\d+$/u.test(rawPort)
  ) {
    throw new TypeError("Invalid broker listen configuration");
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new TypeError("Invalid broker listen configuration");
  }

  return { host, port };
}

export function installGracefulShutdown(server: Server): void {
  let shuttingDown = false;
  let forcedClose: NodeJS.Timeout | undefined;

  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    forcedClose = setTimeout(() => {
      server.closeAllConnections();
      process.exitCode = 1;
    }, GRACEFUL_SHUTDOWN_MS);
    forcedClose.unref();

    server.close(() => {
      if (forcedClose !== undefined) {
        clearTimeout(forcedClose);
      }
    });
    server.closeIdleConnections();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.once("close", () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  });
}

async function run(): Promise<void> {
  const config = listenConfig(process.env);
  const server = createNodeServer();

  await new Promise<void>((resolve, reject) => {
    const onError = (): void => reject(new Error("Broker failed to listen"));
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  installGracefulShutdown(server);
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(entryPoint).href
) {
  void run().catch(() => {
    process.exitCode = 1;
  });
}
