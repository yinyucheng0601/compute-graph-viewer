/* ══════════════════════════════════════════════════════════════════════════
   配置与关系观测 · 拓扑模型层（第 2 项）
   ------------------------------------------------------------------------
   本文件是整页唯一的数据源。四个视图（整网 / Layer 导航 / MoE / Cluster）
   全部从 CroTopology.derive(config) 的产物渲染，不各自维护状态。

   并行维度语义 —— EP 占不占自己的 rank、又是从哪个域里切出来的，有**三套口径**
   （升级计划行 23 之前是两套），由 config.epMode 选，页内「文档」视图 #doc-ep 一章
   是它的完整说明：
     split · 切出（默认，Megatron / MindSpeed-LLM 的做法）
       world = DP × PP × TP × CP，EP 不进乘积，而是把 DP 组再切一刀
       512 × 4 × 1 × 1 = 2048 ✓   EDP = DP/EP = 512/64 = 8
     orthogonal · 正交（论文与部分自研框架的记法）
       world = DP × PP × TP × CP × EP
       8 × 4 × 1 × 1 × 64 = 2048 ✓   EDP ≡ DP
     mf · MindFormers 的 DP×MP 域（行 23 新增）
       world = DP × PP × TP × CP（同切出档），但 EP 是从 **DP×MP 域**里切的
       约束 (DP × TP) % EP == 0，EDP = DP×TP/EP
       deepseek3 的 dp:4 / mp:8 / pp:8 / ep:32 只有这一档接得住
   前两档下 Node = 2048 / 8卡每节点 = 256 ✓，**rank 编址的几何也完全一致** ——
   那 512 张卡本来就排成 8×64 的网格，区别只在把行叫 DP 还是 EDP。
   由此定死一条业务口径（validate / 文档 / 口径浮层都按它写）：**一整套专家的持有者
   永远是网格的一整行 —— 横着的那 EP 张卡，也就是一个 EP 组（all-to-all 域）**。
   正交档这一行就是一个 DP 副本，每个 DP 自带一整套专家，所以 DP 与 EP 之间无须整除；
   切出档这一行只占 DP 的 1/EP，单个 DP 副本并不持有整套，所以才要求 DP % EP == 0 ——
   让那些卡不多不少地切成 EDP = DP/EP 个**完整**的 EP 组。
   mf 档同一条口径，只是「那些卡」换成了 DP×MP 域里的全部卡：一整行仍是一个 EP 组，
   但它横跨的是数据并行与张量并行两维 —— **于是 TP 不再是独立的一根轴**，编址里
   ranksPerEp 从 TP×CP 变成 CP，TP 分片号由 (EDP索引 × EP + EP索引) % TP 还原
   （见 derive() 里的 shardOf；照抄另两档的算法会把每个 stage 撑成 TP 倍）。
   ⚠️ EDP 是**份数**（完整组有几个 = 专家权重的副本数 = 专家梯度 all-reduce 域的大小），
   不是「一行」的名字：纵向同一列的那 EDP 张卡持有的是同一份 E/EP 个专家，只是一套里的
   一小块。行标签写作 EDP0…EDPn 是在标 d 轴的**索引**（如同 DP0…DPn 标副本），
   别把一行说成「一个 EDP 组」—— 那与框架里的 expert_data_parallel_group 撞车。

   确定性映射（无随机、无数据文件）：
     layer  ℓ → PP stage  s     : 按 PP 把 L 层尽量均分，前 (L mod PP) 段多 1 层
     expert e → EP rank   p     : p = floor(e / (E / EP))
     (s,d,p,t,c) → global rank r: r = s·(EDP·EP·TP·CP) + d·(EP·TP·CP) + p·(TP·CP) + c·TP + t
                                  d 走的是 EDP 轴（正交档下 EDP ≡ DP，与改动前逐位相同）
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
      /* defaults 一律按**切出口径**记（页面默认档）：dp 是含 EP 组在内的真 DP。
         参考配置里写的 "dp: 8" 是 EDP，真 DP = 2048/(PP4×TP1×CP1) = 512。
         切到正交档时由 controller.setEpMode() / setModel() 按 EP 换算回 8。 */
      defaults: {
        totalLayer: 46,
        /* vpp = 1 是这个预设唯一的合法值：46 层连 PP=4 都除不尽（本页的 stage 允许
           不均分，交错式流水不允许），46 % (4×v) 对任何 v > 1 都不为 0。要试 VPP
           得先把 Total Layer 拨到 48 —— 见 term-vpp。 */
        dp: 512, pp: 4, vpp: 1, tp: 1, cp: 1,
        microBatch: 1, seqLen: 4096,
        /* ── 微批数（升级计划行 22）────────────────────────────────────────
           24 不是估的：架构参考 §6.4 给了 Global Batch Size **12288**，而
           GBS = MBS × DP × 微批数 = 1 × 512 × 24。行 22 之前 yaml 那一格按 4×PP
           取 16，是一句自己都标着「本页未建模」的占位；现在页面这三个数第一次
           和那份参考配置对得上。
           24 ≥ PP 4，所以在飞份数不被它夹住 —— 默认档的容量柱逐位不变。 */
        microBatchNum: 24,
        /* ── 精度两档（升级计划行 21）──────────────────────────────────────
           参考配置 §6.1 那一行写的是「FP8 E4M3（HiF8 混合精度：forward FP8,
           backward BF16, master weights FP32）」。三句话分别落在哪，要一句句拆：
           · **master weights FP32** 是混合精度的标准做法 —— 那 4 B 记在优化器的
             12 B 里（fp32 master + momentum + variance），正是 paramsDtype = bf16
             这一档。它**不是** MindFormers 的 params_dtype: float32（那一档是参数
             本身以 fp32 常驻，master 就是参数，优化器只剩 momentum + variance）；
           · **backward BF16** 就是梯度 2 B，与默认同；
           · **forward FP8** 是**算子级的计算格式**：权重仍以 bf16 常驻，进 matmul
             前才转一次。而本页 FP8 档建模的是「fp8 权重直存」（Megatron 的
             --fp8-param-gather），两者不是同一件事。
           所以默认取 bf16 / bf16 —— 与行 21 之前那三个写死的常量（2 / 2 / 12）逐位
           相同；拨到 FP8 档看的是「把权重也按 fp8 存下来能省多少」。 */
        dtype: "bf16", paramsDtype: "bf16",
        routedExpert: 256, topK: 8, sharedExpert: 1, ep: 64,
        totalRank: 2048, node: 256, card: "910b-64",
        /* 四枚开关，取值一律照抄 yaml 原先写死的那四行（recompute: True /
           use_seq_parallel: False / enable_parallel_optimizer: True /
           vocab_emb_dp: True），所以默认档下 YAML 视图逐字不变 —— 变的是
           capacity 终于读得到它们了（升级计划行 9 / 10 / 11）。
           shardMode 是其中唯一不止两档的一枚（行 15）：ZeRO-1 对应原先那个
           enable_parallel_optimizer: True，所以默认档仍逐字不变。
           recompute 于行 19 同样升成多档的 recomputeMode，"full" 对应原先那个
           recompute: True —— 默认档仍逐字不变；recomputeLayers 只在「按层数」
           那一档生效，取 MindFormers 文档里那个 recompute: [4,4,4,4] 的 4 作种子。 */
        recomputeMode: "full", recomputeLayers: 4, seqParallel: false,
        shardMode: "zero1", vocabEmbDp: true,
        /* LoRA（行 18）。默认关 —— 本页两个预设写的都是**预训练**配置，
           而 LoRA 是微调侧的东西：开着它 yaml 会多出一段 pet_config，
           容量柱的梯度段与优化器段几乎归零，那不是这两份参考配置在说的事。 */
        lora: false, loraRank: 16,
        /* CP 的算法口径（行 16）。默认 Ulysses —— MindSpeed MM 的特性表里标 CP 的
           模型多数走的是它。CP=1 时两档没有任何差别，所以默认档逐位未变。 */
        cpMode: "ulysses",
      },
    },
    /* Qwen2-7B：稠密（非 MoE）参考案例，用于验证「整网」栏在无 MoE 模型下的呈现。
       结构参数取自用户给定的参考配置（GQA 28Q:4KV，PP 28 层均分 4 段，VPP=1）。
       28 层 / PP4 每段 7 层，所以这个预设的 VPP 只有 1 与 7 两档合法（7 段各 1 层，
       实际不会那么配）—— 行 17 之后 VPP 是一枚真的 stepper，不再是一句假设。 */
    "qwen2-7b": {
      id: "qwen2-7b",
      label: "Qwen2-7B",
      hidden: 3584,
      vocab: 152064,
      heads: 28,
      kvHeads: 4,            // GQA：28 Q head : 4 KV head，head_dim 128
      attentionLabel: "gqa",
      noMoe: true,            // 稠密模型：derive() / deckConfigFrom() / renderMoe() 据此跳过 MoE 分支
      denseIntermediate: 18944,
      archType: "Qwen2ForCausalLM",
      deck: {
        depthGap: 46,
        blockPostLayers: [],
        residualLabel: "Residual stream",
        sideRows: [
          { label: "Input RMSNorm", ids: ["input_norm"] },
          { label: "Q / K / V Projection", ids: ["q_proj", "k_proj", "v_proj"] },
          { label: "RoPE", ids: ["q_rope", "k_rope"] },
          { label: "FlashAttention · GQA", ids: ["attention_core"] },
          { label: "Output Projection", ids: ["o_proj"] },
          { label: "Attention Residual Add", ids: ["attn_residual_add"] },
          { label: "Post-Attention RMSNorm", ids: ["post_attn_norm"] },
          { label: "Gate / Up Linear", ids: ["ffn_gate_up"] },
          { label: "SiLU × Multiply", ids: ["ffn_act"] },
          { label: "Down Linear", ids: ["ffn_down"] },
          { label: "FFN Residual Add", ids: ["ffn_residual_add"] },
        ],
      },
      defaults: {
        totalLayer: 28,
        dp: 2, pp: 4, vpp: 1, tp: 1, cp: 1,
        microBatch: 1, seqLen: 4096,
        /* 这份参考配置没给全局 batch，微批数沿用行 22 之前 yaml 的取法（4×PP）——
           它同样 ≥ PP，容量柱逐位不变。GBS 因此是 1 × 2 × 16 = 32。 */
        microBatchNum: 16,
        dtype: "bf16", paramsDtype: "bf16",
        routedExpert: 1, topK: 1, sharedExpert: 0, ep: 1,
        totalRank: 8, node: 1, card: "910b-64",   // 8 卡 = 910B 整机一台
        recomputeMode: "full", recomputeLayers: 4, seqParallel: false,
        shardMode: "zero1", vocabEmbDp: true,
        cpMode: "ulysses",
        lora: false, loraRank: 16,
      },
    },
  };

  /* ── 卡型号 ───────────────────────────────────────────────────────────────
     只有 hbmGB 参与计算（它是「单卡容量」那个线框盒的高度）；specs 是纯说明，
     出现在容量栏口径浮层里。

     ⚠️ HBM 数字的来源强度不一样，别当成同一档证据：
       · 910B —— 本仓 AI_Profiling_Tool/AscendProfKit/skills/performance-health-score/
         SKILL.md 记「常见 32GB / 64GB 两种规格，需从 NPU_INFO 表确认型号后定」。
         两款都是真实存在的规格，故拆成 910b-32 / 910b-64 两个选项，而不是取其一。
       · 950  —— Profiling_Insight_and_Tool/KNOWLEDGE.md §3.1 只给了**整片** DDR
         128 GB / 1.6 TB/s，没有单卡 HBM 容量。64 是按「与 910B 高配对齐」的
         要求取的占位值，**待确认**。
     拿到准确规格后只改这一个表，容量栏与集群下拉会一起跟上。 */
  const CARD_SPECS = {
    /* label 给口径浮层（那里空间宽裕，带「昇腾」读着完整）；short 给下拉选项
       （集群表单那一格只有 128px，选项文本还要缀上容量）。 */
    /* ranksPerNode 是**硬件事实**，不是任意整除：整机就是这么多张卡，Node 数由它
       和 Total Rank 一起定死（见 nodeLayout），用户填不出「1 节点 2048 卡」。
       三档都是 8，来源分别是本仓的 profiling 报告与 KNOWLEDGE.md，见各自的注释；
       将来出现每机非 8 卡的型号时，只改这一个字段，Node 与 msrun 命令一起跟上。 */
    "910b-32": {
      id: "910b-32", label: "昇腾 910B", short: "910B", hbmGB: 32, ranksPerNode: 8,
      hbmNote: "常见 32 / 64 GB 两种规格，此处取 32 GB 款",
      specs: "HBM2e 1.6 TB/s（来源：本仓 performance-health-score 技能卡）"
        + "；单机 8 卡（来源：Analysis Report/ascend_analysis_verl_20260602 —— "
        + "rank0 到 peer1–7 全走 HCCS、无 RDMA，即 8 卡同处一节点）",
    },
    "910b-64": {
      id: "910b-64", label: "昇腾 910B", short: "910B", hbmGB: 64, ranksPerNode: 8,
      hbmNote: "常见 32 / 64 GB 两种规格，此处取 64 GB 款",
      specs: "HBM2e 1.6 TB/s（来源：本仓 performance-health-score 技能卡）"
        + "；单机 8 卡（同上）",
    },
    "950": {
      id: "950", label: "昇腾 950", short: "950", hbmGB: 64, ranksPerNode: 8,
      hbmNote: "KNOWLEDGE.md 未给单卡 HBM 容量，64 GB 为占位值，待确认",
      specs: "32 Cube × 64 Vector @1.65 GHz；FP16 432 / FP8 864 / FP4 1728 TFLOPS；"
        + "整片 DDR 128 GB · 1.6 TB/s；Chiplet 2×Compute Die + 2×IO Die，CCU 在 IO-Die；"
        + "超节点 128P / 1024P（来源：KNOWLEDGE.md §3.1、§4.4）"
        + "；单机 8 卡（由 §4.4「128 NPU / 16 台 Server」反推）",
    },
  };

  const CARD_ORDER = ["910b-32", "910b-64", "950"];
  const DEFAULT_CARD = "910b-64";

  /* ── stepper 字段规格：min/max/step 与取值方式（pow2 = 按 2 的幂增减） ── */
  const FIELD_SPECS = {
    totalLayer:   { label: "Total Layer",    group: "parallel", min: 1,  max: 256,  step: 1 },
    /* dp 的上界比其余并行维宽：切出口径下它记的是**含 EP 组**的真 DP，
       与正交口径的读数差一个 EP 倍（参考配置 8 ↔ 512），1024 会在 EP 大时把
       换算夹掉、Total Rank 跟着变。8192 = node 的上界，两者是同一个量级。 */
    dp:           { label: "DP",             group: "parallel", min: 1,  max: 8192, pow2: true },
    pp:           { label: "PP",             group: "parallel", min: 1,  max: 128,  pow2: true },
    /* VPP（虚拟流水，升级计划行 17）**不进 world 的乘积** —— 它一张卡都不多占，
       只把本卡已有的那几层再拆成 VPP 段轮流跑，拿更小的气泡换更多的在飞激活。
       所以它虽然排在并行度里，作用却和 Micro Batch 一样落在「单卡装多少」上。
       正因为不进乘积，它**不在 FIELD_ORDER.parallel 里**，而在「高级选项」折叠内
       （见 ADVANCED_ITEMS）—— 那一行可见的几枚恰好就是 world 的因子。
       不标 pow2：VPP=3 是常见档，唯一的硬要求是层数被 PP×VPP 整除；那条约束的
       对手字段是 Total Layer（改它不改卡数），故加减键照常步过去、由 reconcile 抬层数。

       ── title：stepper 也能有悬浮说明了 ──────────────────────────────────
       原先只有 FLAG_SPECS 那几枚开关带 title，stepper 一枚都没有 —— 折叠里四枚开关
       悬浮都答得出话，唯独 VPP 不吭声，这在同一个面板里读着就是漏了一块。
       `spec.title` 挂在 .cro-stepper 外壳上（见 buildStepper），所以悬浮标签或读数
       都会出来；加减键走不动时按钮自己的 `stepBlockReason` 更靠内，照旧优先显示 ——
       「这枚是干什么的」与「为什么点不动」是两个问题，分两处答。
       这条通路对任何 FIELD_SPECS 字段都可用，目前只填了 VPP：其余几枚的名字
       （DP / PP / TP / CP）是这个领域里不用解释的通用缩写，而 VPP 不是。 */
    vpp: {
      label: "VPP", group: "parallel", min: 1, max: 16, step: 1,
      title: "VPP · 虚拟流水（virtual pipeline / 交错式 1F1B）\n\n"
        + "把每个 PP stage 上的层**再拆成 VPP 段**，让同一张卡轮流跑属于自己的第 1 段、"
        + "第 2 段……卡数一张不变（VPP 不进 world 的乘积，拨它 Total Rank 不动），"
        + "变的只是这些层在时间上怎么排。\n\n"
        + "── 调大：治流水线气泡 ──\n"
        + "1F1B 的气泡比例约 (PP−1)/micro_batch_num。交错之后每一段变短、流水线填得更快，"
        + "气泡按 1/VPP 缩小。\n"
        + "什么时候该调大：PP 已经不小、micro-batch 数又受全局 batch 卡住加不上去，"
        + "而单卡显存还有余量 —— 这时 VPP 是唯一还能压气泡的旋钮。\n\n"
        + "── 调小（回到 1）：治激活峰值 ──\n"
        + "代价全落在这里：warmup 段要多灌几份 micro-batch，每张卡同时压着的未反向激活变多。"
        + "「各 PP Stage 峰值」那排小柱会**整体抬高、而且变平** —— 末段抬得比首段还多"
        + "（PP=4 / VPP=2 时首段在飞 4 → 5.5 份，末段 1 → 2.5 份）。\n"
        + "什么时候该调小：容量柱已经偏满或预警；或 stage 间通信次数按 VPP 倍增，跨机时不划算。\n\n"
        + "── 它比 PP 严格 ──\n"
        + "层数必须被 PP × VPP 整除（交错式要求每段等长），而本页的 PP 允许不均分。"
        + "openPangu 的 46 层连 PP=4 都除不尽，所以默认档下 VPP 只能是 1 —— "
        + "按加号会把 Total Layer 抬到 48（这条约束里唯一一个改了不连累卡数的对手字段）。\n\n"
        + "本页按 Korthikanti et al. 2022 §2.2 的口径算这笔账；"
        + "层 → stage 的画法未按交错重排，见文档的 term-vpp。",
    },
    tp:           { label: "TP",             group: "parallel", min: 1,  max: 64,   pow2: true },
    cp:           { label: "CP",             group: "parallel", min: 1,  max: 64,   pow2: true },
    /* 下面两项不参与切分、不进 world_size，只决定**单卡装多少**，所以排在 Cluster
       区、接在卡型号之后：卡型号给容量框的高度（单卡显存），这两项给往框里装的量，
       三者凑成「单卡容量」那一栏的全部可调输入，读下来是一句完整的话。
       （早先它们和 DP/PP/TP/CP 同排在 Model Architecture，那一行讲的是「模型怎么
       切开」，而这两项一刀不切，混在里面反而要多解释一遍。）
       注意是 micro-batch 不是 global batch —— 但这句话在行 22 之前只说了一半：
       GBS 决定的是**分成几份**（GBS/(MBS×DP) = 微批数），而 PP > 1 时在飞的那几份
       就是压在卡上的激活。所以准确的说法是「GBS 本身不进显存，它派生出来的微批数
       在 PP > 1 时进」：微批数 ≥ PP 时确实一个字节都不动（在飞份数由 1F1B 公式定），
       小于 PP 时才把在飞份数夹小。那半句话现在由旁边那枚「微批数」stepper 说全。 */
    /* 写全称不写 MBS / Seq：DP·PP·TP·CP 是这个领域里没人会认错的通用缩写，这两个
       不是 —— MBS 还容易和 GBS 混，而两者对显存的作用完全相反（见容量栏口径）。 */
    /* digits: 2 —— 上界 64，两位数就够，不必按默认的三位留白。这一格与 Seq Length
       同处 Cluster 那一行，而那一行要在一行之内容下七枚控件（见 css 里
       .cro-cluster__form 那段）；读数框的字符宽度是这里唯一能省又不伤可读性的一处。 */
    microBatch:   { label: "Micro Batch",    group: "batch",    min: 1,  max: 64,   step: 1, digits: 2 },
    /* ── 微批数（升级计划行 22）──────────────────────────────────────────
       行 22 之前页面只握着 GBS = MBS × DP × 微批数 里的两个数，第三个是**派生**的：
       yaml 按 4×PP 取（那一行的注释自己写着「本页未建模」），capacity 的在飞份数
       则隐含假设它 ≥ PP，而 VPP 的 title 早就在解释「气泡比例约 (PP−1)/micro_batch_num」
       —— 页面在解释一个自己没有输入的量。这一枚补上它。

       它和 Micro Batch 是同一句话的两半，但进显存的方式完全不同：
       · MBS 是**每一份多大** —— 激活与它成正比，调它整根柱子跟着动；
       · 微批数是**分成几份** —— 只有在飞的那几份占显存，而在飞份数有上界
         （1F1B 下 stage s 最多压 PP−s 份）。所以它对显存**不是线性的**：
         大于流水线深度时一个字节都不动，小于时才把柱子压下来（capacity 那边取
         min(1F1B/VPP 公式, 它)）。PP=1 时在飞恒为 1，调它容量柱纹丝不动 ——
         那时它只改 yaml 里的全局 batch。

       pow2 而不是 step 1：量程 1–4096，逐 1 走没法用；真实配置里的档位
       （16 / 32 / 128 / 256）本来就是乘着长的。默认值 24 不在梯子上 —— 与手输
       120 之后的 DP 同一条规矩：手输是精确指定，加减键是回到常规档位。 */
    microBatchNum: {
      /* label 写下划线全名而不是中文的「微批数」：那三个字太像 Micro Batch 的简称，
         路人第一眼会把它读成「微批(的)数(值)」，也就是 MBS 本身 —— 而这两枚的意思
         恰好相反（一个是每份多大、一个是分成几份）。写成框架里的键名就没有这种歧义，
         MindFormers 的 parallel_config.micro_batch_num 也正是这么写的。
         注释里仍按中文的「微批数」称呼它 —— 那是给读代码的人看的，不会误读。 */
      label: "micro_batch_num", group: "batch", min: 1, max: 4096, pow2: true, digits: 3,
      title: "micro_batch_num（Megatron 的 num_microbatches = global-batch-size ÷ (mbs × dp)，"
        + "HF / DeepSpeed 的 gradient_accumulation_steps，中文常说「微批数」）\n\n"
        + "⚠️ 它不是 Micro Batch：那一枚是**每份多大**，这一枚是**分成几份**。\n\n"
        + "一个全局 batch 被切成几份轮流喂进去。三者是同一句话：\n"
        + "**Global Batch = Micro Batch × DP × micro_batch_num**"
        + "（本页 YAML 视图 runner_config.batch_size 那一格就是这么算出来的）。\n\n"
        + "── 它对显存不是线性的 ──\n"
        + "只有**在飞**（已前向、还没反向）的那几份激活占着显存，而在飞份数有上界："
        + "1F1B 下 stage s 最多压 PP−s 份。所以\n"
        + "· micro_batch_num ≥ PP（交错档是 PP×VPP）：一个字节都不动，柱子由公式定；\n"
        + "· micro_batch_num < PP：warmup 段还没灌满就要开始反向，「各 PP Stage 峰值」"
        + "那排小柱**整体压低**，首段压得最多。\n"
        + "PP=1 时在飞恒为 1，调它容量柱纹丝不动 —— 那时它只改全局 batch。\n\n"
        + "── 为什么不该靠压它省显存 ──\n"
        + "流水线气泡占比约 (PP−1)/micro_batch_num（交错档再 ÷VPP）。PP=4、它=2 时"
        + "流水线一半以上的时间在空转 —— 这是最贵的一种省法，"
        + "先动重计算、CP、权重分片。低于 PP×VPP 时页面给一条软警告。\n\n"
        + "── 什么时候该调大 ──\n"
        + "PP 大、气泡吃掉了吞吐；或全局 batch 本来就要那么大（收敛需要）。"
        + "代价只有一步的墙钟时间变长 —— 显存那边越过 PP×VPP 之后就不再变了。",
    },
    seqLen:       { label: "Seq Length",     group: "batch",    min: 128, max: 131072, pow2: true },
    /* ── 只在某一档下才有意义的两枚（升级计划行 18 / 19）────────────────────
       它们与上面那些的区别是 **enabledWhen**：不是一直可拨的量，而是另一枚控件
       拨到某一档之后才有意义的参数。不可用时置灰（不隐藏）—— 与 SP / 权重分片
       那几枚开关同一条判据：藏起来等于让人看不见这一档还带着一个数。
       没有 disabledValue：它们此刻的值不会出现在 yaml 里（重算层数只在「按层数」
       档写出来、LoRA Rank 只在开着时写出来），留在原处不会留下需要解释的字。

       recomputeLayers 的上界是**算出来的**（maxOf）：每个 stage 只有那么多层，
       再往上加一层也没有东西可重算。这是本页第一个动态量程 —— 加减键与手输
       都走它，见 specMax()。 */
    recomputeLayers: {
      label: "重算层数", group: "batch", min: 1, max: 256, step: 1,
      maxOf: (config) => maxStageLayers(config),
      enabledWhen: (config) => recomputeModeOf(config) === "layers",
      disabledReason: "只有「重计算 · 按层数」这一档才按层数算 —— 其余三档要么整段重算、要么整段不重算。",
      maxReason: (config) => `每个 stage 只背 ${maxStageLayers(config)} 层`
        + `（${config.totalLayer} 层 ÷ PP ${config.pp}，除不尽时前几段各多 1 层）`
        + `，再往上没有层可重算了 —— 要抬这个上界得先抬 Total Layer 或调小 PP`,
      title: "重算层数 N（MindFormers 的 recompute: [4,4,4,4]）\n\n"
        + "「重计算 · 按层数」那一档带着的那个数：**每个 stage 的前 N 层按「全开」算**"
        + "（每层激活系数 2），其余层按「关」算（系数 34）。\n\n"
        + "它是四档里唯一能让激活段停在**任意中间高度**的一档，也是唯一**逐 stage 分别生效**的一档 ——"
        + "Stage0 在飞的 micro-batch 最多，同样重算一层，它省下的绝对值也最多，"
        + "所以「各 PP Stage 峰值」那排小柱会一起变矮、而且变平。\n\n"
        + "N 按各段层数截断：46 层分 4 段是 12/12/11/11，填 12 时后两段就是整段重算。"
        + "yaml 写出去的数组也照这个截断，拿去跑不会出现「11 层的 stage 重算 12 层」。\n"
        + "上界因此跟着 Total Layer 与 PP 走 —— 再往上没有层可重算了。",
    },
    loraRank: {
      label: "LoRA Rank", group: "batch", min: 1, max: 512, pow2: true,
      enabledWhen: (config) => Boolean(config.lora),
      disabledReason: "未开 LoRA 时没有 adapter，秩也就无从谈起 —— 把左边那枚 LoRA 打开即可。",
      title: "LoRA Rank r（pet_config.lora_rank）\n\n"
        + "adapter 那对低秩矩阵 A(r×d_in) / B(d_out×r) 的秩。本页按注意力的 q/k/v/o 四个 "
        + "[H,H] 建模，每层可训练参数 = 4·r·2H = 8rH，**与 r 成正比**。\n\n"
        + "梯度段与优化器段（那 14 B/参数）也就与 r 成正比 —— 但基数极小："
        + "openPangu 的 hidden 2560、r=16 时每层每卡才 33 万参数，"
        + "两段加起来仍在几十 MB 量级。所以调 r 主要是在调**效果**（秩越高越接近全参微调的表达能力），"
        + "显存上怎么调都便宜。\n\n"
        + "常见取值 8 / 16 / 32 / 64；lora_alpha 一般取 2r（不占显存，本页只在 yaml 里写出来）。",
    },
    /* 「Routed = 256」最容易被读成「这个模型一共 256 个专家」。实际它是**每个 MoE
       layer 各自**的专家数，有多少个 MoE 层就有多少套。标签本身塞不下这个限定
       —— MoE 那一行是 nowrap 四等分、约 300px 一列，标签早已挂着省略号（见 css
       .cro-region--moe .cro-stepper-row），写成「Routed (per MoE Layer)」只会被截
       成一截读不通的碎片，还会把 Top-K / Shared / EP 一起压窄。所以限定词走问号
       气泡，可见的那一半交给下面那条 section 标题（「单个 MoE Layer 的…」）。
       title 写成函数：乘出来那个总数才是让人一下反应过来的地方，得报当前的层数。 */
    routedExpert: {
      label: "Routed", group: "moe", min: 1, max: 1024, pow2: true,
      title: ({ counts }) => {
        const head = "Routed = 每个 MoE layer 各自持有的路由专家数，不是全模型的总数。\n\n";
        if (!counts.moeLayers) {
          return `${head}当前配置没有 MoE 层，这一枚不参与建模。`;
        }
        return head
          + `当前 ${counts.totalLayer} 层里有 ${counts.moeLayers} 层是 MoE，每层各有一整套 `
          + `${counts.routedExpert} 个路由专家 —— 全模型共 ${counts.moeLayers} × ${counts.routedExpert} = `
          + `${counts.moeLayers * counts.routedExpert} 个专家实例。\n\n`
          + "各层的专家是彼此独立的参数，不共享权重；Top-K 路由也在每一层各自独立进行。\n\n"
          + `下面「单个 MoE Layer 的路由专家在 EP ranks 上的分布」铺开的就是其中一层的那一套：`
          + `${counts.routedExpert} 个专家按 EP=${counts.ep} 切开`
          + (counts.expertsPerEpRank ? `，每个 EP rank 持有 ${counts.expertsPerEpRank} 个。` : "。");
      },
    },
    topK:         { label: "Top-K",          group: "moe",      min: 1,  max: 64,   step: 1 },
    sharedExpert: { label: "Shared",         group: "moe",      min: 0,  max: 8,    step: 1 },
    /* 「EP = 64」有三种误读：一共 64 个专家 / 一共 64 个专家并行组 / 每张卡 64 个
       专家。它是**一套专家摊在多少个 rank 上**，而每个 rank 手上只有 Routed ÷ EP
       个专家。这句话里的两个数都得报当前值，所以 title 与 Routed 一样写成函数
       （建 stepper 时拓扑还没派生出来，正文由 emit() 那一趟填，见 fieldTitle）。 */
    ep: {
      label: "EP", group: "moe", min: 1, max: 1024, pow2: true,
      title: ({ counts }) => {
        const head = "EP = **一套路由专家分布在多少个 rank 上**（expert parallel size），"
          + "既不是专家的个数，也不是专家并行组的个数。\n\n";
        if (!counts.moeLayers) {
          return `${head}当前配置没有 MoE 层，这一枚不参与建模。`;
        }
        return head
          + `每个 rank 上的专家人头数 = Routed ÷ EP = ${counts.routedExpert} ÷ ${counts.ep} = `
          + (counts.expertsPerEpRank
            ? `**${counts.expertsPerEpRank} 个**。\n\n`
            : "除不尽 —— 当前这一档切不平，专家没法均摊到 EP rank 上。\n\n")
          + `凑齐这 ${counts.ep} 个 rank 才是**一整套专家**；`
          + `当前有 ${counts.edp} 组这样的 EP 域并排跑（集群矩阵的纵轴就是它）。\n\n`
          + "── 拨大拨小各付什么代价 ──\n"
          + "EP 越大，一套专家摊得越碎、每张卡背的专家参数与优化器状态越少；"
          + "代价是每层两次 all-to-all 要横跨更多 rank，跨机时尤其贵。"
          + "EP 越小则相反：通信便宜，但每张卡要装下更多专家。";
      },
    },
    totalRank:    { label: "Total Rank",     group: "cluster",  min: 1,  max: 65536, pow2: true },
    /* node 仍留在 FIELD_SPECS（label 供只读读数与建议修法的改动清单使用，量程供
       nodeLayout 夹取），但已不在 FIELD_ORDER 里 —— 它是派生量，不是输入。
       pow2 也去掉了：12 卡分 2 个节点，节点数本来就不必是 2 的幂，而这个标记只对
       走 stepper 的字段有意义。 */
    node:         { label: "Node",           group: "cluster",  min: 1,  max: 8192 },
  };

  /* ── 布尔开关 ─────────────────────────────────────────────────────────────
     没有 min/max/step 的量：不进 world 的乘积、不参与任何配平，拨它们只改
     capacity 的分段口径与 yaml 的对应行，所以不进 FIELD_SPECS，单列一张表。
     多数是布尔（渲染成开关）；带 options 的那两枚是有限档位（渲染成
     segmented-control）—— 两者走的是同一套 set / reconcile / 联动高亮 / 红圈 /
     disabledValue，只有控件长相不同，见 buildFlagSwitch 与 buildFlagChoice。
     这四枚正是升级计划附录点名的那四个「显存估算里影响最大、却唯独 capacity 看不见」
     的旋钮（recompute / seq_parallel / parallel_optimizer / vocab_emb_dp）——
     其中 parallel_optimizer 已于行 15 升成三档的 shardMode（关 / ZeRO-1 / FSDP2）——
     行 9 提了前两枚，行 10 / 行 11 补齐后两枚。至此 capacity 与 yaml 读的是同一份来源。
     **各自跟着所属的那一行走**，判据是那一行自己写的口径：
       cpMode           → parallel 行 —— CP 切成几份由 CP 那枚 stepper 定，这一枚定的是
                          「切完之后 attention 怎么把全局补回来」。它是这张表里唯一一枚
                          **会换掉硬校验本身**的（Ulysses 拦头数、Ring 拦序列长度，行 16）；
       seqParallel      → parallel 行（「模型怎么切开」）—— SP 是实打实在切，沿序列维
                          切激活，只是不额外占卡；
       vocabEmbDp       → parallel 行 —— 它决定词表那张大矩阵到底走 TP 还是走 DP，
                          是一句切法；
       shardMode        → parallel 行 —— 沿 DP 维切权重相关的若干段（ZeRO-1 / FSDP2），
                          同样是切法，同样不额外占卡。它是这张表里唯一一枚三档的，
                          不是布尔（行 15）；
       recomputeMode    → batch 行（「往这张卡里装多少」）—— 它一刀不切，只决定每份
                          留不留。行 19 之后是四档，不是开关；「按层数」那一档还带着
                          一枚 recomputeLayers stepper（在 FIELD_SPECS 里）；
       lora             → batch 行 —— 同样一刀不切，但它改的是**哪些参数需要梯度**：
                          冻结主干后梯度段与优化器段只跟 adapter 走（行 18）。
                          它带着的 loraRank 同样是一枚 FIELD_SPECS stepper。
       dtype / paramsDtype → batch 行 —— 这两枚与上面所有的都不同类：它们既不切、
                          也不决定装几份，改的是**每个数占几个字节**（行 21）。
                          六段里除激活外的五段全跟着它们走，是这张表里牵连最广的
                          一对；两枚分开是因为一个决定 fp32 master 摆在哪一段、
                          另一个决定常驻权重按几个字节存。

     ── disabledValue：不可用时该停在哪一档 ────────────────────────────────
     开关不可用（enabledWhen 为假）时不能就地放着不管：yaml 里会留下一行
     用户看得见却无从解释的值。停的那一档一律取「此刻毫无效果、且与预设默认同值」
     的那个 —— SP 是 false，另两枚是 true。这条原先是 reconcile 里写死的一句
     `if (config.tp <= 1) config.seqParallel = false;`，现在升成表里的一栏。 */
  const FLAG_SPECS = {
    /* ── CP 的两种算法（升级计划行 16）─────────────────────────────────────
       页面此前全按 ring attention 一种口径建模，`seq % (2×CP)` 那条硬校验是 ring
       专属的（因果掩码下序列前段算得少、后段算得多，要对半交叉分配才均衡）。
       但 MindSpeed MM 的特性表里标 CP 的模型多数走 **Ulysses** —— 它沿**头**维做
       all-to-all，序列长度爱是多少是多少，约束改落在头数上。对那批配置，页面此前
       给的是一条**错误的红线**。

       所以它不是 EP 口径那种「同一批卡的两种读法」（切一下一个数都不该变），
       而是两种真的算法：拦的字段不同、上限不同、通信形态不同。两档共同的部分是
       显存 —— 都是每卡留 S/CP 份激活，capacity 一个数都不动，差别只在通信。 */
    cpMode: {
      group: "parallel",
      label: "CP 口径",
      options: [
        { value: "ulysses", label: "Ulysses" },
        { value: "ring", label: "Ring" },
      ],
      /* CP=1 时没有上下文并行组，两档说的都是同一件「不切」—— 与 SP 在 TP=1 时同构。
         停在 "ulysses"（预设默认值）：yaml 里那行本来就只在 CP>1 时才写出来，
         停哪一档都不会留下需要解释的字，那就停在默认值上。 */
      enabledWhen: (config) => config.cp > 1,
      disabledValue: "ulysses",
      disabledReason: "CP = 1 时没有上下文并行组，两种算法都退化成「不切」—— 把 CP 调大即可选择。",
      title: "CP 的两种切法：Ulysses（沿头维 all-to-all）/ Ring（沿序列维轮转 KV）\n\n"
        + "两档都把序列切成 CP 份、每卡只留 S/CP 个 token 的激活，所以**单卡显存完全相同** —— "
        + "本页容量栏切换这一档一个数都不会变。差别在 attention 那一步怎么把「要看全局」"
        + "这件事补回来，代价与硬约束因此完全不同。\n\n"
        + "· Ulysses（DeepSpeed-Ulysses；MindSpeed 的 ulysses_cp_algo）\n"
        + "  进 attention 前一次 all-to-all，把「每卡一段序列、全部头」换成「每卡整条序列、"
        + "一部分头」，算完再换回来。attention 内部完全不用改，FlashAttention 原样能用。\n"
        + "  代价：头已经被 TP 切过一轮，CP 再切一轮 —— **TP × CP 必须整除 num_heads**。"
        + "这同时就是它的并行度天花板（48 头的模型，TP×CP 最多 48）；GQA 下超过 KV 头数还要复制 KV。\n\n"
        + "· Ring（ring attention；Megatron 的 context parallel / megatron_cp_algo）\n"
        + "  各卡只持有自己那段序列的 KV，沿环轮转传给邻居，边传边算。与头数无关，"
        + "序列想切多细就切多细 —— 十万 token 以上的超长序列实际只有这一条路。\n"
        + "  代价：**seq 必须被 2×CP 整除** —— 因果掩码下要把序列对半交叉分给各 rank "
        + "才均衡得了负载；attention 内部也得改写成分块累加。\n\n"
        + "怎么选：头数够切就用 Ulysses（通信一次性、实现最省事，特性表里多数模型标的是它）；"
        + "头数不够切、或序列长到撞上 Ulysses 的天花板，就换 Ring。两者还能混用（hybrid），本页未建模。",
    },
    seqParallel: {
      group: "parallel",
      label: "序列并行 SP",
      /* TP=1 时没有 TP 组，SP 无从切起 —— 这时它不该是一个能动的东西。
         做成置灰而不是隐藏，理由有二：默认配置就是 TP=1，隐藏等于首屏看不到它；
         而且 reconcile 会在 TP=1 时把它强制关掉，隐藏的话这个联动就发生在看不见
         的地方（yaml 里那行会自己变而表单上没有任何东西动过）。 */
      enabledWhen: (config) => config.tp > 1,
      disabledValue: false,
      disabledReason: "TP = 1 时没有 TP 组，序列并行无从切起 —— 把 TP 调大即可启用。",
      title: "序列并行 SP（use_seq_parallel）\n\n"
        + "只有开与关，没有自己的并行度 —— 它切成几份由 TP 决定，切的就是同一个 TP 组。"
        + "所以 TP=1 时开关它，页面上的数字一模一样。\n\n"
        + "算法：一层里 TP 只切得动两段矩阵乘（attention 与 FFN），夹在中间的 "
        + "LayerNorm / Dropout / 残差 add 切不动，在 TP 组内是整份复制的。"
        + "SP 把这几段沿 token 位置切成 TP 份，每张卡只算 S/TP 个 token 的那一段。\n"
        + "进出这几段时，原先 TP 末尾那一次 all-reduce 拆成 reduce-scatter（进）"
        + "+ all-gather（出）—— 总通信字节数不变，所以它几乎是白拿的。\n\n"
        + "效果：每层激活从 sbh·(10 + 24/TP) 降到 sbh·34/TP"
        + "（Korthikanti et al. 2022，本页容量栏用的就是这组系数）。",
    },
    /* 词表那张矩阵是全模型最大的单块权重（151552 × 2560 ≈ 388M 参数，含梯度与
       梯度共 1.5 GB，未开优化器并行时连同优化器状态 6.2 GB）。它有两种放法，MindFormers 用 vocab_emb_dp 一个布尔量
       表达，而这正是 capacity 先前与 yaml 打架的第四处：yaml 写 True（走 DP、
       每卡背满），capacity 却按 ÷TP 估（走 TP、切开）。升级计划行 11。 */
    vocabEmbDp: {
      group: "parallel",
      label: "词表走 DP",
      /* TP=1 时两种放法算出来的数一模一样（÷1），这枚开关此刻改变不了任何东西。
         与 SP 的处理同构：置灰而不是隐藏，理由也一样 —— 默认配置就是 TP=1，
         隐藏等于首屏看不见它。
         但停的那一档与 SP **相反**：SP 停在 false、它停在 true。判据不是「关掉」，
         而是「停在没有效果、也不会在 yaml 里留下一行需要解释的值上」，
         而 vocab_emb_dp 的默认值与无效值都是 True。 */
      enabledWhen: (config) => config.tp > 1,
      disabledValue: true,
      disabledReason: "TP = 1 时词表切不切都一样（÷1），这枚开关改变不了任何数字 —— 把 TP 调大后它才有效。",
      title: "词表 Embedding 走 DP（vocab_emb_dp）\n\n"
        + "开 = Embedding 与 LM Head 在 TP 组内**整份复制**，每张卡都背满整张词表矩阵；"
        + "关 = 沿词表维切成 TP 份，每张卡只背 vocab/TP 行。\n\n"
        + "为什么会有「开」这一档：切开之后每次查表都要一次通信把散在各卡的结果拼回来，"
        + "而词表矩阵虽大、算得却很轻，这次通信常常不划算。所以 MindFormers 的默认是 True。\n\n"
        + "代价直接写在容量柱上：hidden 2560、vocab 151552 时这一块是 388M 参数 —— "
        + "光权重加梯度就 1.5 GB，未开优化器并行时连同优化器状态共 6.2 GB，"
        + "而且只压在 Stage0 与末 Stage 两张卡上 —— "
        + "「各 PP Stage 峰值」那排小柱首尾更高，就是它。\n"
        + "TP=1 时两档数字相同（÷1），此时开关置灰。",
    },
    /* ── 三档，不是开关（升级计划行 15）─────────────────────────────────
       原先这里是一枚布尔 parallelOptimizer，正文里顺口写着「ZeRO-1 / FSDP 一类」——
       但那两者切的段数根本不同：ZeRO-1 只切优化器状态，FSDP2 是 ZeRO-3 口径，
       权重与梯度也一起切，代价是每层前反向都要把这一层的权重 all-gather 回来。
       混成一档，等于让容量柱对 README 特性矩阵里那批「只勾 FSDP2」的新模型
       （Qwen3-VL / InternVL3.5 / Wan2.2 / Qwen3-Omni …）画出一个高一大截的数。

       三档共用同一组分母（专家 ÷ EDP、其余 ÷ EDP×EP，见行 10）—— 它们切的是
       同一维，差别只在「切哪几段」，所以 capacity 那边不必再引入第三个分母。
       **档位是一条阶梯而不是几个独立开关**（关 ⊂ ZeRO-1 ⊂ ZeRO-3）：做成布尔组合
       会拨得出「切权重但不切优化器」这种不存在的状态。ZeRO-2（只多切梯度）没有
       列进去 —— MindSpeed / MindFormers 都不把它作为一档暴露；真要补就插在中间，
       capacity 那边只是少切一段，判据本身不用动。 */
    shardMode: {
      group: "parallel",
      label: "权重分片",
      /* 带 options 就渲染成 segmented-control（buildFlagChoice），不带就还是开关。
         值一律是字符串："zero1" 对应 yaml 原先那行 enable_parallel_optimizer: True，
         所以默认档的 YAML 视图逐字不变。 */
      options: [
        { value: "none", label: "关" },
        { value: "zero1", label: "ZeRO-1" },
        { value: "fsdp2", label: "FSDP2" },
      ],
      /* DP=1 时没有数据并行组，三段都无处可分 —— 与 SP 在 TP=1 时同构。
         停在 "zero1"（yaml 的默认值）而不是 "none"：此刻三档效果相同（÷1），
         停到关档反而会在 YAML 视图里被标成「与默认不同」，成了一行要解释的字。 */
      enabledWhen: (config) => config.dp > 1,
      disabledValue: "zero1",
      disabledReason: "DP = 1 时没有数据并行组，权重相关的三段都无处可分 —— 把 DP 调大即可生效。",
      title: "权重分片：沿数据并行维切掉权重相关的哪几段\n\n"
        + "一张卡上「权重相关」共 16 B/参数 —— 权重 2 B（bf16）、梯度 2 B、"
        + "优化器状态 12 B（Adam 的 fp32 master weight + momentum + variance）。"
        + "数据并行的原始做法是每张卡各存一份完整的：N 张卡就存了 N 份一模一样的东西。\n\n"
        + "── 为什么恰好是这三档 ──\n"
        + "这三段都能沿 DP 维切开，用通信换显存。但三段的性价比差得很远，"
        + "所以 ZeRO（Rajbhandari et al. 2020）把它拆成了阶梯式的几级，"
        + "各家框架照着这条阶梯设开关，落到有意义的就是这三个点：\n\n"
        + "· 关\n"
        + "  三段都整份持有，每卡 16 B/参数。经典 DDP 的做法 —— 通信最省，"
        + "显存全浪费在复制上。今天只在 DP=1、或要对齐一份没开分片的基线时才用。\n\n"
        + "· ZeRO-1（只切优化器状态）→ 2 + 2 + 12/D\n"
        + "  一刀切掉 16 B 里的 12 B，占七成半，而通信量一个字节都不增 —— "
        + "梯度的 all-reduce 本来就是 reduce-scatter + all-gather 两步做的，"
        + "切开之后每张卡正好只需要其中各一半。几乎是白拿的，所以它成了业界默认，"
        + "也不撞任何整除约束，显存不够时常常和重计算并列为最先该试的两项。\n\n"
        + "· FSDP2 / ZeRO-3（三段全切）→ (2 + 2 + 12)/D\n"
        + "  这一档是质变，不是又多切一段：权重是前向反向都要用的，"
        + "切开之后每算到一层都得先把它拼回来（算完即弃，反向再拼一次），"
        + "通信从「每步一轮」变成「每层一轮」。省得最多，也是唯一真正付通信代价的一档。\n\n"
        + "中间其实还有 ZeRO-2（再多切梯度那 2 B）：省得少，又与梯度累积、梯度裁剪的实现纠缠，"
        + "各家框架大多不把它单独暴露成一档，所以这里也不列。\n\n"
        + "「FSDP2」与「ZeRO-3」说的是同一件事 —— FSDP 是 PyTorch 把 ZeRO-3 做进原生 API 的产物"
        + "（FairScale → FSDP → 用 DTensor 重写的 FSDP2）。它这两年重新变重要，"
        + "是因为张量并行与流水并行的调参成本很高：要对整除、要切得动注意力头、要把层均分、"
        + "还要吃流水线气泡；而 FSDP 只用一个 DP 维就能把模型装下。"
        + "互联带宽上来之后这笔通信账开始划算，不少新模型的首发配方直接就是"
        + "「纯 DP + FSDP2 + 重计算」，一个模型切分维都不开。\n\n"
        + "── 本页怎么算 ──\n"
        + "分母 D 有两个，分开算：\n"
        + "· 路由专家只在 EDP 维上复制 → ÷ EDP\n"
        + "· 其余权重（attention / dense / 共享专家 / 词表）在整个数据并行域上复制 → ÷ (EDP×EP)\n"
        + "两个 EP 口径下这两个分母都是同一批卡算出来的，所以切换口径容量柱不动。\n\n"
        + "FSDP2 那份 all-gather 暂存按预取 2 层估，计在预留段里 —— DP 很大时它不跟着变小，"
        + "反而会成为权重相关里最大的一块。\n"
        + "它与 TP / PP / CP 同用属于两条路线混用（FSDP 已经沿 DP 把整个模型切开了），"
        + "本页不拦截，只给一条软警告。",
    },
    /* ── 四档，不是开关（升级计划行 19）─────────────────────────────────
       原先这里是一枚布尔 recompute，只拨得出 34 与 2 两个系数 —— 而这两档之间
       差着一个数量级，**实际调优最常落的正是中间**。行 9 落地时自己记下了这个
       缺口（那条 title 的末句写的就是「要调中间档，这枚开关得换成一枚有档位的
       控件」），这一档兑现它。

       四档的系数全部出自与行 9 同一篇（Korthikanti et al. 2022 §4）：那里把
       每层 34·sbh 拆成 attention 11 + FFN 19 + LayerNorm 4，其中
       **10 是 TP 复制的、24 是 TP 切得动的**（10 = 两个 LN 输入 4 + 两段 block
       输入 4 + 两个 dropout mask 2）。四档就是从这张拆分表里读出来的：
         关       全留                              → 34（开 SP）/ 10t+24（关 SP）
         选择性   重算 FFN 段，只留它的输入          → 17 / 9t+8
         按层数   前 N 层按「全开」、其余按「关」    → 逐层混合
         全开     只留每层输入，反向重算一遍前向     → 2 / 2t
       自洽性检查：TP=1 时四档收敛成 34 / 17 / 混合 / 2，与 SP 无关。

       「选择性」这一档的口径要说清（真实框架里它是可配的算子名单，不是一个定值）：
       本页取「整个 FFN 段」这一端。MindFormers 的 select_recompute 常见默认只挑
       FFN 里的 SiLU / mul 那几个中间量，落点在 17 与 34 之间；Megatron 的
       --recompute-granularity selective 挑的是 attention 里的 softmax/dropout，
       而那一块（5as²/h）本页按 FlashAttention 建模、本来就不计入 —— 所以那一档
       在本页等于「关」，没有列进来。 */
    recomputeMode: {
      group: "batch",
      label: "重计算",
      options: [
        { value: "none", label: "关" },
        { value: "selective", label: "选择性" },
        { value: "layers", label: "按层数" },
        { value: "full", label: "全开" },
      ],
      title: "重计算（recompute_config）：前向不留的那部分激活，反向按需重算一遍\n\n"
        + "拿算力换显存，而且汇率极高 —— 但它不是一枚开关，四档之间差着一个数量级，"
        + "实际调优最常落的正是中间两档。\n\n"
        + "每层激活 34·mb·S·H（开 SP、TP 已除）拆开是：attention 11 + FFN 19 + LayerNorm 4"
        + "（Korthikanti et al. 2022 §4，本页容量栏用的就是这组系数）。四档按这张表取：\n\n"
        + "· 关 → 系数 34\n"
        + "  每层的中间激活全部留在显存里。算力最省，显存最贵。\n\n"
        + "· 选择性 → 系数 17\n"
        + "  重算 FFN 段（只留它的输入），attention 与 LayerNorm 照留 —— 正好砍掉一半。"
        + "FFN 是这三块里最大的一块，而它的重算只是两三个矩阵乘，性价比最高。\n"
        + "  ⚠️ 真实框架里这一档是**可配的算子名单**：MindFormers 的 select_recompute 常见默认"
        + "只挑 FFN 里的 SiLU / mul，落点在 17 与 34 之间；本页取「整个 FFN 段」这一端。\n\n"
        + "· 按层数 → 前 N 层按「全开」算，其余按「关」算\n"
        + "  MindFormers 的 recompute: [4,4,4,4]（每个 stage 各重算几层）。"
        + "它是唯一能让激活段停在任意中间高度的一档，也是唯一按 stage 分别生效的一档 ——"
        + "Stage0 在飞的 micro-batch 最多，同样重算一层，它省下的绝对值也最多。\n\n"
        + "· 全开 → 系数 2\n"
        + "  每层只留输入，反向重算一遍整层前向。激活掉一个数量级，"
        + "代价是反向多跑一遍前向，算力开销约 +30%（本页未建模算力）。\n\n"
        + "Megatron 的 --recompute-granularity selective 没有单列成一档：它重算的是 attention 里的"
        + " softmax/dropout（5·a·s²/h 那一项），而本页按 FlashAttention 建模、这一项本来就不计入，"
        + "那一档在本页等于「关」。",
    },
    /* ── LoRA（升级计划行 18）───────────────────────────────────────────
       它与这张表里其余几枚都不同类：那几枚改的是「同一份东西怎么摆」，
       LoRA 改的是**哪些参数需要梯度**。冻结主干之后，梯度段与优化器状态段
       只跟 adapter 走，而权重段一个字节不少 —— 容量柱上最大的一次形变。

       落在 batch 行而不是 parallel 行的「高级」里，判据仍是那两行各自写的口径：
       它一刀不切（不进任何并行维、不改 world），只决定这张卡上留不留那几段，
       与「重计算」是同一类。两枚一起收在 batch 行的「高级」折叠里 ——
       本页两个预设写的都是预训练配置，微调侧的旋钮不该占着首屏那一格。 */
    lora: {
      group: "batch",
      label: "LoRA",
      title: "LoRA（低秩适配微调；MindFormers 的 pet_config.pet_type: lora）\n\n"
        + "主干权重全部冻结，只在若干矩阵旁挂一对低秩矩阵 A(r×d_in) / B(d_out×r) 参与训练。"
        + "可训练参数量掉到 r·(d_in+d_out) 一档 —— 本页按注意力的 q/k/v/o 四个 [H,H] 建模，"
        + "每层 4·r·2H = 8rH 个 adapter 参数。\n\n"
        + "为什么它对显存的影响比任何一档权重分片都大：一张卡上「权重相关」共 16 B/参数，"
        + "其中 14 B（梯度 2 + 优化器状态 12）**只跟可训练参数走**。冻结主干等于把这 14 B "
        + "从几十亿参数身上挪到几百万参数身上，梯度段几乎归零、优化器段塌到零头，"
        + "而权重段纹丝不动 —— 主干还是要整份背在卡上的。\n\n"
        + "⚠️ 激活也几乎不变：反向仍要穿过整个网络才能算到 adapter 的梯度，"
        + "每层的中间激活该留还得留。所以 LoRA 省的是权重相关那三段里的两段，"
        + "长序列 / 大 micro-batch 撑起来的激活段它一点都帮不上 —— 那仍要靠重计算与 CP。\n\n"
        + "它不是并行配置的一档，而是**换了一种训练**：主干不再更新，学到的东西只在 adapter 里。"
        + "本页两个预设写的都是预训练配置，所以默认关着。",
    },
    /* ── 精度两档（升级计划行 21）───────────────────────────────────────
       行 21 之前 capacity 把「每个数占几个字节」写死成三个常量（2 / 2 / 12 =
       bf16 权重 + bf16 梯度 + Adam 的 fp32 master），页面上**一个控件都没有**。
       而 11 份样本里这一项人人都写：`megatron_llama3_8b_fp8.sh` 整份脚本的主题
       就是 FP8，`hf_deepseekv3_config.json` 带 `quantization_config: {fmt: e4m3}`，
       两份 MindFormers yaml 都写着 `params_dtype: float32` + `compute_dtype:
       bfloat16`。这是第六批里唯一一条会动**全部六段**的。

       **两枚而不是一枚**，因为它们改的是两件事：
       · paramsDtype（主权重精度）—— 决定那份 fp32 master **摆在哪一段**。
         bf16 档：参数以 bf16 常驻（2 B），master 在优化器的 12 B 里；
         fp32 档：参数本身就是 master（4 B），优化器只剩 momentum + variance（8 B），
         梯度也按参数精度累加（4 B）。两档加起来都是 16 B/参数 —— **总量不变，
         变的是哪一段扛着它**。这句在关档下听着像废话，一旦拨了权重分片就不是：
         ZeRO-1 切的只有优化器那一段，fp32 档能切走的从 12 B 掉到 8 B，
         留在每张卡上的从 4 B 涨到 8 B。容量柱上看得见。
       · dtype（计算/存储格式）—— bf16 与 fp16 的字节数相同（差别在动态范围与
         loss scale，不进显存模型），FP8 档则让常驻的那份权重按 1 B 存。

       ⚠️ FP8 档建模的是**权重直存 fp8**（Megatron 的 --fp8-param-gather，
       llama3 那份脚本正好开着）。不开那一项时 fp8 只是 matmul 前的一次转换，
       权重仍按 2 B 常驻、另有一份 fp8 缓存（2 + 1 B）—— 本页没建那一档，
       与 FSDP2 / VPP 同一种处理：算的是什么、对应框架里哪个开关都写出来。
       激活段**不随精度档变**：那组系数（34 / 17 / 2）出自 Korthikanti et al.
       2022，本身就按 2 B/元素折算过；fp8 只作用在 matmul 的输入副本上，
       哪些激活能跟着降到 1 B 取决于实现，本页不猜。 */
    dtype: {
      group: "batch",
      label: "计算精度",
      options: [
        { value: "bf16", label: "BF16" },
        { value: "fp16", label: "FP16" },
        { value: "fp8", label: "FP8" },
      ],
      title: "计算精度（compute_dtype / --fp8-format / --bf16 / --fp16）\n\n"
        + "· BF16 —— 今天的默认。8 位指数与 fp32 同宽，动态范围够，训练不用 loss scale。\n"
        + "· FP16 —— **字节数与 BF16 完全相同**，本页六段一个数都不变。"
        + "差别在动态范围：指数只有 5 位，要配 loss scaling 才不溢出。"
        + "列出来是为了如实接住那些写 `--fp16` 的配置（如 megatron_175b.sh），"
        + "而不是假装页面没读到。\n"
        + "· FP8 —— 权重按 1 B 存，权重段**减半**。\n\n"
        + "⚠️ FP8 这一档建模的是**权重直存 fp8**（Megatron 的 `--fp8-param-gather`）。"
        + "不开那一项时，fp8 只是进 matmul 前的一次转换，权重仍按 2 B 常驻、"
        + "另加一份 fp8 缓存（2 + 1 B）—— 那一档本页没建。\n"
        + "openPangu 参考配置里的「forward FP8」正是后一种（HiF8 算子级计算格式，"
        + "权重仍是 bf16），所以默认档停在 BF16，而不是 FP8。\n\n"
        + "梯度不跟着降：反向的 dgrad 累加仍走 bf16（llama3 那份脚本连"
        + "`--grad-reduce-in-bf16` 都单独写了一行）。激活也不随这一档变 —— "
        + "见单卡容量栏口径浮层里的那句说明。",
    },
    paramsDtype: {
      group: "batch",
      label: "主权重精度",
      options: [
        { value: "bf16", label: "BF16" },
        { value: "fp32", label: "FP32" },
      ],
      title: "主权重精度（MindFormers 的 model_config.params_dtype）\n\n"
        + "混合精度训练里总要有一份 fp32 的权重（低精度累加会把小的更新吃掉），"
        + "区别只在**它摆在哪儿**：\n\n"
        + "· BF16 档（业界混合精度的标准做法）\n"
        + "  参数以 bf16 常驻 → 权重 2 B；那份 fp32 master 由优化器持有，"
        + "算在 Adam 的 12 B 里（4 master + 4 momentum + 4 variance）。\n"
        + "  → 2 + 2 + 12 = 16 B/参数\n\n"
        + "· FP32 档（两份 MindFormers yaml 写的都是这一档）\n"
        + "  参数本身就是那份 master → 权重 4 B；优化器不必再存一份，只剩"
        + " momentum + variance 8 B；梯度按参数精度累加，也是 4 B。\n"
        + "  → 4 + 4 + 8 = 16 B/参数\n\n"
        + "**两档的总量一模一样**，变的是哪一段扛着它 —— 所以单看容量柱的高度"
        + "看不出区别，看的是段与段之间的比例。\n\n"
        + "一旦拨了「权重分片」，两档就分道扬镳：ZeRO-1 只切优化器那一段，"
        + "BF16 档能切走 12 B、每卡留 4 B，FP32 档只能切走 8 B、每卡留 8 B —— "
        + "**DP 越大，FP32 档越吃亏**。FSDP2 档三段全切，两档才又拉平。",
    },
  };

  /* 一枚 FLAG_SPECS 字段当前值的中文读数。开关是「开 / 关」，带 options 的取
     那一档自己的 label。横幅的改动清单、控件旁的状态字、yaml 注释都读它 ——
     别把 true/false 或 "fsdp2" 这种内部值露给用户。 */
  function flagText(flag, value) {
    const spec = FLAG_SPECS[flag];
    if (!spec) return String(value);
    if (!spec.options) return value ? "开" : "关";
    const hit = spec.options.find((o) => o.value === value);
    return hit ? hit.label : String(value);
  }

  /* batch 单独成组而不是并进 cluster：它要挂到卡型号下拉**之后**的那个容器里
     （#croBatchSteppers），而 cluster 组的容器排在下拉之前。 */
  const FIELD_ORDER = {
    /* 这一行**可见的几枚，恰好就是 world 乘积的因子**（DP×PP×TP×CP）加上模型自身的
       层数 —— 判据从「都是切法」换成了「进不进 rank 乘积」，因为前者解释不了
       CP 口径为什么也在折叠里。凡是拨了 Total Rank 一张卡都不变的，一律收进
       「高级」：VPP 与那四枚开关 / 档位控件，见 ADVANCED_ITEMS.parallel。 */
    parallel: ["totalLayer", "dp", "pp", "tp", "cp"],
    moe: ["routedExpert", "topK", "sharedExpert", "ep"],
    /* node 不在这里，而且**整个收进了「高级」**（见 ADVANCED_ITEMS.batch）：
       每节点卡数是硬件事实（CARD_SPECS.ranksPerNode），Node 数因而由 Total Rank
       整除得来，只有唯一一个合法值 —— 一枚只能停在一个值上的 stepper 不是 stepper，
       而一个算得出来的数也不值得占首屏那一格。它在折叠里仍是只读读数。 */
    cluster: ["totalRank"],
    /* 这一组是**这一行首屏留下的全部**，四枚读下来是一句话：
         Global Batch —— 这一步一共吃多少样本（只读，MBS × DP × 微批数）
         Micro Batch / Seq Length / Hidden —— 这张卡上那个张量的 [B, S, H]
       Global Batch 排在最前而不是跟在因子后面：先说「一步多大」，再说「摊到这张
       卡上是多大」，从粗到细，正是看配置的顺序。B 与 S 之间不插任何东西 ——
       这一行要和大家嘴里那个输入矩阵形状逐字对得上。

       收进「高级」的判据到这一版有三类（见 ADVANCED_ITEMS.batch）：
       · **算得出来的**（Node）；
       · **不是形状、也不是这一步吃多少的**（微批数 —— 它是「这个 [B,S,H] 一步之内
         跑几遍」，值仍进 Global Batch 的乘积，只是不必占首屏）；
       · **换算口径与条件生效的**（精度两档 / 重计算与重算层数 / LoRA 那一对）。
       ⚠️ 派生读数（globalBatch / hiddenDim）与真字段混在同一张表里，由 mount()
       的 buildItem 按名字分派 —— 它们不是 FIELD_SPECS 的字段，别拿去查量程。 */
    batch: ["globalBatch", "microBatch", "seqLen", "hiddenDim"],
  };

  /* ── 派生读数：长得像 stepper，但没有加减键 ───────────────────────────────
     判据一条：**它不是输入**，由别的字段乘除出来，拨不动。三枚：

       Node          Total Rank ÷ 整机卡数（收在「高级」里）
       Hidden        [B, S, H] 的 H，模型预设里的结构常量（换模型才变）
       Global Batch  MBS × DP × 微批数，这一步一共吃多少样本

     后两枚原先只活在 YAML 视图里（model_config.hidden_size 与
     runner_config.batch_size），于是这一行有两处读不出来：按 [B,S,H] 排却没有 H；
     表单上那枚 Micro Batch 常被当成 batch size 看，而真正的 global batch 要切到
     另一个视图才见得着。三枚都只读、都带口径浮层，数与 yaml 那几行同源。

     它们**与真字段并排写在 FIELD_ORDER / ADVANCED_ITEMS 里**，由 buildItem 按名字
     分派 —— 位置就是列表里的位置，不再另有一张「插在谁后面」的表。
     summary 每次 emit 重算，返回 { text, title }：text 是格子里那个数，title 是
     问号浮层里的口径。 */
  const DERIVED_SPECS = {
    node:        { label: FIELD_SPECS.node.label, summary: nodeSummary },
    hiddenDim:   { label: "Hidden",               summary: hiddenSummary },
    globalBatch: { label: "Global Batch",         summary: globalBatchSummary },
  };

  /* ── 合法邻域 ─────────────────────────────────────────────────────────────
     stepper 只按 2 的幂走时，修复约束靠反复减半就够了；手输放开任意整数之后
     减半修不动了 —— 120 减半是 60，仍然不整除 256。所以「把某个字段挪到离现值
     最近的合法值」升格成基本操作：reconcile 的修复分支和报错横幅的建议修法都用
     它。三个纯函数，都不碰 config。 */
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  function clampToSpec(value, spec) { return Math.min(spec.max, Math.max(spec.min, value)); }

  /* base 的倍数里离 preferred 最近的那个。至少取到 base 本身 —— 0 不是合法并行度。
     等距时取大的：约束多为「≥」（专家数 ≥ Top-K、DP ≥ EP），往大了取更容易同时成立。 */
  function nearestMultiple(base, preferred, spec) {
    if (!(base >= 1)) return clampToSpec(preferred, spec);
    const candidates = [Math.floor(preferred / base) * base, Math.ceil(preferred / base) * base, base]
      .filter((v) => v >= base && v >= spec.min && v <= spec.max);
    if (!candidates.length) return clampToSpec(base, spec);
    return candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || b - a)[0];
  }

  /* target 的因子里离 preferred 最近的那个。target 上界是 8192，直接扫一遍即可，
     不值得为它写筛法 —— 这个函数只在配置变动时跑，不在渲染路径上。 */
  function nearestDivisor(target, preferred, spec) {
    let best = spec.min;
    let bestGap = Infinity;
    for (let d = 1; d <= target; d += 1) {
      if (target % d !== 0 || d < spec.min || d > spec.max) continue;
      const gap = Math.abs(d - preferred);
      if (gap < bestGap || (gap === bestGap && d > best)) { best = d; bestGap = gap; }
    }
    return best;
  }

  /* 与 nearestDivisor 同形，但**只在 2 的幂档位上找解**。
     分出这一支的理由（行 16 的验证跑出来的）：CP 的合法基数可能带奇因子 ——
     `heads 48 / TP 8 = 6`，nearestDivisor 会给出 3 或 6。而 fitParallelWorld 只在
     2 的幂梯子上配平，一个 CP=3 会让 world 永远卡在 `3·2^k`、凑不回 `2^15` 的
     Total Rank，页面就停在一条**它自己造出来的**红字上。
     手输仍可以停在 3（那是用户明确指定的值，validate 也认），但**联动修出来的值
     必须留在梯子上** —— 联动不该产生一个用户没要求、页面又收不回来的数。
     spec.min（各 pow2 字段都是 1）恒是 2 的幂且整除任何 target，兜底安全。 */
  function nearestPow2Divisor(target, preferred, spec) {
    let best = spec.min;
    let bestGap = Infinity;
    for (let d = 1; d <= target; d *= 2) {
      if (target % d !== 0 || d < spec.min || d > spec.max) continue;
      const gap = Math.abs(d - preferred);
      if (gap < bestGap || (gap === bestGap && d > best)) { best = d; bestGap = gap; }
    }
    return best;
  }

  /* ── 模型结构硬约束 ───────────────────────────────────────────────────────
     并行度与**模型常量**（头数、KV 头数）之间的整除关系。它与 world 乘积那一族
     约束有个根本区别：冲突时**没有任何字段可以被改来兼容它** —— heads 写在
     MODEL_PRESETS 里，不是 stepper。所以 reconcile 只能把并行度自己收回来，而
     加减键必须提前跳过这些档位（见 stepValue），不能步进过去再指望修复。 */
  function presetOf(config) {
    return MODEL_PRESETS[config.model] || MODEL_PRESETS["openpangu-flash"];
  }

  /* TP 同时切两样东西，两样都得切得整：注意力头（Q 头）与 FFN 的 intermediate
     维（dense 与 MoE 专家各一个）。所以 TP 必须是这几个数**公约数**的因子 ——
     与 EP 整除 gcd(专家数, DP) 同形。
       openPangu：gcd(48, 9216, 1024) = 16 → 2 的幂档位 1/2/4/8/16
       Qwen2    ：gcd(28, 18944)      =  4 → 1/2/4
     2 的幂梯子上的可达档位与只看头数时**逐位相同**（48 的 2 的幂因子本来就到 16
     为止），差别只出现在手输：TP=3 头数除得尽、MoE 的 1024 除不尽，改前放行、
     现在拦住。
     kvHeads **不在这里**：TP 超过 KV 头数在 Megatron 里是复制 KV 而不是报错，
     功能上合法，只是通信与显存变差 —— 那是 warn() 的一条软警告（行 7）。 */
  function tpShardBasis(config) {
    const preset = presetOf(config);
    let basis = preset.heads || 1;
    if (preset.denseIntermediate) basis = gcd(basis, preset.denseIntermediate);
    if (!preset.noMoe && preset.moeIntermediate) basis = gcd(basis, preset.moeIntermediate);
    return Math.max(1, basis);
  }

  /* CP 的算法口径（升级计划行 16）。整页只此一处判断字符串 —— validate /
     reconcile / stepValue / warn / capacity / yaml 都读它，别再各写各的比较。
     缺字段的老配置按 Ulysses（预设默认值）走。 */
  function cpIsUlysses(config) {
    return (config.cpMode || "ulysses") === "ulysses";
  }

  /* Ulysses 沿**头**维做 all-to-all，而 TP 早已先切过一轮头 —— 两者争的是同一批头，
     真正的约束是 `num_heads % (TP × CP) == 0`。这里把它折成「CP 这一维自己的合法
     档位表」= heads / TP，供 stepValue 跳档与 reconcile 收值用，与 tpShardBasis 同形。
     Ring 档不看头数（它沿序列维轮转 KV），这个函数在 Ring 档下不该被调用。 */
  function ulyssesCpBasis(config) {
    const heads = presetOf(config).heads || 1;
    const tp = Math.max(1, config.tp);
    return heads % tp === 0 ? Math.max(1, heads / tp) : 1;
  }

  /* 一共有几张卡在分这批注意力头：TP 一定算，CP 只在 Ulysses 档算。
     GQA 的「KV 会被复制」警告读它 —— 那条的判据从来就是「头够不够分」，
     而不是「TP 有多大」，行 16 之后 CP 也成了分头的一方。 */
  function headConsumers(config) {
    return Math.max(1, config.tp) * (cpIsUlysses(config) ? Math.max(1, config.cp) : 1);
  }

  /* 被模型常量挡死、**没有对手字段可改**的那些档位（见上面这段的判据）。
     三个字段各有各的落点：
       tp   要整除 gcd(heads, 两个 intermediate)；Ulysses 档下还要与 CP 一起整除 heads
       cp   只有 Ulysses 档进来 —— Ring 那条的对手是 seqLen，可以联动修，不该跳档
       vpp  只判「有没有流水线可交错」；层数整除那条的对手是 Total Layer，同样走联动修 */
  function structurallyAllowed(field, value, config) {
    if (field === "tp") {
      if (!(value >= 1 && tpShardBasis(config) % value === 0)) return false;
      if (!cpIsUlysses(config) || config.cp <= 1) return true;
      const heads = presetOf(config).heads || 1;
      return heads % (value * config.cp) === 0;
    }
    if (field === "cp") {
      if (value <= 1 || !cpIsUlysses(config)) return true;
      return ulyssesCpBasis(config) % value === 0;
    }
    if (field === "vpp") return value <= 1 || config.pp > 1;
    return true;
  }

  /* 当前层数与 PP 下、离现值最近的合法 VPP。**不能**写成
     `nearestDivisor(层数/PP, …)`：层数未必被 PP 整除（openPangu 46 层 / PP4 就不
     整除，本页的 stage 本来就允许不均分），那样会取到一个乘起来仍除不尽的档。
     VPP=1 恒合法（那一档根本不受这条约束），是兜底。 */
  function nearestVpp(config) {
    const spec = FIELD_SPECS.vpp;
    let best = 1;
    let bestGap = Infinity;
    for (let v = spec.min; v <= spec.max; v += 1) {
      if (v > 1 && config.totalLayer % (config.pp * v) !== 0) continue;
      const gap = Math.abs(v - config.vpp);
      if (gap < bestGap || (gap === bestGap && v > best)) { best = v; bestGap = gap; }
    }
    return best;
  }

  /* 重计算的档位（升级计划行 19）。整页只此一处判断字符串 —— capacity / yaml /
     stepper 的 enabledWhen 都读它，别再各写各的比较。
     ⚠️ 兼容读法：老配置里这枚是布尔 recompute，true 等价于 "full"，与 shardMode
     那边同一条规矩（capacity / yaml 各自也要留一份，因为它们不引本文件的函数）。 */
  function recomputeModeOf(config) {
    if (config.recomputeMode) return config.recomputeMode;
    return config.recompute ? "full" : "none";
  }

  /* 最重的那个 stage 有多少层。derive() 里层→stage 是「尽量均分、前 (L mod PP) 段
     各多 1 层」，所以最大值就是 ceil(L/PP) —— 这里不重跑那段划分，只取它的上界。
     recomputeLayers 的动态量程读它：每个 stage 只有那么多层，再往上加一层也没有
     东西可重算，加号该在那里停住（capacity 侧同样按 min(N, 本段层数) 逐段截断）。 */
  function maxStageLayers(config) {
    const pp = Math.max(1, config.pp || 1);
    return Math.max(1, Math.ceil((config.totalLayer || 1) / pp));
  }

  /* 字段的**当前**上界。多数字段是写死的 spec.max，只有 recomputeLayers 的上界
     跟着别的字段算（见 maxOf）。加减键、手输的量程校验、走不动时的悬浮理由
     三处都必须读同一个数，否则会出现「加号还亮着但按不动」这种状态。 */
  /* 读数框的字符宽度。下限默认 3 —— 那是「还是 <span> 时」的内容自适应宽度，
     换成 input 之后照抄过来，免得一位数的读数窄成一条缝。
     但**量程本来就只有两位数的字段不该按三位留白**：Micro Batch 上界 64，
     常年显示一个 1，却比它的邻居宽出一个字符。Cluster 那一行要在一行里容下
     七枚控件，这一格是省得最干净的一处（`spec.digits`）。
     只改下限，不封上限：手输 120 时它照旧跟着位数长。 */
  function readoutSize(field, text) {
    const spec = FIELD_SPECS[field] || {};
    return Math.max(spec.digits || 3, String(text || "").length || 1);
  }

  function specMax(field, config) {
    const spec = FIELD_SPECS[field];
    return spec.maxOf && config ? Math.min(spec.max, Math.max(spec.min, spec.maxOf(config))) : spec.max;
  }

  function ranksPerNodeOf(config) {
    const card = CARD_SPECS[config.card] || CARD_SPECS[DEFAULT_CARD];
    return card.ranksPerNode || 8;
  }

  /* 节点划分。整机卡数是硬件给的，所以 Node 只是 Total Rank 除以它 —— 这是整页
     唯一一处算节点数的地方，reconcile 与 derive 都读它。
       · 不足一整机时（Qwen2 默认 8 卡以下）按实际张数算，别报出「1 节点 8 卡」
         却只有 4 张卡这种数；
       · 不是整机倍数时（只有手输能拨出来，如 dp=3 → 12 卡）**不摊薄每节点卡数**，
         而是照实说「末节点只装了 4 张」—— 摊成 6 卡/节点会把一个真实的硬件形状
         算成一个不存在的形状，rank→node 的映射也会跟着错。 */
  function nodeLayout(config) {
    const total = Math.max(1, config.totalRank || 1);
    const ranksPerNode = Math.min(ranksPerNodeOf(config), total);
    const node = Math.min(FIELD_SPECS.node.max, Math.max(1, Math.ceil(total / ranksPerNode)));
    return { ranksPerNode, node, tailRanks: total - (node - 1) * ranksPerNode };
  }

  /* ── 取值增减 ─────────────────────────────────────────────────────────── */
  /* 2 的幂梯子上的上一档 / 下一档。手输过 120 之后再点加减，应当落回 64 / 128
     这样的档位，而不是从 120 继续翻倍到 240 —— 手输是「精确指定」，加减是「回到
     常规档位」，两者的职责不同。值本来就在梯子上时与旧的 ×2 / ÷2 逐位相同。 */
  function snapPow2(value, direction) {
    if (direction > 0) {
      let next = 1;
      while (next <= value) next *= 2;
      return next;
    }
    if (value <= 1) return 1;
    let next = 1;
    while (next * 2 < value) next *= 2;
    return next;
  }

  /* max 由调用方给（默认 spec.max）：recomputeLayers 的上界是算出来的，见 specMax。 */
  function rawStep(spec, value, direction, max) {
    let next;
    if (spec.pow2) {
      next = snapPow2(value, direction);
      if (next < spec.min) next = spec.min;
    } else {
      next = value + direction * (spec.step || 1);
    }
    return Math.min(max === undefined ? spec.max : max, Math.max(spec.min, next));
  }

  /* 被模型结构硬约束挡住的档位直接跳过（当前只有 TP 除头数）：48 头的模型从
     TP=16 按 + 时 32 与 64 都除不尽，加号原地不动 —— 而不是步进过去等 reconcile
     来修，因为那条约束根本没有可修的对手字段。加减键必须始终落在自洽态上：它是
     手输报错态的第三个出口，自己不能制造报错态。
     不传 config 时退化成纯量程步进（导出给外部调用的兼容路径）。 */
  function stepValue(field, value, direction, config) {
    const spec = FIELD_SPECS[field];
    const max = specMax(field, config);
    /* 不可用的字段（未开 LoRA 的 Rank、非「按层数」档的重算层数）加减键原地不动：
       控件此刻是灰的，让它还能走会拨出一个既看不出效果、又没人解释的数。 */
    if (config && spec.enabledWhen && !spec.enabledWhen(config)) return value;
    let next = rawStep(spec, value, direction, max);
    if (!config) return next;
    for (let guard = 0; guard < 64 && !structurallyAllowed(field, next, config); guard += 1) {
      const after = rawStep(spec, next, direction, max);
      if (after === next) return value;          // 撞到量程端点仍非法：原地不动
      next = after;
    }
    return structurallyAllowed(field, next, config) ? next : value;
  }

  /* 加减键走不动时，悬浮要答出「为什么」。置灰而不给理由是最容易被读成页面卡了
     的一种状态 —— 尤其 TP 这一头：它到顶的原因不在这一行表单里，而在模型的头数上，
     用户盯着 stepper 是看不出来的。三档理由：撞量程、撞模型结构、兜底。 */
  function stepBlockReason(field, direction, config) {
    const spec = FIELD_SPECS[field];
    const value = config[field];
    const up = direction > 0;
    /* 不可用的字段（未开 LoRA 的 Rank、非「按层数」档的重算层数）：此刻用户想知道的
       不是量程，而是「这枚为什么是灰的」，理由由 FLAG 那边同名的一栏给。 */
    if (spec.enabledWhen && !spec.enabledWhen(config)) return spec.disabledReason;
    const max = specMax(field, config);
    if (up && value >= max) {
      /* 算出来的上界要连**它是怎么算出来的**一起说 —— 一个写死的数说「已到上界」就够了，
         一个跟着 Total Layer / PP 变的数不说来路，就成了「按不动，也不知道去哪儿改」。 */
      return spec.maxReason ? spec.maxReason(config) : `${spec.label} 已到量程上界 ${max}`;
    }
    if (!up && value <= spec.min) return `${spec.label} 已到量程下界 ${spec.min}`;
    if (field === "tp") {
      const preset = presetOf(config);
      /* 挡住它的可能不止头数 —— dense / MoE 的 intermediate 也要被整除，逐个列出来，
         否则用户对着 48 头想不通「16 之后为什么没有 32」（真正卡住的是那个公约数 16）。 */
      const divisors = [`注意力头 ${preset.heads}`];
      if (preset.denseIntermediate) divisors.push(`Dense intermediate ${preset.denseIntermediate}`);
      if (!preset.noMoe && preset.moeIntermediate) divisors.push(`MoE intermediate ${preset.moeIntermediate}`);
      /* Ulysses 档下 CP 也在切同一批头，此时这一头卡住未必怪模型 —— 尾句要跟着换：
         头数确实改不了，但 CP 是可调的，得把这条出路说出来。 */
      const tail = cpIsUlysses(config) && config.cp > 1
        ? `。Ulysses 档下 CP ${config.cp} 也在切同一批头（TP × CP 必须整除 ${preset.heads}）`
          + ` —— 头数是模型常量改不了，但 CP 可以：把它调小就给 TP 腾出了档位`
        : `。这几个数都是模型结构常量、不是可调字段，所以这一头没有可用的档位了`;
      return `TP 必须同时整除 ${divisors.join(" / ")}（公约数 ${tpShardBasis(config)}），`
        + `${up ? "往上" : "往下"}的 ${skippedSteps(spec, value, direction).join(" / ")} 都除不尽`
        + tail;
    }
    /* CP 走不动只可能是 Ulysses 档（Ring 那条有 seqLen 这个对手字段，加减键照常
       步过去、由 reconcile 抬序列长度，不会停在这里）。 */
    if (field === "cp" && cpIsUlysses(config)) {
      const preset = presetOf(config);
      return `Ulysses 沿头维做 all-to-all，TP × CP 必须整除注意力头 ${preset.heads}：`
        + `TP ${config.tp} 已经占走一轮，CP 只能取 ${ulyssesCpBasis(config)} 的因子，`
        + `${up ? "往上" : "往下"}的 ${skippedSteps(spec, value, direction).join(" / ")} 都除不尽。`
        + `把 TP 调小能给 CP 腾出档位；序列长到头数不够切时改用 Ring 档 —— 它不看头数`;
    }
    if (field === "vpp" && config.pp <= 1) {
      return `PP = 1 时没有流水线，虚拟流水无从交错（VPP 是把每个 stage 的层再拆成`
        + ` VPP 段轮流跑）—— 把 PP 调大之后 VPP 才有档位`;
    }
    return `${spec.label} 这一头没有可用的档位`;
  }

  /* 被跳过的那几档，逐个报出来给悬浮理由用。能走到这里就说明从当前值到量程端点
     之间的档位全都非法，所以这一串直接沿梯子取即可，不必再逐个验一遍。 */
  function skippedSteps(spec, value, direction, limit = 4) {
    const out = [];
    let v = rawStep(spec, value, direction);
    while (out.length < limit) {
      out.push(v);
      const after = rawStep(spec, v, direction);
      if (after === v) break;
      v = after;
    }
    return out;
  }

  /* ── EP 口径（升级计划行 23：从二档升成三档）─────────────────────────────
     同一批卡，三种记法。差别只在两件事：**EP 进不进 world 的乘积**，以及
     **EP 是从哪个域里切出来的**（这决定 EDP，也就是集群矩阵的行数）。

       split（切出，默认）—— Megatron / MindSpeed-LLM 的做法
         EP 从 DP 组内再切一刀，不进乘积：world = DP×PP×TP×CP
         约束 DP % EP == 0，EDP = DP/EP

       orthogonal（正交）—— 论文与部分自研框架的记法
         EP 独占自己的 rank：world = DP×PP×TP×CP×EP
         DP 与 EP 之间无整除关系，EDP = DP

       mf（MindFormers · DP×MP 域）—— 行 23 新增
         MindFormers 的 expert_parallel 是在 **dp × mp 域**上切的：一个 EP 组的
         成员既跨数据并行、也跨张量并行。所以它同样不进乘积（world = DP×PP×TP×CP），
         但约束换成 **(DP × TP) % EP == 0**，EDP = DP×TP/EP。

     为什么非要有第三档：`mf_pretrain_deepseek3_671b.yaml` 写的是
     dp:4 / mp:8 / pp:8 / ep:32 —— 前两档**都接不住**。切出档 4 % 32 ≠ 0 当场红；
     正交档 world = 4×8×8×32 = 8192，而那份配置实际是 256 卡。而在 dp×mp 域上
     4×8 = 32，整除成立。README 说这份「最贴页面口径」，结果它是唯一一份**必然报错**的。
     行 1 的附录里那句「严格些是 DP × TP % (EP × ETP) == 0」正是这一档，
     当时记下了却没落成规则。

     ⚠️ **ETP（专家张量并行）本页取 1，没有建模**。真实 MindFormers 里专家自身还能
     再切 TP，那时约束是 (DP×TP) % (EP×ETP) == 0，且专家权重要再 ÷ETP。
     本档按 ETP=1 建模：**专家只 ÷EP，不再另 ÷TP** —— 因为 EP 已经吃掉了 mp 那一维
     （见 capacity 的 paramsOfStage）。这是三档里唯一一处专家分母与另两档不同的地方，
     不写出来就会变成一个静默偏差。

     ── 兼容读法 ──────────────────────────────────────────────────────────
     老配置里这枚是布尔 moeOrthogonal（true = 正交）。折算只写在 epModeOf 这一处，
     与 shardMode / recomputeMode 同一条规矩：下游一律读 epModeOf(config)，
     别再各自 `config.moeOrthogonal ? …` 一遍。 */
  const EP_MODES = ["split", "orthogonal", "mf"];

  function epModeOf(config) {
    const mode = config && config.epMode;
    if (EP_MODES.indexOf(mode) >= 0) return mode;
    return config && config.moeOrthogonal ? "orthogonal" : "split";
  }

  const epIsOrthogonal = (config) => epModeOf(config) === "orthogonal";
  const epIsMf = (config) => epModeOf(config) === "mf";

  /* EP 从哪个域里切出来（正交档没有「切出」这回事，返回 dp 只是为了让
     gcd 那几处不必分支 —— 正交档的 epBasis 本来就只看专家数）。 */
  function epDomainOf(config) {
    if (epIsMf(config)) return Math.max(1, config.dp) * Math.max(1, config.tp);
    return Math.max(1, config.dp);
  }

  /* 正交档 EP 独占 rank，进 world 的乘积；另两档 EP 是从已有的卡里再切一刀，
     不进乘积。整页只此一处判断，validate / reconcile / derive / yaml 都走它。 */
  function epInWorld(config) {
    return epIsOrthogonal(config) ? config.ep : 1;
  }

  /* d 轴（集群矩阵那一行、rank 编址的 dpIdx）的组数：
       正交  EDP = DP（EP 是另一根轴）
       切出  EDP = DP/EP
       mf    EDP = DP×TP/EP —— 域大了 TP 倍，行数跟着变，这正是行 23 说的
             「集群矩阵的 d 轴长度按新 EDP 重算」。
     整除性由 validate 拦、reconcile 修，除不尽的配置到不了这里；floor 只是
     防御性的兜底，保证万一漏过去几何仍是整数格。 */
  function expertDataParallel(config) {
    if (epIsOrthogonal(config)) return config.dp;
    return Math.max(1, Math.floor(epDomainOf(config) / Math.max(1, config.ep)));
  }

  /* 一份**非专家**权重（已被 TP 切过）在数据并行域里复制了多少份 —— ZeRO / FSDP2
     的分母就是它。三档各不相同，而 capacity 只该读一个数：
       切出  dp          （EDP×EP = DP，与改动前逐位相同）
       正交  dp×ep       （每个 DP 副本横跨全部 EP rank，同上）
       mf    dp          ← EDP×EP = DP×TP 会把 TP 那一维重复算进来，必须单给
     专家那一段的分母是 EDP（三档同形），见 capacity 的 dpShards。 */
  function dpReplicaOf(config) {
    if (epIsOrthogonal(config)) return Math.max(1, config.dp) * Math.max(1, config.ep);
    return Math.max(1, config.dp);
  }

  /* d 轴对人显示的名字。切出档下集群矩阵的每一行是 EDP 而不是 DP —— 表单里
     写着 DP 512、矩阵左侧却标 DP0–7，是两个不同的量重名，必须分开叫。
     EP=1（稠密模型）时 EDP ≡ DP，仍叫 DP，不给没有专家的模型平添一个新词。
     凡是要把 dpIdx 写给人看的地方都走这个函数，别再各写各的。 */
  function dAxisName(counts) {
    return counts.epMode !== "orthogonal" && counts.ep > 1 ? "EDP" : "DP";
  }

  /* rank 的坐标一行文案：关系卡片、计算血缘、事件详情三处共用一份 */
  function coordLine(topology, co) {
    const d = dAxisName(topology.counts);
    return `global rank ${co.rank} · PP${co.stage} / ${d}${co.dpIdx} / EP${co.epIdx}`
      + ` / TP${co.tpIdx} / CP${co.cpIdx} · Node ${co.node}`;
  }

  /* 两种口径下 config.dp 记的不是同一个量，切换口径时按 EP 换算，使 Total Rank
     不变（参考配置的 8 与 512 就是同一份卡的两种读法）。 */
  function convertDpAcrossEpMode(dp, ep, toOrthogonal) {
    const factor = Math.max(1, ep);
    const next = toOrthogonal ? Math.floor(dp / factor) : dp * factor;
    return Math.min(FIELD_SPECS.dp.max, Math.max(FIELD_SPECS.dp.min, next || 1));
  }

  /* Node 只读读数要说清「这个数是怎么来的」—— 它从一枚能拨的 stepper 变成了一个
     不能拨的数，不给来路就只是少了两个按钮。 */
  function nodeSummary(config) {
    const { ranksPerNode, node, tailRanks } = nodeLayout(config);
    const card = CARD_SPECS[config.card] || CARD_SPECS[DEFAULT_CARD];
    const perMachine = ranksPerNodeOf(config);
    const head = `${card.label} 整机 ${perMachine} 卡（硬件事实，不可调）`;
    let detail;
    if (config.totalRank < perMachine) {
      detail = `Total Rank ${config.totalRank} 不足一整机 → 1 节点，只用其中 ${config.totalRank} 张`;
    } else if (tailRanks !== ranksPerNode) {
      detail = `Total Rank ${config.totalRank} ÷ ${ranksPerNode} = ${node} 节点，末节点只装了 ${tailRanks} 张`;
    } else {
      detail = `Total Rank ${config.totalRank} ÷ ${ranksPerNode} = ${node} 节点`;
    }
    return { node, text: String(node), title: `${head}；${detail}` };
  }

  /* ── 另两枚派生读数的口径（见 DERIVED_SPECS）─────────────────────────────
     与 nodeSummary 同一副形状（{ text, title }）、同一条判据（不是输入）。
     两枚都在 Cluster 那一行上，各答一个原先只有 YAML 视图答得出的问题。 */

  /* Hidden：[B, S, H] 的 H。模型预设里的结构常量，**换模型才会变** —— 所以它没有
     加减键不是「暂时没做」，而是这一页压根不该让人拨它（拨了就不是这个模型了）。 */
  function hiddenSummary(config) {
    const preset = presetOf(config);
    const tp = Math.max(1, config.tp || 1);
    return {
      text: String(preset.hidden),
      title: "Hidden Size · [B, S, H] 的 H（" + preset.label + " = " + preset.hidden + "）\n\n"
        + "一个 token 的向量宽度。它和层数一起决定模型多大，但**不是这一页能拨的量**："
        + "它是模型预设里的结构常量，换模型才会变（YAML 的 model_config.hidden_size 照抄它）。\n\n"
        + "── 它怎么进显存 ──\n"
        + "权重 ∝ H²（每层几个 H×H 的投影矩阵），激活 ∝ B×S×H。所以同样是翻一倍，"
        + "H 抬的是权重那一段（平方），Seq Length 抬的是激活那一段（线性）。\n\n"
        + "── 单卡上其实是 H/TP ──\n"
        + (tp > 1
          ? "TP 沿 H 切开权重与激活，当前 TP=" + tp + " → 每卡这一维实际是 "
            + (preset.hidden / tp) + "。"
          : "TP 沿 H 切开权重与激活；当前 TP=1，每卡背的就是整个 " + preset.hidden + "。"),
    };
  }

  /* 全局 Batch：三个可调量乘出来的那个数。与 yaml 的 runner_config.batch_size
     同源同式（见 config-relation-yaml.js 那一行的长注释）—— dp 取 config 里那个数，
     与 counts.dp 逐位相同，两处的数字必须对得上。 */
  function globalBatchSummary(config) {
    const mbs = Math.max(1, config.microBatch || 1);
    const dp = Math.max(1, config.dp || 1);
    const num = Math.max(1, config.microBatchNum || 1);
    const total = mbs * dp * num;
    /* 单位一定要写出来：格子里只有一个光秃秃的 12288，不说清楚就会被读成 token 数
       （相差一个 Seq Length，量级差了三个数量级）。所以浮层里既给「条」这个单位，
       也给换算到 token 的那一步 —— 后者才是大家嘴里的「一步过多少 token」。 */
    const seq = Math.max(1, config.seqLen || 1);
    const tokens = total * seq;
    return {
      text: String(total),
      title: "Global Batch · global batch size（一次参数更新吃掉多少**条**样本）\n\n"
        + "= Micro Batch " + mbs + " × DP " + dp + " × micro_batch_num " + num + " = " + total + " 条\n"
        + "三个因子分散在三处：Micro Batch 就在右边，DP 在 Model Architecture 那一行，"
        + "micro_batch_num 收在这一行末尾的「高级选项」里。"
        + "它是**派生量**，没有加减键：要改就动那三个数之一。\n\n"
        + "── 单位是「条」，不是 token ──\n"
        + "一条样本 = 一条长 Seq Length 的序列，也就是 [B, S, H] 里 B 数的那个东西。"
        + "所以 " + total + " 读作 **" + total + " 条序列**，不是 " + total + " 个 token、"
        + "也不是 " + total + " 个 step。换算到 token：\n"
        + total + " 条 × Seq Length " + seq + " = **" + tokens.toLocaleString("en-US") + " token**"
        + "（一次参数更新真正过的 token 量；训练日志里的「多少 B token」按这个数累计）。\n\n"
        + "── 表单上那枚 Micro Batch 不是它 ──\n"
        + "MBS 是每卡每次前反向真正喂进去的条数；这个数是全集群一步的总量（同一个单位，"
        + "差在「每卡每次」与「全集群一步」）。"
        + "YAML 的 runner_config.batch_size 填的是**这个**（full_batch: True 的口径 —— "
        + "每张卡都取全局 batch 的数据量，再在图内按 dp 切）。\n\n"
        + "── 它几乎不进显存 ──\n"
        + "直接压激活的只有 MBS；micro_batch_num 只在 < PP 时把在飞份数夹小；DP 越大每卡反而越省"
        + "（权重相关的段切得更碎）。所以它管的不是容量柱，是收敛："
        + "太小噪声大、太大收敛质量下降，而它一旦定死，MBS 与 micro_batch_num 就只能互相换。",
    };
  }

  /* ── 校验：返回 [] 表示配置自洽 ───────────────────────────────────────── */
  function validate(config) {
    const errors = [];
    const { totalLayer, dp, pp, vpp, tp, cp, seqLen, routedExpert, topK, ep, totalRank, node } = config;

    if (totalLayer < pp) {
      errors.push(`层数 ${totalLayer} 少于 PP ${pp}，至少每个 stage 要有 1 层`);
    }
    /* TP 切的是注意力头，切不整就非法。文案里必须出现 "TP" 且**只**出现 TP ——
       emit() 按 FIELD_SPECS.label 子串匹配标红 stepper，而这条错误的对手字段
       （头数）是模型常量、不是 stepper，红圈只该落在 TP 这一枚上。 */
    const preset = presetOf(config);
    if (preset.heads && preset.heads % tp !== 0) {
      errors.push(`注意力头 ${preset.heads} 不能被 TP ${tp} 整除，每张卡分不到整数个头`);
    }
    /* FFN 沿 intermediate 维切分，与头数是同一类约束（对手是模型常量，配不了平）。
       MoE 那条把「MoE 区」写进文案：stepper 的红圈只会落在 Model Architecture 的
       TP 上，而该去看的是 MoE 区那个 1024，两边对不上时全靠这句话把人引过去。 */
    if (preset.denseIntermediate && preset.denseIntermediate % tp !== 0) {
      errors.push(`Dense FFN 的 intermediate ${preset.denseIntermediate} 不能被 TP ${tp} 整除`);
    }
    if (!preset.noMoe && preset.moeIntermediate && preset.moeIntermediate % tp !== 0) {
      errors.push(`MoE 区专家的 intermediate ${preset.moeIntermediate} 不能被 TP ${tp} 整除`);
    }
    /* CP 的硬约束**跟着口径走**（升级计划行 16）—— 两档拦的根本不是同一个字段：
         Ulysses  沿头维 all-to-all，而 TP 已切过一轮头 → TP×CP 必须整除 num_heads
         Ring     沿序列维轮转 KV，与头数无关 → seq 必须被 2×CP 整除
       改前全页只有 Ring 那一条，等于对 Ulysses 场景画了一条**错误的红线**。
       两条都只在 CP > 1 时生效：CP=1 时 Ulysses 那条退化成「头数被 TP 整除」（上面
       已有一条），Ring 那条退化成「序列长度必须是偶数」这样一条与 CP 无关的约束，
       还会连累 CP 的 stepper 被标红。
       ⚠️ 括注里不能出现 "Seq Length" 四个字：emit() 按 label 子串匹配标红 stepper，
       Ulysses 档下序列长度是无辜的，写全称会把它一起圈红。 */
    if (cp > 1) {
      if (cpIsUlysses(config)) {
        if (preset.heads && preset.heads % (tp * cp) !== 0) {
          errors.push(`Ulysses 口径下 CP 也沿头维切：注意力头 ${preset.heads} 不能被 `
            + `TP ${tp} × CP ${cp} = ${tp * cp} 整除`
            + `（Ring 口径不看头数，那一档的约束换成序列长度被 2×CP 整除）`);
        }
      } else if (seqLen % (2 * cp) !== 0) {
        errors.push(`Seq Length ${seqLen} 不能被 2×CP ${2 * cp} 整除，ring attention 无法把序列对半交叉切给 CP 组`);
      }
    }
    /* 虚拟流水（升级计划行 17）。交错式 1F1B 要求每个 chunk 层数相等，比 PP 严格 ——
       本页的 stage 允许不均分（46/4 → 12,12,11,11），VPP 不允许。
       ⚠️ 文案里出现 "VPP" 就一定会同时标红 PP（emit() 按 label 子串匹配，而 "PP"
       是 "VPP" 的子串）。这里**不做消歧**：这两条错本来就是 PP 与 VPP 共同造成的
       （层数要被两者的乘积整除），两枚一起红正是想要的结果。 */
    if (vpp > 1) {
      if (pp <= 1) {
        errors.push(`PP ${pp} 时没有流水线可交错，VPP ${vpp} 无处落地`
          + ` —— 虚拟流水是把每个 stage 的层再拆成 VPP 段轮流跑`);
      } else if (totalLayer % (pp * vpp) !== 0) {
        errors.push(`层数 ${totalLayer} 不能被 PP ${pp} × VPP ${vpp} = ${pp * vpp} 整除`
          + `，交错式流水要求每一段层数相等（PP 允许不均分，VPP 不允许）`);
      }
    }
    if (routedExpert % ep !== 0) {
      errors.push(`路由专家 ${routedExpert} 不能被 EP ${ep} 整除，专家无法均分到 EP rank`);
    }
    /* 切出档：EDP = DP/EP 必须是整数。这条的业务口径要说准 —— 切出档下**一个 DP
       副本本来就不持有一整套专家**（它自己只有 PP×TP×CP 张卡），持有一整套的是
       集群矩阵上的**一整行、一个 EP 组**：横着的 EP 张卡合起来才凑齐全部专家，
       all-to-all 也正是在这个域里收发 token。DP 除不尽 EP，末尾就剩下不足一组的卡，
       router 打过去的 token 在域里找不到对端；页面上还会直接穿帮成
       「矩阵格子数多于 Total Rank」。
       EDP 是这样的完整组**共有几个**（= 专家权重的副本份数），不是那一行的名字。
       正交档不受这条管：那里 EP 是 DP 之外独占 rank 的一根正交轴，**每个 DP 副本
       自带一套完整专家**（它横跨全部 EP rank），所以 DP 与 EP 之间无须整除。
       文案里 DP 与 EP 两个 label 都要出现 —— emit() 按 label 子串匹配标红
       stepper，这条错是两个字段共同造成的，两个都该红。 */
    /* 行 23：切出档看 DP，mf 档看 DP×MP 域 —— 同一条「凑得齐一个完整 EP 组」，
       只是域不同。正交档仍不受这条管。 */
    if (!epIsOrthogonal(config) && epDomainOf(config) % ep !== 0) {
      const domain = epDomainOf(config);
      errors.push(epIsMf(config)
        ? `DP ${dp} × TP ${tp} = ${domain} 不能被 EP ${ep} 整除`
          + `（MindFormers 档的专家并行在 DP×MP 域上切，EDP = DP×TP ÷ EP 必须是整数），`
          + `末尾剩下的 ${domain % ep} 张卡凑不齐一个完整的 EP 组`
        : `DP ${dp} 不能被 EP ${ep} 整除（EDP = DP ÷ EP 必须是整数），`
          + `末尾剩下的 ${domain % ep} 张卡凑不齐一个完整的 EP 组 —— 一套专家要 ${ep} 张卡合持`);
    }
    if (topK > routedExpert) {
      errors.push(`Top-K ${topK} 超过路由专家总数 ${routedExpert}`);
    }
    const world = dp * pp * tp * cp * epInWorld(config);
    if (world !== totalRank) {
      /* 公式文案跟着口径换：切出档 EP 不占 rank，写进乘积会读成"少算了一维"。
         括注里写「专家并行」而不是「EP」—— emit() 是按 FIELD_SPECS 的 label 在
         错误文案里做子串匹配来标红 stepper 的，出现 "EP" 会把无辜的 EP 也标红。 */
      const expr = epIsOrthogonal(config)
        ? `DP${dp}×PP${pp}×TP${tp}×CP${cp}×EP${ep}`
        : `DP${dp}×PP${pp}×TP${tp}×CP${cp}（专家并行从${epIsMf(config) ? " DP×MP 域" : " DP"}内切出，不进乘积）`;
      errors.push(`${expr} = ${world}，与 Total Rank ${totalRank} 不符`);
    }
    /* Total Rank 是并行度的乘积，本身没有 stepper 之外的输入口，但**手输一个非
       2 的幂的并行度**能把乘积顶到量程之外（TP 手输 48 → 512×4×48 = 98304），
       而 fitParallelWorld 只在 2 的幂梯子上找解，此时收不回来。不拦的话它会一路
       穿到 Node 上：8192 个节点 × 8 卡装不下 98304 张，rank→node 直接算越界。
       所以这里补一条量程校验 —— 它同时让 proposeFix 拒绝那份建议（横幅退化成
       只有「取消修改」），而不是给出一个应用了就把矩阵画错的修法。 */
    if (totalRank > FIELD_SPECS.totalRank.max) {
      errors.push(`Total Rank ${totalRank} 超出本页上限 ${FIELD_SPECS.totalRank.max}`
        + `，并行度乘积在 2 的幂档位上收不回来`);
    }
    return errors;
  }

  /* ── 软警告：能跑，但跑得不好 ─────────────────────────────────────────────
     与 validate 的根本区别是**不拦截**：不标红、不冻结图形、不进建议修法。
     判据放在同一层而不是视图里，是因为它和 errors 读的是同一份配置，散开就会
     像 capacity / yaml 那样各自养一套假设。 */
  /* ⚠️ **启发式阈值，待实测标定**：Cube 是 16×16 的，GEMM 的 N 维低到几十时，
     搬运与尾块开销压过计算。标定方法与 RUNTIME 那几个系数同类 —— 固定其它维、
     只扫 TP 跑几轮，看 MoE 那几个算子的 aic_mte2_ratio 从哪一档开始抬头。
     拿到实测值后只改这一个常量。 */
  const MOE_SHARD_MIN = 256;

  function warn(config) {
    const warnings = [];
    const preset = presetOf(config);
    const perNode = ranksPerNodeOf(config);
    if (config.tp > perNode) {
      warnings.push(`TP ${config.tp} 超过单节点 ${perNode} 卡，张量并行组被迫跨节点`
        + ` —— 每层前反向各一次 all-reduce 都要走机间链路，且在关键路径上无法与计算重叠`);
    }
    /* 除得尽不等于切得动：1024 的 intermediate 被 TP16 切成每卡 64，GroupedMatMul
       的 N 维只剩 64 —— 这正是升级计划行 8 说的「切碎」。它是性能问题不是功能
       问题，所以在这里而不在 validate 里（除不尽的那一半仍是硬错误）。 */
    if (!preset.noMoe && preset.moeIntermediate
      && preset.moeIntermediate % config.tp === 0
      && preset.moeIntermediate / config.tp < MOE_SHARD_MIN) {
      warnings.push(`MoE 专家的 intermediate ${preset.moeIntermediate} 被 TP ${config.tp}`
        + ` 切成每卡 ${preset.moeIntermediate / config.tp}（< ${MOE_SHARD_MIN}）`
        + `，GroupedMatMul 的 N 维太窄，矩阵乘掉出高效区间`);
    }
    /* GQA：分头的卡数超过 KV 头数时，Megatron 是**复制 KV** 而不是报错，功能上合法，
       只是每张卡都背一份完整 KV、通信与显存都变差 —— 与上面那条同属「性能悬崖
       而非功能错误」，所以放这里而不是 validate。heads 那条仍是硬错误。
       判据读 headConsumers 而不是 config.tp：行 16 之后 Ulysses 档的 CP 也在分同一批
       头，只看 TP 会漏掉「TP 2 × CP 4 = 8 份，而 KV 只有 4 个头」这种。
       ⚠️ 判据改对了，但在**当前两个预设上仍然不可达**（行 16 的验证跑出来的）：
       Qwen2 的 TP 被 gcd(28, 18944) = 4 顶死，Ulysses 档下 TP×CP 又必须整除 28，
       2 的幂梯子上能凑出的只有 1 / 2 / 4 —— 全都整除 KV 头数 4。
       留着仍不是为了现在：换一个 heads 与 kvHeads 比值更大的 GQA 模型进来它就活了，
       而那时若判据只看 TP，Ulysses 档就会漏报。 */
    const headSplit = headConsumers(config);
    if (preset.kvHeads && preset.heads % headSplit === 0 && preset.kvHeads % headSplit !== 0) {
      const who = cpIsUlysses(config) && config.cp > 1
        ? `TP ${config.tp} × CP ${config.cp} = ${headSplit} 份` : `TP ${config.tp}`;
      warnings.push(`KV 头 ${preset.kvHeads} 不能被 ${who} 整除，KV 会在组内复制`
        + ` —— 本页的显存与 yaml 均按不复制估算，超过 ${preset.kvHeads} 份时偏乐观`);
    }
    /* Ulysses 的 all-to-all 与 TP 的 all-reduce 争的是同一批头、也争同一条链路，
       两者的组内卡数是乘起来的 —— TP 单独没超节点、乘上 CP 就超了，是这一档特有的
       坑。与行 7 那条 TP 跨节点同属选型提示，不拦截。
       Ring 档没有这条：它的 KV 轮转是点对点、可与计算重叠，跨机代价小得多。 */
    if (cpIsUlysses(config) && config.cp > 1 && config.tp * config.cp > perNode) {
      warnings.push(`Ulysses 档下 CP 与 TP 切的是同一批头，两者合起来 TP ${config.tp}`
        + ` × CP ${config.cp} = ${config.tp * config.cp} 卡，超过单节点 ${perNode} 卡`
        + ` —— 头维的 all-to-all 被迫跨节点，且和 TP 的 all-reduce 一样在关键路径上；`
        + `序列长到非切不可时，Ring 档的 KV 轮转是点对点、可与计算重叠，更扛跨机`);
    }
    /* FSDP2 与张量 / 流水 / 序列并行同用：功能上合法（HSDP + TP 是有人在跑的），
       但它是两条路线的混用：FSDP 已经沿 DP 把整个模型切开了，再叠一层模型切分，
       调参成本又回来了 —— 走 FSDP 路线的配方通常是纯 DP，一个切分维都不开
       （这也是本仓 pic/README 那张特性矩阵里，勾 FSDP2 的模型 TP/PP/CP 全为空的原因）。
       软警告而不是硬拦，理由与行 7 的 TP 跨节点同构：是选型提示不是配置错误。 */
    if (config.shardMode === "fsdp2") {
      const others = [
        config.tp > 1 ? `TP ${config.tp}` : null,
        config.pp > 1 ? `PP ${config.pp}` : null,
        config.cp > 1 ? `CP ${config.cp}` : null,
      ].filter(Boolean);
      if (others.length) {
        warnings.push(`FSDP2 与 ${others.join(" / ")} 同用 —— FSDP2 已经沿数据并行维把权重`
          + `、梯度、优化器状态全切开了，再叠一层模型切分属于两条路线混用；`
          + `FSDP 路线的常见配方是纯 DP，一个模型切分维都不开。本页照配置如实估算，不拦截`);
      }
    }
    /* 微批数少于流水线深度（升级计划行 22）：warmup 段还没灌满就要开始反向，
       整条流水线一直有一半的 stage 闲着。气泡占比约 (PP−1)/微批数（交错档再
       ÷VPP），PP=4、微批数=2 时已经超过 100% —— 空转的时间比算的还长。
       能跑，只是跑得不好，与行 7 的 TP 跨节点同属选型提示，不拦截。
       容量那边照实按 min(公式, 微批数) 把在飞份数夹小（柱子会矮一截），
       所以这条警告要连「省下的那点显存是拿吞吐换的」一起说。 */
    if (config.pp > 1) {
      const need = config.pp * Math.max(1, config.vpp || 1);
      const num = Math.max(1, config.microBatchNum || 1);
      if (num < need) {
        const bubble = Math.round((config.pp - 1) / (num * Math.max(1, config.vpp || 1)) * 100);
        warnings.push(`micro_batch_num ${num} 少于流水线深度 ${config.pp === need ? `PP ${config.pp}`
          : `PP ${config.pp} × VPP ${config.vpp} = ${need}`}`
          + `，warmup 段灌不满，气泡占比约 ${bubble}%`
          + ` —— 在飞份数被它夹到 ${num} 份，容量柱因此矮一截，但那点显存是拿吞吐换的`);
      }
    }
    return warnings;
  }

  /* ── 自动配平：保留用户刚调整的字段，只改满足约束所需的最少依赖项 ─────── */
  /* 展开写而不是对字段表求积：EP 是否进乘积由口径决定，一个 reduce 表达不了。 */
  function parallelWorld(config) {
    return config.dp * config.pp * config.tp * config.cp * epInWorld(config);
  }

  function isAllowedParallelValue(field, value, config) {
    const spec = FIELD_SPECS[field];
    if (!Number.isInteger(value) || value < spec.min || value > spec.max) return false;
    if (spec.pow2 && (value & (value - 1)) !== 0) return false;
    if (field === "pp" && value > config.totalLayer) return false;
    /* 结构与序列的整除约束也要挡在这里 —— 不挡的话拖 Total Rank 时
       fitParallelWorld 会自己配平出一个当场报错的 TP / CP（DP 踩过一次）。 */
    if (field === "tp" && !structurallyAllowed("tp", value, config)) return false;
    /* CP 的合法邻域也跟着口径走：Ulysses 那半由 structurallyAllowed 判（TP×CP 整除
       头数），Ring 那半判序列。少了任一半，拖 Total Rank 时 fitParallelWorld 都会
       自己配平出一个当场报错的 CP —— 行 2 的 DP 已经踩过一次同样的坑。 */
    if (field === "cp" && !structurallyAllowed("cp", value, config)) return false;
    if (field === "cp" && !cpIsUlysses(config) && value > 1 && config.seqLen % (2 * value) !== 0) return false;
    if (field === "ep" && config.routedExpert % value !== 0) return false;
    /* 切出档下 DP 必须是 EP 的整数倍（见 validate 的 EDP 整除）。不挡在这里，
       拖 Total Rank 时 fitParallelWorld 会自己配平出一个当场报错的 DP。
       EP 不需要对称的一条：切出档下它已被 fitParallelWorld 的候选列表摘掉。 */
    /* 行 23：mf 档的域是 DP×TP，所以判据里要带上 TP。 */
    if (field === "dp" && !epIsOrthogonal(config)
      && (value * (epIsMf(config) ? config.tp : 1)) % config.ep !== 0) return false;
    /* mf 档下 TP 也在域里：改 TP 会改变 (DP×TP) % EP —— 切出档没有这条。 */
    if (field === "tp" && epIsMf(config) && (config.dp * value) % config.ep !== 0) return false;
    return true;
  }

  /* 切出档下 DP 被「EDP 整除」钉住了下限（DP ≥ EP），当 pp/tp/cp 都已降到 1、
     dp 又正好等于 ep 时，一轮配平会无维可动 —— Total Rank 拖不下去，页面卡在
     一条红字上，而用户看不出该去动哪个 stepper。此时唯一正确的联动是 EP 跟着
     DP 一起降一档：切出档 EP 不进 world，降它不改变乘积，只是把 DP 的下限放开，
     再补一轮就收敛了。ep 每轮严格减半，必然终止。
     只在「DP 确实被 EP 顶住」（dp ≤ ep）且目标在下方时才降 EP —— 别的原因导致的
     不收敛（比如目标本就超出字段量程）降 EP 也没用，白白打乱 MoE 分组。
     anchor === "ep" 时不降：那是用户刚拨的那一枚，配平不该把它拨回去。 */
  function fitParallelWorld(config, target, anchor) {
    fitParallelWorldOnce(config, target, anchor);
    while (!epIsOrthogonal(config) && anchor !== "ep" && config.ep > 1
      && parallelWorld(config) > target && epDomainOf(config) <= config.ep) {
      config.ep = Math.floor(config.ep / 2);
      fitParallelWorldOnce(config, target, anchor);
    }
  }

  function fitParallelWorldOnce(config, target, anchor) {
    /* 切出档下 EP 不进 world，改它一分钱也补不上差额，必须从候选里摘掉，
       否则第一轮就会把 EP 调成一个既不解决问题又打乱 MoE 分组的值。
       候选序（升级计划行 14）：EP 排在 tp / cp 之后而不是紧跟 DP —— 它是牵连最广
       的一维（同时动 MoE 分组、集群矩阵的列数、容量栏的专家段），先动它画面跳得
       最厉害。只有正交档看得见这条改动：切出档 EP 压根不在候选里。 */
    const candidates = ["dp", "tp", "cp", "ep", "pp"]
      .filter((field) => field !== anchor && (field !== "ep" || epIsOrthogonal(config)));

    // 常见的 Rank ±2 倍只需改一个并行维度；优先 DP，避免扰动模型切分。
    for (const field of candidates) {
      const otherProduct = parallelWorld(config) / config[field];
      const value = target / otherProduct;
      if (isAllowedParallelValue(field, value, config)) {
        config[field] = value;
        return;
      }
    }

    // 单字段无法容纳时，再按优先级逐级配平；所有 stepper 都是 2 的幂，
    // 因而在字段范围允许时可精确收敛到目标值。
    let world = parallelWorld(config);
    const direction = target > world ? 2 : 0.5;
    while (world !== target) {
      const field = candidates.find((name) => {
        const next = config[name] * direction;
        return isAllowedParallelValue(name, next, config)
          && (direction > 1 ? world * direction <= target : world * direction >= target);
      });
      if (!field) break;
      config[field] *= direction;
      world = parallelWorld(config);
    }
  }

  function reconcile(config, anchor) {
    // 模型结构约束：锚点不回退，调整与它直接相依的字段。
    if (config.totalLayer < config.pp) {
      if (anchor === "totalLayer") {
        while (config.pp > config.totalLayer) config.pp = Math.max(1, Math.floor(config.pp / 2));
      } else {
        config.totalLayer = config.pp;
      }
    }

    /* TP 除不尽头数：对手字段是模型常量，改不了，只能把 TP 自己收到最近的合法
       因子。anchor === "tp" 时不收 —— 那是用户刚指定的值，收了等于没听他的；
       加减键已在 stepValue 里跳过了非法档位，能走到这里的只有手输，它该停在报错
       态由横幅给出口（这一条给不出建议修法，横幅退化成只有「取消修改」）。 */
    const shardBasis = tpShardBasis(config);
    if (anchor !== "tp" && shardBasis % config.tp !== 0) {
      config.tp = nearestDivisor(shardBasis, config.tp, FIELD_SPECS.tp);
    }

    /* CP 的整除约束按口径分两条（升级计划行 16）。两条同形 —— 都是「两边都可调、
       按锚点决定动谁」，只是对手字段不同：Ulysses 的对手是 TP，Ring 的对手是 seqLen。 */
    if (cpIsUlysses(config)) {
      const heads = presetOf(config).heads || 1;
      if (config.cp > 1 && heads % (config.tp * config.cp) !== 0) {
        if (anchor === "cp") {
          /* 锚在 CP 上：收 TP。它同时还要整除两个 intermediate，所以合法值是
             gcd(原基数, heads/CP) 的因子 —— 少了这个 gcd 会修出一个刚好除得尽头数、
             却除不尽 MoE intermediate 的 TP，等于把一条错换成另一条错。 */
          const room = heads % config.cp === 0 ? heads / config.cp : 1;
          config.tp = nearestDivisor(gcd(tpShardBasis(config), room), config.tp, FIELD_SPECS.tp);
        } else {
          /* 只在 2 的幂档位上收 —— 基数 heads/TP 可能带奇因子（48/8 = 6），
             收成 CP=3 会让 Total Rank 再也配不平，见 nearestPow2Divisor 的注释。 */
          config.cp = nearestPow2Divisor(ulyssesCpBasis(config), config.cp, FIELD_SPECS.cp);
        }
      }
    } else if (config.cp > 1 && config.seqLen % (2 * config.cp) !== 0) {
      /* 锚在 seqLen 上就收 CP（序列为奇数时无解，退回 CP=1 —— 那一档本就不受这条
         约束）；否则把序列抬到 2×CP 的最近倍数。 */
      if (anchor === "seqLen") {
        const half = config.seqLen % 2 === 0 ? config.seqLen / 2 : 0;
        config.cp = half ? nearestDivisor(half, config.cp, FIELD_SPECS.cp) : 1;
      } else {
        config.seqLen = nearestMultiple(2 * config.cp, config.seqLen, FIELD_SPECS.seqLen);
      }
    }

    if (config.topK > config.routedExpert) {
      if (anchor === "topK") {
        /* 专家数要容得下 Top-K，同时仍要能被 EP 整除 —— 一步取到位，别让下面的
           EP 修复再为一个刚抬上来的数把 EP 削一遍。 */
        config.routedExpert = nearestMultiple(config.ep, config.topK, FIELD_SPECS.routedExpert);
        if (config.routedExpert < config.topK) config.topK = config.routedExpert;
      } else {
        config.topK = config.routedExpert;
      }
    }

    /* EP 的两条整除约束合成一条：EP 要整除专家数，切出档下还要整除 DP ——
       也就是 EP 必须是 gcd(专家数, DP) 的因子（正交档只看专家数）。
       手输放开之前这里是反复减半，现在改成直接取最近的合法值：120 减半是 60，
       仍然不整除 256，减半那套修不动手输进来的数。 */
    const epBasis = epIsOrthogonal(config)
      ? config.routedExpert : gcd(config.routedExpert, epDomainOf(config));
    if (epBasis % config.ep !== 0) {
      if (anchor === "ep") {
        /* 锚在 EP 上：不动 EP，改让专家数（切出档还有 DP）成为它的倍数。
           抬 DP 会让 Total Rank 跟着涨 —— 加大专家并行度本来就要更多卡。 */
        config.routedExpert = nearestMultiple(config.ep, config.routedExpert, FIELD_SPECS.routedExpert);
        /* 锚在 EP 上时抬 DP 让域成为 EP 的倍数。mf 档的域已经带着 TP 那一倍，
           所以要抬的是 DP × TP —— 只动 DP（TP 由模型结构钉着，不该为 EP 让路）。 */
        if (!epIsOrthogonal(config)) {
          const need = epIsMf(config)
            ? config.ep / gcd(config.ep, Math.max(1, config.tp)) : config.ep;
          config.dp = nearestMultiple(need, config.dp, FIELD_SPECS.dp);
        }
        if (config.topK > config.routedExpert) config.topK = config.routedExpert;
      }
      // 抬不动（撞量程）时仍会不整除，兜底还是把 EP 收到最近的合法因子
      const basis = epIsOrthogonal(config)
        ? config.routedExpert : gcd(config.routedExpert, epDomainOf(config));
      if (basis % config.ep !== 0) config.ep = nearestDivisor(basis, config.ep, FIELD_SPECS.ep);
    }

    if (anchor === "totalRank") {
      fitParallelWorld(config, config.totalRank, anchor);
    } else {
      let world = parallelWorld(config);
      const maxRank = FIELD_SPECS.totalRank.max;
      if (world > maxRank) {
        fitParallelWorld(config, maxRank, anchor);
        world = parallelWorld(config);
      }
      config.totalRank = world;
    }

    /* 虚拟流水（升级计划行 17）。放在配平**之后**：PP 可能刚被 fitParallelWorld 改过，
       而 VPP 的合法性完全依赖 PP 与层数。它不进 world 的乘积（VPP 一张卡都不多占），
       所以这里只是把它收到合法档位上，不会反过来牵动 Total Rank。 */
    if (config.pp <= 1) {
      config.vpp = 1;
    } else if (config.vpp > 1 && config.totalLayer % (config.pp * config.vpp) !== 0) {
      /* 锚在 VPP 上：抬层数。Total Layer 是这条约束里唯一一个改了**不连累卡数**的
         对手字段（动 PP 会改 Total Rank）—— openPangu 的 46 层连 PP=4 都除不尽，
         所以按一下 VPP 的加号会把它抬到 48。这一跳走联动高亮，不是悄悄发生的。 */
      if (anchor === "vpp") {
        config.totalLayer = nearestMultiple(config.pp * config.vpp, config.totalLayer, FIELD_SPECS.totalLayer);
      }
      // 抬不动（撞量程，或锚不在 VPP 上）时把 VPP 自己收到最近的合法档
      if (config.totalLayer % (config.pp * config.vpp) !== 0) config.vpp = nearestVpp(config);
    }

    /* 重算层数跟着「最重的那个 stage 有多少层」走（升级计划行 19）。同样放在配平之后：
       PP 与 Total Layer 都可能刚被上面几段改过。这里只夹上界，不报错 ——
       「12 层的 stage 想重算 16 层」不是一处矛盾，只是一个多余的数，夹回去即可。
       加减键那边由 specMax 提前停住，走到这里的是手输与联动（PP 变大 → 每段变薄）。 */
    config.recomputeLayers = Math.min(
      Math.max(FIELD_SPECS.recomputeLayers.min, config.recomputeLayers || FIELD_SPECS.recomputeLayers.min),
      specMax("recomputeLayers", config),
    );

    /* 开关不可用时（TP=1 的 SP 与词表、DP=1 的权重分片、CP=1 的 CP 口径）一律停到 disabledValue，
       不能就地放着不管：不这么做的话「TP=8 开着 SP → 把 TP 降回 1」会留下一个改不动
       的开状态 —— 控件此时是灰的，而 yaml 仍写 use_seq_parallel: True 并标成「与默认
       不同」，成了一个用户看得见却无从解释的数。
       停的那一档取「此刻毫无效果、且与预设默认同值」的那个（见 FLAG_SPECS 表头）：
       SP 是 false，词表与优化器并行是 true —— 把它们写成 False 反倒会在 YAML 视图里
       多标出两行「与默认不同」，是同一种病换个方向犯。
       被改掉的这一下会走联动高亮（highlightLinkedChanges 已把布尔开关一并纳入），
       所以它不是悄悄发生的。 */
    Object.keys(FLAG_SPECS).forEach((flag) => {
      const spec = FLAG_SPECS[flag];
      if (!spec.enabledWhen || spec.enabledWhen(config)) return;
      if (spec.disabledValue !== undefined) config[flag] = spec.disabledValue;
    });

    /* Node 是派生量：整机卡数由卡型号定死，节点数就只剩 Total Rank ÷ 它一个值。
       原先它是自由 stepper，于是 reconcile 里还有一条「Node 大于乘积时反向撑
       world」的分支 —— 那条正是升级计划行 13 要治的「改节点数反把并行度重排了」，
       随着 Node 退出输入字段一并删掉。 */
    config.node = nodeLayout(config).node;
  }

  /* ── 派生：把配置展开成四个视图共用的实体表 ───────────────────────────── */
  function derive(config) {
    const preset = presetOf(config);
    const { totalLayer, dp, pp, vpp, tp, cp, routedExpert, sharedExpert, ep, totalRank } = config;
    const errors = validate(config);
    const warnings = warn(config);
    /* 不读 config.node —— 它是 reconcile 落下的同一份派生结果，这里重算一遍，
       保证外部直接塞 config 进来（createController 的 options.config）时也对。 */
    const { ranksPerNode, node, tailRanks } = nodeLayout(config);

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
      const dense = preset.noMoe ? true : l < preset.firstKDense;
      layers.push({
        index: l,
        stage: stageOfLayer[l],
        ffn: dense ? "dense" : "moe",
        attention: preset.dsaEvery ? (l % preset.dsaEvery === 0 ? "dsa" : "swa") : (preset.attentionLabel || "std"),
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

    /* rank 编址：stage 最外，EDP 次之，ep 最内（TP/CP 内联在最内层）。
       d 轴走 EDP 而不是 DP —— 切出档下那 DP 个副本里已经含了 EP 组，再乘一次 EP
       会把每个 stage 撑成 world 的 EP 倍。正交档 EDP ≡ DP，与改动前逐位相同。

       ── mf 档的几何不一样（升级计划行 23）────────────────────────────────
       MindFormers 的 EP 是在 **DP×MP 域**上切的：一个 EP 组的成员既跨数据并行、
       也跨张量并行。于是 TP **不再是独立的一根轴** —— 它被 EP 那一维吃掉了：

         另两档  ranksPerEp = TP×CP，域里的坐标是 (edp, ep, tp, cp) 四个自由维
         mf 档   ranksPerEp = CP，   自由维只有 (edp, ep, cp)，而
                 域序号 m = edp索引 × EP + ep索引 ∈ [0, DP×TP)，
                 TP 分片号 = m % TP、真正的 DP 副本号 = ⌊m / TP⌋

       两套都满足 ranksPerStage = DP×TP×CP = world/PP（mf 档若照抄 TP×CP 会把 TP
       乘两遍，每个 stage 撑成 TP 倍 —— 那正是「矩阵格子数 ≠ Total Rank」那条断言
       会当场逮住的错）。
       TP 仍然连号：cp=1 时 m 就是 stage 内的序号，TP 组的 tp 张卡依旧相邻。 */
    const edp = expertDataParallel(config);
    const epMode = epModeOf(config);
    const mfDomain = epMode === "mf";
    const ranksPerEp = mfDomain ? cp : tp * cp;
    const ranksPerDp = ep * ranksPerEp;
    const ranksPerStage = edp * ranksPerDp;

    const rankOf = (stage, dpIdx, epIdx, inner = 0) =>
      stage * ranksPerStage + dpIdx * ranksPerDp + epIdx * ranksPerEp + inner;
    /* (dpIdx, epIdx, inner) → TP / CP 分片号。两套编址各一条，**只此一处**，
       集群矩阵与 coordsOfRank 都读它 —— 原先矩阵那边自己又算了一遍
       （tpShardOf / cpIdxOf），mf 档下那份算法是错的。 */
    const shardOf = (dpIdx, epIdx, inner) => (mfDomain
      ? { tpIdx: (dpIdx * ep + epIdx) % tp, cpIdx: inner, dpReal: Math.floor((dpIdx * ep + epIdx) / tp) }
      : { tpIdx: inner % tp, cpIdx: Math.floor(inner / tp), dpReal: dpIdx });
    /* mf 档下 tpIdx 不是自由维（它由 (dpIdx, epIdx) 定），所以这一支只收 cpIdx */
    const rankOfCoords = (stage, dpIdx, epIdx, tpIdx = 0, cpIdx = 0) =>
      rankOf(stage, dpIdx, epIdx, mfDomain ? cpIdx : cpIdx * tp + tpIdx);
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

    /* 单 DP 口径下某个 PP stage 的 rank：整段 stage 里只取一个 DP 副本那一块。
       Emb / Final Norm / LM Head 这类端点对象没有层号、只有驻留的 stage，
       与「层」走的是同一个查询口径，所以口径函数要按 stage 提供一份。 */
    function ranksOfStageInDp(stage, dpIdx = 0) {
      const safeDpIdx = Math.max(0, Math.min(edp - 1, dpIdx));
      const out = [];
      const start = rankOf(stage, safeDpIdx, 0);
      for (let i = 0; i < ranksPerDp; i += 1) out.push(start + i);
      return out;
    }

    function ranksOfLayerInDp(layerIndex, dpIdx = 0) {
      return ranksOfStageInDp(stageOfLayer[layerIndex], dpIdx);
    }


    /* 某层里某个专家实际落在哪些 rank 上：该层所在 stage × 全部 DP 副本 × 该专家的 EP rank */
    function ranksOfExpertInLayer(layerIndex, expert) {
      const stage = stageOfLayer[layerIndex];
      const epIdx = epRankOfExpert(expert);
      const out = [];
      for (let d = 0; d < edp; d += 1) {
        for (let inner = 0; inner < ranksPerEp; inner += 1) out.push(rankOf(stage, d, epIdx, inner));
      }
      return out;
    }

    function ranksOfEpRankInStage(stage, epIdx) {
      const out = [];
      for (let d = 0; d < edp; d += 1) {
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
      const inner = withinDp - epIdx * ranksPerEp;
      /* 行 23：两套编址的分解只写在 shardOf 一处 —— mf 档下 tpIdx 由 (d, ep) 定，
         dpReal 是那个域序号还原出来的**真正的 DP 副本号**（另两档 ≡ dpIdx）。 */
      const { tpIdx, cpIdx, dpReal } = shardOf(dpIdx, epIdx, inner);
      return { rank, stage, dpIdx, epIdx, tpIdx, cpIdx, dpReal, inner, node: nodeOfRank(rank) };
    }

    return {
      config, preset, errors, warnings, valid: errors.length === 0,
      // 卡型号：只有 hbmGB 参与计算（单卡容量框的高度），其余是说明性规格
      card: CARD_SPECS[config.card] || CARD_SPECS[DEFAULT_CARD],
      hasMoe: !preset.noMoe,
      stages, layers, epRanks,
      counts: {
        totalLayer,
        denseLayers: preset.noMoe ? totalLayer : Math.min(preset.firstKDense, totalLayer),
        moeLayers: preset.noMoe ? 0 : Math.max(0, totalLayer - preset.firstKDense),
        dsaLayers: layers.filter((l) => l.attention === "dsa").length,
        swaLayers: layers.filter((l) => l.attention === "swa").length,
        routedExpert, topK: config.topK, sharedExpert, ep, expertsPerEpRank,
        /* dp 是配置里那个数（切出档 = 真 DP，正交档 = EP 之外的数据并行度）；
           edp 是集群矩阵 d 轴、rank 编址真正用的组数。凡是「有几个副本要画 / 要
           遍历」一律读 edp，凡是「显示这个配置项的值」读 dp。 */
        dp, edp,
        /* 行 23：口径升成三档之后，counts 里留的是**档位本身**而不是那个布尔 ——
           下游（yaml / capacity / 集群矩阵）问的是「按哪一档读」，不是「是不是正交」。
           moeOrthogonal 仍然留着：外部调用与老快照读它，值等于 epMode === "orthogonal"。 */
        epMode: epModeOf(config), moeOrthogonal: epIsOrthogonal(config),
        /* 非专家权重的复制份数（ZeRO / FSDP2 的分母）。三档只有 mf 与 EDP×EP 不同，
           单给一个数免得 capacity 那边再判一次档 —— 见 dpReplicaOf。 */
        dpReplica: dpReplicaOf(config),
        /* vpp / cpMode 不参与 rank 编址，也不进 world —— 放进 counts 只是因为
           capacity（在飞份数）与 yaml（那两行）要读它们，而两个模块都只吃 topology。 */
        pp, vpp: vpp || 1, cpMode: config.cpMode || "ulysses",
        /* 微批数同样不进 rank 编址（升级计划行 22）：它是「一个全局 batch 分成
           几份」，与切分无关。放进 counts 的理由与 vpp 一样 —— capacity 要拿它
           夹在飞份数、yaml 要把它和全局 batch 一起写出去，两个模块都只吃 topology。 */
        microBatchNum: Math.max(1, config.microBatchNum || 1),
        tp, cp, totalRank, node, ranksPerNode,
        /* 末节点实际装了几张卡。整机倍数时等于 ranksPerNode；只有手输能拨出
           不足一机的尾数（dp=3 → 12 卡 = 1 整机 + 4 张），yaml 那行要照实写。 */
        tailRanks,
        ranksPerStage, ranksPerDp, ranksPerEp,
      },
      stageOfLayer: (l) => stageOfLayer[l],
      epRankOfExpert,
      expertsOfEpRank: (p) => (epRanks[p] ? epRanks[p].experts : []),
      rankOf, rankOfCoords, nodeOfRank, coordsOfRank, shardOf,
      ranksOfStage, ranksOfLayer, ranksOfStageInDp, ranksOfLayerInDp,
      ranksOfExpertInLayer, ranksOfEpRankInStage, nodesOfRanks,
    };
  }

  /* ══ stepper UI：复用 .zoom-control-group / .zoom-control-readout / .btn ══ */
  /* stroke-width 3（不是图标常用的 2）：这两枚画在 28px 的圆键里、实际渲染 18px，
     24 格坐标系下的 2 格描边落地不到 1.5px，在深色底上几乎看不见笔画。
     笔画长度也收到 ±7 而不是满格 ±14，粗笔画配满格会糊成一坨。
     width/height 只是没有 CSS 时的兜底，真实尺寸由 .cro-stepper__control .btn svg 给。 */
  const MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5.5 12h13"></path></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5.5v13"></path><path d="M5.5 12h13"></path></svg>';
  /* 「高级」那枚按钮的下箭头。这枚是**装饰**而不是点击目标（整颗按钮才是），
     所以按常规图标口径给 2 格描边、12px 渲染，展开时由 CSS 转 180°。 */
  const CARET = '<svg viewBox="0 0 24 24" aria-hidden="true" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"></path></svg>';

  /* ── 哪几枚收进各行末尾的「高级」折叠 ──────────────────────────────────
     两行各有各的判据，都能一眼验：

     parallel —— **拨了 Total Rank 一张卡都不变的，就不该占着行里那一格**。
       于是行里留下的恰好是 world 乘积的四个因子（DP×PP×TP×CP）加模型自身的层数。
       VPP 是其中唯一一枚普通 stepper：它有真的档位要拨，却不进 world 的乘积；
       真实调参里它也在第二梯队（先 DP/TP/PP/EP 把模型装下、再重计算与 ZeRO 挤余量，
       最后才在性能阶段动它），而且默认预设下它压根拨不动（46 层连 PP=4 都除不尽），
       摆在首屏正中间等于再犯一次「一枚只能停在一个值上的 stepper 不是 stepper」。

     batch —— 判据换成了一条更硬的：**首屏那一行只留「这一步吃多少 + 这张卡上那个
       张量长什么样」**，即 Global Batch 与 [B, S, H]。别的一律收进来，分四类：
       · **算得出来的** —— Node（Total Rank ÷ 整机卡数，只有唯一一个合法值）。它
         原先站在 Total Rank 旁边，但一个不能拨的数不该占首屏那一格。
       · **不是形状、也不是这一步吃多少的** —— 微批数。它是「这个 [B,S,H] 一步之内
         跑几遍」，值仍进 Global Batch 的乘积（那一格的浮层写着三个因子各在哪儿），
         夹在 B 与 S 之间反而把「输入矩阵形状」这句话打断了。
       · **只在另一枚控件拨到某一档之后才有意义的** —— 重算层数只有「重计算 ·
         按层数」那一档才生效（拨到那一档时折叠会自动掀开，见 set()）；LoRA 那一对
         是微调侧的旋钮，而本页两个预设写的都是预训练配置。
       · **换算口径** —— 精度那两枚（行 21）不改「装多少」，改的是「每个数占几个
         字节」。它一年也未必动一次，却让六段全体升降。
       「重计算」也一并收了进来：它治的是激活留不留，不是张量的形状，留在行里就得
       解释它和旁边四枚不是一类东西 —— 它与自己的搭档「重算层数」挨着放更好读。

     列表里可以是 DERIVED_SPECS 的只读读数、FIELD_SPECS 的字段（走 attachStepper），
     也可以是 FLAG_SPECS 的开关 / 档位控件 —— 三者由 buildItem 按名字分派，面板按
     这里的顺序铺，与那几张表各自的顺序无关。
     未列到的开关照旧接在自己那一行的末尾（batch 收完之后已经一枚不剩）。 */
  const ADVANCED_ITEMS = {
    parallel: ["vpp", "cpMode", "seqParallel", "vocabEmbDp", "shardMode"],
    /* 顺序按「先量后档」，且让搭档挨着：Node / 微批数两枚数在前，
       重计算与它的重算层数紧挨着，再是两枚精度，最后 LoRA 那一对。 */
    batch: ["node", "microBatchNum", "recomputeMode", "recomputeLayers",
      "dtype", "paramsDtype", "lora", "loraRank"],
  };

  /* 折叠按钮的悬浮说明：里面收着什么、为什么收在这里。按行分写 —— 两行的判据
     本来就不是同一条。 */
  const ADVANCED_TITLE = {
    parallel: "VPP / CP 口径 / 序列并行 SP / 词表走 DP / 权重分片\n\n"
      + "收在这里的判据只有一条：**拨了 Total Rank 一张卡都不变**。"
      + "所以外面留下的五枚恰好是 world 乘积的因子（DP×PP×TP×CP）加模型自身的层数。\n"
      + "这几枚不占卡，却各自改着别的东西：\n"
      + "· VPP —— 把每个 stage 的层再拆成几段轮流跑，气泡变小、在飞激活变多\n"
      + "· CP 口径 —— CP > 1 时换掉一条硬校验（Ulysses 拦 TP×CP 整除注意力头，"
      + "Ring 拦序列长度整除 2×CP）\n"
      + "· SP / 词表走 DP / 权重分片 —— 三种不额外占卡的切法",
    batch: "Node / micro_batch_num / 重计算 / 重算层数 / 精度两档 / LoRA 那一对\n\n"
      + "行里留下的只有 Global Batch 与 [B, S, H] —— 这一步吃多少样本，"
      + "以及摊到这张卡上那个张量长什么样。别的都在这里：\n"
      + "· Node —— Total Rank ÷ 整机卡数，算得出来，拨不动（只读读数）\n"
      + "· micro_batch_num —— 这个 [B,S,H] 一步之内跑几遍（Megatron 的 num_microbatches / "
      + "HF·DeepSpeed 的 gradient_accumulation_steps）。它仍是 Global Batch 的第三个因子，"
      + "PP > 1 时还夹着在飞份数，只是它不是形状的一维\n"
      + "· 重计算 / 重算层数 —— 激活留不留：四档一刀不切，只决定每份留多少；"
      + "「按层数」那一档才按重算层数算（拨到那一档时这个折叠会自动掀开）\n"
      + "· 计算精度 / 主权重精度 —— 换算口径：不改「装多少」，改的是「每个数占几个字节」，"
      + "六段的高度全跟着它走，但它一年也未必动一次（升级计划行 21）\n"
      + "· LoRA / LoRA Rank —— 冻结主干只训 adapter，梯度段与优化器段跟着 adapter 走、"
      + "权重段一个字节不少。本页两个预设写的都是预训练配置，所以它默认关着",
  };

  /* ── 建议修法 ─────────────────────────────────────────────────────────────
     手输了一个与其它字段不兼容的数之后，横幅要答出「把哪几个字段改成多少就兼容
     了」。这件事 reconcile 本来就在做，区别只是结果不落到 config 上 —— 所以直接
     拿它跑一份副本。reconcile 的所有修复分支都避开 anchor，唯一的例外是末尾那句
     无条件重算 node，所以这里再校一次锚点：动了锚点就不算「兼容你输入的数」的
     建议，宁可返回 null 让横幅退化成只有「取消修改」一个出口。 */
  function proposeFix(config, anchor) {
    const proposal = { ...config };
    reconcile(proposal, anchor);
    if (proposal[anchor] === config[anchor] && !validate(proposal).length) return proposal;

    /* Total Rank 是唯一一个 reconcile 修不出建议的常用锚点：补它的差额要解一个
       整数分解，而 fitParallelWorld 只在 2 的幂梯子上找解 —— 那是加减键该有的
       手感，不该为手输放开。所以这里补一条直解：让 DP 独自吃掉整个差额，再由
       reconcile 把 EP 收到合法因子上。手输 1000 卡时它答「DP 512→250、EP 64→2」，
       而不是两手一摊。 */
    if (anchor === "totalRank") {
      const alt = { ...config };
      const rest = alt.pp * alt.tp * alt.cp * epInWorld(alt);
      const dp = rest > 0 ? alt.totalRank / rest : 0;
      if (Number.isInteger(dp) && dp >= FIELD_SPECS.dp.min && dp <= FIELD_SPECS.dp.max) {
        alt.dp = dp;
        reconcile(alt, anchor);
        if (alt.totalRank === config.totalRank && !validate(alt).length) return alt;
      }
    }
    return null;
  }

  /* ── 悬浮说明：标签后的小问号 + 统一气泡 ──────────────────────────────────
     这些解释原先挂在原生 title 上，三处都不好：要按住不动 ~1s 才弹、长文按系统
     样式排版（深色主题下仍是白底）、而且没有任何视觉线索告诉人「这里能悬浮」。
     现在改成：
       · 触发点是表单标签后面那枚小问号（buildHint / fillLabel），看得见、悬浮即出；
       · 文案一个字不改（仍是带 \n 的那几段），首段升格成气泡标题，正文 pre-wrap，
         作者手排的空行与「· 」列表原样保留；
       · 气泡只有一个，挂在 body 下 position:fixed —— 与容量口径浮层同一个理由：
         祖先 .pto-ide-frame__pane 既 overflow:hidden 又带 backdrop-filter，留在
         里面既定位不到视口也会被裁，还会把 .cro-board 撑出滚动条。
     任何元素带上 data-hint 就走这套（走不动的加减键、EP 口径那三档都是这么接的），
     不必都长成问号 —— 本身就有可见文字的控件，整块都是触发面积更顺手。 */
  const HINT_HIDE_DELAY = 140;    // 从问号滑向气泡的那几像素空当，没有它半路就收掉了
  let hintEl = null;
  let hintAnchor = null;
  let hintTimer = 0;

  function hintBubble() {
    if (hintEl) return hintEl;
    hintEl = document.createElement("div");
    hintEl.className = "cro-hint-bubble";
    hintEl.id = "croHintBubble";
    hintEl.setAttribute("role", "tooltip");
    hintEl.hidden = true;
    // 气泡自己 hover 时保持展开：口径要能读完、也要能选中复制
    hintEl.addEventListener("pointerenter", () => global.clearTimeout(hintTimer));
    hintEl.addEventListener("pointerleave", () => hideHint());
    document.body.appendChild(hintEl);
    return hintEl;
  }

  /* 文案 → 气泡内容。约定：第一个空行之前是「一句话说清这是什么」，之后是详解；
     `reason`（此刻为什么不可用）另起一格排在最前 —— 与改动前 title 里
     「理由 \n\n 正文」的次序逐字相同，只是排版归页面自己管了。 */
  function renderHint(box, text, reason) {
    box.textContent = "";
    if (reason) {
      const note = document.createElement("div");
      note.className = "cro-hint-bubble__reason";
      note.textContent = String(reason).trim();
      box.appendChild(note);
    }
    const raw = String(text || "").replace(/\r/g, "");
    const cut = raw.indexOf("\n\n");
    const head = cut > 0 ? raw.slice(0, cut).trim() : "";
    const body = cut > 0 ? raw.slice(cut + 2).replace(/^\n+/, "") : raw.trim();
    if (head) {
      const h = document.createElement("div");
      h.className = "cro-hint-bubble__head";
      h.textContent = head;
      box.appendChild(h);
    }
    if (body) {
      const p = document.createElement("div");
      p.className = "cro-hint-bubble__body";
      p.textContent = body;
      box.appendChild(p);
    }
  }

  /* 贴放并避让视口：默认挂在触发点正下方左对齐，下方装不下就翻到上方，左右各夹
     8px。表单在板面里能滚，触发点位置随时会变，所以每次显示都实测一遍。 */
  function placeHint() {
    if (!hintEl || hintEl.hidden || !hintAnchor || !hintAnchor.isConnected) return;
    const anchor = hintAnchor.getBoundingClientRect();
    const box = hintEl.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const vw = global.innerWidth;
    const vh = global.innerHeight;

    let left = Math.min(anchor.left, vw - box.width - margin);
    left = Math.max(margin, left);

    let top = anchor.bottom + gap;
    if (top + box.height > vh - margin) {
      const above = anchor.top - gap - box.height;
      top = above >= margin ? above : Math.max(margin, vh - box.height - margin);
    }
    hintEl.style.left = `${Math.round(left)}px`;
    hintEl.style.top = `${Math.round(top)}px`;
  }

  function showHint(anchor) {
    if (!anchor || !anchor.dataset) return;
    const text = anchor.dataset.hint;
    const reason = anchor.dataset.hintReason;
    if (!text && !reason) return;
    global.clearTimeout(hintTimer);
    const box = hintBubble();
    if (hintAnchor && hintAnchor !== anchor) markHintOpen(hintAnchor, false);
    hintAnchor = anchor;
    renderHint(box, text, reason);
    box.hidden = false;
    box.scrollTop = 0;      // 换了一条就从头读，别沿用上一条滚到哪儿
    // 先落位再上浮：位置是量出来的，量之前显示会让气泡从上一个位置滑过来
    placeHint();
    global.requestAnimationFrame(() => { if (hintAnchor === anchor) box.classList.add("is-open"); });
    markHintOpen(anchor, true);
  }

  function markHintOpen(anchor, open) {
    if (anchor && anchor.classList && anchor.classList.contains("cro-hint")) {
      anchor.setAttribute("aria-expanded", String(open));
    }
  }

  function hideHint(immediate) {
    if (!hintEl) return;
    global.clearTimeout(hintTimer);
    const close = () => {
      hintEl.classList.remove("is-open");
      hintEl.hidden = true;
      markHintOpen(hintAnchor, false);
      hintAnchor = null;
    };
    if (immediate) close();
    else hintTimer = global.setTimeout(close, HINT_HIDE_DELAY);
  }

  /* 委托一次挂好：触发点是 emit() 里反复重建的，逐个挂监听必漏。
     pointerover/out 而不是 enter/leave —— 前者才冒泡，委托得到。 */
  let hintsInstalled = false;
  function installHints() {
    if (hintsInstalled) return;
    hintsInstalled = true;
    document.addEventListener("pointerover", (event) => {
      const target = event.target.closest?.("[data-hint], [data-hint-reason]");
      if (!target) return;
      if (target === hintAnchor && hintEl && !hintEl.hidden) { global.clearTimeout(hintTimer); return; }
      showHint(target);
    });
    document.addEventListener("pointerout", (event) => {
      const target = event.target.closest?.("[data-hint], [data-hint-reason]");
      if (!target || target !== hintAnchor) return;
      // 在同一枚触发点内部挪动（图标 → 它自己的文字）不算离开
      if (event.relatedTarget && target.contains(event.relatedTarget)) return;
      hideHint();
    });
    // 键盘可达：Tab 到问号同样展开（hover-only 的提示对键盘用户等于不存在）
    document.addEventListener("focusin", (event) => {
      const target = event.target.closest?.("[data-hint], [data-hint-reason]");
      if (target) showHint(target);
    });
    document.addEventListener("focusout", (event) => {
      const target = event.target.closest?.("[data-hint], [data-hint-reason]");
      if (target && target === hintAnchor) hideHint();
    });
    /* 触屏没有 hover，问号留一个点击开合。stopPropagation 是必须的：页面在
       document 上有一条「点空白清空选择」，问号虽落在 .cro-stepper 这个白名单里，
       但气泡本身挂到了 body 下（另见 SELECTABLE 里补的那一条）。 */
    document.addEventListener("click", (event) => {
      const target = event.target.closest?.(".cro-hint");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (hintAnchor === target && hintEl && !hintEl.hidden) hideHint(true);
      else showHint(target);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideHint(true);
    });
    /* 气泡脱离了文档流，触发点却还在会滚动的板面里 —— 面板一滚、窗口一改，两者
       就对不上了。capture 是为了收到 .cro-board 这类内部滚动。 */
    global.addEventListener("resize", placeHint);
    document.addEventListener("scroll", placeHint, { passive: true, capture: true });
  }

  /* 标签后面那枚小问号。text 为 null / undefined 时不建 —— 没有解释的字段
     不该多出一个空触发点；给了空串则先建好（此刻只有置灰理由可答，见 emit）。 */
  function buildHint(text) {
    if (text == null) return null;
    installHints();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cro-hint";
    btn.dataset.hint = String(text);
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "说明");
    btn.textContent = "?";
    return btn;
  }

  /* 标签 = 文字 + 可选问号。文字单独包一层是为了省略号：标签本身已是 flex 容器，
     text-overflow 只在块级文字上生效，而 MoE 那一行的标签是会被压窄的。 */
  function fillLabel(label, text, hint) {
    label.textContent = "";
    const span = document.createElement("span");
    span.className = "cro-stepper__label-text";
    span.textContent = text;
    label.appendChild(span);
    const btn = buildHint(hint);
    if (btn) label.appendChild(btn);
    return btn;
  }

  /* 已建好的触发点换一份文案。两件事分两个属性存，气泡里也分两块排 ——
     「此刻为什么点不动」与「这枚是干什么的」是两个问题。 */
  function setHint(el, text, reason) {
    if (!el || !el.dataset) return;
    if (text) el.dataset.hint = String(text); else delete el.dataset.hint;
    if (reason) el.dataset.hintReason = String(reason); else delete el.dataset.hintReason;
    if (text || reason) installHints();
    // 正显示着这一条就地重排，否则用户读到的还是上一份
    if (el === hintAnchor && hintEl && !hintEl.hidden) {
      if (text || reason) { renderHint(hintEl, text, reason); placeHint(); }
      else hideHint(true);
    }
  }

  /* 大多数字段的说明是写死的一段话；个别字段（Routed / EP）要把当前拓扑的数报出来才
     讲得清，于是 title 也允许写成 (topology) => string。建 stepper 时拓扑还没派生
     出来，先给空串把问号建出来，正文由 emit() 那一趟按当前拓扑填 —— emit 在
     mount 之后必定跑一次（init 末尾的 controller.refresh()），不会留下空气泡。 */
  function fieldTitle(spec, topology) {
    if (typeof spec.title !== "function") return spec.title;
    return topology ? spec.title(topology) : "";
  }

  function buildStepper(field, value, onStep, onType) {
    const spec = FIELD_SPECS[field];
    const wrap = document.createElement("div");
    wrap.className = "cro-stepper";
    wrap.dataset.field = field;

    const label = document.createElement("span");
    label.className = "cro-stepper__label";
    /* 问号建在标签后面：整枚外壳当触发面积（原先 wrap.title 的做法）在这一行里
       太糊 —— 表单挨得紧，扫过去会一路弹。带 disabledReason 的字段即使 title
       为空也先把问号建出来（传空串而不是 undefined），置灰时它才有地方说话。 */
    const initialTitle = fieldTitle(spec, null);   // 函数型 title 此刻只拿得到空串，正文等 emit() 填
    fillLabel(label, spec.label, initialTitle != null ? initialTitle : (spec.disabledReason != null ? "" : null));

    const control = document.createElement("div");
    control.className = "zoom-control-group cro-stepper__control";

    const dec = document.createElement("button");
    dec.type = "button";
    dec.className = "btn btn-ghost btn-icon btn-sm";
    dec.innerHTML = MINUS;
    dec.setAttribute("aria-label", `减少 ${spec.label}`);

    /* 读数是 input 不是 span：加减键只走 2 的幂档位，手输负责「精确指定」——
       DP=120、PP=3 这类真实存在却不在 2 的幂梯子上的值只能由输入框给。
       仍复用 .zoom-control-readout 的排版，只在本作用域抹掉输入框的原生外观。 */
    const readout = document.createElement("input");
    readout.className = "zoom-control-readout cro-stepper__input";
    readout.type = "text";
    readout.inputMode = "numeric";
    readout.autocomplete = "off";
    readout.spellcheck = false;
    readout.value = String(value);
    readout.setAttribute("aria-label", spec.label);
    /* size 决定输入框的固有宽度。不给的话浏览器按 20 个字符算 —— 这正是换成
       input 之后整行 stepper 变宽的原因。按当前值的位数给（下限见 readoutSize），
       读数的宽度就与还是 <span> 时的内容自适应一致。 */
    readout.size = readoutSize(field, String(value));
    // 打字过程中同步跟宽，但**不提交**（提交仍在 Enter / 失焦，见下面的注释）
    readout.addEventListener("input", () => {
      readout.size = readoutSize(field, readout.value);
    });

    const inc = document.createElement("button");
    inc.type = "button";
    inc.className = "btn btn-ghost btn-icon btn-sm";
    inc.innerHTML = PLUS;
    inc.setAttribute("aria-label", `增加 ${spec.label}`);

    dec.addEventListener("click", () => onStep(field, -1));
    inc.addEventListener("click", () => onStep(field, 1));

    /* Enter / 失焦才提交，Esc 放弃。**不监听 input 事件** —— 输 "120" 要先经过
       "1" 和 "12" 两个中间态，逐键提交会让整页在打字过程中反复标红又复原，
       而且 "1" 这种中间态多半就是不兼容的。 */
    readout.addEventListener("focus", () => readout.select());
    readout.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); readout.blur(); }
      else if (event.key === "Escape") { event.preventDefault(); readout.dataset.abort = "1"; readout.blur(); }
      // 上下键当加减键使：焦点在输入框里时，这是最顺手的「回到常规档位」的动作
      else if (event.key === "ArrowUp") { event.preventDefault(); onStep(field, 1); }
      else if (event.key === "ArrowDown") { event.preventDefault(); onStep(field, -1); }
    });
    readout.addEventListener("blur", () => {
      const abort = readout.dataset.abort;
      delete readout.dataset.abort;
      onType(field, abort ? null : readout.value);
    });

    control.append(dec, readout, inc);
    wrap.append(label, control);
    return wrap;
  }

  /* ══ 控制器：持有 config，渲染 stepper，广播 cro:change ══════════════════ */
  function createController(options = {}) {
    const modelId = options.model || "openpangu-flash";
    /* moeOrthogonal 不进 MODEL_PRESETS.defaults：它是读配置的**口径**而不是模型
       的属性，换模型时应当沿用用户当前选的那一档（见 setModel）。 */
    const config = Object.assign(
      { model: modelId, epMode: "split", moeOrthogonal: false },
      MODEL_PRESETS[modelId].defaults,
      options.config,
    );
    const readouts = new Map();
    const wraps = new Map();
    const stepButtons = new Map();       // [减, 加]，每次 emit 按能不能走动来置灰
    /* 三枚只读读数的值格（Node / Hidden / 全局 Batch）：都是派生量，没有加减键。
       键与 DERIVED_SPECS 同名，emit 里按同一段刷新，见 buildDerivedReadout。 */
    const derivedReadouts = new Map();
    const flagControls = new Map();      // 布尔开关的 input 与「开/关」两个字
    const choiceControls = new Map();    // 有限档位字段（shardMode / cpMode）的那排页签
    const linkedHighlightTimers = new Map();
    const listeners = [];
    /* 手输进来的不兼容值：页面停在这一态，下游图形一律不更新，直到用户走三个出口
       之一 —— 横幅的「一键应用」/「取消修改」，或用加减键把它步进回合法档位。 */
    let invalidTyped = null;
    // 超量程 / 非整数的一次性提示，与上面那种「参数互不兼容」是两回事
    let rangeHint = null;
    // 最近一次自洽的配置快照：「取消修改」整份退回到它，保证报错态一定有出口
    let lastValidConfig = null;
    // 同一时刻的拓扑，供 topology getter 在冻结期间兜底（见下面的 getter）
    let lastValidTopology = null;

    /* 建一枚 stepper 并登记进三张表（读数 / 加减键 / 外壳）。行里和「高级」面板里
       用的是同一个 —— 两处只是挂载的容器不同，别的一切（红圈、联动高亮、置灰理由）
       都靠这三张表工作，漏登记哪一张就漏哪一种反馈。 */
    function attachStepper(field) {
      const stepper = buildStepper(field, config[field], apply, commitTyped);
      readouts.set(field, stepper.querySelector(".zoom-control-readout"));
      stepButtons.set(field, stepper.querySelectorAll(".cro-stepper__control button"));
      wraps.set(field, stepper);
      return stepper;
    }

    /* 一格控件：只读读数 / stepper / 开关三选一，按名字自己认。行里与「高级」面板里
       用的是同一个 —— 两处只是挂载的容器不同，红圈、联动高亮、置灰理由都一样不少。
       ⚠️ 先问 DERIVED_SPECS：node 两张表里都有（FIELD_SPECS 留着它的量程给
       nodeLayout 夹取），当成 stepper 建出来就是一枚只能停在一个值上的加减键。 */
    function buildItem(name) {
      if (DERIVED_SPECS[name]) return buildDerivedReadout(name);
      return FIELD_SPECS[name] ? attachStepper(name) : buildFlagControl(name);
    }

    function mount(container, group) {
      if (!container) return;
      container.innerHTML = "";
      FIELD_ORDER[group].forEach((name) => container.appendChild(buildItem(name)));
      /* 开关接在自己那一行的末尾，外壳仍是 .cro-stepper（label 在上、控件在下），
         所以它和旁边的 stepper 逐格对齐，读下来仍是同一行表单。
         被 ADVANCED_ITEMS 点名的那几枚除外：它们一起收进「高级」后面，见 mountAdvanced()。 */
      const advanced = ADVANCED_ITEMS[group] || [];
      Object.keys(FLAG_SPECS)
        .filter((flag) => FLAG_SPECS[flag].group === group && advanced.indexOf(flag) < 0)
        .forEach((flag) => container.appendChild(buildFlagControl(flag)));
      if (advanced.length) mountAdvanced(container, group, advanced);
    }

    /* ── 「高级」折叠：每一行末尾各一枚 ──────────────────────────────────────
       收进来的判据按行分写，见 ADVANCED_ITEMS 上面那段。收在一枚「高级 ⌄」后面：
       按钮本身就站在行末那一格，展开时几枚一起铺在下面一整行 —— 面板
       flex-basis:100%，所以它总是自己另起一行，不会插进 stepper 的缝里。

       展开态记在 localStorage，**每行各记各的**：parallel 那几枚切法与 batch 这几枚
       微调侧的旋钮，是两类活儿，一个人可能常看前者、从不看后者。
       parallel 的键名保持不变，老用户存下的偏好不会因为这次多出一个折叠而丢。 */
    const advancedPanels = [];      // [{ group, panel, toggle, storeKey }]

    function advancedStoreKey(group) { return `cro:${group}-advanced-open`; }

    function readAdvancedOpen(storeKey) {
      // 隐私窗口 / 站点数据被禁时读写都可能直接抛，一律当作「收起」，不能连页面都渲染不出来
      try { return window.localStorage.getItem(storeKey) === "1"; }
      catch (e) { return false; }
    }

    function setAdvancedOpen(entry, open, remember) {
      if (!entry || !entry.panel || !entry.toggle) return;
      const changed = entry.panel.hidden === open;      // hidden 与 open 相反即为翻转
      entry.panel.hidden = !open;
      entry.toggle.setAttribute("aria-expanded", String(open));
      entry.toggle.classList.toggle("is-open", open);
      /* 面板一开一合，**它下面的所有东西整块平移一行的高度** —— Cluster 那一枚
         尤其明显：矩阵直接上下挪一整行。于是两件事得跟着补：关系图的连线画在
         viewport 坐标上，不重画就还连在旧位置；收起腾出来的那截高度得让矩阵吃掉，
         否则下面白着一条。两件都由 boot 里那条 cro:layout 监听统一做 ——
         控制器持有的是 config 与表单，不认识矩阵，也不该认识。
         只在真的翻转时发：mount() 的首次恢复与「本来就开着又被联动掀一次」都不是
         版面变化，白发一次就是白量一次几何。 */
      if (changed) {
        document.dispatchEvent(new CustomEvent("cro:layout", {
          detail: { source: "advanced", group: entry.group, open },
        }));
      }
      // remember=false 用于「被联动强行掀开」那一路：不该把用户的偏好改掉
      if (!remember) return;
      try { window.localStorage.setItem(entry.storeKey, open ? "1" : "0"); }
      catch (e) { /* 存不下就只是记不住，不该连展开这个动作本身都失败 */ }
    }

    /* 某个控件所在的折叠（不在任何折叠里就返回 undefined）。联动高亮与
       「拨到按层数就把折叠掀开」两处都靠它找面板。 */
    function advancedPanelOf(wrap) {
      return wrap ? advancedPanels.find((entry) => entry.panel && entry.panel.contains(wrap)) : undefined;
    }

    function mountAdvanced(container, group, items) {
      /* 按钮外壳仍是 .cro-stepper，为的是和左边五枚 stepper 逐格对齐 —— 那边是
         「label 在上、控件在下」两行，这里的 label 位置空着但要占住，否则按钮会顶到
         行首去（.cro-stepper-row 是 align-items:flex-start）。用一个 aria-hidden 的
         不换行空格占位，而不是给按钮硬写 margin-top，这样 label 字号一改它自己跟着走。 */
      const wrap = document.createElement("div");
      wrap.className = "cro-stepper cro-stepper--advanced";

      const spacer = document.createElement("span");
      spacer.className = "cro-stepper__label";
      spacer.setAttribute("aria-hidden", "true");
      spacer.textContent = " ";   // nbsp：占住 label 那一行的高度，按钮才和邻居对齐

      /* id 按行拼（croParallelAdvanced / croBatchAdvanced）—— parallel 那一份与
         改动前逐字相同，页面里指向它的 aria 关系不受影响。 */
      const baseId = "cro" + group.charAt(0).toUpperCase() + group.slice(1) + "Advanced";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "btn btn-sm btn-ghost cro-advanced-toggle";
      toggle.id = baseId + "Toggle";
      toggle.setAttribute("aria-controls", baseId);
      /* 这一枚不长问号：它自己就是一块写着「高级选项」的按钮，整块当触发面积比在
         空着的标签行上吊一个孤零零的问号好读。走的仍是同一个气泡（data-hint）。 */
      setHint(toggle, ADVANCED_TITLE[group] || "");
      const text = document.createElement("span");
      text.textContent = "高级选项";
      const caret = document.createElement("span");
      caret.className = "cro-advanced-toggle__caret";
      caret.innerHTML = CARET;
      toggle.append(text, caret);

      wrap.append(spacer, toggle);
      container.appendChild(wrap);

      const panel = document.createElement("div");
      panel.className = "cro-advanced-panel";
      panel.id = baseId;
      panel.setAttribute("aria-labelledby", toggle.id);
      /* 顺序完全由 ADVANCED_ITEMS 给：普通 stepper 与开关混排，谁挨着谁按「读下来是
         一句话」排 —— parallel 那一行是「先量后档」（VPP 在四枚档位控件之前），
         batch 那一行是「重算层数 / LoRA / LoRA Rank」，各自紧挨着它所属的那一档。
         两种控件走的都是同一个 attachStepper / buildFlagControl，所以红圈、联动高亮、
         置灰理由一样不少。 */
      items.forEach((name) => panel.appendChild(buildItem(name)));
      container.appendChild(panel);

      const entry = { group, panel, toggle, storeKey: advancedStoreKey(group) };
      advancedPanels.push(entry);
      toggle.addEventListener("click", () => {
        setAdvancedOpen(entry, toggle.getAttribute("aria-expanded") !== "true", true);
      });

      setAdvancedOpen(entry, readAdvancedOpen(entry.storeKey), false);
    }

    /* 一枚 FLAG_SPECS 控件：带 options 的是 segmented-control，不带的是开关。
       主行与折叠面板都从这里取，别在两处各判一次。 */
    function buildFlagControl(flag) {
      return FLAG_SPECS[flag].options ? buildFlagChoice(flag) : buildFlagSwitch(flag);
    }

    /* 开关：原生 checkbox + 自绘轨道，选中态 / 空格键 / 焦点环全部由浏览器给。
       轨道右边跟一个「开 / 关」的字：这一行里别的每一格显示的都是一个值，只有轨道
       位置没有值可读，补上这个字才和邻居一致。 */
    function buildFlagSwitch(flag) {
      const spec = FLAG_SPECS[flag];
      const wrap = document.createElement("div");
      wrap.className = "cro-stepper cro-stepper--switch";
      wrap.dataset.field = flag;

      const label = document.createElement("span");
      label.className = "cro-stepper__label";
      fillLabel(label, spec.label, spec.title || "");

      const control = document.createElement("label");
      control.className = "cro-switch";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(config[flag]);
      input.addEventListener("change", () => set(flag, input.checked));

      const track = document.createElement("span");
      track.className = "cro-switch__track";

      const state = document.createElement("span");
      state.className = "cro-switch__label";
      state.textContent = config[flag] ? "开" : "关";

      control.append(input, track, state);
      wrap.append(label, control);
      flagControls.set(flag, { input, state, control, wrap });
      wraps.set(flag, wrap);
      return wrap;
    }

    /* 有限档位字段（权重分片三档、CP 口径两档）：外壳与开关完全相同（.cro-stepper，label 在上、
       控件在下），控件本身换成 MoE 那枚 EP 口径切换用的同一款小号 segmented-control ——
       同一页里「一个量在几档之间二选一/三选一」已经有了既定长相，不再造第二种。
       没有做成 <select>：三档要一眼看全（关 ⊂ ZeRO-1 ⊂ ZeRO-3 是一条阶梯，
       收进下拉里就读不出这层递进关系了）。 */
    function buildFlagChoice(flag) {
      const spec = FLAG_SPECS[flag];
      const wrap = document.createElement("div");
      wrap.className = "cro-stepper cro-stepper--choice";
      wrap.dataset.field = flag;

      const label = document.createElement("span");
      label.className = "cro-stepper__label";
      fillLabel(label, spec.label, spec.title || "");

      const group = document.createElement("div");
      group.className = "segmented-control segmented-control-muted cro-flag-choice";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", spec.label);

      const buttons = spec.options.map((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-sm";
        btn.textContent = opt.label;
        btn.dataset.value = opt.value;
        btn.addEventListener("click", () => set(flag, opt.value));
        group.appendChild(btn);
        return btn;
      });

      wrap.append(label, group);
      choiceControls.set(flag, { group, buttons, wrap });
      wraps.set(flag, wrap);
      return wrap;
    }

    /* 一枚派生读数（Node / Hidden / 全局 Batch 共用）。外壳与 stepper 同类同排版，
       只是把加减键那一格换成一个药丸读数，所以它和左右的 stepper 逐格对齐。 */
    function buildDerivedReadout(key) {
      const spec = DERIVED_SPECS[key];
      const wrap = document.createElement("div");
      wrap.className = "cro-stepper cro-stepper--derived";
      wrap.dataset.field = key;
      const label = document.createElement("span");
      label.className = "cro-stepper__label";
      // 说明都是算出来的（summary 每次 emit 都重算），先建好空的问号占位
      fillLabel(label, spec.label, "");
      const value = document.createElement("span");
      value.className = "cro-stepper__derived";
      wrap.append(label, value);
      derivedReadouts.set(key, value);
      /* 进 wraps：问号浮层与「被联动改掉时闪一下」都按这张表找控件。后者只认
         FIELD_SPECS / FLAG_SPECS 里的字段，所以实际会闪的只有 Node —— Hidden 与
         全局 Batch 不是字段，值跟着别人变，不另外播一次高亮。 */
      wraps.set(key, wrap);
      return wrap;
    }

    function highlightLinkedChanges(before, anchor) {
      // 布尔开关也会被联动改（TP 落回 1 时 SP 被强制关掉），一并纳入
      Object.keys(FIELD_SPECS).concat(Object.keys(FLAG_SPECS)).forEach((field) => {
        if (field === anchor || before[field] === config[field]) return;
        const wrap = wraps.get(field);
        if (!wrap) return;
        /* 被联动改掉的字段正收在「高级」里（TP 落回 1 会强制关掉 SP）：先掀开面板，
           否则这 3 秒高亮就播在一个看不见的地方，yaml 那行自己变了而表单上什么都没动
           —— 正是 disabledValue 那一段要避免的情形。不写回偏好：这是页面替用户掀的。 */
        const holder = advancedPanelOf(wrap);
        if (holder && holder.panel.hidden) setAdvancedOpen(holder, true, false);

        clearTimeout(linkedHighlightTimers.get(field));
        // 先移除并触发布局，再加回 class，使连续联动也能重新播放 3 秒提示。
        wrap.classList.remove("is-auto-adjusted");
        void wrap.offsetWidth;
        wrap.classList.add("is-auto-adjusted");
        linkedHighlightTimers.set(field, setTimeout(() => {
          wrap.classList.remove("is-auto-adjusted");
          linkedHighlightTimers.delete(field);
        }, 3000));
      });
    }

    function apply(field, direction) {
      rangeHint = null;
      const next = stepValue(field, config[field], direction, config);
      if (next === config[field]) return;
      const before = { ...config };
      config[field] = next;
      reconcile(config, field);
      /* 加减键永远经 reconcile 落到自洽态，所以它同时也是手输报错态的第三个出口：
         「把错数步进回合理档位」—— snapPow2 保证从 120 加减是回到 128 / 64，
         而不是在 240 / 60 上继续翻倍。 */
      invalidTyped = null;
      highlightLinkedChanges(before, field);
      emit();
    }

    /* 手输提交。与加减键的根本区别：**不做联动修复**。
       联动一步能改掉三四个数（EP 输 120 会连带 Routed / DP / Total Rank 一起动），
       而用户手输时是在明确指定一个值，替他改掉另外几个是错的手感。
       所以这里只有两条路：能自洽就直接落；不能自洽就停在报错态，把「建议怎么改」
       交给横幅，由用户按下「一键应用」才真的改。 */
    function commitTyped(field, raw) {
      rangeHint = null;
      if (raw === null) { emit(); return; }               // Esc：还原显示，不动配置
      const spec = FIELD_SPECS[field];
      const parsed = Number(String(raw).trim());
      /* 非整数 / 超量程不进报错态：那不是「参数之间不兼容」，是这个数根本不在这一
         维的取值范围里，没有可建议的修法。直接还原，并把量程写给用户看。
         上界读 specMax 而不是 spec.max：重算层数的上界是算出来的（每个 stage 只有
         那么多层），加减键与手输必须认同一个数，否则「加号停在 12、手输 16 却收下了」。 */
      const max = specMax(field, config);
      if (!Number.isInteger(parsed) || parsed < spec.min || parsed > max) {
        rangeHint = { field, raw: String(raw).trim(), max };
        emit();
        return;
      }
      if (parsed === config[field]) { emit(); return; }
      config[field] = parsed;
      if (!validate(config).length) {
        // 手输的数本身就自洽（PP=3、DP=120 配上对应的 Total Rank）：直接落，无需横幅
        invalidTyped = null;
        emit();
        return;
      }
      invalidTyped = { field, value: parsed, proposal: proposeFix(config, field) };
      emit();
    }

    function set(field, value) {
      rangeHint = null;
      invalidTyped = null;                 // 程序化赋值走 reconcile，必然落到自洽态
      if (config[field] === value) return;
      const before = { ...config };
      config[field] = value;
      reconcile(config, field);
      highlightLinkedChanges(before, field);
      /* 拨到「重计算 · 按层数」时把 batch 那个折叠掀开（升级计划行 19）：这一档带着
         的那枚「重算层数」正收在里面，不掀开等于拨了一个当场看不出效果的档 ——
         而这一档与另外三档的区别恰恰全在那个数上。
         与联动高亮同一路：不写回用户偏好，这是页面替他掀的。 */
      if (field === "recomputeMode" && value === "layers") {
        const holder = advancedPanelOf(wraps.get("recomputeLayers"));
        if (holder && holder.panel.hidden) setAdvancedOpen(holder, true, false);
      }
      emit();
    }

    /* 整网切换模型：不是单字段的 stepper 调整，而是把并行/批次/MoE 全部换成
       新模型的 defaults（两个模型的层数、并行拓扑、是否有 MoE 都不同，不能只改
       一个字段再 reconcile）。defaults 本身已自洽（见 MODEL_PRESETS 里的注释
       校验），不需要再跑 reconcile()。 */
    function setModel(modelId) {
      const preset = MODEL_PRESETS[modelId];
      if (!preset || config.model === modelId) return;
      // 整份换成新模型的 defaults（本身自洽），手输留下的报错态随之作废
      rangeHint = null;
      invalidTyped = null;
      config.model = modelId;
      Object.assign(config, preset.defaults);
      config.node = nodeLayout(config).node;      // defaults 的 node 只是种子
      // defaults 里的 dp 一律按切出口径记；正交档下要按 EP 换算回去，否则 world 差一个 EP 倍。
      // mf 档与切出档的 world 公式相同，不必换算（行 23）。
      if (epIsOrthogonal(config)) {
        config.dp = convertDpAcrossEpMode(config.dp, config.ep, true);
      }
      emit();
    }

    /* EP 口径切换：不是一个 stepper 字段 —— 它改的是 world 公式与 EP 切自哪个域，
       所以单开一个入口而不是走 set()。三档（升级计划行 23）：

         split ↔ mf   world 公式相同（EP 都不进乘积），**DP 不换算** —— 变的只是
                      EP 从哪个域里切：DP 还是 DP×MP。换过去之后 EDP 会变（行数
                      多出 TP 倍），整除约束也从 DP%EP 换成 (DP×TP)%EP。
         ↔ orthogonal 那一档 EP 独占 rank，DP 要按 EP 换算，Total Rank 才不变：
                      同一份 2048 卡，切出/mf 档读作 DP512，正交档读作 DP8。

       anchor 传 dp：reconcile 走 else 分支，由换算后的 world 反推 Total Rank。 */
    function setEpMode(mode) {
      /* 兼容老调用：setEpMode(true/false) 是行 23 之前的布尔签名。 */
      const next = typeof mode === "boolean"
        ? (mode ? "orthogonal" : "split")
        : (EP_MODES.indexOf(mode) >= 0 ? mode : "split");
      const current = epModeOf(config);
      if (current === next) return;
      rangeHint = null;
      invalidTyped = null;                 // 换口径后走 reconcile，落到自洽态
      const before = { ...config };
      config.epMode = next;
      config.moeOrthogonal = next === "orthogonal";   // 老字段跟着走，别留两套真相
      if ((current === "orthogonal") !== (next === "orthogonal")) {
        config.dp = convertDpAcrossEpMode(config.dp, config.ep, next === "orthogonal");
      }
      reconcile(config, "dp");
      // anchor 传 null：DP 这一跳正是要提示的联动，不该被当成"用户自己改的"而排除
      highlightLinkedChanges(before, null);
      emit();
    }

    /* 报错横幅：错在哪 → 建议怎么改 → 两个出口。
       ⚠️ 设计系统没有 alert / banner 组件（css/style.css 里只有 .btn 系列），
       这里用 tokens 拼一个最小实现，按钮复用 .btn / .btn-sm / .btn-ghost；
       与本文件的 select 同属「缺失样式」，待批准后应吸收进共享系统。 */
    function renderConfigError(topology) {
      const el = document.getElementById("croConfigError");
      if (!el) return;
      el.textContent = "";
      const warnings = topology.valid ? (topology.warnings || []) : [];
      /* 两档互斥：冻结态下不说软警告，所以一个横幅要么是红的要么是黄的。 */
      el.classList.toggle("is-blocking", !topology.valid);
      el.classList.toggle("is-warning", warnings.length > 0);

      if (rangeHint) {
        const spec = FIELD_SPECS[rangeHint.field];
        const line = document.createElement("p");
        line.className = "cro-config-error__msg";
        line.textContent = `${spec.label} 只接受 ${spec.min}–`
          + `${rangeHint.max === undefined ? spec.max : rangeHint.max} 之间的整数`
          + `，「${rangeHint.raw}」已还原`;
        el.appendChild(line);
        rangeHint = null;                      // 一次性提示，下一次操作即消失
        if (topology.valid) { renderWarnings(el, topology); return; }
      }
      /* 软警告只在配置自洽时说。冻结态下配置本身还自相矛盾，此刻的「性能提示」
         是照着一组不成立的数算出来的，摆在红字旁边只会分散注意力 —— 硬错误清掉
         之后它自己就出来了。 */
      if (topology.valid) { renderWarnings(el, topology); return; }

      const msg = document.createElement("p");
      msg.className = "cro-config-error__msg";
      msg.textContent = topology.errors.join("；");
      /* 停更接在错误文字后面同一行：它是这条错误的**后果**，不是第二条错误，
         另起一行会读成并列的两件事。 */
      const frozen = document.createElement("span");
      frozen.className = "cro-config-error__frozen";
      frozen.textContent = "图形已暂停更新，仍显示上一组自洽的参数";
      msg.appendChild(frozen);
      el.appendChild(msg);

      const fix = document.createElement("div");
      fix.className = "cro-config-error__fix";
      const proposal = invalidTyped && invalidTyped.proposal;
      if (proposal) {
        const label = FIELD_SPECS[invalidTyped.field].label;
        /* 布尔开关也进清单：建议里若含「TP 降到 1」，SP 会被一并关掉，
           不列出来就等于「一键应用」偷偷拨了一枚开关。读数一律走 flagText ——
           开关写「开 / 关」、三档写那一档的 label，别把 true/false 或 "fsdp2"
           这种内部值露给用户。 */
        const changes = Object.keys(FIELD_SPECS)
          .filter((f) => f !== invalidTyped.field && proposal[f] !== config[f])
          .map((f) => `${FIELD_SPECS[f].label} ${config[f]} → ${proposal[f]}`)
          .concat(Object.keys(FLAG_SPECS)
            .filter((f) => proposal[f] !== config[f])
            .map((f) => `${FLAG_SPECS[f].label} ${flagText(f, config[f])} → ${flagText(f, proposal[f])}`));
        fix.textContent = changes.length
          ? `为了兼容 ${label} = ${invalidTyped.value}，建议把 ${changes.join("、")}`
          : `为了兼容 ${label} = ${invalidTyped.value}，无需改动其它字段`;
      } else {
        fix.textContent = "没能算出兼容这个数的改法 —— 换一个值，或退回上一组参数";
      }
      el.appendChild(fix);

      const actions = document.createElement("div");
      actions.className = "cro-config-error__actions";
      if (proposal) {
        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "btn btn-sm";
        applyBtn.textContent = "一键应用";
        applyBtn.addEventListener("click", () => {
          const before = { ...config };
          const anchor = invalidTyped.field;
          Object.assign(config, proposal);
          invalidTyped = null;
          highlightLinkedChanges(before, anchor);   // 被建议改掉的那几枚闪一下
          emit();
        });
        actions.appendChild(applyBtn);
      }
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-sm";
      cancelBtn.textContent = "取消修改";
      cancelBtn.addEventListener("click", () => {
        // 整份退回最近一次自洽快照：手输可能连着改了几个字段，只还原最后一个不够
        if (lastValidConfig) Object.assign(config, lastValidConfig);
        invalidTyped = null;
        emit();
      });
      actions.appendChild(cancelBtn);
      el.appendChild(actions);
    }

    /* 软警告：能跑，但跑得不好。与红字的区别不只是颜色 —— 它不标红 stepper、
       不冻结图形、不进建议修法，只是一句「这么配性能会掉」。行文里点住涉事字段
       的名字（"TP 16 …"），定位就够了，不再给第二种颜色的圈。
       结构与红字横幅同构：多条用「；」串成一段（红字那边 errors 也是这么串的），
       后面接一句限定 —— 黄和红的差别不能只靠颜色记，得写出来。 */
    function renderWarnings(el, topology) {
      const warnings = topology.warnings || [];
      if (!warnings.length) return;
      const line = document.createElement("p");
      line.className = "cro-config-error__warn";
      const label = document.createElement("b");
      label.textContent = "性能提示：";
      line.append(label, document.createTextNode(warnings.join("；")));
      const note = document.createElement("span");
      note.className = "cro-config-error__warn-note";
      note.textContent = "配置合法，图形照常更新 —— 这一条不拦截";
      line.appendChild(note);
      el.appendChild(line);
    }

    function emit() {
      const topology = derive(config);
      readouts.forEach((el, field) => {
        // 正在输入的那一枚不覆写，否则会打断光标和选区
        if (el === document.activeElement) return;
        el.value = String(config[field]);
        el.size = readoutSize(field, el.value);   // 跟着位数收放，见 buildStepper
      });
      flagControls.forEach(({ input, state, control, wrap }, flag) => {
        input.checked = Boolean(config[flag]);
        state.textContent = config[flag] ? "开" : "关";
        const spec = FLAG_SPECS[flag];
        const usable = !spec.enabledWhen || spec.enabledWhen(config);
        input.disabled = !usable;
        wrap.classList.toggle("is-unavailable", !usable);
        /* 置灰的理由排在正文**之前** —— 此刻用户想知道的是「为什么点不动」，
           不是这个开关是干什么的。问号是标签里的一枚 <button>，整枚控件置灰也不影响
           它收 hover（原生 disabled 的 input 才收不到，那正是原先把 title 挂在外层
           <label> 上的原因）。 */
        setHint(wrap.querySelector(".cro-hint"), spec.title, usable ? "" : spec.disabledReason);
      });
      /* 与上面那段逐条对应，只是选中态落在按钮的 is-selected / aria-pressed 上。
         不可用时**不用原生 disabled**：设计系统的 .btn:disabled 带 pointer-events:none，
         按钮收不到 hover，理由就弹不出来 —— 与加减键那边同一个坑，见 stepButtons 一段。
         用 aria-disabled + 一个类，点击照旧无害（set 到当前值时下游本来就不动）。 */
      choiceControls.forEach(({ group, buttons, wrap }, flag) => {
        const spec = FLAG_SPECS[flag];
        const usable = !spec.enabledWhen || spec.enabledWhen(config);
        buttons.forEach((btn) => {
          const on = btn.dataset.value === config[flag];
          btn.classList.toggle("is-selected", on);
          btn.setAttribute("aria-pressed", String(on));
          btn.setAttribute("aria-disabled", String(!usable));
        });
        wrap.classList.toggle("is-unavailable", !usable);
        setHint(wrap.querySelector(".cro-hint"), spec.title, usable ? "" : spec.disabledReason);
      });
      /* 三枚派生读数一起刷：值与口径都由各自的 summary 现算（见 DERIVED_SPECS），
         所以拨 Total Rank、拨 MBS / DP / 微批数、换模型都会就地跟上。 */
      derivedReadouts.forEach((el, key) => {
        const summary = DERIVED_SPECS[key].summary(config);
        el.textContent = summary.text;
        setHint(wraps.get(key)?.querySelector(".cro-hint"), summary.title);
      });
      /* 走不动的那一头置灰并挂上理由。48 头的模型 TP 到 16 就到顶了（32、64 都除
         不尽头数，stepValue 会跳过它们），不置灰的话加号按下去毫无反应、看着像页面
         卡了；而只置灰不给理由同样解释不了 —— 它到顶的原因根本不在这一行表单里。
         量程端点（Seq Length 到下界、Shared 到 0）本来就是同一种「按了不动」，
         顺带一起如实标出来。判据直接问 stepValue，不另写一套档位规则。
         ⚠️ 用 aria-disabled 而不是原生 disabled：设计系统的 .btn:disabled 带
         pointer-events:none，按钮收不到 hover，title 压根弹不出来。点击无害 ——
         apply() 里 next === 现值时本来就直接 return。 */
      stepButtons.forEach((btns, field) => {
        /* 整枚不可用的（未开 LoRA 的 Rank、非「按层数」档的重算层数，升级计划行 18 / 19）：
           连输入框一起置灰，外壳挂上 is-unavailable —— 与那几枚开关同一副长相，
           判据也同一条（stepValue 已经让加减键原地不动，这里只是把它说出来）。
           输入框用原生 disabled：理由挂在外壳 .cro-stepper 上，指针事件到得了。 */
        const spec = FIELD_SPECS[field];
        const usable = !spec.enabledWhen || spec.enabledWhen(config);
        const wrap = wraps.get(field);
        if (wrap) {
          wrap.classList.toggle("is-unavailable", !usable);
          /* 两件事分两个属性存、气泡里分两块排，不再拼成一根字符串：
             `spec.title` 是「这枚是干什么的」（buildStepper 建好时挂的），
             `spec.disabledReason` 是「此刻为什么不可用」，后者排在正文之前 ——
             与那几枚开关（buildFlagSwitch / buildFlagChoice 那两处）同一种写法。
             ⚠️ 别写成「不可用时只留理由」：那会把 buildStepper 挂上的说明抹掉，
             VPP 的悬浮曾经就是这么丢的。
             title 写成函数的字段（Routed / EP）也在这里拿到当前拓扑落成文字。 */
          setHint(wrap.querySelector(".cro-hint"), fieldTitle(spec, topology), usable ? "" : spec.disabledReason);
        }
        const readout = readouts.get(field);
        if (readout) readout.disabled = !usable;
        [-1, 1].forEach((dir, i) => {
          const btn = btns[i];
          if (stepValue(field, config[field], dir, config) !== config[field]) {
            btn.removeAttribute("aria-disabled");
            setHint(btn, "");
            return;
          }
          btn.setAttribute("aria-disabled", "true");
          // 加减键不长问号：它自己就是那个「按了不动」的东西，整枚键当触发面积
          setHint(btn, "", stepBlockReason(field, dir, config));
        });
      });
      // 校验失败时给出提示：把相关 stepper 标红，并在 #croConfigError 写出原因
      const badFields = new Set();
      if (!topology.valid) {
        topology.errors.forEach((message) => {
          Object.keys(FIELD_SPECS).forEach((field) => {
            if (message.includes(FIELD_SPECS[field].label)) badFields.add(field);
          });
        });
        // 手输的那一枚一定标红：错误文案里未必出现它的 label（比如 Total Rank）
        if (invalidTyped) badFields.add(invalidTyped.field);
        /* 横幅建议要改的那几枚也一起标红。只靠错误文案的 label 匹配会漏一大片：
           「Routed 232 不能被 EP 53 整除」只点了 Routed 与 EP 的名，可 DP 与
           Total Rank 同样与这个输入值不兼容，一个字都没出现。
           **红圈的名单必须与横幅列的名单一致** —— 否则用户看到横幅让改三个数、
           页面只红了一个，会以为横幅算错了。 */
        if (invalidTyped && invalidTyped.proposal) {
          Object.keys(FIELD_SPECS).concat(Object.keys(FLAG_SPECS)).forEach((field) => {
            if (invalidTyped.proposal[field] !== config[field]) badFields.add(field);
          });
        }
      }
      if (rangeHint) badFields.add(rangeHint.field);
      wraps.forEach((el, field) => el.classList.toggle("is-invalid", badFields.has(field)));
      /* 被标红的字段正收在「高级」里就先掀开面板 —— 「红圈的名单必须与横幅列的名单
         一致」这条，在折叠出现之后要多守一步：横幅让改 VPP，页面却红在一个看不见的
         地方，读起来就是横幅算错了。与联动高亮同一路，同样不写回用户偏好。
         （VPP 进折叠之后这条才真正必要：手输它得先展开，但**别的字段**手输后的建议
         修法里可以带上它。） */
      badFields.forEach((field) => {
        const holder = advancedPanelOf(wraps.get(field));
        if (holder && holder.panel.hidden) setAdvancedOpen(holder, true, false);
      });
      renderConfigError(topology);

      /* 参数不兼容时**不往下游发**：集群矩阵、整网 deck、单卡容量、YAML 一律停在
         上一组自洽参数上。这页最会骗人的错误就是「数字和图形各说各话」——
         宁可图形滞后一步，也不让它按一组自相矛盾的数字画出一个看着挺合理的样子。 */
      if (!topology.valid) return;
      lastValidConfig = { ...config };
      lastValidTopology = topology;
      listeners.forEach((fn) => fn(topology));
      document.dispatchEvent(new CustomEvent("cro:change", { detail: topology }));
    }

    /* ── 批量导入（升级计划行 20）─────────────────────────────────────────
       与 set() 的区别是「一次落一片」：导入一份外部配置时，dp / tp / pp / ep / 层数
       / 开关十几项要同时生效，逐个 set 会在中途反复走 reconcile —— 第一次就把还没
       落地的那几项当成矛盾去「修」了（先落 ep=32 而 dp 还是旧值，EP 当场被收回去），
       落到最后是一组谁也不认识的数。所以：**先整片赋值，最后配平一次**。

       anchor 传 null：这一片里没有哪个字段是「用户刚拨的那一枚」，
       reconcile 的所有修复分支因此都走「不锚定」那条路 —— 该收谁收谁。

       返回 before/after 两份快照，调用方拿它算「你给的 vs 页面收下的」。
       ⚠️ 这个差值必须被显示出来：外部配置常常与本页口径不兼容（MindFormers 的 EP
       是在 dp×mp 域上切的，页面按 dp 域校验，见升级计划行 23），配平会**改数**，
       不报出来就是静默篡改 —— 比当场报错更危险。 */
    function importConfig(partial) {
      const before = { ...config };
      const known = Object.keys(partial).filter((f) => FIELD_SPECS[f] || FLAG_SPECS[f]);
      /* EP 口径既不是 stepper 也不是开关（它改的是 world 公式与切分域，走 setEpMode），
         所以两张表都筛不到它 —— 但它必须**先**落：dp / ep 的整除判据跟着它换（行 23）。
         这里不做 DP 换算：那份配置里的 dp 本来就是按它自己那一档写的。 */
      let epModeApplied = false;
      if (EP_MODES.indexOf(partial.epMode) >= 0 && partial.epMode !== epModeOf(config)) {
        config.epMode = partial.epMode;
        config.moeOrthogonal = partial.epMode === "orthogonal";
        epModeApplied = true;
      }
      known.forEach((field) => {
        const value = partial[field];
        if (FIELD_SPECS[field]) {
          const spec = FIELD_SPECS[field];
          const n = Number(value);
          // 超量程的整数夹回去，非整数直接丢 —— 导入不该把页面推进报错态
          if (!Number.isFinite(n) || !Number.isInteger(n)) return;
          config[field] = Math.min(spec.max, Math.max(spec.min, n));
          return;
        }
        const spec = FLAG_SPECS[field];
        if (spec.options) {
          if (spec.options.some((o) => o.value === value)) config[field] = value;
        } else {
          config[field] = Boolean(value);
        }
      });
      if (epModeApplied) known.push("epMode");
      rangeHint = null;
      invalidTyped = null;
      reconcile(config, null);
      // 被配平改掉的那几枚一并闪一下：导入是一次「页面替你改了十几个数」的动作
      highlightLinkedChanges(before, null);
      emit();
      return { before, after: { ...config }, known };
    }

    return {
      config,
      mount,
      set,
      setModel,
      setEpMode,
      importConfig,
      /* 冻结期间也返回上一组自洽拓扑：视图侧除了监听 cro:change，还会在别的时机
         直接读它（比如窗口尺寸变化时重算集群矩阵的列数）。只掐事件不掐这里的话，
         一次拖窗口就能把不自洽的参数画进矩阵，冻结就漏了。 */
      get topology() {
        const current = derive(config);
        return current.valid || !lastValidTopology ? current : lastValidTopology;
      },
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
    const base = {
      id: preset.id,
      label: preset.label,
      layerCount: counts.totalLayer,
      depthGap: preset.deck.depthGap,
      frontLayer: Math.floor(lastLayer / 2),   // 正视图默认停在中间层（46 层 → L23）
      blockPostLayers: preset.deck.blockPostLayers.filter((l) => l <= lastLayer),
      stageRanges: stages.map((s) => [s.lo, s.hi]),
      representativeLayers: stages.map((s) => s.lo),
    };
    if (preset.noMoe) {
      return {
        ...base,
        firstMoeLayer: counts.totalLayer,     // 全 Dense：永不触发 MoE 分支
        denseLayers: layers.map((l) => l.index),
        dsaLayers: [],
        routedExperts: 0,
        topK: 0,
        heads: preset.heads,
        kvHeads: preset.kvHeads,
        mtp: false,
        residualLabel: preset.deck.residualLabel,
        sideRows: preset.deck.sideRows,
      };
    }
    return {
      ...base,
      firstMoeLayer: counts.denseLayers,
      denseLayers: layers.filter((l) => l.ffn === "dense").map((l) => l.index),
      dsaLayers: layers.filter((l) => l.attention === "dsa").map((l) => l.index),
      routedExperts: counts.routedExpert,
      topK: counts.topK,
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
    const initialPanY = -18; // 正视图视觉重心略偏下，本页默认上移少许，免去每次手拖。
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
      controller.setPose?.({ panY: initialPanY });
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
    /* deck 正视图一次只显示 rel.deckLayer 那一张卡，而"相关"是按真实层号判的。
       两者平时是同一个层（deckLayer 一律取自 rel.layers）；万一正在显示的卡
       不在 rel.layers 里，它的节点会全被判成不相关，而"亮"在 deck 上是靠**其余
       节点变灰**表达的，结果就是整张卡一个节点都不亮。
       所以把当前展示的那一层也算作相关。只在关系确实覆盖到层时才生效：Emb /
       Norm / Head 这类端点选择 rel.layers 是空的，它们该亮的是 staticNodes 里
       那几个静态节点，不能顺手把 L0 整张卡点亮。 */
    const proxy = rel && rel.layers.size && Number.isFinite(rel.deckLayer) ? rel.deckLayer : null;
    const relatedLayer = (l) => Boolean(rel) && (rel.layers.has(l) || l === proxy);
    const layerOf = (el) => Number(el.closest(".pto-model-deck__layer")?.dataset.layer);
    host.querySelectorAll(".pto-model-deck__layer").forEach((card) => {
      card.classList.toggle("is-related", relatedLayer(Number(card.dataset.layer)));
    });
    host.querySelectorAll(".pto-model-deck__node, .pto-model-deck__experts").forEach((node) => {
      const layer = layerOf(node);
      const related = Boolean(rel) && (Number.isFinite(layer)
        ? relatedLayer(layer)
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
  /* 撞到下限还塞不下时的三级退让底线（见 layoutLayerNav）：
     组间缝 → 组内间隙 → 刻度本身。刻度 0.75px 时 256 层也不溢出。 */
  const NAV_SPLIT_MIN = 4;
  const NAV_GAP_MIN = 0.25;
  const NAV_TICK_FLOOR = 0.6;
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

  /* ══ 悬浮气泡（全页统一）══════════════════════════════════════════════════
     两条老路都不好使：
       · 原生 title —— 要按住不动 ~1s 才弹，Layer 刻度只有 3~4px 宽，光是"停稳"
         就够费劲，再等一秒等于查不了层号；样式也完全不可控。
       · 伪元素气泡（training-run-twin.css 的 .twin-heat-cell::after）—— 画在格子
         内部，会被 .cro-heat / 刻度带自己的滚动裁剪切掉，边缘一圈格子只能看到
         半个气泡。
     所以统一挂一个 body 级的 position:fixed 气泡，事件委托到 document：谁带
     data-tip 就给谁弹，位置按目标 rect 现算并夹在视口内，与任何祖先的 overflow
     都无关。 */
  let tipEl = null;
  let tipTarget = null;
  let tipTimer = 0;

  function placeTip(target) {
    const rect = target.getBoundingClientRect();
    const box = tipEl.getBoundingClientRect();
    const GAP = 8;
    const EDGE = 8;
    // 默认贴在目标上方；上方装不下（刻度带在页面顶部、集群图首行同理）翻到下方
    let top = rect.top - box.height - GAP;
    if (top < EDGE) top = Math.min(rect.bottom + GAP, global.innerHeight - box.height - EDGE);
    const half = box.width / 2;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - half, EDGE),
      Math.max(EDGE, global.innerWidth - box.width - EDGE),
    );
    tipEl.style.top = `${Math.max(EDGE, top)}px`;
    tipEl.style.left = `${left}px`;
  }

  function hideTip() {
    global.clearTimeout(tipTimer);
    tipTarget = null;
    if (tipEl) tipEl.classList.remove("is-visible");
  }

  function showTip(target) {
    const text = target.dataset.tip;
    if (!text) return;
    tipTarget = target;
    tipEl.textContent = text;
    tipEl.classList.add("is-visible");
    // 先可见才量得到尺寸（气泡宽度随文字走），再定位
    placeTip(target);
  }

  function installTipLayer() {
    if (tipEl) return;
    tipEl = document.createElement("div");
    tipEl.className = "cro-tip";
    tipEl.setAttribute("role", "tooltip");
    document.body.appendChild(tipEl);

    // 60ms 只为压掉快速划过时的连闪，不构成"等待"
    const arm = (target) => {
      if (target === tipTarget) return;
      global.clearTimeout(tipTimer);
      tipTimer = global.setTimeout(() => showTip(target), 60);
    };
    document.addEventListener("pointerover", (event) => {
      const target = event.target.closest?.("[data-tip]");
      if (target) arm(target);
      else if (tipTarget) hideTip();
    });
    document.addEventListener("pointerdown", hideTip);
    // 滚动/缩放后 rect 已经不是气泡当初贴的那个位置，直接收掉而不是跟着漂
    global.addEventListener("scroll", hideTip, true);
    global.addEventListener("resize", hideTip);
    // 键盘走查同样要看得到（刻度带/集群网格用方向键、Tab 移动焦点）。
    // 只认 :focus-visible —— 鼠标点击也会 focus，那时刚被 pointerdown 收掉的气泡
    // 会立刻弹回来挡住刚选中的东西。
    document.addEventListener("focusin", (event) => {
      const target = event.target.closest?.("[data-tip]");
      if (target && target.matches?.(":focus-visible")) showTip(target);
      else hideTip();
    });
    document.addEventListener("focusout", hideTip);
    // 配置一改，集群网格/刻度带整体重建，气泡贴着的那个元素已经不在了 ——
    // 光标没动就不会有 pointerover，得主动收掉，否则悬在半空
    document.addEventListener("cro:change", hideTip);
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
          // 用 data-tip 而不是 title：原生 title 有 ~1s 延迟，刻度只有几像素宽，
          // 悬浮查层号是这条带子的主要用法，等不起（见 installTipLayer）
          tick.dataset.tip = col.name;
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
          tick.dataset.tip = `Layer ${slot.layer} · PP${layer.stage} · ${layer.ffn === "dense" ? "Dense" : "MoE"} · ${layer.attention.toUpperCase()}`;
          tick.setAttribute("aria-label", tick.dataset.tip);
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
      // 段窄到放不下全名时退到短名（PP15 → 15），见 fitNavLabel
      span.dataset.full = `PP${entry.stage}`;
      span.dataset.short = String(entry.stage);
      span.dataset.tip = entry.title;
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
      span.dataset.full = entry.label;
      span.dataset.short = entry.label.slice(0, 1);
      // 标签被压短/压没时还得答得出这一段是什么，故补一条 tip
      span.dataset.tip = entry.label;
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
    const g = groups.length;
    const inner = ticks - g;                 // 组内间隙总数
    const span = 2 * ticks - g;
    let tick = Math.max(NAV_TICK_MIN, Math.min(NAV_TICK_MAX,
      width / (span + NAV_SPLIT_RATIO * g)));
    let gap = tick;                          // 常态：组内间隙与刻度同宽
    let split = (width - tick * ticks - gap * inner) / g;

    /* 层数很多时（61 层的 deepseek3、96 层的 175B，再叠上 PP16 的分段），刻度撞到
       下限之后总宽仍然超出带子 —— 原先的写法把 split 硬夹到 4px 就不管了，于是
       整条刻度带**横向溢出**：右侧的层被 overflow:hidden 切掉，而分隔线与 PP 标签
       是按实测组位置定位的，它们跟着跑到带子外面 —— 这就是「有些配置 layer 导航
       错位、看不到层」的由来。
       解法是按「先压组间缝、再压组内间隙、最后才压刻度本身」的顺序退让，保证
       等式 width = tick·n + gap·inner + split·g 始终成立，一格都不溢出。 */
    if (split < NAV_SPLIT_MIN) {
      split = NAV_SPLIT_MIN;
      if (inner > 0) {
        gap = (width - split * g - tick * ticks) / inner;
        if (gap < NAV_GAP_MIN) gap = NAV_GAP_MIN;
      }
      const rest = width - split * g - gap * Math.max(0, inner);
      tick = Math.max(NAV_TICK_FLOOR, Math.min(tick, rest / ticks));
    }
    container.style.setProperty("--cro-tick-w", `${tick}px`);
    container.style.setProperty("--cro-tick-gap", `${gap}px`);
    container.style.setProperty("--cro-nav-split", `${split}px`);
    /* 刻度窄到 2px 以下时，空心药丸的两条 1px 描边已经糊在一起 —— 那时改画成
       实心细条（见 .cro-layer-nav.is-dense），一排等距细线至少还读得出「这里是
       一层一层」，而糊掉的药丸只是一片灰。 */
    container.classList.toggle("is-dense", tick < 2);

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
      const box = Math.max(0, right - left);
      el.style.left = `${left}px`;
      el.style.width = `${box}px`;
      el.style.visibility = "visible";
      fitNavLabel(el, box);
    });
  }

  /* 段窄到放不下标签时怎么办：标签是绝对定位 + 定宽 + overflow:hidden 的，硬塞
     进去会被从两侧切掉，「PP15」只剩中间的「P1」—— 读不出，还看着像错位。
     所以退让两步：全名 → 短名（PP15 → 15、Dense → D），仍放不下就整条不显示。
     段界由分隔线交代，段名悬浮到标签位或刻度上照样报得出（data-tip），
     信息一条没丢，只是不硬印在一个放不下它的格子里。 */
  function fitNavLabel(el, box) {
    const full = el.dataset.full || el.textContent;
    const short = el.dataset.short || full;
    el.textContent = full;
    // 1px 容差：box 是实测的小数宽，scrollWidth 取整后常大 0.x
    if (el.scrollWidth <= box + 1) return;
    if (short !== full) {
      el.textContent = short;
      if (el.scrollWidth <= box + 1) return;
    }
    el.textContent = "";
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
    // Qwen2-7B（GQA，无 mHC 低秩投影）：Q/K/V 三路并排，见 layerHtmlQwen
    { id: "qwen_qkv", lanes: [["q_proj"], ["k_proj"], ["v_proj"]] },
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

  /* ══ MoE 宫格的「绑定」═══════════════════════════════════════════════════
     宫格里的卡片画的是**一个 EP group 内部**的 EP rank（0…EP-1），不是集群里的
     global rank。EP=64 时它写着 Rank 0~63，而集群有 2048 张卡 —— 这个编号被读成
     global rank 几乎是必然的，而且读错之后整条关系都跟着错。

     根子在于：EP rank → global rank 的换算需要 rankOf(stage, dpIdx, epIdx, inner)，
     而 stage 与 dpIdx 不在 MoE 区里 —— 它们由「你在看哪一个 MoE layer / 哪一张卡」
     决定。没有这个上下文时，宫格只是一张**示意图**，压根没有确定的编号可标。

     「能标编号」与「能点」是**两件事**，条件不同，所以分开判：

       · 能标编号（binding）—— 需要 stage + dpIdx。点一个 MoE layer、一段 PP、或
         集群里某张卡都能定住 stage，此时每张卡标上对应的 global rank。
       · 能点（drill）—— 还需要**具体是哪一个 MoE layer**。专家实例是按层分的：
         同一个编号在每层各有一份、权重互不相干，只定到 stage（一段 PP 里往往有
         十几个 MoE 层）仍然回答不了「你问的是哪一层的那份」。所以点 Cluster 的
         rank 格只标号、不放开点击；只有点了某个 MoE Layer 才放开。

     binding 判据「rel.stages.size === 1 && rel.epRanks.size > 0」：前半是数学上的
     充要条件（rankOf 少了 stage 就算不出来），后半排掉「点了一个 Dense 层」这类
     虽然只压一个 stage、却与专家无关的选择。 */

  /* 禁点说明。两种禁点态共用同一段正文（都是同一个道理：没指定层就问不出实例），
     只有末尾一句按「编号是否也一并隐去」分岔 —— 正文里不能写死「编号已隐去」，
     按 Cluster rank 进来时编号是标着的。 */
  const MOE_NO_DRILL_HINT =
    "每个 MoE layer 有相互独立的一套专家，且所在的 Rank 可能不同；编号相同的 Expert，在不同层里权重一定不同。\n\n"
    + "所以在指定是**哪一个 MoE layer** 之前，点一个格子无法确定问的是哪一层的那份实例 —— 这张宫格此刻只是一个 EP group 的示意，点击不发出连线，免得把一条根本没确定下来的对应关系画成确定的。\n\n"
    + "请点 Layer 布局刻度带上的一个 MoE Layer，再回到这里下钻。";
  const MOE_UNBOUND_TAIL =
    "\n\n（卡片上的编号也因此先隐去：那是「EP 组内的第几个」，不是集群里的 global rank。"
    + "点一个 MoE Layer 或 Cluster 里的一张 Rank 卡，就能定出 PP stage，编号随之标出。）";

  /* 当前选择能不能把宫格实例化。返回 { stage, dpIdx, layer, exactDp } 或 null。
     dpIdx 只有点集群里某张卡时才是确定的；从层/PP 段进来时整段横跨全部 EDP 副本，
     取副本 0 并在标题上写明 —— 不写明就等于又造了一个「看着确定、其实是我挑的」
     的编号，与这次要治的毛病同源。
     layer 认两种来源：直接点层（kind:"layer"），以及在已绑定的宫格里继续下钻
     （kind:"expert"/"epRank" 带着 scopeLayer）—— 后者必须认，否则一点专家层号
     就丢了，口径会从「Layer 38」退回「PP3 整段」，而下钻本来就发生在那一层里。 */
  function moeBindingOf(rel, topology) {
    if (!rel || rel.stages.size !== 1 || rel.epRanks.size === 0) return null;
    const stage = Array.from(rel.stages)[0];
    if (!Number.isFinite(stage) || !topology.stages[stage]) return null;
    const p = rel.primary || {};
    const exactDp = Number.isFinite(p.dpIdx);
    const dpIdx = exactDp ? p.dpIdx : 0;
    const claimed = p.kind === "layer" ? p.layer : p.scopeLayer;
    const layer = Number.isFinite(claimed)
      && topology.layers[claimed]?.ffn === "moe"
      && topology.stageOfLayer(claimed) === stage
      ? claimed
      : null;
    return { stage, dpIdx, layer, exactDp };
  }

  /* 宫格能不能点、点了带什么上下文 —— 点击回调是建 DOM 时的闭包，拿不到此刻的
     relation，所以把绑定写在 dataset 上，点的时候现读。
     没有 moeBindLayer 就返回 null：标了编号不等于能点（见上面那段）。 */
  function moeBoundOf(host) {
    if (!host || host.dataset.moeBound !== "1") return null;
    const num = (key) => (host.dataset[key] === "" || host.dataset[key] == null
      ? null
      : Number(host.dataset[key]));
    const stage = num("moeBindStage");
    const layer = num("moeBindLayer");
    if (!Number.isFinite(stage) || !Number.isFinite(layer)) return null;
    return {
      stage,
      dpIdx: Number.isFinite(num("moeBindDp")) ? num("moeBindDp") : 0,
      layer,
    };
  }

  /* ══ 渲染：MoE 专家面板（第 5 项）════════════════════════════════════════
     共享专家 SE0…（始终激活，不参与路由）+ 路由专家按 EP rank 分组，
     每组 routedExpert / ep 个专家。分组与成员全部由 topology.epRanks 派生，
     改 Routed Expert / EP 立即重建。 */
  /* 专家胶囊那一格铺几列。上限 4：EP 拨小时一个 rank 会拿到 8 / 16 个专家，
     挤在一行里每枚只剩几像素，"E12" 被压成一道竖条；满 4 换行，卡片跟着长高
     （css 的 .cro-moe-group__experts 是 grid，列数读这个变量）。
     不足 4 个时列数收到实际个数，胶囊仍铺满整行宽 —— 否则「1 个共享专家」会
     缩成四分之一宽、右边空着三格。0 个（无共享专家的空态）也得给 1，
     repeat(0, …) 是非法值。 */
  function setExpertCols(host, count) {
    if (!host) return;
    host.style.setProperty("--cro-expert-cols", String(Math.max(1, Math.min(4, count))));
  }

  function renderMoe(sharedHost, routedHost, topology, emit) {
    const { counts, epRanks, hasMoe } = topology;
    if (sharedHost) sharedHost.innerHTML = "";
    if (routedHost) routedHost.innerHTML = "";
    // 稠密模型（如 Qwen2-7B）没有 MoE：整个 MoE 区被 CSS 的 .is-no-moe 隐去，
    // 这里只需清空，不必渲染「1 个专家」这类无意义的退化态。
    if (!hasMoe) return;

    if (sharedHost) {
      setExpertCols(sharedHost, counts.sharedExpert);
      if (counts.sharedExpert > 0) {
        for (let i = 0; i < counts.sharedExpert; i += 1) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "cro-expert cro-expert--shared";
          chip.dataset.shared = String(i);
          chip.dataset.op = "mlp";           // 与结构条 shared_expert bar 同色
          chip.textContent = `SE${i}`;
          chip.dataset.tip = `共享专家 SE${i} · 每个 token 都经过，不参与 top-${counts.topK} 路由`;
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
    /* 这里展示的是一个完整 EP group 内部的专家放置：外层才是 group，下面每张
       卡片对应一个 EP rank（也就是该 rank 持有的本地专家分片）。这个层级必须交代
       清楚，否则单张「Rank n」卡会被误读成一个只有 E/EP 个专家的 EP group。
       但它是「怎么读下面这些卡片」的前提、不是一条数据，所以不占列表里的一格，
       改挂到本节标题右侧的问号气泡上（与页面其余 data-hint 同一套触发）。
       角色卡里那几份 MoE 图没有这个 section 标题，跳过即可 —— 它们是只读证据，
       本来也不该长出新的触发点。 */
    const routedHeading = routedHost.id === "croRoutedExperts"
      ? document.getElementById("croRoutedHeading")
      : null;
    if (routedHeading) {
      routedHeading.querySelector(".cro-hint")?.remove();
      /* 气泡正文是纯文本（renderHint 用 textContent + pre-wrap），别写 markdown */
      const hint = buildHint(counts.expertsPerEpRank
        ? `下面铺开的是一个 EP group 的内部：EP size ${counts.ep}，${counts.routedExpert} 个路由专家均分到组内 ${counts.ep} 个 EP rank、每个 rank 持有 ${counts.expertsPerEpRank} 个 —— 所以每张卡片是一个 EP rank 手上的本地专家分片，不是一个 EP group。`
        : `下面铺开的是一个 EP group 的内部：EP size ${counts.ep}，共 ${counts.routedExpert} 个路由专家 —— 每张卡片是一个 EP rank 手上的本地专家分片，不是一个 EP group。`);
      if (hint) routedHeading.appendChild(hint);
    }

    if (!epRanks.length || !counts.expertsPerEpRank) {
      const empty = document.createElement("span");
      empty.className = "cro-empty";
      empty.textContent = `路由专家 ${counts.routedExpert} 无法均分到 EP ${counts.ep}`;
      routedHost.appendChild(empty);
      return;
    }

    /* 建出来的一律是**未绑定**态（编号抹掉、挂 MOE_UNBOUND_HINT、点击不连线）；
       有选择时紧随其后的 applyRelation → syncMoeBinding 会把它翻成已绑定态。
       次序上靠得住：配置一变走 controller.onChange，renderMoe 之后就是
       reapplySelection（见那条回调），没有选择时本来也该是未绑定态。 */
    routedHost.dataset.moeBound = "0";

    epRanks.forEach((entry) => {
      const group = document.createElement("div");
      group.className = "cro-moe-group";
      group.dataset.epRank = String(entry.epRank);
      group.dataset.expertRange = `E${entry.lo}~E${entry.hi}（${entry.experts.length} 个）`;

      /* 整张卡片都是「选中这个 EP rank」的热区 —— rank 名那几个字太小，点不中。
         专家胶囊有自己的 kind:"expert"，让它们的 click 冒到这里就会被这一组
         盖掉，所以命中 .cro-expert 时直接放行。组名按钮不再单独挂 listener，
         它的 click 冒上来走同一条路径，键盘可达性照旧由它承担。
         未绑定时这一击不产生选择，只把说明弹出来（悬浮已经会弹，这一条是给
         触屏用的：那里没有 hover）。 */
      group.addEventListener("click", (event) => {
        if (event.target.closest(".cro-expert")) return;
        const bound = moeBoundOf(routedHost);
        if (!bound) { showHint(group); return; }
        emit({
          kind: "epRank", epRank: entry.epRank, experts: entry.experts, deckNode: "expert_pool",
          scopeStage: bound.stage, scopeLayer: bound.layer, dpIdx: bound.dpIdx,
        });
      });

      const name = document.createElement("button");
      name.type = "button";
      name.className = "cro-moe-group__name";

      const experts = document.createElement("div");
      experts.className = "cro-moe-group__experts";
      setExpertCols(experts, entry.experts.length);
      entry.experts.forEach((e) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "cro-expert";
        dot.dataset.expert = String(e);
        dot.dataset.epRank = String(entry.epRank);
        dot.dataset.op = "moe";            // 与结构条 expert_pool bar 同色
        dot.textContent = `E${e}`;
        dot.addEventListener("click", (event) => {
          const bound = moeBoundOf(routedHost);
          if (!bound) { event.stopPropagation(); showHint(dot); return; }
          emit({
            kind: "expert", expert: e, epRank: entry.epRank, deckNode: "expert_pool",
            scopeStage: bound.stage, scopeLayer: bound.layer, dpIdx: bound.dpIdx,
          });
        });
        experts.appendChild(dot);
      });

      group.append(name, experts);
      routedHost.appendChild(group);
    });
    // 建完就把两态里的一态写上去（此刻必然是未绑定）
    paintMoeBinding(routedHost, null, topology);
  }

  /* 把宫格翻到「未绑定 / 已绑定」中的一态。两态的差别集中在三处：卡片上写不写
     global rank、悬浮弹的是说明还是读数、点击连不连线（后者由 dataset 上的绑定
     决定，见 moeBoundOf）。
     ⚠️ 未绑定态用 data-hint（富气泡）而**不是** data-tip：两套提示都挂在
     pointerover 上，同一个元素上各挂一条会同时弹出来两个框。 */
  function paintMoeBinding(routedHost, binding, topology) {
    if (!routedHost) return;
    /* 事件详情的角色卡里也重建了一整套宫格，那是只读证据、不参与静态查询：
       保持它原来的「Rank N + 读数悬浮」，不翻两态、也不挂说明气泡 —— 对一个
       点不动的东西弹「请先去点别处」只是噪声。 */
    if (routedHost.id !== "croRoutedExperts") {
      routedHost.querySelectorAll(".cro-moe-group").forEach((group) => {
        const epRank = Number(group.dataset.epRank);
        const range = group.dataset.expertRange || "";
        group.dataset.tip = `EP rank ${epRank} · 持有专家 ${range}`;
        const name = group.querySelector(".cro-moe-group__name");
        if (name) {
          name.textContent = `Rank ${epRank}`;
          name.setAttribute("aria-label", `EP rank ${epRank}`);
        }
        group.querySelectorAll(".cro-expert").forEach((dot) => {
          dot.dataset.tip = `路由专家 E${dot.dataset.expert} · 驻留 EP rank ${epRank}`;
          dot.setAttribute("aria-label", dot.dataset.tip);
        });
      });
      return;
    }
    /* 两个开关，条件不同（见 moeBindingOf 上面那段）：
         numbered —— 定住了 PP stage，卡上能标 global rank；
         drillable —— 还定住了具体哪一个 MoE layer，格子才放开点击。
       点 Cluster 的 rank 格落在两者之间：标号，但不放开点。 */
    const numbered = Boolean(binding);
    const drillable = numbered && binding.layer != null;
    routedHost.dataset.moeBound = numbered ? "1" : "0";
    routedHost.dataset.moeBindStage = numbered ? String(binding.stage) : "";
    routedHost.dataset.moeBindDp = numbered ? String(binding.dpIdx) : "";
    // moeBoundOf 认它作「能不能点」的开关：没有层号就返回 null
    routedHost.dataset.moeBindLayer = drillable ? String(binding.layer) : "";

    /* 标题旁的口径说明：编号是按哪一层 / 哪个副本算出来的，必须跟编号一起出现。
       从层或 PP 段进来时 DP 副本是页面替用户挑的 0（整段横跨全部 EDP 副本），
       写成「副本 0 / 共 N」把这件事说破；点集群里某张卡进来时副本是确定的。
       只定到 stage 时把「还没指定层、格子不可点」一并写出来 —— 否则用户看见
       编号出来了却点不动，只能靠猜。 */
    const bindChip = document.getElementById("croMoeBind");
    if (bindChip) {
      if (!numbered) {
        bindChip.textContent = "";
        bindChip.hidden = true;
      } else {
        const dpPart = binding.exactDp
          ? `DP 副本 ${binding.dpIdx}`
          : `DP 副本 ${binding.dpIdx}（共 ${topology.counts.edp} 个，默认取第 0 个）`;
        bindChip.textContent = drillable
          ? `编号口径：Layer ${binding.layer} · PP${binding.stage} · ${dpPart} —— 下面的格子是这一层内的下钻`
          : `编号口径：PP${binding.stage} 整段 · ${dpPart} —— 未指定 MoE layer，格子暂不可点`;
        bindChip.hidden = false;
      }
    }

    const ranksPerEp = topology.counts.ranksPerEp || 1;
    const hint = MOE_NO_DRILL_HINT + (numbered ? "" : MOE_UNBOUND_TAIL);
    const layerNote = drillable ? `Layer ${binding.layer} 的` : "";
    routedHost.querySelectorAll(".cro-moe-group").forEach((group) => {
      const epRank = Number(group.dataset.epRank);
      const name = group.querySelector(".cro-moe-group__name");
      const range = group.dataset.expertRange || "";

      // ① 编号：定住 stage 就标；EP rank p 在这个 (stage, dp 副本) 里对应一段连续
      //    的 global rank，段长 = ranksPerEp（TP×CP）。TP=CP=1 时就是一张卡。
      let label = null;
      if (numbered) {
        const first = topology.rankOf(binding.stage, binding.dpIdx, epRank, 0);
        label = ranksPerEp > 1 ? `${first}~${first + ranksPerEp - 1}` : String(first);
      }
      if (name) {
        name.textContent = label == null ? "Rank" : `Rank ${label}`;
        name.setAttribute("aria-label", label == null
          ? `EP 组内第 ${epRank} 个 rank；未定住 PP stage，暂不标 global rank`
          : `global rank ${label}，EP rank ${epRank}`);
      }

      // ② 可点性：只有定到具体 MoE layer 才放开。不可点时挂说明气泡、不挂
      //    data-tip（两套提示都在 pointerover 上，同挂会一起弹出来）。
      group.classList.toggle("is-anon", !drillable);
      if (!drillable) {
        delete group.dataset.tip;
        group.dataset.hint = hint;
        group.querySelectorAll(".cro-expert").forEach((dot) => {
          delete dot.dataset.tip;
          dot.dataset.hint = hint;
          dot.setAttribute("aria-label",
            `路由专家 E${dot.dataset.expert}（未指定 MoE layer，不可下钻）`);
        });
        return;
      }
      delete group.dataset.hint;
      group.dataset.tip = `global rank ${label} · Layer ${binding.layer} · PP${binding.stage} · DP 副本 ${binding.dpIdx} · EP rank ${epRank}\n持有专家 ${range}`;
      group.querySelectorAll(".cro-expert").forEach((dot) => {
        delete dot.dataset.hint;
        dot.dataset.tip = `${layerNote}路由专家 E${dot.dataset.expert} · 驻留 global rank ${label} · EP rank ${epRank}`;
        dot.setAttribute("aria-label", dot.dataset.tip);
      });
    });
  }

  /* ══ 渲染：集群图（第 6 项）══════════════════════════════════════════════
     完全参数化，不再是 training-run-twin.js 里写死的 DP4×8行×64列。
     几何直接来自 rank 编址 r = s·(EDP·EP·TP·CP) + d·(EP·TP·CP) + p·(TP·CP) + inner：

        列组 = PP stage              （pp 个 Stage 块左右并排）
        列   = 块内 EP rank          （每块 ep 列）
        行   = 模型副本 × tp × cp    （最左一块带 EDP0…EDPn 标签，见 dAxisName）
        格   = 1 个 rank，总数 = edp·pp·ep·tp·cp = Total Rank

     ⚠️ 行数走的是 EDP 不是表单里的 DP：切出档下 DP 里已经含了 EP 组
     （EDP = DP/EP），拿 DP 当行数会画出 world 的 EP 倍。正交档 EDP ≡ DP。

     ⚠️ 默认 4 块 × 64 列 = 256 列，要在不横向滚动的前提下全部显示完，
     所以格间距必须为 0、列轨必须是 minmax(0, 1fr)（可无限收缩）。
     格宽会小到 2~3px，此时 inset 描边会把格子填满，故静息态改用背景填充。
     格高由 CSS 显式给定，与宽度解耦。

     复用 training-run-twin.css 的 .twin-heat / .twin-heat-cell /
     .twin-heat-dp-group 视觉，不新造网格样式。不用 .ep-tint-N（EP 列的 8 色
     循环底色）—— 本页格子是描边态，那批底色会透出来变成一片杂色。 */
  const CLUSTER_CELL_CAP = 16384;

  /* ══ 矩阵折几行：由「这一行能给多少高」算，不写死 ══════════════════════════
     每个 DP 在每个 stage 块里折成 epRows × epCols（64 EP → 2×32 / 3×22 / 4×16）。
     行数一多，横向列数就成比例减少、格子变宽，可读性直线上升；代价是占高。
     以前这个数写死为 2，于是矩阵高度成了常量：.cro-board 第 2 行是 fit-content()，
     而 fit-content 只会 ≤ 内容高，永远不会为了填满空间变大 —— 屏幕一高，富余
     高度全被第 1 行的 1fr 吞掉，摊成典型层卡片里的空白，集群图却还是那么矮。
     所以行数必须反过来由可用高度倒推。
     格高跟着行数走：列数减半格子就宽一倍，高度不同步放大就成了扁条。 */
  const CLUSTER_CELL_H = { 1: 4, 2: 4, 3: 6, 4: 8 };

  /* 矩阵可用的高度预算 = 它要装进去的那个视口本身。
     原来是拿板面高度 × 46%/62% 再减去实测的区 chrome 去"估"，估出来的数和
     syncBoardRows() 真正批给 Cluster 那一行的高度是两笔独立的账，对不上就一头
     出滚动条、另一头空一截。现在直接读 .cro-cluster__grid 的 clientHeight：
     两行的高度在 syncBoardRows() 里已经定好，且**只由 Model Architecture 的内容
     需求决定、与矩阵无关**（见那边的注释），所以这里读到的是终局值，不会出现
     "矩阵撑高预算 → 预算再撑高矩阵"的自激。
     留 2px 余量：视口高度是分数值经 clientHeight 圆整来的，贴着铺满可能差半像素
     顶出一条拖不动的滚动条。 */
  function clusterHeightBudget(host) {
    const viewport = host.closest?.(".cro-cluster__grid");
    if (viewport && viewport.clientHeight > 0) return viewport.clientHeight - 2;
    /* 量不到视口的两种情况：首帧还没布局；事件详情的角色卡里另开的那几份矩阵
       （host 不在 .cro-board 里，见 ROLE_DOMAINS 的重建）。退回板面比例估算。 */
    const board = host.closest?.(".cro-board");
    if (!board || !board.clientHeight) return 0;
    const capRatio = board.classList.contains("is-view-single") ? 0.62 : 0.46;
    return board.clientHeight * capRatio - 132;
  }

  /* 一幅矩阵里除了格子本身之外的那些高度（下面统称 chrome），几何按真实 DOM
     逐层算，不塞魔数：
       block  = epRows 行 × 格高，行间 1px（.cro-heat-block 的 gap）
       DP 组  = innerRows 个 block 竖排 + 上下各 2px padding（.cro-heat-dp）
                + 上下各 1.5px 边框（.twin-heat-dp-group，padding 被本页改过
                但 border 没有）→ 每组固定 7px
       整幅   = dp 个组 + 组间 3px（.cro-heat-body 的 gap）+ 上下两条标签行
                与它们各自 4px 的 flex gap，合计约 32px
     pickEpRows 与 verticalCellHeight 用的是同一份账，抽出来只写一处。 */
  function clusterChromeH(dp, innerRows, epRows) {
    return dp * (innerRows * (epRows - 1) + 7) + (dp - 1) * 3 + 32;
  }

  /* 下限恒为 2：那是改动前的行为，量不到高度或实在放不下时不该比原来更差
     （放不下就照旧由 .cro-cluster__grid 内部滚动）。

     只收 ep 能**整除**的行数。折不尽的话末行会缺格：64 EP 折 3 行是
     ceil(64/3)=22 列，3×22=66 > 64，右下角空两格 —— 一个 stage 块的方阵是
     「这一组的 64 个 EP rank」，缺角会读成"这里少了两张卡"，而它只是排版余数。
     宁可退回 2 行（满格、只是格子窄一半）也不要缺角，所以预算够 3 行但不够
     4 行时（ep=64），best 停在 2。 */
  function pickEpRows(host, counts) {
    // d 轴的行数是 EDP 不是 DP（切出档 EP 已在组内，见 derive 的 edp）
    const dp = counts.edp;
    const ep = counts.ep;
    const innerRows = counts.ranksPerEp;
    const floor = Math.min(2, ep);
    const budget = clusterHeightBudget(host);
    if (!(budget > 0)) return floor;

    const heightOf = (rows) => {
      const cell = CLUSTER_CELL_H[rows] || 4;
      return dp * innerRows * rows * cell + clusterChromeH(dp, innerRows, rows);
    };

    let best = floor;
    for (let rows = floor + 1; rows <= Math.min(4, ep); rows += 1) {
      if (ep % rows === 0 && heightOf(rows) <= budget) best = rows;
    }
    return best;
  }

  /* 格高的上下限。rank 格不要求正方形，但要求**不高于自己的宽**（竖着长的格子
     读起来像"条"不像"卡"），所以格宽是它的另一道硬上界，见 syncCellWidth。
     CLUSTER_CELL_H_MAX 只是防止卡数很少时（如 qwen2-7b 默认 dp2×pp4×ep1，一个
     stage 块只有 1×1 格）一格独吞整块预算、涨成一面墙。
     CLUSTER_CELL_H_MIN = 3：再挤也得看得见一格是一格 —— 1~2px 时格子与 1px 描边
     同量级，整片矩阵会糊成一条实心色带，rank 的疏密结构全丢了。 */
  const CLUSTER_CELL_H_MAX = 32;
  const CLUSTER_CELL_H_MIN = 3;

  /* 按 pickEpRows 那份同源的账反解：这个 epRows 下，纵向预算刨掉 chrome 之后
     摊到每一格行上能给多高。pickEpRows 用 CLUSTER_CELL_H 那张保守表只是为了
     决定折几行，真正落到 --cro-cell-h 的是这里算出来的值 —— 折行定下来之后，
     剩余的纵向空间应该全部摊进格子里，而不是留白在矩阵下方。 */
  function verticalCellHeight(host, counts, epRows) {
    const dp = counts.edp;
    const innerRows = counts.ranksPerEp;
    const budget = clusterHeightBudget(host);
    if (!(budget > 0) || dp <= 0 || innerRows <= 0) return CLUSTER_CELL_H_MAX;
    const totalCellRows = dp * innerRows * epRows;
    const available = budget - clusterChromeH(dp, innerRows, epRows);
    if (!(available > 0) || totalCellRows <= 0) return CLUSTER_CELL_H[epRows] || 4;
    return Math.min(CLUSTER_CELL_H_MAX, Math.floor(available / totalCellRows));
  }

  /* 格宽必须整数像素、锁死到每个 block 上——不能再让 CSS Grid 的 1fr 各自取整。
     cellTemplate 原来是 repeat(epCols, minmax(0,1fr))：同一个 block 内 1fr 按列
     各自求值，折成十几二十列时哪怕只差 1px，摊到几像素宽的格子上就是肉眼可见
     的「有的宽有的窄」（列数越多越明显，2 行仅 4px 格高时更甚）。
     用已经排好版的第一个 block 反量出真实可用宽度，连它自己的 column-gap 一起
     读出来（不在 JS 里重复硬编码 --space-2 这类 gap 常量），算出整数像素的轨道
     列表后统一写回所有 block；block 之间原有的 stageTemplate（1fr）留着不动
     ——那是 4 个 stage 块互相分宽度，不是本次要锁的"块内格子互相分宽度"。

     余数不能丢在右边。floor 出来的统一格宽最多浪费 epCols-1 px（16 列时近
     一格半的宽度），全堆在 block 右缘就是一道空隙：格子明明可以再宽一点，却
     让 stage 块的右边空着。所以先取 base = floor(可用宽 / 列数)，再把余下的
     extra 像素按 Bresenham **均匀间隔**地摊给 extra 个列（每列至多 +1px），
     整行正好填满 block。
     和当初 1fr 的区别在"均匀"二字：1fr 是每列各自取整、误差落在哪儿由浏览器
     的累积舍入决定，会出现连着几个窄的再连着几个宽的；这里的 +1px 是等间隔
     插入的，且格子早已不是当年的 4px 细条（现在按格宽做成正方形，动辄十几
     二十像素），1px 的差别摊在上面看不出来，空着的那道缝反而更扎眼。

     格高（--cro-cell-h）同一处一并写：取 base（不含 +1 的那档，保证没有格子
     高过自己的宽）与纵向预算两个上限里更小的那个。

     ⚠️ growHeight:false —— renderCluster 之后的那次补量（refitClusterCells）只许
     格子变宽、不许变高。格高那时已经按终局视口算过一次并铺进 DOM 了，补量时若
     矩阵恰好顶出一条滚动条，重算出来的值反而可能偏大，一涨就真溢出。变矮不会
     溢出，所以只封上界、不封下界。 */
  function syncCellWidth(host, epCols, counts, epRows, { growHeight = true } = {}) {
    if (!(epCols > 0)) return;
    const firstBlock = host.querySelector(".cro-heat-block");
    if (!firstBlock) return;
    const gap = parseFloat(getComputedStyle(firstBlock).columnGap) || 0;
    const inner = Math.floor(firstBlock.clientWidth - gap * (epCols - 1));
    const base = Math.floor(inner / epCols);
    if (!(base > 0)) return;
    const extra = inner - base * epCols;          // 0 … epCols-1
    const tracks = [];
    for (let i = 0; i < epCols; i += 1) {
      // 第 i 列是否吃到 +1：等间隔地插 extra 次，不扎堆在头尾
      const take = Math.floor(((i + 1) * extra) / epCols) - Math.floor((i * extra) / epCols);
      tracks.push(`${base + take}px`);
    }
    const fixedTemplate = tracks.join(" ");
    host.querySelectorAll(".cro-heat-block").forEach((block) => {
      block.style.gridTemplateColumns = fixedTemplate;
    });
    /* 格高的三道闸，从松到紧：
         · 纵向预算摊到每格行上能给多少（verticalCellHeight）；
         · 不高过自己的宽 —— 竖着长的格子读起来像"条"不像"卡"，横向再宽也补不回来，
           所以 base 是硬上界（base 是不含 Bresenham +1 的那档，取窄的一边）；
         · 不低于 CLUSTER_CELL_H_MIN —— 再挤也得看得见一格是一格。
       下限压过上限时以下限为准：宁可矩阵溢出让 .cro-cluster__grid 去滚，也不要
       糊成一条实心色带。 */
    let cellH = Math.min(verticalCellHeight(host, counts, epRows), base);
    if (!growHeight) {
      const now = parseFloat(host.style.getPropertyValue("--cro-cell-h")) || cellH;
      cellH = Math.min(cellH, now);
    }
    host.style.setProperty("--cro-cell-h", `${Math.max(CLUSTER_CELL_H_MIN, cellH)}px`);
  }

  /* ══ Model Architecture / Cluster 两行怎么分：内容各自实测，不用写死的比例 ══
     .cro-board 原来是「第 1 行 minmax(260px,1fr) + 第 2 行 fit-content(46%)」：
     46% 是给 openPangu（46 层 · Dense/MoE 两段 · 64 EP 大矩阵）估的经验值，换成
     qwen2-7b（28 层单 Dense 段 · 默认仅 8 卡）内容量整个反过来——Model
     Architecture 变短、Cluster 里单卡容量的等距图反而要更多高度才撑得开。写死
     的比例只能顾一头，另一头必然「一边挤出滚动条、一边空出一大截」。
     scrollHeight 天然反映"不裁剪会有多高"，不受当前 grid 行高影响（MDN：包含
     因 overflow 而未显示的内容），两块各量一次，按各自实际需要分这一行的高度；
     只有两块之和超出可用高度时，才按「超出 260px 下限的那部分」等比例收缩——
     两块各自的下限不因为对方要得多就被挤没，真收缩到底则由 .cro-board 自身的
     overflow:auto 兜底（滚动可以接受，重叠/挤压不行，与原设计同一条准则）。
     YAML 视图（css 的 .cro-board.is-yaml）另有一套「一行铺满 + 第二行归零」的
     模板，那时 arch/cluster 整块隐藏、量出来的 scrollHeight 没有意义，交还给
     那条 class 规则，不写内联样式。

     ⚠️ 量之前不能只把 grid-template-rows 清空退回静态规则——静态规则第 1 行仍是
     minmax(260px,1fr)，1fr 会把"这一行还剩多少空间"全部塞给 arch 这个网格项：
     网格项默认 align-self:stretch，箱子本身就被撑到那么高，此时量 scrollHeight
     量到的是"这一行给了多少"，不是"内容真正需要多少"——.cro-section--structure
     的 flex:1 1 auto、#croCapacity 的 height:0+min-height:100% 这两处"主动填满
     父容器"的机关（分别见本文件与 config-relation-capacity.css 的注释）会因此
     被吃进读数里，两个模型来回切换只会越垒越大，降不回去。
     量的时候把两行都临时设成 max-content：网格按"内在尺寸"排布轨道时，子项的
     flex-grow 与百分比高度按 CSS 规范一律不计入内在尺寸贡献（因为这轮计算本来
     就是在求"容器该多大"，用还没求出来的答案反过来定输入是循环定义），于是两个
     机关在这一步自动失效，量到的是两块各自的真实内容高度，不必逐个手动去关。

     ⚠️ 两行之和必须恒等于 available，不能"内容够用就不填满"——.cro-region--net
     横跨这两行（grid-row:1/3），整网 3D deck 的可视高度就是这两行之和撑出来的。
     早先按"内容不够就不硬撑"设计，两块都不需要太高时两行之和会小于 available，
     直接后果是大屏（1080p）下整网画布下方空出一大截。所以余量必须找地方落。

     ⚠️ 谁先拿够，取决于谁**不能变形**，而不是谁的读数大：
       · Model Architecture 是**刚性**的 —— 典型层那 5 列（Dense×2 / MoE×44 …）
         有多少根算子条就是多少根，给不够就只能滚动才看得完，那是实打实的信息
         损失；Layer 导航、stepper 行更是一格都压不得（css 里全是 flex:0 0 auto）。
       · Cluster 是**弹性**的 —— 矩阵的格高（--cro-cell-h）是自由变量，同一批
         rank 铺在 200px 里和铺在 400px 里都成立，只是格子胖瘦不同；分到多少就
         按多少铺满（见 clusterHeightBudget 直接读视口）。
     所以次序是：**arch 按实测内容需求拿够，剩下的全给 Cluster**，矩阵再把拿到
     的那格填满。曾经反过来让 Cluster 先拿（因为它当时"少一像素就出滚动条"），
     结果矩阵一涨就把典型层挤出滚动条 —— 那条滚动条的真正病根是取整误差和残留的
     测量姿势，已经在下面分别修掉了，不该拿版面比例去补。

     Cluster 仍留一道天花板（46% / 只看一边档 62%）：arch 的读数是 max-content，
     典型层算子条一多就能吃掉整块板子；而矩阵矮到一定程度就读不出 rank 分布了。
     吃不完的余量退回给 arch —— 结构条长高本来就是 .cro-structure flex:1 的设计
     意图，不算浪费。 */
  const BOARD_ROW_MIN = 260;

  /* Cluster 那一行的真实下限：矩阵按下限格高（CLUSTER_CELL_H_MIN）、按最少折行数
     铺开时要占多高，加上区里矩阵之外那部分（区标题 + 表单行 + 间距，实测）。
     不能沿用 arch 那个 260 的通用下限 —— 格高有 3px 的硬底（低于它整片矩阵糊成
     一条实心色带），行数又不会低于 pickEpRows 的下限，两者一乘就是一个由 dp / tp /
     cp 决定的具体数字，跟 260 没关系。给少了，矩阵压不下去，.cro-cluster__grid
     就在"这一行明明还能再高"的时候先顶出纵向滚动条。 */
  function clusterMinRowH(counts) {
    if (!counts || !(counts.edp > 0)) return BOARD_ROW_MIN;
    const epRows = Math.max(1, Math.min(2, counts.ep));   // 与 pickEpRows 的 floor 同源
    const cellRows = counts.edp * counts.ranksPerEp * epRows;
    const matrix = cellRows * CLUSTER_CELL_H_MIN + clusterChromeH(counts.edp, counts.ranksPerEp, epRows);
    const region = document.querySelector(".cro-region--cluster");
    const viewport = document.querySelector(".cro-cluster__grid");
    let chrome = 132;   // 还没布局时的保守估计
    if (region && viewport && viewport.clientHeight) {
      const measured = region.offsetHeight - viewport.clientHeight;
      if (measured > 0 && measured < region.offsetHeight) chrome = measured;
    }
    return Math.ceil(matrix + chrome);
  }

  function syncBoardRows(counts) {
    const board = document.getElementById("croBoard");
    if (!board) return;
    if (board.classList.contains("is-yaml")) {
      board.style.gridTemplateRows = "";
      return;
    }
    const arch = document.querySelector(".cro-region--arch");
    const cluster = document.querySelector(".cro-region--cluster");
    if (!arch || !cluster) return;

    /* 量之前先记下上一次的结果：下面那句 max-content 是**临时**的测量姿势，
       一旦板子这会儿量不出高度（首帧未布局，或本页启动即进事件详情、.cro-board
       整块 hidden）就必须原样退回去 —— 否则 "max-content max-content" 会以内联
       样式的形式留在板子上，等它重新显示时两行各自按内容全高铺开（arch 那行会
       把 .cro-structure__stack 里所有算子条一次摊平），远超板面，当场滚出条来。 */
    const prevRows = board.style.gridTemplateRows;
    board.style.gridTemplateRows = "max-content max-content";
    /* 可用高度必须**向下**取整到整像素，且不能只信 clientHeight。
       clientHeight 是把真实的分数高度（flex 链一路算下来，989.6px 这种再正常
       不过）四舍五入成的整数，可能比实际大半像素；两行之和照它铺满，就会把
       .cro-board 顶出零点几像素的溢出 —— 浏览器照样给一条滚动条，可拖动量却
       不到 1px，就是"有条但滚不动"的那个恶心现象。
       rect.height 是精确的分数值但不扣横向滚动条，clientHeight 扣了滚动条但被
       圆整过，两者取小再 floor，才是"一定装得下"的整数。 */
    const style = getComputedStyle(board);
    const rowGap = parseFloat(style.rowGap) || 0;
    const paddingV = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const borderV = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    const innerH = Math.min(board.getBoundingClientRect().height - borderV, board.clientHeight);
    const available = Math.floor(innerH - rowGap - paddingV);
    // 板子还没铺开（首帧/隐藏）：退回上一次的结果，别把测量姿势留在样式里
    if (!(available > 0)) { board.style.gridTemplateRows = prevRows; return; }

    /* 用 rect.height 而不是 scrollHeight：scrollHeight 是**四舍五入**过的整数，
       内容真高 456.4px 时它报 456，照它批下来的行高就比内容矮 0.4px —— 于是
       那半当场冒出一条拖不动的滚动条（刷新即见的那个 1~2px）。
       两行都是 max-content，网格项被拉伸到的正是自己的内在高度，rect.height
       就是精确的内容高，再向上取整才保证一定装得下。 */
    const archNeed = Math.max(BOARD_ROW_MIN, Math.ceil(arch.getBoundingClientRect().height));
    /* Cluster 的下限是算出来的，不是那个通用的 260（见 clusterMinRowH）。
       再封一道 available 的一半：卡数极多时（上万格）它能要到天上去，那种规模
       本来就只能靠 .cro-cluster__grid 内部滚动，不该拿整块板子去填。 */
    const clusterMin = Math.min(clusterMinRowH(counts), Math.round(available * 0.5));
    // Cluster 的天花板：矩阵是弹性的，但不该把整块板子都吃掉（见上方注释）。
    // 天花板低于下限时以下限为准 —— 下限是"不出滚动条"的硬条件。
    const clusterCap = Math.max(
      clusterMin,
      Math.round(available * (board.classList.contains("is-view-single") ? 0.62 : 0.46)),
    );
    let row1;
    let row2;
    if (available < BOARD_ROW_MIN + clusterMin) {
      // 窗口实在太矮，两个下限之和都装不下：各自守住下限，超出的那截交还
      // .cro-board 自身的 overflow:auto 兜底（滚动可以接受，压穿下限不行）。
      row1 = BOARD_ROW_MIN;
      row2 = clusterMin;
    } else {
      // 刚性的那半先拿够，弹性的那半接住余量；余量超过天花板就退回给 arch
      row1 = Math.min(archNeed, available - clusterMin);
      row2 = available - row1;
      if (row2 > clusterCap) { row2 = clusterCap; row1 = available - row2; }
    }
    // 两行都是整数、之和恒等于 available，不再有取整余数顶出零点几像素的溢出
    board.style.gridTemplateRows = `${row1}px ${row2}px`;
  }

  /* Cluster 区标题右侧原先常驻一行 d 轴口径说明（「矩阵纵轴 = EDP 8（DP 512 ÷ EP 64）…」），
     由 syncClusterAxisNote 按配置改写。已整体移除 —— 标题行只留区名。
     那句换算并没有丢，仍在三处答得出来：矩阵格子的悬浮提示、单卡容量栏口径浮层里
     的「EDP」一行、以及文档视图「EP 与 DP：正交还是从 DP 切出」一章。 */

  function renderCluster(host, topology, emit) {
    if (!host) return;
    const { counts } = topology;
    const { pp, ep, tp, cp, totalRank } = counts;
    // 矩阵的 d 轴是 EDP：切出档下 DP 里已经含了 EP 组，用 DP 会多画 EP 倍的行
    const dp = counts.edp;
    const innerRows = counts.ranksPerEp;   // tp × cp
    host.innerHTML = "";
    delete host.dataset.epRows;

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
    /* 折几行 / 格子多高：全部由可用高度倒推（见 pickEpRows）。视图档只是通过
       行高封顶影响预算，不再单独判档 —— 「只看整网」与「只看典型 Layer」两档
       预算相同，集群图自然长得一样。
       行数是建 DOM 时定的，纯 CSS 改不动：所以切档（cro:view）与窗口高度变化
       （resize）都要回来重建一次，两处都在文件末尾。dataset 留一份当前值，供
       resize 判断"行数其实没变，别白重建 2048 个格子"。
       事件详情的角色卡里也会调本函数各开一份矩阵，那些 host 不在 .cro-board
       里，clusterHeightBudget 量不到板子，天然回落到 2 行。
       两级列轨都用 1fr：宽度随本列自适应，既不溢出也不需要横向滚动。 */
    const epRows = pickEpRows(host, counts);
    const epCols = Math.ceil(ep / epRows);
    host.dataset.epRows = String(epRows);
    // 先给个粗略初值（格宽还没测出来），appendChild 之后 syncCellWidth 会按
    // 实测格宽把它改成正方形的准确值。
    host.style.setProperty("--cro-cell-h", `${CLUSTER_CELL_H[epRows] || 4}px`);
    const stageTemplate = `repeat(${pp}, minmax(0, 1fr))`;
    const cellTemplate = `repeat(${epCols}, minmax(0, 1fr))`;

    /* ── TP 分片 → 具体哪几张卡 ────────────────────────────────────────────
       编址里 TP 是最内的一维：inner = cpIdx·tp + tpIdx，于是同一个 TP 组的 tp
       张卡全局编号连号（rank, rank+1, … rank+tp-1），优先落在同一节点内 ——
       TP 每层前反向都要 all-reduce 一次激活，是通信最密的一维，必须吃机内互联
       （HCCS/NVLink），把它排在最内是各家框架（Megatron 的 tp-cp-ep-dp-pp 序）
       的一致做法。CP 次之，两者共同占满 ranksPerEp。
       所以分片序号 tpIdx = inner % tp，而 inner 正是集群图里 DP 组内的行序 ——
       每 tp 行走完一轮分片，横向天然成条带，斑马纹按行铺就是客观的分片分布。 */
    /* 行 23：两套编址的分解统一走 topology.shardOf —— 这里原先自己又算了一遍
       （inner % tp / ⌊inner/tp⌋），那是「另两档」的算法；mf 档下 TP 分片号由
       (d, ep) 定，照旧算会给出一片全是 TP0 的斑马纹。 */
    const tpShardOf = (d, p2, inner) => topology.shardOf(d, p2, inner).tpIdx;
    const cpIdxOf = (d, p2, inner) => topology.shardOf(d, p2, inner).cpIdx;
    /* 亮度是**间隔**的，不是渐变的：单调递减的斜坡在整片格子上会读成一团渐变，
       看不出"一份一份"的边界；明暗交替才切得出条带。
         偶数份 → 100%（与单 TP 时的高亮同强度）
         奇数份 → 50% / 40% 交替（tp≥4 时两条暗纹也分得出先后）
       最暗一档仍亮于静息态的 45% 中性灰描边（白 40% ≠ 灰 45%），"暗的那条也是
       被点亮的"这层意思不能丢。 */
    const tpFade = (shard) => {
      if (tp <= 1 || shard % 2 === 0) return 100;
      return shard % 4 === 1 ? 50 : 40;
    };

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

    /* ── 中：每个模型副本一个横贯全宽的分组（左侧带 d 轴标签），
          组内是 pp 个 stage 小方阵并排。
          标签写 EDP 还是 DP 由口径定（见 dAxisName）：切出档下这一行是
          「DP/EP 组」，与表单里那个 DP 512 不是同一个量，重名会直接读错。 ── */
    const dName = dAxisName(counts);
    // EDP 比 DP 多一个字符，::before 的左侧留白要跟着放宽（见 .cro-heat[data-d-axis]）
    host.dataset.dAxis = dName.toLowerCase();
    /* 换算式进每一个格子的悬浮提示：表单上写着 DP 512、这里标着 EDP0–7，
       两个数对不上是本页最容易被当成算错的一处，光改名不够，得把桥给出来。 */
    /* 行 23：mf 档的 EDP 是 DP×TP÷EP —— 换算式要跟着档位写，否则矩阵旁那句
       常驻说明会和行数对不上。 */
    const dTip = dName !== "EDP" ? ""
      : counts.epMode === "mf"
        ? `\nEDP = DP ${counts.dp} × TP ${counts.tp} ÷ EP ${ep} = ${dp}（MindFormers 档：EP 在 DP×MP 域上切）`
        : `\nEDP = DP ${counts.dp} ÷ EP ${ep} = ${dp}`;
    /* 格子提示的最后一行：这张卡到底背着几个专家。EP 列号只说明它属于哪个专家组，
       换算成「几个」还要再除一次，而这正是看矩阵时最想知道的那个数。
       专家只存在于 MoE 层，所以整段都是 dense 层的 stage 上不写这一行
       （稠密模型全程没有，naturally 也就整块不出现）。 */
    const stageHasMoe = topology.stages.map((entry) =>
      topology.layers.slice(entry.lo, entry.hi + 1).some((layer) => layer.ffn === "moe"));
    const body = document.createElement("div");
    body.className = "cro-heat-body";

    for (let d = 0; d < dp; d += 1) {
      const group = document.createElement("div");
      group.className = "twin-heat-dp-group cro-heat-dp";
      group.style.gridTemplateColumns = stageTemplate;
      group.dataset.dp = String(d);
      group.dataset.dpLabel = `${dName}${d}`;
      group.setAttribute("role", "rowgroup");
      group.setAttribute("aria-label", `${dName}${d} 副本`);

      for (let inner = 0; inner < innerRows; inner += 1) {
        for (let s = 0; s < pp; s += 1) {
          const block = document.createElement("div");
          block.className = "cro-heat-block";
          block.style.gridTemplateColumns = cellTemplate;
          block.dataset.dp = String(d);
          block.dataset.stage = String(s);
          block.setAttribute("role", "row");
          block.setAttribute("aria-label", `Stage${s} · ${dName}${d} · ${ep} 个 EP rank`);

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
            const shard = tpShardOf(d, p, inner);
            const cpIdx = cpIdxOf(d, p, inner);
            cell.dataset.tp = String(shard);
            cell.dataset.cp = String(cpIdx);
            cell.dataset.node = String(node);
            // TP/CP 展开时把这张卡在最内两维里的位置写进提示：光看格子只知道
            // 「被点亮了」，知道是第几份权重才谈得上定位。
            const shardTip = tp > 1 ? `\nTP 分片 ${shard + 1}/${tp}（持有该层权重的 1/${tp}）` : "";
            const cpTip = cp > 1 ? `\nCP 分片 ${cpIdx + 1}/${cp}` : "";
            const epEntry = topology.epRanks[p];
            const sharedTip = counts.sharedExpert
              ? ` + ${counts.sharedExpert} 个共享专家（每卡一份）` : "";
            const expertTip = stageHasMoe[s] && epEntry && counts.expertsPerEpRank
              ? `\n当前 rank 有 ${counts.expertsPerEpRank} 个路由专家`
                + `（每个 MoE 层各一份，编号 ${epEntry.lo}–${epEntry.hi}）${sharedTip}`
              : "";
            cell.dataset.tip = `rank ${rank}\nStage${s} · ${dName}${d} · EP${p} · TP${shard} · CP${cpIdx}${shardTip}${cpTip}${dTip}\nNode ${node}${expertTip}`;
            if (tp > 1) {
              cell.dataset.tpShard = String(shard);
              // 高亮亮度分档由 CSS 读这枚变量（见 .twin-heat-cell.is-related）。
              // tp=1 时不写，回落到 100% —— 单 TP 的观感与改动前完全一致。
              cell.style.setProperty("--cro-tp-fade", `${tpFade(shard).toFixed(1)}%`);
            }
            // 2048 个格子不能各占一个 Tab 站；用 roving tabindex + 方向键在网格内移动
            cell.setAttribute("role", "gridcell");
            cell.setAttribute("tabindex", rank === 0 ? "0" : "-1");
            cell.setAttribute("aria-label",
              `rank ${rank}，Stage${s}、${dName}${d}、EP${p}、TP${shard}、CP${cpIdx}，节点 ${node}`);
            cell.addEventListener("click", () => emit({
              kind: "rank", rank, stage: s, dpIdx: d, epRank: p,
              tpIdx: shard, cpIdx, node,
            }));
            block.appendChild(cell);
          }
          group.appendChild(block);
        }
      }
      body.appendChild(group);
    }
    host.appendChild(body);
    // block 已经挂到文档上、stageTemplate 分好了每个 stage 的宽度，这时才量得到
    // 真实可用宽度，把 cellTemplate 从 1fr 换成锁死的整数像素值
    syncCellWidth(host, epCols, counts, epRows);

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
    /* 结构对象（层、典型层算子、Emb / Norm / Head 端点）一律查**全部 DP/EDP**：
       问的是「这个结构对象落在哪些卡上」，答案本就横跨所有模型副本。
       只有明确带了 dpIdx 的 payload（点某张 rank 卡）才收窄到那一个副本。
       不区分「分片 / 副本」：Dense 层与 Emb / Norm / Head 在 EP 维度上确实是
       副本，但副本也是"这张卡上有这一层"，照样要亮 —— 只亮一份会读成"这个 DP
       里其余的卡不含这一层"，那是错的。副本结构本身由斑马纹表达：同一亮度的
       那批卡持有同一份 TP 切片，彼此互为副本。 */
    const stageRanks = (stage) => (Number.isFinite(payload.dpIdx)
      ? topology.ranksOfStageInDp(stage, payload.dpIdx)
      : topology.ranksOfStage(stage));
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
        addRanks(stageRanks(topology.stageOfLayer(payload.layer)));
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
          rel.stages.forEach((s) => addRanks(stageRanks(s)));
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
          addRanks(stageRanks(stage));
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
        /* 一个路由槽位（专家编号 e）在**每个 MoE 层**都有一份实例（各层权重独立、
           互不相干，只共享编号与「编号→EP rank」的分片公式）；它的 EP 组在**每个
           PP stage** 内都占一块 rank。所以有两种口径：

           【收敛】payload 带 scopeStage —— 这一击来自已绑定的 MoE 宫格（用户先点了
             某个 MoE layer / 某张卡，宫格上已经标出 global rank）。此刻问的是「**这一层
             的**这个专家在哪」，答案必须与卡片上写着的那个编号一致，于是收敛到该
             stage 的 MoE 层、并只取 dpIdx 指定的那个 DP 副本。
           【全展开】没有 scopeStage（外部 API / 老快照）—— 退回原来的口径：全部 MoE
             层 + 全部 stage × 全部 DP 副本，让「这个编号散布在哪里」一眼看全。
             连线侧会按 stage 拆成多条（见 drawRelationLinks），而非缩成一个巨框。 */
        const scopeStage = Number.isFinite(payload.scopeStage) ? payload.scopeStage : null;
        const scopedLayers = scopeStage == null
          ? moeLayers
          : moeLayers.filter((l) => topology.stageOfLayer(l) === scopeStage);
        /* 【定层】scopeLayer 落在这段 stage 的 MoE 层里 —— 用户是先点了那一层、
           再在宫格上继续下钻，这一击问的是「**这一层里**的这个专家」，关系集必须
           收到这一层。只按 stage 收敛不够：一段 PP 里通常有十几层 MoE，层导航
           会把整段全亮，与标题上写着的 Layer N 打架（口径说一层、布局亮一片）。 */
        const pinnedLayer = Number.isFinite(payload.scopeLayer) && scopedLayers.includes(payload.scopeLayer)
          ? payload.scopeLayer
          : null;
        const useLayers = pinnedLayer != null
          ? [pinnedLayer]
          : (scopedLayers.length ? scopedLayers : moeLayers);
        addLayers(useLayers);
        rel.deckLayer = Number.isFinite(payload.scopeLayer) && useLayers.includes(payload.scopeLayer)
          ? payload.scopeLayer
          : useLayers[Math.floor(useLayers.length / 2)];
        const pinDp = scopeStage != null && Number.isFinite(payload.dpIdx) ? payload.dpIdx : null;
        rel.stages.forEach((s) => {
          const all = topology.ranksOfEpRankInStage(s, payload.epRank);
          addRanks(pinDp == null ? all : all.filter((r) => topology.coordsOfRank(r).dpIdx === pinDp));
        });
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

    /* 专家 / EP rank / 共享专家两种口径，跟着关系集走：
       - 收敛到一层（先点了某个 MoE layer、再在宫格里下钻）：写「在 Layer N 里」，
         把"这一击发生在哪一层"说死，与层导航只亮那一层对上；
       - 全展开（没有定层）：写「各一份」，表达该编号在每个相关 MoE 层都有一份
         独立实例，而不是同一个专家横跨各层。 */
    const pk = rel.primary && rel.primary.kind;
    if ((pk === "expert" || pk === "epRank" || pk === "sharedExpert") && rel.layers.size) {
      const who = pk === "expert" ? `E${rel.primary.expert}`
        : pk === "sharedExpert" ? `SE${rel.primary.shared}`
        : `EP rank ${rel.primary.epRank}`;
      if (rel.layers.size === 1) {
        const only = Array.from(rel.layers)[0];
        labels.arch = `${who} in Layer ${only} · PP${topology.stageOfLayer(only)}`;
      } else {
        labels.arch = `${who} · ${formatRuns(rel.layers, "L", 1)} 各一份`;
      }
    }

    // MoE：EP rank + 本地专家区间，专家全量时改用摘要，避免拼出 64 段
    const epParts = [];
    if (rel.epRanks.size && rel.epRanks.size < c.ep) {
      Array.from(rel.epRanks).sort((a, b) => a - b).slice(0, 3).forEach((p) => {
        const own = topology.expertsOfEpRank(p).filter((e) => rel.experts.has(e));
        epParts.push(own.length ? `Rank ${p}(${formatRuns(own, "E", 1)})` : `Rank ${p}`);
      });
      if (rel.epRanks.size > 3) epParts.push(`等 ${rel.epRanks.size} 个 EP rank`);
    } else if (rel.epRanks.size) {
      // 只牵连到 EP ranks、没点到具体专家时（MoE 列里的 Attn / Norm / Add），
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
      /* 光看卡数容易读成"每张卡各存一份完整层权重"，所以 TP≥2 时补两行口径。
         份额分两种：Attn / 共享专家 / Dense MLP 是纯 TP 切，单卡 1/tp；MoE 层的
         大头是路由专家，先被 EP 切成 1/ep 再被 TP 切一刀，单卡实际持有 1/(tp×ep)
         —— 只写 1/tp 会把真实份额高估两个数量级。
         不解释 EP 对 Dense / Emb / Norm / Head 是副本这件事：这几段本来就不涉及
         专家，是业务常识，写在气泡里是噪音。
         卡片挂在连线中点上，行不能长：一行控制在 ~24 个汉字内。 */
      labels.cluster = `Node ${span} · ${rel.ranks.size} 卡`;
      if (pk === "rank" && Number.isFinite(rel.primary.rank)) {
        const co = topology.coordsOfRank(rel.primary.rank);
        labels.cluster = coordLine(topology, co);
      }
      // 只给「结构对象 → 卡」这类选择加口径说明：点 rank / 专家问的是别的事
      const structural = rel.primary
        && (rel.primary.kind === "layer" || rel.primary.kind === "segment");
      if (structural && c.tp > 1) {
        const withMoe = Array.from(rel.layers).some((l) => topology.layers[l]?.ffn === "moe");
        labels.cluster = [
          labels.cluster,
          `明暗相间 = TP 切出的 ${c.tp} 份，每条一份`,
          withMoe
            ? `单卡持有 Attn/共享专家 1/${c.tp} · 路由专家 1/(${c.tp}×${c.ep})`
            : `单卡持有 1/${c.tp}（只按 TP 切）`,
        ];
      }
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
      // 夹取宿主是滚动视口 .cro-cluster__grid 而不是矩阵本身 —— rank 多到矩阵
      // 要内部滚动时，#croHeat 的 rect 比看得见的那块高，锚点会落到区域之外
      cluster: pick("#croHeat .twin-heat-cell.is-selected", "#croHeat .twin-heat-cell.is-related", ".cro-cluster__grid"),
    };
  }

  /* 集群里被牵连的格子按 PP stage 拆成多个锚点。点专家/EP 组/共享专家时，该编号的
     EP 组在**每个 stage** 内都占一块 rank —— 集群图正好横向分成 pp 个 stage 块，把
     每块的并集包围盒各作一个锚点，drawRelationLinks 就能对每个 stage 各拉一条线，
     而不是把 4 段并成一个横跨整幅热力图的巨框。 */
  function clusterStageAnchors() {
    const host = document.querySelector("#croHeat");
    const viewport = document.querySelector(".cro-cluster__grid") || host;
    const board = document.getElementById("croBoard");
    if (!host) return [];
    // 同 collectAnchors：夹在滚动视口上，矩阵内部滚动时锚点不跑出可视区
    const fit = (rect) => clampRectTo(clampRectTo(rect, viewport), board);
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

  /* text 可以是一行字符串，也可以是多行数组（第二行起是补充说明，用 __sub 弱化）。
     多行时整块以 (x, y) 为竖直中心排布，行距 LINE_H。 */
  function appendLinkLabel(layer, text, x, y) {
    const lines = (Array.isArray(text) ? text : [text]).filter(Boolean);
    if (!lines.length) return;
    const LINE_H = 16;
    const group = document.createElementNS(SVG_NS, "g");
    const box = document.createElementNS(SVG_NS, "rect");
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "cro-link-label__text");
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(y));
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("text-anchor", "middle");
    const top = y - ((lines.length - 1) * LINE_H) / 2;
    lines.forEach((line, i) => {
      const tspan = document.createElementNS(SVG_NS, "tspan");
      tspan.setAttribute("x", String(x));
      tspan.setAttribute("y", String(top + i * LINE_H));
      if (i > 0) tspan.setAttribute("class", "cro-link-label__sub");
      tspan.textContent = line;
      label.appendChild(tspan);
    });
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
    FLAG_SPECS,
    FIELD_ORDER,
    flagText,
    validate,
    warn,
    derive,
    stepValue,
    reconcile,
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

  /* ══ 事件内涵 · 证据图表 ═══════════════════════════════════════════════════
     三种形态，按「这组数要回答什么」选，不按好看选：
       line  —— 随时间怎么变（loss scale 衰减、显存爬升）
       bars  —— 谁比谁大（专家 token 份额、逐层激活）
       stack —— 一个总量由什么构成（显存构成、step 耗时构成、2048 卡状态构成）
     两条硬规矩：
       1. 一张图只有一根 y 轴。量纲不同的第二个指标进读数区，不叠双轴。
       2. 取色只用设计系统 token。--primary 是常规量；--warning / --danger 专门
          留给「确实是问题」的那一段，不当第 N 个分类色使唤。
     这套取色跑过 CVD 校验：相邻色对在色盲与常视觉下都可分；浅色主题下绿/橙对
     底色的对比度不足 3:1，故每段都带可见数值标签，不靠颜色单独承载信息。 */
  const CHART_TONE = {
    neutral: "var(--primary)",
    /* 第二个分类色。不用状态色（绿/橙/红各有语义），也不用 deck 的 comm 青
       —— 青与 --primary 蓝在常视觉下 ΔE 只有 11，低于 15 的可分辨下限，
       两段挨着放根本认不出是两类。紫是本页现成的 deck 语义色，与蓝的 ΔE 18。 */
    alt: "var(--pto-model-deck-mlp)",
    good: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
  };

  function svgNode(name, attrs = {}, text) {
    const el = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
    if (text != null) el.textContent = text;
    return el;
  }

  function fmtValue(value, unit = "") {
    const abs = Math.abs(value);
    const digits = abs >= 100 || Number.isInteger(value) ? 0 : abs >= 10 ? 1 : 2;
    return `${value.toLocaleString("en-US", { maximumFractionDigits: digits })}${unit}`;
  }

  /* 数据端圆角、基线端方角（rx 会把两头都磨圆，读起来像浮在轨道上的胶囊）。 */
  function barPath(x, y, w, h, r = 4) {
    const rr = Math.max(0, Math.min(r, w, h / 2));
    if (w <= 0) return "";
    return `M${x},${y}h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - rr * 2}a${rr},${rr} 0 0 1 ${-rr},${rr}h${-(w - rr)}z`;
  }

  /* 数据端圆角、基线端方角的竖版（圆角在顶部） */
  function columnPath(x, y, w, h, r = 4) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    if (h <= 0) return "";
    return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - rr * 2}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}Z`;
  }

  /* 阈值判定。direction 缺省是「越过上界为坏」；loss scale 这类指标反过来，
     跌破下界才是坏，写 direction: "below"。 */
  function isOverThreshold(value, threshold) {
    if (!threshold || !Number.isFinite(value)) return false;
    return threshold.direction === "below" ? value < threshold.value : value > threshold.value;
  }

  let chartClipSeq = 0;   // 同页多图共存，clipPath id 不能撞

  function chartLine(spec, width, budget) {
    const W = width || 560, P = { l: 56, r: 20, t: 16, b: 26 };
    // 小屏下先压高度：折线的形状靠横向趋势读，压扁比出滚动条好
    const H = Math.max(104, Math.min(budget || 180, 180));
    const values = spec.values;
    const threshold = spec.threshold;
    // 阈值线必须落在画面内，否则「越线」这件事无从读起 —— 把它并进 y 轴域
    const domain = threshold ? values.concat(threshold.value) : values;
    const lo = Math.min(...domain), hi = Math.max(...domain);
    const span = hi - lo || 1;
    const plotBottom = H - P.b;
    const x = (i) => P.l + (i / Math.max(1, values.length - 1)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);

    const svg = svgNode("svg", {
      class: "cro-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": spec.title,
    });
    [0, 0.5, 1].forEach((t) => {
      const yy = P.t + t * (H - P.t - P.b);
      svg.appendChild(svgNode("line", { class: "cro-chart__grid", x1: P.l, x2: W - P.r, y1: yy, y2: yy }));
    });
    // y 轴只标上下界，中间靠网格线读
    svg.appendChild(svgNode("text", { class: "cro-chart__tick", x: P.l - 8, y: P.t + 4, "text-anchor": "end" }, fmtValue(hi, spec.unit)));
    svg.appendChild(svgNode("text", { class: "cro-chart__tick", x: P.l - 8, y: H - P.b + 4, "text-anchor": "end" }, fmtValue(lo, spec.unit)));

    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const d = `M${points.join("L")}`;
    // 面积填充：折线之下到基线围成的闭合区域，弱填充，只用来压出「量」的体感
    const area = `M${x(0).toFixed(1)},${plotBottom}L${points.join("L")}L${x(values.length - 1).toFixed(1)},${plotBottom}Z`;
    svg.appendChild(svgNode("path", { class: "cro-chart__area", d: area }));

    /* 越过阈值的那一段单独标红：不改折线的取值，只用一个裁剪框把「阈值之外」
       的画面切出来，在里面把面积与线重画一遍成红色 —— 与显存曲线同一套画法。 */
    if (threshold) {
      const ty = y(threshold.value);
      const clipId = `croChartOver-${chartClipSeq += 1}`;
      const defs = svgNode("defs");
      const clip = svgNode("clipPath", { id: clipId });
      clip.appendChild(svgNode("rect", {
        x: P.l, width: W - P.l - P.r,
        y: threshold.direction === "below" ? ty : P.t,
        height: Math.max(0, threshold.direction === "below" ? plotBottom - ty : ty - P.t),
      }));
      defs.appendChild(clip);
      svg.appendChild(defs);
      svg.appendChild(svgNode("path", {
        class: "cro-chart__area is-over", d: area, "clip-path": `url(#${clipId})`,
      }));
      svg.appendChild(svgNode("line", {
        class: "cro-chart__threshold", x1: P.l, x2: W - P.r, y1: ty, y2: ty,
      }));
      svg.appendChild(svgNode("text", {
        class: "cro-chart__threshold-label", x: W - P.r, y: ty - 5, "text-anchor": "end",
      }, threshold.label));
      svg.appendChild(svgNode("path", { class: "cro-chart__line", d }));
      svg.appendChild(svgNode("path", {
        class: "cro-chart__line is-over", d, "clip-path": `url(#${clipId})`,
      }));
    } else {
      svg.appendChild(svgNode("path", { class: "cro-chart__line", d }));
    }

    // x 轴只标首尾，异常点另有直标
    svg.appendChild(svgNode("text", { class: "cro-chart__tick", x: P.l, y: H - 6 }, spec.x[0]));
    svg.appendChild(svgNode("text", { class: "cro-chart__tick", x: W - P.r, y: H - 6, "text-anchor": "end" }, spec.x[spec.x.length - 1]));

    const mark = spec.mark;
    if (mark && Number.isFinite(mark.index)) {
      const mx = x(mark.index), my = y(values[mark.index]);
      // 2px 底色描边，让标记点从线上浮起来
      svg.appendChild(svgNode("circle", { class: "cro-chart__mark-ring", cx: mx, cy: my, r: 6 }));
      const dot = svgNode("circle", { class: "cro-chart__mark", cx: mx, cy: my, r: 4 });
      dot.style.fill = CHART_TONE[mark.tone || "danger"];
      svg.appendChild(dot);
      const anchor = mark.index > values.length / 2 ? "end" : "start";
      const label = svgNode("text", {
        class: "cro-chart__mark-label", x: mx + (anchor === "end" ? -10 : 10), y: my + 4, "text-anchor": anchor,
      }, mark.label);
      svg.appendChild(label);
    }
    return svg;
  }

  /* 条目多 / 高度紧张时，横条改竖排（一根一根并排的柱子）：横条一根占一行，
     12 项就是 12 行，高度只增不减；竖柱把「多」摊到宽度上，高度恒定。
     横条留给条目少、类目名长的情形（send/recv 那种），它读起来更稳。 */
  const BARS_ROW_MIN = 15;

  function chartBars(spec, width, budget) {
    const padY = 6, labelW = 128, valueW = 78;
    const W = width || 560;
    const items = spec.items;
    const rowsNeed = padY * 2 + items.length * BARS_ROW_MIN;
    if (items.length > 6 || (budget && rowsNeed > budget)) return chartColumns(spec, width, budget);

    const cap = Math.max(120, Math.min(budget || 210, 210));
    const rowH = Math.max(BARS_ROW_MIN, Math.min(22, (cap - padY * 2) / items.length));
    const barH = Math.min(10, Math.max(5, rowH - 9));
    const H = padY * 2 + items.length * rowH;
    const threshold = spec.threshold;
    const max = Math.max(...items.map((i) => i.value), threshold ? threshold.value : 0) || 1;
    const trackW = W - labelW - valueW;
    const svg = svgNode("svg", {
      class: "cro-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": spec.title,
    });
    items.forEach((item, index) => {
      const y = padY + index * rowH;
      const barY = y + (rowH - barH) / 2;
      svg.appendChild(svgNode("text", {
        class: "cro-chart__cat", x: labelW - 10, y: barY + barH - 2, "text-anchor": "end",
      }, item.label));
      svg.appendChild(svgNode("path", {
        class: "cro-chart__track", d: barPath(labelW, barY, trackW, barH),
      }));
      const width = Math.max(item.value > 0 ? 2 : 0, (item.value / max) * trackW);
      if (width) {
        const bar = svgNode("path", { class: "cro-chart__bar", d: barPath(labelW, barY, width, barH) });
        // 越过警戒线的自动标红：红色的来由就是那条线，不靠手工指定
        const over = isOverThreshold(item.value, threshold);
        bar.style.fill = CHART_TONE[over ? "danger" : (item.tone || "neutral")];
        bar.appendChild(svgNode("title", {}, `${item.label}：${fmtValue(item.value, spec.unit)}`));
        svg.appendChild(bar);
      }
      svg.appendChild(svgNode("text", {
        class: "cro-chart__value", x: labelW + trackW + 10, y: barY + barH - 2,
      }, fmtValue(item.value, spec.unit)));
    });
    if (threshold) {
      const tx = labelW + (threshold.value / max) * trackW;
      svg.appendChild(svgNode("line", {
        class: "cro-chart__threshold", x1: tx, x2: tx, y1: padY, y2: H - padY,
      }));
      svg.appendChild(svgNode("text", {
        class: "cro-chart__threshold-label", x: tx + 4, y: padY + 9,
      }, threshold.label));
    }
    return svg;
  }

  /* 竖排柱：类目摊在横轴上，高度恒定不随条目数增长。
     直标只给「有问题」的那几根（tone 非 neutral），12 根全标必然叠字。 */
  function chartColumns(spec, width, budget) {
    const W = width || 560;
    const H = Math.max(104, Math.min(budget || 160, 168));
    const P = { l: 44, r: 10, t: 16, b: 20 };
    const items = spec.items;
    const threshold = spec.threshold;
    const plotW = W - P.l - P.r, plotH = H - P.t - P.b;
    const max = Math.max(...items.map((i) => i.value), threshold ? threshold.value : 0) || 1;
    const slot = plotW / items.length;
    const barW = Math.max(4, Math.min(28, slot - 8));

    const svg = svgNode("svg", {
      class: "cro-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": spec.title,
    });
    [0, 0.5, 1].forEach((t) => {
      const y = P.t + t * plotH;
      svg.appendChild(svgNode("line", { class: "cro-chart__grid", x1: P.l, x2: W - P.r, y1: y, y2: y }));
    });
    svg.appendChild(svgNode("text", {
      class: "cro-chart__tick", x: P.l - 8, y: P.t + 4, "text-anchor": "end",
    }, fmtValue(max, spec.unit)));
    svg.appendChild(svgNode("text", {
      class: "cro-chart__tick", x: P.l - 8, y: P.t + plotH + 4, "text-anchor": "end",
    }, "0"));

    if (threshold) {
      const ty = P.t + plotH - (threshold.value / max) * plotH;
      svg.appendChild(svgNode("line", {
        class: "cro-chart__threshold", x1: P.l, x2: W - P.r, y1: ty, y2: ty,
      }));
      svg.appendChild(svgNode("text", {
        class: "cro-chart__threshold-label", x: W - P.r, y: ty - 4, "text-anchor": "end",
      }, threshold.label));
    }

    items.forEach((item, index) => {
      const cx = P.l + slot * (index + 0.5);
      const h = (item.value / max) * plotH;
      const x = cx - barW / 2;
      // 越过警戒线的自动标红：红色的来由就是那条线，不靠手工指定
      const over = isOverThreshold(item.value, threshold);
      if (h > 0) {
        const bar = svgNode("path", {
          class: "cro-chart__bar", d: columnPath(x, P.t + plotH - h, barW, h),
        });
        bar.style.fill = CHART_TONE[over ? "danger" : (item.tone || "neutral")];
        bar.appendChild(svgNode("title", {}, `${item.label}：${fmtValue(item.value, spec.unit)}`));
        svg.appendChild(bar);
      }
      svg.appendChild(svgNode("text", {
        class: "cro-chart__cat", x: cx, y: H - 6, "text-anchor": "middle",
      }, item.label));
      if (over || (item.tone && item.tone !== "neutral")) {
        svg.appendChild(svgNode("text", {
          class: "cro-chart__value", x: cx, y: P.t + plotH - h - 5, "text-anchor": "middle",
        }, fmtValue(item.value, spec.unit)));
      }
    });
    return svg;
  }

  /* 构成条：与 pto-swimlane-profiler inspector 里的 .sl-meter + .sl-kv 同款——
     一条 pill 轨道，几段并排铺满不留缝，读数一律落到下面的直标行里。
     不再走 SVG：这张图没有坐标轴，用 DOM 反而能直接吃到 token 和 pill 圆角。 */
  function chartStack(spec) {
    const items = spec.items;
    const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
    const wrap = document.createElement("div");
    wrap.className = "cro-chart-stack";

    const meter = document.createElement("div");
    meter.className = "cro-meter";
    meter.setAttribute("role", "img");
    meter.setAttribute("aria-label", spec.title);
    const addSeg = (share, tone, tip, over) => {
      const seg = document.createElement("div");
      seg.className = over ? "cro-meter__seg cro-meter__seg--over" : "cro-meter__seg";
      seg.style.width = `${share * 100}%`;
      seg.style.setProperty("--cro-seg", CHART_TONE[tone] || tone);
      if (tip) seg.dataset.tip = tip;
      meter.appendChild(seg);
    };

    items.forEach((item) => {
      const share = item.value / total;
      const tip = `${item.label}：${fmtValue(item.value, spec.unit)}`;
      /* limitShare = 这一段「本该占多少」。实际超出时就地切两截：两截同色
         （它们是同一件事，不该被读成两种严重度），超出的那截换成同色细斜纹
         —— 一眼读出「多出来的是哪一块、有多大」，而不是只知道总数偏大。 */
      const limit = Number.isFinite(item.limitShare) ? item.limitShare / 100 : null;
      const tone = item.tone || "neutral";
      if (limit !== null && share > limit) {
        addSeg(limit, tone, `${tip}（其中正常水位 ${item.limitShare}%）`, false);
        addSeg(share - limit, tone, `${tip}（超出水位的部分）`, true);
      } else {
        addSeg(share, tone, tip, false);
      }
    });
    wrap.appendChild(meter);

    wrap.appendChild(chartLegend(items, total, spec.unit));
    return wrap;
  }

  /* 图例即直标：色块只管身份，数值与占比一律用文字色，不靠颜色读数。
     构成条与等距容器（chartCapacity）共用这一份 —— 两张图讲的是同一种「构成」，
     直标行长得不一样会让人以为是两套读数。
     total 由调用方给：构成条按各段之和算占比，等距容器按**容量**算（装了 80%
     和「这一段占已装部分的 80%」是两回事）。 */
  function chartLegend(items, total, unit, options) {
    const opts = options || {};
    const legend = document.createElement("ul");
    legend.className = "cro-chart-legend";
    const addRow = (dotClass, tone, label, value, sub) => {
      const li = document.createElement("li");
      li.className = sub ? "cro-chart-legend__item cro-chart-legend__item--sub" : "cro-chart-legend__item";
      const dot = document.createElement("span");
      dot.className = dotClass;
      dot.style.setProperty("--cro-seg", CHART_TONE[tone] || tone);
      const name = document.createElement("span");
      name.className = "cro-chart-legend__label";
      name.textContent = label;
      const val = document.createElement("span");
      val.className = "cro-chart-legend__value";
      val.textContent = value;
      li.append(dot, name, val);
      legend.appendChild(li);
    };
    (opts.reverse ? items.slice().reverse() : items).forEach((item) => {
      const tone = item.tone || "neutral";
      const pct = (item.value / total) * 100;
      const overrun = Number.isFinite(item.limitShare) && pct > item.limitShare;
      // 空当段（碎片/预留）在等距容器里画的是虚线棱，图例键也换成同义的斜纹块
      addRow(item.void ? "cro-chart-legend__dot cro-chart-legend__dot--void" : "cro-chart-legend__dot",
        tone, item.label, Number.isFinite(item.limitShare)
          ? `${fmtValue(item.value, unit)} · ${pct.toFixed(1)}%（正常 ${item.limitShare}%）`
          : `${fmtValue(item.value, unit)} · ${Math.round(pct)}%`);
      // 斜纹那截自己占一行，纹样即图例键——否则条上多出来的纹理没人解释
      if (overrun) {
        const excess = item.value - (item.limitShare / 100) * total;
        addRow("cro-chart-legend__dot cro-chart-legend__dot--over", tone, "超出正常水位",
          `${fmtValue(excess, unit)} · ${(pct - item.limitShare).toFixed(1)}%`, true);
      }
    });
    return legend;
  }

  /* 等距容器：与 Cluster 区「单卡容量」栏同一个 builder（config-relation-capacity.js
     的 global.croCapacityBox），不在这里再画一份 3D。
     用它而不是构成条的判据是「有没有一个固定的容量上限」：显存构成图的分母是那张
     卡的 64 GB，装不下就是 OOM —— 平面色条只能表达比例，表达不了「框满了」。
     spec 比 stack 多一个 cap（容量，与 items[].value 同单位）；items 自底向上排，
     图例按视觉从上往下读，所以倒序。 */
  function chartCapacity(spec, width, budget, host) {
    const api = global.croCapacityBox;
    // 容量脚本没加载（或被单独引用本文件的页面复用）时退回构成条，不留空白
    if (!api || !(spec.cap > 0)) return chartStack(spec);

    const wrap = document.createElement("div");
    wrap.className = "cro-chart-capacity";
    const scene = document.createElement("div");
    scene.className = "cro-chart-capacity__scene";
    /* 盒子是竖长的，高度就是它的「量纲」——给到预算上限（下限 148px，再矮
       阈值环上的百分比标签会挤成一团）。宽度由 CSS 固定，SVG 自己等比缩放。 */
    scene.style.height = `${Math.max(148, Math.min(budget || 220, 260))}px`;
    wrap.appendChild(scene);
    wrap.appendChild(chartLegend(spec.items, spec.cap, spec.unit, { reverse: true }));

    /* var(--token) 要在**已挂到文档上**的节点上解析（deck 语义色定义在
       .cro-incident-view 上，不在 :root）。wrap 此刻还是游离的，所以传 host。 */
    scene.appendChild(api.build({
      cap: spec.cap,
      host: host || document.body,
      ariaLabel: spec.title,
      format: (v) => fmtValue(v, spec.unit),
      segments: spec.items.map((item) => ({
        label: item.label,
        value: item.value,
        color: CHART_TONE[item.tone || "neutral"],
        // 空当不是「装进去的东西」，与单卡容量栏的预留段同一种画法
        dashed: !!item.void,
        opacity: item.void ? 0.62 : null,
      })),
      thresholds: [
        { at: api.THRESHOLD.tight, color: CHART_TONE.warning },
        { at: api.THRESHOLD.alert, color: CHART_TONE.danger },
      ],
    }));
    return wrap;
  }

  const CHART_BUILDERS = { line: chartLine, bars: chartBars, stack: chartStack, capacity: chartCapacity };

  /* ══ 计算血缘 ════════════════════════════════════════════════════════════
     这里刻意不把 FX / GE / Runtime 写进 CroTopology：拓扑是配置映射，血缘是
     编译与执行映射，两者生命周期不同。本页尚未接 profiler / compiler dump，
     因此下面构造一条完整、可交互的演示链。 */
  const LINEAGE_LOWERING = {
    embedding: {
      fx: ["aten.embedding.default"], ge: ["GatherV2"],
      runtime: ["GatherV2 task"], kernel: ["gather_v2_aicore_tiling_v3"],
    },
    norm: {
      fx: ["aten.rms_norm.default"], ge: ["RmsNorm"],
      runtime: ["RmsNorm task"], kernel: ["rms_norm_vector_tiling_v2"],
    },
    attention: {
      fx: ["aten.matmul.default", "aten.softmax.int", "aten.matmul.default"],
      ge: ["FlashAttentionScore"], runtime: ["FlashAttentionScore task"],
      kernel: ["flash_attention_score_aicore_v4"],
    },
    linear: {
      fx: ["aten.linear.default"], ge: ["MatMul", "Add"],
      runtime: ["MatMul task", "Vector Add task"],
      kernel: ["matmul_cube_tiling_v5", "add_vector_tiling_v2"],
    },
    head: {
      fx: ["aten.linear.default"], ge: ["MatMul"],
      runtime: ["LM Head MatMul task"], kernel: ["matmul_cube_split_k_v3"],
    },
    mlp: {
      fx: ["aten.linear.default", "aten.silu.default", "aten.linear.default"],
      ge: ["MatMul", "Swish", "MatMul"], runtime: ["Fused MLP task"],
      kernel: ["fused_mlp_cube_vector_v2"],
    },
    act: {
      fx: ["aten.silu.default"], ge: ["Swish"],
      runtime: ["Swish task"], kernel: ["swish_vector_tiling_v2"],
    },
    gate: {
      fx: ["aten.linear.default", "aten.softmax.int", "aten.topk.default"],
      ge: ["MatMul", "SoftmaxV2", "TopK"],
      runtime: ["Router MatMul task", "Router select task"],
      kernel: ["router_matmul_cube_v3", "softmax_topk_vector_v4"],
    },
    moe: {
      fx: ["call_function.moe_expert_pool"], ge: ["MoeGatingTopK", "MoeFinalizeRouting"],
      runtime: ["MoE expert task group"], kernel: ["moe_expert_ffn_aicore_v3"],
    },
    comm: {
      fx: ["call_function.npu_all_to_all"], ge: ["HcomAllToAll"],
      runtime: ["HCCL collective task"], kernel: ["HCCL AllToAll executor"],
    },
    output: {
      fx: ["call_function.output"], ge: ["NetOutput"],
      runtime: ["Graph output task"], kernel: ["device_to_host_completion"],
    },
    decoder: {
      fx: ["call_module.decoder_block"], ge: ["PartitionedCall"],
      runtime: ["Decoder task group"], kernel: ["decoder_kernel_group"],
    },
    input: {
      fx: ["placeholder.input"], ge: ["Data"],
      runtime: ["Graph input task"], kernel: ["host_to_device_enqueue"],
    },
    parameter: {
      fx: ["get_attr.parameter"], ge: ["Const"],
      runtime: ["Weight binding"], kernel: ["parameter_address_binding"],
    },
    state: {
      fx: ["get_attr.state"], ge: ["Variable"],
      runtime: ["State binding"], kernel: ["state_address_binding"],
    },
  };

  const LINEAGE_DEFAULT = {
    fx: ["call_function.custom_op"], ge: ["CustomOp"],
    runtime: ["Custom operator task"], kernel: ["custom_aicore_kernel"],
  };

  const LINEAGE_STAGE_META = [
    { id: "model", title: "模型语义", system: "模型语义层，用于定位用户模型中的结构与算子意图" },
    { id: "fx", title: "FX Graph", system: "PyTorch FX 图层，用于记录框架捕获后的算子级表达" },
    { id: "ge", title: "GE Graph", system: "GE 图编译层，用于呈现昇腾侧 Lowering、融合与图优化结果" },
    { id: "runtime", title: "Runtime", system: "CANN 运行时层，用于展示任务下发、Stream 与 Rank 执行位置" },
    { id: "kernel", title: "Kernel / Executor", system: "Kernel 执行层，用于说明最终 Kernel、通信执行器与 Tiling 选择" },
  ];

  const lineageStageMeta = (id) => LINEAGE_STAGE_META.find((stage) => stage.id === id);
  const LINEAGE_NODE_NAME_TIPS = {
    model: "模型语义节点名称：表示用户模型中的结构或算子意图。",
    fx: "FX 节点名称：表示 PyTorch 捕获后的算子级表达。",
    ge: "GE 算子名称：表示 Lowering、融合与图优化后的昇腾侧算子。",
    runtime: "Runtime 任务名称：表示 CANN 下发到 Stream 的执行任务。",
    kernel: "Kernel / Executor 名称：表示设备侧最终执行的 Kernel 或通信执行器。",
  };
  const LINEAGE_NODE_ID_TIP = "节点 ID：用于在当前定位链中标识节点并建立跨层映射。点击后可打开节点证据详情，查看输入输出、转换依据及关联日志（暂未上线）。";

  function lineageIdPart(value) {
    return String(value || "node").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  function lineageTransition(stageId, sourceCount, targetCount) {
    if (stageId === "model") return { kind: "capture", label: sourceCount < targetCount ? "捕获展开" : "捕获" };
    if (stageId === "fx") {
      if (sourceCount > targetCount) return { kind: "fusion", label: "融合" };
      if (sourceCount < targetCount) return { kind: "split", label: "拆分" };
      return { kind: "lowering", label: "Lowering" };
    }
    if (stageId === "ge") {
      return sourceCount > targetCount
        ? { kind: "fusion", label: "任务聚合" }
        : { kind: "dispatch", label: "任务下发" };
    }
    return sourceCount > targetCount
      ? { kind: "fusion", label: "执行融合" }
      : sourceCount < targetCount
        ? { kind: "split", label: "Kernel 拆分" }
        : { kind: "dispatch", label: "Kernel 选择" };
  }

  function buildLineageEdges(stages) {
    const edges = [];
    stages.slice(0, -1).forEach((stage, stageIndex) => {
      const next = stages[stageIndex + 1];
      const sources = stage.available === false ? [] : stage.nodes.filter((node) => node.id);
      const targets = next.available === false ? [] : next.nodes.filter((node) => node.id);
      if (!sources.length || !targets.length) return;
      const relation = lineageTransition(stage.id, sources.length, targets.length);
      const pairs = [];
      if (sources.length === 1 || targets.length === 1) {
        sources.forEach((source) => targets.forEach((target) => pairs.push([source, target])));
      } else if (sources.length === targets.length) {
        sources.forEach((source, index) => pairs.push([source, targets[index]]));
      } else {
        sources.forEach((source, index) => {
          pairs.push([source, targets[Math.min(targets.length - 1, Math.floor(index * targets.length / sources.length))]]);
        });
        targets.forEach((target, index) => {
          pairs.push([sources[Math.min(sources.length - 1, Math.floor(index * sources.length / targets.length))], target]);
        });
      }
      const seen = new Set();
      pairs.forEach(([source, target]) => {
        const key = `${source.id}>${target.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({
          id: key,
          from: source.id,
          to: target.id,
          fromStage: stage.id,
          toStage: next.id,
          kind: relation.kind,
          label: relation.label,
        });
      });
    });
    return edges;
  }

  function completeLineage(data) {
    data.edges = buildLineageEdges(data.stages);
    return data;
  }

  const INCIDENT_LINEAGE_ROLES = [
    { id: "origin", label: "传播源" },
    { id: "victim", label: "受影响" },
  ];

  function incidentRoleStage(scope, spec, roleId) {
    const nodeRef = spec?.[`${roleId}Node`];
    if (LINEAGE_STAGE_META.some((stage) => stage.id === nodeRef?.stage)) return nodeRef.stage;
    const explicit = spec?.[`${roleId}Stage`];
    if (LINEAGE_STAGE_META.some((stage) => stage.id === explicit)) return explicit;
    if (scope?.ranks != null || scope?.stages != null || scope?.experts != null) return "runtime";
    if (scope?.layers != null || scope?.segments != null) return "model";
    const stages = spec?.stages || [];
    return roleId === "origin" ? stages[0] : stages[stages.length - 1];
  }

  function attachIncidentLineageRoles(data, event, spec) {
    INCIDENT_LINEAGE_ROLES.forEach((role) => {
      const stageId = incidentRoleStage(event?.[role.id], spec, role.id);
      const stage = data.stages.find((entry) => entry.id === stageId);
      if (!stage) return;
      const nodeRef = spec?.[`${role.id}Node`];
      const node = nodeRef?.stage === stage.id ? stage.nodes[nodeRef.index] : null;
      // 只有事件显式声明了层与节点序号，角色才下沉到卡片；不能靠“该层恰好只有
      // 一张卡”猜测异常落点，否则会把层级证据误读成节点级证据。
      if (stage.available && node?.id) {
        node.roles.push(role);
      } else {
        stage.roles.push(role);
      }
    });
    return data;
  }

  function buildMockLineage(topology, rel) {
    if (!rel?.bar || rel.primary?.kind !== "segment" || rel.primary.wholeColumn) return null;
    const col = activeColumns(topology).find((entry) => entry.id === rel.bar.segment);
    const bar = col?.bars.find((entry) => entry.id === rel.bar.bar);
    if (!bar) return null;

    const p = rel.primary;
    const layers = Array.from(rel.layers).sort((a, b) => a - b);
    const explicitLayer = [p.scopeLayer, p.preferLayer]
      .find((value) => Number.isFinite(value) && (!layers.length || layers.includes(value)));
    const representativeLayer = Number.isFinite(explicitLayer)
      ? explicitLayer
      : Number.isFinite(rel.deckLayer) ? rel.deckLayer : null;
    const scopeText = Number.isFinite(explicitLayer)
      ? `Layer ${explicitLayer}`
      : layers.length
        ? `${formatRuns(layers, "L", 2)} · 代表实例 L${representativeLayer}`
        : `${col.name} · PP${Array.from(rel.stages)[0] ?? 0}`;

    const ranks = Array.from(rel.ranks).sort((a, b) => a - b);
    const representativeStage = Number.isFinite(representativeLayer)
      ? topology.stageOfLayer(representativeLayer)
      : Array.from(rel.stages)[0];
    const rank = ranks.find((value) => topology.coordsOfRank(value).stage === representativeStage) ?? ranks[0];
    const co = Number.isFinite(rank) ? topology.coordsOfRank(rank) : null;
    const placement = co
      ? coordLine(topology, co)
      : "未绑定代表执行 Rank";
    const layerKey = Number.isFinite(representativeLayer) ? `l${representativeLayer}` : col.id;
    const nodeKey = lineageIdPart(bar.deckNode || bar.id);
    const lowering = LINEAGE_LOWERING[bar.op] || LINEAGE_DEFAULT;
    const stream = Number.isFinite(representativeLayer) ? representativeLayer % 8 : 0;

    const nodes = (stage, names, detail) => names.map((name, index) => ({
      name,
      id: `lineage:${stage}:${layerKey}:${nodeKey}:${index}`,
      detail: typeof detail === "function" ? detail(name, index) : detail,
    }));

    return completeLineage({
      key: `${layerKey}/${col.id}/${bar.id}/${rank}`,
      operator: bar.label,
      scope: scopeText,
      placement,
      stages: [
        {
          ...lineageStageMeta("model"),
          nodes: nodes("model", [bar.label], `${scopeText} · ${col.name}`),
        },
        {
          ...lineageStageMeta("fx"),
          nodes: nodes("fx", lowering.fx, (_name, index) => `call_function · node ${index + 1}/${lowering.fx.length}`),
        },
        {
          ...lineageStageMeta("ge"),
          nodes: nodes("ge", lowering.ge, (_name, index) => `lowering / fusion result · op ${index + 1}/${lowering.ge.length}`),
        },
        {
          ...lineageStageMeta("runtime"),
          nodes: nodes("runtime", lowering.runtime, () => `stream ${stream} · ${placement}`),
        },
        {
          ...lineageStageMeta("kernel"),
          nodes: nodes("kernel", lowering.kernel, (name) => name.startsWith("HCCL")
            ? "communication executor · execution selection"
            : "AI Core / Vector Core · tiling selection"),
        },
      ],
    });
  }

  function buildIncidentLineage(event, topology) {
    const spec = event?.lineage || {};
    const available = new Set(spec.stages || []);
    const columns = activeColumns(topology);
    const col = spec.segment ? columns.find((entry) => entry.id === spec.segment) : null;
    const bar = spec.bar ? col?.bars.find((entry) => entry.id === spec.bar) : null;
    const lowering = bar ? (LINEAGE_LOWERING[bar.op] || LINEAGE_DEFAULT) : null;
    const operator = spec.operator || bar?.label || event?.title || "未定位算子";
    const scope = Number.isFinite(spec.layer)
      ? `Layer ${spec.layer}${col ? ` · ${col.name}` : ""}`
      : "尚未定位到具体 Layer";
    const co = Number.isFinite(spec.rank) ? topology.coordsOfRank(spec.rank) : null;
    const placement = co
      ? coordLine(topology, co)
      : "尚未定位到具体执行 Rank";
    const layerKey = Number.isFinite(spec.layer) ? `l${spec.layer}` : "unscoped";
    const nodeKey = lineageIdPart(bar?.deckNode || spec.bar || operator);
    const stream = Number.isFinite(spec.layer) ? spec.layer % 8 : 0;

    const namesByStage = {
      model: [operator],
      fx: lowering?.fx || [],
      ge: lowering?.ge || [],
      runtime: lowering?.runtime || (available.has("runtime") ? [operator] : []),
      kernel: lowering?.kernel || (available.has("kernel") ? [operator] : []),
    };
    const detailByStage = {
      model: scope,
      fx: "框架捕获后的算子表达",
      ge: "Lowering / 融合结果",
      runtime: `${placement} · stream ${stream}`,
      kernel: "Kernel / Executor 与 Tiling 选择",
    };

    const data = {
      event: `${event.code || event.id} · ${event.title}`,
      operator,
      scope,
      placement,
      stages: LINEAGE_STAGE_META.map((meta) => {
        const isAvailable = available.has(meta.id);
        const names = isAvailable && namesByStage[meta.id]?.length
          ? namesByStage[meta.id]
          : ["本事件未定位到该层"];
        return {
          ...meta,
          available: isAvailable,
          roles: [],
          nodes: names.map((name, index) => ({
            name,
            id: isAvailable ? `event:${event.id}:${meta.id}:${layerKey}:${nodeKey}:${index}` : "",
            detail: isAvailable ? detailByStage[meta.id] : "缺少该层的直接定位信息",
            roles: [],
          })),
        };
      }),
    };
    return completeLineage(attachIncidentLineageRoles(data, event, spec));
  }

  function createLineageDrawer() {
    const drawer = document.getElementById("croLineageDrawer");
    const closeButton = document.getElementById("croLineageClose");
    const summary = document.getElementById("croLineageSummary");
    const stages = document.getElementById("croLineageStages");
    let currentKey = null;

    const close = () => {
      if (!drawer) return;
      drawer.hidden = true;
      currentKey = null;
    };

    const addSummaryRow = (list, label, value) => {
      const row = document.createElement("div");
      row.className = "cro-lineage-summary__row";
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      row.append(dt, dd);
      list.appendChild(row);
    };

    const open = (data) => {
      if (!drawer || !summary || !stages || !data) return;
      currentKey = data.key;
      summary.replaceChildren();
      stages.replaceChildren();

      const list = document.createElement("dl");
      list.className = "cro-lineage-summary__list";
      addSummaryRow(list, "模型算子", data.operator);
      addSummaryRow(list, "结构范围", data.scope);
      addSummaryRow(list, "代表执行位置", data.placement);
      summary.appendChild(list);

      data.stages.forEach((stage, stageIndex) => {
        const item = document.createElement("li");
        item.className = "cro-lineage-stage";
        item.dataset.stage = stage.id;

        const head = document.createElement("div");
        head.className = "cro-lineage-stage__head";
        const index = document.createElement("span");
        index.className = "cro-lineage-stage__index";
        index.textContent = String(stageIndex + 1).padStart(2, "0");
        const heading = document.createElement("div");
        const title = document.createElement("h3");
        title.className = "cro-lineage-stage__title";
        title.textContent = stage.title;
        const system = document.createElement("p");
        system.className = "cro-lineage-stage__system";
        system.textContent = stage.system;
        heading.append(title, system);
        head.append(index, heading);
        item.appendChild(head);

        const nodeList = document.createElement("div");
        nodeList.className = "cro-lineage-stage__nodes";
        stage.nodes.forEach((node) => {
          const nodeEl = document.createElement("article");
          nodeEl.className = "cro-lineage-node";
          const name = document.createElement("div");
          name.className = "cro-lineage-node__name";
          name.textContent = node.name;
          name.dataset.tip = LINEAGE_NODE_NAME_TIPS[stage.id] || "当前血缘层的节点名称。";
          const id = document.createElement("code");
          id.className = "cro-lineage-node__id";
          id.textContent = node.id;
          id.dataset.tip = LINEAGE_NODE_ID_TIP;
          const detail = document.createElement("p");
          detail.className = "cro-lineage-node__detail";
          detail.textContent = node.detail;
          nodeEl.append(name, id, detail);
          nodeList.appendChild(nodeEl);
        });
        item.appendChild(nodeList);
        stages.appendChild(item);
      });
      drawer.hidden = false;
    };

    closeButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      close();
    });

    return {
      open, close,
      get isOpen() { return Boolean(drawer && !drawer.hidden); },
      get currentKey() { return currentKey; },
    };
  }

  /* ══ 事件机制图 ══════════════════════════════════════════════════════════
     「传播源 → 受影响」是范围图：它回答「打到了谁」，回答不了「为什么会打过去、
     怎么传的」，而且 11 个事件共用同一张图，机制差异被拉平。机制图补的就是这一段：
     一个事件一张图，按 event.mechanism.phases 的相位推进，相位说明写在事件数据里。

     动效遵循两条：
       · 动的是「沿既有连线跑的东西」（stroke-dashoffset 彗星），不是让图元乱动；
       · 相位切换是重画一张静态图，不是逐帧补间 —— 讲得清、开销低、可随时定格。
     两者都是纯 SVG + SMIL，不引库、不占 rAF。 */

  const MECH_VIEW = { w: 940, h: 430 };

  /* 沿一条路径跑的彗星：底线常显，虚线段无限位移。tone 决定颜色（正常蓝 / 异常红）。 */
  function mechComet(d, tone, dur = "1.1s", delay = "0s") {
    const comet = svgNode("path", {
      class: `cro-mech__comet${tone === "hot" ? " is-hot" : ""}`,
      d, "stroke-dasharray": "7 27",
    });
    comet.appendChild(svgNode("animate", {
      attributeName: "stroke-dashoffset", from: 34, to: 0,
      dur, begin: delay, repeatCount: "indefinite",
    }));
    return comet;
  }

  /* 震中高亮：两个相位错开的圆角矩形向外扩散并淡出（层级图 ripple 的 SVG 版）。 */
  function mechRipple(x, y, w, h, color) {
    const g = svgNode("g", { "pointer-events": "none" });
    const gx = Math.max(4, w * 0.45), gy = Math.max(4, h * 0.9);
    [0, 0.6].forEach((delay) => {
      const rect = svgNode("rect", {
        x, y, width: w, height: h, rx: Math.min(4, h / 2),
        fill: "none", stroke: color, "stroke-width": 1.6, "stroke-opacity": 0.5,
      });
      const anim = (name, from, to) => rect.appendChild(svgNode("animate", {
        attributeName: name, values: `${from};${to}`,
        dur: "1.2s", begin: `${delay}s`, repeatCount: "indefinite",
      }));
      anim("x", x, x - gx); anim("y", y, y - gy);
      anim("width", w, w + gx * 2); anim("height", h, h + gy * 2);
      anim("stroke-opacity", 0.5, 0);
      g.appendChild(rect);
    });
    return g;
  }

  /* 相位之间要可比，抖动就不能是 Math.random()：同一个下标每次得到同一个值。 */
  function mechJitter(i, salt = 0) {
    const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  }

  /* 各机制图的自然高度不一样（64 条泳道比 16×16 网格高一截），所以 height 可覆盖；
     宽度统一，两张图在同一块画布里切换时横向比例才不跳。 */
  function mechRoot(label, height = MECH_VIEW.h) {
    return svgNode("svg", {
      class: "cro-mech__svg", viewBox: `0 0 ${MECH_VIEW.w} ${height}`,
      preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": label,
    });
  }

  /* ── 机制 A · Router FP8 溢出导致路由塌缩（p1-root）────────────────────
     左 Router → 中 dispatch 扇出 → 右 256 专家网格；下方两条 256 根的数值带
     （logits / softmax p）把「为什么扇出会变」摊开。相位 ①② 是健康态，正好当
     ③④ 的对照：同一张图两态，比并排画两张更能读出「变的是哪一步」。 */
  const MECH_ROUTER = {
    cols: 16, cellW: 25, cellH: 13, gap: 2, gridX: 486, gridY: 16,
    gate: { x: 26, y: 78, w: 142, h: 100 },
    hot: 193,
    healthy: [12, 45, 71, 103, 137, 168, 193, 221, 246],
    logitsStrip: { x: 26, y: 300, w: 436, h: 100 },
    softmaxStrip: { x: 500, y: 300, w: 416, h: 100 },
  };

  function mechExpertBox(index) {
    const M = MECH_ROUTER;
    return {
      x: M.gridX + (index % M.cols) * (M.cellW + M.gap),
      y: M.gridY + Math.floor(index / M.cols) * (M.cellH + M.gap),
      w: M.cellW, h: M.cellH,
    };
  }

  function renderMechRouterCollapse(phase) {
    const M = MECH_ROUTER;
    const svg = mechRoot("Router 打分 → Top-2 路由 → 专家接收");
    const collapsed = phase >= 2;   // ③ 起 softmax 已塌成 one-hot
    const overflow = phase >= 1;    // ② 起 logits 已越界
    const g = M.gate;

    // ── 左：Router 块 ──
    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: g.x, y: g.y - 30 }, "Layer 38 · MoE Router"));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: g.x, y: g.y - 14 }, "token batch 4096 → gate"));
    svg.appendChild(svgNode("rect", {
      class: "cro-mech__block", x: g.x, y: g.y, width: g.w, height: g.h, rx: 8, "stroke-width": 1.2,
    }));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: g.x + g.w / 2, y: g.y + 38, "text-anchor": "middle" }, "Linear(h → 256)"));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: g.x + g.w / 2, y: g.y + 56, "text-anchor": "middle" }, "softmax · Top-2"));
    svg.appendChild(svgNode("text", {
      class: `cro-mech__value${overflow ? " is-danger" : ""}`,
      x: g.x + g.w / 2, y: g.y + 82, "text-anchor": "middle",
    }, overflow ? "FP8 E4M3 溢出" : "FP8 E4M3 正常"));

    // ── 右：256 专家网格。份额决定填充浓度；塌缩后只有 E193 亮，其余转 dead ──
    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: M.gridX, y: M.gridY - 8 }, "256 routed experts（16 × 16）"));
    for (let i = 0; i < 256; i += 1) {
      const box = mechExpertBox(i);
      const isHot = i === M.hot;
      const dead = collapsed && !isHot;
      const cell = svgNode("rect", {
        class: `cro-mech__cell${dead ? " is-dead" : collapsed ? " is-hot" : ""}`,
        x: box.x, y: box.y, width: box.w, height: box.h, rx: 2,
      });
      if (!collapsed) {
        // 健康态：份额在 0.3%~0.6% 之间小幅起伏，用填充浓度表达
        cell.setAttribute("fill", "var(--primary)");
        cell.setAttribute("fill-opacity", (0.16 + mechJitter(i) * 0.34).toFixed(3));
      }
      svg.appendChild(cell);
    }
    const hotBox = mechExpertBox(M.hot);
    svg.appendChild(svgNode("rect", {
      x: hotBox.x - 1.5, y: hotBox.y - 1.5, width: hotBox.w + 3, height: hotBox.h + 3, rx: 3,
      fill: "none", stroke: "var(--danger)",
      "stroke-width": collapsed ? 1.8 : 1.2, "stroke-opacity": collapsed ? 1 : 0.5,
    }));
    /* E193 的标注挂在网格**左侧**：挂右侧会横压过同一行后面十几个专家格子，
       那些格子正是「其余专家断没断流」的读点，不能被字盖住。左侧是扇出区，
       标注底下垫一块同色板，压在光束上也读得清。 */
    {
      const text = collapsed ? "E193 · 98% token" : "E193";
      const w = text.length * 6.2 + 12;
      const x = M.gridX - 14, y = hotBox.y + hotBox.h / 2;
      svg.appendChild(svgNode("rect", {
        x: x - w, y: y - 9, width: w, height: 18, rx: 4,
        fill: "var(--surface-1)", stroke: "var(--danger)",
        "stroke-opacity": collapsed ? 0.7 : 0.3, "stroke-width": 1,
      }));
      svg.appendChild(svgNode("text", {
        class: `cro-mech__value${collapsed ? " is-danger" : ""}`,
        x: x - 6, y: y + 4, "text-anchor": "end",
      }, text));
      svg.appendChild(svgNode("line", {
        x1: x, x2: hotBox.x, y1: y, y2: y,
        stroke: "var(--danger)", "stroke-opacity": collapsed ? 0.7 : 0.3, "stroke-width": 1,
      }));
    }
    if (collapsed) svg.appendChild(mechRipple(hotBox.x - 2, hotBox.y - 2, hotBox.w + 4, hotBox.h + 4, "var(--danger)"));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: M.gridX, y: 272 },
      collapsed
        ? "247 个 dead expert：本 step 起再没收到过 token"
        : "扇出发散：每个专家 0.3%~0.6%，dispatch 流量均摊在 EP 组 64 张卡上"));

    // ── 中：dispatch 扇出。塌缩后旧路径转虚灰、新流量全部汇到 E193 ──
    const srcX = g.x + g.w, srcY = g.y + g.h / 2;
    const beam = (target) => {
      const box = mechExpertBox(target);
      const tx = box.x, ty = box.y + box.h / 2;
      return `M${srcX},${srcY}C${srcX + 130},${srcY} ${tx - 130},${ty} ${tx},${ty}`;
    };
    M.healthy.forEach((target, k) => {
      const dead = collapsed && target !== M.hot;
      svg.appendChild(svgNode("path", { class: `cro-mech__beam${dead ? " is-dead" : ""}`, d: beam(target) }));
      if (!dead) {
        svg.appendChild(mechComet(beam(target), collapsed ? "hot" : "cool",
          collapsed ? "0.75s" : "1.2s", `${(k * 0.13).toFixed(2)}s`));
      }
    });
    if (collapsed) {
      svg.appendChild(svgNode("path", { class: "cro-mech__beam is-hot", d: beam(M.hot) }));
      [0.15, 0.45, 0.75].forEach((delay) => svg.appendChild(mechComet(beam(M.hot), "hot", "0.75s", `${delay}s`)));
    }

    // ── 下：两条 256 根的数值带 ──
    const strip = (box, title, valueOf, scale, note, markHot) => {
      svg.appendChild(svgNode("text", { class: "cro-mech__title", x: box.x, y: box.y - 10 }, title));
      svg.appendChild(svgNode("line", {
        x1: box.x, x2: box.x + box.w, y1: box.y + box.h, y2: box.y + box.h, stroke: "var(--border-default)",
      }));
      const step = box.w / 256;
      for (let i = 0; i < 256; i += 1) {
        const h = Math.max(0.6, Math.min(1, scale(valueOf(i))) * box.h);
        const isHot = i === M.hot && markHot;
        svg.appendChild(svgNode("rect", {
          x: box.x + i * step, y: box.y + box.h - h, width: Math.max(0.9, step - 0.55), height: h,
          fill: isHot ? "var(--danger)" : "var(--primary)", "fill-opacity": isHot ? 1 : 0.42,
        }));
      }
      svg.appendChild(svgNode("text", { class: "cro-mech__label", x: box.x, y: box.y + box.h + 18 }, note));
    };
    // logits：对数刻度，才装得下 12.4 与 1846 同框；FP8 上限 448 画一条虚线
    const logScale = (v) => Math.log10(v + 1) / Math.log10(2001);
    strip(M.logitsStrip, "router logits（256）",
      (i) => (overflow && i === M.hot ? 1846 : 3.5 + mechJitter(i, 3) * 8.9), logScale,
      overflow ? "max = 1846，已越过 FP8 E4M3 上限 448" : "max = 12.4，全部落在 FP8 可表示区间内",
      overflow);
    {
      const box = M.logitsStrip;
      const ly = box.y + box.h - logScale(448) * box.h;
      svg.appendChild(svgNode("line", { class: "cro-mech__rule", x1: box.x, x2: box.x + box.w, y1: ly, y2: ly }));
      svg.appendChild(svgNode("text", {
        class: "cro-mech__label", x: box.x + box.w, y: ly - 5, "text-anchor": "end",
      }, "FP8 E4M3 上限 448"));
    }
    // softmax p：开方刻度，否则健康态的 0.4% 在轴上是一条看不见的线
    strip(M.softmaxStrip, "softmax p（256）",
      (i) => (collapsed ? (i === M.hot ? 1 : 0) : 0.0028 + mechJitter(i, 7) * 0.0026), Math.sqrt,
      collapsed
        ? "分布退化成 one-hot：p(E193) = 1.0，其余 255 个为 0"
        : "分布平坦：负载均衡损失把 token 摊到全部专家上",
      collapsed);
    return svg;
  }

  /* ── 机制 B · all-to-all barrier 空等（p1-a2a）─────────────────────────
     64 条泳道 = EP 通信组 64 张卡，横轴是时间/进度，中间一条 barrier 竖线。
     「空等」画成越过 barrier 后持续生长的行军蚁虚线 —— 等待是有长度的，这正是
     静态范围图表达不出来的那一维。 */
  /* 高度按「64 条泳道 + 底部 barrier 刻度 + 一行读数」倒推：
     lanes 从 top=56 起，步距 5.2 → 末条底边 56 + 63×5.2 + 4 = 387.6，
     刻度标在 +26 = 413.6，读数落 445 / 463，正好收在 470 内。改任一项都要重算。 */
  const MECH_BARRIER = {
    height: 470,
    lanes: 64, laneH: 4, laneGap: 1.2, top: 56,
    trackX0: 96, trackX1: 900, barrier: 520, timeout: 878,
    stalled: 23, stalledRank: 1559,
    progress: [0.42, 0.86, 1, 1],   // 健康卡向 barrier 的推进度
    stall: 0.30,                    // 卡住那张停在哪
    waitSeconds: [0, 0, 2, 30],
    readoutY: [445, 463],           // 标签行 / 读数行
  };

  function renderMechBarrierWait(phase) {
    const M = MECH_BARRIER;
    const svg = mechRoot("EP 通信组 64 张卡的 all-to-all barrier 泳道", M.height);
    const step = M.laneH + M.laneGap;
    const laneY = (i) => M.top + i * step;
    const bottom = laneY(M.lanes - 1) + M.laneH;
    const waited = M.waitSeconds[phase];
    const waitW = (waited / 30) * (M.timeout - M.barrier);

    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: 26, y: 24 }, "EP 通信组 · 64 rank（global 1536–1599）"));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: M.trackX1, y: 24, "text-anchor": "end" }, "→ 时间"));

    const marker = (x, label, danger) => {
      svg.appendChild(svgNode("line", {
        x1: x, x2: x, y1: M.top - 12, y2: bottom + 10,
        stroke: danger ? "var(--danger)" : "var(--border-strong)", "stroke-width": 1.4,
        "stroke-dasharray": danger ? "5 4" : "none",
      }));
      svg.appendChild(svgNode("text", {
        class: danger ? "cro-mech__value is-danger" : "cro-mech__label",
        x, y: bottom + 26, "text-anchor": "middle",
      }, label));
    };
    marker(M.barrier, "all-to-all barrier", false);
    if (phase >= 3) marker(M.timeout, "HCCL timeout 30 s", true);

    for (let i = 0; i < M.lanes; i += 1) {
      const y = laneY(i);
      const isStalled = i === M.stalled;
      // 轨道底：这条卡本可以走到哪
      svg.appendChild(svgNode("rect", {
        x: M.trackX0, y, width: M.trackX1 - M.trackX0, height: M.laneH, rx: 2,
        fill: "var(--foreground)", "fill-opacity": 0.06,
      }));
      // 进度条。健康卡带微小抖动，读起来才像 64 张真卡而不是一把等长的条
      const p = isStalled ? M.stall : Math.min(1, M.progress[phase] * (0.94 + mechJitter(i, 11) * 0.12));
      const w = (M.barrier - M.trackX0) * p;
      svg.appendChild(svgNode("rect", {
        x: M.trackX0, y, width: w, height: M.laneH, rx: 2,
        fill: isStalled ? "var(--danger)" : "var(--primary)", "fill-opacity": isStalled ? 1 : 0.7,
      }));
      // 推进中的彗星：只在还没到 barrier 的卡上跑
      if (!isStalled && p < 1) {
        svg.appendChild(mechComet(`M${M.trackX0},${y + M.laneH / 2}H${M.trackX0 + w}`,
          "cool", "1.1s", `${(mechJitter(i, 5) * 0.8).toFixed(2)}s`));
      }
      // 空等段：越过 barrier 之后的行军蚁，长度就是这张卡白烧掉的时间
      if (!isStalled && waitW > 0) {
        const wy = y + M.laneH / 2;
        svg.appendChild(svgNode("line", {
          x1: M.barrier, x2: M.barrier + waitW, y1: wy, y2: wy,
          stroke: "var(--warning)", "stroke-width": M.laneH, "stroke-opacity": 0.18,
        }));
        const ants = svgNode("line", {
          x1: M.barrier, x2: M.barrier + waitW, y1: wy, y2: wy,
          stroke: "var(--warning)", "stroke-width": 1.6, "stroke-dasharray": "3 7",
        });
        ants.appendChild(svgNode("animate", {
          attributeName: "stroke-dashoffset", from: 10, to: 0,
          dur: "0.9s", begin: `${(mechJitter(i, 9) * 0.9).toFixed(2)}s`, repeatCount: "indefinite",
        }));
        svg.appendChild(ants);
      }
    }

    // 卡住的那条单独描出来：它是这张图上唯一的「因」
    {
      const y = laneY(M.stalled);
      const w = (M.barrier - M.trackX0) * M.stall;
      if (phase >= 1) svg.appendChild(mechRipple(M.trackX0 + w - 6, y - 1, 12, M.laneH + 2, "var(--danger)"));
      svg.appendChild(svgNode("text", {
        class: "cro-mech__value is-danger", x: 90, y: y + M.laneH, "text-anchor": "end",
      }, `r23 · ${M.stalledRank}`));
      if (phase >= 1) {
        svg.appendChild(svgNode("text", {
          class: "cro-mech__value is-danger", x: M.trackX0 + w + 10, y: y + M.laneH,
        }, "send=0 / recv=9832 → 卡在收侧"));
      }
    }
    // 其余泳道每 8 条标一次刻度，认得出「这是 64 张卡」就够
    for (let i = 0; i < M.lanes; i += 8) {
      if (i === M.stalled) continue;
      svg.appendChild(svgNode("text", {
        class: "cro-mech__label", x: 90, y: laneY(i) + M.laneH, "text-anchor": "end",
      }, `r${i}`));
    }

    // 读数：「63 张是结果、1 张是原因」的量化落点
    const readout = (x, label, value, danger) => {
      svg.appendChild(svgNode("text", { class: "cro-mech__label", x, y: M.readoutY[0] }, label));
      svg.appendChild(svgNode("text", {
        class: `cro-mech__value${danger ? " is-danger" : ""}`, x, y: M.readoutY[1],
      }, value));
    };
    readout(26, "空等卡数", phase >= 2 ? "63 / 64" : "0 / 64", phase >= 2);
    readout(150, "已空等", `${waited} s`, phase >= 3);
    readout(268, "累计空转", `${63 * waited} 卡·秒`, phase >= 3);
    readout(430, "timeout 报错", phase >= 3 ? "64 张（其中 63 张是结果）" : "0 张", phase >= 3);
    return svg;
  }

  /* ── 机制 C · PP 依赖链的逐级回压（p1-spread）─────────────────────────
     这个事件最容易被读成「2048 张卡各自出了问题」。机制图要说的恰恰相反：出问题
     的只有 1 张，其余 2047 张是被**依赖**拖住的，而拖住它们的链条是可数的 ——
     上排画依赖拓扑（前向送激活、反向回梯度，首尾相接成闭环），中间四条泳道画各
     stage 何时从「在算」翻成「在等」（自震中起逐级向上游回压），下排把 1 → 64 →
     512 → 2048 拆成一条乘法链：×EP 组 → ×EDP 副本 → ×PP 段。三段读下来就是
     「一张卡怎么变成整网」。 */
  const MECH_PP = {
    height: 470,
    stages: 4,
    boxY: 52, boxH: 42, boxW: 128, boxX0: 132, boxGap: 200,
    laneX0: 126, laneX1: 900, laneY0: 186, laneH: 22, laneGap: 14,
    /* 每相里各 stage 从哪个位置翻成「在等」（null = 仍在算）。stage3 先停，
       上游 2→1→0 依次被回压 —— 顺序不能反，那正是这张图要讲的因果方向。 */
    stop: [
      [null, null, null, null],
      [null, null, null, 0.32],
      [null, null, 0.48, 0.32],
      [0.72, 0.60, 0.48, 0.32],
    ],
    /* 乘法链：一张卡 → EP 组 → PP 段 → 全网。倍数写在箭头上，读者能自己验算。 */
    chain: [
      { n: 1, label: "震中", note: "rank 1559" },
      { n: 64, label: "EP 组", note: "× EP 64", mul: "× 64" },
      { n: 512, label: "PP stage", note: "× EDP 8", mul: "× 8" },
      { n: 2048, label: "全网", note: "× PP 4", mul: "× 4" },
    ],
  };

  function renderMechPpCascade(phase) {
    const M = MECH_PP;
    const svg = mechRoot("PP 依赖链上的逐级回压", M.height);
    const boxCx = (s) => M.boxX0 + s * M.boxGap + M.boxW / 2;
    const stopped = M.stop[phase];
    // 第 ② 相：震中所在的 EP 组已经停了，但 stage 级别还没整段断
    const epStalled = phase >= 1;

    // ── 上：依赖拓扑（前向送激活 → / ← 反向回梯度）──
    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: 30, y: 26 }, "PP 依赖链（4 个 stage 首尾相接）"));
    for (let s = 0; s < M.stages; s += 1) {
      const x = M.boxX0 + s * M.boxGap;
      const dead = stopped[s] != null;
      svg.appendChild(svgNode("rect", {
        class: "cro-mech__block", x, y: M.boxY, width: M.boxW, height: M.boxH, rx: 8,
        "stroke-width": 1.2,
        fill: dead ? "color-mix(in srgb, var(--danger) 16%, transparent)" : undefined,
        stroke: dead ? "var(--danger)" : undefined,
      }));
      svg.appendChild(svgNode("text", {
        class: `cro-mech__value${dead ? " is-danger" : ""}`,
        x: x + M.boxW / 2, y: M.boxY + 20, "text-anchor": "middle",
      }, `PP stage ${s}`));
      svg.appendChild(svgNode("text", {
        class: "cro-mech__label", x: x + M.boxW / 2, y: M.boxY + 34, "text-anchor": "middle",
      }, dead ? "已停" : "在算"));
      // 前向：s → s+1 送激活
      if (s < M.stages - 1) {
        const x1 = x + M.boxW + 6, x2 = x + M.boxGap - 6, y = M.boxY + 14;
        const broken = stopped[s + 1] != null;
        svg.appendChild(svgNode("path", {
          class: `cro-mech__beam${broken ? " is-dead" : ""}`,
          d: `M${x1},${y}H${x2}`,
        }));
        svg.appendChild(svgNode("path", {
          d: `M${x2 - 6},${y - 4}L${x2},${y}L${x2 - 6},${y + 4}`, fill: "none",
          stroke: broken ? "color-mix(in srgb, var(--foreground) 20%, transparent)" : "var(--primary)",
          "stroke-width": 1.4,
        }));
        if (!broken) svg.appendChild(mechComet(`M${x1},${y}H${x2}`, "cool", "1.2s", `${(s * 0.2).toFixed(1)}s`));
      }
      // 反向：s+1 → s 回梯度
      if (s < M.stages - 1) {
        const x1 = x + M.boxGap - 6, x2 = x + M.boxW + 6, y = M.boxY + 30;
        const broken = stopped[s + 1] != null || stopped[s] != null;
        svg.appendChild(svgNode("path", {
          class: `cro-mech__beam${broken ? " is-dead" : ""}`,
          d: `M${x1},${y}H${x2}`,
        }));
        svg.appendChild(svgNode("path", {
          d: `M${x2 + 6},${y - 4}L${x2},${y}L${x2 + 6},${y + 4}`, fill: "none",
          stroke: broken ? "color-mix(in srgb, var(--foreground) 20%, transparent)" : "var(--primary)",
          "stroke-width": 1.4,
        }));
      }
    }
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: M.boxX0, y: M.boxY + 62 },
      "上行箭头 = 前向送激活，下行箭头 = 反向回梯度；stage 0 的下一个 micro-batch 要等 stage 3 的梯度回来 —— 这是一条闭环，断一处就整条停。"));

    // ── 中：四条 stage 泳道（横轴 = 时间）──
    const laneY = (s) => M.laneY0 + s * (M.laneH + M.laneGap);
    const laneBottom = laneY(M.stages - 1) + M.laneH;
    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: 30, y: M.laneY0 - 14 }, "各 stage 在算 / 在等"));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: M.laneX1, y: M.laneY0 - 14, "text-anchor": "end" }, "→ 时间"));
    for (let s = 0; s < M.stages; s += 1) {
      const y = laneY(s);
      const span = M.laneX1 - M.laneX0;
      svg.appendChild(svgNode("text", {
        class: "cro-mech__label", x: M.laneX0 - 10, y: y + M.laneH - 6, "text-anchor": "end",
      }, `PP${s}`));
      svg.appendChild(svgNode("rect", {
        x: M.laneX0, y, width: span, height: M.laneH, rx: 3,
        fill: "var(--foreground)", "fill-opacity": 0.06,
      }));
      const cut = stopped[s];
      const runW = cut == null ? span : span * cut;
      // 在算段
      svg.appendChild(svgNode("rect", {
        x: M.laneX0, y, width: runW, height: M.laneH, rx: 3,
        fill: "var(--primary)", "fill-opacity": 0.62,
      }));
      if (cut == null) {
        svg.appendChild(mechComet(`M${M.laneX0},${y + M.laneH / 2}H${M.laneX1}`, "cool", "1.3s", `${(s * 0.22).toFixed(2)}s`));
      } else {
        // 在等段：行军蚁，长度就是这一段流水线白停的时间
        const wy = y + M.laneH / 2, x1 = M.laneX0 + runW;
        svg.appendChild(svgNode("rect", {
          x: x1, y, width: M.laneX1 - x1, height: M.laneH, rx: 3,
          fill: "var(--warning)", "fill-opacity": 0.16,
        }));
        const ants = svgNode("line", {
          x1, x2: M.laneX1, y1: wy, y2: wy,
          stroke: "var(--warning)", "stroke-width": 2, "stroke-dasharray": "4 8",
        });
        ants.appendChild(svgNode("animate", {
          attributeName: "stroke-dashoffset", from: 12, to: 0,
          dur: "0.9s", begin: `${(s * 0.15).toFixed(2)}s`, repeatCount: "indefinite",
        }));
        svg.appendChild(ants);
        svg.appendChild(svgNode("text", {
          class: "cro-mech__value is-danger", x: x1 + 8, y: y + M.laneH - 6,
        }, s === 3 ? "卡在 all-to-all" : "上游/下游没人接，回压停下"));
      }
      // 震中：第 ① 相时 stage3 整段还在跑，只有一张卡停了，单独标出来
      if (s === 3) {
        const mx = M.laneX0 + (M.laneX1 - M.laneX0) * 0.32;
        svg.appendChild(svgNode("line", {
          x1: mx, x2: mx, y1: y - 5, y2: y + M.laneH + 5,
          stroke: "var(--danger)", "stroke-width": 1.6,
        }));
        svg.appendChild(mechRipple(mx - 4, y - 2, 8, M.laneH + 4, "var(--danger)"));
        if (!epStalled) {
          svg.appendChild(svgNode("text", {
            class: "cro-mech__value is-danger", x: mx + 10, y: y + M.laneH - 6,
          }, "rank 1559 停在这里（整段仍在跑）"));
        }
      }
    }

    // ── 下：1 → 64 → 512 → 2048 的乘法链 ──
    const chainY = laneBottom + 52;
    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: 30, y: chainY - 16 },
      "受影响卡数怎么涨起来的（每一步都是一个可数的倍数，不是「故障扩散」）"));
    const nodeW = 150, nodeH = 46, gap = 62;
    const totalW = M.chain.length * nodeW + (M.chain.length - 1) * gap;
    const x0 = (MECH_VIEW.w - totalW) / 2;
    M.chain.forEach((node, i) => {
      const x = x0 + i * (nodeW + gap);
      const on = i <= phase;
      svg.appendChild(svgNode("rect", {
        x, y: chainY, width: nodeW, height: nodeH, rx: 8,
        fill: on ? "color-mix(in srgb, var(--danger) 14%, transparent)" : "transparent",
        stroke: on ? "var(--danger)" : "var(--border-default)",
        "stroke-width": on ? 1.6 : 1,
        "stroke-opacity": on ? 1 : 0.6,
      }));
      svg.appendChild(svgNode("text", {
        class: `cro-mech__value${on ? " is-danger" : ""}`,
        x: x + nodeW / 2, y: chainY + 21, "text-anchor": "middle",
      }, `${node.n.toLocaleString("en-US")} 卡`));
      svg.appendChild(svgNode("text", {
        class: "cro-mech__label", x: x + nodeW / 2, y: chainY + 37, "text-anchor": "middle",
      }, `${node.label} · ${node.note}`));
      if (i > 0) {
        const ax1 = x - gap + 8, ax2 = x - 8, ay = chainY + nodeH / 2;
        svg.appendChild(svgNode("path", {
          class: `cro-mech__beam${on ? " is-hot" : " is-dead"}`, d: `M${ax1},${ay}H${ax2}`,
        }));
        if (on) svg.appendChild(mechComet(`M${ax1},${ay}H${ax2}`, "hot", "0.8s", `${(i * 0.18).toFixed(2)}s`));
        svg.appendChild(svgNode("text", {
          class: `cro-mech__value${on ? " is-danger" : ""}`,
          x: (ax1 + ax2) / 2, y: ay - 8, "text-anchor": "middle",
        }, node.mul));
      }
    });
    return svg;
  }

  /* ── 机制 D · 激活的存活区间叠出显存峰值（p2-peak）────────────────────
     「激活值占 36.2 GB」这句话本身不解释任何东西。真正的机制是**生命周期**：
     一层的激活在前向产生、要等到反向用到它时才能释放，于是 12 层的存活区间在
     前向末尾**全部重叠**，峰值就是这些区间的叠加和。所以上半画区间条、下半画
     由它们逐槽位加出来的占用曲线 —— 下面那条线不是另画的，它就是上面那些条的
     竖向计数，两者必须逐格对齐。 */
  const MECH_MEM = {
    height: 470,
    lo: 34, hi: 45,                 // PP stage 3 的 12 层
    slotX0: 126, slotX1: 900,
    barY0: 58, barH: 12, barGap: 3,
    plotY0: 300, plotY1: 438, cap: 64,
    base: { weight: 14.1, optim: 9.8, frag: 3.9 },
    layerGB: 0.71, spikeLayer: 38, spikeGB: 1.2, headGB: 27.2,
    cursor: [3, 11, 12, 12],        // 各相的时间游标（槽位）
  };

  function memLayers() {
    const M = MECH_MEM;
    const out = [];
    for (let l = M.lo; l <= M.hi; l += 1) {
      const i = l - M.lo;
      out.push({
        key: `L${l}`, gb: l === M.spikeLayer ? M.spikeGB : M.layerGB,
        born: i, dies: 25 - i, spike: l === M.spikeLayer,
      });
    }
    // LM Head 的 logits：存活极短（前向算完紧接着反向就用掉），但体量最大
    out.push({ key: "LM Head logits", gb: M.headGB, born: 12, dies: 13, head: true });
    return out;
  }

  function renderMechActivationLifetime(phase) {
    const M = MECH_MEM;
    const svg = mechRoot("激活的存活区间与显存峰值", M.height);
    const rows = memLayers();
    const slots = 26;
    const slotW = (M.slotX1 - M.slotX0) / slots;
    const sx = (t) => M.slotX0 + t * slotW;
    const cur = M.cursor[phase];
    const aliveAt = (t) => rows.reduce((sum, r) => (t >= r.born && t < r.dies ? sum + r.gb : sum), 0);
    const baseGB = M.base.weight + M.base.optim + M.base.frag;

    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: 30, y: 26 },
      "PP stage 3 的一个 step：前向 L34→L45→LM Head，再反向回来"));
    // 前向 / 反向分界
    const midX = sx(13);
    svg.appendChild(svgNode("line", { class: "cro-mech__rule", x1: midX, x2: midX, y1: 40, y2: M.plotY1 }));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: midX - 8, y: 40, "text-anchor": "end" }, "前向 →"));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: midX + 8, y: 40 }, "← 反向"));

    // ── 上：存活区间条 ──
    rows.forEach((r, i) => {
      const y = M.barY0 + i * (M.barH + M.barGap);
      const x1 = sx(r.born), x2 = sx(r.dies);
      svg.appendChild(svgNode("text", {
        class: "cro-mech__label", x: M.slotX0 - 10, y: y + M.barH - 2, "text-anchor": "end",
      }, r.key));
      // 轨道
      svg.appendChild(svgNode("rect", {
        x: M.slotX0, y, width: M.slotX1 - M.slotX0, height: M.barH, rx: 2,
        fill: "var(--foreground)", "fill-opacity": 0.05,
      }));
      const alive = cur >= r.born && cur < r.dies;
      const tone = r.head ? "var(--danger)" : r.spike ? "var(--warning)" : "var(--primary)";
      svg.appendChild(svgNode("rect", {
        x: x1, y, width: Math.max(3, x2 - x1), height: M.barH, rx: 2,
        fill: tone, "fill-opacity": alive ? 0.85 : 0.22,
      }));
      // 还没走到的那一段（存活但尚未度过）在第 ④ 相高亮：释放要等到反向
      if (phase === 3 && alive && x2 > sx(cur)) {
        const ants = svgNode("line", {
          x1: sx(cur), x2, y1: y + M.barH / 2, y2: y + M.barH / 2,
          stroke: "var(--warning)", "stroke-width": 1.6, "stroke-dasharray": "3 6",
        });
        ants.appendChild(svgNode("animate", {
          attributeName: "stroke-dashoffset", from: 9, to: 0,
          dur: "0.8s", begin: `${(i * 0.06).toFixed(2)}s`, repeatCount: "indefinite",
        }));
        svg.appendChild(ants);
      }
      svg.appendChild(svgNode("text", {
        class: `cro-mech__value${r.head || r.spike ? " is-danger" : ""}`,
        x: x2 + 8, y: y + M.barH - 2,
      }, `${r.gb.toFixed(2)} GB`));
    });

    // ── 下：由区间叠出来的占用曲线 ──
    const gy = (gb) => M.plotY1 - (gb / M.cap) * (M.plotY1 - M.plotY0);
    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: 30, y: M.plotY0 - 12 },
      "单卡显存占用 = 常驻段 + 此刻仍存活的激活之和"));
    svg.appendChild(svgNode("line", {
      x1: M.slotX0, x2: M.slotX1, y1: M.plotY1, y2: M.plotY1, stroke: "var(--border-default)",
    }));
    // 常驻段（权重 + 优化器 + 碎片）
    svg.appendChild(svgNode("rect", {
      x: M.slotX0, y: gy(baseGB), width: M.slotX1 - M.slotX0, height: M.plotY1 - gy(baseGB),
      fill: "var(--primary)", "fill-opacity": 0.2,
    }));
    svg.appendChild(svgNode("text", { class: "cro-mech__label", x: M.slotX0 + 6, y: gy(baseGB) - 5 },
      `常驻 ${baseGB.toFixed(1)} GB（权重 ${M.base.weight} + 优化器 ${M.base.optim} + 碎片 ${M.base.frag}）`));
    // 激活面积
    const pts = [];
    for (let t = 0; t <= slots; t += 1) pts.push(`${sx(t).toFixed(1)},${gy(baseGB + aliveAt(Math.min(t, slots - 1))).toFixed(1)}`);
    svg.appendChild(svgNode("path", {
      d: `M${sx(0).toFixed(1)},${gy(baseGB).toFixed(1)}L${pts.join("L")}L${sx(slots).toFixed(1)},${gy(baseGB).toFixed(1)}Z`,
      fill: "var(--warning)", "fill-opacity": 0.3,
    }));
    svg.appendChild(svgNode("path", {
      d: `M${pts.join("L")}`, fill: "none", stroke: "var(--warning)", "stroke-width": 1.8,
    }));
    // 容量上限
    svg.appendChild(svgNode("line", {
      x1: M.slotX0, x2: M.slotX1, y1: gy(M.cap), y2: gy(M.cap),
      stroke: "var(--danger)", "stroke-width": 1.4, "stroke-dasharray": "5 4",
    }));
    svg.appendChild(svgNode("text", {
      class: "cro-mech__value is-danger", x: M.slotX1, y: gy(M.cap) - 6, "text-anchor": "end",
    }, `单卡容量 ${M.cap} GB`));
    // 时间游标
    const cx = sx(cur + 0.5);
    const now = baseGB + aliveAt(cur);
    svg.appendChild(svgNode("line", {
      x1: cx, x2: cx, y1: M.barY0 - 8, y2: M.plotY1,
      stroke: "var(--danger)", "stroke-width": 1.4,
    }));
    svg.appendChild(svgNode("circle", { cx, cy: gy(now), r: 4, fill: "var(--danger)" }));
    if (now >= M.cap - 0.05) svg.appendChild(mechRipple(cx - 5, gy(now) - 5, 10, 10, "var(--danger)"));
    const anchor = cx > MECH_VIEW.w * 0.62 ? "end" : "start";
    svg.appendChild(svgNode("text", {
      class: "cro-mech__value is-danger", x: cx + (anchor === "end" ? -10 : 10), y: gy(now) - 12,
      "text-anchor": anchor,
    }, `${now.toFixed(1)} / ${M.cap} GB · 激活 ${aliveAt(cur).toFixed(1)} GB · 余量 ${Math.max(0, M.cap - now).toFixed(1)} GB`));
    return svg;
  }

  /* ── 机制 E · 碎片让「空闲够」也申请不到（p2-oom）──────────────────────
     这条最容易被读反：空闲还有 3.9 GB，申请只要 0.5 GB，凭什么失败？决定成败的
     从来不是空闲**总量**，而是**最大连续块**。所以图上必须把 64 GB 摊成一条真实
     的地址空间：已分配的块与空洞交替排列，再把那 0.5 GB 的申请块拿去逐个洞试放
     —— 试到最后一个（也是最大的一个 0.32 GB）仍然放不下，这就是 OOM。 */
  const MECH_OOM = {
    height: 470,
    cap: 64, rows: 8, gbPerRow: 8,
    x0: 78, x1: 908, rowY0: 74, rowH: 26, rowGap: 10,
    allocGB: 60.1, freeGB: 3.9, biggestHole: 0.32, requestGB: 0.5,
    holes: 22,
  };

  /* 洞的尺寸与位置：确定性生成，且必须满足三条事实 —— 洞的总量 = 3.9 GB、
     最大的一个 = 0.32 GB、其余都严格小于它。数字对不上，整张图就在骗人。 */
  function oomLayout() {
    const M = MECH_OOM;
    const n = M.holes - 1;
    const raw = Array.from({ length: n }, (_, i) => 0.06 + mechJitter(i, 17) * 0.2);
    const scale = (M.freeGB - M.biggestHole) / raw.reduce((a, b) => a + b, 0);
    const sizes = raw.map((v) => v * scale);
    // 最大的那个插在中间偏后，读者扫到它时正好是「连最大的也放不下」那一击
    sizes.splice(Math.floor(n * 0.72), 0, M.biggestHole);
    // 洞之间的已分配段：同样确定性分配，总量 60.1
    const gapsRaw = Array.from({ length: sizes.length + 1 }, (_, i) => 0.4 + mechJitter(i, 29));
    const gScale = M.allocGB / gapsRaw.reduce((a, b) => a + b, 0);
    const gaps = gapsRaw.map((v) => v * gScale);
    const spans = [];
    let at = 0;
    gaps.forEach((g, i) => {
      spans.push({ kind: "alloc", from: at, to: at + g }); at += g;
      if (i < sizes.length) { spans.push({ kind: "hole", from: at, to: at + sizes[i], gb: sizes[i] }); at += sizes[i]; }
    });
    return spans;
  }

  function renderMechFragmentedOom(phase) {
    const M = MECH_OOM;
    const svg = mechRoot("64 GB 地址空间里的碎片与一次失败的申请", M.height);
    const spans = oomLayout();
    const pxPerGB = (M.x1 - M.x0) / M.gbPerRow;
    const rowY = (r) => M.rowY0 + r * (M.rowH + M.rowGap);
    const showHoles = phase >= 1;
    const showRequest = phase >= 2;

    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: 30, y: 26 },
      `rank 1553 的 64 GB 地址空间（每行 ${M.gbPerRow} GB，共 ${M.rows} 行）`));

    /* 一段 [from, to) GB 可能跨行，按行切开画。地址空间是连续的，跨行只是排版。 */
    const drawSpan = (from, to, make) => {
      let a = from;
      while (a < to - 1e-9) {
        const r = Math.floor(a / M.gbPerRow);
        const rowEnd = (r + 1) * M.gbPerRow;
        const b = Math.min(to, rowEnd);
        make(M.x0 + (a - r * M.gbPerRow) * pxPerGB, rowY(r), (b - a) * pxPerGB, r);
        a = b;
      }
    };

    for (let r = 0; r < M.rows; r += 1) {
      svg.appendChild(svgNode("text", {
        class: "cro-mech__label", x: M.x0 - 10, y: rowY(r) + M.rowH - 8, "text-anchor": "end",
      }, `${r * M.gbPerRow}`));
      svg.appendChild(svgNode("rect", {
        x: M.x0, y: rowY(r), width: M.x1 - M.x0, height: M.rowH, rx: 3,
        fill: "var(--foreground)", "fill-opacity": 0.05,
      }));
    }

    const holeAnchors = [];
    spans.forEach((span) => {
      if (span.kind === "alloc") {
        drawSpan(span.from, span.to, (x, y, w) => svg.appendChild(svgNode("rect", {
          x, y: y + 2, width: Math.max(1, w - 0.6), height: M.rowH - 4, rx: 2,
          fill: "var(--primary)", "fill-opacity": 0.55,
        })));
        return;
      }
      const biggest = Math.abs(span.gb - M.biggestHole) < 1e-9;
      drawSpan(span.from, span.to, (x, y, w, r) => {
        svg.appendChild(svgNode("rect", {
          x, y: y + 2, width: Math.max(1.5, w - 0.6), height: M.rowH - 4, rx: 2,
          fill: showHoles ? (biggest ? "var(--warning)" : "var(--danger)") : "var(--foreground)",
          "fill-opacity": showHoles ? (biggest ? 0.55 : 0.3) : 0.12,
        }));
        holeAnchors.push({ x, y, gb: span.gb, biggest, row: r });
      });
      if (biggest && showHoles) {
        drawSpan(span.from, span.to, (x, y, w) => {
          svg.appendChild(mechRipple(x - 1, y + 1, w + 2, M.rowH - 2, "var(--warning)"));
          svg.appendChild(svgNode("text", {
            class: "cro-mech__value is-danger", x: x + w / 2, y: y - 4, "text-anchor": "middle",
          }, `最大连续块 ${M.biggestHole} GB`));
        });
      }
    });

    /* 0.5 GB 的申请块逐个洞试放：x / y 用 calcMode="discrete" 同步跳，
       跳完一圈就是「每个洞都试过了，都放不下」。只挑最大的 10 个洞，
       22 个跳下来一圈要 7 秒多，久到看不出是在做同一件事。 */
    if (showRequest && holeAnchors.length) {
      const reqW = M.requestGB * pxPerGB;
      const tour = holeAnchors.slice().sort((a, b) => b.gb - a.gb).slice(0, 10)
        .sort((a, b) => (a.row - b.row) || (a.x - b.x));
      const xs = tour.map((h) => h.x.toFixed(1)).join(";");
      const ys = tour.map((h) => (h.y + 1).toFixed(1)).join(";");
      const req = svgNode("rect", {
        x: tour[0].x, y: tour[0].y + 1, width: reqW, height: M.rowH - 2, rx: 3,
        fill: "color-mix(in srgb, var(--danger) 18%, transparent)",
        stroke: "var(--danger)", "stroke-width": 1.8, "stroke-dasharray": "6 4",
      });
      [["x", xs], ["y", ys]].forEach(([attr, values]) => req.appendChild(svgNode("animate", {
        attributeName: attr, values, calcMode: "discrete",
        dur: `${(tour.length * 0.34).toFixed(2)}s`, repeatCount: "indefinite",
      })));
      const dash = svgNode("animate", {
        attributeName: "stroke-dashoffset", from: 10, to: 0, dur: "0.7s", repeatCount: "indefinite",
      });
      req.appendChild(dash);
      svg.appendChild(req);
      svg.appendChild(svgNode("text", {
        class: "cro-mech__value is-danger", x: M.x0, y: rowY(M.rows - 1) + M.rowH + 22,
      }, `申请中的 0.5 GB 临时 buffer（宽度按同一比例尺画）—— 正在逐个空洞试放`));
    }

    // ── 下：总量 vs 最大连续块 的对照，这条是整个事件的题眼 ──
    const cmpY = 400;
    svg.appendChild(svgNode("text", { class: "cro-mech__title", x: 30, y: cmpY - 12 },
      "决定成败的不是空闲总量，是最大连续块"));
    const bars = [
      { label: "空闲总量", gb: M.freeGB, tone: "var(--success)", ok: true },
      { label: "申请量", gb: M.requestGB, tone: "var(--primary)" },
      { label: "最大连续块", gb: M.biggestHole, tone: "var(--danger)" },
    ];
    const scale = 640 / M.freeGB;
    bars.forEach((b, i) => {
      const y = cmpY + i * 22;
      svg.appendChild(svgNode("text", {
        class: "cro-mech__label", x: 138, y: y + 11, "text-anchor": "end",
      }, b.label));
      svg.appendChild(svgNode("rect", {
        x: 148, y: y + 1, width: Math.max(2, b.gb * scale), height: 12, rx: 3,
        fill: b.tone, "fill-opacity": 0.75,
      }));
      svg.appendChild(svgNode("text", {
        class: `cro-mech__value${i === 2 ? " is-danger" : ""}`, x: 148 + Math.max(2, b.gb * scale) + 10, y: y + 11,
      }, `${b.gb} GB`));
    });
    if (phase >= 3) {
      svg.appendChild(svgNode("text", {
        class: "cro-mech__value is-danger", x: 500, y: cmpY + 33,
      }, "0.32 GB < 0.5 GB → 申请失败，OOM（碎片率 83%）"));
    }
    return svg;
  }
  const MECHANISM_RENDERERS = {
    "router-collapse": renderMechRouterCollapse,
    "barrier-wait": renderMechBarrierWait,
    "pp-cascade": renderMechPpCascade,
    "activation-lifetime": renderMechActivationLifetime,
    "fragmented-oom": renderMechFragmentedOom,
  };

  /* 运行态事件与 training-monitoring-v2 的问题一/问题二同源。事件保留自己的
     性能语义；scope 描述“本次运行实际涉及谁”，不覆盖静态配置映射公式。
     evidence 是本事件的「内涵」：一张证据图 + 几个关键读数，落在详情下区。 */
  const INCIDENT_GROUPS = [
    {
      id: "problem-2",
      name: "问题2 · Router 溢出与通信死锁",
      context: { layers: [38], experts: [193], ranks: [1559], segments: ["moe"] },
      // 桥接句只交代「这是哪条问题线上的哪一步、怎么传的」。传播源与最大影响
      // 各自挂在画布上对应角色的标题下，这里不再重复一遍。
      bridge: (event) => `${event.title}（${event.time}）· 沿“${event.path}”传导`,
      events: [
        {
          id: "p1-warning", time: "15k", dimension: "数值 · 预警", title: "Loss scale 连续衰减",
          focus: { kind: "layer", layer: 38 }, origin: { layers: [38], segments: ["moe"] },
          lineage: { operator: "Layer 38 Router", layer: 38, segment: "moe", bar: "gate", stages: ["model"] },
          victim: { layers: [38], segments: ["moe"] },
          conclusion: "Layer 38 的数值健康已提前恶化，AMP scaler 从 65536 衰减到 4096。",
          root: "Router 输出的数值分布右移，AMP scaler 连续四次减半", path: "Layer 38 → AMP scaler 三级预警",
          impact: "异常仍关在本层内，还没传到通信侧——距离崩溃尚有 53 step",
          evidence: {
            chart: {
              kind: "line", title: "AMP loss scale 逐次减半", unit: "",
              x: ["step 14800", "14900", "15000", "15100", "15150"],
              threshold: { value: 8192, label: "三级预警 · 8192", direction: "below" },
              values: [65536, 65536, 32768, 32768, 16384, 8192, 8192, 4096],
              mark: { index: 7, label: "4096 · 三级预警", tone: "warning" },
              note: "scale 每减半一次，就是一次梯度溢出后的回退；连续 4 次说明数值分布已整体右移，不是偶发。",
            },
            metrics: [
              { label: "衰减级数", value: "4 级（65536 → 4096）" },
              { label: "观察窗口", value: "400 step" },
              { label: "相对崩溃的提前量", value: "53 step" },
            ],
          },
        },
        {
          id: "p1-nan", time: "15203", dimension: "耗时 · 数值", title: "Loss NaN / grad_norm Inf",
          focus: { kind: "layer", layer: 38 }, origin: { layers: [38], segments: ["moe"] },
          lineage: { operator: "Layer 38 Router", layer: 38, segment: "moe", bar: "gate", stages: ["model"] },
          propagation: { stages: [3] },
          victim: { layers: [34,35,36,37,38,39,40,41,42,43,44,45], ranks: "stage" },
          conclusion: "异常只在多卡复现，Layer 38 是首个数值病灶候选。",
          root: "Router logits 越界成 Inf，反向传播时梯度随之溢出", path: "Layer 38 → 梯度 Inf → Loss NaN",
          impact: "本轮迭代的梯度整段作废，训练无法继续收敛",
          evidence: {
            // loss 与 grad_norm 量纲差三个数量级，不并到一根轴上：曲线只画
            // grad_norm，loss 的状态进读数区。
            chart: {
              kind: "line", title: "grad_norm 末段指数级发散", unit: "",
              x: ["step 15196", "15198", "15200", "15202", "15203"],
              threshold: { value: 10, label: "正常波动上界 · 10" },
              values: [1.2, 1.3, 1.6, 2.4, 4.1, 12.7, 86, 860],
              mark: { index: 7, label: "860 → 下一步 Inf", tone: "danger" },
              note: "最后 4 个 step 每步涨约一个数量级，越界发生在同一层的反向传播里。",
            },
            metrics: [
              { label: "loss", value: "NaN", tone: "danger" },
              { label: "grad_norm", value: "Inf", tone: "danger" },
              { label: "多卡复现", value: "8 / 8 次" },
              { label: "单卡复现", value: "0 / 8 次" },
            ],
          },
        },
        {
          id: "p1-log", time: "+8ms", dimension: "通信 · 日志", title: "Plog 暴露 buffer 失配",
          focus: { kind: "rank", rank: 1559 }, origin: { ranks: [1559] },
          lineage: { operator: "EP Dispatch / All-to-All", layer: 38, segment: "moe", bar: "a2a_dispatch", rank: 1559, stages: ["runtime", "kernel"], originNode: { stage: "runtime", index: 0 } },
          propagation: { layers: [38], experts: [193], segments: ["moe"] },
          victim: { ranks: [1559] },
          conclusion: "运行时 EP rank 23 的 send=0、recv=9832；通信报错同时携带 router_logits Inf 证据。",
          root: "all-to-all 的收发量对不上：send=0、recv=9832", path: "Rank 1559 buffer 失配 → 通信阻塞",
          impact: "第一个卡住的就是它自己（PP3 / EP23），此刻尚未波及同组其他卡",
          evidence: {
            chart: {
              kind: "bars", title: "rank 1559 的 all-to-all 收发量", unit: " token",
              items: [
                { label: "send（本卡发出）", value: 0 },
                { label: "recv（本卡待收）", value: 9832, tone: "danger" },
                { label: "同组正常卡均值", value: 154 },
              ],
              note: "一发一收本该同量级。send 归零、recv 堆到 60 倍，说明这张卡被路由指定成了唯一收方。",
            },
            metrics: [
              { label: "运行时 EP rank", value: "23" },
              { label: "global rank", value: "1559（PP3 / EP23）" },
              { label: "日志同时携带", value: "router_logits = Inf", tone: "danger" },
            ],
          },
        },
        {
          id: "p1-a2a", time: "+30s", dimension: "通信 · 耗时", title: "All-to-all 超时，63 rank 空等",
          focus: { kind: "rank", rank: 1559 }, origin: { ranks: [1559] },
          lineage: { operator: "HCCL All-to-All", layer: 38, segment: "moe", bar: "a2a_dispatch", rank: 1559, stages: ["runtime", "kernel"] },
          propagation: { layers: [38], experts: [193], segments: ["moe"], ranks: "ep-stage" },
          victim: { ranks: "ep-stage-peers" },
          conclusion: "EP rank 23 是首个阻塞者，其余 63 个 EP rank 是 barrier 受害者，不应被判为 64 个独立根因。",
          root: "recv 过载，迟迟进不了 all-to-all barrier", path: "Rank 1559 → All-to-all barrier → 63 rank 空等",
          impact: "同组其余成员在 barrier 上空等 30 s，整个 EP 通信组停止前进",
          /* 机制：集合通信的 barrier 语义。「空等 30 s」这件事只有让时间跑起来才
             成立 —— 静态图画得出「63 张卡受影响」，画不出「它们在等，而且等了多久」。
             四相各自是同一条泳道图在不同时刻的截面，evidence 的 64 卡构成图是第 ④ 相。*/
          mechanism: {
            kind: "barrier-wait",
            phases: [
              { tag: "① 进入 dispatch", clock: "t = 0 ms",
                caption: "EP 通信组 64 张卡同时进入 Layer 38 的 all-to-all dispatch。每张卡先把本地 token 按目标专家分箱，再向 barrier 推进 —— 这一步各卡是并行的，互不等待。" },
              { tag: "② rank 1559 卡住", clock: "t = +8 ms",
                caption: "rank 1559（EP r23）的 recv 量对不上：send=0 而 recv=9832，收侧被 E193 的 token 灌爆，迟迟凑不齐自己那一份，进度条停在半路。其余 63 张卡毫无察觉，继续推进。" },
              { tag: "③ 63 卡到达 barrier", clock: "t = +2 s",
                caption: "all-to-all 是同步集合操作：任何一张卡没到齐，barrier 就不放行。63 张卡先后抵达后全部转入空等 —— 它们的算力从这一刻起是零产出，但日志上什么都不会报。" },
              { tag: "④ HCCL 30 s 超时", clock: "t = +30 s",
                caption: "等满 HCCL 超时阈值，64 张卡同时抛 timeout。此刻 63 张是结果、1 张是原因，而报错数完全反过来——按报错数排根因会把结论整个搞反。累计空转 63 × 30 s ≈ 1890 卡·秒。" },
            ],
          },
          evidence: {
            chart: {
              kind: "stack", title: "EP 通信组 64 张卡的角色构成", unit: " 卡",
              items: [
                { label: "阻塞者（rank 1559）", value: 1, tone: "danger" },
                { label: "barrier 空等", value: 63, tone: "warning" },
              ],
              note: "64 张卡同时报 timeout，但只有 1 张是原因、63 张是结果——按报错数排根因会把结论整个搞反。",
            },
            metrics: [
              { label: "HCCL 超时阈值", value: "30 s" },
              { label: "空等卡数", value: "63 / 64" },
              { label: "误判为独立根因", value: "64 个", tone: "warning" },
            ],
          },
        },
        {
          id: "p1-root", time: "-30s", dimension: "数值 · 负载", title: "Router FP8 溢出，E193 吸收 98% token",
          focus: { kind: "segment", segment: "moe", bar: "gate", scopeLayer: 38, deckNode: "gate" },
          lineage: { operator: "Layer 38 Router", layer: 38, segment: "moe", bar: "gate", rank: 1559, stages: ["model", "fx", "ge", "runtime", "kernel"], originNode: { stage: "model", index: 0 }, victimStage: "runtime" },
          origin: { layers: [38], segments: ["moe"] },
          propagation: { ranks: [1559] },
          victim: { experts: "all" },
          conclusion: "这是问题2的根因事件：FP8 softmax 溢出导致路由塌缩，而不是 HCCL 自身故障。",
          root: "Router 的 max(logits)=1846，FP8 下 exp() 直接溢出成 Inf", path: "Router → Expert 193（98% token）→ EP rank 23",
          impact: "路由塌缩，98% token 全压到 E193，其余 247 个再没收到过 token",
          /* 机制：MoE 路由的分布塌缩。四相把「打分 → 越界 → softmax 塌成 one-hot →
             流量全汇到一个专家」拆开演一遍；前两相是同一张扇出图的健康态，正好当
             第三、四相的对照（同图两态，比并排画两张更能读出「变了什么」）。
             evidence 的 token 路由份额柱状图是第 ④ 相的静态截面。 */
          mechanism: {
            kind: "router-collapse",
            phases: [
              { tag: "① 正常路由", clock: "max(logits) = 12.4",
                caption: "Top-2 gate 给 256 个专家打分，负载均衡损失把分布压平：每个专家拿到 0.3%~0.6% 的 token，扇出是发散的，dispatch 流量均摊在 EP 组的 64 张卡上。" },
              { tag: "② logits 越界", clock: "max(logits) = 1846 › FP8 448",
                caption: "上游数值漂移把 Router 线性层的输出整体推高，最大 logit 冲到 1846 —— 已经越过 FP8 E4M3 能表示的 448。此刻路由结果还没变，图上扇出仍是发散的，异常只存在于数值里。" },
              { tag: "③ softmax 塌成 one-hot", clock: "exp(1846) = Inf",
                caption: "softmax 先算 exp()：Inf 同时进了分子和分母，归一化结果退化成 one-hot —— E193 的概率变成 1.0，其余 255 个专家全是 0。这一步是纯数值事故，不是路由策略做出的决定。" },
              { tag: "④ 路由塌缩", clock: "E193 98% · dead 247",
                caption: "此后每个 step 的 token 都被送往同一个专家。E193 的 dispatch buffer 被撑爆，247 个专家再没收到过 token —— 下游 rank 1559 那句 send=0 / recv=9832 的收发失配，源头就在这里。" },
            ],
          },
          evidence: {
            chart: {
              kind: "bars", title: "Layer 38 本 step 的 token 路由份额", unit: "%",
              threshold: { value: 20, label: "单专家健康上限 · 20%" },
              items: [
                { label: "E193", value: 98, tone: "danger" },
                { label: "其余 8 个活跃专家", value: 2 },
                { label: "247 个 dead expert", value: 0 },
              ],
              note: "在一个 batch / 观测窗口内，负载均衡应避免 token 长期塌缩到单个专家；softmax 出现 Inf 后，路由选择持续落在 E193。",
            },
            metrics: [
              { label: "max(router logits)", value: "1846", tone: "danger" },
              { label: "FP8 E4M3 可表示上限", value: "448" },
              { label: "exp(logits)", value: "Inf → softmax 塌缩", tone: "danger" },
              { label: "dead expert", value: "247 / 256" },
            ],
          },
        },
        {
          id: "p1-spread", time: "+30.1s", dimension: "通信 · 扩散", title: "PP3 断裂，2048 NPU hang",
          focus: { kind: "stage", stage: 3 }, origin: { ranks: [1559] },
          lineage: { operator: "EP Barrier / PP3 等待链", layer: 38, segment: "moe", bar: "a2a_dispatch", rank: 1559, stages: ["runtime", "kernel"] },
          propagation: { stages: [3], ranks: "stage" }, victim: { ranks: "all" },
          conclusion: "报错点是通信 timeout，异常震中却在 Layer 38 Router；单点经 EP barrier 和 PP 依赖扩散至整网。",
          root: "all-to-all 就阻塞在这里，它是整网停摆的起点", path: "Expert 193 过载 → Rank 1559 阻塞 → EP barrier → PP3 断裂 → 全网等待",
          impact: "沿 EP barrier 与 PP 依赖逐级传导，4 个 stage 全部停在等待上",
          /* 机制：依赖链的逐级回压。这个事件最容易被读成「2048 张卡各自出了问题」，
             而 evidence 那张 1/63/448/1536 的构成图只给出结果、没给出「凭什么是这几个
             数」。四相把它拆成一条可验算的乘法链：1 →×EP64→ 64 →×EDP8→ 512 →×PP4→
             2048，每一步都是一个已知的并行度，而不是一句「故障扩散」。 */
          mechanism: {
            kind: "pp-cascade",
            phases: [
              { tag: "① 震中", clock: "1 / 2048 卡",
                caption: "rank 1559 停在 all-to-all 上。此刻 PP3 整段仍在正常推进 —— 停的只有这一张卡，泳道上那道红线就是它。这也是全网唯一一个「自己出了问题」的对象。" },
              { tag: "② EP 组停摆", clock: "64 / 2048 卡",
                caption: "all-to-all 是同步集合操作，同组另外 63 张卡在 barrier 上空等。第一个倍数是 EP=64：它不是扩散出来的，是这张卡所在通信组的大小。" },
              { tag: "③ PP3 整段断裂", clock: "512 / 2048 卡",
                caption: "EP 组停住，这一段流水线就交不出激活。同 stage 的其余 7 个 EDP 副本随后也停在依赖上 —— 第二个倍数是 EDP=8，512 = 64 × 8 正是一个 PP stage 的卡数。" },
              { tag: "④ 依赖环闭合", clock: "2048 / 2048 卡",
                caption: "上游 PP2 送不出激活、PP1 与 PP0 依次回压；而 PP0 的下一个 micro-batch 又在等 PP3 的梯度回来 —— 这是一条闭环，断一处就整条停。第三个倍数是 PP=4。99.95% 的卡只是被链条拖住的，它们的 timeout 日志与根因无关。" },
            ],
          },
          evidence: {
            chart: {
              kind: "stack", title: "2048 张卡按「离震中多远」的构成", unit: " 卡",
              items: [
                { label: "直接阻塞", value: 1, tone: "danger" },
                { label: "同 EP 组空等", value: 63, tone: "warning" },
                { label: "同 stage 其余", value: 448 },
                { label: "其他 stage 等待", value: 1536, tone: "good" },
              ],
              note: "99.95% 的卡是被依赖链拖住的，它们的 timeout 日志与根因无关——扩散范围大不等于根因分散。",
            },
            metrics: [
              { label: "受影响 PP stage", value: "4 / 4" },
              { label: "受影响 NPU", value: "2048" },
              { label: "首个阻塞卡", value: "global rank 1559", tone: "danger" },
              { label: "震中", value: "Layer 38 Router（非 HCCL）" },
            ],
          },
        }
      ]
    },
    {
      id: "problem-1",
      name: "问题1 · 显存峰值与碎片 OOM",
      context: {
        layers: [34,35,36,37,38,39,40,41,42,43,44,45],
        stages: [3], experts: "all", epRanks: "all", ranks: "stage", segments: ["moe", "head"]
      },
      bridge: (event) => `${event.title}（${event.time}）· 沿“${event.path}”传导`,
      events: [
        {
          id: "p2-rise", time: "8000+", dimension: "显存 · 趋势", title: "显存从 55 GB 持续爬升",
          focus: { kind: "stage", stage: 3 },
          lineage: { operator: "PP3 激活生命周期", layer: 38, stages: ["model"] },
          origin: { layers: [34,35,36,37,38,39,40,41,42,43,44,45], segments: ["moe"] },
          victim: { layers: [34,35,36,37,38,39,40,41,42,43,44,45], segments: ["head"] },
          conclusion: "PP stage 3 的显存不再回落，吞吐同期下降 12.5%。",
          root: "这一段的激活自前向起就常驻不释放，显存只涨不落", path: "46 层激活常驻 → 显存持续爬升",
          impact: "叠上 LM Head 的 logits 后，本 stage 的显存余量被吃到见底",
          evidence: {
            // 显存(GB) 与吞吐(tokens/s) 不并轴：曲线画显存，吞吐进读数区。
            chart: {
              kind: "line", title: "PP stage 3 显存占用（step 8000 → 12000）", unit: " GB",
              x: ["step 8000", "9000", "10000", "11000", "12000"],
              threshold: { value: 60.8, label: "95% 阈值 · 60.8 GB" },
              values: [55, 56.2, 57.9, 59.4, 60.8, 62.1, 63, 63.7],
              // 不再单点直标：95% 警戒线 + 越线那截红色面积已经把「涨到哪儿了」说清楚了
              note: "每个 step 之间不再回落到基线——说明被留住的不是临时 buffer，而是一直活着的激活。",
            },
            metrics: [
              { label: "起始 / 当前", value: "55 → 63.7 GB" },
              { label: "吞吐", value: "3200 → 2800 tokens/s（−12.5%）", tone: "warning" },
              { label: "未回落持续", value: "4000 step" },
            ],
          },
        },
        {
          id: "p2-cost", time: "12000", dimension: "耗时 · 显存", title: "分配/释放 API 占时 7.4%",
          focus: { kind: "stage", stage: 3 }, origin: { layers: [38], segments: ["moe"] },
          lineage: { operator: "显存分配 / 释放 API", stages: ["runtime"] },
          propagation: { layers: [34,35,36,37,38,39,40,41,42,43,44,45] },
          victim: { ranks: "stage" },
          conclusion: "显存管理耗时 890 ms，明显高于正常值 2%；带宽利用率 78%，可排除纯带宽瓶颈。",
          root: "分配器在这一层反复做碎片整理与换页", path: "碎片整理 / 换页 → step 耗时增加",
          impact: "每个 step 多花 890 ms 在显存管理上，吞吐从 3200 掉到 2800 tokens/s",
          evidence: {
            chart: {
              kind: "stack", title: "单 step 12.0 s 的耗时构成", unit: " s",
              items: [
                { label: "计算", value: 8.9 },
                { label: "通信", value: 2.21, tone: "alt" },
                // limitShare：这一段本该只占 2%，超出的部分在条上单独标红
                { label: "显存分配 / 释放", value: 0.89, tone: "danger", limitShare: 2 },
              ],
              note: "分配释放本该是 2% 量级的边角开销，这里占到 7.4%——斜纹那截就是多出来的碎片整理与换页。",
            },
            metrics: [
              { label: "显存管理耗时", value: "890 ms（7.4%）", tone: "danger" },
              { label: "正常水位", value: "约 2%" },
              { label: "HBM 带宽利用率", value: "78%（非带宽瓶颈）" },
            ],
          },
        },
        {
          id: "p2-peak", time: "12000", dimension: "显存 · 容量", title: "激活值占用 36.2 GB",
          focus: { kind: "stage", stage: 3 }, origin: { layers: [38], segments: ["moe"] },
          lineage: { operator: "PP3 激活值生命周期", layer: 38, stages: ["model"] },
          propagation: { segments: ["moe", "head"] },
          victim: { segments: ["moe", "head"] },
          conclusion: "激活值占峰值的 56.6%，是唯一可大幅缩减的组成。",
          root: "激活在反向用到之前一直留在显存里，逐层累加不释放", path: "逐层激活累积 → Stage 3 叠加 LM Head logits",
          impact: "两段合计 36.2 GB 激活，占满 64 GB 峰值的 56.6%，容量再无余量",
          /* 机制：存活区间的叠加。「激活值占 36.2 GB」本身不解释任何东西 —— 真正
             的原因是生命周期：一层的激活在前向产生、要等反向用到它时才能释放，
             于是 12 层的存活区间在前向末尾**全部重叠**。图上半是区间条、下半是由
             它们逐槽位加出来的占用曲线，那条曲线就是这些条的竖向计数。 */
          mechanism: {
            kind: "activation-lifetime",
            phases: [
              { tag: "① 前向起步", clock: "L34 → L37",
                caption: "常驻段（权重 14.1 + 优化器 9.8 + 碎片 3.9 = 27.8 GB）一开始就在。前向每算完一层，就往显存里压进一份激活 —— 它不能释放，因为反向算梯度时还要用。" },
              { tag: "② 12 层累完", clock: "激活 9.0 GB",
                caption: "L34~L45 每层约 0.71 GB，只有 L38 是 1.2 GB（expert dispatch buffer 让它比同段普通层高 1.7 倍）。12 条存活区间此刻全部在线，叠出 9.0 GB。" },
              { tag: "③ LM Head 叠上", clock: "激活 36.2 GB · 64/64",
                caption: "LM Head 的 logits 存活极短（前向算完紧接着反向就用掉），体量却是 27.2 GB —— 它落在 12 层激活全都还没释放的那一刻，两段合计 36.2 GB，把 64 GB 顶满。峰值就出现在这一个槽位上。" },
              { tag: "④ 释放要等到反向", clock: "安全余量 0 GB",
                caption: "此刻余量为零，而这 12 层的激活各自还要活到反向用到它的那一步才被释放（区间条上闪动的那一截就是剩余存活）。能靠重计算换回来的正是这 36.2 GB —— 权重与优化器状态由并行切分固定，改不动。" },
            ],
          },
          evidence: {
            /* 用等距容器而不是构成条：这张图的分母是**一张卡的 64 GB**，不是各段
               之和。装满了就是 OOM，平面色条表达不了「框满了」这件事。
               items 自底向上摞，读法与 Cluster 区「单卡容量」栏完全一致。 */
            chart: {
              kind: "capacity", title: "64 GB 显存峰值的构成", unit: " GB", cap: 64,
              items: [
                { label: "权重", value: 14.1 },
                { label: "优化器状态", value: 9.8, tone: "good" },
                { label: "激活值", value: 36.2, tone: "warning" },
                { label: "碎片空洞", value: 3.9, tone: "danger", void: true },
              ],
              note: "权重与优化器状态由并行切分固定，改不动；能靠重计算换回来的只有那 36.2 GB 激活。",
            },
            metrics: [
              { label: "峰值 / 容量", value: "64.0 / 64 GB", tone: "danger" },
              { label: "激活占比", value: "56.6%" },
              { label: "安全余量", value: "0 GB", tone: "danger" },
            ],
          },
        },
        {
          id: "p2-layer", time: "12000", dimension: "显存 · Layer", title: "L38 单层激活达到 1.2 GB",
          focus: { kind: "layer", layer: 38 }, origin: { layers: [38], segments: ["moe"] },
          lineage: { operator: "Layer 38 Expert Dispatch Buffer", layer: 38, segment: "moe", bar: "a2a_dispatch", stages: ["model"] },
          propagation: { stages: [3] },
          victim: { layers: [34,35,36,37,38,39,40,41,42,43,44,45], segments: ["head"] },
          conclusion: "Layer 38 比普通 Dense 层高 1.7 倍，额外占用来自 expert dispatch buffer。",
          root: "expert dispatch buffer 让它的激活比同段普通层高 1.7 倍，单层 1.2 GB", path: "Layer 38 → PP stage 3 → 峰值叠加",
          impact: "连同 LM Head 一起，把这个 stage 顶成全网最重的一段",
          evidence: {
            chart: {
              kind: "bars", title: "PP stage 3 逐层激活占用", unit: " GB",
              threshold: { value: 1, label: "异常线 · 1.0 GB" },
              items: [
                { label: "L34", value: 0.7 }, { label: "L35", value: 0.72 },
                { label: "L36", value: 0.69 }, { label: "L37", value: 0.71 },
                { label: "L38", value: 1.2, tone: "danger" },
                { label: "L39", value: 0.73 }, { label: "L40", value: 0.7 },
                { label: "L41", value: 0.72 }, { label: "L42", value: 0.71 },
                { label: "L43", value: 0.7 }, { label: "L44", value: 0.73 },
                { label: "L45", value: 0.71 },
              ],
              note: "12 层里只有 L38 突出，其余层彼此在 ±3% 内——多出来的 0.5 GB 有明确出处，不是统计噪声。",
            },
            metrics: [
              { label: "L38 / 同段普通层", value: "1.20 vs 0.71 GB（×1.7）", tone: "danger" },
              { label: "额外占用来源", value: "expert dispatch buffer" },
              { label: "本段 12 层合计", value: "9.0 GB" },
            ],
          },
        },
        {
          id: "p2-oom", time: "12003", dimension: "显存 · OOM", title: "EP rank 17（global rank 1553）触顶并发生碎片 OOM",
          focus: { kind: "rank", rank: 1553 }, origin: { ranks: [1553] },
          lineage: { operator: "0.5 GB 临时 Buffer 申请", rank: 1553, stages: ["runtime"], originNode: { stage: "runtime", index: 0 }, victimStage: "runtime" },
          propagation: { stages: [3], ranks: "stage" }, victim: { ranks: "all" },
          conclusion: "64/64 GB 容量不足是主因，83% 碎片率让 0.5 GB 临时 buffer 更早申请失败。",
          root: "64 GB 占满，0.5 GB 的临时 buffer 申请失败", path: "Rank 1553 OOM → PP3 中断 → 全网等待",
          impact: "它一崩 PP3 就断，全网跟着停在等待上",
          /* 机制：碎片。这条最容易被读反 —— 空闲还有 3.9 GB、申请只要 0.5 GB，
             凭什么失败？evidence 的容器图给了三个数，但「为什么放不下」得把 64 GB
             摊成真实的地址空间才看得见：已分配块与空洞交替排列，0.5 GB 的申请块
             逐个洞试放，连最大的那个 0.32 GB 也装不下。 */
          mechanism: {
            kind: "fragmented-oom",
            phases: [
              { tag: "① 看总量还有余", clock: "已分配 60.1 / 空闲 3.9 GB",
                caption: "64 GB 里已分配 60.1 GB，空闲 3.9 GB。只看这两个数，一次 0.5 GB 的临时 buffer 申请没有任何理由失败 —— 这正是把 OOM 归因成「容量刚好不够」的由来。" },
              { tag: "② 空闲不是一整块", clock: "碎片率 83%",
                caption: "把 3.9 GB 空闲摊回地址空间：它散成二十多个洞，夹在已分配块之间。反复的分配 / 释放（还有换页与碎片整理，见问题1.2）把连续空间切碎了，碎片率 83%。" },
              { tag: "③ 逐个洞试放", clock: "申请 0.5 GB",
                caption: "分配器要的是一段**连续**地址。0.5 GB 的申请块沿着这些洞一个个试过去 —— 图上那个红框就是它，每停一个洞都装不下。" },
              { tag: "④ 连最大的洞也放不下", clock: "0.32 GB < 0.5 GB",
                caption: "最大连续块只有 0.32 GB，小于申请量 0.5 GB，申请失败。决定成败的从来不是空闲总量，而是最大连续块 —— 所以「再省 0.5 GB 就好了」这个结论是错的，真正要治的是碎片本身（或把峰值降下来让洞变大）。" },
            ],
          },
          evidence: {
            /* 与上一张同款等距容器（同一个 builder），两张图并排看就是「装满了」
               和「装满之后长什么样」。
               空闲的 3.9 GB 在这里拆成两段：3.58 的零碎 + 0.32 的最大连续块。原先
               三段并列（60.1 + 3.9 + 0.32）把最大块又数了一遍，合计 64.32 GB 超过
               容量本身；拆开之后总量正好是 64，而且盒顶那道薄片就是「最大的一个洞
               只有这么薄」——这正是这条证据要说的话。 */
            chart: {
              kind: "capacity", title: "rank 1553 触顶时的 64 GB 分布", unit: " GB", cap: 64,
              items: [
                { label: "已分配", value: 60.1 },
                { label: "碎片空洞 · 零碎", value: 3.58, tone: "danger", void: true },
                { label: "碎片空洞 · 最大连续块", value: 0.32, tone: "warning", void: true },
              ],
              note: "空闲共 3.9 GB（3.58 零碎 + 0.32 最大连续块）＞ 申请量 0.5 GB，申请照样失败——决定成败的是最大连续块，不是空闲总量。",
            },
            metrics: [
              { label: "容量", value: "64 / 64 GB", tone: "danger" },
              { label: "碎片率", value: "83%", tone: "danger" },
              { label: "失败的申请", value: "0.5 GB 临时 buffer" },
              { label: "首个失败卡", value: "global rank 1553（EP17）" },
            ],
          },
        }
      ]
    }
  ].sort((a, b) => a.id.localeCompare(b.id));

  /* ── 页面接线 ─────────────────────────────────────────────────────────── */
  function boot() {
    installTipLayer();
    const controller = createController();
    controller.mount(document.getElementById("croParallelSteppers"), "parallel");
    controller.mount(document.getElementById("croMoeSteppers"), "moe");
    controller.mount(document.getElementById("croClusterSteppers"), "cluster");
    // Micro Batch / Seq Length：与卡型号一起决定单卡装多少，故排在下拉之后
    controller.mount(document.getElementById("croBatchSteppers"), "batch");

    /* 卡型号：硬件属性，和 Total Rank / Node 同属 Cluster 区。两个选项而不是
       stepper —— 型号是枚举不是量，±键在两项之间来回跳读不出「选了哪个」。
       它只影响单卡容量框的高度（CARD_SPECS[].hbmGB）与口径说明，不进 world_size。 */
    (() => {
      const select = document.getElementById("croCardSelect");
      if (!select) return;
      select.innerHTML = "";
      CARD_ORDER.forEach((id) => {
        const spec = CARD_SPECS[id];
        const option = document.createElement("option");
        option.value = id;
        /* 容量直接写进选项：选卡的当下就是在选容量框的高度，不该等到看口径才知道。
           分隔用「·」而不是全角括号 —— 那对括号各占一个汉字宽（26px），
           而这一格与另外六枚控件共用 Cluster 那一行的宽度预算，
           一对括号就够别处的一枚加减键了。信息一个字没少。 */
        option.textContent = `${spec.short} · ${spec.hbmGB}G`;
        option.title = `${spec.label} · ${spec.hbmGB} GB HBM · ${spec.hbmNote}`
          + ` · 整机 ${spec.ranksPerNode || 8} 卡（决定 Node）`;
        if (id === controller.config.card) option.selected = true;
        select.appendChild(option);
      });
      const syncTitle = () => {
        const spec = CARD_SPECS[select.value] || CARD_SPECS[DEFAULT_CARD];
        select.title = `${spec.label} · ${spec.hbmGB} GB HBM（${spec.hbmNote}）`
          + ` · 整机 ${spec.ranksPerNode || 8} 卡（决定 Node）`;
      };
      syncTitle();
      select.addEventListener("change", () => {
        controller.set("card", select.value);
        syncTitle();
      });
    })();

    /* EP 口径：与卡型号、模型一样是"不进 stepper"的配置，但它改的是 world 的
       公式本身（EP 进不进乘积），所以走 controller.setEpMode() 单独一条通路。
       三枚键而不是下拉（行 23 之前是两枚）：档位不多，且切换的后果要能一眼比出来。 */
    (() => {
      const group = document.getElementById("croEpMode");
      if (!group) return;
      const buttons = Array.from(group.querySelectorAll("[data-ep-mode]"));
      const sync = () => {
        const current = controller.config.epMode
          || (controller.config.moeOrthogonal ? "orthogonal" : "split");
        buttons.forEach((button) => {
          const on = button.dataset.epMode === current;
          button.classList.toggle("is-selected", on);
          button.setAttribute("aria-pressed", on ? "true" : "false");
        });
      };
      sync();
      /* 导入一份 MindFormers 配置会把口径换成 mf（行 23），而这排按钮原先只在
         自己被点击时才 sync —— 于是出现「页面按 mf 算、按钮还停在切出档」。 */
      controller.onChange(sync);
      group.addEventListener("click", (event) => {
        const button = event.target.closest?.("[data-ep-mode]");
        if (!button || !group.contains(button)) return;
        controller.setEpMode(button.dataset.epMode);
        sync();
      });
    })();

    /* 模型：整网 / 典型 Layer / MoE 区 / Cluster 四域全部跟着重派。与卡型号不同，
       这不是单字段调整 —— 见 createController 里 setModel() 的注释。 */
    (() => {
      const select = document.getElementById("croModelSelect");
      if (!select) return;
      select.value = controller.config.model;
      select.addEventListener("change", () => controller.setModel(select.value));
    })();

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
    let railLayoutTimer = 0;

    function emitSelect(payload) {
      const topology = controller.topology;
      if (!payload?.incidentId) {
        activeIncident = null;
        setIncidentLayout(false);
        clearIncidentBanner();
        document.querySelectorAll(".cro-event").forEach((button) => {
          button.classList.remove("is-selected");
          button.setAttribute("aria-pressed", "false");
        });
      }
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

    /* 配置一改，四域整块重建：选中/关联的 class 挂在旧 DOM 上，跟着一起没了，
       而关系连线画在独立的 overlay 上、不随重建消失 —— 于是留下「线还在、
       高亮没了」这种半截状态。何况关系集本来就是配置的函数（rank 集合跟着
       TP/DP/EP 走），调完 TP 旧连线指向的已经是另一批卡，光补高亮也不对。
       所以按新 topology 把同一个选择重解析一遍再铺；选中对象在新配置里已经
       不存在（层数/卡数/专家数被调小）就整体清空，不留悬空高亮。 */
    function reapplySelection(topology) {
      const p = relation?.primary;
      if (!p) return;
      const c = topology.counts;
      const survives = {
        layer: () => p.layer < c.totalLayer,
        stage: () => p.stage < c.pp,
        rank: () => p.rank < c.totalRank,
        expert: () => p.expert < c.routedExpert,
        epRank: () => p.epRank < c.ep,
        sharedExpert: () => p.shared < c.sharedExpert,
      }[p.kind];
      if (survives && !survives()) { clearSelection(); return; }
      const next = { ...p };
      // 专家 ↔ EP rank 的归属是 (routedExpert, ep) 的函数，配置一变就得重算，
      // 否则拿旧 epRank 去点亮新分组，亮的是别的组
      if (next.kind === "expert") next.epRank = topology.epRankOfExpert(next.expert);
      if (next.kind === "epRank") next.experts = topology.expertsOfEpRank(next.epRank);
      emitSelect(next);
    }

    function redrawLinks() {
      // 事件模式下四域整块隐藏，没有可连的锚点：连线直接收掉，否则 scroll/resize
      // 会把线画到 0×0 的隐藏元素上（退化成射向视口左上角的射线）。
      if (activeIncident) {
        linkLayer?.replaceChildren();
        return;
      }
      drawRelationLinks(linkLayer, relation);
    }

    // deck 当前实际处在的状态，用于去重（见 applyRelation 里的 deck.silently）。
    // deck 重建后 DOM 是全新的，这两个缓存要一并作废。
    let deckFrontLayer = null;
    let deckNodeKey = null;

    let rankCellMap = new Map();
    let rankCellMapHost = null;
    let rankCellMapFirst = null;
    let paintedRankCells = new Set();
    let paintedSelectedRankCell = null;

    function currentRankCellMap() {
      const host = document.getElementById("croHeat");
      const cells = host?.querySelectorAll(".twin-heat-cell") || [];
      // Cluster 在配置变化时会整体重建；只在宿主或子节点数量变化时重建索引。
      if (host !== rankCellMapHost || cells.length !== rankCellMap.size || cells[0] !== rankCellMapFirst) {
        rankCellMapHost = host;
        rankCellMapFirst = cells[0] || null;
        rankCellMap = new Map(Array.from(cells, (cell) => [Number(cell.dataset.rank), cell]));
        paintedRankCells = new Set();
        paintedSelectedRankCell = null;
      }
      return rankCellMap;
    }

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
        const incident = Boolean(p?.incidentId);
        const selected = !incident && Boolean(p) && p.kind === "stage" && s === p.stage;
        el.classList.toggle("is-selected", selected);
        el.classList.toggle("is-related", !incident && !selected && has("stages", s));
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
      /* 先翻绑定态：关系收敛到唯一一个 PP stage 且触及 MoE 时，宫格才有确定的
         global rank 可标、点击才发得出连线（见 moeBindingOf 上面那段）。清空选择
         时 rel 为 null → 回到未绑定，编号随之消失。 */
      paintMoeBinding(
        document.getElementById("croRoutedExperts"),
        moeBindingOf(rel, controller.topology),
        controller.topology,
      );
      // 只扫 board：事件详情的角色卡里也有一整套 .cro-expert / .cro-moe-group，
      // 那是只读证据，不该被静态查询的选中态涂到。
      board?.querySelectorAll(".cro-expert[data-expert]").forEach((dot) => {
        const e = Number(dot.dataset.expert);
        const selected = Boolean(p) && p.kind === "expert" && e === p.expert;
        dot.classList.toggle("is-selected", selected);
        dot.classList.toggle("is-related", !selected && has("experts", e));
      });
      /* 关系集只点到个别 EP 组时（点一张卡 = 它所在的那一个），描边提到与共享
         专家同一档的白：那一次点击里 allShared() 让共享专家亮的是白 1.5px 描边，
         EP 组却只有一档灰边，同一次选择两处亮度差一大截，读起来像 EP 组根本没
         被点上。
         只在「个别」时提亮 —— 点整网节点 / 典型层会走 allEpRanks() 把全部 EP 都
         收进关系集，那时整列几十个组一起白框，等于什么都没突出。判据与关系摘要
         那句「EP0、EP1… / 全部 EP」同源（见 relationSummary 的 rel.epRanks.size
         < c.ep）。 */
      const epPinpoint = Boolean(rel) && rel.epRanks.size > 0
        && rel.epRanks.size < controller.topology.counts.ep;
      board?.querySelectorAll(".cro-moe-group").forEach((group) => {
        const ep = Number(group.dataset.epRank);
        // 点 EP 组名 = 把整组选中：组本身进 is-selected（白描边由 CSS 给），
        // 组内专家仍留 is-related 以免被聚焦降噪压暗，但底色被 CSS 压回中性。
        const selected = Boolean(p) && p.kind === "epRank" && ep === p.epRank;
        const related = !selected && has("epRanks", ep);
        group.classList.toggle("is-selected", selected);
        group.classList.toggle("is-related", related);
        group.classList.toggle("is-pinpoint", related && epPinpoint);
      });
      board?.querySelectorAll(".cro-expert--shared").forEach((chip) => {
        const i = Number(chip.dataset.shared);
        const selected = Boolean(p) && p.kind === "sharedExpert" && i === p.shared;
        chip.classList.toggle("is-selected", selected);
        chip.classList.toggle("is-related", !selected && has("shared", i));
      });

      // ── 集群 ──
      const cellsByRank = currentRankCellMap();
      paintedRankCells.forEach((cell) => cell.classList.remove("is-related"));
      paintedRankCells.clear();
      paintedSelectedRankCell?.classList.remove("is-selected");
      paintedSelectedRankCell = null;

      if (rel) {
        rel.ranks.forEach((rank) => {
          const cell = cellsByRank.get(rank);
          if (!cell) return;
          if (p?.kind === "rank" && rank === p.rank) {
            cell.classList.add("is-selected");
            paintedSelectedRankCell = cell;
          } else {
            cell.classList.add("is-related");
            paintedRankCells.add(cell);
          }
        });
      }

      // ── 整网 deck（回写时静音它的 onNodeSelect，否则会自激成死循环）──
      /* deck 的两个写入都做**幂等去重**：setFrontLayer 内部会遍历全部 46 张层卡、
         逐张重置专家池（replaceChildren + 四条内联几何）再重算边线，正视图下换卡
         还是一次 display:none → block 的整卡重绘。值没变还照写一遍，画面上就是
         连点同一张卡时无谓地闪一下。
         selectNode 与 front layer 绑在一起：换了卡，同名节点要在新卡里重新标。 */
      deck?.silently((api) => {
        if (!api) return;
        const nextLayer = rel && Number.isFinite(rel.deckLayer) ? rel.deckLayer : null;
        // 第二参必须是 undefined 而不是 null —— deck 里判的是
        // Number.isFinite(Number(layer))，Number(null) === 0 会把查找锁进 L0。
        const scope = !rel || rel.deckStatic || nextLayer === null ? undefined : nextLayer;
        // 没有对应算子节点时也要清掉上一次的：正视图下非 front 层是 display:none，
        // 留在旧层里的 .is-selected 节点会退化成 0×0 矩形，collectAnchors 拿到它
        // 之后关系连线就朝视口左上角画出去。
        const nextNode = rel ? (rel.deckNode || null) : null;
        const movedFront = nextLayer !== null && nextLayer !== deckFrontLayer;
        if (movedFront) {
          api.setFrontLayer?.(nextLayer);
          deckFrontLayer = nextLayer;
        }
        const nodeKey = `${nextNode}|${scope}`;
        if (movedFront || nodeKey !== deckNodeKey) {
          api.selectNode?.(nextNode, scope);
          deckNodeKey = nodeKey;
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

        // 集群矩阵 rank 多到要内部滚动时同理：被点亮的那批卡可能整个在折叠区里
        const clusterView = document.querySelector(".cro-cluster__grid");
        revealIn(clusterView, firstMatch(clusterView, [
          ".twin-heat-cell.is-selected",
          ".twin-heat-cell.is-related",
        ]));
      }

      requestAnimationFrame(redrawLinks);
    }

    const board = document.getElementById("croBoard");
    let activeIncident = null;

    function expandIncidentValues(spec, key, topology) {
      if (!spec || spec[key] == null) return [];
      const value = spec[key];
      if (value === "all") {
        const countByKey = {
          ranks: topology.counts.totalRank,
          experts: topology.counts.routedExpert,
          epRanks: topology.counts.ep,
          layers: topology.counts.totalLayer,
        };
        const count = countByKey[key];
        return Number.isFinite(count) ? Array.from({ length: count }, (_, i) => i) : [];
      }
      if (value === "stage" && key === "ranks") return topology.ranksOfStage(3);
      if (value === "ep-stage" && key === "ranks") {
        const start = topology.rankOf(3, 0, 0);
        return Array.from({ length: topology.counts.ep }, (_, i) => start + i);
      }
      if (value === "ep-stage-peers" && key === "ranks") {
        const start = topology.rankOf(3, 0, 0);
        return Array.from({ length: topology.counts.ep }, (_, i) => start + i).filter((rank) => rank !== 1559);
      }
      return Array.isArray(value) ? value : [];
    }

    function addIncidentScope(rel, event, topology) {
      // 静态查询会把“某层/某算子理论上可关联的全部对象”铺开；运行态事件必须
      // 改用本次采样的实际范围，否则 E193 病灶会误亮全部 256 专家和 2048 rank。
      ["layers", "stages", "experts", "epRanks", "segments", "ranks", "shared", "units", "staticNodes"]
        .forEach((key) => rel[key].clear());
      ["context", "origin", "propagation", "victim"].forEach((role) => {
        const spec = event[role];
        if (!spec) return;
        ["layers", "stages", "experts", "epRanks", "segments", "ranks"].forEach((key) => {
          expandIncidentValues(spec, key, topology).forEach((value) => rel[key].add(value));
        });
      });
      rel.layers.forEach((layer) => rel.stages.add(topology.stageOfLayer(layer)));
      rel.nodes = topology.nodesOfRanks(Array.from(rel.ranks));
      rel.labels = relationLabels(topology, rel, activeColumns(topology));
      return rel;
    }

    /* 事件的角色范围曾经是直接描在四域上的（红框=传播源、橙框=受影响，外加一枚
       跟着震中飘的「传播源」浮标）。四域在事件模式下已整块收起，这套描边随之下线，
       角色范围改由中区两张卡各自重建的域承担。这里只保留「退出事件」时收横幅。 */
    function clearIncidentBanner() {
      const banner = document.getElementById("croIncidentBanner");
      if (banner) banner.hidden = true;
    }

    /* 事件模式与配置仿真模式互斥。
       已发生的运行事件是既成事实：配置表单不可调，四域「点一个对象看它理论上
       牵连谁」的静态查询口径也不成立（范围由本次采样写死）。所以进事件详情就把
       .cro-board 整块收起，换成上（横幅）/ 中（传播源→受影响）/ 下（事件内涵）
       三段视图；关闭横幅或收起运行事件栏再切回来。 */
    function setIncidentLayout(on) {
      const view = document.getElementById("croIncidentView");
      if (view && view.hidden !== !on) view.hidden = !on;
      if (!on) mech.stop();   // 回配置态：别让机制图的相位定时器在隐藏页面里空转
      if (board && board.hidden !== on) {
        board.hidden = on;
        if (!on) {
          // 回配置态时清掉详情内容：角色卡里那两套域各带着 2048 个格子，留着白占内存
          ["croOriginDomains", "croVictimDomains", "croIncidentDetail", "croIncidentLineage"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = "";
          });
        }
        // 隐藏期间刻度带量不到宽度，layoutLayerNav 会解出一堆 0 宽刻度。
        // 切回配置态时重算一次，否则 Layer 导航是塌的。
        // 两行的高度分配同理：hidden 期间 syncBoardRows 量不到板子只能原样退回，
        // 中途若改过配置/拉过窗口，留着的就是过期分配（Cluster 差几十像素就会
        // 滚出条来）。等 layout 落定后补量一次。
        // rAF 里跑，顺带避开 refitClusterCells 的 TDZ（它声明在本函数之后）
        if (!on) requestAnimationFrame(() => {
          layoutLayerNav(layerNav);
          syncBoardRows(controller.topology.counts);
          refitClusterCells();
        });
      }
    }

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || "";
    };

    /* ── 中区 · 角色卡的域重建 ─────────────────────────────────────────────
       事件的 origin / victim 只可能落在三个域上：Model Architecture（层 / PP 段 /
       结构段）、MoE（专家 / EP 组）、Cluster（rank）。哪个域被触及，就在角色卡里
       用**原样的那一域图形**重建一份 —— 不缩略、不换编码，四域里认得的东西在角色
       卡里还是同一个东西，只是范围被裁到本角色：命中对象按角色色点亮，其余压暗。
       两侧的域清单往往不同（如「L38 Router」→「256 个专家全部塌缩」），这正是
       「事件从哪来、打到哪去」最直接的读法。 */
    const ROLE_DOMAINS = [
      { id: "arch", title: "Model Architecture", keys: ["layers", "stages", "segments"] },
      { id: "moe", title: "MoE", keys: ["experts", "epRanks"] },
      { id: "cluster", title: "Cluster", keys: ["ranks"] },
    ];

    const NOOP = () => {};

    /* deck 的语义色变量要搬到「结构条 / 专家点所在的那棵子树」上。四域在
       .cro-board 里，角色卡里的那几份在 .cro-incident-view 里，两处都要写，
       否则事件模式下的算子条会退回 CSS 兜底色，与整网图对不上。 */
    function syncPalette() {
      const deckRoot = document.getElementById("croDeckHost");
      syncDeckPalette(deckRoot, board);
      syncDeckPalette(deckRoot, document.getElementById("croIncidentView"));
    }

    /* 范围 chip 是那一行的**主语**，后面紧跟着「发生了什么」，所以要短：
       单层直接写 L38（不必再加「· 1 层」），段名用短标签而不是结构条里那种
       带层区间的全名（「MoE x44（L2~L45）」在这里只是噪声）。 */
    const SEGMENT_LABELS = {
      emb: "Emb", dense: "Dense 层", moe: "MoE 层", norm: "Final Norm", head: "LM Head",
    };

    function roleScopeChips(spec, topology) {
      const chips = [];
      const add = (key, text) => { if (text) chips.push({ key, text }); };
      const layers = expandIncidentValues(spec, "layers", topology);
      if (layers.length) {
        add("layers", layers.length === 1
          ? `L${layers[0]}`
          : `${formatRuns(layers, "L")} · ${layers.length} 层`);
      }
      const stages = expandIncidentValues(spec, "stages", topology);
      if (stages.length) add("stages", stages.map((s) => `PP${s}`).join(" + "));
      const segments = expandIncidentValues(spec, "segments", topology);
      if (segments.length) {
        const names = new Map(activeColumns(topology).map((col) => [col.id, col.name]));
        add("segments", segments.map((s) => SEGMENT_LABELS[s] || names.get(s) || s).join(" / "));
      }
      const experts = expandIncidentValues(spec, "experts", topology);
      if (experts.length) add("experts", experts.length > 8 ? `${experts.length} 个专家` : formatRuns(experts, "E"));
      const epRanks = expandIncidentValues(spec, "epRanks", topology);
      if (epRanks.length) add("epRanks", epRanks.length > 8
        ? `${epRanks.length} 个 EP ranks`
        : formatRuns(epRanks, "EP rank "));
      const ranks = expandIncidentValues(spec, "ranks", topology);
      if (ranks.length) add("ranks", ranks.length > 4 ? `${ranks.length} 张卡` : formatRuns(ranks, "rank "));
      return chips;
    }

    function buildRoleDomain(domain, spec, topology, summary) {
      const section = document.createElement("section");
      section.className = "cro-role-domain";
      section.dataset.domain = domain.id;

      /* 域头一行读成一句话：左边的范围 chip 是主语（谁），右边的 summary 是谓语
         （发生了什么）。域名（Model Architecture / MoE / Cluster）不再单列 ——
         chip 本身已经点明了对象类型，多一个分类名只是噪声。 */
      const head = document.createElement("div");
      head.className = "cro-role-domain__head";
      // chip 只挂在描述它的那个域上，免得 Cluster 那行挂一串层号
      roleScopeChips(spec, topology)
        .filter((chip) => domain.keys.includes(chip.key))
        .forEach((chip) => {
          const el = document.createElement("span");
          el.className = "cro-role-domain__chip";
          el.textContent = chip.text;
          head.appendChild(el);
        });
      if (summary) {
        const text = document.createElement("p");
        text.className = "cro-role-domain__summary";
        text.textContent = summary;
        head.appendChild(text);
      }

      const body = document.createElement("div");
      body.className = "cro-role-domain__body";

      if (domain.id === "arch") {
        const nav = document.createElement("div");
        nav.className = "cro-layer-nav";
        renderLayerNav(nav, topology, NOOP);
        body.appendChild(nav);
        // 结构段只在事件确实点名了段时才铺 —— 只涉及层/PP 的事件（如「显存爬升」）
        // 摆一条五段结构条纯属噪声。
        if (spec.segments != null) {
          const structure = document.createElement("div");
          structure.className = "cro-structure";
          renderStructure(structure, topology, NOOP);
          body.appendChild(structure);
        }
      } else if (domain.id === "moe") {
        const routed = document.createElement("div");
        routed.className = "cro-moe-groups";
        renderMoe(null, routed, topology, NOOP);
        body.appendChild(routed);
      } else {
        const heat = document.createElement("div");
        heat.className = "twin-heat cro-heat";
        renderCluster(heat, topology, NOOP);
        body.appendChild(heat);
      }

      section.append(head, body);
      return section;
    }

    /* 命中着色。逐个 querySelectorAll(`[data-x="v"]`) 在 2048 格集群上是 2048 次
       全子树查询；改成「一次拿全、用 Set 判」。 */
    function paintRoleScope(root, spec, topology) {
      const hit = (selector, attr, values, cast) => {
        const set = new Set(values.map(cast));
        if (!set.size) return;
        root.querySelectorAll(selector).forEach((el) => {
          if (set.has(cast(el.dataset[attr]))) el.classList.add("is-hit");
        });
      };
      const segments = expandIncidentValues(spec, "segments", topology);
      hit(".cro-tick[data-layer]", "layer", expandIncidentValues(spec, "layers", topology), Number);
      hit(".cro-pp-span", "stage", expandIncidentValues(spec, "stages", topology), Number);
      hit(".cro-structure__col", "segment", segments, String);
      hit(".cro-ffn-span", "segment", segments, String);
      hit(".cro-expert[data-expert]", "expert", expandIncidentValues(spec, "experts", topology), Number);
      hit(".cro-moe-group", "epRank", expandIncidentValues(spec, "epRanks", topology), Number);
      hit(".twin-heat-cell", "rank", expandIncidentValues(spec, "ranks", topology), Number);
    }

    function renderRoleDomains(host, spec, topology, options = {}) {
      const { focusBar, summary } = options;
      if (!host) return;
      host.innerHTML = "";
      const domains = spec ? ROLE_DOMAINS.filter((d) => d.keys.some((k) => spec[k] != null)) : [];
      if (!domains.length) {
        const empty = document.createElement("span");
        empty.className = "cro-empty";
        empty.textContent = "本次采样未记录该角色的范围";
        host.appendChild(empty);
        return;
      }
      // 这句话说的是整个角色发生了什么，挂在第一个域的头上（该角色的第一行）
      domains.forEach((domain, index) => {
        host.appendChild(buildRoleDomain(domain, spec, topology, index === 0 ? summary : null));
      });
      paintRoleScope(host, spec, topology);
      if (focusBar) {
        const bar = host.querySelector(
          `.cro-bar[data-segment="${focusBar.segment}"][data-bar="${focusBar.bar}"]`,
        );
        // 画布上算子条是全量铺开的，不需要再滚进视口
        if (bar) bar.classList.add("is-hit");
      }
      // 角色卡是只读证据而非查询入口：摘掉 Tab 站（集群网格自己会给首格 tabindex=0），
      // 点击由 CSS 的 pointer-events 挡在按钮上。
      host.querySelectorAll("[tabindex], button").forEach((el) => el.setAttribute("tabindex", "-1"));
    }

    /* ── 中区画布的平移 / 缩放 ────────────────────────────────────────────
       舞台按内容排到自然尺寸（三栏定宽、高度随内容），视口只做取景：
         · 进入事件 / 窗口变化 → fit()，整幅按视口自动缩放并居中
         · 滚轮 → 以指针为锚缩放（指针下那一点保持不动）
         · 拖拽 → 平移
       缩放走 transform，不重排内部那两千多个格子。 */
    const stage = (() => {
      const viewport = document.getElementById("croIncidentFlow");
      const surface = document.getElementById("croIncidentStage");
      if (!viewport || !surface) return { fit() {} };

      const MIN = 0.12, MAX = 2, PAD = 16;
      let scale = 1, tx = 0, ty = 0;

      /* 「连的是哪一坨」：一个域里命中面很小（几个专家、一根算子条）时就接到那几个
         对象本身；命中的是「全部 2048 卡」「256 个专家」这类整体时，接到这个域的
         整块，并把范围虚线圈出来 —— 逐个去并 2048 个格子的包围盒既慢又没意义。 */
      const GROUP_THRESHOLD = 24;

      function anchorGroups(hostId) {
        const host = document.getElementById(hostId);
        if (!host) return [];
        const groups = [];
        host.querySelectorAll(".cro-role-domain").forEach((section) => {
          const hits = section.querySelectorAll(".is-hit");
          if (!hits.length) return;
          if (hits.length > GROUP_THRESHOLD) {
            const body = section.querySelector(".cro-role-domain__body");
            if (body) groups.push({ rect: unionRect([body]), whole: true });
          } else {
            groups.push({ rect: unionRect(Array.from(hits)), whole: hits.length > 1 });
          }
        });
        return groups.filter((g) => g.rect);
      }

      /* 连线画在舞台自身坐标系里，跟着画布一起缩放。只在 fit() 里 transform 归零的
         窗口调用 —— 那时 getBoundingClientRect 读到的才是未缩放的真实几何。 */
      function drawLinks(sw, sh) {
        const svg = document.getElementById("croStageLinks");
        const label = document.getElementById("croIncidentArrow");
        if (!svg) return;
        svg.replaceChildren();
        svg.setAttribute("viewBox", `0 0 ${sw} ${sh}`);

        const base = surface.getBoundingClientRect();
        const toLocal = (r) => ({
          left: r.left - base.left, right: r.right - base.left,
          top: r.top - base.top, bottom: r.bottom - base.top,
        });
        const origin = anchorGroups("croOriginDomains").map((g) => ({ ...g, rect: toLocal(g.rect) }));
        const victim = anchorGroups("croVictimDomains").map((g) => ({ ...g, rect: toLocal(g.rect) }));
        // 两个显示区的栏位边界：路径标签靠它避让，不靠曲线
        const boxOf = (role) => {
          const el = surface.querySelector(`.cro-stage-role[data-role="${role}"]`);
          return el ? toLocal(el.getBoundingClientRect()) : { left: 0, right: 0 };
        };
        const originBox = boxOf("origin"), victimBox = boxOf("victim");
        if (!origin.length || !victim.length) {
          // 某一侧没有命中物（理论上不该发生）：标签退回舞台正中，不留在 auto 位置
          if (label) {
            label.style.left = `${sw / 2}px`;
            label.style.top = `${sh / 2}px`;
          }
          return;
        }

        const spanOf = (groups) => groups.reduce((acc, g) => ({
          left: Math.min(acc.left, g.rect.left), right: Math.max(acc.right, g.rect.right),
          top: Math.min(acc.top, g.rect.top), bottom: Math.max(acc.bottom, g.rect.bottom),
        }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });

        const outline = (group, tone) => {
          if (!group.whole) return;
          const r = group.rect;
          const rect = svgNode("rect", {
            class: "cro-stage-link-group",
            x: r.left - 6, y: r.top - 6,
            width: (r.right - r.left) + 12, height: (r.bottom - r.top) + 12,
            rx: 10,
          });
          rect.style.stroke = tone;
          svg.appendChild(rect);
        };
        origin.forEach((g) => outline(g, "var(--danger)"));
        victim.forEach((g) => outline(g, "var(--warning)"));

        const from = spanOf(origin), to = spanOf(victim);
        const HEAD = 9;
        const x1 = from.right + 6, y1 = (from.top + from.bottom) / 2;
        const tipX = to.left - 6, y2 = (to.top + to.bottom) / 2;
        // 曲线在箭头根部收笔，否则圆头笔画会从三角形尖端探出去
        const x2 = tipX - HEAD + 1;
        /* 红→黄渐变按实际端点建（userSpaceOnUse），走向永远跟着这一条线自己的
           两端走，而不是跟着 viewBox 的左右。 */
        const defs = svgNode("defs");
        const gradient = svgNode("linearGradient", {
          id: "croStageLinkGradient", gradientUnits: "userSpaceOnUse",
          x1, y1, x2: tipX, y2,
        });
        [["0", "var(--danger)"], ["1", "var(--warning)"]].forEach(([offset, color]) => {
          const stop = svgNode("stop", { offset });
          stop.style.stopColor = color;
          gradient.appendChild(stop);
        });
        defs.appendChild(gradient);
        svg.appendChild(defs);

        // 控制点水平外推半个跨距：出发与落点都是水平切线，读起来是「流出去/流进来」
        const bend = Math.max(48, (x2 - x1) / 2);
        svg.appendChild(svgNode("path", {
          class: "cro-stage-link",
          d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`,
        }));
        svg.appendChild(svgNode("circle", { class: "cro-stage-link-dot", cx: x1, cy: y1, r: 3 }));
        svg.appendChild(svgNode("path", {
          class: "cro-stage-link-head",
          d: `M${tipX},${y2} L${tipX - HEAD},${y2 - HEAD * 0.58} L${tipX - HEAD},${y2 + HEAD * 0.58} Z`,
        }));

        /* 路径标签避两样东西：
           横向 —— 钉在两个显示区中间的空当里。跟着曲线中点走的话，传播源命中物
           偏左时标签会压到传播源那一列上。
           纵向 —— 整块挪到曲线的上方或下方（挑空间大的一侧），不再骑在线上。
           骑在线上时卡片把曲线截成两截，看着像连线断了。 */
        if (label) {
          const half = label.offsetHeight / 2;
          const curveY = (y1 + y2) / 2;          // 对称控制点下 t=0.5 即两端点中点
          const CLEARANCE = 14;
          const offset = half + CLEARANCE;
          const top = curveY >= sh / 2 ? curveY - offset : curveY + offset;
          label.style.left = `${(originBox.right + victimBox.left) / 2}px`;
          label.style.top = `${Math.min(Math.max(top, half), Math.max(half, sh - half))}px`;
        }
      }

      function apply() {
        surface.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale})`;
        // 底纹跟着平移走，推画布时才有「在一张纸上移动」的感觉
        viewport.style.backgroundPosition = `${tx.toFixed(1)}px ${ty.toFixed(1)}px`;
        setText("croStageZoomReadout", `${Math.round(scale * 100)}%`);
      }

      function fit() {
        // 自然尺寸必须在未缩放时量，否则量到的是上一次缩放后的结果
        surface.style.transform = "none";
        /* 刻度带的分隔线与 PP/FFN 标签位置是 layoutLayerNav 用 getBoundingClientRect
           实测出来、再以 px 写回的 —— 那个读数会被 transform 缩放污染（写回去的值
           被再缩一次，标签整体错位）。所以在这里、transform 已归零的窗口里重排一次。 */
        surface.querySelectorAll(".cro-layer-nav").forEach((nav) => layoutLayerNav(nav));
        const sw = surface.offsetWidth, sh = surface.offsetHeight;
        drawLinks(sw, sh);
        const box = viewport.getBoundingClientRect();
        if (!sw || !sh || !box.width || !box.height) { apply(); return; }
        scale = Math.max(MIN, Math.min(
          (box.width - PAD * 2) / sw,
          (box.height - PAD * 2) / sh,
          1,
        ));
        tx = Math.max(PAD, (box.width - sw * scale) / 2);
        ty = Math.max(PAD, (box.height - sh * scale) / 2);
        apply();
      }

      function zoomAt(clientX, clientY, factor) {
        const box = viewport.getBoundingClientRect();
        const px = clientX - box.left, py = clientY - box.top;
        const next = Math.max(MIN, Math.min(MAX, scale * factor));
        if (next === scale) return;
        tx = px - (px - tx) * (next / scale);
        ty = py - (py - ty) * (next / scale);
        scale = next;
        apply();
      }

      function zoomCenter(factor) {
        const box = viewport.getBoundingClientRect();
        zoomAt(box.left + box.width / 2, box.top + box.height / 2, factor);
      }

      viewport.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
      }, { passive: false });

      let drag = null;
      viewport.addEventListener("pointerdown", (event) => {
        // 缩放控件不是画布的一部分
        if (event.target.closest?.(".cro-stage-zoom")) return;
        drag = { x: event.clientX, y: event.clientY, tx, ty, id: event.pointerId };
        viewport.setPointerCapture?.(event.pointerId);
        viewport.classList.add("is-panning");
      });
      viewport.addEventListener("pointermove", (event) => {
        if (!drag) return;
        tx = drag.tx + (event.clientX - drag.x);
        ty = drag.ty + (event.clientY - drag.y);
        apply();
      });
      const endDrag = () => {
        if (!drag) return;
        viewport.releasePointerCapture?.(drag.id);
        drag = null;
        viewport.classList.remove("is-panning");
      };
      viewport.addEventListener("pointerup", endDrag);
      viewport.addEventListener("pointercancel", endDrag);

      document.getElementById("croStageZoomIn")?.addEventListener("click", () => zoomCenter(1.2));
      document.getElementById("croStageZoomOut")?.addEventListener("click", () => zoomCenter(1 / 1.2));
      document.getElementById("croStageZoomFit")?.addEventListener("click", fit);

      return { fit };
    })();

    /* 箭头列：path 拆成链路步骤，再挂上传导中途扫到的范围（propagation）。
       propagation 与 origin/victim 同构，直接复用同一套 chip。 */
    /* ── 中区 · 机制舞台 ───────────────────────────────────────────────────
       事件写了 mechanism 就由机制图占主位，传播图退成右下角地图；没写就整块回到
       原来的满铺传播图（data-mech="off"）—— 所以机制图可以一个事件一个事件地铺，
       不必一次改完 11 个。
       相位是「看哪一相」的分段选择，播放只是替用户按顺序点一遍；演到末相自动停在
       那里（不循环），因为末相才是这个事件最终的样子，定格比转圈更有用。 */
    const mech = (() => {
      const center = document.getElementById("croIncidentCenter");
      const root = document.getElementById("croMech");
      const axis = document.getElementById("croMechPhases");
      const canvas = document.getElementById("croMechCanvas");
      const caption = document.getElementById("croMechCaption");
      const clock = document.getElementById("croMechClock");
      const playButton = document.getElementById("croMechPlay");
      const mapToggle = document.getElementById("croMechMapToggle");
      const PHASE_MS = 2800;
      const ICON = {
        play: "M7 4v16l13-8z",
        pause: "M8 5h3v14H8zM13 5h3v14h-3z",
        replay: "M4 12a8 8 0 1 0 2.6-5.9M4 3v4h4",
      };
      if (!center) return { render() { return false; }, stop() {} };

      let spec = null, phases = [], phase = 0, timer = 0;

      function setIcon(name, label) {
        const path = playButton?.querySelector("path");
        if (path) path.setAttribute("d", ICON[name]);
        // 播放键的填充/描边画法不同：replay 是描边箭头，另两个是实心图形
        const svg = playButton?.querySelector("svg");
        if (svg) {
          svg.setAttribute("fill", name === "replay" ? "none" : "currentColor");
          svg.setAttribute("stroke", name === "replay" ? "currentColor" : "none");
          svg.setAttribute("stroke-width", "2");
          svg.setAttribute("stroke-linecap", "round");
        }
        playButton?.setAttribute("aria-label", label);
        playButton?.setAttribute("title", label);
      }

      function stop() {
        if (timer) { clearInterval(timer); timer = 0; }
        setIcon(phases.length && phase >= phases.length - 1 ? "replay" : "play",
          phases.length && phase >= phases.length - 1 ? "从头播一遍" : "播放机制演进");
      }

      function select(index) {
        if (!spec || !phases.length) return;
        phase = Math.max(0, Math.min(phases.length - 1, index));
        const entry = phases[phase];
        const draw = MECHANISM_RENDERERS[spec.kind];
        canvas.replaceChildren(draw(phase));
        canvas.setAttribute("aria-label", `${entry.tag} · ${entry.caption}`);
        caption.textContent = entry.caption;
        clock.textContent = entry.clock || "";
        Array.from(axis.children).forEach((tab, i) => {
          const on = i === phase;
          tab.classList.toggle("is-selected", on);
          tab.setAttribute("aria-selected", String(on));
        });
      }

      function start() {
        stop();
        if (phase >= phases.length - 1) select(0);
        timer = setInterval(() => {
          if (phase >= phases.length - 1) { stop(); return; }
          select(phase + 1);
        }, PHASE_MS);
        setIcon("pause", "暂停");
      }

      playButton?.addEventListener("click", () => { if (timer) stop(); else start(); });

      /* 地图开合：停靠态整块是一枚放大键，点开后铺满中区、画布重新可拖拽。
         点开时停掉自动播放 —— 相位说明被地图盖住了，让它在背后自己翻页没有意义。 */
      mapToggle?.addEventListener("click", () => {
        if (center.dataset.mech !== "on") return;
        const open = center.dataset.map !== "open";
        center.dataset.map = open ? "open" : "dock";
        mapToggle.setAttribute("aria-expanded", String(open));
        if (open) stop();
        requestAnimationFrame(() => stage.fit());
      });

      function render(event) {
        stop();
        spec = event?.mechanism && MECHANISM_RENDERERS[event.mechanism.kind] ? event.mechanism : null;
        phases = spec?.phases || [];
        center.dataset.map = "dock";
        mapToggle?.setAttribute("aria-expanded", "false");
        if (!spec || !phases.length) {
          center.dataset.mech = "off";
          if (root) root.hidden = true;
          canvas?.replaceChildren();
          return false;
        }
        center.dataset.mech = "on";
        if (root) root.hidden = false;
        axis.replaceChildren(...phases.map((entry, i) => {
          const tab = document.createElement("button");
          tab.type = "button";
          tab.className = "tab-control-item";
          tab.setAttribute("role", "tab");
          tab.textContent = entry.tag;
          tab.addEventListener("click", () => { stop(); select(i); });
          return tab;
        }));
        phase = 0;
        select(0);
        return true;
      }

      return { render, stop };
    })();

    function renderIncidentArrow(event, topology) {
      const chain = document.getElementById("croIncidentArrowChain");
      if (chain) {
        chain.innerHTML = "";
        String(event.path || "").split(/\s*(?:→|->)\s*/).filter(Boolean).forEach((step) => {
          const li = document.createElement("li");
          li.className = "cro-incident-arrow__step";
          li.textContent = step;
          chain.appendChild(li);
        });
      }
      const via = document.getElementById("croIncidentArrowVia");
      if (!via) return;
      via.innerHTML = "";
      const chips = event.propagation ? roleScopeChips(event.propagation, topology) : [];
      if (!chips.length) return;
      const label = document.createElement("span");
      label.className = "cro-incident-arrow__via-label";
      label.textContent = "途经";
      via.appendChild(label);
      chips.forEach((chip) => {
        const el = document.createElement("span");
        el.className = "cro-incident-arrow__via-chip";
        el.textContent = chip.text;
        via.appendChild(el);
      });
    }

    let incidentDetailMode = "detail";

    function setIncidentDetailMode(mode) {
      incidentDetailMode = mode === "lineage" ? "lineage" : "detail";
      const detailTab = document.getElementById("croIncidentDetailTab");
      const lineageTab = document.getElementById("croIncidentLineageTab");
      const detail = document.getElementById("croIncidentDetail");
      const lineage = document.getElementById("croIncidentLineage");
      const showDetail = incidentDetailMode === "detail";
      detailTab?.classList.toggle("is-selected", showDetail);
      detailTab?.setAttribute("aria-selected", String(showDetail));
      lineageTab?.classList.toggle("is-selected", !showDetail);
      lineageTab?.setAttribute("aria-selected", String(!showDetail));
      if (detail) detail.hidden = !showDetail;
      if (lineage) lineage.hidden = showDetail;
      if (showDetail) requestAnimationFrame(paintDetailChart);
      else requestAnimationFrame(() => lineage?.repaintLineage?.());
    }

    function lineageNodeById(data, id) {
      for (const stage of data.stages) {
        const node = stage.nodes.find((entry) => entry.id === id);
        if (node) return { ...node, stage };
      }
      return null;
    }

    function lineageSelection(data, nodeId, recursive) {
      const selected = new Set(nodeId ? [nodeId] : []);
      if (!nodeId) return selected;
      if (!recursive) {
        data.edges.forEach((edge) => {
          if (edge.from === nodeId) selected.add(edge.to);
          if (edge.to === nodeId) selected.add(edge.from);
        });
        return selected;
      }
      const queue = [nodeId];
      while (queue.length) {
        const current = queue.shift();
        data.edges.forEach((edge) => {
          const adjacent = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
          if (adjacent && !selected.has(adjacent)) {
            selected.add(adjacent);
            queue.push(adjacent);
          }
        });
      }
      return selected;
    }

    function lineageRoleNodeIds(data, roleId) {
      const ids = new Set();
      data.stages.forEach((stage) => {
        stage.nodes.forEach((node) => {
          if (node.id && node.roles.some((role) => role.id === roleId)) ids.add(node.id);
        });
        if (stage.roles.some((role) => role.id === roleId)) {
          stage.nodes.forEach((node) => {
            if (node.id) ids.add(node.id);
          });
        }
      });
      return ids;
    }

    function lineagePathBetween(data, origins, victims) {
      if (!origins.size || !victims.size) return new Set();
      const forward = new Set(origins);
      const forwardQueue = Array.from(origins);
      while (forwardQueue.length) {
        const current = forwardQueue.shift();
        data.edges.forEach((edge) => {
          if (edge.from !== current || forward.has(edge.to)) return;
          forward.add(edge.to);
          forwardQueue.push(edge.to);
        });
      }
      const backward = new Set(victims);
      const backwardQueue = Array.from(victims);
      while (backwardQueue.length) {
        const current = backwardQueue.shift();
        data.edges.forEach((edge) => {
          if (edge.to !== current || backward.has(edge.from)) return;
          backward.add(edge.from);
          backwardQueue.push(edge.from);
        });
      }
      const path = new Set(Array.from(forward).filter((id) => backward.has(id)));
      const hasPathEdge = data.edges.some((edge) => path.has(edge.from) && path.has(edge.to));
      return hasPathEdge ? path : new Set();
    }

    function renderLineageInspector(host, data, nodeId, pinned) {
      host.replaceChildren();
      const node = nodeId ? lineageNodeById(data, nodeId) : null;
      if (!node) {
        host.hidden = true;
        return;
      }

      const incoming = data.edges.filter((edge) => edge.to === nodeId);
      const outgoing = data.edges.filter((edge) => edge.from === nodeId);
      if (!incoming.length && !outgoing.length) {
        host.hidden = true;
        return;
      }
      host.hidden = false;
      const connectedText = (edges, side) => edges.length
        ? edges.map((edge) => lineageNodeById(data, edge[side])?.name).filter(Boolean).join("、")
        : "无直接节点";
      const reasons = Array.from(new Set([...incoming, ...outgoing].map((edge) => edge.label)));

      const heading = document.createElement("div");
      heading.className = "cro-incident-lineage__inspector-heading";
      const title = document.createElement("strong");
      title.textContent = node.name;
      const state = document.createElement("span");
      state.textContent = pinned ? "路径已固定" : "当前悬浮";
      heading.append(title, state);

      const grid = document.createElement("dl");
      grid.className = "cro-incident-lineage__inspector-grid";
      const add = (label, value) => {
        const cell = document.createElement("div");
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        cell.append(dt, dd);
        grid.appendChild(cell);
      };
      add("所在层", node.stage.title);
      add("直接输入", connectedText(incoming, "from"));
      add("直接输出", connectedText(outgoing, "to"));
      add("转换依据", reasons.length ? `${reasons.join(" / ")}；${node.detail}` : node.detail);
      host.append(heading, grid);
    }

    function paintIncidentLineageEdges(shell, svg, data, initialSelection = new Set()) {
      const width = shell.offsetWidth;
      const height = shell.offsetHeight;
      if (!width || !height) return;
      svg.replaceChildren();
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const shellRect = shell.getBoundingClientRect();
      const scaleX = shellRect.width / width || 1;
      const scaleY = shellRect.height / height || 1;
      const nodes = new Map(Array.from(shell.querySelectorAll("[data-lineage-id]"))
        .map((element) => [element.dataset.lineageId, element]));
      const labels = [];
      data.edges.forEach((edge) => {
        const source = nodes.get(edge.from);
        const target = nodes.get(edge.to);
        if (!source || !target) return;
        const a = source.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const x1 = (a.right - shellRect.left) / scaleX;
        const y1 = (a.top + a.height / 2 - shellRect.top) / scaleY;
        const x2 = (b.left - shellRect.left) / scaleX;
        const y2 = (b.top + b.height / 2 - shellRect.top) / scaleY;
        const bend = Math.max(12, (x2 - x1) * 0.5);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
        path.classList.add("cro-incident-lineage__edge", `is-${edge.kind}`);
        path.dataset.from = edge.from;
        path.dataset.to = edge.to;
        const isInitiallyActive = initialSelection.has(edge.from) && initialSelection.has(edge.to);
        path.classList.toggle("is-active", isInitiallyActive);
        path.classList.toggle("is-muted", initialSelection.size > 0 && !isInitiallyActive);
        svg.appendChild(path);

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.classList.add("cro-incident-lineage__edge-label");
        label.setAttribute("x", String((x1 + x2) / 2));
        label.setAttribute("y", String((y1 + y2) / 2 - 5));
        label.setAttribute("text-anchor", "middle");
        label.dataset.from = edge.from;
        label.dataset.to = edge.to;
        label.textContent = edge.label;
        label.classList.toggle("is-active", isInitiallyActive);
        labels.push(label);
      });
      labels.forEach((label) => svg.appendChild(label));
    }

    function appendIncidentLineageRoleTags(host, roles) {
      (roles || []).forEach((role) => {
        const tag = document.createElement("span");
        tag.className = `cro-incident-lineage__role-tag is-${role.id}`;
        tag.textContent = role.label;
        tag.title = role.id === "origin"
          ? "当前事件的传播源"
          : "当前事件中受影响的对象";
        host.appendChild(tag);
      });
    }

    function renderIncidentLineage(host, event, topology) {
      if (!host) return;
      host.replaceChildren();
      const data = buildIncidentLineage(event, topology);

      const trackShell = document.createElement("div");
      trackShell.className = "cro-incident-lineage__track-shell";
      const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      edgeLayer.classList.add("cro-incident-lineage__edges");
      edgeLayer.setAttribute("aria-hidden", "true");
      const track = document.createElement("ol");
      track.className = "cro-incident-lineage__track";
      data.stages.forEach((stage, stageIndex) => {
        const item = document.createElement("li");
        item.className = `cro-incident-lineage__stage${stage.available ? " is-available" : " is-dimmed"}`;
        item.dataset.stage = stage.id;

        const head = document.createElement("div");
        head.className = "cro-incident-lineage__stage-head";
        const index = document.createElement("span");
        index.className = "cro-incident-lineage__stage-index";
        index.textContent = String(stageIndex + 1).padStart(2, "0");
        const heading = document.createElement("div");
        const titleRow = document.createElement("div");
        titleRow.className = "cro-incident-lineage__stage-title-row";
        const stageTitle = document.createElement("h3");
        stageTitle.className = "cro-incident-lineage__stage-title";
        stageTitle.textContent = stage.title;
        titleRow.appendChild(stageTitle);
        appendIncidentLineageRoleTags(titleRow, stage.roles);
        const system = document.createElement("p");
        system.className = "cro-incident-lineage__stage-system";
        system.textContent = stage.system;
        heading.append(titleRow, system);
        head.append(index, heading);
        item.appendChild(head);

        const nodes = document.createElement("div");
        nodes.className = "cro-incident-lineage__nodes";
        stage.nodes.forEach((node) => {
          const nodeEl = document.createElement("article");
          nodeEl.className = "cro-lineage-node";
          const hasCrossStageEdge = node.id && data.edges.some(
            (edge) => edge.from === node.id || edge.to === node.id,
          );
          if (hasCrossStageEdge) {
            nodeEl.dataset.lineageId = node.id;
            nodeEl.tabIndex = 0;
            nodeEl.setAttribute("role", "button");
            nodeEl.setAttribute("aria-pressed", "false");
            const roleText = node.roles.length ? `，${node.roles.map((role) => role.label).join("、")}` : "";
            nodeEl.setAttribute("aria-label", `${stage.title}：${node.name}${roleText}。悬浮查看直接上下游，点击固定关联路径。`);
          }
          const name = document.createElement("div");
          name.className = "cro-lineage-node__name";
          name.textContent = node.name;
          name.dataset.tip = stage.available
            ? (LINEAGE_NODE_NAME_TIPS[stage.id] || "当前血缘层的节点名称。")
            : "本事件没有定位到该层，因此这里保留链条位置并暗化。";
          const nameRow = document.createElement("div");
          nameRow.className = "cro-incident-lineage__node-name-row";
          nameRow.appendChild(name);
          appendIncidentLineageRoleTags(nameRow, node.roles);
          nodeEl.appendChild(nameRow);
          if (node.id) {
            const id = document.createElement("code");
            id.className = "cro-lineage-node__id";
            id.textContent = node.id;
            id.dataset.tip = LINEAGE_NODE_ID_TIP;
            // ID 的点击下钻尚未上线，先阻止它冒泡成“固定整张卡片路径”。
            id.addEventListener("click", (clickEvent) => clickEvent.stopPropagation());
            nodeEl.appendChild(id);
          }
          const detail = document.createElement("p");
          detail.className = "cro-lineage-node__detail";
          detail.textContent = node.detail;
          nodeEl.appendChild(detail);
          nodes.appendChild(nodeEl);
        });
        item.appendChild(nodes);
        track.appendChild(item);
      });
      trackShell.append(edgeLayer, track);
      const inspector = document.createElement("section");
      inspector.className = "cro-incident-lineage__inspector";
      inspector.setAttribute("aria-live", "polite");
      inspector.hidden = true;
      host.append(trackShell, inspector);

      const defaultOrigins = lineageRoleNodeIds(data, "origin");
      const defaultVictims = lineageRoleNodeIds(data, "victim");
      const defaultSelection = lineagePathBetween(data, defaultOrigins, defaultVictims);
      let pinnedId = null;
      const paintSelection = (selected, nodeId = null, pinned = false) => {
        host.classList.toggle("is-tracing", selected.size > 0);
        track.querySelectorAll("[data-lineage-id]").forEach((element) => {
          const isActive = element.dataset.lineageId === nodeId;
          const isRelated = selected.has(element.dataset.lineageId);
          element.classList.toggle("is-lineage-active", isActive);
          element.classList.toggle("is-lineage-related", isRelated && !isActive);
          element.classList.toggle("is-lineage-muted", selected.size > 0 && !isRelated);
          element.setAttribute("aria-pressed", String(Boolean(pinnedId && element.dataset.lineageId === pinnedId)));
        });
        edgeLayer.querySelectorAll(".cro-incident-lineage__edge").forEach((edge) => {
          const active = selected.has(edge.dataset.from) && selected.has(edge.dataset.to);
          edge.classList.toggle("is-active", active);
          edge.classList.toggle("is-muted", selected.size > 0 && !active);
        });
        edgeLayer.querySelectorAll(".cro-incident-lineage__edge-label").forEach((label) => {
          const active = selected.has(label.dataset.from) && selected.has(label.dataset.to);
          label.classList.toggle("is-active", active);
        });
        // 悬浮只做原位高亮，不能展开下方检查区：检查区改变容器高度后会让指针
        // 反复进出卡片，造成详情、高亮与连线一起闪烁。只有点击固定路径才显示详情。
        renderLineageInspector(inspector, data, pinned ? nodeId : null, pinned);
      };
      const applyDefault = () => paintSelection(
        defaultSelection,
        null,
        false,
      );
      const applySelection = (nodeId, recursive, pinned = false) => {
        const hasCrossStageEdge = nodeId && data.edges.some((edge) => edge.from === nodeId || edge.to === nodeId);
        if (nodeId && !hasCrossStageEdge) nodeId = null;
        paintSelection(lineageSelection(data, nodeId, recursive), nodeId, pinned);
      };

      track.querySelectorAll("[data-lineage-id]").forEach((nodeEl) => {
        const restore = () => pinnedId
          ? applySelection(pinnedId, true, true)
          : applyDefault();
        const hasCrossStageEdge = data.edges.some(
          (edge) => edge.from === nodeEl.dataset.lineageId || edge.to === nodeEl.dataset.lineageId,
        );
        const preview = () => hasCrossStageEdge
          ? applySelection(nodeEl.dataset.lineageId, false, false)
          : restore();
        const togglePin = () => {
          if (!hasCrossStageEdge) return;
          pinnedId = pinnedId === nodeEl.dataset.lineageId ? null : nodeEl.dataset.lineageId;
          if (pinnedId) applySelection(pinnedId, true, true);
          else applyDefault();
        };
        nodeEl.addEventListener("pointerenter", preview);
        nodeEl.addEventListener("pointerleave", restore);
        nodeEl.addEventListener("focus", preview);
        nodeEl.addEventListener("blur", restore);
        nodeEl.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          togglePin();
        });
        nodeEl.addEventListener("keydown", (keyEvent) => {
          if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
          keyEvent.preventDefault();
          togglePin();
        });
      });
      trackShell.addEventListener("click", () => {
        pinnedId = null;
        applyDefault();
      });
      host.addEventListener("keydown", (keyEvent) => {
        if (keyEvent.key !== "Escape") return;
        pinnedId = null;
        applyDefault();
      });
      host.repaintLineage = () => {
        // 刷新后默认页签是“事件详情”，此时血缘面板 hidden，首次量宽高会得到 0。
        // 页签真正可见时必须重画；若用户已固定卡片，则保留固定路径。
        const selection = pinnedId
          ? lineageSelection(data, pinnedId, true)
          : defaultSelection;
        paintIncidentLineageEdges(trackShell, edgeLayer, data, selection);
        if (pinnedId) applySelection(pinnedId, true, true);
        else applyDefault();
      };
      requestAnimationFrame(() => host.repaintLineage());
    }

    /* 中区两张角色卡 + 下区事件内涵。第 6–8 项接入下区图表。 */
    function renderIncidentView(event) {
      const topology = controller.topology;
      // 机制图先渲：它决定中区是「机制图 + 右下角地图」还是老样子的满铺传播图
      mech.render(event);
      renderIncidentArrow(event, topology);
      // 事件 focus 指向具体算子时（如 p1-root 的 Router gate），把那根算子条也
      // 点亮——四域里这件事原来由整网 deck 承担，现在结构条是唯一的层内算子视图。
      const focusBar = event.focus?.kind === "segment" && event.focus.bar
        ? { segment: event.focus.segment, bar: event.focus.bar }
        : null;
      /* 根因与影响就是这两个角色各自「发生了什么」，接在各自第一行的范围 chip 后面，
         与 chip 合成一句「谁 · 怎么了」。它们原先在横幅桥接句和下区各出现过一次，
         现在全页只在这里。 */
      renderRoleDomains(document.getElementById("croOriginDomains"), event.origin, topology,
        { focusBar, summary: event.root });
      renderRoleDomains(document.getElementById("croVictimDomains"), event.victim, topology,
        { summary: event.impact });
      renderIncidentDetail(document.getElementById("croIncidentDetail"), event);
      renderIncidentLineage(document.getElementById("croIncidentLineage"), event, topology);
      setIncidentDetailMode(incidentDetailMode);
      // 舞台尺寸随事件变（涉及的域不同，高度差一大截），每次换事件重新适配一次
      requestAnimationFrame(() => stage.fit());
    }

    /* ── 下区 · 问题详情 ───────────────────────────────────────────────────
       中区回答「打到了谁」，这里回答「这件事本身是什么」。左边一张证据图，右边
       一句结论 + 几个关键读数 —— 结论与读数是同一件事的两种粒度（一句话 / 几个
       数），放在一起与图形成左右对读。根因与影响不在这里，它们跟在画布上两个角色
       的标题下面。 */
    let detailChart = null;   // { host, spec } —— 图表按宿主实测宽度重画，见 paintDetailChart

    function renderIncidentDetail(host, event) {
      if (!host) return;
      host.innerHTML = '';
      detailChart = null;
      const evidence = event.evidence;
      if (!evidence?.chart) return;

      const grid = document.createElement('div');
      grid.className = 'cro-incident-detail__grid';

      const figure = document.createElement('figure');
      figure.className = 'cro-figure';
      const caption = document.createElement('figcaption');
      caption.className = 'cro-figure__caption';
      caption.textContent = evidence.chart.title;
      figure.appendChild(caption);
      /* 图表按宿主的实际像素宽度出图，viewBox 宽度 = CSS 宽度 → 缩放比恒为 1：
         柱子粗细、字号、行高都是设计值本身，不会被「SVG 按比例放大填满容器」
         连带撑高，下区也就不会为了一张 12 行的图冒出滚动条。 */
      const chartHost = document.createElement('div');
      chartHost.className = 'cro-figure__chart';
      figure.appendChild(chartHost);
      detailChart = { host: chartHost, spec: evidence.chart };
      if (evidence.chart.note) {
        const note = document.createElement('p');
        note.className = 'cro-figure__note';
        note.textContent = evidence.chart.note;
        figure.appendChild(note);
      }
      grid.appendChild(figure);

      const aside = document.createElement('div');
      aside.className = 'cro-incident-detail__aside';
      if (event.conclusion) {
        const conclusion = document.createElement('p');
        conclusion.className = 'cro-incident-detail__conclusion';
        conclusion.textContent = event.conclusion;
        aside.appendChild(conclusion);
      }
      if (evidence.metrics?.length) {
        const list = document.createElement('dl');
        list.className = 'cro-readout';
        evidence.metrics.forEach((metric) => {
          const row = document.createElement('div');
          row.className = 'cro-readout__row';
          const dt = document.createElement('dt');
          dt.textContent = metric.label;
          const dd = document.createElement('dd');
          dd.textContent = metric.value;
          if (metric.tone) dd.dataset.tone = metric.tone;
          row.append(dt, dd);
          list.appendChild(row);
        });
        aside.appendChild(list);
      }
      grid.appendChild(aside);
      host.appendChild(grid);
      requestAnimationFrame(paintDetailChart);
    }

    /* 图按宿主的实测宽高出图。高度预算 = 下区可用净高 − figure 里图表之外的部分
       （图题 + 读法那两行）。小屏下预算变小，各图各自的收敛方式不同：
         line     —— 压扁（趋势靠横向读，压矮不失真）
         stack    —— 不吃预算（DOM 构成条本来就只有一条 pill + 几行直标，够矮）
         bars     —— 条目多就整个换成竖排柱，高度不再随条目数长
         capacity —— 盒子高度按预算取（148–260px），SVG 自己等比缩放
       目的只有一个：这一栏不出滚动条。 */
    function paintDetailChart() {
      if (!detailChart) return;
      const { host, spec } = detailChart;
      const build = CHART_BUILDERS[spec.kind];
      if (!build || !host.isConnected) return;
      const width = Math.max(280, Math.round(host.clientWidth || 560));
      const body = host.closest(".cro-incident-detail__body");
      const figure = host.closest(".cro-figure");
      // figure 当前高度里除掉图表自身，剩下的就是图题 + 读法 + 内边距的固定开销
      const overhead = figure ? Math.max(0, figure.offsetHeight - host.offsetHeight) : 60;
      const budget = Math.round(Math.max(96, (body?.clientHeight || 260) - overhead - 8));
      // 第四参 host：等距容器要在一个**已挂到文档上**的节点上解析 var(--token)，
      // 其余 builder 用不到，多传一个参数无害。
      host.replaceChildren(build(spec, width, budget, host));
    }

    function selectIncident(event) {
      activeIncident = event;
      const topology = controller.topology;
      relation = addIncidentScope(resolveRelation(topology, { ...event.focus, incidentId: event.id }), event, topology);
      setIncidentLayout(true);
      renderIncidentView(event);
      const banner = document.getElementById("croIncidentBanner");
      if (banner) banner.hidden = false;
      setText("croIncidentBannerTag", event.code);
      setText("croIncidentBannerMessage", event.banner || event.path || event.title);
      document.querySelectorAll(".cro-event").forEach((button) => {
        const selected = button.dataset.eventId === event.id;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      document.dispatchEvent(new CustomEvent("cro:incident", { detail: { event, relation } }));
    }

    function renderIncidentRail() {
      const host = document.getElementById("croEventGroups");
      if (!host) return;
      host.innerHTML = "";
      INCIDENT_GROUPS.forEach((group) => {
        const section = document.createElement("section");
        const expandedByDefault = group.id === "problem-1" || group.id === "problem-2";
        section.className = `cro-event-group${expandedByDefault ? " is-expanded" : ""}`;
        section.innerHTML = `
          <button class="cro-event-group__toggle" type="button" aria-expanded="${expandedByDefault}">
            <span class="cro-event-group__toggle-main">
              <svg class="cro-event-group__chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4"></path></svg>
              <span class="cro-event-group__name">${group.name}</span>
            </span>
          </button>
          <div class="cro-event-list"></div>`;
        const toggle = section.querySelector(".cro-event-group__toggle");
        toggle.addEventListener("click", () => {
          const expanded = !section.classList.contains("is-expanded");
          section.classList.toggle("is-expanded", expanded);
          toggle.setAttribute("aria-expanded", String(expanded));
        });
        const list = section.querySelector(".cro-event-list");
        group.events.forEach((event, index) => {
          event.context = group.context;
          // 事件编号 = 问题线号.本组内序号，如「问题1.3」。组号取自 group.id
          // （problem-1 / problem-2），与组名里的数字同源，不另立一份。
          event.code = `问题${group.id.replace("problem-", "")}.${index + 1}`;
          event.banner = group.bridge(event);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "cro-event";
          button.dataset.eventId = event.id;
          button.setAttribute("aria-pressed", "false");
          button.innerHTML = `
            <span class="cro-event__index">${String(index + 1).padStart(2, "0")}</span>
            <span>
              <span class="cro-event__name">${event.title}</span>
              <span class="cro-event__dimension">${event.dimension}</span>
            </span>
            <span class="cro-event__time">${event.time}</span>`;
          button.addEventListener("click", () => selectIncident(event));
          list.appendChild(button);
        });
        host.appendChild(section);
      });
    }

    /* select:false 只翻栏宽、不动选择 —— 给「顺手收起」的调用方用（起播、关闭
       事件横幅）。它们各自已经把选择处理妥当了：起播要留着 relation 供退出时
       还原，横幅关闭自己就调了 clearSelection，这里再来一次会把刚定好的状态
       又推翻一遍。rail 键本身仍走默认的 true。 */
    function setEventRailCollapsed(collapsed, { select = true } = {}) {
      const workarea = document.querySelector(".pto-ide-frame__workarea");
      workarea?.classList.toggle("is-event-rail-collapsed", collapsed);
      document.getElementById("navRelationEvents")?.setAttribute("aria-pressed", String(!collapsed));
      if (select) {
        if (collapsed) clearSelection();
        else selectIncident(INCIDENT_GROUPS[0].events[0]);
      }
      // 侧栏宽度不再走过渡（见 css 里 .cro-event-rail 的说明），class 翻转后
      // 宽度即已确定。下一帧读一次几何就够，不必再等一个动画时长。
      cancelAnimationFrame(railLayoutTimer);
      railLayoutTimer = requestAnimationFrame(() => {
        // 栏宽一翻，板面横向差 250 多像素：集群矩阵的列轨是固定像素写死的，
        // 不在这儿补量就会一直按翻转前的宽度挤着（见 resyncClusterGeometry）。
        resyncClusterGeometry();
        layoutLayerNav(layerNav);
        redrawLinks();
      });
    }

    /* 补量一次格宽/格高（不重建那 2048 个格子，只改 grid-template-columns 与一条
       CSS 变量）。renderCluster 是在刚清空的矩阵上量的宽度，那一刻 .cro-cluster__grid
       还没有纵向滚动条；铺完之后若因为几何误差冒出一条，block 的可用宽度就窄了
       一条滚动条 —— 补量把它纠回来。
       growHeight:false 用在 renderCluster 之后的那两处：那时格高已经按终局视口
       算过一次了，再让它涨只会溢出（见 syncCellWidth 的注释）。 */
    const refitClusterCells = (opts) => {
      const heat = document.getElementById("croHeat");
      if (!heat || !heat.dataset.epRows) return;   // 无矩阵（配置非法/超格数上限）时不管
      const counts = controller.topology.counts;
      const epRows = Number(heat.dataset.epRows) || 1;
      syncCellWidth(heat, Math.ceil(counts.ep / epRows), counts, epRows, opts);
    };

    /* 版面尺寸变了之后把矩阵重新对齐到新视口：先定两行高度（只看 arch 的内容
       需求），再看折行数要不要改 —— 改了只能重建（行数是建 DOM 时定的），没改
       就只补量格宽/格高。窗口 resize 与事件栏折叠/展开（栏宽 292px ⇄ 40px，板面
       横向差 250 多像素）走同一条通路：syncCellWidth 写进 block 的是**固定像素**
       的列轨，板面一变宽而不补量，每个 stage 块的格子就还挤在原来那点宽度里、
       右边空出一道缝，矩阵下方也留白 —— 就是「首屏排布畸形、切一次模型（走
       onChange 整条重铺）反而规整」的由来。 */
    const resyncClusterGeometry = () => {
      syncBoardRows(controller.topology.counts);
      const heat = document.getElementById("croHeat");
      if (!heat || !heat.dataset.epRows) return;   // 无矩阵（配置非法/超格数上限）时不管
      const epRows = pickEpRows(heat, controller.topology.counts);
      if (String(epRows) !== heat.dataset.epRows) { rebuildCluster(); return; }
      refitClusterCells();
    };

    controller.onChange((topology) => {
      // 配置非法时不重建 deck，保留上一版可读的图，错误信息由 #croConfigError 承担
      if (topology.valid || !deck?.controller) deck?.build(topology);
      // deck 可能整棵重建了，去重缓存记的是旧 DOM 的状态，作废
      deckFrontLayer = null;
      deckNodeKey = null;
      // deck 的语义色变量搬到 board 上，结构条 bar 与整网节点取到同一个色值
      syncPalette();
      // 稠密模型（无 MoE）：整块 MoE 区收起，Model Architecture 撑到右侧（见 css 的 .is-no-moe）
      document.getElementById("croBoard")?.classList.toggle("is-no-moe", !topology.hasMoe);
      renderLayerNav(layerNav, topology, emitSelect);
      renderStructure(structure, topology, emitSelect);
      renderMoe(
        document.getElementById("croSharedExperts"),
        document.getElementById("croRoutedExperts"),
        topology, emitSelect,
      );
      /* 次序要紧：两行的高度先定 —— 它只看 Model Architecture 的内容需求，与矩阵
         无关（见 syncBoardRows 的注释），所以不必等矩阵铺完。定完之后 Cluster 那
         一行的视口高度才是终局值，renderCluster 照着它算折几行、格子多高，铺出来
         正好填满，既不留白也不溢出。 */
      syncBoardRows(topology.counts);
      renderCluster(document.getElementById("croHeat"), topology, emitSelect);
      refitClusterCells({ growHeight: false });
      if (activeIncident) requestAnimationFrame(() => selectIncident(activeIncident));
      else if (relation) reapplySelection(topology);
    });

    /* 整网视图切档（见 html 的 croNetView）。四域里只有 Cluster 需要重建：
       其余三块的差异纯粹是显示/隐藏与排布，CSS 就够；而集群矩阵的 epRows
       是建 DOM 时定的行数（见 renderCluster），改不了类就改不了。
       重建会连带清掉格子上的 is-related / is-selected，随后按当前选择重铺一次。 */
    const rebuildCluster = () => {
      const topology = controller.topology;
      syncBoardRows(topology.counts);   // 同上：先定行高，矩阵再照着终局视口铺
      renderCluster(document.getElementById("croHeat"), topology, emitSelect);
      refitClusterCells({ growHeight: false });
      if (activeIncident) requestAnimationFrame(() => selectIncident(activeIncident));
      else if (relation) reapplySelection(topology);
    };

    document.addEventListener("cro:view", rebuildCluster);

    /* 窗口一变，两行的分配与矩阵的几何都要跟着重算，而且**必须按这个次序**：
       先定行高（只看 arch 的内容需求），Cluster 那一行的视口高度才是终局值；
       折几行（pickEpRows）与格子多高（verticalCellHeight）都是照着它算的。
       曾经写成两条各自防抖的监听，谁先跑取决于注册次序，结果矩阵按旧行高量完
       几何、行高才改 —— 合成一条就没有这个隐式依赖了。
       net-view / YAML 视图切换也走这条通路（见 html 内联脚本与
       config-relation-yaml.js 里各自那句 window.dispatchEvent(new Event("resize")))。
       行数是建 DOM 时定的，改不了类就改不了，只有重建一途；但重建动辄 2048 个
       格子，不能每帧都来，所以先算一遍目标行数，跟当前渲染的一样就只调样式。 */
    let clusterResizeTimer = 0;
    global.addEventListener("resize", () => {
      clearTimeout(clusterResizeTimer);
      clusterResizeTimer = setTimeout(resyncClusterGeometry, 180);
    });

    /* ── 版面自己变了（不是窗口变了）：「高级选项」折叠一开一合 ──────────────
       它把**它下面的所有东西整块平移**一行的高度。Cluster 那一枚尤其明显：
       矩阵直接上下挪一整行。要补的正是窗口 resize 那两件事，一件都不能省：
         · 关系图的连线画在 viewport 坐标上，不重画就还连在旧位置 ——
           与滚动、窗口缩放同一类位移，那两处早有处理（见下面 scroll/wheel 与
           resize 两条），折叠是第三处；
         · 收起腾出来的那截高度得让矩阵吃掉，否则 Cluster 区下面白着一条 ——
           走的就是事件栏折叠那条同样的补量（resyncClusterGeometry）。
       **不防抖**：这是一次确定的、一步到位的版面变化，不是 resize 那种连续事件，
       180ms 的防抖只会让矩阵慢半拍才长开。rAF 一帧是为了等 [hidden] 生效后再量。
       事件由 createController 的 setAdvancedOpen 发 —— 控制器不认识矩阵，也不该
       认识；这里是唯一知道「版面变了要补什么」的地方。 */
    document.addEventListener("cro:layout", () => requestAnimationFrame(() => {
      resyncClusterGeometry();
      /* 连线要等矩阵**落定**再画，所以隔一帧：resyncClusterGeometry 有一条会走
         rebuildCluster 的分支（腾出来的高度可能让 EP 折行数都变了 —— 折几行是
         按可用高度算的），而重建之后还有一次 rAF 里的补量。同一帧里画就画在了
         中间态上。一次点击晚一帧看不出来，画错位置看得出来。 */
      requestAnimationFrame(redrawLinks);
    }));

    // 列宽随窗口变化，PP 带的实测定位要跟着重排
    if (layerNav && global.ResizeObserver) {
      let pending = 0;
      new ResizeObserver(() => {
        clearTimeout(pending);
        pending = setTimeout(() => {
          layoutLayerNav(layerNav);
        }, 48);
      }).observe(layerNav);
    }
    // 主题切换会重算 deck 调色板，重新搬一次
    document.addEventListener("cro:theme", syncPalette);
    /* 等距容器图（chart.kind = "capacity"）的三个面明暗是建图时按 token 值算死写进
       SVG 的，不像其余图那样靠 CSS 类跟主题走 —— 换主题得整幅重画。 */
    document.addEventListener("cro:theme", () => {
      if (detailChart && detailChart.spec.kind === "capacity") requestAnimationFrame(paintDetailChart);
    });

    /* ── 连线是画在 viewport 坐标上的，任何位移都要重画 ── */
    ["scroll", "wheel"].forEach((type) => {
      document.addEventListener(type, () => requestAnimationFrame(redrawLinks), { passive: true, capture: true });
    });
    global.addEventListener("resize", () => requestAnimationFrame(() => {
      redrawLinks();
      // 画布里的刻度带宽度也是实测出来的（board 那份有 ResizeObserver），
      // 重排完再按新视口重新适配一次
      document.querySelectorAll("#croIncidentView .cro-layer-nav").forEach((nav) => layoutLayerNav(nav));
      if (activeIncident) {
        stage.fit();
        paintDetailChart();   // 证据图按新宽度重画（它不靠 SVG 缩放去适应容器）
      }
    }));
    // deck 自己的拖拽/缩放会挪动被选中的节点
    document.getElementById("croDeckHost")?.addEventListener("pointermove", () => {
      if (relation) requestAnimationFrame(redrawLinks);
    }, { passive: true });

    /* ── 清空选择：Esc，或点击 board 空白处 ── */
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (relation) clearSelection();
    });
    /* 挂在 document 而不是 board：点顶栏、activity rail、集群右侧留白这些
       board 之外的地方也要能清空。命中任一可选对象则不清。 */
    const SELECTABLE = [
      ".cro-tick", ".cro-pp-span", ".cro-bar", ".cro-expert", ".cro-moe-group",
      ".cro-structure__col",
      ".twin-heat-cell", ".pto-model-deck__node", ".pto-model-deck__experts",
      // 单卡容量栏：点 stage 小柱是「选中该 stage 首卡」，不是点空白。
      // 口径浮层被挂到 body 上（避开 pane 的 overflow/backdrop-filter），不在
      // .cro-capacity 子树里，得单独列一条，否则点它选中文字会清掉当前选择。
      ".cro-capacity", ".cro-capacity__basis",
      // 说明气泡同理：它也挂在 body 上，不在任何一个白名单子树里 —— 在里面
      // 拖选文案不该顺手把当前选择清掉（问号本身由下面那条前置守卫统一挡掉，
      // 它可能挂在 stepper 上，也可能挂在某个小节标题上）
      ".cro-hint-bubble",
      // YAML 视图的代码框：在里面拖选文本、点复制键都不是「点空白」
      ".cro-region--yaml",
      // .cro-ep-mode 与 .cro-stepper 同理：EP 口径开关是配置控件而不是画布空白
      ".pto-model-deck__side-rule", ".cro-stepper", ".cro-ep-mode", ".cro-event", ".pto-ide-frame__topbar",
    ].join(", ");
    document.addEventListener("click", (event) => {
      if (!relation) return;
      /* 说明问号与气泡不参与选择：它们只是「这是什么」的开合，点一下不该把当前
         选择或正在调查的事件关掉。放在最前面单独挡掉，位置就无所谓了 —— 问号既可能
         挂在 stepper 上（落在白名单里），也可能挂在某个小节标题上（不落在里面）；
         而下面事件态那一支又是按「点到任意 button 就算离开」判的。 */
      if (event.target.closest?.(".cro-hint, .cro-hint-bubble")) return;
      // 运行事件是一次显式调查上下文：点击画布空白不应误退出。只有横幅关闭键
      // 或其他可响应对象触发新的选择时，才结束当前事件关系。
      if (activeIncident) {
        // 整条运行事件栏都不算「离开当前事件」：除了事件条目本身，分组标题
        // （.cro-event-group__toggle）和收起键也都是 <button>，只判 .cro-event
        // 会让它们掉进下面那条通用 button 分支 —— 点一下展开箭头就白跑一整轮
        // applyRelation（2048 格 + 256 专家）＋ deck 反选 ＋ 连线重画 ＋ 横幅
        // 收起（又改变 board 高度再触发一次全量重排）。
        if (event.target.closest?.(".cro-event-rail")) return;
        // 事件详情视图本身也不算「离开当前事件」：角色卡里重建的那几个域是只读
        // 证据（按钮已被 pointer-events 挡掉），点到它们不该把详情关掉。
        if (event.target.closest?.("#croIncidentView")) return;
        if (event.target.closest?.("button, select, input, [role='button']")) clearSelection();
        return;
      }
      if (!event.target.closest?.(SELECTABLE)) clearSelection();
    });

    /* 页面里写死在 html 上的那几处 data-hint（MoE 那三档 EP 口径）不经过 buildHint，
       在这里补挂一次委托；重复调用是幂等的。 */
    installHints();

    global.croObserver = controller;
    global.croDeck = deck;
    global.croSelect = emitSelect;
    global.croSelectIncident = selectIncident;
    renderIncidentRail();
    document.getElementById("croIncidentDetailTab")?.addEventListener("click", () => {
      setIncidentDetailMode("detail");
    });
    document.getElementById("croIncidentLineageTab")?.addEventListener("click", () => {
      setIncidentDetailMode("lineage");
    });
    document.querySelector(".cro-incident-detail__tabs")?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = incidentDetailMode === "detail" ? "lineage" : "detail";
      setIncidentDetailMode(next);
      document.getElementById(next === "detail" ? "croIncidentDetailTab" : "croIncidentLineageTab")?.focus();
    });
    document.getElementById("croEventRailCollapse")?.addEventListener("click", () => setEventRailCollapsed(true));
    document.getElementById("croEventRailExpand")?.addEventListener("click", () => setEventRailCollapsed(false));
    /* 关闭事件横幅 = 结束这次调查，回配置仿真态。事件栏跟着收起：留着它等于
       还在「挑事件看」的上下文里，而横幅一关四域就接管了整块画布，那份列表
       只是在左边占宽。select:false —— clearSelection 上一行刚调过。 */
    document.getElementById("croIncidentBannerClose")?.addEventListener("click", () => {
      clearSelection();
      setEventRailCollapsed(true, { select: false });
    });
    document.getElementById("navRelationEvents")?.addEventListener("click", () => {
      const workarea = document.querySelector(".pto-ide-frame__workarea");
      setEventRailCollapsed(!workarea?.classList.contains("is-event-rail-collapsed"));
    });
    /* 深链接:聚光灯定位链「查看事件影响范围」按 ?event=<id> 从别的问题页跳过来,
       命中就直接选中该运行事件、进事件详情。
       没带参数时**留在配置关系态**:这一页的主业是四域关系图与配置仿真,自动展开
       第一个事件等于替用户做了一次他没提的调查——一进来就是某次故障的详情,四域
       整块被顶掉,反倒要先关掉横幅才能看正事。事件栏一并收起(与关闭事件横幅同一
       套处理:留着它等于还在「挑事件看」的上下文里),左侧那条竖标签随时能展开。 */
    const requestedEventId = new URLSearchParams(global.location.search).get("event");
    const requestedEvent = requestedEventId
      ? INCIDENT_GROUPS.flatMap((group) => group.events).find((event) => event.id === requestedEventId)
      : null;
    /* ⚠️ 收栏必须**先于** controller.refresh()：事件栏 292px ⇄ 40px 一翻，板面
       宽度差 250 多像素，而首帧那次 renderCluster / syncCellWidth 把列轨按当时
       的宽度写成了固定像素。先铺矩阵再收栏，矩阵就一直按「栏还开着」的窄宽度
       挤在每个 stage 块的左半边、下方也留白（首屏那个畸形排布）；随便切一次
       模型走完整条 onChange 才会按终局宽度重铺，于是「切走再切回来就好看了」。
       现在把版面先摆到终局态，第一次铺就是对的。
       带 ?event= 进来时保持 HTML 里的展开态，交给下面的 selectIncident。 */
    if (!requestedEvent) {
      // select:false —— 此刻还没有任何选择,不必再走一次 clearSelection
      setEventRailCollapsed(true, { select: false });
    }
    controller.refresh();
    if (requestedEvent) requestAnimationFrame(() => selectIncident(requestedEvent));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window);
