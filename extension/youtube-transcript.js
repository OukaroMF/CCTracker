/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* Reuse YouTube's interaction button and native transcript; no second timeline. */
(() => {
  let button = null, host = null, anchor = null, key = '', queued = null, pending = false, timeout = null;
  function scrub(root) {
    for (const node of [root, ...root.querySelectorAll('*')]) {
      node.removeAttribute('id');
      for (const attr of [...node.attributes]) if (attr.name.startsWith('on')) node.removeAttribute(attr.name);
    }
  }
  function entry() {
    const section = document.querySelector('ytd-video-description-transcript-section-renderer');
    return section?.querySelector('button, tp-yt-paper-button');
  }
  function openPending() {
    if (!pending) return;
    const native = entry();
    if (!native) return;
    pending = false; clearTimeout(timeout); button?.removeAttribute('aria-busy'); native.click();
  }
  function open() {
    pending = true; button.setAttribute('aria-busy', 'true');
    document.querySelector('ytd-watch-metadata #description-inline-expander #expand')?.click();
    openPending();
    if (pending) timeout = setTimeout(() => {
      pending = false; button?.removeAttribute('aria-busy');
      if (button) button.title = '网站暂未提供字幕文字稿，请在视频说明中查看';
    }, 5000);
  }
  function clear() { host?.remove(); host = null; button = null; anchor = null; pending = false; clearTimeout(timeout); }
  function sync() {
    queued = null;
    const u = new URL(location.href), next = u.pathname === '/watch' ? u.searchParams.get('v') : '';
    if (next !== key) { clear(); key = next; }
    if (!key) { clear(); return; }
    const save = [...document.querySelectorAll('ytd-watch-metadata #flexible-item-buttons button[aria-label]')]
      .find(b => /save|保存|儲存/i.test(b.getAttribute('aria-label')));
    if (!save) { clear(); return; }
    const container = save.closest('yt-button-view-model, ytd-button-renderer') || save;
    if (anchor !== container || !host?.isConnected) {
      clear(); anchor = container;
      host = document.createElement(container === save ? 'span' : container.tagName.toLowerCase());
      host.className = container === save ? 'style-scope ytd-menu-renderer cctracker-transcript-host' : container.className + ' cctracker-transcript-host';
      button = save.cloneNode(true); scrub(button); button.type = 'button';
      button.classList.add('cctracker-transcript-button'); button.removeAttribute('aria-disabled');
      button.setAttribute('aria-label', '打开 YouTube 字幕文字稿'); button.title = 'Transcript · 字幕文字稿';
      const icon = document.querySelector('.ytp-subtitles-button svg')?.cloneNode(true);
      const previous = button.querySelector('svg');
      if (icon && previous) { icon.setAttribute('fill', 'currentColor'); previous.replaceWith(icon); }
      const text = button.querySelector('.ytSpecButtonShapeNextButtonTextContent'); if (text) text.textContent = 'Transcript';
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(); });
      if (container !== save && save.parentElement !== container) {
        const inner = document.createElement(save.parentElement.tagName.toLowerCase()); inner.className = save.parentElement.className;
        inner.append(button); host.append(inner);
      } else host.append(button);
      container.after(host);
    }
    openPending();
  }
  function schedule() { if (queued === null) queued = setTimeout(sync, 80); }
  const observer = new MutationObserver(mutations => { if (mutations.some(m => !host?.contains(m.target))) schedule(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', schedule); addEventListener('popstate', schedule);
  addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(queued); queued = null; clear(); });
  addEventListener('pageshow', event => { if (event.persisted) { observer.observe(document.documentElement, { childList: true, subtree: true }); sync(); } });
  sync();
})();
