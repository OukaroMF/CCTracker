/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const HOST = "com.oukaromf.lyricsync";
export const MAX_TEXT = 16384;

function videoKey(url) {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname === "www.youtube.com" && url.pathname === "/watch" && url.searchParams.get("v")) {
    return `youtube:${url.searchParams.get("v")}`;
  }
  if (url.hostname === "www.bilibili.com" && /^\/(video\/(BV[\w]+|av\d+)|bangumi\/play\/(ep|ss)\d+)\/?$/.test(url.pathname)) {
    return `bilibili:${url.pathname.replace(/\/$/, "")}:p=${url.searchParams.get("p") || "1"}`;
  }
  return null;
}

export function validate(message, senderURL) {
  if (!message || message.version !== 1 || !["snapshot", "clear"].includes(message.type)) return false;
  if (typeof message.sessionId !== "string" || !message.sessionId || message.sessionId.length > 128 || !Number.isSafeInteger(message.sequence) || message.sequence <= 0) return false;
  let sender;
  try { sender = new URL(senderURL); } catch { return false; }
  const key = videoKey(sender);
  if (!key) return false;
  if (message.type === "clear") return true;
  let page;
  try { page = new URL(message.url); } catch { return false; }
  // Bilibili appends tracking parameters after loading. Compare the trusted
  // video and part identity, rather than rejecting otherwise identical pages.
  return message.site === (sender.hostname === "www.youtube.com" ? "youtube" : "bilibili") &&
    typeof message.url === "string" && message.url.length <= 8192 && videoKey(page) === key &&
    typeof message.mediaId === "string" && message.mediaId.length > 0 && message.mediaId.length <= 512 &&
    typeof message.title === "string" && message.title.length <= 4096 &&
    typeof message.text === "string" && message.text.length <= MAX_TEXT &&
    (message.translation === undefined || typeof message.translation === "string" && message.translation.length <= MAX_TEXT) &&
    message.captionsEnabled === true && ["playing", "paused"].includes(message.status) &&
    Number.isFinite(message.position) && message.position >= 0 && Number.isFinite(message.duration) && message.duration > 0;
}

export function sanitize(message) {
  const clean = { version: 1, type: message.type, sessionId: message.sessionId, sequence: message.sequence };
  if (message.type === "snapshot") {
    for (const field of ["site", "mediaId", "title", "url", "captionsEnabled", "text", "status", "position", "duration"]) clean[field] = message[field];
    if (message.translation !== undefined) clean.translation = message.translation;
    // Page-controlled extra properties must never cross the native boundary.
    if (message.reason === "play") clean.reason = "play";
  }
  return clean;
}

export class Sessions {
  constructor() { this.tabs = new Map(); this.clock = 0; this.owner = null; }
  update(tabId, message) {
    const previous = this.tabs.get(tabId);
    if (previous?.message.sessionId === message.sessionId && message.sequence <= previous.message.sequence) return false;
    if (message.type === "clear") { this.remove(tabId); return true; }
    const newMedia = !previous || previous.message.sessionId !== message.sessionId || previous.message.mediaId !== message.mediaId;
    const started = message.status === "playing" && (newMedia || previous.message.status !== "playing" || message.reason === "play");
    const rank = started ? ++this.clock : previous?.rank || 0;
    this.tabs.set(tabId, { message, rank });
    if (started) this.owner = tabId;
    // Loading a paused video must not take ownership from an existing session.
    else if (this.owner === null && newMedia && message.status === "paused") this.owner = tabId;
    return true;
  }
  remove(tabId) {
    this.tabs.delete(tabId);
    if (this.owner !== tabId) return;
    this.owner = null;
    for (const [id, entry] of this.tabs) {
      if (entry.message.status === "playing" && (this.owner === null || entry.rank > this.tabs.get(this.owner).rank)) this.owner = id;
    }
  }
  selected() { return this.tabs.get(this.owner)?.message || null; }
}
