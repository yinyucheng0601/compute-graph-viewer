/**
 * pass_cause_panel.js - Right-side cause explanation panel.
 */
(function () {
  const STEP_EVENT = 'pto-pass-cause:step-change';
  let panel = null;
  let body = null;
  let activeResult = null;
  let activeRequest = 0;
  let collapsed = false;

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureDom() {
    if (panel) return panel;
    panel = document.getElementById('passCausePanel');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'passCausePanel';
      panel.className = 'pass-cause-panel panel-shell';
      document.body.appendChild(panel);
    }
    panel.innerHTML = `
      <div class="pass-cause-header panel-shell-header">
        <div class="pass-cause-title-wrap">
          <div class="pass-cause-eyebrow">解释</div>
          <div class="panel-shell-title pass-cause-title" id="passCauseTitle">Pass 原因</div>
        </div>
        <button class="btn btn-ghost btn-icon pass-cause-collapse" id="passCauseCollapse" type="button" title="折叠">
          <span class="pass-cause-collapse-open">-</span>
          <span class="pass-cause-collapse-closed">+</span>
        </button>
      </div>
      <div class="pass-cause-body panel-shell-body" id="passCauseBody"></div>
    `;
    body = panel.querySelector('#passCauseBody');
    panel.querySelector('#passCauseCollapse')?.addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('is-collapsed', collapsed);
    });
    panel.addEventListener('click', handlePanelClick);
    renderEmpty('打开包含 Before/After JSON 的 Pass 文件夹后，可以查看规则解释和逐步播放。');
    return panel;
  }

  function setTitle(text) {
    ensureDom();
    const title = panel.querySelector('#passCauseTitle');
    if (title) title.textContent = text || 'Pass 原因';
  }

  function statChip(label, value) {
    return `<span class="stat-chip pass-cause-stat"><span>${escHtml(label)}</span><strong>${escHtml(value)}</strong></span>`;
  }

  function signed(value) {
    const n = Number(value) || 0;
    return n > 0 ? `+${n}` : String(n);
  }

  function renderEmpty(message) {
    ensureDom();
    setTitle('Pass 原因');
    body.innerHTML = `
      <section class="pass-cause-empty">
        <div class="pass-cause-empty-title">暂无解释上下文</div>
        <div class="pass-cause-empty-copy">${escHtml(message)}</div>
      </section>
    `;
    window.PtoPassCausePlayback?.clear?.();
  }

  function renderLoading(selection) {
    ensureDom();
    const label = selection?.passName
      ? `P${String(selection.passIndex).padStart(2, '0')} ${selection.passName}`
      : '加载中';
    setTitle(label);
    body.innerHTML = `
      <section class="pass-cause-loading">
        <div class="pass-cause-empty-title">正在读取 Before/After 配对</div>
        <div class="pass-cause-empty-copy">正在计算结构差异，并匹配来自源码逻辑的规则。</div>
      </section>
    `;
  }

  function renderPairProblem(pair) {
    ensureDom();
    setTitle(pair?.passName || '配对缺失');
    body.innerHTML = `
      <section class="pass-cause-empty">
        <div class="pass-cause-empty-title">Before/After 配对不可用</div>
        <div class="pass-cause-empty-copy">配对状态：${escHtml(pair?.status || 'missing')}</div>
      </section>
    `;
    window.PtoPassCausePlayback?.clear?.();
  }

  function evidenceHtml(items) {
    if (!items?.length) return '';
    return `
      <div class="pass-cause-evidence">
        ${items.map(item => `
          <div class="pass-cause-evidence-row">
            <span>${escHtml(item.label)}</span>
            <strong>${escHtml(item.value)}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  function sourceKey(source) {
    if (!source?.file) return '';
    return `${source.file}::${(source.functions || []).join(',')}`;
  }

  function sourceHtml(explanations) {
    const sources = [];
    const seen = new Set();
    for (const item of explanations || []) {
      if (!item.source?.file) continue;
      const key = sourceKey(item.source);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(item.source);
    }
    if (!sources.length) {
      return `
        <section class="pass-cause-section">
          <div class="pass-cause-section-title">源码</div>
          <div class="pass-cause-note">当前变化还没有命中 MVP 源码规则。</div>
        </section>
      `;
    }
    return `
      <section class="pass-cause-section">
        <div class="pass-cause-section-title">源码</div>
        ${sources.map(source => {
          const fileName = source.file.split('/').pop();
          const functions = (source.functions || []).join(', ') || '未识别函数';
          const related = (source.relatedFiles || []).map(file => `
            <div class="pass-cause-source-related">
              <span>${escHtml(file.split('/').pop())}</span>
              <button class="btn btn-ghost btn-sm" data-copy="${escHtml(file)}" type="button">复制路径</button>
            </div>
          `).join('');
          return `
            <details class="pass-cause-source">
              <summary>
                <span>${escHtml(fileName)}</span>
                <span>${escHtml(functions)}</span>
              </summary>
              <div class="pass-cause-source-path">${escHtml(source.file)}</div>
              <button class="btn btn-ghost btn-sm" data-copy="${escHtml(source.file)}" type="button">复制路径</button>
              ${related}
            </details>
          `;
        }).join('')}
      </section>
    `;
  }

  function sideLabel(side) {
    if (side === 'split') return 'Before -> After';
    return side === 'before' ? 'Before' : 'After';
  }

  function countSummary(step) {
    const c = step.counts || {};
    const parts = [];
    if (c.removedOps) parts.push(`op -${c.removedOps}`);
    if (c.removedTensors) parts.push(`tensor -${c.removedTensors}`);
    if (c.removedEdges) parts.push(`edge -${c.removedEdges}`);
    if (c.addedOps) parts.push(`op +${c.addedOps}`);
    if (c.addedTensors) parts.push(`tensor +${c.addedTensors}`);
    if (c.rewiredEdges) parts.push(`重连 ${c.rewiredEdges}`);
    if (c.fieldChanges) parts.push(`字段 ${c.fieldChanges}`);
    if (!parts.length && c.netNodes) parts.push(`节点 ${signed(c.netNodes)}`);
    return parts.slice(0, 3).join(' · ');
  }

  function stepHtml(step, index) {
    const confidenceClass = step.confidence === 'unexplained' ? 'is-unexplained' : 'is-explained';
    return `
      <button class="pass-cause-step ${confidenceClass}" data-step-index="${index}" type="button">
        <span class="pass-cause-step-index">${index + 1}</span>
        <span class="pass-cause-step-main">
          <span class="pass-cause-step-title">${escHtml(step.title)}</span>
          <span class="pass-cause-step-summary">${escHtml(step.summary)}</span>
        </span>
        <span class="pass-cause-step-side">
          <span>${escHtml(sideLabel(step.sideMode || step.focusSide || 'after'))}</span>
          ${countSummary(step) ? `<span class="pass-cause-step-count">${escHtml(countSummary(step))}</span>` : ''}
        </span>
      </button>
      ${evidenceHtml(step.evidence)}
    `;
  }

  function opcodeStatsHtml(graphCounts) {
    const byOpcode = graphCounts?.byOpcode || {};
    const rows = Object.entries(byOpcode)
      .filter(([, stat]) => stat.added || stat.removed || stat.net)
      .sort((a, b) => Math.abs(b[1].net || 0) - Math.abs(a[1].net || 0))
      .slice(0, 6);
    if (!rows.length) return '';
    return `
      <div class="pass-cause-opcode-stats">
        ${rows.map(([op, stat]) => statChip(op, signed(stat.net || 0))).join('')}
      </div>
    `;
  }

  function renderResult(result) {
    activeResult = result;
    ensureDom();
    const pair = result?.pair;
    const passLabel = pair
      ? `P${String(pair.passIndex).padStart(2, '0')} ${pair.passName}`
      : 'Pass 原因';
    setTitle(passLabel);

    const stats = result?.summary?.changeStats;
    const graphCounts = result?.summary?.graphCounts;
    const supportedNote = result?.covered
      ? ''
      : '<div class="pass-cause-note is-warning">这个 Pass 尚未进入源码 schema，当前只展示原始 diff。</div>';
    const schemaNote = result?.covered && result?.coverageTier !== 'rule'
      ? `<div class="pass-cause-note">当前使用 ${escHtml(result?.summary?.coverageLabel || 'Schema 解释')}：已关联源码路径，但具体规则仍按 diff group 叙事。</div>`
      : '';
    const noChange = stats && !stats.addedNodes && !stats.removedNodes && !stats.modifiedNodes && !stats.addedEdges && !stats.removedEdges;
    const steps = result?.explanations || [];

    body.innerHTML = `
      <section class="pass-cause-section pass-cause-summary">
        <div class="pass-cause-section-title">当前结论</div>
        <div class="pass-cause-headline">${escHtml(noChange ? '没有结构变化' : result?.summary?.headline || '暂无解释')}</div>
        <div class="pass-cause-stats">
          ${graphCounts ? statChip('节点', signed(graphCounts.delta.nodes)) : ''}
          ${graphCounts ? statChip('op', signed(graphCounts.delta.ops)) : ''}
          ${graphCounts ? statChip('tensor', signed(graphCounts.delta.tensors)) : ''}
          ${graphCounts ? statChip('edge', signed(graphCounts.delta.edges)) : ''}
          ${stats ? statChip('重连', stats.rewires) : ''}
          ${stats ? statChip('字段', stats.fieldChanges || 0) : ''}
        </div>
        ${opcodeStatsHtml(graphCounts)}
        ${supportedNote}
        ${schemaNote}
      </section>
      <section class="pass-cause-section">
        <div class="pass-cause-section-title">规则步骤</div>
        ${steps.length ? `<div class="pass-cause-steps">${steps.map(stepHtml).join('')}</div>` : '<div class="pass-cause-note">这组配对没有可播放的规则步骤。</div>'}
      </section>
      ${sourceHtml(steps)}
    `;
    window.PtoPassCausePlayback?.setResult?.(result);
  }

  function copyText(value) {
    if (!value) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
      return;
    }
    fallbackCopy(value);
  }

  function fallbackCopy(value) {
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try { document.execCommand('copy'); } catch (_) {}
    input.remove();
  }

  function handlePanelClick(event) {
    const copyBtn = event.target.closest('[data-copy]');
    if (copyBtn) {
      copyText(copyBtn.dataset.copy);
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制路径'; }, 900);
      return;
    }

    const stepBtn = event.target.closest('[data-step-index]');
    if (stepBtn) {
      const index = Number(stepBtn.dataset.stepIndex);
      window.PtoPassCausePlayback?.selectStep?.(index);
    }
  }

  function updateActiveStep(index) {
    ensureDom();
    panel.querySelectorAll('[data-step-index]').forEach(btn => {
      btn.classList.toggle('is-active', Number(btn.dataset.stepIndex) === index);
    });
  }

  function refreshFromSelection(selection) {
    ensureDom();
    if (!selection?.navIndex || !selection.pass) {
      renderEmpty('打开包含 Before/After JSON 的 Pass 文件夹后，可以查看规则解释和逐步播放。单张图没有可配对的 Pass 上下文。');
      return;
    }
    const pair = window.PtoPassCausePairs.resolvePair({
      navIndex: selection.navIndex,
      passIndex: selection.passIndex,
      passName: selection.passName,
      pathId: selection.pathId,
      snapshotKey: selection.snapshotKey,
    });
    if (!pair) {
      renderEmpty('当前选中的 snapshot 无法组成 Before/After 配对。');
      return;
    }
    if (pair.status !== 'ready') {
      renderPairProblem(pair);
      return;
    }

    const requestId = activeRequest + 1;
    activeRequest = requestId;
    renderLoading(selection);
    window.PtoPassCauseExplainer.explainPair(pair)
      .then(result => {
        if (requestId !== activeRequest) return;
        renderResult(result);
      })
      .catch(error => {
        if (requestId !== activeRequest) return;
        console.error('Pass cause explainer failed:', error);
        renderEmpty(error?.message || '解释这组 Pass 配对失败。');
      });
  }

  window.addEventListener('pto-pass-ir:nav-selection', event => {
    refreshFromSelection(event.detail);
  });

  window.addEventListener(STEP_EVENT, event => {
    updateActiveStep(event.detail?.index ?? -1);
  });

  document.addEventListener('DOMContentLoaded', () => ensureDom());
  if (document.readyState !== 'loading') ensureDom();

  window.PtoPassCausePanel = {
    refreshFromSelection,
    renderResult,
    getActiveResult: () => activeResult,
  };
})();
