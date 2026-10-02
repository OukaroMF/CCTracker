/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = name => readFileSync(new URL('../extension/' + name, import.meta.url), 'utf8');
const coreContext = vm.createContext({ URL });
vm.runInContext(source('timeline-core.js'), coreContext);
const C = coreContext.CCTrackerTimelineCore;
const plain = value => JSON.parse(JSON.stringify(value));
const cue = (start, end, text) => ({ start, end, text });

test('full Bilibili tracks keep Chinese, multiline and deduplicate cues', () => {
  assert.deepEqual(plain(C.parseJSON({ body: [{ from: 1, to: 3, content: '中文\r\n下一行' }, { from: 1, to: 3, content: '中文\n下一行' }, { from: 3, to: 2, content: 'invalid' }] })), [cue(1, 3, '中文\n下一行')]);
  assert.deepEqual(plain(C.parse('{broken')), []);
  assert.deepEqual(plain(C.normalize([cue(-1, 2, 'x'), cue(0, Infinity, 'x'), cue(1, 1, 'x'), cue(0, 1, '<script>纯文本</script>')])), [cue(0, 1, '<script>纯文本</script>')]);
  assert.deepEqual(plain(C.normalize(Array(20001).fill(cue(0, 1, 'x')))), []);
});

test('bilingual alignment uses time overlap, preserves secondary-only intervals and ignores duplicate translation', () => {
  const rows = C.rows([cue(0, 2, 'first'), cue(2, 4, 'second'), cue(8, 10, 'same')], [cue(0, 4, '两句译文'), cue(5, 6, '单独译文'), cue(8, 10, 'same')]);
  assert.deepEqual(plain(rows), [
    { ...cue(0, 2, 'first'), translation: '两句译文' }, { ...cue(2, 4, 'second'), translation: '两句译文' },
    { ...cue(5, 6, ''), translation: '单独译文' }, { ...cue(8, 10, 'same'), translation: '' }
  ]);
  assert.equal(C.clock(3661), '1:01:01'); assert.equal(C.clock(8.8), '0:08');
});

test('caption parsing never invokes a TrustedHTML sink for invalid JSON or legacy XML', () => {
  let calls = 0;
  const context = vm.createContext({ URL, DOMParser: class {
    constructor() { calls++; throw new TypeError("This document requires 'TrustedHTML' assignment."); }
  } });
  vm.runInContext(source('timeline-core.js'), context);
  const parse = context.CCTrackerTimelineCore.parse;
  for (const raw of ['{broken', '<html>error</html>', '<transcript><text start="1" dur="2">old</text></transcript>']) {
    assert.deepEqual(plain(parse(raw)), []);
  }
  assert.deepEqual(plain(parse(JSON.stringify({ body: [{ from: 1, to: 3, content: '<&>中文\n下一行' }] }))), [cue(1, 3, '<&>中文\n下一行')]);
  assert.equal(calls, 0);
});

test('caption addresses and navigation identity are restricted to supported videos', () => {
  assert.equal(C.captionURL('https://evil.test/track.json', 'https://www.bilibili.com'), null);
  assert.equal(C.captionURL('http://i0.hdslb.com/track.json', 'https://www.bilibili.com'), null);
  assert.equal(C.captionURL('https://user@i0.hdslb.com/track.json', 'https://www.bilibili.com'), null);
  assert.ok(C.captionURL('//aisubtitle.hdslb.com/test.json', 'https://www.bilibili.com'));
  assert.ok(C.captionURL('https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/123', 'https://www.bilibili.com'));
  assert.equal(C.captionURL('https://i0.hdslb.com/unrelated/data', 'https://www.bilibili.com'), null);
  assert.equal(C.identity('https://www.youtube.com/shorts/a'), '');
  assert.equal(C.identity('https://www.youtube.com/watch?v=a'), '');
  assert.equal(C.captionURL('https://www.youtube.com/api/timedtext?v=a', 'https://www.youtube.com'), null);
  assert.equal(C.identity('https://www.bilibili.com/video/BV123/?p=2&spm=test'), 'bilibili:/video/BV123?p=2');
  const m = { source: 'cctracker-tracks', version: 1, key: 'bilibili:/video/BV123?p=1', enabled: true, label: '中文', status: 'ready', primary: [], secondary: [] };
  assert.equal(C.validMessage(m, m.key), true);
  assert.equal(C.validMessage(m, 'bilibili:/video/BV123?p=2'), false);
  assert.equal(C.validMessage({ ...m, status: 'unknown' }, m.key), false);
});

function harness() {
  const messages = [], requests = [], responses = new Map(), listeners = new Map(), timers = new Set();
  const location = { href: 'https://www.bilibili.com/video/BV123/?p=1', origin: 'https://www.bilibili.com' };
  const options = { enabled: true, major: 'zh', minor: 'en', dual: false };
  const item = lan => ({ getAttribute: () => lan, textContent: lan });
  const player = { classList: { contains: () => false },
    querySelectorAll: selector => selector.includes('bilingual') ? [{ checked: false }, { checked: options.dual }] : [],
    querySelector: selector => {
      if (selector.includes('close-switch')) return { classList: { contains: () => !options.enabled } };
      if (selector.includes('bilingual')) return { checked: options.dual };
      if (selector.includes('subtitle-major ')) return item(options.major);
      if (selector.includes('subtitle-minor ')) return item(options.minor);
      return null;
    }
  };
  const response = body => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(body), clone() { return this; } });
  class XHR { open() {} removeEventListener(name, fn) { if (this[name] === fn) delete this[name]; } addEventListener(name, fn) { this[name] = fn; } }
  const nativeFetch = (url, init) => {
    const address = String(url); requests.push({ url: address, init });
    return responses.has(address) ? Promise.resolve(response(responses.get(address))) : Promise.reject(new Error('network'));
  };
  const window = { fetch: nativeFetch, postMessage: m => messages.push(plain(m)) };
  const context = vm.createContext({ window, location, URL, TextDecoder, Date, XMLHttpRequest: XHR,
    document: { querySelector: () => player },
    setInterval: fn => { timers.add(fn); return fn; }, clearInterval: id => timers.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn) });
  vm.runInContext(source('timeline-core.js'), context);
  vm.runInContext(source('page-tracks.js'), context);
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const tick = () => { for (const fn of [...timers]) fn(); };
  return { messages, requests, responses, options, location, window, response, context, XHR, timers, flush, tick,
    ready: () => listeners.get('message')({ source: window, origin: location.origin, data: { source: 'cctracker-timeline-ready' } }),
    lifecycle: name => listeners.get(name)?.({ persisted: true }) };
}
const metadataURL = 'https://api.bilibili.com/x/player/wbi/v2?bvid=BV123&cid=1';
const originalURL = 'https://aisubtitle.hdslb.com/zh.json', translationURL = 'https://aisubtitle.hdslb.com/en.json';
function setup(h) {
  h.responses.set(metadataURL, { data: { subtitle: { subtitles: [{ lan: 'zh', subtitle_url: originalURL }, { lan: 'en', subtitle_url: translationURL }] } } });
  h.responses.set(originalURL, { body: [{ from: 0, to: 2, content: '原文' }, { from: 20, to: 22, content: '后半段' }] });
  h.responses.set(translationURL, { body: [{ from: 0, to: 2, content: 'translation' }] });
}

test('page reader loads whole selected Bilibili track, only adds bilingual track when webpage enables it', async () => {
  const h = harness(); setup(h);
  const response = await h.window.fetch(metadataURL); await h.flush();
  assert.equal((await response.text()).includes('subtitle_url'), true); // website still receives original body
  assert.equal(h.messages.at(-1).primary.length, 2);
  assert.equal(h.requests.find(r => r.url === originalURL).init.credentials, 'omit');
  assert.equal(h.requests.some(r => r.url === translationURL), false);
  h.options.dual = true; h.tick(); await h.flush();
  assert.equal(h.messages.at(-1).secondary[0].text, 'translation');
  h.options.major = 'en'; h.options.dual = false; h.tick(); await h.flush();
  assert.equal(h.messages.at(-1).primary[0].text, 'translation');
  assert.deepEqual(h.messages.at(-1).secondary, []);
  h.options.enabled = false; h.tick();
  assert.equal(h.messages.at(-1).status, 'off'); assert.deepEqual(h.messages.at(-1).primary, []);
});

test('failed loads do not form an immediate retry loop; unchanged tracks are not resent on progress', async () => {
  const h = harness(); setup(h); h.responses.delete(originalURL); await h.window.fetch(metadataURL); await h.flush();
  assert.equal(h.requests.filter(r => r.url === originalURL).length, 1);
  assert.equal(h.messages.at(-1).status, 'unavailable');
  const count = h.messages.length; h.tick(); h.tick(); await h.flush();
  assert.equal(h.requests.filter(r => r.url === originalURL).length, 1); assert.equal(h.messages.length, count);
  h.lifecycle('pagehide'); assert.equal(h.timers.size, 0);
  h.lifecycle('pageshow'); assert.equal(h.timers.size, 1);
});

test('late network response from another part cannot repopulate the new video session', async () => {
  const h = harness(); setup(h);
  const xhr = new h.XHR(); xhr.open('GET', metadataURL);
  h.location.href = 'https://www.bilibili.com/video/BV123/?p=2'; h.tick();
  xhr.status = 200; xhr.responseType = 'json'; xhr.response = { data: { subtitle: { subtitles: [{ lan: 'zh', subtitle_url: originalURL }] } } }; xhr.load(); await h.flush();
  assert.equal(h.requests.some(r => r.url === originalURL), false);
  assert.equal(h.messages.at(-1).key, 'bilibili:/video/BV123?p=2');
  assert.deepEqual(h.messages.at(-1).primary, []);
});

test('XHR subtitle metadata path works without modifying the page response', async () => {
  const h = harness(); setup(h);
  const xhr = new h.XHR(); xhr.open('GET', metadataURL); xhr.status = 200; xhr.responseType = 'json'; xhr.response = h.responses.get(metadataURL);
  xhr.load(); await h.flush();
  assert.equal(h.messages.at(-1).primary.length, 2);
  assert.equal(xhr.response, h.responses.get(metadataURL));
});


test('Bilibili recovers selected full track when native metadata was cached before startup', async () => {
  const h = harness(); setup(h);
  h.responses.set('https://api.bilibili.com/x/web-interface/view?bvid=BV123', { data: { aid: 123, pages: [{ cid: 1 }, { cid: 2 }] } });
  h.responses.set('https://api.bilibili.com/x/player/v2?aid=123&cid=1', h.responses.get(metadataURL));
  h.ready(); await h.flush();
  assert.equal(h.messages.at(-1).primary.length, 2);
  assert.equal(h.requests.find(r => r.url === originalURL).init.credentials, 'omit');
  assert.equal(h.requests.some(r => r.url === translationURL), false);
});

test('Bilibili discards initial state for a previous video instead of loading its captions', async () => {
  const h = harness(); setup(h);
  h.window.__INITIAL_STATE__ = { videoData: { bvid: 'BVold', aid: 9, cid: 9 } };
  h.responses.set('https://api.bilibili.com/x/web-interface/view?bvid=BV123', { data: { aid: 123, pages: [{ cid: 1 }] } });
  h.responses.set('https://api.bilibili.com/x/player/v2?aid=123&cid=1', h.responses.get(metadataURL));
  h.ready(); await h.flush();
  assert.equal(h.messages.at(-1).primary.length, 2);
  assert.equal(h.requests.some(r => r.url.includes('aid=9')), false);
});

test('Bilibili AI subtitle files without a .json suffix follow the native secondary selection', async () => {
  const h = harness(); setup(h); h.options.dual = true; h.options.minor = 'ai-zh';
  const aiURL = 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/123';
  h.responses.set(metadataURL, { data: { subtitle: { subtitles: [{ lan: 'zh', subtitle_url: originalURL }, { lan: 'ai-zh', subtitle_url: aiURL }] } } });
  h.responses.set(aiURL, { body: [{ from: 0, to: 2, content: '网页选择的 AI 副字幕' }] });
  await h.window.fetch(metadataURL); await h.flush();
  assert.equal(h.messages.at(-1).secondary[0].text, '网页选择的 AI 副字幕');
  assert.equal(h.messages.at(-1).secondaryStatus, 'ready');
  assert.equal(h.requests.find(r => r.url === aiURL).init.credentials, 'omit');
});


test('full-track reader stays inert when injected on YouTube or another site', () => {
  for (const href of ['https://www.youtube.com/watch?v=abc', 'https://example.com/']) {
    const fetch = () => {}, window = { fetch };
    const context = vm.createContext({ URL, location: { href }, window });
    // No caption core or XMLHttpRequest: an out-of-scope reader must not touch them.
    vm.runInContext(source('page-tracks.js'), context);
    assert.equal(window.fetch, fetch);
  }
});

test('YouTube loads only its native transcript shortcut; full-track reader and timeline CSS stay on Bilibili', () => {
  const manifest = JSON.parse(source('manifest.json'));
  const youtube = manifest.content_scripts.filter(s => s.matches.includes('https://www.youtube.com/*'));
  assert.ok(youtube.some(s => s.js.includes('youtube-transcript.js')));
  assert.equal(youtube.some(s => s.world === 'MAIN' || s.js.includes('timeline.js') || s.css?.includes('timeline.css')), false);
});
