/* openPangu-2.0-Flash MoE 计算轴架构图 · 图数据 builder
   Source visualization object:
   /Users/yin/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_modelviz.html

   只画健康拓扑。布局对齐 model-graphviz / DeepSeek V3.2：单列从上到下、禁止折叠模块间多条平行代表边。

   设计约定（本轮重构）：
   - 节点 label 只用专业/学术名称；解释性说明放 node.desc（页面侧 hover tip 展示），不进 label。
   - 路由专家 / 共享专家 = 块内左右并列两条泳道，共同汇入 All-to-All 汇聚（DeepSeek moe_combine 范式）。
   - 连线几何：引擎按 |Δy| >= |Δx| 判定竖直（pattern.js:323）→ 所有前向边保证竖直落差 >= 水平偏移，
     从顶/底进出，不连侧面；权重边（dashed parameter）允许从侧面进。
   - 两级折叠：L1 moeExpanded（MoE 层折叠盒 ↔ 展开内部）；L2 expertExpanded（路由专家代表节点 ↔ EP 桶）。
   - 256 路由专家 = openPangu-2.0-Flash schema 的 E=256，当前 demo runtime 按 EP2 桶 × 128 展示。
     EP 桶是「这一层 256 专家的运行时切分」，
     不是 2 个层、也不等于 2 张卡 —— 页面侧用细粒度点阵展示 256 个专家。
   - All-to-All 只用代表边；需抑制标签的通信边用 tag:' '（引擎 trim 后为空 → 跳过绘制）。 */
window.buildOpenPanguFlashGraph = (function () {
  const CX = 620, COMM = ' ';  // COMM = 抑制标签的空格

  // ── 输入行（收进「模型输入」parent cluster，居中对齐主轴）──
  const inputs = [
    { id: 'token_ids',    label: 'Token IDs',      typeLabel: 'Input', kind: 'tensor', x: 420, y: 88, width: 150, height: 46, colorKey: 'io:input', desc: '输入 token 序列的整数 ID（词表索引）。' },
    { id: 'position_ids', label: 'Position IDs',   typeLabel: 'Input', kind: 'tensor', x: 620, y: 88, width: 150, height: 46, colorKey: 'io:input', desc: '位置索引，供 RoPE 旋转位置编码使用。' },
    { id: 'attn_mask',    label: 'KV / Attention Context', typeLabel: 'Runtime', kind: 'tensor', x: 820, y: 88, width: 190, height: 46, colorKey: 'io:state', desc: 'Flash schema 中的 KV Cache / RoPE / attention context runtime state，训练视图里作为注意力可见性与 cache 上下文的入口。' },
  ];
  const inputsCluster = { id: 'inputs_group', label: '模型输入', x: 258, y: 44, width: 736, height: 96, colorKey: 'module:model' };

  // ── 主干上半：Embedding → Dense×2 ──
  const trunkTop = [
    { id: 'embedding',   label: 'Parallel Embedding', typeLabel: 'Op', kind: 'op', x: CX, y: 210, width: 250, height: 56, colorKey: 'sem:embedding', desc: 'Vocab Parallel Embedding：openPangu-2.0-Flash 词表并行嵌入，输出 hidden_states。' },
    { id: 'dense_block', label: 'Dense 解码层 × 2', typeLabel: 'Module', kind: 'op', x: CX, y: 308, width: 320, height: 60, colorKey: 'module:decoder', desc: '前 2 层稠密解码层（first_k_dense_replace=2）：MLA 注意力 + 稠密 SwiGLU MLP，不做专家路由。' },
    { id: 'embedding_weight', label: 'Embedding Weight', typeLabel: 'Parameter', kind: 'tensor', x: 270, y: 210, width: 188, height: 48, colorKey: 'io:parameter', desc: '词嵌入权重矩阵 [V,H]；Flash schema 中 V=151552, H=2560，tie_word_embeddings=false。' },
  ];
  const trunkTopEdges = [
    { source: 'token_ids',    target: 'embedding',  tag: 'IDS', edgeType: 'activation' },
    { source: 'embedding_weight', target: 'embedding', tag: 'W', edgeType: 'parameter', dashed: true },
    { source: 'embedding',    target: 'dense_block', tag: 'ACT', edgeType: 'activation' },
  ];

  // ── 主干下半：Final RMSNorm → LM Head → conditional Logits All-Gather → Logits ──
  function trunkBottom(yTop) {
    const yNorm = yTop, yHead = yTop + 118, yGather = yTop + 226, yOut = yTop + 334;
    return {
      nodes: [
        { id: 'final_norm', label: 'Final RMSNorm', typeLabel: 'Op',     kind: 'op',     x: CX, y: yNorm,   width: 210, height: 54, colorKey: 'sem:norm', desc: 'Final RMSNorm：输出投影前的最终归一化。' },
        { id: 'lm_head',    label: 'LM Head',        typeLabel: 'Op',     kind: 'op',     x: CX, y: yHead,   width: 200, height: 54, colorKey: 'sem:head', desc: 'LM Head：hidden → vocab logits 的线性投影。' },
        { id: 'logits_allgather', label: 'Logits All-Gather', typeLabel: 'Comm', kind: 'op', x: CX, y: yGather, width: 230, height: 50, colorKey: 'sem:comm', desc: 'Logits All-Gather：embed_tp_size > 1 时跨词表分片收集 logits；并行度为 1 时等价 no-op。' },
        { id: 'logits',     label: 'Logits',         typeLabel: 'Output', kind: 'tensor', x: CX, y: yOut,    width: 170, height: 48, colorKey: 'io:output', desc: '下一个 token 的预测分布（vocab 维 logits）。' },
        { id: 'lm_head_weight', label: 'LM Head Weight', typeLabel: 'Parameter', kind: 'tensor', x: 335, y: yHead, width: 188, height: 48, colorKey: 'io:parameter', desc: 'LM Head 权重 [H,V]；Flash schema 中 tie_word_embeddings=false，不与 Embedding 权重共享。' },
      ],
      edges: [
        { source: 'final_norm', target: 'lm_head',    tag: 'NEXT', edgeType: 'activation' },
        { source: 'lm_head',    target: 'logits_allgather', tag: 'gather', edgeType: 'communication' },
        { source: 'logits_allgather', target: 'logits', tag: 'LOGITS', edgeType: 'activation' },
        { source: 'lm_head_weight', target: 'lm_head', tag: 'W', edgeType: 'parameter', dashed: true },
      ],
    };
  }

  // ── 折叠态：MoE 解码层 = 一个可展开盒 ──
  function buildCollapsed() {
    const moeBlock = { id: 'moe_block', label: 'MoE 解码层 × 44', typeLabel: 'Module', kind: 'op', x: CX, y: 408, width: 320, height: 64, colorKey: 'module:moe', collapsed: true, desc: 'L2-L45 共 44 层 MoE 解码层（每层：Sparse MLA / MoME → Router Top-8 → 256 路由专家 + 1 共享专家 → 合并）。点 + 展开代表层内部。' };
    const bottom = trunkBottom(540);
    const nodes = [...inputs, ...trunkTop, moeBlock, ...bottom.nodes];
    const edges = [
      ...trunkTopEdges,
      { source: 'position_ids', target: 'dense_block', tag: 'POS',  edgeType: 'activation' },
      { source: 'attn_mask',    target: 'dense_block', tag: 'MASK', edgeType: 'activation' },
      { source: 'dense_block',  target: 'moe_block',   tag: 'ACT',  edgeType: 'activation' },
      { source: 'moe_block',    target: 'final_norm',  tag: 'ACT',  edgeType: 'activation' },
      ...bottom.edges,
    ];
    return { width: 1160, height: 836, clusters: [inputsCluster], nodes, edges };
  }

  // ── 展开态：MoE 代表层单列 · 路由/共享并列 · 专家可再下钻 ──
  function buildExpanded(expertExpanded) {
    // MoE 列上半（两种专家态共用），主干中线 CX。
    // Attention 子图对齐 openpangu_2_0_flash_modelviz.html 中的 Sparse MLA 细节：
    // Q/KV latent branches -> Query/Key/Value -> Sparse FlashAttention -> output causal conv/projection。
    const headNodes = [
      { id: 'mla', label: 'Sparse MLA Attention', typeLabel: 'Module', kind: 'op', x: CX, y: 470, width: 320, height: 56, colorKey: 'sem:attention', desc: 'Sparse MLA Attention：Flash schema 中的低秩 Q/KV 路径，包含 DSA/SWA 分支、RoPE、KV Cache 与 MoME local context。' },
      { id: 'attention_projection_weights', label: 'Attention Proj Weights', typeLabel: 'Parameter', kind: 'tensor', x: 170, y: 560, width: 210, height: 46, colorKey: 'io:parameter', desc: 'MLA q/kv/o projection 参数集合；在源对象中同时参数化 Q/KV latent linear 与输出投影。' },
      { id: 'q_a_proj', label: 'Q Latent Linear', typeLabel: 'Op', kind: 'op', x: 430, y: 560, width: 220, height: 48, colorKey: 'sem:linear', desc: 'Q Latent Linear：生成 query latent 表示。' },
      { id: 'kv_a_proj', label: 'KV Latent Linear', typeLabel: 'Op', kind: 'op', x: 810, y: 560, width: 230, height: 48, colorKey: 'sem:linear', desc: 'KV Latent Linear：生成 key/value latent 表示。' },
      { id: 'q_causal_conv', label: 'Q Causal Conv1D', typeLabel: 'Op', kind: 'op', x: 430, y: 636, width: 220, height: 46, colorKey: 'sem:act', desc: 'Q Causal Conv1D：MoME query stream 的局部因果卷积。' },
      { id: 'kv_causal_conv', label: 'KV Causal Conv1D', typeLabel: 'Op', kind: 'op', x: 810, y: 636, width: 230, height: 46, colorKey: 'sem:act', desc: 'KV Causal Conv1D：MoME KV stream 的局部因果卷积。' },
      { id: 'q_residual_add', label: '+', typeLabel: 'Op', kind: 'op', x: 430, y: 698, width: 58, height: 46, colorKey: 'sem:act', desc: 'Q Add：query stream 的 residual add。' },
      { id: 'kv_residual_add', label: '+', typeLabel: 'Op', kind: 'op', x: 810, y: 698, width: 58, height: 46, colorKey: 'sem:act', desc: 'KV Add：KV stream 的 residual add。' },
      { id: 'q_a_norm', label: 'Q LayerNorm', typeLabel: 'Op', kind: 'op', x: 430, y: 760, width: 220, height: 46, colorKey: 'sem:norm', desc: 'Q LayerNorm：query latent up projection 前的归一化。' },
      { id: 'kv_a_norm', label: 'KV LayerNorm', typeLabel: 'Op', kind: 'op', x: 810, y: 760, width: 230, height: 46, colorKey: 'sem:norm', desc: 'KV LayerNorm：KV latent up projection 前的归一化。' },
      { id: 'q_b_proj', label: 'Q Up Linear', typeLabel: 'Op', kind: 'op', x: 430, y: 836, width: 220, height: 46, colorKey: 'sem:linear', desc: 'Q Up Linear：把 query latent 展开为 attention query。' },
      { id: 'kv_b_proj', label: 'KV Up Linear', typeLabel: 'Op', kind: 'op', x: 810, y: 836, width: 230, height: 46, colorKey: 'sem:linear', desc: 'KV Up Linear：把 KV latent 展开为 key/value。' },
      { id: 'query_tensor', label: 'Query', typeLabel: 'Tensor', kind: 'tensor', x: 430, y: 930, width: 200, height: 46, colorKey: 'io:state', desc: 'Query tensor，送入 Sparse FlashAttention。' },
      { id: 'key_tensor', label: 'Key', typeLabel: 'Tensor', kind: 'tensor', x: 720, y: 930, width: 150, height: 46, colorKey: 'io:state', desc: 'Key tensor，送入 Sparse FlashAttention。' },
      { id: 'value_tensor', label: 'Value', typeLabel: 'Tensor', kind: 'tensor', x: 910, y: 930, width: 150, height: 46, colorKey: 'io:state', desc: 'Value tensor，送入 Sparse FlashAttention。' },
      { id: 'attention_core', label: 'Sparse FlashAttention', typeLabel: 'Op', kind: 'op', x: CX, y: 1060, width: 300, height: 54, colorKey: 'sem:attention', desc: 'Sparse FlashAttention：汇合 Query / Key / Value 并执行 DSA/SWA sparse attention 核心。' },
      { id: 'o_causal_conv', label: 'Output Causal Conv1D', typeLabel: 'Op', kind: 'op', x: CX, y: 1140, width: 300, height: 46, colorKey: 'sem:act', desc: 'Output Causal Conv1D：attention output side 的 MoME 局部因果卷积。' },
      { id: 'o_residual_add', label: '+', typeLabel: 'Op', kind: 'op', x: CX, y: 1202, width: 58, height: 46, colorKey: 'sem:act', desc: 'Output Add：attention output stream 的 residual add。' },
      { id: 'o_proj', label: 'Output Projection', typeLabel: 'Op', kind: 'op', x: CX, y: 1264, width: 270, height: 48, colorKey: 'sem:linear', desc: 'Output Projection：Sparse FlashAttention 输出回 hidden size。' },
      { id: 'moe_prenorm', label: 'Pre-RMSNorm',  typeLabel: 'Op', kind: 'op', x: CX, y: 1390, width: 200, height: 50, colorKey: 'sem:norm', desc: '进入 MoE 前的 RMSNorm（sandwich-norm 的前半）。' },
      { id: 'gate', label: 'Router · Top-8', typeLabel: 'Op', kind: 'op', x: CX, y: 1480, width: 200, height: 52, colorKey: 'sem:gate', desc: 'Router Gate + TopK：为每个 token 打分选 Top-8 专家；routed_scaling=2.5，输出 [B,T,E]，E=256。' },
      { id: 'w_gate', label: 'Router Weight', typeLabel: 'Parameter', kind: 'tensor', x: 360, y: 1480, width: 144, height: 46, colorKey: 'io:parameter', desc: 'Router 权重 [H,E]，H=2560，E=256。' },
      { id: 'a2a_dispatch', label: 'All-to-All 分发', typeLabel: 'Comm', kind: 'op', x: CX, y: 1572, width: 200, height: 50, colorKey: 'sem:comm', desc: 'All-to-All 分发：按路由结果把每个 token 发往承载目标专家的 expert-parallel rank（通信事件，投影到物理轴）。' },
    ];
    const headEdges = [
      ...trunkTopEdges,
      { source: 'position_ids', target: 'mla', tag: 'POS',  edgeType: 'activation' },
      { source: 'attn_mask',    target: 'mla', tag: 'MASK', edgeType: 'activation' },
      { source: 'dense_block',  target: 'mla', tag: 'ACT',  edgeType: 'activation' },
      { source: 'mla',          target: 'q_a_proj', tag: 'Q',  edgeType: 'activation' },
      { source: 'mla',          target: 'kv_a_proj', tag: 'KV',  edgeType: 'activation' },
      { source: 'attention_projection_weights', target: 'q_a_proj', tag: 'W', edgeType: 'parameter', dashed: true },
      { source: 'attention_projection_weights', target: 'kv_a_proj', tag: 'W', edgeType: 'parameter', dashed: true },
      { source: 'attention_projection_weights', target: 'o_proj', tag: 'W', edgeType: 'parameter', dashed: true },
      { source: 'q_a_proj', target: 'q_causal_conv', tag: COMM, edgeType: 'activation' },
      { source: 'q_a_proj', target: 'q_residual_add', tag: COMM, edgeType: 'activation', dashed: true },
      { source: 'q_causal_conv', target: 'q_residual_add', tag: COMM, edgeType: 'activation' },
      { source: 'q_residual_add', target: 'q_a_norm', tag: COMM, edgeType: 'activation' },
      { source: 'q_a_norm', target: 'q_b_proj', tag: COMM, edgeType: 'activation' },
      { source: 'q_b_proj', target: 'query_tensor', tag: COMM, edgeType: 'activation' },
      { source: 'kv_a_proj', target: 'kv_causal_conv', tag: COMM, edgeType: 'activation' },
      { source: 'kv_a_proj', target: 'kv_residual_add', tag: COMM, edgeType: 'activation', dashed: true },
      { source: 'kv_causal_conv', target: 'kv_residual_add', tag: COMM, edgeType: 'activation' },
      { source: 'kv_residual_add', target: 'kv_a_norm', tag: COMM, edgeType: 'activation' },
      { source: 'kv_a_norm', target: 'kv_b_proj', tag: COMM, edgeType: 'activation' },
      { source: 'kv_b_proj', target: 'key_tensor', tag: COMM, edgeType: 'activation' },
      { source: 'kv_b_proj', target: 'value_tensor', tag: COMM, edgeType: 'activation' },
      { source: 'query_tensor', target: 'attention_core', tag: 'Q', edgeType: 'activation' },
      { source: 'key_tensor', target: 'attention_core', tag: 'K', edgeType: 'activation' },
      { source: 'value_tensor', target: 'attention_core', tag: 'V', edgeType: 'activation' },
      { source: 'attention_core', target: 'o_causal_conv', tag: COMM, edgeType: 'activation' },
      { source: 'attention_core', target: 'o_residual_add', tag: COMM, edgeType: 'activation', dashed: true },
      { source: 'o_causal_conv', target: 'o_residual_add', tag: COMM, edgeType: 'activation' },
      { source: 'o_residual_add', target: 'o_proj', tag: COMM, edgeType: 'activation' },
      { source: 'moe_prenorm',  target: 'gate',        tag: 'NORM', edgeType: 'activation' },
      { source: 'w_gate',       target: 'gate',        tag: 'W',    edgeType: 'parameter', dashed: true },
      { source: 'gate',         target: 'a2a_dispatch',tag: 'dispatch', edgeType: 'communication' },
    ];

    const sharedDesc = '共享专家（SwiGLU MLP）：始终激活，不经 Router，每个 token 都会经过，作为稳定基座，与 256 路由专家的输出相加。';
    let expertNodes, expertEdges, clusters, yCombine, width, gridMeta = null;

    if (!expertExpanded) {
      // 专家折叠：路由代表节点（中线）｜ 共享专家（右并列），共同汇入 Combine
      yCombine = 1908;
      expertNodes = [
        { id: 'expert_mlp',    label: '路由专家 × 256', typeLabel: 'EP2 桶', kind: 'op', x: CX,  y: 1684, width: 240, height: 60, colorKey: 'sem:moe', collapsed: true, desc: '256 个路由专家（Fused MoE）。每个 token 仅激活 Top-8；当前 demo 运行时切成 EP2 桶、每桶 128 专家。点 + 展开为 EP 桶。' },
        { id: 'shared_expert', label: '共享专家',       typeLabel: 'Shared Expert', kind: 'op', x: 840, y: 1684, width: 150, height: 60, colorKey: 'sem:mlp', desc: sharedDesc },
      ];
      expertEdges = [
        { source: 'a2a_dispatch',  target: 'expert_mlp',   tag: COMM,  edgeType: 'communication' },
        { source: 'expert_mlp',    target: 'a2a_combine',  tag: COMM,  edgeType: 'communication' },
        { source: 'moe_prenorm',   target: 'shared_expert',tag: 'ACT', edgeType: 'activation' },
        { source: 'shared_expert', target: 'a2a_combine',  tag: 'ACT', edgeType: 'activation' },
      ];
      clusters = [inputsCluster, { id: 'moe_layer', label: 'MoE 解码层（代表层 · 其余 × 43 折叠）', x: 250, y: 400, width: 750, height: 1660, colorKey: 'module:moe', repeat: 44 }];
      width = 1160;
    } else {
      // 专家展开：256 路由专家 = EP2 桶 × 128（点阵在页面侧注入）｜ 共享专家右并列
      const COLS = 2, ROWS = 1, COLP = 180, ROW0 = 1728, ROWP = 50, GW = 124, GH = 68;
      const colCenters = []; for (let c = 0; c < COLS; c++) colCenters.push(CX - (COLS - 1) * COLP / 2 + c * COLP);
      const groups = [];
      for (let i = 0; i < 2; i++) {
        const col = i % COLS, row = Math.floor(i / COLS), ep = String(i).padStart(2, '0');
        groups.push({ id: 'expert_group_' + ep, label: 'EP' + ep, typeLabel: '128 experts', kind: 'op',
          x: colCenters[col], y: ROW0 + row * ROWP, width: GW, height: GH, colorKey: 'sem:moe', epRank: ep,
          desc: 'EP 桶 ' + ep + '：承载 256 个路由专家中的 128 个。EP 桶是这一层 256 专家的运行时切分 —— 不是一层，也不是一张卡。' });
      }
      gridMeta = { noteY: 1620, splitLine: true };  // 常驻「≠层≠卡」说明 + dispatch/combine 竖线在专家池分两段（页面侧注入）
      yCombine = 1992;
      expertNodes = [
        ...groups,
        { id: 'shared_expert', label: '共享专家', typeLabel: 'Shared Expert', kind: 'op', x: 975, y: 1753, width: 150, height: 180, colorKey: 'sem:mlp', desc: sharedDesc },
        { id: 'w_expert',      label: 'Expert Weights', typeLabel: 'Parameter', kind: 'tensor', x: 300, y: 1778, width: 150, height: 46, colorKey: 'io:parameter', desc: '256 个路由专家的 fused expert bank 权重组，按 EP 桶切分放置。' },
      ];
      expertEdges = [
        // dispatch→pool→combine 的居中竖线在页面侧分两段画（进/出专家池），此处不发引擎边以免穿过网格
        { source: 'w_expert',      target: 'expert_group_01', tag: 'W', edgeType: 'parameter', dashed: true },
        { source: 'moe_prenorm',   target: 'shared_expert',tag: 'ACT', edgeType: 'activation' },
        { source: 'shared_expert', target: 'a2a_combine',  tag: 'ACT', edgeType: 'activation' },
      ];
      clusters = [
        inputsCluster,
        { id: 'moe_layer', label: 'MoE 解码层（代表层 · 其余 × 43 折叠）', x: 220, y: 400, width: 880, height: 1760, colorKey: 'module:moe', repeat: 44 },
        { id: 'expert_pool', label: '路由专家池 · 256 专家 → EP2（每桶 128）', x: 360, y: 1632, width: 520, height: 240, colorKey: 'module:mlp' },
      ];
      width = 1180;
    }

    const tailNodes = [
      { id: 'a2a_combine',  label: 'All-to-All 汇聚', typeLabel: 'Comm', kind: 'op', x: CX, y: yCombine, width: 200, height: 50, colorKey: 'sem:comm', desc: 'All-to-All 汇聚：把各 rank 算完的专家输出按 token 收回并加权合并（通信事件，投影到物理轴）。' },
      { id: 'moe_residual', label: 'Post-MLP RMSNorm', typeLabel: 'Op', kind: 'op', x: CX, y: yCombine + 84, width: 220, height: 52, colorKey: 'sem:norm', desc: 'Post-MLP RMSNorm：源码通过 fused npu_add_rms_norm 处理 residual add + RMSNorm，不单独画 Add 节点。' },
    ];
    const yTrunk = yCombine + 84 + 120;
    const bottom = trunkBottom(yTrunk);
    const nodes = [...inputs, ...trunkTop, ...headNodes, ...expertNodes, ...tailNodes, ...bottom.nodes];
    const edges = [
      ...headEdges, ...expertEdges,
      { source: 'a2a_combine',  target: 'moe_residual', tag: 'ACT', edgeType: 'activation' },
      { source: 'moe_residual', target: 'final_norm',   tag: 'ACT', edgeType: 'activation' },
      ...bottom.edges,
    ];
    return { width, height: yTrunk + 290, clusters, nodes, edges, gridMeta };
  }

  return function buildOpenPanguFlashGraph(opts) {
    opts = opts || {};
    if (!opts.moeExpanded) return buildCollapsed();
    return buildExpanded(!!opts.expertExpanded);
  };
})();
