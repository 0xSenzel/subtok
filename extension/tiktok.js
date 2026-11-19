'use strict';

// Runs on TikTok pages. Reads the listener's account, collections, and clips with their session.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const PAGE = 30;
  const MAX_ITEMS = 600;

  async function getJson(path, params) {
    const url = new URL(path, location.origin);
    for (const [key, value] of Object.entries({ aid: '1988', ...params })) url.searchParams.set(key, value);
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`TikTok returned ${response.status}.`);
    const body = await response.json();
    const code = body.statusCode ?? body.status_code ?? 0;
    if (code !== 0) throw Object.assign(new Error(`TikTok returned code ${code}.`), { code });
    return body;
  }

  // Fetch the home page again rather than reading this tab's copy, which predates any sign-in in another tab.
  async function pageUser() {
    try {
      const html = await fetch('/', { credentials: 'include' }).then(r => r.text());
      const script = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
      return script ? JSON.parse(script[1]).__DEFAULT_SCOPE__?.['webapp.app-context']?.user || null : null;
    } catch { return null; }
  }

  async function account() {
    let user = await pageUser();
    if (!user?.secUid) {
      try {
        const info = await fetch('/passport/web/account/info/?aid=1988', { credentials: 'include' }).then(r => r.json());
        const data = info?.data;
        if (data?.sec_user_id) user = { secUid: data.sec_user_id, uniqueId: data.username, nickName: data.screen_name };
      } catch { /* Treated as signed out below. */ }
    }
    if (!user?.secUid) return { signedIn: false };
    return { signedIn: true, user: { secUid: user.secUid, uniqueId: user.uniqueId || '', nickname: user.nickName || user.nickname || '' } };
  }

  const firstUrl = value => (typeof value === 'string' ? value : value?.urlList?.[0] || value?.url_list?.[0] || '');

  async function collections() {
    const me = await account();
    if (!me.signedIn) return { signedIn: false, collections: [] };
    const found = [];
    for (let cursor = 0, more = true; more && found.length < 200;) {
      const body = await getJson('/api/user/collection_list/', { count: String(PAGE), cursor: String(cursor), secUid: me.user.secUid });
      for (const item of body.collectionList || []) {
        const id = String(item.collectionId ?? item.collection_id ?? item.id ?? '');
        if (!/^\d+$/.test(id)) continue;
        found.push({ id, name: item.name || 'Untitled collection', count: item.total ?? item.itemCount ?? item.item_count ?? null,
          cover: firstUrl(item.cover) || firstUrl(item.covers?.[0]) });
      }
      more = !!body.hasMore && (body.collectionList || []).length > 0;
      cursor = Number(body.cursor) || cursor + PAGE;
    }
    return { signedIn: true, collections: found };
  }

  // Lock screens and the Dynamic Island show one short line, so drop hashtags and mentions.
  const cleanCaption = text => text.replace(/(^|\s)[#@][^\s#@]+/g, ' ').replace(/\s+/g, ' ').trim();

  function track(item) {
    const music = item.music || {};
    const video = item.video || {};
    const addresses = Array.isArray(video.playAddr) ? video.playAddr : video.playAddr?.urlList || video.playAddr?.url_list;
    const [primaryVideo = '', ...videoFallbacks] = [...new Set([
      firstUrl(video.playAddr), ...(Array.isArray(addresses) ? addresses : []), firstUrl(video.downloadAddr)
    ].filter(url => typeof url === 'string' && /^https:\/\//.test(url)))];
    const author = item.author?.uniqueId || item.author?.unique_id || '';
    const caption = cleanCaption(item.desc || '');
    const useCaption = music.original || !music.title;
    return {
      id: String(item.id),
      title: (useCaption ? caption || music.title : music.title) || 'Untitled clip',
      artist: useCaption ? (author ? `@${author}` : music.authorName || '') : music.authorName || (author ? `@${author}` : ''),
      duration: video.duration || music.duration || null,
      artwork: firstUrl(video.cover) || firstUrl(video.originCover) || firstUrl(music.coverLarge) || firstUrl(music.coverMedium),
      motion: firstUrl(video.dynamicCover),
      video: primaryVideo,
      videoFallbacks,
      audio: music.playUrl || ''
    };
  }

  async function tracks(collectionId) {
    if (!/^\d+$/.test(collectionId || '')) throw new Error('Unknown collection.');
    const items = [];
    for (let cursor = 0, more = true; more && items.length < MAX_ITEMS;) {
      const body = await getJson('/api/collection/item_list/', { collectionId, count: String(PAGE), cursor: String(cursor), sourceType: '113' });
      items.push(...(body.itemList || []));
      more = !!body.hasMore && (body.itemList || []).length > 0;
      cursor = Number(body.cursor) || cursor + PAGE;
    }
    const all = items.map(track);
    const playable = all.filter(t => /^https:\/\//.test(t.audio));
    return { tracks: playable, skipped: all.length - playable.length };
  }

  // TikTok's video addresses only answer requests made with the listener's TikTok session, so the website
  // gets the current clip's video from here in small pieces. Only TikTok's own video hosts are fetched.
  const VIDEO_HOST = /(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|tiktokv\.us|tiktok\.com)$/;
  const PIECE = 512 * 1024;
  const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
  async function videoPiece(address, start) {
    let url;
    try { url = new URL(address); } catch { throw new Error('Unknown video.'); }
    if (url.protocol !== 'https:' || !VIDEO_HOST.test(url.hostname) || !Number.isInteger(start) || start < 0) throw new Error('Unknown video.');
    const response = await fetch(url, { credentials: 'include', headers: { Range: `bytes=${start}-${start + PIECE - 1}` } });
    if (response.status !== 206 && response.status !== 200) throw new Error(`TikTok returned ${response.status}.`);
    const whole = response.status === 200;
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    const length = Number(response.headers.get('content-length'));
    if ((whole && start !== 0) || (!whole && (!range || Number(range[1]) !== start ||
        Number(range[2]) < start || Number(range[2]) >= start + PIECE || Number(range[2]) >= Number(range[3]))) ||
        length > MAX_VIDEO_BYTES || Number(range?.[3]) > MAX_VIDEO_BYTES) {
      await response.body?.cancel();
      throw new Error('TikTok returned an invalid video range.');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES || (!whole && bytes.length !== Number(range[2]) - start + 1)) {
      throw new Error('TikTok returned an incomplete video.');
    }
    const total = whole ? bytes.length : Number(range[3]);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { data: btoa(binary), total, type: response.headers.get('content-type') || 'video/mp4', whole };
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== api.runtime.id) return false;
    if (message?.type === 'ping') { sendResponse(true); return false; }
    // The website only needs to know whether the listener is signed in; keep TikTok's account IDs here.
    const job = message?.type === 'account' ? account().then(me => ({ signedIn: me.signedIn, nickname: me.user?.nickname || '' }))
      : message?.type === 'collections' ? collections()
        : message?.type === 'tracks' ? tracks(message.collectionId)
          : message?.type === 'video' ? videoPiece(message.url, message.start)
          : null;
    if (!job) return false;
    job.then(sendResponse, error => sendResponse({ error: error.code === 100001 || error.code === 10201
      ? 'TikTok didn’t accept the request. Open tiktok.com and check that you’re signed in.' : error.message }));
    return true;
  });
})();
