/* ══════════════════════════════════════════════════════════════════════════
   配置与关系观测 · 拓扑模型层（第 2 项）
   ------------------------------------------------------------------------
   本文件是整页唯一的数据源。四个视图（整网 / Layer 导航 / MoE / Cluster）
   全部从 CroTopology.derive(config) 的产物渲染，不各自维护状态。

   并行维度语义（已与用户对齐，见 openPangu-2.0-Flash 参考配置）：
     world = DP × PP × TP × CP × EP
     8 × 4 × 1 × 1 × 64 = 2048 ✓        Node = 2048 / 8卡每节点 = 256 ✓
   注意 EP 与 DP 在此模型中是**正交**维度（EP 不从 DP×TP 里切出来）。

   确定性映射（无随机、无数据文件）：
     layer  ℓ → PP stage  s     : 按 PP 把 L 层尽量均分，前 (L mod PP) 段多 1 层
     expert e → EP rank   p     : p = floor(e / (E / EP))
     (s,d,p) → global rank r    : r = s·(DP·EP·TP·CP) + d·(EP·TP·CP) + p·(TP·CP)
     rank   r → node n          : n = floor(r / ranksPerNode)
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /* ── 模型预设：非并行的结构常量，来自 openPangu-2.0-Flash 架构参考.md §4 ── */
  const MODEL_PRESETS = {
    "openpangu-flash": {
      id: "openpangu-flash",
      label: "openPangu 2.0 flash 92B",
      hidden: 2560,
      vocab: 151552,
      heads: 48,
      firstKDense: 2,       // L0~L1 是 Dense MLP，其余是 MoE FFN
      dsaEvery: 3,          // L0,3,6,…,45 走 DSA Indexer，其余 SWA
      mtpLayers: 3,         // MTP L46~L48
      denseIntermediate: 9216,
      moeIntermediate: 1024,
      // deck 侧的模型细节：与 patterns/model-architecture-3d-deck 的 openpangu-flash
      // preset 同值，在这里显式持有，避免依赖 pattern 内部 PRESETS 的可见性。
      deck: { depthGap: 46, blockPostLayers: [0, 4, 9, 14, 19, 24, 29, 34, 39] },
      defaults: {
        totalLayer: 46,
        dp: 8, pp: 4, tp: 1, cp: 1,
        routedExpert: 256, topK: 8, sharedExpert: 1, ep: 64,
        totalRank: 2048, node: 256,
      },
    },
  };

  /* ── stepper 字段规格：min/max/step 与取值方式（pow2 = 按 2 的幂增减） ── */
  const FIELD_SPECS = {
    totalLayer:   { label: "Total Layer",    group: "parallel", min: 1,  max: 256,  step: 1 },
    dp:           { label: "DP",             group: "parallel", min: 1,  max: 1024, pow2: true },
    pp:           { label: "PP",             group: "parallel", min: 1,  max: 128,  pow2: true },
    tp:           { label: "TP",             group: "parallel", min: 1,  max: 64,   pow2: true },
    cp:           { label: "CP",             group: "parallel", min: 1,  max: 64,   pow2: true },
    routedExpert: { label: "Routed",         group: "moe",      min: 1,  max: 1024, pow2: true },
    topK:         { label: "Top-K",          group: "moe",      min: 1,  max: 64,   step: 1 },
    sharedExpert: { label: "Shared",         group: "moe",      min: 0,  max: 8,    step: 1 },
    ep:           { label: "EP",             group: "moe",      min: 1,  max: 1024, pow2: true },
    totalRank:    { label: "Total Rank",     group: "cluster",  min: 1,  max: 65536, pow2: true },
    node:         { label: "Node",           group: "cluster",  min: 1,  max: 8192, pow2: true },
  };

  const FIELD_ORDER = {
    parallel: ["totalLayer", "dp", "pp", "tp", "cp"],
    moe: ["routedExpert", "topK", "sharedExpert", "ep"],
    cluster: ["totalRank", "node"],
  };

  /* ── 取值增减 ─────────────────────────────────────────────────────────── */
  function stepValue(field, value, direction) {
    const spec = FIELD_SPECS[field];
    let next;
    if (spec.pow2) {
      next = direction > 0 ? value * 2 : Math.floor(value / 2);
      if (next < spec.min) next = spec.min;
    } else {
      next = value + direction * (spec.step || 1);
    }
    return Math.min(spec.max, Math.max(spec.min, next));
  }

  /* ── 校验：返回 [] 表示配置自洽 ───────────────────────────────────────── */
  function validate(config) {
    const errors = [];
    const { totalLayer, dp, pp, tp, cp, routedExpert, topK, ep, totalRank, node } = config;

    if (totalLayer < pp) {
      errors.push(`层数 ${totalLayer} 少于 PP ${pp}，至少每个 stage 要有 1 层`);
    }
    if (routedExpert % ep !== 0) {
      errors.push(`路由专家 ${routedExpert} 不能被 EP ${ep} 整除，专家无法均分到 EP rank`);
    }
    if (topK > routedExpert) {
      errors.push(`Top-K ${topK} 超过路由专家总数 ${routedExpert}`);
    }
    const world = dp * pp * tp * cp * ep;
    if (world !== totalRank) {
      errors.push(`DP${dp}×PP${pp}×TP${tp}×CP${cp}×EP${ep} = ${world}，与 Total Rank ${totalRank} 不符`);
    }
    if (totalRank % node !== 0) {
      errors.push(`Total Rank ${totalRank} 不能被节点数 ${node} 整除，每节点卡数不是整数`);
    }
    return errors;
  }

  /* ── 派生：把配置展开成四个视图共用的实体表 ───────────────────────────── */
  function derive(config) {
    const preset = MODEL_PRESETS[config.model] || MODEL_PRESETS["openpangu-flash"];
    const { totalLayer, dp, pp, tp, cp, routedExpert, sharedExpert, ep, totalRank, node } = config;
    const errors = validate(config);

    /* 层 → PP stage：尽量均分，前 (L mod PP) 段各多 1 层。46/4 → 12,12,11,11 */
    const base = Math.floor(totalLayer / pp);
    const remainder = totalLayer % pp;
    const stages = [];
    let cursor = 0;
    for (let s = 0; s < pp; s += 1) {
      const count = base + (s < remainder ? 1 : 0);
      stages.push({ stage: s, lo: cursor, hi: cursor + count - 1, count });
      cursor += count;
    }

    const stageOfLayer = new Array(totalLayer);
    stages.forEach((entry) => {
      for (let l = entry.lo; l <= entry.hi; l += 1) stageOfLayer[l] = entry.stage;
    });

    const layers = [];
    for (let l = 0; l < totalLayer; l += 1) {
      const dense = l < preset.firstKDense;
      layers.push({
        index: l,
        stage: stageOfLayer[l],
        ffn: dense ? "dense" : "moe",
        attention: l % preset.dsaEvery === 0 ? "dsa" : "swa",
      });
    }

    /* 专家 → EP rank */
    const expertsPerEpRank = ep > 0 && routedExpert % ep === 0 ? routedExpert / ep : 0;
    const epRanks = [];
    for (let p = 0; p < ep; p += 1) {
      const experts = [];
      for (let k = 0; k < expertsPerEpRank; k += 1) experts.push(p * expertsPerEpRank + k);
      epRanks.push({ epRank: p, experts, lo: experts[0], hi: experts[experts.length - 1] });
    }
    const epRankOfExpert = (e) => (expertsPerEpRank ? Math.floor(e / expertsPerEpRank) : 0);

    /* rank 编址：stage 最外，dp 次之，ep 最内（TP/CP 内联在最内层） */
    const ranksPerEp = tp * cp;
    const ranksPerDp = ep * ranksPerEp;
    const ranksPerStage = dp * ranksPerDp;
    const ranksPerNode = node > 0 ? totalRank / node : 0;

    const rankOf = (stage, dpIdx, epIdx, inner = 0) =>
      stage * ranksPerStage + dpIdx * ranksPerDp + epIdx * ranksPerEp + inner;
    const nodeOfRank = (rank) => (ranksPerNode ? Math.floor(rank / ranksPerNode) : 0);

    /* ── 关系查询（第 7 项的双向互查全部走这几个函数） ── */
    function ranksOfStage(stage) {
      const out = [];
      const start = stage * ranksPerStage;
      for (let i = 0; i < ranksPerStage; i += 1) out.push(start + i);
      return out;
    }

    function ranksOfLayer(layerIndex) {
      return ranksOfStage(stageOfLayer[layerIndex]);
    }

    /* 某层里某个专家实际落在哪些 rank 上：该层所在 stage × 全部 DP 副本 × 该专家的 EP rank */
    function ranksOfExpertInLayer(layerIndex, expert) {
      const stage = stageOfLayer[layerIndex];
      const epIdx = epRankOfExpert(expert);
      const out = [];
      for (let d = 0; d < dp; d += 1) {
        for (let inner = 0; inner < ranksPerEp; inner += 1) out.push(rankOf(stage, d, epIdx, inner));
      }
      return out;
    }

    function ranksOfEpRankInStage(stage, epIdx) {
      const out = [];
      for (let d = 0; d < dp; d += 1) {
        for (let inner = 0; inner < ranksPerEp; inner += 1) out.push(rankOf(stage, d, epIdx, inner));
      }
      return out;
    }

    function nodesOfRanks(ranks) {
      const seen = new Set();
      ranks.forEach((r) => seen.add(nodeOfRank(r)));
      return Array.from(seen).sort((a, b) => a - b);
    }

    /* rank → 反查坐标，供集群图格子点击后回溯层/专家 */
    function coordsOfRank(rank) {
      const stage = Math.floor(rank / ranksPerStage);
      const withinStage = rank - stage * ranksPerStage;
      const dpIdx = Math.floor(withinStage / ranksPerDp);
      const withinDp = withinStage - dpIdx * ranksPerDp;
      const epIdx = Math.floor(withinDp / ranksPerEp);
      return { rank, stage, dpIdx, epIdx, inner: withinDp - epIdx * ranksPerEp, node: nodeOfRank(rank) };
    }

    return {
      config, preset, errors, valid: errors.length === 0,
      stages, layers, epRanks,
      counts: {
        totalLayer,
        denseLayers: Math.min(preset.firstKDense, totalLayer),
        moeLayers: Math.max(0, totalLayer - preset.firstKDense),
        dsaLayers: layers.filter((l) => l.attention === "dsa").length,
        swaLayers: layers.filter((l) => l.attention === "swa").length,
        routedExpert, topK: config.topK, sharedExpert, ep, expertsPerEpRank,
        dp, pp, tp, cp, totalRank, node, ranksPerNode,
        ranksPerStage, ranksPerDp, ranksPerEp,
      },
      stageOfLayer: (l) => stageOfLayer[l],
      epRankOfExpert,
      expertsOfEpRank: (p) => (epRanks[p] ? epRanks[p].experts : []),
      rankOf, nodeOfRank, coordsOfRank,
      ranksOfStage, ranksOfLayer, ranksOfExpertInLayer, ranksOfEpRankInStage, nodesOfRanks,
    };
  }

  /* ══ stepper UI：复用 .zoom-control-group / .zoom-control-readout / .btn ══ */
  const MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"></path></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';

  function buildStepper(field, value, onChange) {
    const spec = FIELD_SPECS[field];
    const wrap = document.createElement("div");
    wrap.className = "cro-stepper";
    wrap.dataset.field = field;

    const label = document.createElement("span");
    label.className = "cro-stepper__label";
    label.textContent = spec.label;

    const control = document.createElement("div");
    control.className = "zoom-control-group cro-stepper__control";

    const dec = document.createElement("button");
    dec.type = "button";
    dec.className = "btn btn-ghost btn-icon btn-sm";
    dec.innerHTML = MINUS;
    dec.setAttribute("aria-label", `减少 ${spec.label}`);

    const readout = document.createElement("span");
    readout.className = "zoom-control-readout";
    readout.textContent = String(value);
    readout.setAttribute("role", "status");

    const inc = document.createElement("button");
    inc.type = "button";
    inc.className = "btn btn-ghost btn-icon btn-sm";
    inc.innerHTML = PLUS;
    inc.setAttribute("aria-label", `增加 ${spec.label}`);

    dec.addEventListener("click", () => onChange(field, -1));
    inc.addEventListener("click", () => onChange(field, 1));

    control.append(dec, readout, inc);
    wrap.append(label, control);
    return wrap;
  }

  /* ══ 控制器：持有 config，渲染 stepper，广播 cro:change ══════════════════ */
  function createController(options = {}) {
    const modelId = options.model || "openpangu-flash";
    const config = Object.assign({ model: modelId }, MODEL_PRESETS[modelId].defaults, options.config);
    const readouts = new Map();
    const wraps = new Map();
    const listeners = [];

    function mount(container, group) {
      if (!container) return;
      container.innerHTML = "";
      FIELD_ORDER[group].forEach((field) => {
        const stepper = buildStepper(field, config[field], apply);
        readouts.set(field, stepper.querySelector(".zoom-control-readout"));
        wraps.set(field, stepper);
        container.appendChild(stepper);
      });
    }

    function apply(field, direction) {
      const next = stepValue(field, config[field], direction);
      if (next === config[field]) return;
      config[field] = next;
      emit();
    }

    function set(field, value) {
      if (config[field] === value) return;
      config[field] = value;
      emit();
    }

    function emit() {
      const topology = derive(config);
      readouts.forEach((el, field) => { el.textContent = String(config[field]); });
      // 校验失败时给出提示：把相关 stepper 标红，并在 #croConfigError 写出原因
      const badFields = new Set();
      if (!topology.valid) {
        topology.errors.forEach((message) => {
          Object.keys(FIELD_SPECS).forEach((field) => {
            if (message.includes(FIELD_SPECS[field].label)) badFields.add(field);
          });
        });
      }
      wraps.forEach((el, field) => el.classList.toggle("is-invalid", badFields.has(field)));
      const errorEl = document.getElementById("croConfigError");
      if (errorEl) errorEl.textContent = topology.errors.join("；");

      listeners.forEach((fn) => fn(topology));
      document.dispatchEvent(new CustomEvent("cro:change", { detail: topology }));
    }

    return {
      config,
      mount,
      set,
      get topology() { return derive(config); },
      onChange(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
      refresh: emit,
    };
  }

  /* ══ 整网 deck（第 3 项）══════════════════════════════════════════════════
     直接消费 patterns/model-architecture-3d-deck，不复刻它的 DOM / 投影数学 /
     视图 CSS。只做两件事：
       1. 用 options.config 把 layerCount / stageRanges / dense·DSA 层号 / 专家数
          换成本页 topology 派生出来的值（pattern.json 的 allowedOverrides）。
       2. options.showChrome=false 去掉 pattern 自带的 title + 工具栏
          （3D/正视/侧视 切换、主题、适配），只留正视图 + pan/zoom。
     ═══════════════════════════════════════════════════════════════════════ */
  function deckConfigFrom(topology) {
    const { counts, stages, layers, preset } = topology;
    const lastLayer = Math.max(0, counts.totalLayer - 1);
    return {
      id: "openpangu-flash",
      label: preset.label,
      layerCount: counts.totalLayer,
      depthGap: preset.deck.depthGap,
      frontLayer: Math.floor(lastLayer / 2),   // 正视图默认停在中间层（46 层 → L23）
      firstMoeLayer: counts.denseLayers,
      denseLayers: layers.filter((l) => l.ffn === "dense").map((l) => l.index),
      dsaLayers: layers.filter((l) => l.attention === "dsa").map((l) => l.index),
      blockPostLayers: preset.deck.blockPostLayers.filter((l) => l <= lastLayer),
      routedExperts: counts.routedExpert,
      topK: counts.topK,
      stageRanges: stages.map((s) => [s.lo, s.hi]),
      representativeLayers: stages.map((s) => s.lo),
    };
  }

  /* 只有这些量变了才值得重建 deck（46 层 × ~30 节点，重挂不便宜） */
  function deckSignature(topology) {
    const c = topology.counts;
    return [c.totalLayer, c.pp, c.routedExpert, c.topK, c.denseLayers].join("/");
  }

  function createDeck(hostId, options = {}) {
    const host = document.getElementById(hostId);
    if (!host || !global.PtoModelArchitecture3dDeck) return null;
    let controller = null;
    let signature = null;
    let muted = false;   // applyRelation 回写 deck 时，屏蔽它的回调，避免自激

    function build(topology) {
      const next = deckSignature(topology);
      if (controller && next === signature) return controller;
      signature = next;
      controller?.destroy?.();
      host.innerHTML = "";
      controller = global.PtoModelArchitecture3dDeck.render(host, {
        config: deckConfigFrom(topology),
        initialView: "front",          // 只要正视图
        showChrome: false,             // 去掉视图切换 / 主题 / 适配工具栏
        initialTheme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        // 整网图 → 其余三个视图的反查入口
        onNodeSelect: (selected) => { if (!muted) options.onNodeSelect?.(selected); },
      });
      global.croDeckController = controller;
      return controller;
    }

    return {
      build,
      get controller() { return controller; },
      // 回写 deck 选中态时静音回调
      silently(fn) { muted = true; try { fn(controller); } finally { muted = false; } },
    };
  }

  /* deck 节点 id → 结构条的 (segment, bar)，用于「点整网图算子」反查其余视图 */
  function deckNodeIndex(topology) {
    const index = new Map();
    activeColumns(topology).forEach((col) => {
      col.bars.forEach((bar) => {
        if (bar.deckNode && !index.has(bar.deckNode)) {
          index.set(bar.deckNode, { segment: col.id, bar: bar.id, experts: bar.experts || null, layers: col.layers });
        }
      });
    });
    return index;
  }

  /* ══ 与整网 deck 严格同色（第 4 项 · 修订）═══════════════════════════════
     结构条不再自己算色。deck 在自己的根节点上写了 --pto-model-deck-{op} 这批
     变量（见 pattern.js applySemanticPalette），节点填充是
       linear-gradient(180deg, C 0%, color-mix(C 75%, #000) 100%) + inset 高光。
     这里把那批变量原样搬到 .cro-board 上，bar 用同名 op + 同一条渐变，
     色值与整网图逐位一致，不做二次映射。 */
  const DECK_COLOR_VARS = [
    "embedding", "norm", "attention", "linear", "head", "mlp",
    "act", "gate", "moe", "comm", "decoder", "input", "output", "parameter", "state",
  ];

  function syncDeckPalette(deckRoot, target) {
    if (!deckRoot || !target) return;
    const style = getComputedStyle(deckRoot);
    DECK_COLOR_VARS.forEach((op) => {
      const value = style.getPropertyValue(`--pto-model-deck-${op}`).trim();
      if (value) target.style.setProperty(`--pto-model-deck-${op}`, value);
    });
  }

  /* 整网 deck 的「相关/不相关」标注。
     关系集大多只覆盖流水线的一段 —— 一个 rank 只持有它那个 PP stage 的层，
     外加一端的 Emb 或 Final Norm/LM Head/MTP —— 所以整网里也该只留这一段有色。
     算子粒度的去色（点具体节点）走 .is-selected，那条 CSS 规则要求确实有节点
     被选中；点 rank / stage / 层这些粗粒度对象时一个 .is-selected 都没有，
     必须另有一套按层/按静态段的标注，否则整网永远是满色的。
     判定：层内节点看所在层卡的层号是否在关系集里；静态段节点看 id 是否在
     rel.staticNodes（由相关的端点列贡献）。 */
  function markDeckRelated(rel) {
    const host = document.getElementById("croDeckHost");
    if (!host) return;
    const layerOf = (el) => Number(el.closest(".pto-model-deck__layer")?.dataset.layer);
    host.querySelectorAll(".pto-model-deck__layer").forEach((card) => {
      card.classList.toggle("is-related", Boolean(rel) && rel.layers.has(Number(card.dataset.layer)));
    });
    host.querySelectorAll(".pto-model-deck__node, .pto-model-deck__experts").forEach((node) => {
      const layer = layerOf(node);
      const related = Boolean(rel) && (Number.isFinite(layer)
        ? rel.layers.has(layer)
        : rel.staticNodes.has(node.dataset.node));
      node.classList.toggle("is-related", related);
    });
  }

  /* ══ 结构条：五段（第 4 项）══════════════════════════════════════════════
     bar.deckNode 对应 patterns/model-architecture-3d-deck 的节点 id，
     第 7 项据此调 deck.selectNode() 联动高亮。 */
  /* bar.op 就是 deck 里同一个节点的 data-op，保证两边取到同一个色变量。
     每列的 units = 该列在 Layer 导航里占的刻度：Dense/MoE 是真实层，
     Emb / Norm / Head 各占 1 格（46 层 + 3 格 = 49 格）。
     col.stageAnchor —— 端点列没有 layers，但它们真实驻留在流水线两端的
     PP stage 上（Emb 在首段、Final Norm / LM Head 在末段）。关系引擎靠它
     把端点算子接回 PP 段与集群 rank，否则点 Emb/Norm/Head 只亮结构条自己。 */
  function structureColumns(topology) {
    const { counts } = topology;
    const denseLast = counts.denseLayers - 1;
    const moeFirst = counts.denseLayers;
    const moeLast = counts.totalLayer - 1;
    const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

    const attnBar = { id: "attn", label: "Attn", op: "attention", deckNode: "attention_core" };
    const normBar = { id: "post_mlp_norm", label: "Post-MLP Norm", op: "norm", deckNode: "post_mlp_norm" };

    const columns = [
      {
        id: "emb", name: "Emb", layers: [], units: ["emb"], stageAnchor: "first",
        bars: [{ id: "embedding", label: "Token Embedding", op: "embedding", deckNode: "embedding" }],
      },
    ];

    if (counts.denseLayers > 0) {
      columns.push({
        id: "dense",
        name: `Dense x${counts.denseLayers}（L0~L${denseLast}）`,
        layers: range(0, denseLast),
        bars: [
          attnBar,
          { id: "dense_gate_up", label: "Gate / Up Linear", op: "linear", deckNode: "dense_gate_up" },
          { id: "dense_down", label: "Dense Down", op: "linear", deckNode: "dense_down" },
          normBar,
        ],
      });
    }

    if (counts.moeLayers > 0) {
      columns.push({
        id: "moe",
        name: `MoE x${counts.moeLayers}（L${moeFirst}~L${moeLast}）`,
        layers: range(moeFirst, moeLast),
        bars: [
          attnBar,
          { id: "gate", label: `Router · Top-${counts.topK}`, op: "gate", deckNode: "gate", experts: "routed" },
          { id: "a2a_dispatch", label: "EP Dispatch", op: "comm", deckNode: "a2a_dispatch", experts: "routed" },
          { id: "expert_pool", label: `Expert Pool ×${counts.routedExpert}`, op: "moe", deckNode: "expert_pool", experts: "routed" },
          { id: "shared_expert", label: `Shared Expert ×${counts.sharedExpert}`, op: "mlp", deckNode: "shared_expert", experts: "shared" },
          { id: "a2a_combine", label: "EP Combine", op: "comm", deckNode: "a2a_combine", experts: "routed" },
          normBar,
        ],
      });
    }

    columns.push(
      {
        id: "norm", name: "Norm", layers: [], units: ["norm"], stageAnchor: "last",
        bars: [{ id: "final_norm", label: "Final RMSNorm", op: "norm", deckNode: "final_norm" }],
      },
      {
        id: "head", name: "Head", layers: [], units: ["head"], stageAnchor: "last",
        bars: [
          { id: "lm_head", label: "LM Head", op: "head", deckNode: "lm_head" },
          { id: "logits", label: "Logits", op: "output", deckNode: "logits" },
        ],
      },
    );
    return columns;
  }

  /* ══ 结构条 = 整网 deck 的算子投影 ═══════════════════════════════════════
     不再另写一份算子清单。deck 每层卡片真实渲染了 ~25 个节点，结构条直接读
     它的 DOM（节点 id / data-op / 文案），保证「整网图里有的算子，五列里都有」，
     且颜色天然一致（用的就是同一个 data-op）。deck 不可用时回落到骨架清单。 */
  const DECK_NODE_ALIASES = {
    q_residual_add: "Q Residual Add",
    kv_residual_add: "KV Residual Add",
    o_residual_add: "Output Residual Add",
    moe_branch_add: "MoE Branch Add",
    ffn_residual_add: "FFN Residual Add",
  };

  const EXPERT_ROLE = {
    gate: "routed",            // Router 对全部路由专家打分，关系上牵连整池
    expert_pool: "routed",
    a2a_dispatch: "routed",
    a2a_combine: "routed",
    shared_expert: "shared",
  };

  function readDeckNodes(scope) {
    if (!scope) return [];
    const out = [];
    scope.querySelectorAll(".pto-model-deck__node, .pto-model-deck__experts").forEach((el) => {
      const id = el.dataset.node;
      const op = el.dataset.op;
      if (!id || op === "mhc-state") return;   // mhc-state 只在侧视图出现
      let label = (el.textContent || "").trim();
      if (!label || label === "+") label = DECK_NODE_ALIASES[id] || id.replace(/_/g, " ");
      if (el.classList.contains("pto-model-deck__experts")) {
        label = el.getAttribute("aria-label") || "Expert Pool";
      }
      if (out.some((n) => n.id === id)) return;
      out.push({ id, label, op, deckNode: id, experts: EXPERT_ROLE[id] || null });
    });
    return out;
  }

  /* 用 deck 的真实节点填充五列的 bars；任何一段读不到就保留骨架里的那一段 */
  function projectDeckOntoColumns(columns, deckRoot, topology) {
    if (!deckRoot) return columns;
    const firstDense = topology.layers.find((l) => l.ffn === "dense");
    const firstMoe = topology.layers.find((l) => l.ffn === "moe");
    const layerScope = (layer) => (layer
      ? deckRoot.querySelector(`.pto-model-deck__layer[data-layer="${layer.index}"]`)
      : null);

    const input = readDeckNodes(deckRoot.querySelector(".pto-model-deck__static--input"));
    const output = readDeckNodes(deckRoot.querySelector(".pto-model-deck__static--output"));
    const dense = readDeckNodes(layerScope(firstDense));
    const moe = readDeckNodes(layerScope(firstMoe));

    // 输出段以 final_norm 为界：它归 Norm 列，其后的 LM Head / Logits / MTP 归 Head 列
    const normAt = output.findIndex((n) => n.id === "final_norm");
    const normBars = normAt >= 0 ? output.slice(0, normAt + 1) : [];
    const headBars = normAt >= 0 ? output.slice(normAt + 1) : output;

    const bySegment = { emb: input, dense, moe, norm: normBars, head: headBars };
    return columns.map((col) => {
      const bars = bySegment[col.id];
      return bars && bars.length ? { ...col, bars } : col;
    });
  }

  /* 全页统一从这里拿列定义：骨架（列名 / 层归属 / 刻度数）+ deck 投影的算子。 */
  function activeColumns(topology) {
    return projectDeckOntoColumns(
      structureColumns(topology),
      document.getElementById("croDeckHost"),
      topology,
    );
  }

  /* Layer 导航与结构条共用同一套列宽，两块严格对齐成一个整体。
     五列等宽（不再按刻度数配比）——MoE 有 44 层，按比例分会把 Emb/Norm/Head
     压成窄条，五个典型层面板宽度也就参差不齐。 */
  function columnTemplate(columns) {
    return `repeat(${columns.length}, minmax(0, 1fr))`;
  }

  /* ══ 渲染：Layer 导航（第 4 项 · 修订 2）═══════════════════════════════════
     严格照 default.png：一条**连续**刻度带，Emb 1 格 + 46 个 decoder 层 +
     Norm / Head 2 格 = 49 格，全带等宽等距（4px 刻度 / 4px 间隙）。
     带子按「PP 边界 ∪ Dense|MoE 起止」切成若干组，组间留 NAV_SPLIT 的空当，
     空当正中画一条竖分隔线；两套分组各自标在带子的上下两侧：
       上 —— PP0…PPn 纯文字，分隔线从标签行顶画到刻度行下方；
       下 —— Dense / MoE 纯文字，分隔线从刻度行顶画到标签行下方。
     没有卡片底色、没有胶囊标签、没有横向分割线 —— 参考图里都不存在。
     几何（分隔线 x、标签左右边界）一律实测写入：PP 边界会落在 Dense|MoE
     之间，按比例硬算会错位。 */

  /* 组间空当 / 刻度宽 = 26 : 4，量自参考图。带子比参考图宽时整体等比放大，
     刻度与空当一起变粗，而不是把余量全丢给某一边。 */
  const NAV_SPLIT_RATIO = 6.5;
  const NAV_TICK_MIN = 1.5;
  const NAV_TICK_MAX = 8;

  /* 把五列摊平成一条刻度槽序列，并解出两套分组的切点。
     切点一律用「组下标」表达（第 g 组之前的那道缝），layoutLayerNav 只需把
     组下标换算成缝的中点，不必再关心层号。 */
  function navModel(topology) {
    const columns = activeColumns(topology);
    const slots = [];
    const columnStart = [];
    const slotOfLayer = new Map();

    columns.forEach((col) => {
      columnStart.push(slots.length);
      if (col.layers.length) {
        col.layers.forEach((l) => { slotOfLayer.set(l, slots.length); slots.push({ layer: l }); });
      } else {
        slots.push({ unit: col.id, column: col });   // Emb / Norm / Head 各占 1 格
      }
    });

    // 分区起止：每道列缝都断开。Emb / Norm / Head 底部也各自出注记，它们就得是
    // 独立的组 —— 否则 groupAt 找不到对应切点，会一路退回 0 组，注记全挤到左端。
    // 这也补上了 Norm|Head 之间原先缺的那道分隔线。
    const ffnCuts = [];
    columns.forEach((col, i) => {
      if (i === 0) return;
      ffnCuts.push(columnStart[i]);
    });
    // PP 的起止：每个 stage 的首层
    const ppCuts = topology.stages.slice(1)
      .map((entry) => slotOfLayer.get(entry.lo))
      .filter((v) => Number.isFinite(v));

    const splits = Array.from(new Set([...ffnCuts, ...ppCuts]))
      .filter((v) => v > 0 && v < slots.length)
      .sort((a, b) => a - b);

    const groups = [];
    let from = 0;
    splits.concat(slots.length).forEach((cut) => { groups.push({ from, to: cut }); from = cut; });

    // 组下标：slots.length → groups.length（带子右端），0 → 0（带子左端）
    const groupAt = (slot) => (slot >= slots.length
      ? groups.length
      : Math.max(0, groups.findIndex((g) => g.from === slot)));

    const ppSpans = topology.stages.map((entry, i) => ({
      stage: entry.stage,
      title: `PP${entry.stage} · L${entry.lo}~L${entry.hi}（${entry.count} 层）`,
      g0: i === 0 ? 0 : groupAt(slotOfLayer.get(entry.lo)),
      g1: i === topology.stages.length - 1 ? groups.length : groupAt(slotOfLayer.get(topology.stages[i + 1].lo)),
    }));

    // 底部注记覆盖全部五列：有层的列报 Dense / MoE，Emb / Norm / Head 报列名
    const ffnSpans = columns.map((col, i) => ({
      segment: col.id,
      label: col.layers.length
        ? (topology.layers[col.layers[0]].ffn === "dense" ? "Dense" : "MoE")
        : col.name,
      g0: groupAt(columnStart[i]),
      g1: groupAt(columnStart[i] + Math.max(1, col.layers.length)),
    }));

    return {
      slots, groups, ppSpans, ffnSpans,
      ppRules: [0, ...ppCuts.map(groupAt), groups.length],   // 含带子两端
      ffnRules: ffnCuts.map(groupAt),
    };
  }

  function renderLayerNav(container, topology, emit) {
    if (!container) return;
    const model = navModel(topology);
    container.innerHTML = "";

    const band = document.createElement("div");
    band.className = "cro-layer-nav__band";

    // ── 中：连续刻度带，按切点分组 ──
    const strip = document.createElement("div");
    strip.className = "cro-layer-nav__strip";
    model.groups.forEach((group) => {
      const cell = document.createElement("div");
      cell.className = "cro-layer-nav__group";
      for (let i = group.from; i < group.to; i += 1) {
        const slot = model.slots[i];
        const tick = document.createElement("button");
        tick.type = "button";
        tick.className = "cro-tick";
        if (slot.unit) {
          // Emb / Norm / Head：不是层，但和层刻度同宽同高（参考图里没有区别）
          const col = slot.column;
          tick.classList.add("is-endpoint");
          tick.dataset.unit = col.id;
          tick.title = col.name;
          tick.setAttribute("aria-label", col.name);
          tick.addEventListener("click", () => emit({
            kind: "segment", segment: col.id, bar: col.bars[0].id,
            deckNode: col.bars[0].deckNode, layers: [],
          }));
        } else {
          const layer = topology.layers[slot.layer];
          tick.dataset.layer = String(slot.layer);
          tick.dataset.ffn = layer.ffn;
          tick.dataset.attn = layer.attention;
          tick.title = `L${slot.layer} · PP${layer.stage} · ${layer.ffn === "dense" ? "Dense" : "MoE"} · ${layer.attention.toUpperCase()}`;
          tick.setAttribute("aria-label", tick.title);
          tick.addEventListener("click", () => emit({ kind: "layer", layer: slot.layer }));
        }
        cell.appendChild(tick);
      }
      strip.appendChild(cell);
    });
    band.appendChild(strip);

    // ── 上：PP 标签 ──
    model.ppSpans.forEach((entry) => {
      const span = document.createElement("button");
      span.type = "button";
      span.className = "cro-pp-span";
      span.dataset.stage = String(entry.stage);
      span.dataset.g0 = String(entry.g0);
      span.dataset.g1 = String(entry.g1);
      span.textContent = `PP${entry.stage}`;
      span.title = entry.title;
      span.setAttribute("aria-label", entry.title);
      span.addEventListener("click", () => emit({ kind: "stage", stage: entry.stage }));
      band.appendChild(span);
    });

    // ── 下：Dense / MoE 标签（纯文字，不可点，只是分区注记） ──
    model.ffnSpans.forEach((entry) => {
      const span = document.createElement("span");
      span.className = "cro-ffn-span";
      span.dataset.segment = entry.segment;
      span.dataset.g0 = String(entry.g0);
      span.dataset.g1 = String(entry.g1);
      span.textContent = entry.label;
      band.appendChild(span);
    });

    // ── 分隔线 ──
    const addRule = (kind, g) => {
      const rule = document.createElement("div");
      rule.className = `cro-nav-rule cro-nav-rule--${kind}`;
      rule.dataset.g = String(g);
      band.appendChild(rule);
    };
    model.ppRules.forEach((g) => addRule("pp", g));
    model.ffnRules.forEach((g) => addRule("ffn", g));

    container.appendChild(band);
    requestAnimationFrame(() => layoutLayerNav(container));
  }

  /* 布局两步走：
     1. 解出刻度宽度 —— 带子恰好填满可用宽度。刻度与间隙同宽 t，一组 k 格占
        (2k-1)t；组间与带子两端各留一个 split，且 split = 6.5t（参考图比例）：
          width = (2n - g)·t + g·6.5t   （n 格、g 组）
        t 被上下限夹住时（层数很多 / 带子特别宽）余量反过来吃进 split，
        保证带子既不横向溢出、也不在右侧留一截空当。
     2. 分隔线 / 标签的左右边界按实测组位置写入：切点 = 相邻两组之间那道缝的
        中点，带子两端 = strip 的 padding-box 边。 */
  function layoutLayerNav(container) {
    if (!container) return;
    const band = container.querySelector(".cro-layer-nav__band");
    const strip = container.querySelector(".cro-layer-nav__strip");
    if (!band || !strip) return;
    const groups = Array.from(strip.querySelectorAll(".cro-layer-nav__group"));
    const ticks = strip.querySelectorAll(".cro-tick").length;
    if (!groups.length || !ticks) return;

    const width = strip.clientWidth;
    const span = 2 * ticks - groups.length;
    const tick = Math.max(NAV_TICK_MIN, Math.min(NAV_TICK_MAX,
      width / (span + NAV_SPLIT_RATIO * groups.length)));
    const split = Math.max(4, (width - tick * span) / groups.length);
    container.style.setProperty("--cro-tick-w", `${tick}px`);
    container.style.setProperty("--cro-nav-split", `${split}px`);

    const base = band.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const rects = groups.map((g) => g.getBoundingClientRect());
    const boundaryX = (g) => {
      if (g <= 0) return stripRect.left - base.left;
      if (g >= rects.length) return stripRect.right - base.left;
      return (rects[g - 1].right + rects[g].left) / 2 - base.left;
    };

    band.querySelectorAll(".cro-nav-rule").forEach((rule) => {
      rule.style.left = `${boundaryX(Number(rule.dataset.g))}px`;
      rule.style.visibility = "visible";
    });
    band.querySelectorAll(".cro-pp-span, .cro-ffn-span").forEach((el) => {
      const left = boundaryX(Number(el.dataset.g0));
      const right = boundaryX(Number(el.dataset.g1));
      el.style.left = `${left}px`;
      el.style.width = `${Math.max(0, right - left)}px`;
      el.style.visibility = "visible";
    });
  }

  /* ══ 典型层里的并行分支 ══════════════════════════════════════════════════
     deck（model-architecture-3d-deck）把两组算子真的画成并排的两条竖直支路：
       · 注意力的 Q 路径 ∥ KV 路径（deck 里 x=98 vs x=446，同一 y）；
       · MoE 的路由专家支路（Router→Dispatch→Expert Pool→Combine）∥ 共享专家
         支路（shared_expert 在 x=508）。
     投影成典型层时若一律竖排，就把「并行」读成了「串行」。下表按 deck 的
     SIDE_ROWS 配对声明每组并行支路的左/右分栏成员（lanes[0]=左、lanes[1]=右，
     与 deck 的 x 顺序一致），renderStructure 据此把这一段渲染成左右两条子栈；
     在 deck 里两支汇合的节点（attention_core / moe_branch_add）本身不属于任何
     分栏，会自然收束回整条竖排。deck 换布局时改这里即可，其余逻辑不动。 */
  const PARALLEL_GROUPS = [
    { id: "attn_qkv", lanes: [
      ["q_a_proj", "q_causal_conv", "q_residual_add", "q_a_norm", "q_b_proj", "query_tensor"],
      ["kv_a_proj", "kv_causal_conv", "kv_residual_add", "kv_a_norm", "kv_b_proj", "key_tensor"],
    ] },
    { id: "moe_branch", lanes: [
      ["gate", "a2a_dispatch", "expert_pool", "a2a_combine"],
      ["shared_expert"],
    ] },
  ];
  /* deckNode id → { group, lane, laneCount }：同一 id 只属于一组一栏。 */
  const PARALLEL_LOOKUP = (() => {
    const map = new Map();
    PARALLEL_GROUPS.forEach((group) => {
      group.lanes.forEach((ids, lane) => {
        ids.forEach((id) => map.set(id, { group: group.id, lane, laneCount: group.lanes.length }));
      });
    });
    return map;
  })();

  /* ══ 渲染：五段结构条 ════════════════════════════════════════════════════ */
  function renderStructure(container, topology, emit) {
    if (!container) return;
    const columns = activeColumns(topology);
    container.innerHTML = "";
    // 与 Layer 导航同一套列宽，两块对齐成一个整体
    container.style.gridTemplateColumns = columnTemplate(columns);

    const makeBar = (bar, col) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "cro-bar";
      el.dataset.segment = col.id;
      el.dataset.bar = bar.id;
      if (bar.deckNode) el.dataset.deckNode = bar.deckNode;
      if (bar.experts) el.dataset.experts = bar.experts;
      el.dataset.op = bar.op;   // 与 deck 节点同名 op → 取到同一个 --pto-model-deck-* 色
      el.textContent = bar.label;
      el.addEventListener("click", () => emit({
        kind: "segment",
        segment: col.id,
        bar: bar.id,
        deckNode: bar.deckNode,
        experts: bar.experts || null,
        layers: col.layers,
      }));
      return el;
    };

    columns.forEach((col) => {
      const wrap = document.createElement("div");
      wrap.className = "cro-structure__col";
      wrap.dataset.segment = col.id;
      /* 整列（名字 + 底板）都是「选中这一整个典型层」的热区：命中列内某根 .cro-bar
         时直接放行（那颗算子条自己的 click 走单算子通路），否则发一个 wholeColumn
         选择 —— 锚点是整列底板（.cro-structure__stack）、整网侧是整张层卡，而不是
         列里的第一个算子。resolveRelation 据 wholeColumn 覆盖整段的层/专家/rank。 */
      wrap.addEventListener("click", (event) => {
        if (event.target.closest(".cro-bar")) return;
        emit({ kind: "segment", segment: col.id, wholeColumn: true, layers: col.layers });
      });

      const name = document.createElement("button");
      name.type = "button";
      name.className = "cro-structure__name";
      name.textContent = col.name;
      name.title = col.name;
      name.setAttribute("aria-label", col.name);

      const stack = document.createElement("div");
      stack.className = "cro-structure__stack";

      /* 把 bars 切成「整条竖排段」与「并行分支段」交替的块：连续且属于同一
         并行组的 bar 收进一块，用左右分栏子栈渲染；其余 bar 直接整条竖排。
         bar 在 col.bars 里本就按 deck 的 y 顺序排列，故各栏内竖排顺序天然正确。 */
      let pending = null;   // { group, lanes: bar[][] }
      const flush = () => {
        if (!pending) return;
        const lanes = document.createElement("div");
        lanes.className = "cro-structure__lanes";
        pending.lanes.forEach((barsInLane) => {
          const lane = document.createElement("div");
          lane.className = "cro-structure__lane";
          barsInLane.forEach((bar) => lane.appendChild(makeBar(bar, col)));
          lanes.appendChild(lane);
        });
        stack.appendChild(lanes);
        pending = null;
      };

      col.bars.forEach((bar) => {
        const info = bar.deckNode ? PARALLEL_LOOKUP.get(bar.deckNode) : null;
        if (!info) { flush(); stack.appendChild(makeBar(bar, col)); return; }
        if (!pending || pending.group !== info.group) {
          flush();
          pending = { group: info.group, lanes: Array.from({ length: info.laneCount }, () => []) };
        }
        pending.lanes[info.lane].push(bar);
      });
      flush();

      wrap.append(name, stack);
      container.appendChild(wrap);
    });
  }

  /* ══ 渲染：MoE 专家面板（第 5 项）════════════════════════════════════════
     共享专家 SE0…（始终激活，不参与路由）+ 路由专家按 EP rank 分组，
     每组 routedExpert / ep 个专家。分组与成员全部由 topology.epRanks 派生，
     改 Routed Expert / EP 立即重建。 */
  function renderMoe(sharedHost, routedHost, topology, emit) {
    const { counts, epRanks } = topology;

    if (sharedHost) {
      sharedHost.innerHTML = "";
      if (counts.sharedExpert > 0) {
        for (let i = 0; i < counts.sharedExpert; i += 1) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "cro-expert cro-expert--shared";
          chip.dataset.shared = String(i);
          chip.dataset.op = "mlp";           // 与结构条 shared_expert bar 同色
          chip.textContent = `SE${i}`;
          chip.title = `共享专家 SE${i} · 每个 token 都经过，不参与 top-${counts.topK} 路由`;
          chip.setAttribute("aria-label", chip.title);
          chip.addEventListener("click", () => emit({
            kind: "sharedExpert", shared: i, deckNode: "shared_expert",
          }));
          sharedHost.appendChild(chip);
        }
      } else {
        const empty = document.createElement("span");
        empty.className = "cro-empty";
        empty.textContent = "无共享专家";
        sharedHost.appendChild(empty);
      }
    }

    if (!routedHost) return;
    routedHost.innerHTML = "";
    if (!epRanks.length || !counts.expertsPerEpRank) {
      const empty = document.createElement("span");
      empty.className = "cro-empty";
      empty.textContent = `路由专家 ${counts.routedExpert} 无法均分到 EP ${counts.ep}`;
      routedHost.appendChild(empty);
      return;
    }

    epRanks.forEach((entry) => {
      const group = document.createElement("div");
      group.className = "cro-moe-group";
      group.dataset.epRank = String(entry.epRank);

      /* 整张卡片都是「选中这个 EP 组」的热区 —— 组名那几个字太小，点不中。
         专家胶囊有自己的 kind:"expert"，让它们的 click 冒到这里就会被这一组
         盖掉，所以命中 .cro-expert 时直接放行。组名按钮不再单独挂 listener，
         它的 click 冒上来走同一条路径，键盘可达性照旧由它承担。 */
      group.title = `EP rank ${entry.epRank} · 持有专家 E${entry.lo}~E${entry.hi}（${entry.experts.length} 个）`;
      group.addEventListener("click", (event) => {
        if (event.target.closest(".cro-expert")) return;
        emit({ kind: "epRank", epRank: entry.epRank, experts: entry.experts, deckNode: "expert_pool" });
      });

      const name = document.createElement("button");
      name.type = "button";
      name.className = "cro-moe-group__name";
      name.textContent = `EP${entry.epRank}`;
      name.setAttribute("aria-label", group.title);

      const experts = document.createElement("div");
      experts.className = "cro-moe-group__experts";
      entry.experts.forEach((e) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "cro-expert";
        dot.dataset.expert = String(e);
        dot.dataset.epRank = String(entry.epRank);
        dot.dataset.op = "moe";            // 与结构条 expert_pool bar 同色
        dot.textContent = `E${e}`;
        dot.title = `路由专家 E${e} · 驻留 EP rank ${entry.epRank}`;
        dot.setAttribute("aria-label", dot.title);
        dot.addEventListener("click", () => emit({
          kind: "expert", expert: e, epRank: entry.epRank, deckNode: "expert_pool",
        }));
        experts.appendChild(dot);
      });

      group.append(name, experts);
      routedHost.appendChild(group);
    });
  }

  /* ══ 渲染：集群图（第 6 项）══════════════════════════════════════════════
     完全参数化，不再是 training-run-twin.js 里写死的 DP4×8行×64列。
     几何直接来自 rank 编址 r = s·(DP·EP·TP·CP) + d·(EP·TP·CP) + p·(TP·CP) + inner：

        列组 = PP stage              （pp 个 Stage 块左右并排）
        列   = 块内 EP rank          （每块 ep 列）
        行   = DP 副本 × tp × cp     （最左一块带 DP0…DPn 标签）
        格   = 1 个 rank，总数 = dp·pp·ep·tp·cp = Total Rank

     ⚠️ 默认 4 块 × 64 列 = 256 列，要在不横向滚动的前提下全部显示完，
     所以格间距必须为 0、列轨必须是 minmax(0, 1fr)（可无限收缩）。
     格宽会小到 2~3px，此时 inset 描边会把格子填满，故静息态改用背景填充。
     格高由 CSS 显式给定，与宽度解耦。

     复用 training-run-twin.css 的 .twin-heat / .twin-heat-cell /
     .twin-heat-dp-group 视觉，不新造网格样式。不用 .ep-tint-N（EP 列的 8 色
     循环底色）—— 本页格子是描边态，那批底色会透出来变成一片杂色。 */
  const CLUSTER_CELL_CAP = 16384;

  function renderCluster(host, topology, emit) {
    if (!host) return;
    const { counts } = topology;
    const { pp, dp, ep, totalRank } = counts;
    const innerRows = counts.ranksPerEp;   // tp × cp
    host.innerHTML = "";

    if (!topology.valid) {
      const note = document.createElement("span");
      note.className = "cro-empty";
      note.textContent = "配置不自洽，集群网格暂不重建（见上方提示）";
      host.appendChild(note);
      return;
    }
    if (totalRank > CLUSTER_CELL_CAP) {
      const note = document.createElement("span");
      note.className = "cro-empty";
      note.textContent = `${totalRank} 卡超过 ${CLUSTER_CELL_CAP} 格上限，不逐卡绘制`;
      host.appendChild(note);
      return;
    }

    /* 每个 DP 在每个 stage 块里不再挤成一行 ep 个格子，而是折成
       epRows × epCols 的小方阵（默认 64 → 4 行 × 16 列），行主序填。
       总列数 = pp × epCols = 4×16 = 64，总行数 = dp × epRows = 8×4 = 32，
       格子从 2.5px 宽放大到 ~10px，仍然是 2048 格、不横向滚动。
       两级列轨都必须能收缩到 0：任意一级留下限，另一级就会溢出压在隔壁块上。 */
    /* 每个 DP 在每个 stage 块里折成 2 行（默认 64 EP → 2×32）。
       两级列轨都用 1fr：宽度随本列自适应，既不溢出也不需要横向滚动；
       整体占地靠格高（CSS 里 4px）和行数（8 DP × 2 = 16 行）压下来。 */
    const epRows = Math.min(2, ep);
    const epCols = Math.ceil(ep / epRows);
    const stageTemplate = `repeat(${pp}, minmax(0, 1fr))`;
    const cellTemplate = `repeat(${epCols}, minmax(0, 1fr))`;

    // ── 上：PP stage 标签，与下方 stage 块同列 ──
    const stageLabels = document.createElement("div");
    stageLabels.className = "twin-heat-pp-labels";
    stageLabels.style.gridTemplateColumns = stageTemplate;
    for (let s = 0; s < pp; s += 1) {
      const label = document.createElement("span");
      label.textContent = `Stage${s}`;
      stageLabels.appendChild(label);
    }
    host.appendChild(stageLabels);

    /* ── 中：每个 DP 副本一个横贯全宽的分组（左侧带 DP 标签），
          组内是 pp 个 stage 小方阵并排。 ── */
    const body = document.createElement("div");
    body.className = "cro-heat-body";

    for (let d = 0; d < dp; d += 1) {
      const group = document.createElement("div");
      group.className = "twin-heat-dp-group cro-heat-dp";
      group.style.gridTemplateColumns = stageTemplate;
      group.dataset.dp = String(d);
      group.dataset.dpLabel = `DP${d}`;
      group.setAttribute("role", "rowgroup");
      group.setAttribute("aria-label", `DP${d} 副本`);

      for (let inner = 0; inner < innerRows; inner += 1) {
        for (let s = 0; s < pp; s += 1) {
          const block = document.createElement("div");
          block.className = "cro-heat-block";
          block.style.gridTemplateColumns = cellTemplate;
          block.dataset.dp = String(d);
          block.dataset.stage = String(s);
          block.setAttribute("role", "row");
          block.setAttribute("aria-label", `Stage${s} · DP${d} · ${ep} 个 EP rank`);

          for (let p = 0; p < ep; p += 1) {
            const rank = topology.rankOf(s, d, p, inner);
            const node = topology.nodeOfRank(rank);
            const cell = document.createElement("div");
            // 不带 ep-tint-N：那是 8 色循环的 EP 列底色，格子改描边后会透出来
            // 变成「五颜六色」，本页不用它编码任何信息。
            cell.className = "twin-heat-cell";
            cell.dataset.rank = String(rank);
            cell.dataset.stage = String(s);
            cell.dataset.dp = String(d);
            cell.dataset.ep = String(p);
            cell.dataset.node = String(node);
            cell.dataset.tip = `rank ${rank}\nStage${s} · DP${d} · EP${p}\nNode ${node}`;
            // 2048 个格子不能各占一个 Tab 站；用 roving tabindex + 方向键在网格内移动
            cell.setAttribute("role", "gridcell");
            cell.setAttribute("tabindex", rank === 0 ? "0" : "-1");
            cell.setAttribute("aria-label", `rank ${rank}，Stage${s}、DP${d}、EP${p}，节点 ${node}`);
            cell.addEventListener("click", () => emit({
              kind: "rank", rank, stage: s, dpIdx: d, epRank: p, node,
            }));
            block.appendChild(cell);
          }
          group.appendChild(block);
        }
      }
      body.appendChild(group);
    }
    host.appendChild(body);

    /* ── 下：每个 stage 块底部标一次 EP 覆盖范围。
          EP 在块内是折行排布的（4 行 × 16 列），列位置不再一一对应某个 EP 序号，
          所以这里不逐列标 EP0/EP8，只给区间，精确值走格子的悬浮提示。 ── */
    const epLabels = document.createElement("div");
    epLabels.className = "cro-heat-ep-labels";
    epLabels.style.gridTemplateColumns = stageTemplate;
    for (let s = 0; s < pp; s += 1) {
      const caption = document.createElement("span");
      caption.textContent = epRows > 1 ? `EP0–EP${ep - 1}（${epRows}×${epCols}）` : `EP0–EP${ep - 1}`;
      epLabels.appendChild(caption);
    }
    host.appendChild(epLabels);

    enableGridKeyboard(host, epCols, emit);
  }

  /* 集群网格的键盘导航：整张网格只占 1 个 Tab 站，进去后用方向键在
     rank 之间移动（左右 = EP rank，上下 = 跨 stage / DP 的同一列），
     Enter/Space 触发选择。 */
  function enableGridKeyboard(host, cols, emit) {
    const cells = Array.from(host.querySelectorAll(".twin-heat-cell"));
    if (!cells.length) return;
    const rows = Math.ceil(cells.length / cols);

    const focusAt = (index) => {
      const next = cells[Math.max(0, Math.min(cells.length - 1, index))];
      if (!next) return;
      cells.forEach((cell) => cell.setAttribute("tabindex", "-1"));
      next.setAttribute("tabindex", "0");
      next.focus();
    };

    host.addEventListener("keydown", (event) => {
      const current = cells.indexOf(event.target);
      if (current < 0) return;
      const row = Math.floor(current / cols);
      const col = current % cols;
      let next = null;
      switch (event.key) {
        case "ArrowLeft": next = current - 1; break;
        case "ArrowRight": next = current + 1; break;
        case "ArrowUp": next = current - cols; break;
        case "ArrowDown": next = current + cols; break;
        case "Home": next = row * cols; break;
        case "End": next = row * cols + cols - 1; break;
        case "PageUp": next = col; break;
        case "PageDown": next = (rows - 1) * cols + col; break;
        case "Enter": case " ":
          event.preventDefault();
          event.target.click();
          return;
        default: return;
      }
      event.preventDefault();
      focusAt(next);
    });
  }

  /* ══ 关系引擎（第 7 项）══════════════════════════════════════════════════
     把任意一个视图里的点击，解析成「整网 / Layer / 专家 / 集群」四者的
     全量关系集。全部走 topology 的确定性查询，不猜、不缓存。
     解析结果是无向的：从哪个视图点进来，其余三个视图都被点亮，所以
     layer ↔ 专家 ↔ rank ↔ 算子 是双向互查的。 */
  function resolveRelation(topology, payload) {
    const { counts } = topology;
    const columns = activeColumns(topology);
    const rel = {
      primary: payload,
      layers: new Set(), stages: new Set(),
      segment: null, bar: null, unit: null, deckNode: payload.deckNode || null, deckLayer: null,
      // wholeColumn：点了典型层的名字/底板 = 选中整列。锚点是整块底板、整网侧是整张
      // 层卡，而不是列里某个算子；关系集覆盖整段的层/专家/rank。
      wholeColumn: Boolean(payload.wholeColumn),
      // deckStatic：目标算子在 deck 的 input / output 静态段里（Emb / Final Norm /
      // LM Head / MTP…），不属于任何一张层卡片。selectNode(id, layer) 会把查找
      // 限死在那张层卡内，静态节点永远找不到 —— 于是既选不中也连不出线。
      deckStatic: false,
      // 一次选择往往横跨多列（一个 rank 压住它那段 PP 的 Dense+MoE+端点列），
      // 单值 segment 只够记「点了哪一列」，列级高亮/去色必须看这个集合。
      segments: new Set(), units: new Set(), staticNodes: new Set(),
      experts: new Set(), epRanks: new Set(), shared: new Set(),
      ranks: new Set(), nodes: [],
      labels: {},
    };
    const moeLayers = topology.layers.filter((l) => l.ffn === "moe").map((l) => l.index);
    const addRanks = (list) => list.forEach((r) => rel.ranks.add(r));
    const addLayers = (list) => list.forEach((l) => { rel.layers.add(l); rel.stages.add(topology.stageOfLayer(l)); });
    const allRoutedExperts = () => { for (let e = 0; e < counts.routedExpert; e += 1) rel.experts.add(e); };
    const allEpRanks = () => { for (let p = 0; p < counts.ep; p += 1) rel.epRanks.add(p); };
    const allShared = () => { for (let i = 0; i < counts.sharedExpert; i += 1) rel.shared.add(i); };
    // 端点列（Emb / Norm / Head）驻留的 PP stage
    const anchorStage = (col) => (col.stageAnchor === "first" ? 0 : Math.max(0, counts.pp - 1));
    // 整段 stage 被选中（点 PP 标签 / 点某张卡）时，端点列也在这段流水线上；
    // 点某个算子条时不算 —— MoE 算子横跨全部 stage，不该把 Norm/Head 也拖亮。
    let wholeStage = false;

    switch (payload.kind) {
      case "layer": {
        addLayers([payload.layer]);
        rel.deckLayer = payload.layer;
        const layer = topology.layers[payload.layer];
        rel.segment = layer.ffn;
        if (layer.ffn === "moe") { allRoutedExperts(); allEpRanks(); allShared(); }
        addRanks(topology.ranksOfLayer(payload.layer));
        break;
      }
      case "stage": {
        wholeStage = true;
        const entry = topology.stages[payload.stage];
        if (entry) {
          const list = [];
          for (let l = entry.lo; l <= entry.hi; l += 1) list.push(l);
          addLayers(list);
          rel.deckLayer = entry.lo;   // 整网转到这段流水线的首层
          if (list.some((l) => topology.layers[l].ffn === "moe")) { allRoutedExperts(); allEpRanks(); allShared(); }
        }
        addRanks(topology.ranksOfStage(payload.stage));
        break;
      }
      case "segment": {
        const col = columns.find((c) => c.id === payload.segment);
        rel.segment = payload.segment;
        // 整列点击不落到单个算子条：rel.bar 留空，arch 锚点走整块底板；deckNode 也
        // 留空，net 锚点退回整张层卡（见 collectAnchors）。单算子点击才设 rel.bar。
        if (!payload.wholeColumn) rel.bar = { segment: payload.segment, bar: payload.bar };
        if (col && col.layers.length) {
          // 已经选中某一层时，点算子条只收敛到那一层（select.png 的
          //「EP Combine in Layer 3」），否则覆盖整列
          const scoped = Number.isFinite(payload.scopeLayer) && col.layers.includes(payload.scopeLayer);
          addLayers(scoped ? [payload.scopeLayer] : col.layers);
          // preferLayer：从整网图点进来时停在用户正看着的那一层，别把 deck
          // 甩到该列中间去（关系集仍是整列，只是取哪一层做展示锚点）
          const prefer = Number.isFinite(payload.preferLayer) && col.layers.includes(payload.preferLayer)
            ? payload.preferLayer
            : col.layers[Math.floor(col.layers.length / 2)];
          rel.deckLayer = scoped ? payload.scopeLayer : prefer;
          rel.stages.forEach((s) => addRanks(topology.ranksOfStage(s)));
        } else if (col && col.stageAnchor) {
          // Emb / Norm / Head：没有层，但驻留在首/末 PP stage，按 stage 接回集群
          const stage = anchorStage(col);
          const entry = topology.stages[stage];
          rel.stages.add(stage);
          rel.unit = col.id;
          // Emb / Final Norm / LM Head / MTP 都画在 deck 的静态段里，
          // deckLayer 只用来把 deck 转到流水线对应的一端，不能拿去限定查找范围
          rel.deckStatic = true;
          if (entry) rel.deckLayer = col.stageAnchor === "first" ? entry.lo : entry.hi;
          // 端点列（Emb/Norm/Head）就一个概念块，整列点击时用它的代表算子做 deck 静态
          // 节点，让 net 侧仍能连到 deck 里的 embedding / final_norm / lm_head。
          if (payload.wholeColumn && col.bars[0]) rel.deckNode = col.bars[0].deckNode;
          addRanks(topology.ranksOfStage(stage));
        }
        if (payload.wholeColumn && col && col.id === "moe") {
          // 整列点 MoE：这一整段 MoE 典型层横跨全部路由专家 + 共享专家 + 全部 EP rank
          allRoutedExperts(); allEpRanks(); allShared();
        } else if (payload.experts === "routed") { allRoutedExperts(); allEpRanks(); }
        else if (payload.experts === "shared") allShared();
        else if (col && col.id === "moe") {
          // MoE 列里其余算子（Attn / 各 Norm / 残差 Add）不落在某几个专家身上，
          // 但整段 MoE 块是横跨所有 EP rank 的。这里至少把 EP 分组接上，否则
          // MoE 区一个 is-related 都没有，collectAnchors().moe 为 null，
          // drawRelationLinks 会整条跳过，表现为「点整网/典型层从不连 MoE」。
          allEpRanks();
        }
        break;
      }
      case "expert":
      case "epRank": {
        const list = payload.kind === "expert" ? [payload.expert] : (payload.experts || []);
        list.forEach((e) => rel.experts.add(e));
        rel.epRanks.add(payload.epRank);
        rel.segment = "moe";
        rel.bar = { segment: "moe", bar: "expert_pool" };
        // 【全展开】一个路由槽位（专家编号 e）在**每个 MoE 层**都有一份实例（各层权重
        // 独立、互不相干，只共享编号与「编号→EP rank」的分片公式）；它的 EP 组在**每个
        // PP stage** 内都占一块 rank。点专家就把这个编号涉及的全部 MoE 层 + 全部 stage 的
        // 该 EP 组 rank（× DP 副本）一并连上，让「这个编号散布在哪里」一眼看全。连线侧
        // 会按 stage 拆成多条（见 drawRelationLinks），而非缩成一个巨框。
        addLayers(moeLayers);
        rel.deckLayer = moeLayers[Math.floor(moeLayers.length / 2)];
        rel.stages.forEach((s) => addRanks(topology.ranksOfEpRankInStage(s, payload.epRank)));
        break;
      }
      case "sharedExpert": {
        rel.shared.add(payload.shared);
        rel.segment = "moe";
        rel.bar = { segment: "moe", bar: "shared_expert" };
        // 共享专家同样每个 MoE 层各一份，每个 token 都过 → 连上全部 MoE 层 + 每个 stage
        // 的全部 rank。
        addLayers(moeLayers);
        rel.deckLayer = moeLayers[Math.floor(moeLayers.length / 2)];
        rel.stages.forEach((s) => addRanks(topology.ranksOfStage(s)));
        break;
      }
      case "rank": {
        wholeStage = true;
        const co = topology.coordsOfRank(payload.rank);
        rel.stages.add(co.stage);
        const entry = topology.stages[co.stage];
        if (entry) for (let l = entry.lo; l <= entry.hi; l += 1) rel.layers.add(l);
        rel.epRanks.add(co.epIdx);
        topology.expertsOfEpRank(co.epIdx).forEach((e) => rel.experts.add(e));
        allShared();
        rel.ranks.add(payload.rank);
        // 一张卡不属于某一列典型层：它持有的是自己那个 PP stage 的整段层
        // （Dense + MoE 都算），相关列由下面按 rel.layers 派生，这里不预设。
        // 整网 deck 转到这段流水线的首层，否则点末段的卡、图还停在中间层上。
        if (entry) rel.deckLayer = entry.lo;
        break;
      }
      default: break;
    }

    /* 关系覆盖到哪几列典型层：凡有层落进关系集的列都算相关；端点列没有层，
       按它驻留的 PP stage 判定，且只在整段 stage 被选中时才接上。
       以前这里只有单值 rel.segment，点一个 rank 无论压住哪几列都写死 "moe"，
       Dense / Norm / Head 既不高亮也不去色 —— 「点 rank 只连 MoE」就是这个。 */
    columns.forEach((col) => {
      if (col.layers.length) {
        if (col.layers.some((l) => rel.layers.has(l))) rel.segments.add(col.id);
      } else if (col.stageAnchor && wholeStage && rel.stages.has(anchorStage(col))) {
        rel.segments.add(col.id);
        rel.units.add(col.id);
      }
    });
    // 端点列在整网 deck 里对应静态段（input / output）的那批节点。层内节点靠
    // 层号判定即可，静态段没有层号，只能按 id 收一份名单给去色用。
    columns.forEach((col) => {
      if (col.layers.length || !rel.segments.has(col.id)) return;
      col.bars.forEach((bar) => { if (bar.deckNode) rel.staticNodes.add(bar.deckNode); });
    });
    if (rel.bar && rel.segment) rel.segments.add(rel.segment);
    // 整列点击没有 rel.bar，但被点的这一列本身当然在关系集里（端点列 col.layers 为空，
    // 上面按层号那轮不会加进来，这里补上，否则整列高亮/去色都读不到自己）。
    if (rel.wholeColumn && rel.segment) rel.segments.add(rel.segment);
    if (rel.unit) rel.units.add(rel.unit);

    rel.nodes = topology.nodesOfRanks(Array.from(rel.ranks));
    rel.labels = relationLabels(topology, rel, columns);
    return rel;
  }

  function summarizeRuns(values) {
    const sorted = Array.from(values).sort((a, b) => a - b);
    const runs = [];
    sorted.forEach((v) => {
      const last = runs[runs.length - 1];
      if (last && v === last[1] + 1) last[1] = v;
      else runs.push([v, v]);
    });
    return runs;
  }

  function formatRuns(values, prefix, maxRuns = 3) {
    const runs = summarizeRuns(values);
    if (!runs.length) return "";
    const shown = runs.slice(0, maxRuns)
      .map(([a, b]) => (a === b ? `${prefix}${a}` : `${prefix}${a}~${b}`))
      .join("+");
    return runs.length > maxRuns ? `${shown} 等 ${runs.length} 段` : shown;
  }

  function relationLabels(topology, rel, columns) {
    const labels = {};
    const c = topology.counts;

    // 整列点击：主标签直接报这一整个典型层的名字（如「Dense x2（L0~L1）」/「MoE
    // x44（L2~L45）」/「Emb」），表示连的是整块而非某个算子。
    if (rel.wholeColumn) {
      const col = columns.find((x) => x.id === rel.segment);
      if (col) {
        labels.arch = col.layers.length || rel.stages.size !== 1
          ? col.name
          : `${col.name} · PP${Array.from(rel.stages)[0]}`;
      }
    } else if (rel.bar) {
      const col = columns.find((x) => x.id === rel.bar.segment);
      const barDef = col && col.bars.find((b) => b.id === rel.bar.bar);
      const name = barDef ? barDef.label : rel.bar.bar;
      if (rel.layers.size === 1) {
        const only = Array.from(rel.layers)[0];
        // 单层定位一律带上 PP 段，把「这个算子/专家究竟落在哪一段流水线」写死在标签上
        labels.arch = `${name} in Layer ${only} · PP${topology.stageOfLayer(only)}`;
      } else if (rel.layers.size) {
        labels.arch = `${name} · ${formatRuns(rel.layers, "L", 1)}`;
      } else {
        // Emb / Norm / Head 不是层，只有 PP 归属可报
        labels.arch = rel.stages.size === 1 ? `${name} · PP${Array.from(rel.stages)[0]}` : name;
      }
    } else if (rel.layers.size === 1) {
      const l = Array.from(rel.layers)[0];
      const layer = topology.layers[l];
      labels.arch = `Layer ${l} · PP${layer.stage} · ${layer.ffn === "dense" ? "Dense" : "MoE"} · ${layer.attention.toUpperCase()}`;
    } else if (rel.stages.size === 1) {
      labels.arch = `PP${Array.from(rel.stages)[0]} · ${formatRuns(rel.layers, "L", 1)}`;
    }

    // 专家 / EP 组 / 共享专家：主标签点明「该编号在全部相关 MoE 层各有一份」，既表达
    // 全展开的分布范围，又不误导成「同一个专家横跨各层」（各层是独立权重实例）。
    const pk = rel.primary && rel.primary.kind;
    if ((pk === "expert" || pk === "epRank" || pk === "sharedExpert") && rel.layers.size) {
      const who = pk === "expert" ? `E${rel.primary.expert}`
        : pk === "sharedExpert" ? `SE${rel.primary.shared}`
        : `EP${rel.primary.epRank}`;
      labels.arch = `${who} · ${formatRuns(rel.layers, "L", 1)} 各一份`;
    }

    // MoE：EP 组 + 组内专家区间，专家全量时改用摘要，避免拼出 64 段
    const epParts = [];
    if (rel.epRanks.size && rel.epRanks.size < c.ep) {
      Array.from(rel.epRanks).sort((a, b) => a - b).slice(0, 3).forEach((p) => {
        const own = topology.expertsOfEpRank(p).filter((e) => rel.experts.has(e));
        epParts.push(own.length ? `EP${p}(${formatRuns(own, "E", 1)})` : `EP${p}`);
      });
      if (rel.epRanks.size > 3) epParts.push(`等 ${rel.epRanks.size} 个 EP rank`);
    } else if (rel.epRanks.size) {
      // 只牵连到 EP 分组、没点到具体专家时（MoE 列里的 Attn / Norm / Add），
      // 不能报「N 专家」，那是没被点亮的
      epParts.push(rel.experts.size
        ? `全部 ${c.ep} 个 EP rank · ${c.routedExpert} 专家`
        : `全部 ${c.ep} 个 EP rank`);
    }
    if (rel.shared.size) epParts.push(rel.shared.size === 1 ? "Share Expert" : `Share Expert ×${rel.shared.size}`);
    if (epParts.length) labels.moe = epParts.join("+");

    // 集群：节点区间 + 卡数。节点常常是等距散布（同一 EP rank 的 DP 副本每隔
    // ranksPerNode 一跳），逐段列会拼成「0+8+16 等 32 段」这种噪音，故退化成
    // 首尾 + 个数。
    if (rel.ranks.size) {
      const runs = summarizeRuns(rel.nodes);
      const span = runs.length <= 2
        ? formatRuns(rel.nodes, "", 2)
        : `${rel.nodes[0]}…${rel.nodes[rel.nodes.length - 1]}（${rel.nodes.length} 个）`;
      labels.cluster = `Node ${span} · ${rel.ranks.size} 卡`;
    }
    return labels;
  }

  /* ══ 关系连线层（第 7 项）════════════════════════════════════════════════
     以被点中的那个视图为 hub，向其余视图各拉一条曲线，中点挂标签。
     用 viewport 坐标直接画在 position:fixed 的 SVG 上，滚动/缩放时重画。 */
  const SVG_NS = "http://www.w3.org/2000/svg";

  /* 一组元素的并集包围盒。关系集经常是「一整组」——某层的全部 rank、某个
     EP rank 的全部专家、某列的全部算子 —— 这时连线应该接到整组，而不是挑
     组里的某一个元素。 */
  function unionRect(elements) {
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    elements.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      left = Math.min(left, r.left); top = Math.min(top, r.top);
      right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    });
    if (!Number.isFinite(left)) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /* 锚点夹回宿主的可视矩形。
     元素被自己所在的滚动/裁剪容器裁掉时 getBoundingClientRect 照样返回有效
     几何，只是那个位置压根不在屏幕上 —— 连线就从可视区里一头扎出去，看着
     就是「高亮有了、线没有」。整网 deck 最典型：正视图下 input / output 静态段
     分别落在层卡上下 700px / 520px 处（Emb、Final Norm、LM Head、MTP 全在
     里面），几乎必定在 deck 视口之外。夹回之后线终止在区域边界上，指向正确。 */
  function clampRectTo(rect, host) {
    if (!rect || !host) return rect;
    const box = host.getBoundingClientRect();
    if (!box.width && !box.height) return rect;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const left = clamp(rect.left, box.left, box.right);
    const right = clamp(rect.right, box.left, box.right);
    const top = clamp(rect.top, box.top, box.bottom);
    const bottom = clamp(rect.bottom, box.top, box.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /* 每个视图返回 { rect, group }：group=true 表示这是一整组，
     连线端点会落在整组包围盒的边上，并额外画一圈虚线框把范围圈出来。
     第三个参数是该视图的可视宿主，锚点一律夹在它的边界内。 */
  function collectAnchors() {
    const qsa = (sel) => Array.from(document.querySelectorAll(sel));
    const board = document.getElementById("croBoard");
    const pick = (selectedSel, relatedSel, hostSel) => {
      const host = hostSel ? document.querySelector(hostSel) : null;
      // 宿主自己也可能被 .cro-board 滚出去，两级都夹
      const fit = (rect) => clampRectTo(clampRectTo(rect, host), board);
      const one = document.querySelector(selectedSel);
      if (one) {
        // 零尺寸 = 元素在被隐藏的区域里（deck 正视图的非 front 层是
        // display:none，折叠的整网区同理）。此时 rect 全 0，直接当锚点用
        // 会把连线拉到视口左上角，必须判无锚点。
        // 有效性判在**未夹取**的原始 rect 上：夹取会把「在可视区外但确实存在」
        // 的元素压成零高/零宽的一条边，那是合法锚点，不能当成不存在。
        const rect = one.getBoundingClientRect();
        if (rect.width || rect.height) return { rect: fit(rect), group: false };
      }
      const many = qsa(relatedSel);
      if (!many.length) return null;
      // 元素全部为零尺寸（比如所在区域被折叠）时 unionRect 返回 null，
      // 这里直接判无锚点，别把 null 传下去让 centerOf 炸掉。
      const rect = unionRect(many);
      return rect ? { rect: fit(rect), group: many.length > 1 } : null;
    };
    return {
      // 粗粒度选择（rank / stage / 层）没有被选中的算子节点，退到「被牵连的层卡」
      // 上取锚点。正视图下非 front 的层卡是 display:none、rect 全 0，unionRect
      // 会把它们跳过，实际落到当前正视的那张卡上，不会拉出一个巨大的包围盒。
      net: pick(
        "#croDeckHost .pto-model-deck__node.is-selected",
        "#croDeckHost .pto-model-deck__node.is-selected, #croDeckHost .pto-model-deck__layer.is-selected, #croDeckHost .pto-model-deck__layer.is-related",
        "#croDeckHost",
      ),
      nav: pick(".cro-tick.is-selected", ".cro-tick.is-related", "#croLayerNav"),
      // 整列点击时没有单个 .cro-bar.is-selected，锚点取整块底板（.cro-structure__col
      // .is-selected .cro-structure__stack）；单算子点击则仍锚在那根算子条上。
      arch: pick(
        ".cro-bar.is-selected, .cro-structure__col.is-selected .cro-structure__stack",
        ".cro-structure__col.is-related .cro-structure__stack",
        "#croStructure",
      ),
      // 选中整个 EP 组时，连线要接到组卡片本身（与白描边同一个框），
      // 而不是退化成组内专家的并集包围盒再补一圈虚线。
      moe: pick(
        ".cro-moe-group.is-selected, .cro-expert.is-selected",
        ".cro-expert.is-related, .cro-moe-group.is-related",
        ".cro-region--moe",
      ),
      cluster: pick("#croHeat .twin-heat-cell.is-selected", "#croHeat .twin-heat-cell.is-related", "#croHeat"),
    };
  }

  /* 集群里被牵连的格子按 PP stage 拆成多个锚点。点专家/EP 组/共享专家时，该编号的
     EP 组在**每个 stage** 内都占一块 rank —— 集群图正好横向分成 pp 个 stage 块，把
     每块的并集包围盒各作一个锚点，drawRelationLinks 就能对每个 stage 各拉一条线，
     而不是把 4 段并成一个横跨整幅热力图的巨框。 */
  function clusterStageAnchors() {
    const host = document.querySelector("#croHeat");
    const board = document.getElementById("croBoard");
    if (!host) return [];
    const fit = (rect) => clampRectTo(clampRectTo(rect, host), board);
    const byStage = new Map();
    host.querySelectorAll(".twin-heat-cell.is-related, .twin-heat-cell.is-selected").forEach((cell) => {
      const s = Number(cell.dataset.stage);
      if (!Number.isFinite(s)) return;
      if (!byStage.has(s)) byStage.set(s, []);
      byStage.get(s).push(cell);
    });
    const out = [];
    byStage.forEach((cells, stage) => {
      const rect = unionRect(cells);
      if (rect) out.push({ stage, rect: fit(rect), group: cells.length > 1 });
    });
    return out.sort((a, b) => a.stage - b.stage);
  }

  const centerOf = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

  /* 端点落在包围盒朝向对方的那条边上，而不是几何中心 —— 否则一整组的连线
     会从组的正中穿出来，看着像指向组里某一格。 */
  function edgePoint(r, toward) {
    const c = centerOf(r);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (Math.abs(dx) * r.height > Math.abs(dy) * r.width) {
      return { x: dx > 0 ? r.right : r.left, y: c.y };
    }
    return { x: c.x, y: dy > 0 ? r.bottom : r.top };
  }

  function appendGroupOutline(layer, r) {
    // 夹到可视区边界后可能只剩一条线（目标整体在区域外），这时画虚线框没有意义
    if (r.width < 4 || r.height < 4) return;
    const box = document.createElementNS(SVG_NS, "rect");
    box.setAttribute("class", "cro-link-group");
    box.setAttribute("x", String(r.left - 3));
    box.setAttribute("y", String(r.top - 3));
    box.setAttribute("width", String(r.width + 6));
    box.setAttribute("height", String(r.height + 6));
    box.setAttribute("rx", "4");
    layer.appendChild(box);
  }

  function drawRelationLinks(layer, rel) {
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    if (!rel) return;

    const anchors = collectAnchors();
    const order = ["net", "nav", "arch", "moe", "cluster"];
    const preferred = hubOf(rel);
    const hubKey = anchors[preferred] ? preferred : order.find((key) => anchors[key]);
    const hub = hubKey && anchors[hubKey];
    if (!hub) return;

    const hubCenter = centerOf(hub.rect);
    const labelFor = {
      net: rel.labels.arch, arch: rel.labels.arch, nav: rel.labels.arch,
      moe: rel.labels.moe, cluster: rel.labels.cluster,
    };

    // 一条 hub→target 的曲线 + 可选中点标签 + 可选整组虚线框
    const drawLink = (targetRect, isGroup, labelText) => {
      const toCenter = centerOf(targetRect);
      const from = edgePoint(hub.rect, toCenter);
      const to = edgePoint(targetRect, hubCenter);
      if (!Number.isFinite(to.x) || !Number.isFinite(from.x)) return;
      if (isGroup) appendGroupOutline(layer, targetRect);
      const bend = Math.max(48, Math.abs(to.x - from.x) * 0.45);
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M${from.x} ${from.y}C${from.x + (to.x > from.x ? bend : -bend)} ${from.y},${to.x + (to.x > from.x ? -bend : bend)} ${to.y},${to.x} ${to.y}`);
      path.setAttribute("class", "cro-link");
      layer.appendChild(path);
      if (labelText) appendLinkLabel(layer, labelText, (from.x + to.x) / 2, (from.y + to.y) / 2);
    };

    if (hub.group) appendGroupOutline(layer, hub.rect);

    // 点专家/EP 组/共享专家时，该编号的 rank 分布在每个 PP stage 里 —— 集群侧按 stage
    // 拆成多条线（每段一条 + 一圈虚线框），整段的「Node… · N 卡」标签只挂在离 hub 最近
    // 的那条上，其余段只留虚线框，避免 4 个标签堆叠。
    const fanCluster = rel.primary
      && (rel.primary.kind === "expert" || rel.primary.kind === "epRank" || rel.primary.kind === "sharedExpert");

    order.forEach((key) => {
      if (key === hubKey) return;
      if (key === "cluster" && fanCluster) {
        const stageAnchors = clusterStageAnchors();
        if (stageAnchors.length) {
          // 离 hub（MoE 列，在右侧）最近的一段挂总标签
          let nearest = 0; let best = Infinity;
          stageAnchors.forEach((a, i) => {
            const d = Math.abs(centerOf(a.rect).x - hubCenter.x) + Math.abs(centerOf(a.rect).y - hubCenter.y);
            if (d < best) { best = d; nearest = i; }
          });
          stageAnchors.forEach((a, i) => drawLink(a.rect, a.group, i === nearest ? rel.labels.cluster : null));
          return;
        }
      }
      const target = anchors[key];
      if (!target) return;
      drawLink(target.rect, target.group, labelFor[key]);
    });
  }

  function hubOf(rel) {
    switch (rel.primary.kind) {
      case "rank": return "cluster";
      case "expert": case "epRank": case "sharedExpert": return "moe";
      case "layer": case "stage": return "nav";
      default: return "arch";
    }
  }

  function appendLinkLabel(layer, text, x, y) {
    const group = document.createElementNS(SVG_NS, "g");
    const box = document.createElementNS(SVG_NS, "rect");
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "cro-link-label__text");
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(y));
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("text-anchor", "middle");
    label.textContent = text;
    box.setAttribute("class", "cro-link-label__box");
    group.append(box, label);
    layer.appendChild(group);
    // 先入 DOM 才能量到文字尺寸，再把底板补到文字后面
    const bbox = label.getBBox();
    const padX = 8;
    const padY = 5;
    box.setAttribute("x", String(bbox.x - padX));
    box.setAttribute("y", String(bbox.y - padY));
    box.setAttribute("width", String(bbox.width + padX * 2));
    box.setAttribute("height", String(bbox.height + padY * 2));
    box.setAttribute("rx", "4");
  }

  global.CroTopology = {
    MODEL_PRESETS,
    FIELD_SPECS,
    FIELD_ORDER,
    validate,
    derive,
    stepValue,
    createController,
    deckConfigFrom,
    structureColumns,
    columnTemplate,
    resolveRelation,
    deckNodeIndex,
  };

  /* ── 选中项自动露出 ───────────────────────────────────────────────────────
     只滚 container 自己，绝不用 el.scrollIntoView()：后者会把**所有**祖先滚动
     容器一起滚（.cro-board 是 overflow:auto，document 也可滚），点一个专家会
     把整块面板连同整网图一起挪走。这里手算容器与目标的相对位置，只在目标真的
     不在可视区内时补差值，已经露着就一动不动。 */
  const REVEAL_PAD = 10;

  function revealIn(container, el) {
    if (!container || !el || !container.contains(el)) return;
    const box = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    let delta = 0;
    if (rect.top < box.top + REVEAL_PAD) delta = rect.top - box.top - REVEAL_PAD;
    else if (rect.bottom > box.bottom - REVEAL_PAD) delta = rect.bottom - box.bottom + REVEAL_PAD;
    if (!delta) return;
    // 目标比可视区还高时上面的算法会把它顶到底边，改为对齐顶部
    if (rect.height > box.height - REVEAL_PAD * 2) delta = rect.top - box.top - REVEAL_PAD;
    container.scrollBy({ top: delta, behavior: "smooth" });
  }

  /* 按优先级取第一个命中的元素。querySelector 传选择器列表是按**文档顺序**
     返回的，不是按列表顺序，会出现「先选中了某个专家，却滚到了排在它前面的
     某个 is-related 组」。 */
  function firstMatch(root, selectors) {
    if (!root) return null;
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /* ── 页面接线 ─────────────────────────────────────────────────────────── */
  function boot() {
    const controller = createController();
    controller.mount(document.getElementById("croParallelSteppers"), "parallel");
    controller.mount(document.getElementById("croMoeSteppers"), "moe");
    controller.mount(document.getElementById("croClusterSteppers"), "cluster");

    /* 整网图 → 其余视图：点 deck 里的算子节点，反查成结构条的 (segment, bar)
       再走同一条 emitSelect 通路，与其他三个方向完全对称。 */
    const deck = createDeck("croDeckHost", {
      onNodeSelect(selected) {
        if (!selected) return;
        const topology = controller.topology;
        let hit = deckNodeIndex(topology).get(selected.nodeId);
        const layer = Number.isFinite(selected.layer) ? selected.layer : null;

        // attention_core / post_mlp_norm 这类节点 Dense 和 MoE 两列都有，
        // 用节点所在层的 FFN 类型消歧，别一律落到先注册的那一列
        if (hit && layer !== null) {
          const ffn = topology.layers[layer]?.ffn;
          if (ffn && (hit.segment === "dense" || hit.segment === "moe") && hit.segment !== ffn) {
            const col = activeColumns(topology).find((c) => c.id === ffn);
            const bar = col && col.bars.find((b) => b.deckNode === selected.nodeId);
            if (bar) hit = { segment: col.id, bar: bar.id, experts: bar.experts || null, layers: col.layers };
          }
        }

        if (hit) {
          // 不传 scopeLayer：整网图的一个算子（EP Combine、Attn…）在同类型的
          // 每一层都存在，直接点它就该亮出整列的层。要收敛到单层得先在 Layer
          // 导航里选中那层，再点算子 —— 这条收敛规则统一由 emitSelect 施加，
          // 与结构条的点击路径保持同一套语义（select.png 的
          //「EP Combine in Layer 3」正是先选层后点条）。
          emitSelect({
            kind: "segment", segment: hit.segment, bar: hit.bar,
            deckNode: selected.nodeId, experts: hit.experts, layers: hit.layers,
            preferLayer: layer,   // deck 停在用户正看的那一层，不跳走
          });
        } else if (layer !== null) {
          emitSelect({ kind: "layer", layer });
        }
      },
    });
    const layerNav = document.getElementById("croLayerNav");
    const structure = document.getElementById("croStructure");

    const linkLayer = document.getElementById("croLinkLayer");
    let relation = null;

    function emitSelect(payload) {
      const topology = controller.topology;
      // 「先选层、再点算子条」时把结构条收敛到那一层（select.png 的 EP Combine in Layer 3）
      if (payload && payload.kind === "segment" && !Number.isFinite(payload.scopeLayer)) {
        const prev = relation && relation.primary;
        if (prev && prev.kind === "layer" && (payload.layers || []).includes(prev.layer)) {
          payload = { ...payload, scopeLayer: prev.layer };
        }
      }
      relation = payload ? resolveRelation(topology, payload) : null;
      applyRelation(relation);
      document.dispatchEvent(new CustomEvent("cro:select", { detail: relation }));
    }

    function clearSelection() { emitSelect(null); }

    function redrawLinks() { drawRelationLinks(linkLayer, relation); }

    /* 把关系集铺到四个视图。selected = 用户点中的那一个，related = 被它牵连出来的。
       rel 为 null 表示清空，回到「默认不预选、不高亮」的静息态。 */
    function applyRelation(rel) {
      const p = rel ? rel.primary : null;
      // 收关系集时必须传属性名而不是 rel.xxx —— 后者是实参，会在 has 执行
      // 之前就求值，rel 为 null（清空）时第一次调用就 TypeError，整个清空中断。
      const has = (key, v) => Boolean(rel) && rel[key].has(v);
      const board = document.getElementById("croBoard");
      board?.classList.toggle("is-focused", Boolean(rel));

      // ── Layer 导航 ──
      layerNav?.querySelectorAll(".cro-tick").forEach((tick) => {
        // 端点刻度（Emb / Norm / Head）没有 layer，按 segment 匹配
        if (tick.dataset.unit) {
          const unit = tick.dataset.unit;
          const selected = Boolean(rel) && rel.unit === unit;
          tick.classList.toggle("is-selected", selected);
          // 端点刻度以前恒为 false：点 stage / rank 时 Emb / Norm / Head 明明
          // 在那段流水线上，刻度带上却是灰的
          tick.classList.toggle("is-related", !selected && Boolean(rel) && rel.units.has(unit));
          return;
        }
        const l = Number(tick.dataset.layer);
        const selected = Boolean(p) && p.kind === "layer" && l === p.layer;
        tick.classList.toggle("is-selected", selected);
        tick.classList.toggle("is-related", !selected && has("layers", l));
      });
      layerNav?.querySelectorAll(".cro-pp-span").forEach((el) => {
        const s = Number(el.dataset.stage);
        const selected = Boolean(p) && p.kind === "stage" && s === p.stage;
        el.classList.toggle("is-selected", selected);
        el.classList.toggle("is-related", !selected && has("stages", s));
      });
      // Dense / MoE / Emb / Norm / Head 注记：跟着关系集走，不在范围内的整条压暗，
      // 免得选中一层后五个分区名仍是同一亮度、读不出这一层属于哪一段。
      layerNav?.querySelectorAll(".cro-ffn-span").forEach((el) => {
        el.classList.toggle("is-related", Boolean(rel) && rel.segments.has(el.dataset.segment));
      });

      // ── 结构条 ──
      structure?.querySelectorAll(".cro-bar").forEach((bar) => {
        const selected = Boolean(rel && rel.bar)
          && bar.dataset.segment === rel.bar.segment && bar.dataset.bar === rel.bar.bar;
        bar.classList.toggle("is-selected", selected);
      });
      structure?.querySelectorAll(".cro-structure__col").forEach((col) => {
        // 整列点击：被点的那一列进 is-selected（整块底板高亮描边，作连线锚点），
        // 其余被牵连的列仍是 is-related。单算子点击时没有 wholeColumn，全走 is-related。
        const selected = Boolean(rel && rel.wholeColumn) && col.dataset.segment === rel.segment;
        col.classList.toggle("is-selected", selected);
        col.classList.toggle("is-related", !selected && Boolean(rel) && rel.segments.has(col.dataset.segment));
      });

      // ── 层刻度取选中算子的语义色 ──
      // 选中的是单个算子（整网节点 / 典型层算子条，两条通路都会落到同一根
      // .cro-bar 上）时，把它的 op 写到 Layer 导航上，被点亮的那一层或那一组
      // 层就用与算子条完全相同的渐变填充，而不是统一的 --primary 蓝。
      if (layerNav) {
        const op = structure?.querySelector(".cro-bar.is-selected")?.dataset.op;
        if (op) layerNav.dataset.op = op;
        else delete layerNav.dataset.op;
      }

      // ── MoE ──
      document.querySelectorAll(".cro-expert[data-expert]").forEach((dot) => {
        const e = Number(dot.dataset.expert);
        const selected = Boolean(p) && p.kind === "expert" && e === p.expert;
        dot.classList.toggle("is-selected", selected);
        dot.classList.toggle("is-related", !selected && has("experts", e));
      });
      document.querySelectorAll(".cro-moe-group").forEach((group) => {
        const ep = Number(group.dataset.epRank);
        // 点 EP 组名 = 把整组选中：组本身进 is-selected（白描边由 CSS 给），
        // 组内专家仍留 is-related 以免被聚焦降噪压暗，但底色被 CSS 压回中性。
        const selected = Boolean(p) && p.kind === "epRank" && ep === p.epRank;
        group.classList.toggle("is-selected", selected);
        group.classList.toggle("is-related", !selected && has("epRanks", ep));
      });
      document.querySelectorAll(".cro-expert--shared").forEach((chip) => {
        const i = Number(chip.dataset.shared);
        const selected = Boolean(p) && p.kind === "sharedExpert" && i === p.shared;
        chip.classList.toggle("is-selected", selected);
        chip.classList.toggle("is-related", !selected && has("shared", i));
      });

      // ── 集群 ──
      document.querySelectorAll("#croHeat .twin-heat-cell").forEach((cell) => {
        const r = Number(cell.dataset.rank);
        const selected = Boolean(p) && p.kind === "rank" && r === p.rank;
        cell.classList.toggle("is-selected", selected);
        cell.classList.toggle("is-related", !selected && has("ranks", r));
      });

      // ── 整网 deck（回写时静音它的 onNodeSelect，否则会自激成死循环）──
      deck?.silently((api) => {
        if (!api) return;
        if (rel) {
          if (Number.isFinite(rel.deckLayer)) api.setFrontLayer?.(rel.deckLayer);
          // 没有对应算子节点时也要清掉上一次的：正视图下非 front 层是
          // display:none，留在旧层里的 .is-selected 节点会退化成 0×0 矩形，
          // collectAnchors 拿到它后关系连线就朝视口左上角画出去。
          // 第二参必须是 undefined 而不是 null —— deck 里判的是
          // Number.isFinite(Number(layer))，Number(null) === 0 会把查找锁进 L0。
          const scope = rel.deckStatic || !Number.isFinite(rel.deckLayer) ? undefined : rel.deckLayer;
          api.selectNode?.(rel.deckNode || null, scope);
        } else {
          api.selectNode?.(null);
        }
      });
      markDeckRelated(rel);

      // ── 把选中项滚进可视区 ──
      // 典型层的算子条（每列各有一条 44 层长的滚动栈）与路由专家（64 个 EP 组）
      // 都远高于各自的视口，选中项十有八九在折叠区里，不滚出来等于没高亮。
      if (rel) {
        const bar = structure?.querySelector(".cro-bar.is-selected");
        revealIn(bar?.closest(".cro-structure__stack"), bar);

        const routed = document.getElementById("croRoutedExperts");
        // 没有直接选中物时退而露出第一个被牵连的组／专家，至少把关系集的
        // 起点带到眼前（选一层 → 该层用到的 EP 组）
        revealIn(routed, firstMatch(routed, [
          ".cro-expert.is-selected",
          ".cro-moe-group.is-selected",
          ".cro-expert.is-related",
          ".cro-moe-group.is-related",
        ]));
      }

      requestAnimationFrame(redrawLinks);
    }

    const board = document.getElementById("croBoard");

    controller.onChange((topology) => {
      // 配置非法时不重建 deck，保留上一版可读的图，错误信息由 #croConfigError 承担
      if (topology.valid || !deck?.controller) deck?.build(topology);
      // deck 的语义色变量搬到 board 上，结构条 bar 与整网节点取到同一个色值
      syncDeckPalette(document.getElementById("croDeckHost"), board);
      renderLayerNav(layerNav, topology, emitSelect);
      renderStructure(structure, topology, emitSelect);
      renderMoe(
        document.getElementById("croSharedExperts"),
        document.getElementById("croRoutedExperts"),
        topology, emitSelect,
      );
      renderCluster(document.getElementById("croHeat"), topology, emitSelect);
    });

    // 列宽随窗口变化，PP 带的实测定位要跟着重排
    if (layerNav && global.ResizeObserver) {
      let pending = 0;
      new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => layoutLayerNav(layerNav));
      }).observe(layerNav);
    }
    // 主题切换会重算 deck 调色板，重新搬一次
    document.addEventListener("cro:theme", () => syncDeckPalette(document.getElementById("croDeckHost"), board));

    /* ── 连线是画在 viewport 坐标上的，任何位移都要重画 ── */
    ["scroll", "wheel"].forEach((type) => {
      document.addEventListener(type, () => requestAnimationFrame(redrawLinks), { passive: true, capture: true });
    });
    global.addEventListener("resize", () => requestAnimationFrame(redrawLinks));
    // deck 自己的拖拽/缩放会挪动被选中的节点
    document.getElementById("croDeckHost")?.addEventListener("pointermove", () => {
      if (relation) requestAnimationFrame(redrawLinks);
    }, { passive: true });

    /* ── 清空选择：Esc，或点击 board 空白处 ── */
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && relation) clearSelection();
    });
    /* 挂在 document 而不是 board：点顶栏、activity rail、集群右侧留白这些
       board 之外的地方也要能清空。命中任一可选对象则不清。 */
    const SELECTABLE = [
      ".cro-tick", ".cro-pp-span", ".cro-bar", ".cro-expert", ".cro-moe-group",
      ".cro-structure__col",
      ".twin-heat-cell", ".pto-model-deck__node", ".pto-model-deck__experts",
      ".pto-model-deck__side-rule", ".cro-stepper", ".pto-ide-frame__topbar",
    ].join(", ");
    document.addEventListener("click", (event) => {
      if (!relation) return;
      if (!event.target.closest?.(SELECTABLE)) clearSelection();
    });

    global.croObserver = controller;
    global.croDeck = deck;
    global.croSelect = emitSelect;
    controller.refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window);
