/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Sessions, validate } from "../extension/core.mjs";

const url = "https://www.youtube.com/watch?v=sample";
const snapshot = (overrides = {}) => ({ version: 1, type: "snapshot", sessionId: "document-a", sequence: 1,
  site: "youtube", mediaId: "sample", title: "测试", url, captionsEnabled: true, text: "字幕", status: "playing", position: 1, duration: 100, ...overrides });

test("only supported top-level video origins and valid snapshots are accepted", () => {
  assert.equal(validate(snapshot(), url), true);
  for (const change of [{ version: 2 }, { sequence: 0 }, { text: "x".repeat(16385) }, { translation: "x".repeat(16385) }, { translation: 7 }, { duration: Infinity }, { position: -1 }, { site: "bilibili" }, { url: "https://evil.example/" }]) {
    assert.equal(validate(snapshot(change), url), false);
  }
  assert.equal(validate(snapshot(), "https://www.youtube.com.evil.example/watch?v=sample"), false);
  assert.equal(validate(snapshot(), "https://www.youtube.com/shorts/sample"), false);
  assert.equal(validate({ version: 1, type: "clear", sessionId: "a", sequence: 2 }, url), true);
});

test("recently playing tab takes ownership; pause and late progress cannot steal it", () => {
  const sessions = new Sessions();
  sessions.update(1, snapshot());
  sessions.update(2, snapshot({ sessionId: "b", text: "另一页" }));
  assert.equal(sessions.selected().text, "另一页");
  sessions.update(1, snapshot({ sequence: 2, text: "旧页进度" }));
  assert.equal(sessions.selected().text, "另一页");
  sessions.update(2, snapshot({ sessionId: "b", sequence: 2, status: "paused", text: "暂停保留" }));
  assert.equal(sessions.selected().text, "暂停保留");
  assert.equal(sessions.update(2, snapshot({ sessionId: "b", sequence: 1 })), false);
  sessions.remove(2);
  assert.equal(sessions.selected().text, "旧页进度");
  sessions.update(1, { version: 1, type: "clear", sessionId: "document-a", sequence: 3 });
  assert.equal(sessions.selected(), null);
});

test("URL tracking changes retain the same trusted video but other videos and parts are rejected", () => {
  const source = "https://www.bilibili.com/video/BV1heam6TExz/";
  const message = snapshot({ site:"bilibili", mediaId:"/video/BV1heam6TExz?p=1", url:source+"?vd_source=tracking" });
  assert.equal(validate(message,source),true);
  assert.equal(validate({...message,url:source.slice(0,-1)+"?p=1&spm_id_from=test"},source),true);
  assert.equal(validate({...message,url:source+"?p=2"},source),false);
  assert.equal(validate({...message,url:"https://www.bilibili.com/video/BVother/"},source),false);
  assert.equal(validate({...message,url:"https://www.bilibili.com.evil.test/video/BV1heam6TExz/"},source),false);
  assert.equal(validate({...message,url:"https://user@www.bilibili.com/video/BV1heam6TExz/"},source),false);
  assert.equal(validate(snapshot({url:url+"&feature=share"}),url),true);
});

test("cue gaps retain ownership, new media can take ownership, closed owner releases", () => {
  const sessions = new Sessions();
  sessions.update(1, snapshot());
  sessions.update(1, snapshot({ sequence: 2, text: "" }));
  assert.equal(sessions.owner, 1);
  assert.equal(sessions.selected().text, "");
  sessions.update(2, snapshot({ sessionId: "b", status: "paused" }));
  assert.equal(sessions.owner, 1);
  sessions.update(2, snapshot({ sessionId: "b", mediaId: "next", sequence: 2 }));
  assert.equal(sessions.owner, 2);
  sessions.remove(2);
  sessions.update(1, snapshot({ sequence: 3, status: "paused" }));
  sessions.remove(1);
  assert.equal(sessions.selected(), null);
});

function element(textContent = "", attributes = {}, children = {}) {
  return { textContent, nodeType: 1, hidden: false, parentElement: null,
    classList: { contains: () => false }, getAttribute: name => attributes[name] ?? null,
    getClientRects: () => attributes.hidden ? [] : [{}],
    querySelector: selector => children[selector] ?? null,
    querySelectorAll: selector => children[selector] ?? [] };
}
const context = vm.createContext({ URL, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) });
vm.runInContext(readFileSync(new URL("../extension/adapters.js", import.meta.url), "utf8"), context);
const adapters = context.CCTrackerAdapters;

test("YouTube preserves visible lines, joins adjacent segments and ignores hidden captions", () => {
  const button = element("", { "aria-pressed": "true" });
  const video = {};
  const player = element("", {}, { "video": video, ".ytp-subtitles-button": button,
    ".caption-window .caption-visual-line": [element("hello world"), element("第二行"), element("hidden", { hidden: true })] });
  const doc = { querySelector: selector => selector === "#movie_player" ? player : null };
  assert.equal(adapters.read(doc, url).text, "hello world\n第二行");
  player.querySelectorAll = selector => selector === ".ytp-caption-segment" ? [element("he"), element("llo")] : [];
  assert.equal(adapters.read(doc, url).text, "hello");
  button.getAttribute = () => "false";
  assert.equal(adapters.read(doc, url).captionsEnabled, false);
  assert.equal(adapters.read(doc, "https://www.youtube.com/shorts/sample"), null);
});

test("Bilibili empty enabled panel is a cue gap; disabled switch releases it", () => {
  const toggle = { checked: true };
  const panel = element();
  const player = element("", {}, { "video": {}, ".bili-subtitle-x-subtitle-panel, .bpx-player-subtitle-panel, .bilibili-player-video-subtitle": panel,
    ".bpx-player-subtitle-setting-switch input, .bpx-player-subtitle-setting-switch .bui-switch-input, input.bpx-player-subtitle-setting-switch": toggle });
  const doc = { querySelector: () => player };
  const href = "https://www.bilibili.com/video/BV123abc?p=2";
  assert.equal(adapters.read(doc, href).captionsEnabled, true);
  assert.equal(adapters.read(doc, href).text, "");
  assert.equal(adapters.read(doc, href).mediaId, "/video/BV123abc?p=2");
  toggle.checked = false;
  assert.equal(adapters.read(doc, href).captionsEnabled, false);
  assert.equal(adapters.read(doc, "https://live.bilibili.com/123"), null);
  assert.equal(adapters.normalizeText(" a\u00a0 b \r\n第二行\u200b\n\n"), "a b\n第二行");
});

test("current Bilibili renderer uses major/minor groups and close-switch selection", () => {
  const closeSwitch = element();
  let disabled = false;
  closeSwitch.classList.contains = name => name === "bpx-state-active" && disabled;
  const groups = [element("原文\n原文续行"), element("translation\nsecond line")];
  const panel = element("", {}, { ".bili-subtitle-x-subtitle-panel-major-group": [groups[0]],
    ".bili-subtitle-x-subtitle-panel-minor-group": [groups[1],element("hidden",{hidden:true})] });
  const player = element("", {}, { "video": {}, ".bili-subtitle-x-subtitle-panel, .bpx-player-subtitle-panel, .bilibili-player-video-subtitle": panel,
    ".bpx-player-ctrl-subtitle-close-switch": closeSwitch });
  const doc = { querySelector: () => player };
  const href = "https://www.bilibili.com/video/BV123abc/";
  assert.equal(adapters.read(doc, href).text, "原文\n原文续行");
  assert.equal(adapters.read(doc, href).translation, "translation\nsecond line");
  groups.forEach(group => { group.textContent = ""; });
  assert.equal(adapters.read(doc, href).captionsEnabled, true);
  assert.equal(adapters.read(doc, href).text, "");
  assert.equal(adapters.read(doc, href).translation, "");
  groups[1].textContent = "译文单独更新";
  assert.equal(adapters.read(doc, href).text, "");
  assert.equal(adapters.read(doc, href).translation, "译文单独更新");
  disabled = true;
  assert.equal(adapters.read(doc, href).captionsEnabled, false);
  assert.equal(adapters.read(doc, href).translation, "");
});

function contentHarness() {
  let now = 0;
  const messages = [], ports = [], listeners = new Map(), timers = new Map();
  const video = { duration: 100, currentTime: 1, paused: false, ended: false,
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name) };
  let state = { site: "youtube", mediaId: "sample", player: {}, video, captionsEnabled: true, text: "字幕" };
  const location = { href: url };
  const ctx = vm.createContext({ crypto: { randomUUID: () => "page-id" }, location,
    document: { title: "测试", documentElement: {}, addEventListener: () => {} },
    performance: { now: () => now }, CCTrackerAdapters: { read: () => state },
    MutationObserver: class { observe() {} disconnect() {} }, addEventListener: () => {},
    setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    chrome: { runtime: { connect: () => {
      const port = { url: location.href, postMessage: message => messages.push({ ...message }),
        onMessage: { addListener: fn => port.resync = fn }, onDisconnect: { addListener: fn => port.closed = fn },
        disconnect: () => port.closed?.() };
      ports.push(port); return port;
    } } } });
  vm.runInContext(readFileSync(new URL("../extension/content.js", import.meta.url), "utf8"), ctx);
  return { messages, ports, video, location, state, advance: ms => { now += ms; },
    emit: name => listeners.get(name)?.({ type: name }), resync: () => ports.at(-1).resync({ type: "resync" }) };
}

test("content sender deduplicates progress, sends seek immediately and reconnects on SPA navigation", () => {
  const h = contentHarness();
  assert.equal(h.messages.at(-1).text, "字幕");
  h.video.currentTime = 2; h.emit("timeupdate");
  assert.equal(h.messages.length, 1);
  h.advance(1000); h.emit("timeupdate");
  assert.equal(h.messages.at(-1).position, 2);
  h.video.currentTime = 50; h.emit("seeked");
  assert.equal(h.messages.at(-1).position, 50);
  h.video.paused = true; h.emit("pause");
  assert.equal(h.messages.at(-1).status, "paused");
  h.location.href = "https://www.youtube.com/watch?v=next"; h.state.mediaId = "next"; h.state.text = "新字幕";
  h.emit("loadedmetadata");
  assert.equal(h.ports.length, 2);
  assert.equal(h.ports.at(-1).url, h.location.href);
  assert.equal(h.messages.at(-1).mediaId, "next");
  h.state.text = ""; h.resync();
  assert.equal(h.messages.at(-1).type, "snapshot");
  assert.equal(h.messages.at(-1).text, "");
  h.state.translation = "新的翻译"; h.emit("timeupdate");
  assert.equal(h.messages.at(-1).translation, "新的翻译");
  h.state.captionsEnabled = false; h.resync();
  assert.equal(h.messages.at(-1).type, "clear");
});
