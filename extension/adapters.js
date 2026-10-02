/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* Classic script shared by content scripts and dependency-free fixture tests. */
globalThis.CCTrackerAdapters = (() => {
  function visible(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (!element.getClientRects().length) return false;
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
    }
    return true;
  }

  function normalizeText(text) {
    return String(text ?? "").replace(/\u200b/g, "").replace(/\r\n?/g, "\n")
      .split("\n").map(line => line.replace(/[\t \u00a0]+/g, " ").trim()).filter(Boolean).join("\n");
  }

  function youtube(doc, url) {
    if (url.hostname !== "www.youtube.com" || url.pathname !== "/watch" || !url.searchParams.get("v")) return null;
    const player = doc.querySelector("#movie_player");
    // Live broadcasts are deliberately excluded, including their replay UI.
    if (!player || player.classList.contains("ytp-live")) return null;
    const video = player.querySelector("video");
    if (!video) return null;
    const button = player.querySelector(".ytp-subtitles-button");
    const captionsEnabled = button?.getAttribute("aria-pressed") === "true";
    const lines = [...player.querySelectorAll(".caption-window .caption-visual-line")]
      .filter(visible).map(line => normalizeText(line.textContent)).filter(Boolean);
    // Older layouts expose segments without visual-line wrappers.
    const fallback = lines.length ? "" : [...player.querySelectorAll(".ytp-caption-segment")]
      .filter(visible).map(segment => segment.textContent).join("");
    return { site: "youtube", mediaId: url.searchParams.get("v"), player, video, captionsEnabled,
      text: captionsEnabled ? normalizeText(lines.length ? lines.join("\n") : fallback) : "" };
  }

  function bilibili(doc, url) {
    if (url.hostname !== "www.bilibili.com" || !/^\/(video\/(BV[\w]+|av\d+)|bangumi\/play\/(ep|ss)\d+)\/?$/.test(url.pathname)) return null;
    const player = doc.querySelector(".bpx-player-container, .bilibili-player");
    const video = player?.querySelector("video");
    if (!video) return null;
    const panel = player.querySelector(".bili-subtitle-x-subtitle-panel, .bpx-player-subtitle-panel, .bilibili-player-video-subtitle");
    const button = player.querySelector(".bpx-player-ctrl-subtitle");
    const switchElement = player.querySelector(".bpx-player-subtitle-setting-switch input, .bpx-player-subtitle-setting-switch .bui-switch-input, input.bpx-player-subtitle-setting-switch");
    const pressed = button?.getAttribute("aria-pressed");
    const closeSwitch = player.querySelector(".bpx-player-ctrl-subtitle-close-switch");
    // Bilibili leaves an empty panel between cues; enabled state must not depend on text.
    let captionsEnabled;
    if (switchElement && typeof switchElement.checked === "boolean") captionsEnabled = switchElement.checked;
    else if (pressed === "true" || pressed === "false") captionsEnabled = pressed === "true";
    else if (closeSwitch) captionsEnabled = !closeSwitch.classList.contains("bpx-state-active");
    else captionsEnabled = visible(panel);
    const primary = panel ? [...panel.querySelectorAll(".bili-subtitle-x-subtitle-panel-major-group")] : [];
    const secondary = panel ? [...panel.querySelectorAll(".bili-subtitle-x-subtitle-panel-minor-group")] : [];
    const legacy = panel ? [...panel.querySelectorAll(".bpx-player-subtitle-panel-text, .bilibili-player-video-subtitle-text")] : [];
    const lines = nodes => nodes.filter(visible).map(node => normalizeText(node.innerText ?? node.textContent)).filter(Boolean).join("\n");
    // Separate tracks by the renderer's groups, never by a newline in a cue.
    const grouped = primary.length || secondary.length;
    const text = grouped ? lines(primary) : legacy.length ? lines(legacy) : visible(panel) ? panel.textContent : "";
    const translation = grouped ? lines(secondary) : "";
    return { site: "bilibili", mediaId: url.pathname + "?p=" + (url.searchParams.get("p") || "1"), player, video,
      captionsEnabled, text: captionsEnabled ? normalizeText(text) : "",
      translation: captionsEnabled ? normalizeText(translation) : "" };
  }

  function read(doc, href) {
    const url = new URL(href);
    return youtube(doc, url) || bilibili(doc, url);
  }
  return { visible, normalizeText, youtube, bilibili, read };
})();
