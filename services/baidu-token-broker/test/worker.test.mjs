import assert from "node:assert/strict";
import test from "node:test";

import {
  createApp,
  oauthCoordinateFingerprint,
} from "../dist/index.js";

const BAIDU_TOKEN_ENDPOINT = "https://openapi.baidu.com/oauth/2.0/token";

const ALLOWING_RATE_LIMITER = Object.freeze({
  limit: async () => ({ success: true }),
});

const VALID_ENV = Object.freeze({
  BAIDU_CLIENT_ID: "test-client-id",
  BAIDU_CLIENT_SECRET: "test-client-secret",
  BAIDU_REDIRECT_URI: "https://app.example.test/oauth/baidu/callback",
  BUILD_REVISION: "0123456789abcdef",
  TOKEN_EXCHANGE_ENABLED: "true",
  TOKEN_IP_RATE_LIMITER: ALLOWING_RATE_LIMITER,
  TOKEN_APP_RATE_LIMITER: ALLOWING_RATE_LIMITER,
});

const EXPECTED_OAUTH_COORDINATE_FINGERPRINT =
  "sha256:776461b511c5bb816e1c407ffc95195427b0fdfb1ee919286d99a46c7f391d6c";

function tokenRequest(payload, init = {}) {
  const headers = {
    "Content-Type": init.contentType ?? "application/json; charset=utf-8",
    ...init.headers,
  };
  if (init.connectingIp !== null) {
    headers["CF-Connecting-IP"] = init.connectingIp ?? "203.0.113.42";
  }

  return new Request(init.url ?? "https://broker.example.test/oauth/token", {
    method: init.method ?? "POST",
    headers,
    body:
      (init.method ?? "POST") === "GET"
        ? undefined
        : (init.rawBody ?? JSON.stringify(payload)),
  });
}

function providerJson(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function responseJson(response) {
  return JSON.parse(await response.text());
}

function assertSecurityHeaders(response) {
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /default-src 'none'/u,
  );
}

test("GET /healthz returns a cache-proof health response without credentials", async () => {
  const app = createApp({
    fetchImpl: async () => {
      throw new Error("health check must not call upstream");
    },
  });

  const response = await app.fetch(
    new Request("https://broker.example.test/healthz"),
    {},
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { status: "ok" });
  assertSecurityHeaders(response);
});

test("HEAD /healthz returns no body and preserves security headers", async () => {
  const response = await createApp().fetch(
    new Request("https://broker.example.test/healthz", { method: "HEAD" }),
    {},
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assertSecurityHeaders(response);
});

test("OAuth callback fallback is static and never reflects authorization data", async (t) => {
  const app = createApp({
    fetchImpl: async () => {
      throw new Error("callback fallback must not call upstream");
    },
  });
  const sensitiveCode = "authorization-code-must-not-appear";
  const sensitiveState = "oauth-state-must-not-appear";
  const callbackUrl =
    `https://broker.example.test/oauth/baidu/callback?code=${sensitiveCode}&state=${sensitiveState}`;

  await t.test("GET returns only a generic return-to-app page", async () => {
    const response = await app.fetch(new Request(callbackUrl), {});
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html; charset=utf-8$/u);
    assert.match(body, /皮皮课堂/u);
    assert.match(body, /\/oauth\/baidu\/return-to-app\.js/u);
    assert.match(body, /\/oauth\/baidu\/return-to-app\.css/u);
    assert.doesNotMatch(body, new RegExp(sensitiveCode, "u"));
    assert.doesNotMatch(body, new RegExp(sensitiveState, "u"));
    assertSecurityHeaders(response);
  });

  await t.test("static return helper derives a package-scoped intent in the browser", async () => {
    const response = await app.fetch(
      new Request("https://broker.example.test/oauth/baidu/return-to-app.js"),
      {},
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/javascript; charset=utf-8$/u,
    );
    assert.match(body, /window\.location\.search/u);
    assert.match(body, /package=com\.pipiclassroom\.app/u);
    assert.doesNotMatch(body, new RegExp(sensitiveCode, "u"));
    assert.doesNotMatch(body, new RegExp(sensitiveState, "u"));
    assertSecurityHeaders(response);
  });

  await t.test("HEAD returns identical metadata without a body", async () => {
    const response = await app.fetch(
      new Request(callbackUrl, { method: "HEAD" }),
      {},
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assert.match(response.headers.get("content-type") ?? "", /^text\/html; charset=utf-8$/u);
    assertSecurityHeaders(response);
  });

  await t.test("other methods are rejected", async () => {
    const response = await app.fetch(
      new Request(callbackUrl, { method: "POST" }),
      {},
    );

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assertSecurityHeaders(response);
  });
});

test("OAuth coordinate fingerprint has a stable cross-runtime test vector", async () => {
  assert.equal(
    await oauthCoordinateFingerprint(
      VALID_ENV.BAIDU_CLIENT_ID,
      VALID_ENV.BAIDU_REDIRECT_URI,
    ),
    EXPECTED_OAUTH_COORDINATE_FINGERPRINT,
  );
});

test("/readyz is configuration-aware while /healthz remains liveness-only", async (t) => {
  const app = createApp({
    fetchImpl: async () => {
      throw new Error("readiness must not call upstream");
    },
  });

  await t.test("ready with OAuth configuration and both protection bindings", async () => {
    const response = await app.fetch(
      new Request("https://broker.example.test/readyz"),
      VALID_ENV,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), {
      status: "ready",
      oauth_coordinate_fingerprint: EXPECTED_OAUTH_COORDINATE_FINGERPRINT,
      build_revision: VALID_ENV.BUILD_REVISION,
    });
    assertSecurityHeaders(response);
  });

  await t.test("not ready when a protection binding is missing", async () => {
    const { TOKEN_APP_RATE_LIMITER: _omitted, ...missingBinding } = VALID_ENV;
    const response = await app.fetch(
      new Request("https://broker.example.test/readyz"),
      missingBinding,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await responseJson(response), { status: "not_ready" });
    assert.equal(response.headers.get("retry-after"), "60");
  });

  await t.test("not ready unless token exchange is enabled by exact string", async () => {
    for (const value of [undefined, "false", "TRUE", "1", " true", "true ", true]) {
      const env = { ...VALID_ENV };
      if (value === undefined) {
        delete env.TOKEN_EXCHANGE_ENABLED;
      } else {
        env.TOKEN_EXCHANGE_ENABLED = value;
      }
      const response = await app.fetch(
        new Request("https://broker.example.test/readyz"),
        env,
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await responseJson(response), { status: "not_ready" });
    }
  });

  await t.test("not ready when OAuth configuration is malformed", async () => {
    const response = await app.fetch(
      new Request("https://broker.example.test/readyz"),
      { ...VALID_ENV, BAIDU_CLIENT_SECRET: "" },
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await responseJson(response), { status: "not_ready" });
  });

  await t.test("not ready when the build revision is missing or malformed", async () => {
    const { BUILD_REVISION: _omitted, ...missingRevision } = VALID_ENV;
    for (const env of [
      missingRevision,
      { ...VALID_ENV, BUILD_REVISION: "revision with spaces" },
    ]) {
      const response = await app.fetch(
        new Request("https://broker.example.test/readyz"),
        env,
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await responseJson(response), { status: "not_ready" });
    }
  });

  await t.test("HEAD readiness has the same status and no body", async () => {
    const response = await app.fetch(
      new Request("https://broker.example.test/readyz", { method: "HEAD" }),
      VALID_ENV,
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assertSecurityHeaders(response);
  });

  await t.test("liveness stays healthy without any configuration", async () => {
    const response = await app.fetch(
      new Request("https://broker.example.test/healthz"),
      {},
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), { status: "ok" });
  });
});

test("token exchange kill switch fails before request inspection or side effects", async (t) => {
  const disabledValues = [undefined, "false", "TRUE", "1", " true", "true ", true];

  for (const value of disabledValues) {
    await t.test(`disabled value ${String(value)}`, async () => {
      let ipLimitCalls = 0;
      let appLimitCalls = 0;
      let upstreamCalls = 0;
      const env = {
        ...VALID_ENV,
        TOKEN_IP_RATE_LIMITER: {
          limit: async () => {
            ipLimitCalls += 1;
            return { success: true };
          },
        },
        TOKEN_APP_RATE_LIMITER: {
          limit: async () => {
            appLimitCalls += 1;
            return { success: true };
          },
        },
      };
      if (value === undefined) {
        delete env.TOKEN_EXCHANGE_ENABLED;
      } else {
        env.TOKEN_EXCHANGE_ENABLED = value;
      }
      const app = createApp({
        fetchImpl: async () => {
          upstreamCalls += 1;
          return providerJson({});
        },
      });
      const requests = [
        new Request("https://broker.example.test/oauth/token?code=query", {
          method: "GET",
          headers: { "Content-Type": "text/plain" },
        }),
        tokenRequest(null, {
          contentType: "text/plain",
          rawBody: '{"grant_type":',
        }),
        tokenRequest(null, {
          rawBody: `{"padding":"${"x".repeat(17_000)}"}`,
        }),
      ];

      for (const request of requests) {
        const response = await app.fetch(request, env);
        assert.equal(response.status, 503);
        assert.equal((await responseJson(response)).error, "service_unavailable");
        assert.equal(request.bodyUsed, false);
      }
      assert.equal(ipLimitCalls, 0);
      assert.equal(appLimitCalls, 0);
      assert.equal(upstreamCalls, 0);
    });
  }
});

test("authorization_code is exchanged using only server configuration", async () => {
  let capturedUrl;
  let capturedInit;
  const app = createApp({
    fetchImpl: async (input, init) => {
      capturedUrl = new URL(input);
      capturedInit = init;
      return providerJson({
        access_token: "access-from-provider",
        expires_in: 2_592_000,
        refresh_token: "refresh-from-provider",
        scope: "basic netdisk",
        token_type: "Bearer",
        provider_internal_value: "must-not-be-relayed",
      });
    },
  });

  const response = await app.fetch(
    tokenRequest({
      grant_type: "authorization_code",
      code: "one-time-authorization-code",
    }),
    VALID_ENV,
  );

  assert.equal(response.status, 200);
  assert.equal(capturedUrl.origin + capturedUrl.pathname, BAIDU_TOKEN_ENDPOINT);
  assert.equal(capturedUrl.searchParams.get("grant_type"), "authorization_code");
  assert.equal(capturedUrl.searchParams.get("code"), "one-time-authorization-code");
  assert.equal(capturedUrl.searchParams.get("client_id"), VALID_ENV.BAIDU_CLIENT_ID);
  assert.equal(
    capturedUrl.searchParams.get("client_secret"),
    VALID_ENV.BAIDU_CLIENT_SECRET,
  );
  assert.equal(
    capturedUrl.searchParams.get("redirect_uri"),
    VALID_ENV.BAIDU_REDIRECT_URI,
  );
  assert.equal(capturedUrl.searchParams.has("refresh_token"), false);
  assert.equal(capturedInit.method, "GET");
  assert.equal(capturedInit.redirect, "error");
  assert.equal(capturedInit.credentials, "omit");

  assert.deepEqual(await responseJson(response), {
    access_token: "access-from-provider",
    expires_in: 2_592_000,
    refresh_token: "refresh-from-provider",
    scope: "basic netdisk",
    token_type: "Bearer",
  });
  assertSecurityHeaders(response);
});

test("refresh_token grant omits redirect_uri and authorization code", async () => {
  let capturedUrl;
  const app = createApp({
    fetchImpl: async (input) => {
      capturedUrl = new URL(input);
      return providerJson({
        access_token: "new-access-token",
        expires_in: 2_592_000,
        refresh_token: "rotated-refresh-token",
      });
    },
  });

  const response = await app.fetch(
    tokenRequest({
      grant_type: "refresh_token",
      refresh_token: "current-refresh-token",
    }),
    VALID_ENV,
  );

  assert.equal(response.status, 200);
  assert.equal(capturedUrl.searchParams.get("grant_type"), "refresh_token");
  assert.equal(
    capturedUrl.searchParams.get("refresh_token"),
    "current-refresh-token",
  );
  assert.equal(capturedUrl.searchParams.has("code"), false);
  assert.equal(capturedUrl.searchParams.has("redirect_uri"), false);
  assert.deepEqual(await responseJson(response), {
    access_token: "new-access-token",
    expires_in: 2_592_000,
    refresh_token: "rotated-refresh-token",
  });
});

test("strict JSON schema rejects extra and grant-mismatched fields", async (t) => {
  const app = createApp({
    fetchImpl: async () => {
      throw new Error("invalid requests must not call upstream");
    },
  });

  const invalidPayloads = [
    null,
    [],
    {},
    { grant_type: "client_credentials" },
    { grant_type: "authorization_code", code: "code", extra: true },
    {
      grant_type: "authorization_code",
      code: "code",
      client_secret: "client-must-not-submit-this",
    },
    {
      grant_type: "authorization_code",
      code: "code",
      redirect_uri: "https://attacker.example/callback",
    },
    {
      grant_type: "authorization_code",
      code: "code",
      refresh_token: "refresh",
    },
    { grant_type: "refresh_token", refresh_token: " refresh" },
    { grant_type: "refresh_token", refresh_token: "" },
  ];

  for (const [index, payload] of invalidPayloads.entries()) {
    await t.test(`invalid payload ${index + 1}`, async () => {
      const response = await app.fetch(tokenRequest(payload), VALID_ENV);
      assert.equal(response.status, 400);
      assert.equal((await responseJson(response)).error, "invalid_request");
    });
  }
});

test("malformed JSON and unsupported content types are rejected", async () => {
  const app = createApp({
    fetchImpl: async () => {
      throw new Error("invalid requests must not call upstream");
    },
  });

  const malformed = await app.fetch(
    tokenRequest(null, { rawBody: '{"grant_type":' }),
    VALID_ENV,
  );
  assert.equal(malformed.status, 400);
  assert.equal((await responseJson(malformed)).error, "invalid_json");

  const wrongType = await app.fetch(
    tokenRequest(
      { grant_type: "authorization_code", code: "code" },
      { contentType: "text/plain" },
    ),
    VALID_ENV,
  );
  assert.equal(wrongType.status, 415);
  assert.equal((await responseJson(wrongType)).error, "unsupported_media_type");

  const malformedCharset = await app.fetch(
    tokenRequest(
      { grant_type: "authorization_code", code: "code" },
      { contentType: 'application/json; charset="utf-8' },
    ),
    VALID_ENV,
  );
  assert.equal(malformedCharset.status, 415);
  assert.equal(
    (await responseJson(malformedCharset)).error,
    "unsupported_media_type",
  );
});

test("invalid UTF-8 JSON is rejected without reaching upstream", async () => {
  const response = await createApp({
    fetchImpl: async () => {
      throw new Error("invalid UTF-8 must not call upstream");
    },
  }).fetch(
    new Request("https://broker.example.test/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: new Uint8Array([0xff, 0xfe, 0xfd]),
    }),
    VALID_ENV,
  );

  assert.equal(response.status, 400);
  assert.equal((await responseJson(response)).error, "invalid_json");
});

test("oversized request bodies are rejected before JSON parsing", async () => {
  const response = await createApp({
    fetchImpl: async () => {
      throw new Error("oversized requests must not call upstream");
    },
  }).fetch(
    tokenRequest(null, { rawBody: `{"padding":"${"x".repeat(17_000)}"}` }),
    VALID_ENV,
  );

  assert.equal(response.status, 413);
  assert.equal((await responseJson(response)).error, "payload_too_large");
});

test("query parameters are rejected so tokens cannot enter proxy URLs", async () => {
  const response = await createApp({
    fetchImpl: async () => {
      throw new Error("query-bearing requests must not call upstream");
    },
  }).fetch(
    tokenRequest(
      { grant_type: "authorization_code", code: "body-code" },
      { url: "https://broker.example.test/oauth/token?code=query-code" },
    ),
    VALID_ENV,
  );

  assert.equal(response.status, 400);
  const body = await response.text();
  assert.match(body, /query_not_allowed/u);
  assert.doesNotMatch(body, /query-code|body-code/u);
});

test("unsupported routes and methods return safe errors", async () => {
  const app = createApp();
  const notFound = await app.fetch(
    new Request("https://broker.example.test/unknown"),
    VALID_ENV,
  );
  assert.equal(notFound.status, 404);

  const wrongMethod = await app.fetch(
    new Request("https://broker.example.test/oauth/token"),
    VALID_ENV,
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  assertSecurityHeaders(wrongMethod);
});

test("missing or malformed environment configuration is fail-closed", async (t) => {
  const app = createApp({
    fetchImpl: async () => {
      throw new Error("misconfigured service must not call upstream");
    },
  });
  const requestPayload = {
    grant_type: "authorization_code",
    code: "authorization-code",
  };

  const invalidEnvironments = [
    {},
    { ...VALID_ENV, BAIDU_CLIENT_SECRET: "" },
    { ...VALID_ENV, BAIDU_REDIRECT_URI: "javascript:alert(1)" },
  ];

  for (const [index, env] of invalidEnvironments.entries()) {
    await t.test(`invalid environment ${index + 1}`, async () => {
      const response = await app.fetch(tokenRequest(requestPayload), env);
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.match(body, /service_unavailable/u);
      assert.doesNotMatch(body, /CLIENT_SECRET|REDIRECT_URI/u);
    });
  }
});

test("token requests are protected by source and app rate limits", async (t) => {
  const payload = {
    grant_type: "authorization_code",
    code: "authorization-code",
  };

  await t.test("trusted Cloudflare source IP is used as the narrow key", async () => {
    const keys = [];
    const response = await createApp({
      fetchImpl: async () =>
        providerJson({
          access_token: "access-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
        }),
    }).fetch(
      tokenRequest(payload, { connectingIp: "2001:db8::7" }),
      {
        ...VALID_ENV,
        TOKEN_IP_RATE_LIMITER: {
          limit: async ({ key }) => {
            keys.push(key);
            return { success: true };
          },
        },
        TOKEN_APP_RATE_LIMITER: {
          limit: async ({ key }) => {
            keys.push(key);
            return { success: true };
          },
        },
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(keys, ["ip:2001:db8::7", "baidu-token-broker:v1"]);
  });

  await t.test("source bucket rejects before app bucket or upstream", async () => {
    let appCalls = 0;
    let upstreamCalls = 0;
    const response = await createApp({
      fetchImpl: async () => {
        upstreamCalls += 1;
        throw new Error("rate-limited request must not reach upstream");
      },
    }).fetch(tokenRequest(payload), {
      ...VALID_ENV,
      TOKEN_IP_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
      TOKEN_APP_RATE_LIMITER: {
        limit: async () => {
          appCalls += 1;
          return { success: true };
        },
      },
    });

    assert.equal(response.status, 429);
    assert.equal((await responseJson(response)).error, "rate_limited");
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(appCalls, 0);
    assert.equal(upstreamCalls, 0);
  });

  await t.test("aggregate app bucket rejects before upstream", async () => {
    let upstreamCalls = 0;
    const response = await createApp({
      fetchImpl: async () => {
        upstreamCalls += 1;
        throw new Error("rate-limited request must not reach upstream");
      },
    }).fetch(tokenRequest(payload), {
      ...VALID_ENV,
      TOKEN_APP_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    });

    assert.equal(response.status, 429);
    assert.equal((await responseJson(response)).error, "rate_limited");
    assert.equal(upstreamCalls, 0);
  });

  await t.test("missing trusted source identity fails closed", async () => {
    const response = await createApp({
      fetchImpl: async () => {
        throw new Error("unidentified request must not reach upstream");
      },
    }).fetch(tokenRequest(payload, { connectingIp: null }), VALID_ENV);

    assert.equal(response.status, 503);
    assert.equal((await responseJson(response)).error, "service_unavailable");
  });

  await t.test("protection binding errors fail closed", async () => {
    const response = await createApp({
      fetchImpl: async () => {
        throw new Error("protection failure must not reach upstream");
      },
    }).fetch(tokenRequest(payload), {
      ...VALID_ENV,
      TOKEN_IP_RATE_LIMITER: {
        limit: async () => {
          throw new Error("binding unavailable");
        },
      },
    });

    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /service_unavailable/u);
    assert.doesNotMatch(body, /binding unavailable|203\.0\.113\.42/u);
  });
});

test("invalid_grant is mapped without exposing provider details or credentials", async () => {
  const sensitiveCode = "sensitive-one-time-code";
  const response = await createApp({
    fetchImpl: async () =>
      providerJson(
        {
          error: "invalid_grant",
          error_description: `provider echoed ${sensitiveCode} and test-client-secret`,
        },
        { status: 400 },
      ),
  }).fetch(
    tokenRequest({
      grant_type: "authorization_code",
      code: sensitiveCode,
    }),
    VALID_ENV,
  );

  assert.equal(response.status, 400);
  const body = await response.text();
  assert.match(body, /invalid_grant/u);
  assert.doesNotMatch(body, /sensitive-one-time-code|test-client-secret|provider echoed/u);
});

test("provider credential errors are sanitized as a broker failure", async () => {
  const response = await createApp({
    fetchImpl: async () =>
      providerJson(
        {
          error: "invalid_client",
          error_description: "the configured secret was incorrect",
        },
        { status: 401 },
      ),
  }).fetch(
    tokenRequest({
      grant_type: "refresh_token",
      refresh_token: "sensitive-refresh-token",
    }),
    VALID_ENV,
  );

  assert.equal(response.status, 502);
  const body = await response.text();
  assert.match(body, /oauth_provider_error/u);
  assert.doesNotMatch(body, /invalid_client|incorrect|sensitive-refresh-token/u);
});

test("expired refresh tokens get a safe reauthorization signal", async () => {
  const response = await createApp({
    fetchImpl: async () =>
      providerJson({
        error: "expired_token",
        error_description: "refresh token has been used: sensitive-refresh-token",
      }),
  }).fetch(
    tokenRequest({
      grant_type: "refresh_token",
      refresh_token: "sensitive-refresh-token",
    }),
    VALID_ENV,
  );

  assert.equal(response.status, 400);
  const body = await response.text();
  assert.match(body, /expired_token/u);
  assert.doesNotMatch(body, /has been used|sensitive-refresh-token/u);
});

test("Baidu invalid_request is a reauthorization signal only for an invalid refresh token", async (t) => {
  await t.test("documented refresh-token error maps to invalid_grant", async () => {
    const response = await createApp({
      fetchImpl: async () =>
        providerJson(
          {
            error: "invalid_request",
            error_description: "Invalid refresh token: sensitive-refresh-token",
          },
          { status: 400 },
        ),
    }).fetch(
      tokenRequest({
        grant_type: "refresh_token",
        refresh_token: "sensitive-refresh-token",
      }),
      VALID_ENV,
    );

    assert.equal(response.status, 400);
    const body = await response.text();
    assert.match(body, /invalid_grant/u);
    assert.doesNotMatch(body, /invalid_request|sensitive-refresh-token/u);
  });

  await t.test("authorization-code invalid_request stays a provider failure", async () => {
    const response = await createApp({
      fetchImpl: async () =>
        providerJson(
          {
            error: "invalid_request",
            error_description: "Invalid refresh token",
          },
          { status: 400 },
        ),
    }).fetch(
      tokenRequest({
        grant_type: "authorization_code",
        code: "authorization-code",
      }),
      VALID_ENV,
    );

    assert.equal(response.status, 502);
    assert.equal((await responseJson(response)).error, "oauth_provider_error");
  });

  await t.test("a different refresh invalid_request stays a provider failure", async () => {
    const response = await createApp({
      fetchImpl: async () =>
        providerJson(
          {
            error: "invalid_request",
            error_description: "Missing required parameter",
          },
          { status: 400 },
        ),
    }).fetch(
      tokenRequest({
        grant_type: "refresh_token",
        refresh_token: "sensitive-refresh-token",
      }),
      VALID_ENV,
    );

    assert.equal(response.status, 502);
    assert.equal((await responseJson(response)).error, "oauth_provider_error");
  });
});

test("invalid and oversized provider responses are not relayed", async (t) => {
  const request = () =>
    tokenRequest({
      grant_type: "authorization_code",
      code: "authorization-code",
    });

  await t.test("malformed JSON", async () => {
    const response = await createApp({
      fetchImpl: async () =>
        new Response("not-json and must not be forwarded", { status: 200 }),
    }).fetch(request(), VALID_ENV);

    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /invalid_provider_response/u);
    assert.doesNotMatch(body, /must not be forwarded/u);
  });

  await t.test("oversized body", async () => {
    const response = await createApp({
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Length": "70000" },
        }),
    }).fetch(request(), VALID_ENV);

    assert.equal(response.status, 502);
    assert.equal((await responseJson(response)).error, "invalid_provider_response");
  });

  await t.test("missing required success fields", async () => {
    const response = await createApp({
      fetchImpl: async () =>
        providerJson({ access_token: "access", expires_in: 3600 }),
    }).fetch(request(), VALID_ENV);

    assert.equal(response.status, 502);
    assert.equal((await responseJson(response)).error, "invalid_provider_response");
  });

  for (const [name, optionalFields] of [
    ["explicit empty scope", { scope: "" }],
    ["whitespace-padded scope", { scope: " basic netdisk " }],
    ["explicit empty token type", { token_type: "" }],
    ["malformed token type", { token_type: "Bearer value" }],
  ]) {
    await t.test(name, async () => {
      const response = await createApp({
        fetchImpl: async () =>
          providerJson({
            access_token: "access",
            refresh_token: "refresh",
            expires_in: 3600,
            ...optionalFields,
          }),
      }).fetch(request(), VALID_ENV);

      assert.equal(response.status, 502);
      assert.equal((await responseJson(response)).error, "invalid_provider_response");
    });
  }
});

test("upstream network failures and timeouts have distinct safe responses", async (t) => {
  const request = () =>
    tokenRequest({
      grant_type: "refresh_token",
      refresh_token: "sensitive-refresh-token",
    });

  await t.test("network error", async () => {
    const response = await createApp({
      fetchImpl: async () => {
        throw new Error("socket failure containing sensitive-refresh-token");
      },
    }).fetch(request(), VALID_ENV);

    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /oauth_provider_unreachable/u);
    assert.doesNotMatch(body, /socket|sensitive-refresh-token/u);
  });

  await t.test("timeout", async () => {
    const response = await createApp({
      upstreamTimeoutMs: 10,
      fetchImpl: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    }).fetch(request(), VALID_ENV);

    assert.equal(response.status, 504);
    assert.equal((await responseJson(response)).error, "oauth_provider_timeout");
  });

  await t.test("timeout while reading provider response body", async () => {
    const response = await createApp({
      upstreamTimeoutMs: 10,
      fetchImpl: async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal.addEventListener(
                "abort",
                () => controller.error(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            },
          }),
          { status: 200 },
        ),
    }).fetch(request(), VALID_ENV);

    assert.equal(response.status, 504);
    assert.equal((await responseJson(response)).error, "oauth_provider_timeout");
  });
});
