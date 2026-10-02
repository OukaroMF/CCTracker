/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
  const documentId = crypto.randomUUID();
  let sequence = 0, current = null, port = null, signature = "", lastProgress = 0;
  let queued = null, retry = null, active = false, connectedURL = "";
  const events = ["play", "pause", "seeking", "seeked", "ended", "emptied", "loadedmetadata", "durationchange", "ratechange", "timeupdate"];

  function connect() {
    try {
      const connection = chrome.runtime.connect({ name: "cctracker-page" });
      port = connection;
      connectedURL = location.href;
      connection.onDisconnect.addListener(() => {
        if (port !== connection) return;
        port = null;
        if (active) retry = setTimeout(connect, 1000);
      });
      connection.onMessage.addListener(message => { if (message.type === "resync") publish("resync", true); });
      signature = "";
      publish("resync", true);
    } catch { port = null; }
  }

  function send(payload) {
    try { port?.postMessage(payload); } catch { signature = ""; }
  }

  function publish(reason = "change", force = false) {
    // sender.url is captured when a port is created; reconnect on SPA navigation.
    if (port && connectedURL !== location.href) {
      send({ version: 1, type: "clear", sessionId: documentId, sequence: ++sequence });
      const old = port; port = null; old.disconnect(); signature = "";
    }
    const state = CCTrackerAdapters.read(document, location.href);
    if (!state || state.video !== current?.video || state.player !== current?.player) bind(state);
    if (!state || !state.captionsEnabled || state.video.ended || !Number.isFinite(state.video.duration) || state.video.duration <= 0) {
      if (active || force) send({ version: 1, type: "clear", sessionId: documentId, sequence: ++sequence });
      active = false;
      signature = "";
      if (port) { const old = port; port = null; old.disconnect(); }
      return;
    }
    if (!port) { active = true; connect(); return; }
    active = true;
    const payload = { version: 1, type: "snapshot", sessionId: documentId, sequence: 0, reason,
      site: state.site, mediaId: state.mediaId, title: document.title, url: location.href,
      captionsEnabled: true, text: state.text, translation: state.translation || "", status: state.video.paused ? "paused" : "playing",
      position: Math.max(0, state.video.currentTime || 0), duration: state.video.duration };
    const nextSignature = JSON.stringify([payload.site, payload.mediaId, payload.title, payload.url, payload.text, payload.translation, payload.status]);
    const now = performance.now();
    if (!force && nextSignature === signature && (reason !== "timeupdate" || now - lastProgress < 1000)) return;
    signature = nextSignature;
    lastProgress = now;
    payload.sequence = ++sequence;
    send(payload);
  }

  function onVideo(event) { publish(event.type, event.type !== "timeupdate"); }
  const playerObserver = new MutationObserver(() => schedule());
  function bind(state) {
    if (current) events.forEach(event => current.video.removeEventListener(event, onVideo));
    playerObserver.disconnect();
    current = state;
    signature = "";
    if (state) {
      events.forEach(event => state.video.addEventListener(event, onVideo));
      playerObserver.observe(state.player, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ["aria-pressed", "aria-hidden", "class", "style", "checked"] });
    }
  }

  function schedule() {
    if (queued !== null) return;
    queued = setTimeout(() => { queued = null; publish(); }, 50);
  }
  // Also catches SPA navigation, a new video element, and player removal.
  const rootObserver = new MutationObserver(schedule);
  rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("popstate", schedule);
  document.addEventListener("yt-navigate-finish", schedule);
  document.addEventListener("visibilitychange", () => publish("visibility", true));
  addEventListener("pagehide", () => {
    active = false;
    clearTimeout(queued); clearTimeout(retry);
    send({ version: 1, type: "clear", sessionId: documentId, sequence: ++sequence });
    port?.disconnect(); port = null;
    rootObserver.disconnect(); bind(null);
  });
  addEventListener("pageshow", event => {
    if (event.persisted) { rootObserver.observe(document.documentElement, { childList: true, subtree: true }); publish("resync", true); }
  });
  publish("resync", true);
})();
