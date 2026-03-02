/**
 * nav.js — Pass Navigator logic
 */

(function () {

  // ── State ───────────────────────────────────────────────────────────────
  let navIndex   = null;   // full nav_index.json
  let activePass = null;   // passes[i]
  let activePath = null;   // paths[j]
  let activeFile = null;   // string | null — currently selected file path

  // ── DOM ─────────────────────────────────────────────────────────────────
  const track          = document.getElementById('timelineTrack');
  const stageBar       = document.getElementById('stageBar');
  const detailEmpty    = document.getElementById('detailEmpty');
  const detailContent  = document.getElementById('detailContent');
  const passIndexEl    = document.getElementById('passIndex');
  const passNameEl     = document.getElementById('passName');
  const passStageBadge = document.getElementById('passStageBadge');
  const passDirEl      = document.getElementById('passDir');
  const pathChips      = document.getElementById('pathChips');
  const snapButtons    = document.getElementById('snapButtons');
  const filePreview    = document.getElementById('filePreview');
  const openBtn        = document.getElementById('openViewerBtn');

  // ── Stage colors ────────────────────────────────────────────────────────
  const STAGE_COLORS = {
    'Tensor':        '#87C80F',
    'Tile':          '#3577F6',
    'Split':         '#A855F7',
    'Block/Execute': '#C9107D',
  };

  // ── Load nav_index.json ─────────────────────────────────────────────────
  fetch('nav_index.json')
    .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
    .then(data => { navIndex = data; buildTimeline(); })
    .catch(() => {
      detailEmpty.querySelector('p').textContent =
        'nav_index.json missing. Run: node scan_passes.js';
    });

  // ── Timeline ─────────────────────────────────────────────────────────────

  function buildTimeline() {
    track.innerHTML  = '';
    stageBar.innerHTML = '';

    const passes = navIndex.passes;
    const SLOT_W = 36; // px per pass slot

    // Stage range labels
    navIndex.stages.forEach(stage => {
      const inStage  = passes.filter(p => p.pass_index >= stage.range[0] && p.pass_index <= stage.range[1]);
      if (!inStage.length) return;
      const firstSlot = passes.indexOf(inStage[0]);
      const lastSlot  = passes.indexOf(inStage[inStage.length - 1]);

      const lbl = document.createElement('div');
      lbl.className    = 'timeline-stage-label';
      lbl.textContent  = stage.label;
      lbl.style.color  = stage.color;
      lbl.style.left   = (24 + firstSlot * SLOT_W) + 'px';
      lbl.style.width  = ((lastSlot - firstSlot + 1) * SLOT_W) + 'px';
      stageBar.appendChild(lbl);
    });

    // Pass dots
    passes.forEach((pass, i) => {
      const color = STAGE_COLORS[pass.stage] ?? '#888';
      const wrap  = document.createElement('div');
      wrap.className  = 'pass-dot-wrap';
      wrap.style.color = color;
      wrap.title      = `Pass ${pass.pass_index}: ${pass.pass_name}`;

      wrap.innerHTML = `
        <div class="pass-dot"></div>
        <div class="pass-label">${String(pass.pass_index).padStart(2, '0')}</div>`;
      wrap.addEventListener('click', () => selectPass(i));
      track.appendChild(wrap);
    });
  }

  function selectPass(idx) {
    const pass = navIndex.passes[idx];
    activePass = pass;
    activePath = pass.paths[0] ?? null;
    activeFile = null;

    document.querySelectorAll('.pass-dot-wrap').forEach((el, i) =>
      el.classList.toggle('active', i === idx));

    const dots = document.querySelectorAll('.pass-dot-wrap');
    dots[idx]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

    showDetail();
  }

  // ── Detail panel ──────────────────────────────────────────────────────────

  function showDetail() {
    detailEmpty.style.display   = 'none';
    detailContent.style.display = 'flex';

    passIndexEl.textContent = String(activePass.pass_index).padStart(2, '0');
    passNameEl.textContent  = activePass.pass_name;
    passDirEl.textContent   = activePass.dir;

    const color = STAGE_COLORS[activePass.stage] ?? '#888';
    passStageBadge.textContent       = activePass.stage;
    passStageBadge.style.color       = color;
    passStageBadge.style.background  = color + '22';
    passStageBadge.style.borderColor = color + '44';

    renderPaths();
    renderSnaps();
    updateFilePreview();
  }

  function renderPaths() {
    pathChips.innerHTML = '';
    activePass.paths.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'path-chip' + (p === activePath ? ' active' : '');
      chip.innerHTML = `
        <div class="path-chip-id">${p.path_id}</div>
        <div class="path-chip-label" title="${p.path_label}">${p.path_label}</div>`;
      chip.addEventListener('click', () => {
        activePath = p;
        activeFile = null;
        renderPaths();
        renderSnaps();
        updateFilePreview();
      });
      pathChips.appendChild(chip);
    });
  }

  function renderSnaps() {
    snapButtons.innerHTML = '';
    if (!activePath) return;

    const snaps    = activePath.snapshots;
    const mainSnaps = snaps.filter(s => s.snap_type !== 'LEAF');
    const leafSnaps = snaps.filter(s => s.snap_type === 'LEAF');

    function makeBtn(filePath, label) {
      const btn = document.createElement('button');
      btn.className   = 'snap-btn' + (filePath && filePath === activeFile ? ' active' : '');
      btn.textContent = label;
      if (!filePath) { btn.disabled = true; return btn; }
      btn.addEventListener('click', () => {
        activeFile = filePath;
        renderSnaps();
        updateFilePreview();
      });
      return btn;
    }

    // Main / ROOT row
    const mainRow = document.createElement('div');
    mainRow.className = 'snap-buttons';
    mainSnaps.forEach(snap => {
      if (snap.snap_type === 'main') {
        mainRow.appendChild(makeBtn(snap.before, 'Before'));
        mainRow.appendChild(makeBtn(snap.after,  'After'));
      } else if (snap.snap_type === 'ROOT') {
        mainRow.appendChild(makeBtn(snap.before, 'ROOT Before'));
        mainRow.appendChild(makeBtn(snap.after,  'ROOT After'));
      }
    });
    snapButtons.appendChild(mainRow);

    // LEAF group
    if (leafSnaps.length > 0) {
      const group = document.createElement('div');
      group.className = 'snap-group';

      const lbl = document.createElement('div');
      lbl.className   = 'snap-group-label';
      lbl.textContent = 'Leaf Graphs';
      group.appendChild(lbl);

      const leafRow = document.createElement('div');
      leafRow.className = 'snap-buttons';
      leafSnaps.forEach(snap => {
        const pid = snap.program_id ?? '?';
        leafRow.appendChild(makeBtn(snap.before, `L${pid} B`));
        leafRow.appendChild(makeBtn(snap.after,  `L${pid}`));
      });
      group.appendChild(leafRow);
      snapButtons.appendChild(group);
    }
  }

  function updateFilePreview() {
    if (activeFile) {
      filePreview.textContent = activeFile;
      filePreview.classList.remove('no-file');
      openBtn.disabled      = false;
      openBtn.dataset.file  = activeFile;
    } else {
      filePreview.textContent = 'Select a snapshot above';
      filePreview.classList.add('no-file');
      openBtn.disabled      = true;
      openBtn.dataset.file  = '';
    }
  }

  // ── Open in Viewer ────────────────────────────────────────────────────────

  openBtn.addEventListener('click', () => {
    const f = openBtn.dataset.file;
    if (f) window.open('index.html?file=' + encodeURIComponent(f), '_blank');
  });

  // ── Initial state ─────────────────────────────────────────────────────────
  detailContent.style.display = 'none';
  detailEmpty.style.display   = 'flex';

})();
