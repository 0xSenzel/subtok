'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const audio = require('../api/audio.js');

const address = 'https://v77.tiktokcdn.com/0123456789abcdef0123456789abcdef/01234567/video/tos/region/clip/?mime_type=audio_mpeg';
const alternateAddress = 'https://v58.tiktokcdn.com/video/tos/region/clip/?mime_type=audio_mpeg';
const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

async function relay(body, options = {}) {
  const req = Object.assign(Readable.from([Buffer.from(body)]), {
    method: 'POST',
    headers: { host: 'subtok.example', origin: 'https://subtok.example', 'content-type': 'text/plain', ...options.headers }
  });
  if (options.method) req.method = options.method;
  if (options.parsed) req.body = options.parsed === 'buffer' ? Buffer.from(body) : body;
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; }
  };
  await audio(req, res);
  return { status: res.statusCode, headers, body: res.body };
}

test('relays audio from both TikTok media path formats without forwarding credentials', async () => {
  global.fetch = async (url, options) => {
    assert.ok([address, alternateAddress].includes(url.href));
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers, undefined);
    return new Response('sound', { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  for (const [url, parsed] of [[address, false], [alternateAddress, 'text'], [address, 'buffer']]) {
    const result = await relay(url, { parsed });
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), 'sound');
    assert.equal(result.headers['content-type'], 'audio/mpeg');
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
  }
});

test('rejects cross-origin requests, non-media paths, and hosts outside the TikTok CDN', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; };
  assert.equal((await relay(address, { headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await relay(address, { method: 'GET' })).status, 405);
  assert.equal((await relay(address, { headers: { 'content-type': 'application/json' } })).status, 415);
  const badAddresses = [
    address.replace('https://', 'http://'),
    address.replace('v77.tiktokcdn.com', 'v77.tiktokcdn.com.example'),
    address.replace('v77.tiktokcdn.com', '169.254.169.254'),
    address.replace('.com/', '.com:8042/'),
    address.replace('https://', 'https://user@'),
    address.replace('0123456789abcdef0123456789abcdef', 'unsigned'),
    alternateAddress.replace('/video/tos/', '/other/path/'),
    address.replace('mime_type=audio_mpeg', 'mime_type=html'),
    address + 'x'.repeat(4096)
  ];
  for (const url of badAddresses) assert.equal((await relay(url)).status, 400);
  assert.equal(calls, 0);
});

test('rejects partial, non-media, and oversized bodies from the CDN', async () => {
  const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
  const responses = [
    new Response('partial', { status: 206, headers: { 'Content-Type': 'audio/mpeg' } }),
    new Response('markup', { headers: { 'Content-Type': 'text/html' } }),
    new Response('short', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': oversized.length } }),
    new Response(oversized, { headers: { 'Content-Type': 'audio/mpeg' } })
  ];
  for (const response of responses) {
    global.fetch = async () => response;
    assert.equal((await relay(address)).status, 502);
  }
});
