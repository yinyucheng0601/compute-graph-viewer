/**
 * nav.js — Inline pass navigator for index.html
 */
(function () {
  const PTO_BASE_PREFIX = typeof window.PTO_BASE_PREFIX === 'string' ? window.PTO_BASE_PREFIX : '';
  const PTO_PASS_IR_ENTRY = typeof window.PTO_PASS_IR_ENTRY === 'string'
    ? window.PTO_PASS_IR_ENTRY
    : `${PTO_BASE_PREFIX}pass-ir/index.html`;

  function ptoUrl(path) {
    return `${PTO_BASE_PREFIX}${path}`;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  const navBar = document.getElementById('navBar');
  const navTimeline = document.getElementById('navTimeline');
  const navTimelineWrap = document.getElementById('navTimelineWrap');

  const navPassWrap = document.getElementById('navPassWrap');
  const navPassLabel = document.getElementById('navPassLabel');
  const navPassMenu = document.getElementById('navPassMenu');

  const navPathWrap = document.getElementById('navPathWrap');
  const navPathLabel = document.getElementById('navPathLabel');
  const navPathMenu = document.getElementById('navPathMenu');

  const navSideWrap = document.getElementById('navSideWrap');
  const navSideLabel = document.getElementById('navSideLabel');
  const navSideMenu = document.getElementById('navSideMenu');

  const navSnapWrap = document.getElementById('navSnapWrap');
  const navSnapLabel = document.getElementById('navSnapLabel');
  const navSnapMenu = document.getElementById('navSnapMenu');

  const navSourceTag = document.getElementById('navSourceTag');

  function initLegacyNavigator() {
    const track = document.getElementById('timelineTrack');
    const stageBar = document.getElementById('stageBar');
    const detailEmpty = document.getElementById('detailEmpty');
    const detailContent = document.getElementById('detailContent');
    const passIndexEl = document.getElementById('passIndex');
    const passNameEl = document.getElementById('passName');
    const passStageBadge = document.getElementById('passStageBadge');
    const passDirEl = document.getElementById('passDir');
    const pathChips = document.getElementById('pathChips');
    const snapButtons = document.getElementById('snapButtons');
    const filePreview = document.getElementById('filePreview');
    const openBtn = document.getElementById('openViewerBtn');

    if (!track || !stageBar || !detailEmpty || !detailContent) return;

    let legacyIndex = null;
    let activePass = null;
    let activePath = null;
    let activeFile = null;

    const LEGACY_STAGE_COLORS = {
      Tensor: '#6B92FF',
      Tile: '#6ADB02',
      Split: '#FA6401',
      'Block/Execute': '#D8B900',
    };

    fetch(ptoUrl('nav_index.json'))
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then(data => { legacyIndex = data; buildLegacyTimeline(); })
      .catch(() => {
        const text = detailEmpty.querySelector('p');
        if (text) text.textContent = 'nav_index.json missing. Run: node scan_passes.js';
      });

    function buildLegacyTimeline() {
      track.innerHTML = '';
      stageBar.innerHTML = '';
      const passes = legacyIndex.passes;
      const slotW = 36;

      legacyIndex.stages.forEach(stage => {
        const inStage = passes.filter(p => p.pass_index >= stage.range[0] && p.pass_index <= stage.range[1]);
        if (!inStage.length) return;
        const firstSlot = passes.indexOf(inStage[0]);
        const lastSlot = passes.indexOf(inStage[inStage.length - 1]);

        const lbl = document.createElement('div');
        lbl.className = 'timeline-stage-label';
        lbl.textContent = stage.label;
        lbl.style.color = stage.color;
        lbl.style.left = (24 + firstSlot * slotW) + 'px';
        lbl.style.width = ((lastSlot - firstSlot + 1) * slotW) + 'px';
        stageBar.appendChild(lbl);
      });

      passes.forEach((pass, i) => {
        const color = LEGACY_STAGE_COLORS[pass.stage] || '#888';
        const wrap = document.createElement('div');
        wrap.className = 'pass-dot-wrap';
        wrap.style.color = color;
        wrap.title = `Pass ${pass.pass_index}: ${pass.pass_name}`;
        wrap.innerHTML = `<div class="pass-dot"></div><div class="pass-label">${String(pass.pass_index).padStart(2, '0')}</div>`;
        wrap.addEventListener('click', () => selectLegacyPass(i));
        track.appendChild(wrap);
      });
    }

    function selectLegacyPass(idx) {
      activePass = legacyIndex.passes[idx];
      activePath = activePass.paths[0] || null;
      activeFile = null;

      document.querySelectorAll('.pass-dot-wrap').forEach((el, i) => {
        el.classList.toggle('active', i === idx);
      });
      document.querySelectorAll('.pass-dot-wrap')[idx]
        ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

      showLegacyDetail();
    }

    function showLegacyDetail() {
      detailEmpty.style.display = 'none';
      detailContent.style.display = 'flex';
      passIndexEl.textContent = String(activePass.pass_index).padStart(2, '0');
      passNameEl.textContent = activePass.pass_name;
      passDirEl.textContent = activePass.dir;

      const color = LEGACY_STAGE_COLORS[activePass.stage] || '#888';
      passStageBadge.textContent = activePass.stage;
      passStageBadge.style.color = color;
      passStageBadge.style.background = color + '22';
      passStageBadge.style.borderColor = color + '44';

      renderLegacyPaths();
      renderLegacySnaps();
      updateLegacyPreview();
    }

    function renderLegacyPaths() {
      pathChips.innerHTML = '';
      activePass.paths.forEach(p => {
        const chip = document.createElement('div');
        chip.className = 'path-chip' + (p === activePath ? ' active' : '');
        chip.innerHTML = `<div class="path-chip-id">${p.path_id}</div><div class="path-chip-label" title="${p.path_label}">${p.path_label}</div>`;
        chip.addEventListener('click', () => {
          activePath = p;
          activeFile = null;
          renderLegacyPaths();
          renderLegacySnaps();
          updateLegacyPreview();
        });
        pathChips.appendChild(chip);
      });
    }

    function renderLegacySnaps() {
      snapButtons.innerHTML = '';
      if (!activePath) return;
      const snaps = activePath.snapshots;
      const mainSnaps = snaps.filter(s => s.snap_type !== 'LEAF');
      const leafSnaps = snaps.filter(s => s.snap_type === 'LEAF');

      function makeBtn(filePath, label) {
        const btn = document.createElement('button');
        btn.className = 'snap-btn' + (filePath && filePath === activeFile ? ' active' : '');
        btn.textContent = label;
        if (!filePath) {
          btn.disabled = true;
          return btn;
        }
        btn.addEventListener('click', () => {
          activeFile = filePath;
          renderLegacySnaps();
          updateLegacyPreview();
        });
        return btn;
      }

      const mainRow = document.createElement('div');
      mainRow.className = 'snap-buttons';
      mainSnaps.forEach(s => {
        if (s.snap_type === 'main') {
          mainRow.appendChild(makeBtn(s.before, 'Before'));
          mainRow.appendChild(makeBtn(s.after, 'After'));
        } else if (s.snap_type === 'ROOT') {
          mainRow.appendChild(makeBtn(s.before, 'ROOT Before'));
          mainRow.appendChild(makeBtn(s.after, 'ROOT After'));
        }
      });
      snapButtons.appendChild(mainRow);

      if (leafSnaps.length > 0) {
        const group = document.createElement('div');
        group.className = 'snap-group';
        const lbl = document.createElement('div');
        lbl.className = 'snap-group-label';
        lbl.textContent = 'Leaf Graphs';
        group.appendChild(lbl);

        const leafRow = document.createElement('div');
        leafRow.className = 'snap-buttons';
        leafSnaps.forEach(s => {
          const pid = s.program_id || '?';
          leafRow.appendChild(makeBtn(s.before, `L${pid} B`));
          leafRow.appendChild(makeBtn(s.after, `L${pid}`));
        });
        group.appendChild(leafRow);
        snapButtons.appendChild(group);
      }
    }

    function updateLegacyPreview() {
      if (activeFile) {
        filePreview.textContent = activeFile;
        filePreview.classList.remove('no-file');
        openBtn.disabled = false;
        openBtn.dataset.file = activeFile;
      } else {
        filePreview.textContent = 'Select a snapshot above';
        filePreview.classList.add('no-file');
        openBtn.disabled = true;
        openBtn.dataset.file = '';
      }
    }

    openBtn?.addEventListener('click', () => {
      const f = openBtn.dataset.file;
      if (f) window.open(`${PTO_PASS_IR_ENTRY}?file=` + encodeURIComponent(f), '_blank');
    });

    detailContent.style.display = 'none';
    detailEmpty.style.display = 'flex';
  }

  // Support both standalone navigator fallback and inline navigator in pass-ir/index.html.
  if (!navBar || !navTimeline || !navPassWrap || !navPathWrap || !navSideWrap || !navSnapWrap) {
    initLegacyNavigator();
    return;
  }

  // Always use 'after'; hide the side pill.
  navSideWrap.style.display = 'none';

  // ── State ────────────────────────────────────────────────────────────────
  let navIndex = null;
  let navMeta = {};
  let activeLoop = 'MAIN';   // 'RESHAPE' | 'MAIN'
  let activeUnroll = 32;     // 32|16|8|4|2|1 — only meaningful when activeLoop === 'MAIN'
  let activePath = null;     // derived from loop + unroll
  let activeIdx = null;      // index into navIndex.passes
  let activeSide = 'after';  // after|before
  let activeSnap = 'main';   // main|ROOT|LEAF_xx

  // Static path mapping: loop+unroll → path_id
  const PATH_MAP = {
    RESHAPE: 'PATH0_4',
    MAIN: { 32: 'PATH0_6', 16: 'PATH0_8', 8: 'PATH0_10', 4: 'PATH0_12', 2: 'PATH0_14', 1: 'PATH0_16' },
  };
  const UNROLL_ORDER = [32, 16, 8, 4, 2, 1];
  // Inverse of PATH_MAP.MAIN for fallback detection
  const UNROLL_FROM_PATH = Object.fromEntries(
    Object.entries(PATH_MAP.MAIN).map(([k, v]) => [v, Number(k)])
  );

  const STAGE_STYLE = {
    Tensor:          { color: '#6B92FF', cls: 'stage-tensor' },
    Tile:            { color: '#6ADB02', cls: 'stage-tile' },
    Split:           { color: '#6ADB02', cls: 'stage-tile' },  // compat — rendered as Tile
    Block:           { color: '#D8B900', cls: 'stage-block' },
    Execute:         { color: '#2BADA8', cls: 'stage-execute' },
    'Block/Execute': { color: '#D8B900', cls: 'stage-block' },
    Unknown:         { color: '#8A8A8A', cls: 'stage-unknown' },
  };

  function stageForPass(pass) {
    if (!pass) return 'Unknown';
    if (pass.stage === 'Split') return 'Tile';  // old nav_index.json compat
    if (pass.stage === 'Block/Execute') return pass.pass_index >= 33 ? 'Execute' : 'Block';
    return pass.stage || 'Unknown';
  }

  function stageStyle(stageName) {
    return STAGE_STYLE[stageName] || STAGE_STYLE.Unknown;
  }

  function passTag(pass) {
    return `P${String(pass.pass_index).padStart(2, '0')}`;
  }

  function normalizeLeafKey(k) {
    const m = String(k || '').match(/^LEAF_(\d+)$/);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  }

  function snapLabel(key) {
    if (key === 'main') return 'main';
    if (key === 'ROOT') return 'root';
    if (key.startsWith('LEAF_')) return 'leaf' + key.slice(5);
    return String(key || '').toLowerCase();
  }

  function derivePath() {
    if (activeLoop === 'RESHAPE') return PATH_MAP.RESHAPE;
    return PATH_MAP.MAIN[activeUnroll] || null;
  }

  // All path IDs present anywhere in the index (for loop availability)
  function allPathIds() {
    const ids = new Set();
    navIndex.passes.forEach(p => p.paths.forEach(q => ids.add(q.path_id)));
    return ids;
  }

  function availableLoops() {
    const ids = allPathIds();
    const loops = [];
    if (ids.has(PATH_MAP.RESHAPE)) loops.push('RESHAPE');
    if (UNROLL_ORDER.some(u => ids.has(PATH_MAP.MAIN[u]))) loops.push('MAIN');
    return loops;
  }

  // Which unroll factors are present in pass i
  function availableUnrolls(passIdx) {
    const paths = navIndex.passes[passIdx]?.paths || [];
    const pathIds = new Set(paths.map(p => p.path_id));
    return UNROLL_ORDER.filter(u => pathIds.has(PATH_MAP.MAIN[u]));
  }

  function updateSourceTag() {
    if (!navSourceTag) return;
    const label = navMeta.sourceLabel || navIndex?.base_path || 'index';
    navSourceTag.textContent = label;
    navSourceTag.title = label;
    navSourceTag.classList.toggle('visible', label && label !== 'output_deepseek');
  }

  // ── Dot Tooltip ──────────────────────────────────────────────────────────
  let dotTooltip = null;

  function createDotTooltip() {
    if (dotTooltip) return;
    dotTooltip = Object.assign(document.createElement('div'), { className: 'nav-dot-tooltip' });
    document.body.appendChild(dotTooltip);
  }

  // ── Inbound API ──────────────────────────────────────────────────────────
  function setNavIndex(data, meta = {}) {
    if (!data || !Array.isArray(data.passes) || !data.passes.length) return;
    navIndex = data;
    navMeta = meta || {};
    navBar.classList.remove('hidden');
    updateSourceTag();

    const loops = availableLoops();
    activeLoop = loops.includes('RESHAPE') ? 'RESHAPE' : (loops[0] || 'MAIN');
    activeUnroll = 32;
    activePath = derivePath();

    createDotTooltip();
    buildTimeline();
    rebuildLoopMenu();
    selectPass(0);
  }

  window.setNavIndex = setNavIndex;
  window.navSelectPath = selectPath;

  // ── Initial load ─────────────────────────────────────────────────────────
  fetch(ptoUrl('nav_index.json'))
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => setNavIndex(data, { sourceLabel: data.base_path }))
    .catch(() => { /* optional navigator; keep hidden without index */ });

  // ── Timeline ─────────────────────────────────────────────────────────────
  function buildTimeline() {
    navTimeline.innerHTML = '';
    let groupStage = null;
    let groupDots = null;
    let groupFirstIndex = 0;

    navIndex.passes.forEach((pass, i) => {
      const stage = stageForPass(pass);
      if (stage !== groupStage) {
        groupStage = stage;
        groupFirstIndex = i;
        const style = stageStyle(stage);

        const group = document.createElement('div');
        group.className = 'nav-stage-group';

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `nav-stage-chip ${style.cls}`;
        chip.textContent = stage;
        chip.style.setProperty('--stage-color', style.color);
        chip.title = `Jump to ${stage}`;
        chip.addEventListener('click', () => selectPass(groupFirstIndex));
        group.appendChild(chip);

        groupDots = document.createElement('div');
        groupDots.className = 'nav-stage-dots';
        group.appendChild(groupDots);

        navTimeline.appendChild(group);
      }

      const style = stageStyle(stage);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'nav-pass-dot';
      dot.dataset.i = String(i);
      dot.style.setProperty('--dot-color', style.color);
      dot.addEventListener('click', () => selectPass(i));
      dot.addEventListener('mouseenter', () => {
        dotTooltip.textContent = `P${String(pass.pass_index).padStart(2, '0')} · ${pass.pass_name}`;
        const r = dot.getBoundingClientRect();
        dotTooltip.style.left = (r.left + r.width / 2) + 'px';
        dotTooltip.style.top = r.top + 'px';
        dotTooltip.style.display = 'block';
      });
      dot.addEventListener('mouseleave', () => { dotTooltip.style.display = 'none'; });
      groupDots.appendChild(dot);
    });
  }

  // ── Menus ────────────────────────────────────────────────────────────────
  function rebuildLoopMenu() {
    navPassMenu.innerHTML = '';
    const loops = availableLoops();
    loops.forEach(loop => {
      const item = document.createElement('div');
      item.className = 'nav-pill-item' + (loop === activeLoop ? ' active' : '');
      item.textContent = loop;
      item.addEventListener('click', () => {
        navPassWrap.classList.remove('open');
        selectLoop(loop);
      });
      navPassMenu.appendChild(item);
    });
    navPassLabel.textContent = 'loop';
  }

  function rebuildUnrollMenu() {
    if (activeLoop === 'RESHAPE') {
      navPathWrap.style.display = 'none';
      return;
    }
    navPathWrap.style.display = '';
    navPathMenu.innerHTML = '';

    const unrolls = activeIdx !== null ? availableUnrolls(activeIdx) : UNROLL_ORDER;
    const list = unrolls.length > 0 ? unrolls : UNROLL_ORDER;

    list.forEach(u => {
      const item = document.createElement('div');
      item.className = 'nav-pill-item' + (u === activeUnroll ? ' active' : '');
      item.textContent = '×' + u;
      item.addEventListener('click', () => {
        navPathWrap.classList.remove('open');
        selectUnroll(u);
      });
      navPathMenu.appendChild(item);
    });
    navPathLabel.textContent = 'unroll';
  }

  function rebuildSnapMenu() {
    const path = activeIdx !== null
      ? navIndex.passes[activeIdx]?.paths.find(p => p.path_id === activePath)
      : null;

    if (!path) {
      navSnapWrap.style.visibility = 'hidden';
      navSnapWrap.classList.remove('snap-main', 'snap-root', 'snap-leaf');
      return;
    }

    const keys = [];
    path.snapshots.forEach(s => {
      const key = s.snap_type === 'LEAF' ? `LEAF_${s.program_id}` : s.snap_type;
      if (!keys.includes(key)) keys.push(key);
    });

    const hasExtras = keys.some(k => k !== 'main');
    if (!hasExtras) {
      navSnapWrap.style.visibility = 'hidden';
      activeSnap = 'main';
      navSnapLabel.textContent = 'main';
      navSnapWrap.classList.remove('snap-main', 'snap-root', 'snap-leaf');
      return;
    }

    navSnapWrap.style.visibility = 'visible';
    navSnapMenu.innerHTML = '';

    const leafKeys = keys.filter(k => k.startsWith('LEAF_')).sort((a, b) => normalizeLeafKey(a) - normalizeLeafKey(b));
    const ordered = ['main', 'ROOT', ...leafKeys].filter(k => keys.includes(k));
    if (!ordered.includes(activeSnap)) activeSnap = ordered[0];

    ordered.forEach(key => {
      const item = document.createElement('div');
      item.className = 'nav-pill-item' + (key === activeSnap ? ' active' : '');
      item.textContent = snapLabel(key);
      item.addEventListener('click', () => {
        activeSnap = key;
        navSnapWrap.classList.remove('open');
        rebuildSnapMenu();
        loadCurrent();
      });
      navSnapMenu.appendChild(item);
    });

    navSnapLabel.textContent = snapLabel(activeSnap);
    navSnapWrap.classList.remove('snap-main', 'snap-root', 'snap-leaf');
    if (activeSnap.startsWith('LEAF_')) navSnapWrap.classList.add('snap-leaf');
    else if (activeSnap === 'ROOT') navSnapWrap.classList.add('snap-root');
    else navSnapWrap.classList.add('snap-main');
  }

  navSideMenu.querySelectorAll('.nav-pill-item').forEach(item => {
    item.addEventListener('click', () => {
      activeSide = item.dataset.value;
      navSideLabel.textContent = item.textContent.trim();
      navSideWrap.classList.remove('open');
      navSideMenu.querySelectorAll('.nav-pill-item')
        .forEach(el => el.classList.toggle('active', el.dataset.value === activeSide));
      loadCurrent();
    });
  });

  // ── Selection ────────────────────────────────────────────────────────────
  function selectLoop(loop) {
    activeLoop = loop;
    if (activeLoop === 'MAIN') {
      const unrolls = activeIdx !== null ? availableUnrolls(activeIdx) : UNROLL_ORDER;
      if (!unrolls.includes(activeUnroll)) {
        activeUnroll = unrolls[0] || 32;
      }
    }
    activePath = derivePath();
    activeSnap = 'main';
    rebuildLoopMenu();
    rebuildUnrollMenu();
    rebuildSnapMenu();
    if (window.cfHighlightPath) window.cfHighlightPath(activePath);
    loadCurrent();
  }

  function selectUnroll(factor) {
    activeUnroll = factor;
    activePath = derivePath();
    activeSnap = 'main';
    rebuildUnrollMenu();
    rebuildSnapMenu();
    if (window.cfHighlightPath) window.cfHighlightPath(activePath);
    loadCurrent();
  }

  function selectPath(pathId) {
    const UNROLL_FROM_PATH = { PATH0_6:32, PATH0_8:16, PATH0_10:8, PATH0_12:4, PATH0_14:2, PATH0_16:1 };
    if (pathId === 'PATH0_4') {
      activeLoop = 'RESHAPE';
    } else {
      const unroll = UNROLL_FROM_PATH[pathId];
      if (!unroll) return;
      activeLoop = 'MAIN';
      activeUnroll = unroll;
    }
    activePath = pathId;
    activeSnap = 'main';
    rebuildLoopMenu();
    rebuildUnrollMenu();
    rebuildSnapMenu();
    loadCurrent();
  }

  function selectPass(i) {
    if (!navIndex?.passes?.[i]) return;
    activeIdx = i;

    const pass = navIndex.passes[i];
    const hasCurrentPath = pass.paths.some(p => p.path_id === activePath);

    if (!hasCurrentPath) {
      // Try to stay in current loop
      if (activeLoop === 'MAIN') {
        const unrolls = availableUnrolls(i);
        if (!unrolls.includes(activeUnroll) && unrolls.length > 0) {
          activeUnroll = unrolls[0];
        }
      }
      activePath = derivePath();

      // If still not found, take the first available path in this pass
      if (!pass.paths.some(p => p.path_id === activePath)) {
        const first = pass.paths[0];
        if (first) {
          activePath = first.path_id;
          if (activePath === PATH_MAP.RESHAPE) {
            activeLoop = 'RESHAPE';
          } else {
            activeLoop = 'MAIN';
            activeUnroll = UNROLL_FROM_PATH[activePath] || 32;
          }
        }
      }
      activeSnap = 'main';
    }

    navTimeline.querySelectorAll('.nav-pass-dot').forEach(dot => {
      dot.classList.toggle('active', parseInt(dot.dataset.i, 10) === i);
    });

    rebuildLoopMenu();
    rebuildUnrollMenu();
    rebuildSnapMenu();
    loadCurrent();
    centerActiveDot();
  }

  function centerActiveDot() {
    const activeDot = navTimeline.querySelector('.nav-pass-dot.active');
    if (!activeDot) return;
    const left = activeDot.offsetLeft;
    const wrapW = navTimelineWrap.clientWidth;
    navTimelineWrap.scrollTo({ left: left - wrapW / 2 + 6, behavior: 'smooth' });
  }

  // ── File loading ─────────────────────────────────────────────────────────
  function resolveSnapshotFile(snapshot) {
    if (!snapshot) return null;
    const prefer = activeSide === 'before' ? snapshot.before : snapshot.after;
    const fallback = activeSide === 'before' ? snapshot.after : snapshot.before;
    return prefer || fallback || null;
  }

  function loadCurrent() {
    if (activeIdx === null || !activePath) return;
    const pass = navIndex.passes[activeIdx];
    const path = pass.paths.find(p => p.path_id === activePath);
    if (!path) return;

    let snap = null;
    if (activeSnap.startsWith('LEAF_')) {
      const pid = activeSnap.slice(5);
      snap = path.snapshots.find(s => s.snap_type === 'LEAF' && String(s.program_id) === String(pid));
    } else {
      snap = path.snapshots.find(s => s.snap_type === activeSnap);
    }

    const fileRef = resolveSnapshotFile(snap);
    if (fileRef && window.loadFile) window.loadFile(fileRef);
  }

  // ── Dropdown toggles ─────────────────────────────────────────────────────
  const allWraps = [navPassWrap, navPathWrap, navSideWrap, navSnapWrap];
  allWraps.forEach(wrap => {
    const pill = wrap.querySelector('.nav-pill');
    if (!pill) return;
    pill.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = wrap.classList.contains('open');
      allWraps.forEach(w => w.classList.remove('open'));
      if (!isOpen) wrap.classList.add('open');
    });
  });

  document.addEventListener('click', () => {
    allWraps.forEach(w => w.classList.remove('open'));
  });
})();
