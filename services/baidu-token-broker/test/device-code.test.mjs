import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/index.js';

const env = { TOKEN_EXCHANGE_ENABLED: 'true', BAIDU_CLIENT_ID: 'fixture-client', BAIDU_CLIENT_SECRET: 'fixture-secret',
  BAIDU_REDIRECT_URI: 'https://example.test/oauth/callback', BUILD_REVISION: 'fixture-device',
  TOKEN_IP_RATE_LIMITER: { limit: async () => ({ success: true }) }, TOKEN_APP_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const request = (path, body) => new Request('https://example.test' + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify(body) });
const device = { device_code: 'device-fixture', user_code: 'user-fixture', verification_url: 'https://openapi.baidu.com/device',
  qrcode_url: 'https://openapi.baidu.com/device/qrcode/fixture/user-fixture', expires_in: 300, interval: 5 };

test('device-code issuance uses the fixed application and scope without sending its secret upstream', async () => {
  let captured;
  const app = createApp({ fetchImpl: async url => { captured = new URL(url); return Response.json({ ...device, unexpected: 'not-relayed' }); } });
  const response = await app.fetch(request('/oauth/device/code', {}), env);
  assert.equal(response.status, 200);
  assert.equal(captured.origin + captured.pathname, 'https://openapi.baidu.com/oauth/2.0/device/code');
  assert.equal(captured.searchParams.get('client_id'), env.BAIDU_CLIENT_ID);
  assert.equal(captured.searchParams.get('scope'), 'basic,netdisk');
  assert.equal(captured.searchParams.has('client_secret'), false);
  assert.deepEqual(await response.json(), { ...device, interval: 10 });
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('device-token polling uses the server secret and preserves pending/slow-down/denial signals', async () => {
  for (const error of ['authorization_pending', 'slow_down', 'access_denied', 'authorization_declined', 'expired_token']) {
    const app = createApp({ fetchImpl: async url => {
      const parsed = new URL(url); assert.equal(parsed.searchParams.get('grant_type'), 'device_token');
      assert.equal(parsed.searchParams.get('code'), 'fixture-device'); assert.equal(parsed.searchParams.get('client_secret'), env.BAIDU_CLIENT_SECRET);
      assert.equal(parsed.searchParams.has('redirect_uri'), false);
      return Response.json({ error, error_description: 'private upstream details' }, { status: 400 });
    } });
    const response = await app.fetch(request('/oauth/token', { grant_type: 'device_token', code: 'fixture-device' }), env);
    assert.equal(response.status, 400); const body = await response.json(); assert.equal(body.error, error);
    assert.doesNotMatch(JSON.stringify(body), /fixture-secret|private upstream details/);
  }
});

test('successful device exchange returns only the same sanitized token contract as mobile clients', async () => {
  const tokens = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 2592000, scope: 'basic netdisk' };
  const app = createApp({ fetchImpl: async () => Response.json({ ...tokens, client_secret: 'private', session_key: 'private' }) });
  assert.deepEqual(await (await app.fetch(request('/oauth/token', { grant_type: 'device_token', code: 'fixture' }), env)).json(), tokens);
});

test('device endpoints reject untrusted schema and do not allow the client to choose an application, scope or redirect', async () => {
  let calls = 0; const app = createApp({ fetchImpl: async () => { calls++; return Response.json(device); } });
  for (const body of [{ client_id: 'other' }, { scope: 'other' }, { redirect_uri: 'https://attacker.test' }, []])
    assert.equal((await app.fetch(request('/oauth/device/code', body), env)).status, 400);
  for (const body of [{ grant_type: 'device_token', code: '' }, { grant_type: 'device_token', code: 'fixture', client_secret: 'other' }, { grant_type: 'device_token', code: 'fixture', refresh_token: 'fixture' }])
    assert.equal((await app.fetch(request('/oauth/token', body), env)).status, 400);
  assert.equal(calls, 0);
});

test('device-code responses reject foreign QR origins and malformed lifetime/interval fields', async () => {
  for (const bad of [{ qrcode_url: 'https://evil.test/qr' }, { verification_url: 'http://openapi.baidu.com/device' }, { interval: 0 }, { expires_in: 999999 }, { device_code: '' }]) {
    const app = createApp({ fetchImpl: async () => Response.json({ ...device, ...bad }) });
    assert.equal((await app.fetch(request('/oauth/device/code', {}), env)).status, 502);
  }
});

test('new endpoint keeps the existing kill switch and both rate-limit protections', async () => {
  let calls = 0; const app = createApp({ fetchImpl: async () => { calls++; return Response.json(device); } });
  assert.equal((await app.fetch(request('/oauth/device/code', {}), { ...env, TOKEN_EXCHANGE_ENABLED: 'false' })).status, 503);
  assert.equal((await app.fetch(request('/oauth/device/code', {}), { ...env, TOKEN_IP_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal((await app.fetch(request('/oauth/device/code', {}), { ...env, TOKEN_APP_RATE_LIMITER: undefined })).status, 503);
  assert.equal(calls, 0);
});
