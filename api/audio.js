'use strict';

const MAX_ADDRESS_BYTES = 4096;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const CDN_HOST = /^(?:[a-z0-9-]+\.)+tiktokcdn(?:-us)?\.com$/;
const MEDIA_PATH = /^\/(?:[0-9a-f]{32}\/[0-9a-f]{8}\/)?video\/tos\/[a-z0-9_./-]+$/i;
const AUDIO_MIME = /^(?:audio\/[a-z0-9.+-]+|video\/mp4)$/i;

function sameOrigin(req) {
  const { host, origin } = req.headers;
  return !!host && (origin === `https://${host}` ||
    (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) && origin === `http://${host}`));
}

async function audioAddress(req) {
  if (Number(req.headers['content-length']) > MAX_ADDRESS_BYTES) return null;
  let body = req.body;
  if (body === undefined) {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_ADDRESS_BYTES) return null;
      parts.push(chunk);
    }
    body = Buffer.concat(parts).toString('utf8');
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_ADDRESS_BYTES) return null;
  let url;
  try { url = new URL(body); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !CDN_HOST.test(url.hostname) || !MEDIA_PATH.test(url.pathname) ||
      !/^(audio_[a-z0-9]+|video_mp4)$/.test(url.searchParams.get('mime_type') || '')) return null;
  return url;
}

module.exports = async function audio(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const end = status => { res.statusCode = status; res.end(); };
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return end(405);
  }
  if (!sameOrigin(req)) return end(403);
  if (!/^text\/plain(?:;|$)/i.test(req.headers['content-type'] || '')) return end(415);
  try {
    const url = await audioAddress(req);
    if (!url) return end(400);
    // The caller supplies an existing TikTok media address. Never send cookies or follow redirects.
    const upstream = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim();
    if (upstream.status !== 200 || !upstream.body || !AUDIO_MIME.test(type) ||
        Number(upstream.headers.get('content-length')) > MAX_AUDIO_BYTES) {
      await upstream.body?.cancel();
      return end(502);
    }
    const reader = upstream.body.getReader();
    const parts = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        return end(502);
      }
      parts.push(value);
    }
    if (!size) return end(502);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', size);
    res.end(Buffer.concat(parts, size));
  } catch {
    end(502);
  }
};
