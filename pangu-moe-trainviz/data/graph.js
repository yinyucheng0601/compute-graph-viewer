/* Pangu Pro MoE 架构图（model-training-graphviz schema）。
   故障锚点：Layer47 Gate 路由坍缩。x=节点中心, y=节点中心。
   坐标给簇标签留 ~34px 顶部 headroom，避免标签压节点。 */
window.PANGU_GRAPH = {
  width: 720,
  height: 1210,
  clusters: [
    { id: 'transformer', label: 'Transformer', x: 110, y: 114, width: 500, height: 915, colorKey: 'module:transformer' },
    { id: 'decoder', label: 'Decoder Layer × 48', x: 146, y: 239, width: 428, height: 688, colorKey: 'module:decoder', repeat: 48 },
    { id: 'moe', label: 'MoE FFN · MoGE 分组专家', x: 180, y: 534, width: 360, height: 393, colorKey: 'module:moe' },
  ],
  nodes: [
    { id: 'token_ids', label: 'Token IDs', typeLabel: 'Input', kind: 'tensor', x: 360, y: 44, width: 190, height: 48, colorKey: 'io:input' },
    { id: 'embedding', label: 'Parallel Embedding', typeLabel: 'Op', kind: 'op', x: 360, y: 176, width: 300, height: 56, colorKey: 'sem:embedding' },
    { id: 'attn_norm', label: 'Attention RMSNorm', typeLabel: 'Op', kind: 'op', x: 360, y: 300, width: 240, height: 54, colorKey: 'sem:norm' },
    { id: 'attention', label: 'Grouped Attention', typeLabel: 'Op', kind: 'op', x: 360, y: 392, width: 250, height: 54, colorKey: 'sem:attention' },
    { id: 'moe_norm', label: 'MoE RMSNorm', typeLabel: 'Op', kind: 'op', x: 360, y: 486, width: 240, height: 54, colorKey: 'sem:norm' },
    { id: 'gate', label: 'Layer47 Gate (Router)', typeLabel: 'Op', kind: 'op', x: 360, y: 596, width: 250, height: 56, colorKey: 'sem:gate' },
    { id: 'a2a_dispatch', label: 'All-to-All Dispatch', typeLabel: 'Comm', kind: 'op', x: 360, y: 688, width: 264, height: 54, colorKey: 'sem:comm' },
    { id: 'experts', label: 'MoGE Experts × N', typeLabel: 'Op', kind: 'op', x: 360, y: 782, width: 300, height: 60, colorKey: 'sem:moe' },
    { id: 'a2a_combine', label: 'All-to-All Combine', typeLabel: 'Comm', kind: 'op', x: 360, y: 876, width: 264, height: 54, colorKey: 'sem:comm' },
    { id: 'final_norm', label: 'Final RMSNorm', typeLabel: 'Op', kind: 'op', x: 360, y: 978, width: 220, height: 54, colorKey: 'sem:norm' },
    { id: 'lm_head', label: 'LM Head Linear', typeLabel: 'Op', kind: 'op', x: 360, y: 1070, width: 244, height: 54, colorKey: 'sem:linear' },
    { id: 'logits', label: 'Logits', typeLabel: 'Output', kind: 'tensor', x: 360, y: 1162, width: 190, height: 48, colorKey: 'io:output' },
  ],
  edges: [
    { source: 'token_ids', target: 'embedding', tag: 'ACT', edgeType: 'activation' },
    { source: 'embedding', target: 'attn_norm', tag: 'ACT', edgeType: 'activation' },
    { source: 'attn_norm', target: 'attention', tag: 'QKV', edgeType: 'parameter' },
    { source: 'attention', target: 'moe_norm', tag: 'ACT', edgeType: 'activation' },
    { source: 'moe_norm', target: 'gate', tag: 'ROUTE', edgeType: 'parameter' },
    { source: 'gate', target: 'a2a_dispatch', tag: 'DISPATCH', edgeType: 'communication' },
    { source: 'a2a_dispatch', target: 'experts', tag: 'TOKENS', edgeType: 'communication' },
    { source: 'experts', target: 'a2a_combine', tag: 'COMBINE', edgeType: 'communication' },
    { source: 'a2a_combine', target: 'final_norm', tag: 'ACT', edgeType: 'activation' },
    { source: 'final_norm', target: 'lm_head', tag: 'W', edgeType: 'parameter' },
    { source: 'lm_head', target: 'logits', tag: 'LOSS', edgeType: 'gradient' },
  ],
  trainingEvidence: {
    gate: {
      dimension: '路由 / 混合精度', metric: 'dispatch shape',
      what: 'Layer47 Gate 路由坍缩——dispatch 形状跨 rank 不一致。',
      evidence: ['Rank2 dispatch [2048,1] vs 其余 [2048,4]', 'W_gate Rank2 分片出现 -inf（混合精度下溢）', 'Load Balance Loss 骤降≈0'],
      action: '右键「追溯梯度流」→ 定位 Step1997 混合精度写越界。',
      relatedNodeIds: ['a2a_dispatch', 'experts', 'a2a_combine'],
    },
    a2a_dispatch: {
      dimension: '分布式通信', metric: 'All-to-All bytes',
      what: 'All-to-All 分发流量在 TP Rank2 坍缩成黑洞。',
      evidence: ['Rank2 流入边几乎消失（流量低两个量级）', 'P2P 气泡累积、stream 等待'],
      action: '看底部通信 dock 的 Rank2 黑洞与气泡。',
      relatedNodeIds: ['gate', 'experts'],
    },
    experts: {
      dimension: '专家负载均衡', metric: 'token / expert',
      what: 'MoGE 分组专家收不到 token，负载塌陷、梯度暴涨。',
      evidence: ['Rank2 专家组 0 token', 'MoE 分支梯度范数暴涨'],
      action: '结合右栏路由热图看 Rank2 列空白。',
      relatedNodeIds: ['a2a_dispatch', 'a2a_combine', 'gate'],
    },
  },
};
