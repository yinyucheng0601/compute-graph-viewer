/* 信息说明 popover：面板右上角 info icon + 事故标签点击 → 解释。
   单例 popover，锚定触发元素，点击外部/Esc 关闭。 */
window.Info = (function () {
  let pop = null, openTrigger = null;

  function ensure() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'ts-infopop';
    pop.innerHTML = '<div class="ts-infopop-title"></div><div class="ts-infopop-body"></div>';
    document.body.appendChild(pop);
    document.addEventListener('click', e => {
      if (pop.classList.contains('is-open') && !pop.contains(e.target) && openTrigger && !openTrigger.contains(e.target)) close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', close);
    return pop;
  }

  function place(trigger) {
    const r = trigger.getBoundingClientRect(), p = ensure(), pad = 10;
    let left = Math.min(r.right - p.offsetWidth, window.innerWidth - p.offsetWidth - pad);
    left = Math.max(pad, left);
    let top = r.bottom + 8;
    if (top + p.offsetHeight > window.innerHeight - pad) top = Math.max(pad, r.top - p.offsetHeight - 8);
    p.style.left = left + 'px';
    p.style.top = top + 'px';
  }

  function open(trigger, title, html) {
    const p = ensure();
    p.querySelector('.ts-infopop-title').textContent = title;
    p.querySelector('.ts-infopop-body').innerHTML = html;
    p.classList.add('is-open');
    openTrigger = trigger;
    place(trigger);
  }
  function close() { if (pop) { pop.classList.remove('is-open'); openTrigger = null; } }
  function toggle(trigger, title, html) {
    if (pop && pop.classList.contains('is-open') && openTrigger === trigger) close();
    else open(trigger, title, html);
  }

  function attach(trigger, title, html) {
    trigger.classList.add('has-info');
    trigger.addEventListener('click', e => { e.stopPropagation(); toggle(trigger, title, html); });
  }

  function addPaneInfo(paneSel, title, html) {
    const head = document.querySelector(paneSel + ' .pane-head');
    if (!head) return;
    if (!head.querySelector('.spacer')) { const sp = document.createElement('span'); sp.className = 'spacer'; head.appendChild(sp); }
    const btn = document.createElement('button');
    btn.className = 'info-btn'; btn.type = 'button';
    btn.setAttribute('aria-label', '面板说明'); btn.title = '面板说明';
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="5.1" r="0.95" fill="currentColor"/><rect x="7.25" y="6.9" width="1.5" height="4.4" rx="0.75" fill="currentColor"/></svg>';
    head.appendChild(btn);
    attach(btn, title, html);
  }

  return { attach, addPaneInfo };
})();
