/* ④ 参数信号面板：静态并行/超参 + grad_norm / load_balance 动态小图（异常可点）。 */
window.ParamRail = (function () {
  let lbCtrl = null, gnCtrl = null;
  const TERM_TIPS = {
    '3D 并行': 'DP/PP/TP 分别表示数据并行、流水并行、张量并行；当前值描述训练任务在三维并行上的切分方式。',
    '专家并行': 'EP 表示专家并行维度；MoGE 是分组专家路由，正常情况下 token 会在专家组间均衡分配。',
    'lr': 'learning rate，权重更新步长；过大可能导致 loss 振荡，当前用于排除超参突变。',
    'global batch': '全局 batch size，所有 DP 副本合计的样本数；影响梯度统计稳定性。',
    'seq len': '单样本 token 序列长度；影响激活、通信与 MoE dispatch 张量大小。',
    '精度': '训练数值精度；bf16 mixed 表示混合精度路径，和本次 -inf 下溢证据相关。',
  };
  const METRIC_TIPS = {
    gate: 'Load Balance Loss：MoE 路由负载均衡损失。接近 0 表示 token 分配塌陷到少数或空专家组，点击定位 Gate/Router。',
    experts: 'Grad Norm (MoE)：MoE 分支梯度范数。异常暴涨说明专家侧更新不稳定，点击定位 Experts。',
  };

  function init(host) {
    const ts = window.TS_DATA, cfg = ts.config;
    const initialStep = ts.defaultStep || ts.collapseStep || ts.faultStep;
    host.innerHTML = '';

    // 静态配置块
    const conf = document.createElement('div');
    conf.className = 'pr-block';
    conf.innerHTML = '<div class="pr-block-title">并行 / 超参</div>' +
      '<dl class="pr-config">' +
      [['3D 并行', `DP${cfg.DP} · PP${cfg.PP} · TP${cfg.TP}`], ['专家并行', `EP${cfg.EP} (MoGE)`],
       ['lr', cfg.lr], ['global batch', cfg.batch], ['seq len', cfg.seq], ['精度', cfg.precision]]
        .map(([k, v]) => {
          const tip = `${TERM_TIPS[k]} 当前值：${v}`;
          return `<dt title="${tip}">${k}</dt><dd title="${tip}">${v}</dd>`;
        }).join('') + '</dl>';
    host.appendChild(conf);

    // 动态指标块
    const dyn = document.createElement('div');
    dyn.className = 'pr-block';
    dyn.innerHTML = '<div class="pr-block-title">动态指标 <span class="pr-hint">异常段可点</span></div>';
    const lbWrap = document.createElement('div'); lbWrap.className = 'pr-metric'; lbWrap.dataset.node = 'gate';
    lbWrap.title = METRIC_TIPS.gate;
    lbWrap.innerHTML = '<div class="pr-metric-head"><span>Load Balance Loss</span><span class="pr-spark-tag danger">骤降≈0</span></div><div class="pr-spark" id="spark-lb"></div>';
    const gnWrap = document.createElement('div'); gnWrap.className = 'pr-metric'; gnWrap.dataset.node = 'experts';
    gnWrap.title = METRIC_TIPS.experts;
    gnWrap.innerHTML = '<div class="pr-metric-head"><span>Grad Norm (MoE)</span><span class="pr-spark-tag warning">暴涨</span></div><div class="pr-spark" id="spark-gn"></div>';
    dyn.appendChild(lbWrap); dyn.appendChild(gnWrap);
    host.appendChild(dyn);

    lbCtrl = window.PtoTrainingMetricsChart.render('#spark-lb', {
      steps: ts.steps, series: [{ id: 'lb', label: 'lb', key: 'load_balance_loss', colorVar: '--highlight-l0b-deep-violet-source' }],
      data: ts.series, anomalies: ts.anomalies.load_balance_loss, cursor: initialStep, options: { compact: true }, legend: false,
    });
    gnCtrl = window.PtoTrainingMetricsChart.render('#spark-gn', {
      steps: ts.steps, series: [{ id: 'gn', label: 'gn', key: 'grad_norm', colorVar: '--highlight-accum-orange-source' }],
      data: ts.series, anomalies: ts.anomalies.grad_norm, cursor: initialStep, options: { compact: true }, legend: false,
    });

    // 点击 metric → 广播选中对应节点
    [lbWrap, gnWrap].forEach(w => w.addEventListener('click', () => {
      const id = w.dataset.node, m = CrossMap.resolve(id);
      Bus.emit('select', { objectType: 'param', id, relatedNodeIds: m.relatedNodeIds, cols: m.cols, weightKey: m.weightKey, source: 'param' });
    }));

    Bus.on('stepCursor', s => { lbCtrl.setCursor(s); gnCtrl.setCursor(s); });
    // 混合精度写越界事件标记
    Bus.on('faultTrace', () => {
      dyn.querySelectorAll('.pr-fault').forEach(e => e.remove());
      const tag = document.createElement('div'); tag.className = 'pr-fault';
      tag.textContent = `⚑ Step ${ts.faultEvent.step} · ${ts.faultEvent.what}`;
      dyn.appendChild(tag);
    });
    // 选中高亮联动
    Bus.on('select', p => {
      [lbWrap, gnWrap].forEach(w => w.classList.toggle('is-related',
        p && (w.dataset.node === p.id || (p.relatedNodeIds || []).includes(w.dataset.node))));
    });
  }
  return { init };
})();
