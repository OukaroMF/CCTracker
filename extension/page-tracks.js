/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* Runs in MAIN at document_start. Only the player's subtitle responses are read.
 * No extension API, native host or arbitrary URL/request command is exposed here. */
(() => {
  // Keep this reader inert even if a stale or custom manifest injects it elsewhere.
  if (new URL(location.href).hostname !== 'www.bilibili.com') return;
  const C = CCTrackerTimelineCore, nativeFetch = window.fetch;
  let key = '', generation = 0, metadata = [], tracks = new Map(), pending = new Set(), failed = new Map();
  let last = '', revision = 0, selected = null, disposed = false, metadataPending = false, metadataRetry = 0, captionError = '';
  function reset() {
    const next = C.identity(location.href);
    if (key !== next) {
      key = next; generation++; metadata = []; tracks.clear(); pending.clear(); failed.clear(); last = ''; revision++; selected = null; metadataPending = false; metadataRetry = 0; captionError = '';
    }
    return generation;
  }
  function publish(selection, force = false) {
    const primary = selection?.primary ? tracks.get(selection.primary) || [] : [];
    const secondary = selection?.secondary ? tracks.get(selection.secondary) || [] : [];
    const enabled = !!selection?.enabled;
    const status = !enabled ? 'off' : primary.length ? 'ready' : pending.size || metadataPending ? 'loading' : 'unavailable';
    const secondaryStatus = !selection?.secondary ? 'off' : secondary.length ? 'ready' : pending.has(selection.secondary) ? 'loading' : 'unavailable';
    const signature = JSON.stringify([key, selection, status, secondaryStatus, revision]);
    if (!force && signature === last) return;
    last = signature;
    window.postMessage({ source: 'cctracker-tracks', version: 1, key, enabled, status,
      label: (selection?.label || '').slice(0, 200), captionError, secondaryStatus, diagnostic: !metadata.length ? 'metadata' : !selection?.primary ? 'selection' : primary.length ? 'ready' : 'caption', primary, secondary }, location.origin);
  }
  function remember(id, cues) {
    captionError = '';
    tracks.delete(id); tracks.set(id, cues);
    if (tracks.size > 8) tracks.delete(tracks.keys().next().value);
  }
  async function readBody(response) {
    if (!response.body?.getReader) return response.text();
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let size = 0, raw = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > C.MAX_BYTES) { await reader.cancel(); throw new Error('Caption response too large'); }
        raw += decoder.decode(value, { stream: true });
      }
      return raw + decoder.decode();
    } finally { reader.releaseLock(); }
  }
  async function load(id, raw) {
    const url = C.captionURL(raw, location.href);
    if (!url || tracks.has(id) || pending.has(id) || (failed.get(id) || 0) > Date.now()) return;
    const epoch = reset(); pending.add(id);
    try {
      const response = await nativeFetch.call(window, url.href, { credentials: url.origin === location.origin ? 'same-origin' : 'omit' });
      if (!response.ok || Number(response.headers.get('content-length')) > C.MAX_BYTES) { captionError = `http-${response.status || 'size'}`; return; }
      const cues = C.parse(await readBody(response));
      if (epoch === generation && cues.length) { remember(id, cues); revision++; captionError = ''; }
      else if (epoch === generation) captionError = 'format';
    } catch { if (epoch === generation) captionError = 'network'; /* Site authorization and network errors stay local; no fallback language. */ }
    finally { if (epoch === generation) { pending.delete(id); if (!tracks.has(id)) failed.set(id, Date.now() + 30000); tick(); } }
  }
  async function bootstrapBilibili() {
    // Some players obtain metadata before extension startup or from their cache.
    // Recover only the current video's selected tracks through the site's own API.
    if (metadata.length || metadataPending || metadataRetry > Date.now()) return;
    const epoch = reset(), href = location.href;
    metadataPending = true;
    try {
      const state = window.__INITIAL_STATE__;
      const part = Math.max(1, Number(new URL(href).searchParams.get('p')) || 1);
      const path = new URL(href).pathname;
      const expected = path.match(/^\/video\/(BV\w+|av\d+)/)?.[1];
      const candidate = state?.videoData;
      const video = candidate && (expected === candidate.bvid || expected === 'av' + candidate.aid) ? candidate : null;
      const episode = /^\/bangumi\/play\//.test(path) ? state?.epInfo : null;
      let aid = video?.aid || episode?.aid || (!expected ? state?.aid : null);
      let cid = video?.pages?.[part - 1]?.cid || (part === 1 ? video?.cid : null) || episode?.cid || (!expected ? state?.cid : null);
      const match = new URL(href).pathname.match(/^\/video\/(BV\w+|av\d+)/);
      if (match && (!cid || !aid)) {
        const viewURL = new URL('https://api.bilibili.com/x/web-interface/view');
        viewURL.searchParams.set(match[1].startsWith('BV') ? 'bvid' : 'aid', match[1].replace(/^av/, ''));
        const response = await nativeFetch.call(window, viewURL.href, { credentials: 'include' });
        const data = JSON.parse(await readBody(response))?.data;
        aid = data?.aid; cid = data?.pages?.[part - 1]?.cid;
      }
      if (epoch !== generation || !Number.isSafeInteger(Number(aid)) || Number(aid) <= 0 || !Number.isSafeInteger(Number(cid)) || Number(cid) <= 0) return;
      const url = new URL('https://api.bilibili.com/x/player/v2');
      url.searchParams.set('aid', aid); url.searchParams.set('cid', cid);
      const response = await nativeFetch.call(window, url.href, { credentials: 'include' });
      const list = JSON.parse(await readBody(response))?.data?.subtitle?.subtitles;
      if (epoch === generation && Array.isArray(list)) {
        metadata = list.slice(0, 200).filter(t => typeof t.lan === 'string' && C.captionURL(t.subtitle_url, href)); revision++;
      }
    } catch {}
    finally {
      if (epoch === generation) { metadataPending = false; if (!metadata.length) metadataRetry = Date.now() + 30000; tick(); }
    }
  }
  function bilibiliSelection() {
    const player = document.querySelector('.bpx-player-container, .bilibili-player');
    const close = player?.querySelector('.bpx-player-ctrl-subtitle-close-switch');
    const enabled = !!close && !close.classList.contains('bpx-state-active');
    if (!enabled) return { enabled: false };
    bootstrapBilibili();
    const choice = group => player.querySelector(`.bpx-player-ctrl-subtitle-${group} .bpx-player-ctrl-subtitle-language-item.bpx-state-active`);
    const major = choice('major'), minor = choice('minor');
    const dual = [...player.querySelectorAll('.bpx-player-ctrl-subtitle-bilingual-above input, .bpx-player-ctrl-subtitle-bilingual-bottom input, .bpx-player-ctrl-subtitle-bilingual input')].some(input => input.checked);
    const primary = major?.getAttribute('data-lan') || '';
    const secondary = dual ? minor?.getAttribute('data-lan') || '' : '';
    for (const lan of [primary, secondary].filter(Boolean)) {
      const track = metadata.find(t => t.lan === lan);
      if (track) load(lan, track.subtitle_url);
    }
    return { enabled, primary, secondary, label: [major?.textContent?.trim(), dual ? minor?.textContent?.trim() : ''].filter(Boolean).join(' / ') };
  }
  function tick(force = false) {
    if (disposed) return;
    reset();
    if (!key) return;
    if (!key.startsWith('bilibili:')) return;
    selected = bilibiliSelection();
    publish(selected, force);
  }
  function observedURL(raw) {
    try {
      const u = new URL(raw, location.href);
      if (C.captionURL(u.href, location.href)) return { u, type: 'caption' };
      if (u.protocol === 'https:' && u.hostname === 'api.bilibili.com' && /^\/x\/player\/(wbi\/)?v2$/.test(u.pathname)) return { u, type: 'metadata' };
    } catch {}
    return null;
  }
  function capture(info, raw, epoch) {
    reset();
    if (epoch !== generation || !key || typeof raw !== 'string' || raw.length > C.MAX_BYTES) return;
    try {
      if (info.type === 'metadata' && key.startsWith('bilibili:')) {
        const requested = info.u.searchParams.get('bvid');
        if (requested && !key.includes('/' + requested + '?')) return;
        const data = JSON.parse(raw)?.data;
        const list = data?.subtitle?.subtitles;
        if (Array.isArray(list)) {
          metadata = list.slice(0, 200).filter(t => typeof t.lan === 'string' && C.captionURL(t.subtitle_url, location.href));
          revision++;
        }
      } else if (info.type === 'caption') {
        const cues = C.parse(raw);
        if (!cues.length) return;
        const track = metadata.find(t => C.captionURL(t.subtitle_url, location.href)?.href === info.u.href);
        if (!track) return;
        remember(track.lan, cues);
        revision++;
      }
      tick();
    } catch {}
  }
  // Pass through the original promise/body unchanged. Inspect only recognized URLs.
  window.fetch = function (...args) {
    const epoch = reset(), info = observedURL(typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0]?.url);
    const promise = nativeFetch.apply(this, args);
    if (info) promise.then(r => {
      if (r.ok && Number(r.headers.get('content-length')) <= C.MAX_BYTES) readBody(r.clone()).then(raw => capture(info, raw, epoch)).catch(() => {});
    }).catch(() => {});
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open, xhrListeners = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, raw, ...rest) {
    const info = observedURL(raw), epoch = reset();
    const previous = xhrListeners.get(this); if (previous) this.removeEventListener('load', previous);
    if (info) { const listener = () => {
      if (this.status < 200 || this.status >= 300) return;
      try { capture(info, this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText, epoch); } catch {}
    }; xhrListeners.set(this, listener); this.addEventListener('load', listener, { once: true }); }
    return originalOpen.call(this, method, raw, ...rest);
  };
  // Poll only selection; entire tracks are sent only when data/language changes.
  let timer = setInterval(tick, 750);
  addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === 'cctracker-timeline-ready') tick(true);
  });
  addEventListener('pagehide', () => { disposed = true; clearInterval(timer); });
  addEventListener('pageshow', event => { if (event.persisted) { disposed = false; timer = setInterval(tick, 750); tick(true); } });
})();
