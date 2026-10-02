/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HOST, Sessions, validate, sanitize } from "./core.mjs";

const sessions = new Sessions();
const pages = new Map();
let native = null, lastSent = "", nativeSequence = 0, reconnectTimer = null, connecting = false;
const hostSession = crypto.randomUUID();

const STATUS_TITLES = {
  waiting: "等待字幕",
  connected: "已连接",
  unregistered: "LyricSync 未注册",
  failed: "连接失败",
  unsupported: "浏览器不支持本机连接",
};

function indicator(state, detail = "") {
  chrome.action.setTitle({ title: `CCTracker · ${STATUS_TITLES[state]}${detail ? `\n${String(detail).slice(0, 1000)}` : ""}` });
  chrome.action.setIcon({ path: { 16: `icons/${state}-16.png`, 32: `icons/${state}-32.png` } });
  // The supplied icons include status marks; clear badges left by older versions.
  chrome.action.setBadgeText({ text: "" });
}

function forward(force = false) {
  const selected = sessions.selected();
  if (!selected) {
    if (native) {
      native.postMessage({ version: 1, type: "clear", sessionId: hostSession, sequence: ++nativeSequence });
      const old = native; native = null; old.disconnect();
    }
    lastSent = "";
    clearTimeout(reconnectTimer);
    chrome.alarms.clear("native-reconnect");
    indicator("waiting");
    return;
  }
  if (!native) { connectNative(); return; }
  const key = JSON.stringify(selected);
  if (!force && key === lastSent) return;
  const payload = { ...selected, sessionId: hostSession, sequence: ++nativeSequence };
  try { native.postMessage(payload); lastSent = key; }
  catch { lastSent = ""; }
}

function connectNative() {
  if (native || connecting || !sessions.selected()) return;
  if (typeof chrome.runtime.connectNative !== "function") {
    indicator("unsupported", "chrome.runtime.connectNative 不可用");
    return;
  }
  connecting = true;
  try {
    const connection = chrome.runtime.connectNative(HOST);
    native = connection;
    connection.onMessage.addListener(message => {
      if (native !== connection) return;
      if (message.type === "ack") indicator("connected");
      else if (message.type === "error") indicator("failed", message.error || message.message || "");
    });
    connection.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || "";
      if (native !== connection) return;
      native = null; lastSent = "";
      if (!sessions.selected()) { indicator("waiting"); return; }
      const missing = /not found|not registered/i.test(error);
      indicator(missing ? "unregistered" : "failed", error);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => connectNative(), 5000);
      // An alarm can revive the worker if it sleeps while the host is unavailable.
      chrome.alarms.create("native-reconnect", { delayInMinutes: 1 });
    });
    connecting = false;
    forward(true);
  } catch (error) {
    connecting = false;
    indicator("failed", error?.message || String(error));
    chrome.alarms.create("native-reconnect", { delayInMinutes: 1 });
  }
}

chrome.runtime.onConnect.addListener(port => {
  const tabId = port.sender?.tab?.id;
  if (port.name !== "cctracker-page" || !Number.isInteger(tabId) || port.sender.frameId !== 0) { port.disconnect(); return; }
  pages.set(tabId, port);
  port.onMessage.addListener(message => {
    if (pages.get(tabId) !== port || !validate(message, port.sender.url)) return;
    if (sessions.update(tabId, sanitize(message))) forward();
  });
  port.onDisconnect.addListener(() => {
    if (pages.get(tabId) !== port) return;
    pages.delete(tabId); sessions.remove(tabId); forward();
  });
  port.postMessage({ type: "resync" });
});

chrome.tabs.onRemoved.addListener(tabId => { pages.delete(tabId); sessions.remove(tabId); forward(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== "native-reconnect") return;
  if (sessions.selected()) connectNative();
  else for (const page of pages.values()) page.postMessage({ type: "resync" });
});
chrome.action.onClicked.addListener(() => {
  forward(true);
  for (const page of pages.values()) page.postMessage({ type: "resync" });
});
indicator("waiting");
