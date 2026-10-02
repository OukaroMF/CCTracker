/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* Pure caption-track helpers, shared by the page reader, UI and fixture tests. */
globalThis.CCTrackerTimelineCore = (() => {
  const MAX_CUES = 20000, MAX_BYTES = 4 * 1024 * 1024;
  const text = value => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/\u200b/g, '').trim() : '';
  function identity(href) {
    const u = new URL(href);
    if (u.hostname === 'www.bilibili.com' && /^\/(video\/(BV\w+|av\d+)|bangumi\/play\/(ep|ss)\d+)\/?$/.test(u.pathname)) return `bilibili:${u.pathname.replace(/\/$/, '')}?p=${u.searchParams.get('p') || '1'}`;
    return '';
  }
  function captionURL(raw, base) {
    try {
      const u = new URL(raw, base);
      if (u.protocol !== 'https:' || u.username || u.password) return null;
      if ((u.hostname === 'hdslb.com' || u.hostname.endsWith('.hdslb.com')) && (/\.json$/.test(u.pathname) || /^\/bfs\/(subtitle|ai_subtitle)\//.test(u.pathname))) return u;
    } catch {}
    return null;
  }
  function normalize(cues) {
    if (!Array.isArray(cues) || cues.length > MAX_CUES) return [];
    let bytes = 0;
    const result = [], seen = new Set();
    for (const cue of cues) {
      const start = cue?.start, end = cue?.end, value = text(cue?.text);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !value || value.length > 16384) continue;
      bytes += value.length * 2;
      if (bytes > MAX_BYTES) return [];
      const key = JSON.stringify([start, end, value]);
      if (!seen.has(key)) { seen.add(key); result.push({ start, end, text: value }); }
    }
    return result.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  function parseJSON(data) {
    if (Array.isArray(data?.body)) return normalize(data.body.map(c => ({ start: c.from, end: c.to, text: c.content })));
    return [];
  }
  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_BYTES) return [];
    // Bilibili tracks are JSON. Reject error pages and legacy YouTube XML
    // without invoking DOMParser, which is a Trusted Types sink on the site.
    try { return parseJSON(JSON.parse(raw)); } catch { return []; }
  }
  function rows(primary, secondary = []) {
    const a = normalize(primary), b = normalize(secondary), result = [];
    let first = 0;
    for (const cue of a) {
      while (first < b.length && b[first].end <= cue.start) first++;
      const translations = [];
      for (let j = first; j < b.length && b[j].start < cue.end; j++) {
        if (b[j].end > cue.start && b[j].text !== cue.text && !translations.includes(b[j].text)) translations.push(b[j].text);
      }
      result.push({ ...cue, translation: translations.join('\n') });
    }
    // Keep secondary-only intervals instead of silently dropping gaps in the original.
    let i = 0;
    for (const cue of b) {
      while (i < a.length && a[i].end <= cue.start) i++;
      if (!(a[i]?.start < cue.end)) result.push({ start: cue.start, end: cue.end, text: '', translation: cue.text });
    }
    return result.sort((a, b) => a.start - b.start);
  }
  function clock(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
    return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
  }
  function validMessage(m, key) {
    return m?.source === 'cctracker-tracks' && m.version === 1 && m.key === key && typeof m.enabled === 'boolean'
      && typeof m.label === 'string' && m.label.length <= 200 && ['ready', 'loading', 'unavailable', 'off'].includes(m.status)
      && Array.isArray(m.primary) && Array.isArray(m.secondary) && m.primary.length <= MAX_CUES && m.secondary.length <= MAX_CUES;
  }
  return { MAX_CUES, MAX_BYTES, text, identity, captionURL, normalize, parseJSON, parse, rows, clock, validMessage };
})();
