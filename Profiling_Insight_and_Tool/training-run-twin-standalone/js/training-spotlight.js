/* ══════════════════════════════════════════════════════════════════════════
   聚光灯定位链  (window.PtoTrainingSpotlight)
   —— 进入某个问题时（training-run-twin.js 的 activateProblemLens 调用 open(caseKey)），
      在实页之上覆盖暗遮罩，按步进：每一步把当前证据图表挪到可见（展开 infra 列 /
      侧栏滚动 / 切底部 dock 页签），在它上面「开洞」照亮，配编号徽标 + 引出线 + 一句话标注；
      顶部问题名片常驻、右侧「修改建议」列展示各处代码修复并高亮当前步关联项。
   —— 每个问题一份 CASES[caseKey] = { meta, fixes, steps }（见下）。一句话结论 + 关键数字
      与 training-run-twin.js 的 locateChains[caseKey] / 定位链-openPangu-2.0-Flash.md 同源；
      需要读全文时点名片「详情」→ 走 window.openLocateDrawer(caseKey)（该问题没有长文时按钮隐藏）。
   —— 样式见 css/training-spotlight.css；本层 z=1500，详情抽屉 z=2000 在其之上不被遮。
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var MARGIN = 8;

  // 256 专家负载热力循环动画(问题二「模型·数值层」步专用,见 js/training-run-twin.js
  // 的 window.PtoTrainingExpertHeatLoop):谁开的谁关——每步开头统一停一次(freeze 在
  // 坍缩终态,与不在该步时页面别处看到的"非常极端"保持一致),该步 prep 再按需重新开始。
  function startExpertHeatLoop() {
    try { window.PtoTrainingExpertHeatLoop && window.PtoTrainingExpertHeatLoop.start(); } catch (x) {}
  }
  function stopExpertHeatLoop() {
    try { window.PtoTrainingExpertHeatLoop && window.PtoTrainingExpertHeatLoop.stop(); } catch (x) {}
  }

  function scrollCardIntoView(sel, block) {
    var el = document.querySelector(sel);
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: block || "center", inline: "nearest", behavior: "smooth" }); }
      catch (e) { el.scrollIntoView(); }
    }
  }

  /* ── 问题注册表 ────────────────────────────────────────────────────────────
     meta  : 顶部名片（kicker/severity/title/tags）
     infraCol : 本问题是否需要「集群监控」右列。有步骤要照亮它才展开，否则进来就收起 ——
                聚光灯期间「修改建议」要挤进同一行做第四栏，留一条用不上的列白占宽度。
     fixes : 右侧「修改建议」列。line = 该片段在原文件中的起始行号（让行号栏贴近真实文件）
     steps : 证据步。target 返回被照亮的实页元素（可以是数组，取并集外框）；
             prep 在进入该步前把它挪到可见；fix 是关联的 fixes 下标。
             ⚠️ target 找不到元素时会退回画布中央的浮框、只展示标注气泡 —— 图表组件尚未落地的
                步骤因此可以先把叙事写全，等组件到位后选择器自动生效。
     ─────────────────────────────────────────────────────────────────────── */
  var CASES = {};

  // ══ 问题二 · Router FP8 softmax 溢出 → 路由塌缩 → NaN + all-to-all 死锁双发 ══
  CASES["moe-a2a"] = {
    meta: {
      kicker: "问题二",
      severity: "P0",
      title: "Router 数值溢出 → 路由塌缩，同时触发 loss NaN 与 all-to-all 死锁",
      tags: ["Layer 38 · MoE Router", "精度"],
    },
    infraCol: true,     // 步 ⑥「infra 扩散」要照亮集群热力图
    fixes: [
      { file: "router.py", line: 142, title: "softmax 改 FP32", diff: [
        ["-", "probs = softmax(router(x))          # FP8 下 logits 溢出"],
        ["+", "probs = softmax(router(x.float()))  # FP32 计算后再 cast 回"] ] },
      { file: "training_args.yaml", line: 68, title: "z-loss + grad clip", diff: [
        ["+", "z_loss_coeff: 1e-4   # 抑制 logits 极端值"],
        ["+", "clip_grad_norm: 1.0  # MoE 训练标配"] ] },
      { file: "optimizer_config.json", line: 31, title: "router 学习率", diff: [
        ["-", "router_lr: 3e-4      # 与 expert 相同"],
        ["+", "router_lr: 3e-5      # expert lr × 0.1"] ] },
      { file: "model_config.json", line: 24, title: "n_group 辅助保障", diff: [
        ["-", "\"n_group\": 8,"],
        ["+", "\"n_group\": 16,     # 分散 expert 选择"] ] },
      { file: "env.sh", line: 17, title: "NCCL 超时兜底", diff: [
        ["-", "export NCCL_IB_TIMEOUT=30"],
        ["+", "export NCCL_IB_TIMEOUT=60  # 训练不中断兜底"] ] },
      { file: "monitor_config.yaml", line: 53, title: "部署熔断规则", diff: [
        ["+", "amp_scaler_dump_ratio: 0.0625   # 1/16 → 自动 dump"],
        ["+", "amp_scaler_abort_ratio: 0.03125 # 1/32 → 停训"] ] },
    ],
    // ①熔断 ②迭代 ③日志 ④通信 ⑤模型 ⑥infra
    steps: [
      { n: 1, layer: "熔断 / 预警层", short: "熔断/预警",
        eventId: "p1-warning",
        target: function () { return document.querySelector('#accuracyCharts [data-acc-card="loss_scale"]'); },
        prep: function () { scrollCardIntoView('#accuracyCharts [data-acc-card="loss_scale"]'); },
        body: "请看 AMP loss scale：65536→32768→16384→8192→4096，五个台阶记录了连续四次浮点溢出。loss 还没有 NaN，训练已经在求救。注意级可在连续减半初期通知值班人员；现场规则在初始值 1/16 自动保存 checkpoint、dump Router logits 与激活张量；若继续跌至 1/32，则立即停训、保留现场并释放资源。阈值可按任务健康基线调整。",
        nums: ["scaler 65536→4096", "本可提前 53 step 止损"],
        fix: [5] },
      { n: 2, layer: "迭代层", short: "迭代层",
        eventId: "p1-nan",
        // loss 与 grad_norm 两张卡一起框（都在 step 15203 跳变），取二者并集
        target: function () {
          return [
            document.querySelector('#accuracyCharts [data-acc-card="loss"]'),
            document.querySelector('#accuracyCharts [data-acc-card="gradnorm"]'),
          ];
        },
        prep: function () { scrollCardIntoView('#accuracyCharts [data-acc-card="loss"]', "start"); },
        body: "step 15203：loss 跳变 NaN、grad_norm→inf。固定 seed 重跑——单卡 loss=3.21 正常、32 卡即 NaN，仅多卡复现，指向通信。",
        nums: ["loss→NaN", "grad_norm→inf", "仅多卡复现"],
        fix: [] },
      { n: 3, layer: "日志 / plog 诊断层", short: "日志/plog",
        eventId: "p1-log",
        target: function () { return document.getElementById("dockPanelLog") || document.getElementById("bottomDock"); },
        prep: function () {
          // 幂等地展开 dock、切日志页签并渲染日志行（training-log-drawer.js 暴露的 show()）。
          // 之前靠点 #trainLogToggle 触发渲染，受其开关状态时序影响；show() 每次都渲染，最稳。
          if (window.PtoTrainingLogDrawer && window.PtoTrainingLogDrawer.show) {
            window.PtoTrainingLogDrawer.show();
          } else {
            window.PtoTrainingTwinTimelineDock && window.PtoTrainingTwinTimelineDock.setVisible(true);
            window.PtoTrainingTwinDockTabs && window.PtoTrainingTwinDockTabs.select("log");
          }
        },
        body: "Python 侧只报 NCCL timeout；plog 翻译后：rank 23 all-to-all send=0 / recv=9832 buffer 失配，且 router_logits 含 inf——把「看不懂的报错」翻成人话。",
        nums: ["send=0 / recv=9832", "router_logits 含 inf"],
        fix: [] },
      { n: 4, layer: "通信调度层", short: "通信调度",
        eventId: "p1-a2a",
        target: function () { return document.getElementById("twinTimeline") || document.getElementById("bottomDock"); },
        prep: function () {
          window.PtoTrainingTwinTimelineDock && window.PtoTrainingTwinTimelineDock.setVisible(true);
          window.PtoTrainingTwinDockTabs && window.PtoTrainingTwinDockTabs.select("timeline");
          // 光洞只能把视线引到"这块面板"，面板里还有 32 条泳道。让泳道自己再收一次：
          // 切到事故步 + 事故窗口、把 rank 23 那行滚到中间、整图去色只留那条红的。
          // 复位由 render() 每步开头统一做（见下方 clearSwimlaneFocus）。
          window.PtoTrainingRankSwimlane && window.PtoTrainingRankSwimlane.focusFault();
        },
        body: "EP rank 23（node2 GPU7）在 all-to-all 处 30s 超时死锁：send=0，其余 63 rank 卡在同步屏障空等——但死锁只是「果」。",
        nums: ["rank 23 timeout", "63 rank 空等"],
        fix: [4] },
      { n: 5, layer: "模型层 → 数值层（根因）", short: "模型·数值",
        eventId: "p1-root",
        target: function () { return document.getElementById("deckStage"); },
        // activateProblemLens 已聚焦 layer 38 router 并展开 routed_expert_bank;
        // 这里让 256 专家负载热力循环播放"均衡 → 坍缩"过渡,而不是停在坍缩终态干等
        // (见 js/training-run-twin.js 的 window.PtoTrainingExpertHeatLoop,离开本步由
        // go() 开头统一调用 stopExpertHeatLoop() 关掉,与 clearSwimlaneFocus 同一套谁开谁关)。
        prep: function () { startExpertHeatLoop(); },
        body: "layer 38 router 把 98% token 路由到 expert 193，247 个 dead expert = 路由彻底塌缩。根因：router softmax 在 FP8 下 max(logits)=1846 → exp 溢出为 inf。",
        nums: ["98% token → E193", "max(logits)=1846→inf", "FP8 softmax 溢出"],
        fix: [0, 1, 2, 3] },
      { n: 6, layer: "infra 层（扩散）", short: "infra 扩散",
        eventId: "p1-spread",
        target: function () { return document.getElementById("heat"); },
        prep: function () {
          window.PtoTrainingTwinSideCols && window.PtoTrainingTwinSideCols.setRightVisible(true);
          scrollCardIntoView("#heat");
        },
        body: "单点 rank 23 溢出经 all-to-all 同步屏障扩散 → 64 EP rank 全卡 → PP stage 3 断裂 → 2048 NPU hang，报的却是通信 timeout，而非 router 溢出。",
        nums: ["1 → 2048 NPU", "报错位置 ≠ 根因位置"],
        fix: [4] },
    ],
  };

  /* ══ 问题一 · activation checkpoint 未开启 → 显存峰值超标 + 分配器碎片触发 OOM ══
     叙事 / 数字 = 定位链-openPangu-2.0-Flash.md 案例四 §1~§7；曲线数据源见
     training-run-twin.js 的 memoryAtStep() 与 MEM_CASE_FACTS（window.PtoTrainingTwinMemoryCase）。
     取证分布在三处，都是页面上已有的视图，不为这个案例重复造图：
       · 底部 dock「性能」页签的 3 张卡（[data-mem-card]，见 js/training-memory-panel.js）
       · 底部 dock「Timeline」页签 —— step 耗时构成本来就该在泳道上读
       · 整网图「侧视图」的逐层指标曲线「单层激活值显存」—— 46 层同时在场，天然是层级切面 */
  // 展开底部 dock 并切到指定页签；canvas 在页签隐藏时量不到尺寸，切过去后补一次绘制
  function openDockTab(name) {
    return function () {
      window.PtoTrainingTwinTimelineDock && window.PtoTrainingTwinTimelineDock.setVisible(true);
      window.PtoTrainingTwinDockTabs && window.PtoTrainingTwinDockTabs.select(name);
      if (name === "perf") window.PtoTrainingMemoryPanel && window.PtoTrainingMemoryPanel.renderSoon();
    };
  }
  var openPerfDock = openDockTab("perf");
  function memCard(id) {
    return function () { return document.querySelector('[data-mem-card="' + id + '"]'); };
  }
  CASES["mem-oom"] = {
    meta: {
      kicker: "问题一",
      severity: "P0",
      title: "activation checkpoint 未开启 → 显存峰值超标 + 分配器碎片触发 OOM",
      tags: ["PP stage 3 · L34-45 + LM Head", "显存"],
    },
    // 5 个步骤分别落在「性能」页签、Timeline 页签、整网图侧视图，没有一步用到集群监控栏 → 进来即收起
    infraCol: false,
    fixes: [
      { file: "training_args.yaml", line: 41, title: "开 selective activation checkpoint", diff: [
        ["+", "recompute_activations: true      # 激活 36.2 → ~8.5 GB"],
        ["+", "recompute_granularity: selective # 只重算 attention + FFN 中间激活"] ] },
      { file: "env.sh", line: 22, title: "分配器碎片优化", diff: [
        ["+", "export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True"],
        ["+", "export ACLNN_CACHE_LIMIT=2147483648  # 2 GB workspace 常驻"] ] },
      { file: "modeling_openpangu.py", line: 508, title: "lm_head logits 即时释放", diff: [
        ["-", "loss = cross_entropy(logits, labels)"],
        ["+", "loss = cross_entropy(logits, labels); del logits  # 省 1.2 GB"] ] },
      { file: "model_config.json", line: 12, title: "PP stage 层数重排（辅助）", diff: [
        ["-", "\"pp_layer_split\": [12, 11, 11, 12],"],
        ["+", "\"pp_layer_split\": [13, 12, 11, 10],  # stage3 减 2 层减压"] ] },
    ],
    // ①性能表征(兼容量判据) ②瓶颈分类 ③峰值构成(根因) ④阶段/层定位 ⑤内存快照(兼碎片判据)
    steps: [
      { n: 1, layer: "性能表征层 → 容量判据", short: "显存曲线",
        eventId: "p2-rise",
        target: memCard("mem-timeline"),
        prep: openPerfDock,
        body: "step 8000 前显存稳在 52~55 GB，之后一路爬升；step 12003 rank 17 触顶 64/64 GB 报 ACL_ERROR_MEMORY_ALLOCATION 中断。峰值 = 总容量，这一条就判定了「绝对容量不足」——它是主因。同期吞吐已从 3200 掉到 2800 tokens/s，分配器在反复做碎片整理和换页。",
        nums: ["峰值 64/64 GB", "rank 17 OOM", "吞吐 −12.5%"],
        fix: [] },
      { n: 2, layer: "瓶颈分类层", short: "瓶颈分类",
        eventId: "p2-cost",
        target: function () { return document.getElementById("twinTimelineBody") || document.getElementById("bottomDock"); },
        prep: openDockTab("timeline"),
        body: "回到 Timeline 看这一步的耗时构成：Computing 8520ms(71%)、Communication 1420ms(12%)，而显存分配/释放 API 占了 890ms(7.4%)——正常应 <2%。HBM 带宽利用率 78% 正常，排除纯带宽瓶颈，走显存分支。",
        nums: ["分配 API 890ms · 7.4%", "正常应 <2%", "带宽 78% 正常"],
        fix: [1] },
      { n: 3, layer: "显存峰值构成层（根因）", short: "峰值构成",
        eventId: "p2-peak",
        target: memCard("composition"),
        prep: openPerfDock,
        body: "拆开 step 12000 rank 17 的快照：激活值 36.2 GB 占 56.6%，比参数+梯度(16.2)、优化器(10.8)之和还多。46 层激活全部常驻 = 每层约 0.79 GB——这是唯一能大幅缩减的一项。",
        nums: ["激活 36.2 GB · 56.6%", "参数+梯度 16.2 GB", "优化器 10.8 GB"],
        fix: [0] },
      { n: 4, layer: "阶段 / 层定位层", short: "层级切面",
        eventId: "p2-layer",
        target: function () { return document.getElementById("deckStage"); },
        // 只把整网图切回侧视总览：46 层同时在场，哪几层显存压力最大一眼可见，
        // 比再画一张 stage 柱状图更直接。逐层曲线里的「单层激活值显存」是常驻默认指标，
        // 不需要在这里临时改动用户的勾选。
        prep: function () {
          window.PtoTwinGraphAdapter && window.PtoTwinGraphAdapter.showSideOverview &&
            window.PtoTwinGraphAdapter.showSideOverview();
        },
        body: "切到整网图侧视，看逐层曲线里的「单层激活值显存」：dense 层 0.70 GB、MoE 层约 0.78 GB，唯独 layer 38 达 1.2 GB（dense 的 1.7×），多出来的正是 MoE 的 expert dispatch buffer。46 层求和 36.2 GB，与上一步的激活值总量对得上。按 PP 分段看，stage 3 因为还挂着 lm_head 的 logits 张量最重。",
        nums: ["L38 = 1.2 GB · 1.7×", "46 层求和 36.2 GB", "stage 3 最重"],
        fix: [2, 3] },
      { n: 5, layer: "内存快照层 → 碎片判据", short: "内存快照",
        eventId: "p2-oom",
        target: memCard("fragment-map"),
        prep: openPerfDock,
        body: "解析 memory_record.pkl：1.8 GB 空闲里有 1.5 GB 是「看得见用不上」的碎片，最大连续块只剩 0.3 GB，接不下 0.5 GB 的临时 buffer——这就是碎片判据，它让 OOM 提前到来。成因是 46 层不等大小的中间张量在 forward 密集分配、backward 集中释放；点图里的红框块可看到 L38 q_b_proj 的 36 MB 张量持有近 7 秒及其申请堆栈。",
        nums: ["碎片率 83%", "最大连续块 0.3 GB", "q_b_proj 持有 7s"],
        fix: [0, 1] },
    ],
  };

  // ── DOM 装配 ──────────────────────────────────────────────────────────
  var els = null;        // 缓存构建好的外壳 DOM（与问题无关，只建一次）
  var activeKey = null;  // 当前问题的 caseKey
  var cur = null;        // = CASES[activeKey]
  var open = false;
  var idx = 0;
  var raf = 0;
  var keyHandler = null;
  var guideOn = true; // 名片「关闭/打开定位链指引」：只隐藏遮罩/光洞/步进导轨/标注气泡，名片本身与问题定位保留

  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* build() 只搭「与问题无关」的外壳（遮板/光框/名片骨架/工具行/气泡/修改建议容器），全页只建一次；
     名片文案、步进导轨、修改建议列表这些随问题变化的部分由 applyCase() 每次进入时重填。 */
  function build() {
    if (els) return els;
    var root = h("div", "tw-spot");

    // 场景 SVG：光洞四周四片遮板（压暗+拦截交互，光洞区穿透可缩放/拖动底层图表）+ 光框 + 引出线
    var scene = svg("svg", { "class": "tw-spot__scene" });
    var shTop = svg("rect", { "class": "tw-spot__shutter" });
    var shBottom = svg("rect", { "class": "tw-spot__shutter" });
    var shLeft = svg("rect", { "class": "tw-spot__shutter" });
    var shRight = svg("rect", { "class": "tw-spot__shutter" });
    var glow = svg("rect", { "class": "tw-spot__glow", rx: 12, ry: 12 });
    var connector = svg("path", { "class": "tw-spot__connector" });
    var dot = svg("circle", { "class": "tw-spot__connector-dot", r: 3 });
    scene.appendChild(shTop); scene.appendChild(shBottom); scene.appendChild(shLeft); scene.appendChild(shRight);
    scene.appendChild(glow); scene.appendChild(connector); scene.appendChild(dot);

    // 顶部名片（文案由 applyCase 填）
    var card = h("div", "tw-spot__card");
    var kicker = h("div", "tw-spot__card-kicker");
    var kickerText = document.createTextNode("");
    kicker.appendChild(kickerText);
    var sev = h("span", "tw-spot__sev"); kicker.appendChild(sev);
    var title = h("div", "tw-spot__card-title");
    var tags = h("div", "tw-spot__card-tags");
    var actions = h("div", "tw-spot__card-actions");
    // 「定位链指引」开关：只控制遮罩/光洞/步进导轨/标注气泡与修改建议联动高亮，
    // 不等同「详情」左侧的 ✕（那个会退出整个问题定位，见 exit()）。
    var guideToggleBtn = h("button", "tw-spot__guide-toggle");
    guideToggleBtn.type = "button";
    guideToggleBtn.setAttribute("role", "switch");
    guideToggleBtn.setAttribute("aria-checked", "true");
    guideToggleBtn.setAttribute("aria-label", "定位链指引");
    var guideToggleTrack = h("span", "tw-spot__guide-track");
    guideToggleTrack.setAttribute("aria-hidden", "true");
    guideToggleTrack.appendChild(h("span", "tw-spot__guide-thumb"));
    guideToggleBtn.appendChild(guideToggleTrack);
    guideToggleBtn.appendChild(h("span", "tw-spot__guide-label", "定位链指引"));
    guideToggleBtn.addEventListener("click", toggleGuide);
    // 「到性能调优工具查看」→ 与抽屉抬头上同一个入口（#locateDrawerProfilingLink）；
    // 目前只有问题一（mem-oom）在性能调优工具里有对应视图，其余问题由 applyCase 藏掉
    var profilingLink = h("a", "btn btn-ghost btn-sm");
    profilingLink.target = "_blank"; profilingLink.rel = "noopener";
    profilingLink.textContent = "到性能调优工具查看"; profilingLink.style.fontSize = "11px";
    // 「详情」→ 该问题的定位链长文抽屉；没有长文的问题由 applyCase 把按钮藏掉
    var detailBtn = h("button", "btn btn-ghost btn-sm"); detailBtn.type = "button"; detailBtn.textContent = "详情"; detailBtn.style.fontSize = "11px";
    detailBtn.addEventListener("click", openDetail);
    var closeBtn = h("button", "pto-ide-frame__window-action"); closeBtn.type = "button"; closeBtn.title = "退出聚光灯，回到最新 step"; closeBtn.setAttribute("aria-label", "退出聚光灯"); closeBtn.innerHTML = "&#10005;";
    closeBtn.addEventListener("click", exit);
    actions.appendChild(guideToggleBtn); actions.appendChild(profilingLink); actions.appendChild(detailBtn); actions.appendChild(closeBtn);
    card.appendChild(kicker); card.appendChild(title); card.appendChild(tags); card.appendChild(actions);

    // 步进导轨（内容由 applyCase 填）
    var rail = h("div", "tw-spot__rail");

    // 证据标注气泡
    var callout = h("div", "tw-spot__callout");

    // 「修改建议」——聚光灯期间挤入页面栅格作第四栏（见 doOpen 的注入），常驻显示
    var fixes = h("aside", "wzh-col-spot-fixes");
    fixes.setAttribute("aria-label", "修改建议");
    var fhead = h("div", "tw-spot__fixes-head");
    fhead.appendChild(h("span", "tw-spot__fixes-title", "修改建议"));
    var fixesSub = h("span", "tw-spot__fixes-sub");
    fhead.appendChild(fixesSub);
    var fbody = h("div", "tw-spot__fixes-body");
    fixes.appendChild(fhead); fixes.appendChild(fbody);

    // 底部导航
    var nav = h("div", "tw-spot__nav");
    var prev = h("button", "tw-spot__nav-btn tw-spot__nav-btn--strong"); prev.type = "button"; prev.title = "上一步"; prev.innerHTML = "&#8249;";
    prev.addEventListener("click", function () { go(idx - 1); });
    var count = h("div", "tw-spot__nav-count");
    var next = h("button", "tw-spot__nav-btn tw-spot__nav-btn--strong"); next.type = "button"; next.title = "下一步"; next.innerHTML = "&#8250;";
    next.addEventListener("click", function () { go(idx + 1); });
    nav.appendChild(prev); nav.appendChild(count); nav.appendChild(next);

    // 导轨 + 导航同处顶部工具行（导轨在左、导航在右）
    var toolbar = h("div", "tw-spot__toolbar");
    toolbar.appendChild(rail);
    toolbar.appendChild(nav);

    root.appendChild(scene);
    root.appendChild(card);
    root.appendChild(toolbar);
    root.appendChild(callout);
    // fixes 不进覆盖层：doOpen 时注入 .twin-center-scroll 作第四栏
    document.body.appendChild(root);

    els = {
      root: root, scene: scene,
      sh: { top: shTop, bottom: shBottom, left: shLeft, right: shRight },
      glow: glow, connector: connector, dot: dot,
      rail: rail, stepEls: [], arrowEls: [], callout: callout,
      fixes: fixes, fixesSub: fixesSub, fixesBody: fbody, fixEls: [],
      nav: nav, prev: prev, next: next, count: count,
      guideToggleBtn: guideToggleBtn, detailBtn: detailBtn, profilingLink: profilingLink,
      kickerText: kickerText, sev: sev, title: title, tags: tags,
    };
    return els;
  }

  /* 把注册表里某个问题的内容灌进已建好的外壳：名片文案 + 步进导轨 + 修改建议列表。
     切换问题时整段重建导轨与修改建议（两者的条数、文案都不同，逐项 diff 得不偿失）。 */
  function applyCase(key) {
    var e = els, c = CASES[key];
    activeKey = key;
    cur = c;

    // 名片
    e.kickerText.nodeValue = c.meta.kicker;
    e.sev.textContent = c.meta.severity;
    e.title.textContent = c.meta.title;
    e.tags.innerHTML = "";
    (c.meta.tags || []).forEach(function (t) {
      var s = h("span", "tw-spot__tag"); s.textContent = t; e.tags.appendChild(s);
    });
    // 该问题的定位链长文还没落地时,「详情」按钮没有去处 —— 直接藏掉,不给死链
    e.detailBtn.hidden = !(window.hasLocateDrawer && window.hasLocateDrawer(key));
    // 「到性能调优工具查看」目标页与抽屉抬头入口保持一致,只对问题一(mem-oom)开放
    if (e.profilingLink) {
      var pBase = window.PTO_BASE_PREFIX || "../../";
      e.profilingLink.href = pBase + "Profiling_Insight_and_Tool/AI_Profiling_Tool/index_v3.html?issue=mem-oom&tab=memory";
      e.profilingLink.hidden = key !== "mem-oom";
    }

    // 步进导轨：相邻步之间插入箭头，强化「链路」观感；箭头随 go() 同步点亮已走过的一段
    e.rail.innerHTML = "";
    e.arrowEls = [];
    e.stepEls = c.steps.map(function (st, i) {
      if (i > 0) {
        var arrow = h("span", "tw-spot__rail-arrow", "&#8594;");
        arrow.setAttribute("aria-hidden", "true");
        e.rail.appendChild(arrow);
        e.arrowEls.push(arrow);
      }
      var s = h("div", "tw-spot__step");
      var num = h("span", "tw-spot__step-n"); num.textContent = st.n;
      var name = h("span", "tw-spot__step-name"); name.textContent = st.short || st.layer;
      s.appendChild(num); s.appendChild(name);
      s.addEventListener("click", function () { go(i); });
      e.rail.appendChild(s);
      return s;
    });

    // 修改建议
    e.fixesSub.textContent = c.fixes.length + " 处 · 按优先级";
    e.fixesBody.innerHTML = "";
    e.fixEls = c.fixes.map(function (fx, i) {
      var f = h("div", "tw-spot__fix");
      var fh = h("div", "tw-spot__fix-head");
      var fn = h("span", "tw-spot__fix-n"); fn.textContent = i + 1;
      var ff = h("span", "tw-spot__fix-file"); ff.textContent = fx.file;
      var ft = h("span", "tw-spot__fix-title"); ft.textContent = fx.title;
      fh.appendChild(fn); fh.appendChild(ff); fh.appendChild(ft);
      var fd = h("div", "tw-spot__fix-diff");
      fx.diff.forEach(function (ln, li) {
        var row = h("div", "tw-spot__diff-row " + (ln[0] === "-" ? "del" : "add"));
        var num = h("span", "tw-spot__diff-ln"); num.textContent = (fx.line || 1) + li;
        var code = h("span", "tw-spot__diff-code");
        code.textContent = (ln[0] === "-" ? "− " : "+ ") + ln[1];
        row.appendChild(num); row.appendChild(code);
        fd.appendChild(row);
      });
      f.appendChild(fh); f.appendChild(fd);
      e.fixesBody.appendChild(f);
      return f;
    });
  }

  function openDetail() {
    if (window.openLocateDrawer) window.openLocateDrawer(activeKey);
    else if (window.openProblemOneLocateDrawer) window.openProblemOneLocateDrawer();
  }

  /* 按当前问题决定「集群监控」右列的开合，一开场就定好，布局提前定型：
       · 有步骤要照亮它（问题一 ⑥ infra 扩散）→ 展开，到达那步时图表已在场；
       · 没有任何一步用到（问题二）→ 收起，把宽度让给聚光灯挤进来的「修改建议」第四栏。 */
  function syncInfraCol() {
    if (!cur) return;
    try {
      window.PtoTrainingTwinSideCols &&
        window.PtoTrainingTwinSideCols.setRightVisible(cur.infraCol !== false);
    } catch (x) {}
  }

  // ── 步导航 ────────────────────────────────────────────────────────────
  function go(i) {
    var STEPS = cur.steps;
    i = Math.max(0, Math.min(STEPS.length - 1, i));
    idx = i;
    var st = STEPS[i];
    var e = els;

    // 导轨状态
    e.stepEls.forEach(function (s, k) {
      s.classList.toggle("is-active", k === i);
      s.classList.toggle("is-done", k < i);
    });
    // 箭头：第 k 个箭头连接 step[k] → step[k+1]，走过去了才点亮
    e.arrowEls.forEach(function (a, k) { a.classList.toggle("is-done", k < i); });
    // 计数 + 前后按钮
    e.count.innerHTML = "<b>" + st.n + "</b> / " + STEPS.length;
    e.prev.disabled = i === 0;
    e.next.disabled = i === STEPS.length - 1;

    // 标注气泡内容
    var linkedFirst = st.fix.length ? cur.fixes[st.fix[0]] : null;
    var numsHtml = st.nums.map(function (n) { return '<span class="tw-spot__num"></span>'; }).join("");
    e.callout.innerHTML =
      '<div class="tw-spot__callout-head">' +
      '<span class="tw-spot__callout-n">' + st.n + '</span>' +
      '<span class="tw-spot__callout-layer"></span></div>' +
      '<div class="tw-spot__callout-body"></div>' +
      '<div class="tw-spot__callout-nums">' + numsHtml + '</div>' +
      '<div class="tw-spot__callout-fix"' + (linkedFirst ? '' : ' hidden') + '>' +
      '<b>→ 修复</b> <span class="tw-spot__callout-fix-txt"></span></div>' +
      '<div class="tw-spot__callout-impact"' + (st.eventId ? '' : ' hidden') + '>' +
      '<button type="button" class="tw-spot__callout-impact-btn">查看事件影响范围</button></div>';
    e.callout.querySelector(".tw-spot__callout-layer").textContent = st.layer;
    e.callout.querySelector(".tw-spot__callout-body").textContent = st.body;
    var numEls = e.callout.querySelectorAll(".tw-spot__num");
    st.nums.forEach(function (n, k) { if (numEls[k]) numEls[k].textContent = n; });
    if (linkedFirst) {
      e.callout.querySelector(".tw-spot__callout-fix-txt").textContent =
        linkedFirst.file + " · " + linkedFirst.title + (st.fix.length > 1 ? " 等 " + st.fix.length + " 处" : "");
    }
    var impactBtn = e.callout.querySelector(".tw-spot__callout-impact-btn");
    if (impactBtn && st.eventId) {
      impactBtn.addEventListener("click", function () {
        window.open("config-relation-observer.html?event=" + encodeURIComponent(st.eventId), "_blank", "noopener");
      });
    }

    // 右列修复高亮仅属于定位链指引；指引关闭时各项同权。
    e.fixes.classList.toggle("has-link", guideOn && st.fix.length > 0);
    e.fixEls.forEach(function (f, k) {
      f.classList.toggle("is-linked", guideOn && st.fix.indexOf(k) >= 0);
    });
    if (guideOn && st.fix.length && e.fixEls[st.fix[0]]) {
      try { e.fixEls[st.fix[0]].scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (x) {}
    }

    // 跨组件的临时视觉态在每一步开头统一复位,再由本步的 prep 按需重新打开 ——
    // 这样组件不必知道"上一步是谁",步与步之间也不会互相漏状态。
    clearSwimlaneFocus();
    stopExpertHeatLoop();

    // 把当前证据挪到可见
    if (st.prep) { try { st.prep(); } catch (x) {} }

    // 光框脉冲一次
    e.root.classList.remove("is-pulsing");
    void e.root.offsetWidth; // 触发重排以重启动画
    e.root.classList.add("is-pulsing");
    window.setTimeout(function () { e.root.classList.remove("is-pulsing"); }, 620);
  }

  // ── 几何：每帧按当前证据 rect 重排开洞 / 光框 / 引出线 / 气泡 ──────────────
  function borderPoint(r, tx, ty) {
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var dx = tx - cx, dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    var sx = dx !== 0 ? (r.w / 2) / Math.abs(dx) : Infinity;
    var sy = dy !== 0 ? (r.h / 2) / Math.abs(dy) : Infinity;
    var s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  // 目标可以是单个元素或一组元素；取所有可见者的并集外框（含内边距）
  function unionBox(t, vw, vh) {
    var pad = 8;
    if (!t) return { x: 0, y: 0, w: 0, h: 0, ok: false };
    var list = Array.isArray(t) ? t : [t];
    var l = Infinity, tp = Infinity, r = -Infinity, b = -Infinity, any = false;
    list.forEach(function (el) {
      if (!el || !el.getBoundingClientRect) return;
      var rr = el.getBoundingClientRect();
      if (rr.width > 2 && rr.height > 2 && rr.bottom > 0 && rr.top < vh) {
        l = Math.min(l, rr.left); tp = Math.min(tp, rr.top);
        r = Math.max(r, rr.right); b = Math.max(b, rr.bottom); any = true;
      }
    });
    if (!any) return { x: 0, y: 0, w: 0, h: 0, ok: false };
    return { x: l - pad, y: tp - pad, w: (r - l) + pad * 2, h: (b - tp) + pad * 2, ok: true };
  }

  function reflow() {
    raf = window.requestAnimationFrame(reflow);
    if (!open || !els || !cur) return;
    var e = els, st = cur.steps[idx];
    var vw = window.innerWidth, vh = window.innerHeight;

    // svg 尺寸
    e.scene.setAttribute("width", vw);
    e.scene.setAttribute("height", vh);
    e.scene.setAttribute("viewBox", "0 0 " + vw + " " + vh);

    // 「修改建议」第四栏是真实页面列，聚光灯给它让出一条常亮右栏：遮板右边界止于它左沿(canvasRight)。
    var canvasRight = vw;
    if (e.fixes && e.fixes.parentNode) {
      var fr = e.fixes.getBoundingClientRect();
      if (fr.width > 0) canvasRight = fr.left - 6;
    }

    // 目标 rect（支持一个元素或一组元素取并集；缺失/不可见时退回画布中央的浮框）
    var box = unionBox(st.target ? st.target() : null, vw, vh);
    var hasTarget = box.ok;
    var topR = 88, botR = 16; // 顶部名片(4~44) + 工具行(44~74)约 88px；导航已上移，底部只留边距
    if (!hasTarget) { box = { x: canvasRight * 0.28, y: vh * 0.42, w: canvasRight * 0.34, h: 150 }; }
    // 夹进画布（画布右界 = canvasRight，避免压到常亮的修改建议栏）
    box.x = Math.max(MARGIN, Math.min(box.x, canvasRight - MARGIN - box.w));
    box.y = Math.max(topR, Math.min(box.y, vh - botR - box.h));

    // 四片遮板围出光洞（中间穿透）+ 光框；遮板右界止于 canvasRight，右侧修改建议栏保持常亮
    setRect(e.sh.top, { x: 0, y: 0, w: canvasRight, h: box.y });
    setRect(e.sh.bottom, { x: 0, y: box.y + box.h, w: canvasRight, h: Math.max(0, vh - (box.y + box.h)) });
    setRect(e.sh.left, { x: 0, y: box.y, w: box.x, h: box.h });
    setRect(e.sh.right, { x: box.x + box.w, y: box.y, w: Math.max(0, canvasRight - (box.x + box.w)), h: box.h });
    setRect(e.glow, box);
    e.glow.style.display = hasTarget ? "" : "none";

    // 标注气泡定位：在画布内选空间最大的一侧
    var cw = e.callout.offsetWidth || 300;
    var ch = e.callout.offsetHeight || 150;
    var spaceRight = canvasRight - (box.x + box.w);
    var spaceLeft = box.x - MARGIN;
    var spaceBottom = vh - botR - (box.y + box.h);
    var spaceTop = box.y - topR;
    var cx, cy;
    if (spaceRight >= cw + 20) { cx = box.x + box.w + 16; cy = box.y; }
    else if (spaceLeft >= cw + 20) { cx = box.x - 16 - cw; cy = box.y; }
    else if (spaceBottom >= ch + 20) { cy = box.y + box.h + 16; cx = box.x; }
    else if (spaceTop >= ch + 20) { cy = box.y - 16 - ch; cx = box.x; }
    else { cx = box.x + box.w + 16; cy = box.y; } // 兜底右侧
    cx = Math.max(MARGIN, Math.min(cx, canvasRight - MARGIN - cw));
    cy = Math.max(topR, Math.min(cy, vh - botR - ch));
    e.callout.style.left = cx + "px";
    e.callout.style.top = cy + "px";

    // 引出线：气泡边缘 → 光洞边缘
    var cRect = { x: cx, y: cy, w: cw, h: ch };
    var holeCx = box.x + box.w / 2, holeCy = box.y + box.h / 2;
    var start = borderPoint(cRect, holeCx, holeCy);
    var end = borderPoint(box, cx + cw / 2, cy + ch / 2);
    var mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
    e.connector.setAttribute("d", "M" + start.x + "," + start.y + " Q" + mx + "," + my + " " + end.x + "," + end.y);
    e.connector.style.display = hasTarget ? "" : "none";
    e.dot.setAttribute("cx", end.x); e.dot.setAttribute("cy", end.y);
    e.dot.style.display = hasTarget ? "" : "none";
  }
  function setRect(node, b) {
    node.setAttribute("x", b.x); node.setAttribute("y", b.y);
    node.setAttribute("width", b.w); node.setAttribute("height", b.h);
  }

  function syncGuideControl() {
    if (!els || !els.guideToggleBtn) return;
    els.guideToggleBtn.setAttribute("aria-checked", guideOn ? "true" : "false");
    els.guideToggleBtn.title = guideOn
      ? "关闭定位链指引"
      : "开启定位链指引";
  }

  // 名片「定位链指引」开关：关闭遮罩/光洞/步进导轨/标注气泡，并取消修改建议关联高亮；
  // 名片本身、修改建议栏与当前问题定位仍保留。再开启时原地恢复到当前步。
  function setGuideVisible(v) {
    guideOn = v;
    if (els) {
      els.root.classList.toggle("is-guide-off", !v);
      syncGuideControl();
      if (!v) {
        els.fixes.classList.remove("has-link");
        els.fixEls.forEach(function (f) { f.classList.remove("is-linked"); });
      }
    }
    if (v) {
      if (!raf) raf = window.requestAnimationFrame(reflow);
      if (open) go(idx);
    } else {
      if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    }
  }
  function toggleGuide() { setGuideVisible(!guideOn); }

  // ── 开 / 关 ───────────────────────────────────────────────────────────
  function doOpen(caseKey) {
    if (!caseKey || !CASES[caseKey]) return false; // 注册表里没有的问题不开聚光灯
    build();
    // 已经开着但换了问题：原地把名片/导轨/修改建议换成新问题的，回到第 1 步
    if (open && caseKey !== activeKey) {
      applyCase(caseKey);
      syncInfraCol();       // 换问题也要跟着换 infra 栏开合
      idx = 0;
      setGuideVisible(true);
      go(0);
      return true;
    }
    if (open) { setGuideVisible(true); return true; }
    applyCase(caseKey);
    open = true;
    idx = 0;
    guideOn = true;
    els.root.classList.remove("is-guide-off");
    syncGuideControl();
    syncInfraCol();
    var workarea = document.querySelector(".pto-ide-frame__workarea");
    if (workarea && els.fixes && els.fixes.parentNode !== workarea) {
      workarea.appendChild(els.fixes);
      workarea.classList.add("is-spot-fixes");
      window.dispatchEvent(new Event("resize"));
    }
    els.root.classList.add("is-open");
    go(0);
    if (!raf) raf = window.requestAnimationFrame(reflow);
    keyHandler = function (ev) {
      if (!open) return;
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); exit(); }
      else if (guideOn && ev.key === "ArrowRight") { ev.preventDefault(); ev.stopPropagation(); go(idx + 1); }
      else if (guideOn && ev.key === "ArrowLeft") { ev.preventDefault(); ev.stopPropagation(); go(idx - 1); }
    };
    document.addEventListener("keydown", keyHandler, true);
    return true;
  }

  // 底部泳道的「定位聚焦」(js/training-rank-swimlane.js:focusFault) 是本层开出去的临时视觉态,
  // 谁开的谁负责关:每步开头 + 关闭聚光灯各复位一次。组件没渲染过时该调用是空操作。
  function clearSwimlaneFocus() {
    try { window.PtoTrainingRankSwimlane && window.PtoTrainingRankSwimlane.clearFocus(); } catch (x) {}
  }

  function doClose() {
    if (!open) return;
    open = false;
    clearSwimlaneFocus();
    stopExpertHeatLoop();
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    guideOn = true;
    if (els) {
      els.root.classList.remove("is-open");
      els.root.classList.remove("is-guide-off");
      syncGuideControl();
      // 移除挤入的「修改建议」整高右列，workarea 复原为纵向单块
      var g = els.fixes && els.fixes.parentNode;
      if (g) { g.removeChild(els.fixes); g.classList && g.classList.remove("is-spot-fixes"); window.dispatchEvent(new Event("resize")); }
    }
    activeKey = null;
    cur = null;
    if (keyHandler) { document.removeEventListener("keydown", keyHandler, true); keyHandler = null; }
  }

  // 名片 × / ESC：走页面既有「退出时光机」逻辑（复位图表到最新 step），它会回调 close()
  function exit() {
    var btn = document.getElementById("diagnosisLocatorClose");
    if (btn) btn.click();   // → exitTimeMachine() → PtoTrainingSpotlight.close()
    else doClose();
  }

  window.PtoTrainingSpotlight = {
    open: doOpen,
    close: doClose,
    isOpen: function () { return open; },
    // 当前问题 / 有聚光灯的问题清单（调用方据此决定要不要给某个问题挂"进定位链"的入口）
    activeCase: function () { return activeKey; },
    hasCase: function (caseKey) { return !!CASES[caseKey]; },
  };
})();
