/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
  const C = CCTrackerTimelineCore;
  let key = '', panel = null, anchor = null, media = null, data = null;
  let rows = [], buttons = [], active = [], prefixEnds = [], signature = '', queued = null, auto = true;
  let status, list, heading, toggle, followButton, expectedScroll = null; 
  const element = (tag, className, value) => {
    const e = document.createElement(tag); e.className = className || '';
    if (value !== undefined) e.textContent = value;
    return e;
  };
  function place(state) {
    const nextAnchor = document.querySelector('.bpx-player-collapse.bui:not(.cctracker-timeline)');
    if (!nextAnchor) { panel?.remove(); panel = null; anchor = null; return; }
    if (panel && anchor === nextAnchor && panel.isConnected) return;
    panel?.remove(); anchor = nextAnchor;
    panel = element('section', 'cctracker-timeline cctracker-bilibili bpx-player-collapse bui bui-collapse');
    panel.setAttribute('aria-label', '字幕时间轴');
    const area = element('div', 'bui-area');
    const wrapper = element('div', 'bui-collapse-wrap');
    panel.append(area); area.append(wrapper);
    toggle = nextAnchor.querySelector('.bui-collapse-header')?.cloneNode(true) || element('div', 'bui-collapse-header');
    toggle.querySelector('.bui-dropdown-items')?.remove();
    toggle.querySelector('.bui-dropdown-icon')?.remove();
    const title = toggle.querySelector('.bui-dropdown-name') || element('span', 'bui-dropdown-name');
    title.textContent = '字幕时间轴'; if (!title.parentElement) toggle.append(title);
    followButton = element('button', 'cctracker-follow'); followButton.type = 'button';
    followButton.title = '定位到当前字幕并开启跟随播放'; followButton.setAttribute('aria-label', followButton.title);
    followButton.setAttribute('aria-pressed', String(auto));
    // Tabler Icons focus-2 (MIT); attribution is in THIRD_PARTY_NOTICES.md.
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ xmlns: 'http://www.w3.org/2000/svg', width: '24', height: '24',
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round',
      'stroke-linejoin': 'round', class: 'icon icon-tabler icons-tabler-outline icon-tabler-focus-2', 'aria-hidden': 'true' })) icon.setAttribute(name, value);
    for (const attributes of [
      { stroke: 'none', d: 'M0 0h24v24H0z', fill: 'none' },
      { d: 'M11.5 12a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0', fill: 'currentColor' },
      { d: 'M5 12a7 7 0 1 0 14 0a7 7 0 1 0 -14 0' },
      { d: 'M12 3l0 2' }, { d: 'M3 12l2 0' }, { d: 'M12 19l0 2' }, { d: 'M19 12l2 0' }
    ]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      for (const [name, value] of Object.entries(attributes)) path.setAttribute(name, value);
      icon.append(path);
    }
    followButton.append(icon); title.after(followButton);
    toggle.setAttribute('role', 'button'); toggle.tabIndex = 0;
    for (const node of [toggle, ...toggle.querySelectorAll('*')]) {
      node.removeAttribute('id');
      for (const attr of [...node.attributes]) if (attr.name.startsWith('on')) node.removeAttribute(attr.name);
    }
    toggle.setAttribute('aria-expanded', 'true');
    wrapper.append(toggle);
    const body = element('div', 'cctracker-timeline-body');
    body.id = 'cctracker-timeline-body'; toggle.setAttribute('aria-controls', body.id);
    const collapse = () => {
      body.hidden = !body.hidden; toggle.setAttribute('aria-expanded', String(!body.hidden));
      wrapper.classList.toggle('bui-collapse-wrap-folded', body.hidden);
    };
    toggle.addEventListener('click', collapse);
    toggle.addEventListener('keydown', event => {
      if (event.target !== toggle) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); collapse(); }
    });
    const controls = element('div', 'cctracker-timeline-controls');
    heading = element('span', 'cctracker-track-label');
    controls.append(heading);
    followButton.addEventListener('click', event => {
      event.stopPropagation(); auto = true; followButton.setAttribute('aria-pressed', 'true');
      body.hidden = false; toggle.setAttribute('aria-expanded', 'true'); wrapper.classList.remove('bui-collapse-wrap-folded');
      updateActive(true);
    });
    status = element('p', 'cctracker-timeline-status', '等待网页字幕轨道…');
    list = element('div', 'cctracker-timeline-list'); list.setAttribute('role', 'list');
    const stopFollowing = () => { auto = false; followButton.setAttribute('aria-pressed', 'false'); };
    list.addEventListener('wheel', stopFollowing, { passive: true });
    list.addEventListener('touchstart', stopFollowing, { passive: true });
    list.addEventListener('scroll', () => {
      if (expectedScroll !== null && Math.abs(list.scrollTop - expectedScroll) < 1) { expectedScroll = null; return; }
      expectedScroll = null; stopFollowing();
    }, { passive: true });
    list.addEventListener('keydown', e => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) stopFollowing(); });
    body.append(controls, status, list);
    wrapper.append(body); nextAnchor.after(panel); signature = ''; render();
  }
  function clear() {
    panel?.remove(); panel = null; anchor = null; data = null; rows = []; buttons = []; active = []; signature = ''; expectedScroll = null;
  }
  function sync() {
    queued = null;
    const nextKey = C.identity(location.href);
    if (nextKey !== key) { key = nextKey; clear(); }
    const state = CCTrackerAdapters.read(document, location.href);
    if (!state || state.site !== 'bilibili' || !key) { clear(); bind(null); return; }
    bind(state.video);
    // The visible player's switch is authoritative, even if a track reply arrives late.
    if (!state.captionsEnabled) { if (panel) panel.hidden = true; return; }
    place(state); if (panel) panel.hidden = false;
  }
  function schedule() { if (queued === null) queued = setTimeout(sync, 80); }
  function bind(video) {
    if (media === video) return;
    if (media) for (const event of ['timeupdate', 'seeked', 'loadedmetadata']) media.removeEventListener(event, updateActive);
    media = video;
    if (media) for (const event of ['timeupdate', 'seeked', 'loadedmetadata']) media.addEventListener(event, updateActive);
  }
  function render() {
    if (!panel) return;
    const next = JSON.stringify(data);
    if (next === signature) return;
    signature = next; rows = C.rows(data?.primary || [], data?.secondary || []); buttons = []; active = []; prefixEnds = [];
    heading.textContent = data?.label || '';
    const messages = { off: '请在播放器中开启字幕', loading: '正在读取网页所选字幕…', unavailable: '暂未读取到所选轨道，请切换字幕或刷新视频页' };
    const secondaryNote = data?.secondaryStatus === 'loading' ? ' · 副字幕读取中' : data?.secondaryStatus === 'unavailable' ? ' · 副字幕暂未读到' : '';
    status.textContent = rows.length ? `${rows.length} 段 · 点击字幕跳转${secondaryNote}` : messages[data?.status] || '等待网页字幕轨道…';
    const fragment = document.createDocumentFragment();
    for (const [index, cue] of rows.entries()) {
      const row = element('button', 'cctracker-cue'); row.type = 'button'; 
      const time = element('span', 'cctracker-cue-time', C.clock(cue.start));
      const words = element('span', 'cctracker-cue-words');
      if (cue.translation) words.append(element('span', 'cctracker-cue-secondary', cue.translation));
      if (cue.text) words.append(element('span', 'cctracker-cue-original', cue.text));
      row.append(time, words);
      row.setAttribute('aria-label', `${C.clock(cue.start)} ${cue.translation ? cue.translation + ' ' : ''}${cue.text}`);
      row.addEventListener('click', () => {
        const current = CCTrackerAdapters.read(document, location.href);
        if (!current || C.identity(location.href) !== key || !Number.isFinite(current.video.duration)) return;
        current.video.currentTime = Math.min(cue.start, current.video.duration);
        // Preserve pause; a timeline jump does not start playback or override captions.
        updateActive(true);
      });
      prefixEnds[index] = Math.max(prefixEnds[index - 1] || 0, cue.end);
      buttons.push(row); const item = element('div'); item.setAttribute('role', 'listitem'); item.append(row); fragment.append(item);
    }
    list.replaceChildren(fragment); expectedScroll = list.scrollTop; updateActive(true);
  }
  function updateActive(forceScroll = false) {
    if (!media || !list || panel?.hidden) return;
    const time = media.currentTime || 0;
    let low = 0, high = rows.length;
    while (low < high) { const mid = (low + high) >>> 1; if (rows[mid].start <= time) low = mid + 1; else high = mid; }
    const next = [];
    for (let i = low - 1; i >= 0 && prefixEnds[i] > time; i--) if (rows[i].end > time) next.unshift(i);
    const changed = next.join(',') !== active.join(',');
    if (!changed && forceScroll !== true) return;
    for (const i of active) { buttons[i]?.classList.remove('cctracker-cue-active'); buttons[i]?.removeAttribute('aria-current'); }
    for (const i of next) { buttons[i].classList.add('cctracker-cue-active'); buttons[i].setAttribute('aria-current', 'true'); }
    active = next;
    const target = next[0] ?? (forceScroll === true && rows.length ? Math.max(0, low - 1) : null);
    if (auto && target !== null && !panel.querySelector('.cctracker-timeline-body').hidden) {
      const row = buttons[target], top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      // Scroll only this list, never the whole video page.
      if (forceScroll === true || top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
        const destination = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, top - list.clientHeight / 3));
        if (Math.abs(list.scrollTop - destination) > 1) { expectedScroll = destination; list.scrollTop = destination; }
      }
    }
  }
  addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || !C.validMessage(event.data, C.identity(location.href))) return;
    sync();
    if (panel) panel.dataset.captionError = typeof event.data.captionError === 'string' ? event.data.captionError.slice(0, 40) : '';
    if (panel) panel.dataset.trackState = ['metadata', 'selection', 'caption', 'ready'].includes(event.data.diagnostic) ? event.data.diagnostic : '';
    if (panel) panel.dataset.secondaryState = event.data.secondaryStatus || '';
    data = { enabled: event.data.enabled, status: event.data.status, label: event.data.label, secondaryStatus: event.data.secondaryStatus,
      primary: C.normalize(event.data.primary), secondary: C.normalize(event.data.secondary) };
    render();
  });
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => !panel?.contains(m.target))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'checked'] });
  addEventListener('popstate', schedule);
  addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(queued); queued = null; clear(); bind(null); });
  addEventListener('pageshow', event => {
    if (event.persisted) { observer.observe(document.documentElement, { childList: true, subtree: true }); sync(); window.postMessage({ source: 'cctracker-timeline-ready' }, location.origin); }
  });
  sync(); window.postMessage({ source: 'cctracker-timeline-ready' }, location.origin);
})();
