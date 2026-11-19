# Media playback plan

Subtok streams the selected clip from TikTok. It saves collection details but has no audio cache or offline page. The video frame crops clips with a different aspect ratio, and the player can accept incomplete video downloads.

## Work sequence

1. **Implemented.** Stream the first play while Subtok preloads the current clip and the next two in playback order. If a TikTok host blocks the cross-origin download, use the same-origin audio relay.
2. **Implemented.** Keep up to eight complete audio files on the device, up to 8 MiB per clip. Serve the player page from a service worker when the network fails. Keep the selected clip and position if playable audio runs out. Retry the clip when the connection returns.
3. **Implemented.** Fit the full video inside the frame. Validate video downloads and try another advertised address if one fails. Keep the cover visible until a video frame is ready.

## Acceptance checks

- Play or skip to a preloaded clip during an outage. Confirm playback starts from local audio and the queue keeps its order.
- Reload during an outage after the browser has cached the player. Confirm the saved collection opens and cached audio plays. Select an uncached clip and confirm the player keeps the selection and recovers when the network returns.
- Check portrait and landscape video at phone and desktop widths. Test a failed or incomplete video and confirm the alternate video or cover appears while audio continues.

## Deployment and storage

The browser must load the player online once to install the service worker. Cached media can remain on the device across visits until it is evicted or the browser clears site data. When an offline player file changes, increment the shell cache version in `web/sw.js`.

The audio relay is a security-sensitive endpoint. It accepts same-origin POSTs with a TikTok CDN media address in the body. It checks the host, path, media type, and response size. It rejects redirects and limits responses to 4 MiB. The relay sends no TikTok cookies and sets the response to private and uncached.

Reload or rebuild the extension to use the updated video address handling. Shared collections still use cover art.

## Evaluation

- All 30 Node tests passed. They cover the relay's origin, host, media type, and size checks, along with video addresses and byte ranges.
- Chrome and WebKit passed cached playback, offline reload, offline auto-advance, recovery at the interrupted position, and retry after reconnect. Both kept eight audio clips after eviction.
- In one fixture run per browser, a cached track reached the playing event in 34 ms in Chrome and 145 ms in WebKit. The fixture delayed audio requests by 650 ms.
- The fixture displayed a 180 × 320 portrait video at a 1180 px viewport and a 320 × 180 landscape video at a 390 px viewport. A truncated download and a file that the browser could not decode fell through to an alternate video. When all addresses failed, cover art stayed visible and audio continued.
- Both browsers opened the documented public TikTok collection with 13 clips. Chrome cached three tracks through the relay and played the next track offline. WebKit cached tracks directly and played the next track from its cache.
- The WebKit run stopped the fixture server because Playwright's WebKit offline switch can block local responses. Physical iPhone playback remains unverified. [Playwright WebKit offline emulation issue](https://github.com/microsoft/playwright/issues/42775)
