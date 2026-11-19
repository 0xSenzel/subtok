'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync(require.resolve('../extension/tiktok.js'), 'utf8');
const video = 'https://v.tiktokcdn.com/test.mp4';

function extension(fetch) {
  let listener;
  const runtime = { id: 'fixture', onMessage: { addListener: receive => { listener = receive; } } };
  vm.runInNewContext(script, { chrome: { runtime }, location: { origin: 'https://www.tiktok.com' }, URL, fetch, btoa });
  return message => new Promise(resolve => {
    assert.equal(listener(message, { id: 'fixture' }, resolve), true);
  });
}

test('extension reads video and cover URL lists and keeps alternate video addresses', async () => {
  const ask = extension(async () => Response.json({
    itemList: [{
      id: '101',
      music: { playUrl: 'https://v.tiktokcdn.com/sound.mp4' },
      video: {
        playAddr: { urlList: ['http://example.com/insecure', video, video, video + '?alternate'] },
        cover: { url_list: ['https://v.tiktokcdn.com/cover.jpg'] },
        dynamicCover: { urlList: ['https://v.tiktokcdn.com/cover.gif'] }
      }
    }]
  }));
  const { tracks: [track] } = await ask({ type: 'tracks', collectionId: '123' });
  assert.equal(track.video, video);
  assert.deepEqual(Array.from(track.videoFallbacks), [video + '?alternate']);
  assert.equal(track.artwork, 'https://v.tiktokcdn.com/cover.jpg');
  assert.equal(track.motion, 'https://v.tiktokcdn.com/cover.gif');
});

test('extension returns bytes for a complete, matching video range', async () => {
  const ask = extension(async (url, options) => {
    assert.equal(url.href, video);
    assert.equal(options.headers.Range, 'bytes=5-524292');
    return new Response('clip', { status: 206, headers: { 'Content-Range': 'bytes 5-8/9', 'Content-Type': 'video/mp4' } });
  });
  const piece = await ask({ type: 'video', url: video, start: 5 });
  assert.equal(piece.total, 9);
  assert.equal(piece.data, btoa('clip'));
  assert.equal(piece.whole, false);
});

test('extension rejects shifted, truncated, and oversized video ranges', async () => {
  for (const [range, body] of [['bytes 4-7/9', 'clip'], ['bytes 5-8/9', 'cl'], ['bytes 5-8/20971521', 'clip']]) {
    const ask = extension(async () => new Response(body, { status: 206, headers: { 'Content-Range': range } }));
    const result = await ask({ type: 'video', url: video, start: 5 });
    assert.match(result.error, /invalid video range|incomplete video/);
    assert.equal(result.data, undefined);
  }
});

test('extension rejects a full video returned for a later piece', async () => {
  const ask = extension(async () => new Response('clip'));
  assert.match((await ask({ type: 'video', url: video, start: 5 })).error, /invalid video range/);
  assert.equal((await ask({ type: 'video', url: video, start: 0 })).whole, true);
});
