import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../dist/index.js";
import {
  APP_RATE_LIMIT,
  CADDY_CLIENT_IP_HEADER,
  FixedWindowRateLimiter,
  IP_RATE_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  createNodeServer,
} from "../dist/node-server.js";

const PROCESS_ENV = Object.freeze({
  BAIDU_CLIENT_ID: "test-client-id",
  BAIDU_CLIENT_SECRET: "test-client-secret",
  BAIDU_REDIRECT_URI: "https://app.example.test/oauth/baidu/callback",
  BUILD_REVISION: "0123456789abcdef",
  TOKEN_EXCHANGE_ENABLED: "true",
});

const EXPECTED_OAUTH_COORDINATE_FINGERPRINT =
  "sha256:776461b511c5bb816e1c407ffc95195427b0fdfb1ee919286d99a46c7f391d6c";

function providerResponse() {
  return new Response(
    JSON.stringify({
      access_token: "provider-access-token",
      expires_in: 3600,
      refresh_token: "provider-refresh-token",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function tokenBody() {
  return JSON.stringify({
    grant_type: "authorization_code",
    code: "one-time-code",
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  server.closeAllConnections();
  if (!server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function withServer(options, callback) {
  const server = createNodeServer(options);
  const origin = await listen(server);
  try {
    await callback(origin, server);
  } finally {
    await close(server);
  }
}

function postToken(origin, clientIp, extraHeaders = {}) {
  return fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [CADDY_CLIENT_IP_HEADER]: clientIp,
      ...extraHeaders,
    },
    body: tokenBody(),
  });
}

function rawRequest(origin, rawHeaders) {
  const url = new URL("/healthz", origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: rawHeaders,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode,
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function headersOnlyTokenRequest(origin) {
  const url = new URL("/oauth/token", origin);
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Length": "1000000",
          "Content-Type": "text/plain",
          [CADDY_CLIENT_IP_HEADER]: "203.0.113.42",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          settled = true;
          clearTimeout(deadline);
          request.destroy();
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode,
          });
        });
      },
    );
    const deadline = setTimeout(() => {
      if (!settled) {
        request.destroy();
        reject(new Error("disabled token route waited for the request body"));
      }
    }, 1_000);
    request.once("error", (error) => {
      if (!settled) {
        clearTimeout(deadline);
        reject(error);
      }
    });
    request.flushHeaders();
  });
}

test("fixed-window limiter enforces its limit and resets only on a later window", async () => {
  let now = RATE_LIMIT_WINDOW_MS - 1;
  const limiter = new FixedWindowRateLimiter({
    limit: 2,
    windowMs: RATE_LIMIT_WINDOW_MS,
    capacity: 2,
    now: () => now,
  });

  assert.deepEqual(await limiter.limit({ key: "ip:a" }), { success: true });
  assert.deepEqual(await limiter.limit({ key: "ip:a" }), { success: true });
  assert.deepEqual(await limiter.limit({ key: "ip:a" }), { success: false });

  now = RATE_LIMIT_WINDOW_MS;
  assert.deepEqual(await limiter.limit({ key: "ip:a" }), { success: true });
  assert.equal(limiter.entryCount, 1);

  now = 0;
  assert.deepEqual(await limiter.limit({ key: "ip:a" }), { success: false });
});

test("fixed-window limiter has bounded storage and fails closed", async () => {
  const limiter = new FixedWindowRateLimiter({
    limit: 3,
    windowMs: RATE_LIMIT_WINDOW_MS,
    capacity: 2,
  });

  assert.equal((await limiter.limit({ key: "ip:a" })).success, true);
  assert.equal((await limiter.limit({ key: "ip:b" })).success, true);
  assert.equal((await limiter.limit({ key: "ip:c" })).success, false);
  assert.equal(limiter.entryCount, 2);
  assert.equal((await limiter.limit({ key: "ip:a" })).success, true);

  const brokenClock = new FixedWindowRateLimiter({
    limit: 1,
    windowMs: RATE_LIMIT_WINDOW_MS,
    capacity: 1,
    now: () => {
      throw new Error("clock unavailable");
    },
  });
  assert.deepEqual(await brokenClock.limit({ key: "ip:a" }), { success: false });
});

test("adapter trusts only one validated Caddy client IP and strips proxy headers", async () => {
  const capturedHeaders = [];
  const app = {
    async fetch(request) {
      capturedHeaders.push(request.headers);
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  };

  await withServer({ app }, async (origin) => {
    const valid = await fetch(`${origin}/healthz`, {
      headers: {
        [CADDY_CLIENT_IP_HEADER]: "2001:db8::7",
        "CF-Connecting-IP": "203.0.113.99",
        Forwarded: "for=203.0.113.99",
        "X-Forwarded-For": "203.0.113.99",
        "X-Real-IP": "203.0.113.99",
      },
    });
    assert.equal(valid.status, 200);
    assert.equal(capturedHeaders[0].get("cf-connecting-ip"), "2001:db8::7");
    assert.equal(capturedHeaders[0].get(CADDY_CLIENT_IP_HEADER), null);
    assert.equal(capturedHeaders[0].get("forwarded"), null);
    assert.equal(capturedHeaders[0].get("x-forwarded-for"), null);
    assert.equal(capturedHeaders[0].get("x-real-ip"), null);

    const invalid = await fetch(`${origin}/healthz`, {
      headers: {
        [CADDY_CLIENT_IP_HEADER]: "198.51.100.8:443",
        "CF-Connecting-IP": "198.51.100.8",
      },
    });
    assert.equal(invalid.status, 200);
    assert.equal(capturedHeaders[1].get("cf-connecting-ip"), null);

    const duplicate = await rawRequest(origin, [
      "Host",
      new URL(origin).host,
      CADDY_CLIENT_IP_HEADER,
      "198.51.100.8",
      CADDY_CLIENT_IP_HEADER,
      "198.51.100.9",
      "CF-Connecting-IP",
      "198.51.100.10",
    ]);
    assert.equal(duplicate.status, 200);
    assert.equal(capturedHeaders[2].get("cf-connecting-ip"), null);
  });
});

test("Node adapter reuses createApp and fails closed without a trusted source IP", async () => {
  let upstreamCalls = 0;
  const app = createApp({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return providerResponse();
    },
  });

  await withServer({ app, processEnv: PROCESS_ENV }, async (origin) => {
    const spoofed = await fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.42",
        "X-Forwarded-For": "203.0.113.42",
      },
      body: tokenBody(),
    });
    assert.equal(spoofed.status, 503);
    assert.equal((await spoofed.json()).error, "service_unavailable");
    assert.equal(upstreamCalls, 0);

    const trusted = await postToken(origin, "203.0.113.42", {
      "CF-Connecting-IP": "198.51.100.99",
    });
    assert.equal(trusted.status, 200);
    assert.deepEqual(await trusted.json(), {
      access_token: "provider-access-token",
      expires_in: 3600,
      refresh_token: "provider-refresh-token",
    });
    assert.equal(upstreamCalls, 1);
  });
});

test("Node readiness exposes only the stable release identity", async () => {
  await withServer({ processEnv: PROCESS_ENV }, async (origin) => {
    const response = await fetch(`${origin}/readyz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ready",
      oauth_coordinate_fingerprint: EXPECTED_OAUTH_COORDINATE_FINGERPRINT,
      build_revision: PROCESS_ENV.BUILD_REVISION,
    });
  });
});

test("Node kill switch responds before buffering a token request body", async () => {
  let upstreamCalls = 0;
  const app = createApp({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return providerResponse();
    },
  });

  await withServer(
    {
      app,
      processEnv: {
        TOKEN_EXCHANGE_ENABLED: "false",
        BAIDU_CLIENT_SECRET_FILE: "/path/that/must/not/be/read",
      },
    },
    async (origin) => {
      const response = await headersOnlyTokenRequest(origin);
      assert.equal(response.status, 503);
      assert.equal(JSON.parse(response.body).error, "service_unavailable");
      assert.equal(upstreamCalls, 0);

      const readiness = await fetch(`${origin}/readyz`);
      assert.equal(readiness.status, 503);
      assert.deepEqual(await readiness.json(), { status: "not_ready" });

      const health = await fetch(`${origin}/healthz`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ok" });

      const callback = await fetch(
        `${origin}/oauth/baidu/callback?code=must-not-be-reflected`,
      );
      assert.equal(callback.status, 200);
      assert.doesNotMatch(await callback.text(), /must-not-be-reflected/u);
      assert.equal(upstreamCalls, 0);
    },
  );
});

test("Node runtime supports a protected client-secret file and rejects ambiguity", async (t) => {
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "baidu-token-broker-secret-"),
  );
  const secretPath = join(fixtureDirectory, "baidu-client-secret");
  const symlinkPath = join(fixtureDirectory, "baidu-client-secret-link");
  const fileSecret = "secret-loaded-from-protected-file";

  try {
    await writeFile(secretPath, `${fileSecret}\n`, { mode: 0o400 });
    await chmod(secretPath, 0o400);
    const {
      BAIDU_CLIENT_SECRET: _inlineSecret,
      ...processEnvWithoutInlineSecret
    } = PROCESS_ENV;
    const fileProcessEnv = {
      ...processEnvWithoutInlineSecret,
      BAIDU_CLIENT_SECRET_FILE: secretPath,
    };

    await t.test("loads the file once for token exchange", async () => {
      let capturedClientSecret;
      const app = createApp({
        fetchImpl: async (input) => {
          capturedClientSecret = new URL(input).searchParams.get("client_secret");
          return providerResponse();
        },
      });

      await withServer({ app, processEnv: fileProcessEnv }, async (origin) => {
        const response = await postToken(origin, "203.0.113.42");
        assert.equal(response.status, 200);
        await response.arrayBuffer();
      });
      assert.equal(capturedClientSecret, fileSecret);
    });

    await t.test("does not read an empty placeholder while disabled", () => {
      const emptySecretPath = join(fixtureDirectory, "empty-placeholder");
      return writeFile(emptySecretPath, "", { mode: 0o400 }).then(async () => {
        await chmod(emptySecretPath, 0o400);
        const server = createNodeServer({
          processEnv: {
            ...processEnvWithoutInlineSecret,
            TOKEN_EXCHANGE_ENABLED: "FALSE",
            BAIDU_CLIENT_SECRET_FILE: emptySecretPath,
          },
        });
        server.close();
      });
    });

    await t.test("rejects simultaneous inline and file sources", () => {
      assert.throws(
        () =>
          createNodeServer({
            processEnv: {
              ...PROCESS_ENV,
              BAIDU_CLIENT_SECRET_FILE: secretPath,
            },
          }),
        /cannot both be set/u,
      );
    });

    await t.test("rejects permissive local file permissions", async () => {
      await chmod(secretPath, 0o644);
      assert.throws(
        () => createNodeServer({ processEnv: fileProcessEnv }),
        /Invalid BAIDU_CLIENT_SECRET_FILE/u,
      );
      await chmod(secretPath, 0o400);
    });

    await t.test("rejects symbolic-link secret paths", async () => {
      await symlink(secretPath, symlinkPath);
      assert.throws(
        () =>
          createNodeServer({
            processEnv: {
              ...processEnvWithoutInlineSecret,
              BAIDU_CLIENT_SECRET_FILE: symlinkPath,
            },
          }),
        /Invalid BAIDU_CLIENT_SECRET_FILE/u,
      );
    });
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test(`Node runtime enforces ${IP_RATE_LIMIT} token requests per IP each minute`, async () => {
  let now = 1_000;
  const app = createApp({ fetchImpl: async () => providerResponse() });

  await withServer({ app, processEnv: PROCESS_ENV, now: () => now }, async (origin) => {
    for (let index = 0; index < IP_RATE_LIMIT; index += 1) {
      const response = await postToken(origin, "203.0.113.7");
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }

    const limited = await postToken(origin, "203.0.113.7");
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, "rate_limited");

    now += RATE_LIMIT_WINDOW_MS;
    const nextWindow = await postToken(origin, "203.0.113.7");
    assert.equal(nextWindow.status, 200);
  });
});

test(`Node runtime enforces ${APP_RATE_LIMIT} aggregate token requests each minute`, async () => {
  let upstreamCalls = 0;
  const app = createApp({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return providerResponse();
    },
  });

  await withServer({ app, processEnv: PROCESS_ENV, now: () => 1_000 }, async (origin) => {
    for (let index = 0; index < APP_RATE_LIMIT; index += 1) {
      const response = await postToken(origin, `198.51.100.${index + 1}`);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }

    const limited = await postToken(origin, "192.0.2.1");
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, "rate_limited");
    assert.equal(upstreamCalls, APP_RATE_LIMIT);
  });
});

test("adapter bounds request bodies and total handler time", async (t) => {
  await t.test("oversized body is rejected before the application", async () => {
    let appCalls = 0;
    await withServer(
      {
        app: {
          async fetch() {
            appCalls += 1;
            return new Response("unexpected");
          },
        },
        processEnv: PROCESS_ENV,
      },
      async (origin) => {
        const response = await fetch(`${origin}/oauth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [CADDY_CLIENT_IP_HEADER]: "203.0.113.7",
          },
          body: "x".repeat(17_000),
        });
        assert.equal(response.status, 413);
        assert.equal((await response.json()).error, "payload_too_large");
        assert.equal(appCalls, 0);
      },
    );
  });

  await t.test("hung application is cut off", async () => {
    await withServer(
      {
        app: {
          async fetch() {
            return new Promise(() => {});
          },
        },
        handlerTimeoutMs: 25,
      },
      async (origin) => {
        const response = await fetch(`${origin}/healthz`, {
          headers: { [CADDY_CLIENT_IP_HEADER]: "203.0.113.7" },
        });
        assert.equal(response.status, 504);
        assert.equal((await response.json()).error, "request_timeout");
      },
    );
  });
});
