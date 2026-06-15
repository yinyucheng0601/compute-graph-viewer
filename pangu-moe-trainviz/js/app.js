/* TrainScope 启动：装配 workbench 分栏 + 初始化五视图 + 默认聚焦故障窗口。 */
(function () {
  function boot() {
    // 外层 vertical split：主区 / 通信 dock；内层 horizontal split：参数 / 架构 / Inspector
    window.PtoWorkbenchShell.initNestedResizablePanes({
      defaults: { keyboard: true },
      splits: [
        { panes: ['#main-area', '#comm-dock'], direction: 'vertical', sizes: [58, 42], minSize: [260, 200], storageKey: 'trainscope:outer' },
        { panes: ['#param-rail', '#graph-stage', '#inspector'], direction: 'horizontal', sizes: [21, 51, 28], minSize: [220, 480, 340], storageKey: 'trainscope:main' },
      ],
    });

    ParamRail.init(document.getElementById('param-rail-body'));
    GraphView.init(document.getElementById('graph-canvas'), document.getElementById('trace-btn'));
    Inspector.init(document.getElementById('inspector-body'));
    TimelineView.init(document.getElementById('dock-timeline'));
    CommDock.init(document.getElementById('dock-mesh'), document.getElementById('dock-transport'));

    // 面板说明（右上角 info icon）
    Info.addPaneInfo('#param-rail', '参数信号面板 · 排障第一步',
      '从训练关键参数读异常信号。上半是并行 / 超参静态配置（排除超参突变）；下半是 grad norm、load balance loss 动态曲线——<b>异常段可点</b>，点了会联动定位到对应算子（Gate / Experts）。');
    Info.addPaneInfo('#graph-stage', '整网架构图 · 排障主舞台',
      'Pangu Pro MoE 的算子 / 层拓扑。<b>选中任一节点</b>会在其余视图双向点亮关联；展开 MoE 块可见 Gate → All-to-All 分发 → MoGE 专家 → All-to-All 汇聚。右键画布或点「追溯梯度流」回溯到根因 step。');
    Info.addPaneInfo('#inspector', '权重 / Shape Inspector · 证据层',
      '看中央选中节点的权重直方图、shape 对比、Gate dispatch 形状与路由热图，定位<b>数值畸变</b>（如 W_gate -inf 下溢、整列专家未激活）。');
    Info.addPaneInfo('#comm-dock', '通信 + 效果 dock · 时间维度',
      '左为模型效果曲线（train/val loss、eval，可<b>框选兴趣窗口</b>）；右为分布式通信 NPU mesh（边粗细=流量、节点色=利用率、黑洞、P2P 气泡）。底部<b>一条播放条同时驱动</b>两者的 step 游标，可回放崩溃瞬间。');

    // 事故标签可点击 → 场景说明
    const faultTag = document.querySelector('.ts-fault');
    if (faultTag) Info.attach(faultTag,
      '事故场景 · 为什么需要 TrainScope',
      '千亿级 MoE 模型 3D 并行训练（DP32 / PP8 / TP4），稳定跑到 <b>Step2000</b> 后验证集 loss 突然高频振荡、生成质量崩塌——但<b>全机 NPU 零硬件报错</b>。<br><br>常规手段要在 TensorBoard、profiler、权重 dump、config 之间反复搬运上下文，靠经验拼因果。TrainScope 用五层证据一屏闭环，沿一条故障链走完：<br><b>混合精度写越界 (Step1997) → 权重畸变 → 路由坍缩 → 通信失衡 → loss 爆炸</b>。<br><br>拖右下播放条回放 Step1997→1998 的崩溃瞬间。');

    // 默认进入故障现场：聚焦 Gate + 框选异常窗口
    const ts = window.TS_DATA;
    const initialStep = ts.defaultStep || ts.collapseStep || ts.faultStep;
    Bus.emit('interestWindow', { start: 1950, end: 2060 });
    Bus.emit('select', { objectType: 'node', id: 'gate', relatedNodeIds: CrossMap.resolve('gate').relatedNodeIds, cols: [2], weightKey: 'gate', source: 'init' });
    Bus.emit('stepCursor', initialStep);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
