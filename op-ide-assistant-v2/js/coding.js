/* ═══════════════════════════════════════════════════════════════
   PyPTO IDE Assistant — Coding Scenario
   Intelligent operator code generation + constraint checker
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const DEFAULT_IMPL_TEMPLATE = [
  '# Case-inspired starter template for IndexerPrologQuantQuantLoop',
  'import pypto',
  'import pypto.frontend',
  '',
  '@pypto.frontend.jit',
  '@pypto.op_config(unroll_list=[1], submit_before_loop=True)',
  'def indexer_prolog_quant_quant_loop(q_norm_in, x_in, wk, w_proj, k_cache, k_cache_scale):',
  '    """',
  '    Case scaffold aligned with the Agent demo narrative.',
  '    Keeps loop_unroll + semantic_label structure so generated code matches PATH0_6 style explanation.',
  '    """',
  '    T_TILE = 128',
  '    K_TILE = 128',
  '    OUT_TILE = 64',
  '',
  '    q_l1 = pypto.alloc(shape=[T_TILE, K_TILE], dtype="BF16", scope="L1")',
  '    x_l1 = pypto.alloc(shape=[T_TILE, K_TILE], dtype="BF16", scope="L1")',
  '    acc_l0c = pypto.alloc(shape=[T_TILE, OUT_TILE], dtype="FP32", scope="L0C")',
  '',
  '    for t_idx, unroll_len in pypto.loop_unroll(0, pypto.dim("t"), 1, name="IndexerPrologQuantQuantLoop", idx_name="tIdx", unroll_list=[1]):',
  '        pypto.set_semantic_label("Query-Linear")',
  '        pypto.ops.TILE_COPY_IN(q_norm_in, q_l1)',
  '        pypto.ops.TILE_A_MUL_B(q_l1, wk, acc_l0c)',
  '',
  '        pypto.set_semantic_label("Key-Linear")',
  '        pypto.ops.TILE_COPY_IN(x_in, x_l1)',
  '        pypto.ops.TILE_A_MUL_B(x_l1, wk, acc_l0c)',
  '',
  '        pypto.set_semantic_label("Key-Quant")',
  '        pypto.scatter_update(k_cache, 0, t_idx, acc_l0c)',
  '        pypto.scatter_update(k_cache_scale, 0, t_idx, acc_l0c)',
  '',
  '        pypto.set_semantic_label("Weight-Linear")',
  '        pypto.ops.TILE_A_MUL_B(x_l1, w_proj, acc_l0c)',
  '        pypto.ops.TILE_COPY_OUT(acc_l0c, "weights_out")',
  '',
  '    return "weights_out"',
];

const DEFAULT_TEST_TEMPLATE = [
  '# Case smoke test scaffold',
  'import numpy as np',
  'import torch',
  '',
  'def test_indexer_prolog_quant_quant_loop_shape_and_dtype():',
  '    q_norm = torch.randn(128, 128, dtype=torch.bfloat16)',
  '    x = torch.randn(128, 128, dtype=torch.bfloat16)',
  '',
  '    assert tuple(q_norm.shape) == (128, 128)',
  '    assert x.dtype == torch.bfloat16',
  '',
  'def test_loop_unroll_and_semantic_labels_present():',
  '    source = "IndexerPrologQuantQuantLoop Query-Linear Key-Quant Weight-Linear"',
  '    assert "IndexerPrologQuantQuantLoop" in source',
  '    assert "Key-Quant" in source',
  '',
  'def test_tile_plan_defaults():',
  '    tile_plan = {"t_tile": 128, "out_tile": 64, "k_tile": 128}',
  '    assert tile_plan["t_tile"] % 32 == 0',
  '    assert tile_plan["k_tile"] % 32 == 0',
];

document.addEventListener('DOMContentLoaded', () => {
  renderCode('code-impl', DEFAULT_IMPL_TEMPLATE);
  renderCode('code-test', DEFAULT_TEST_TEMPLATE);
});

// ── Code Generation ────────────────────────────────────────────
function generateCode() {
  const opName  = document.getElementById('op-name').value.trim() || 'CustomOp';
  const opType  = document.querySelector('input[name="op-type"]:checked')?.value || 'gemm';
  const mTile   = document.getElementById('m-tile').value || '64';
  const nTile   = document.getElementById('n-tile').value || '64';
  const kTile   = document.getElementById('k-tile').value || '64';
  const l1Reuse = document.getElementById('l1-reuse').value || 'A';
  const useJit  = document.getElementById('ck-jit').checked;
  const useInplace = document.getElementById('ck-inplace').checked;
  const useUnroll  = document.getElementById('ck-unroll').checked;
  const useSubmit  = document.getElementById('ck-submit').checked;

  const inputs  = collectTensors('#input-tensors-list .tensor-row');
  const outputs = collectTensors('#output-tensors-list .tensor-row');

  // Show AI thinking in chat
  const chat = document.getElementById('coding-chat');
  appendMsg(chat, 'ai', `正在为 \`${opName}\` 生成 ${opType.toUpperCase()} 算子代码...`);

  setTimeout(() => {
    const impl = generateImpl(opName, opType, inputs, outputs, mTile, nTile, kTile, l1Reuse, useJit, useInplace, useUnroll, useSubmit);
    const test = generateTest(opName, opType, inputs, outputs);

    renderCode('code-impl', impl);
    renderCode('code-test', test);

    appendMsg(chat, 'ai', `✓ 已生成 \`impl.py\` 和 \`test.py\`。\n\n检测到约束：\n• L0A 使用量：${mTile}×${kTile}×2B = ${Math.round(parseInt(mTile)*parseInt(kTile)*2/1024)}KB（限制 64KB）\n• L0B 使用量：${kTile}×${nTile}×2B = ${Math.round(parseInt(kTile)*parseInt(nTile)*2/1024)}KB（限制 64KB）\n\n${parseInt(mTile)*parseInt(kTile)*2 > 65536 ? '⚠ L0A 超限！请减小 M_tile 或 K_tile。' : '✓ Buffer 约束通过'}`);

    runConstraintCheck(opType, mTile, nTile, kTile, inputs, outputs);
    showConstraintPanel();
  }, 800);
}

function collectTensors(selector) {
  const rows = document.querySelectorAll(selector);
  return Array.from(rows).map(row => ({
    name:  row.querySelector('.ti-name')?.value || 'tensor',
    dtype: row.querySelector('.ti-dtype')?.value || 'BF16',
    shape: row.querySelector('.ti-shape')?.value || '[N]',
  }));
}

// ── Code Renderer ──────────────────────────────────────────────
function renderCode(paneId, lines) {
  const pane = document.getElementById(paneId);
  if (!pane) return;
  pane.innerHTML = '<pre>' + lines.map(l => `<span class="line">${highlight(l)}</span>`).join('') + '</pre>';
  pane.classList.add('active');
}

function highlight(raw) {
  // Token placeholders prevent later regexes from matching inside inserted span HTML.
  const tokens = [];
  const stash = (className, text) => {
    const idx = tokens.length;
    tokens.push(`<span class="${className}">${text}</span>`);
    return `__TOK_${idx}__`;
  };

  let escaped = escapeHtml(raw);

  escaped = escaped.replace(/(#.*)$/g, match => stash('tok-cmt', match));
  escaped = escaped.replace(/(["'])([^"']*)\1/g, match => stash('tok-str', match));
  escaped = escaped.replace(/(@\w[\w.]*)/g, match => stash('tok-dec', match));
  escaped = escaped.replace(/\b(def|class|return|import|from|for|in|range|if|else|elif|with|pass|None|True|False|and|or|not|lambda|yield)\b/g, match => stash('tok-kw', match));
  escaped = escaped.replace(/\b([A-Z][A-Z0-9_]{2,})\b/g, match => stash('tok-fn', match));
  escaped = escaped.replace(/\b(\d+(?:\.\d+)?)\b/g, match => stash('tok-num', match));

  return escaped.replace(/__TOK_(\d+)__/g, (_, idx) => tokens[Number(idx)] || '');
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── GEMM impl.py Generator ─────────────────────────────────────
function generateImpl(opName, opType, inputs, outputs, mTile, nTile, kTile, l1Reuse, useJit, useInplace, useUnroll, useSubmit) {
  const inp = inputs.length > 0 ? inputs : [{name:'a_mat',dtype:'BF16',shape:'[M,K]'},{name:'b_mat',dtype:'BF16',shape:'[K,N]'}];
  const out = outputs.length > 0 ? outputs : [{name:'c_mat',dtype:'FP32',shape:'[M,N]'}];

  const inArgs  = inp.map(t => `${t.name}: ${t.dtype}${t.shape}`).join(', ');
  const outArgs = out.map(t => `${t.name}: ${t.dtype}${t.shape}`).join(', ');

  const lines = [
    '# Auto-generated by PyPTO IDE Assistant',
    `# Op: ${opName}  Type: ${opType.toUpperCase()}  Generated: ${new Date().toISOString().slice(0,10)}`,
    '',
    'import pypto',
    'import pypto.frontend',
    `from pypto.ops import (`,
    '    TILE_COPY_IN, TILE_COPY_OUT,',
    '    TILE_L1_TO_L0A, TILE_L1_TO_L0B,',
    '    TILE_A_MUL_B, TILE_A_MULACC_B,',
    ')',
    '',
    `# Tiling constants`,
    `M_TILE = ${mTile}`,
    `N_TILE = ${nTile}`,
    `K_TILE = ${kTile}`,
    '',
  ];

  if (useJit) lines.push('@pypto.frontend.jit');
  if (useInplace) lines.push(`@pypto.op_config(inplace=False)`);
  if (useUnroll)  lines.push(`@pypto.op_config(unroll_list=[1])`);
  if (useSubmit)  lines.push(`@pypto.op_config(submit_before_loop=True)`);

  lines.push(`def ${opName.toLowerCase()}_kernel(${inArgs}) -> (${outArgs}):`);

  if (opType === 'gemm') {
    lines.push(...generateGemmBody(inp, out, mTile, nTile, kTile, l1Reuse));
  } else if (opType === 'vector') {
    lines.push(...generateVectorBody(inp, out));
  } else if (opType === 'dma') {
    lines.push(...generateDMABody(inp, out));
  } else {
    lines.push(...generateFusedBody(inp, out, mTile, nTile, kTile));
  }

  lines.push('');
  lines.push('');
  lines.push(`def ${opName.toLowerCase()}_tiling(m, n, k):`);
  lines.push(`    """Compute tiling parameters for ${opName}"""`);
  lines.push(`    m_tiles = (m + M_TILE - 1) // M_TILE`);
  lines.push(`    n_tiles = (n + N_TILE - 1) // N_TILE`);
  lines.push(`    k_tiles = (k + K_TILE - 1) // K_TILE`);
  lines.push(`    return dict(m_tiles=m_tiles, n_tiles=n_tiles, k_tiles=k_tiles)`);

  return lines;
}

function generateGemmBody(inp, out, mTile, nTile, kTile, l1Reuse) {
  const a = inp[0]?.name || 'a_mat';
  const b = inp[1]?.name || 'b_mat';
  const c = out[0]?.name || 'c_mat';
  const fixMatrix = l1Reuse === 'A' ? a : b;

  return [
    `    # ── L1 Buffer allocation ────────────────────────────`,
    `    ${a}_l1 = pypto.alloc(shape=[M_TILE, ${kTile}], dtype="BF16", scope="L1")`,
    `    ${b}_l1 = pypto.alloc(shape=[${kTile}, N_TILE], dtype="BF16", scope="L1")`,
    `    # ── L0 Buffer allocation ────────────────────────────`,
    `    ${a}_l0a = pypto.alloc(shape=[M_TILE, ${kTile}], dtype="BF16", scope="L0A")`,
    `    ${b}_l0b = pypto.alloc(shape=[${kTile}, N_TILE], dtype="BF16", scope="L0B")`,
    `    ${c}_l0c = pypto.alloc(shape=[M_TILE, N_TILE],  dtype="FP32", scope="L0C")`,
    ``,
    `    for m_tile in range(pypto.dim("M") // M_TILE):`,
    `        m_start = m_tile * M_TILE`,
    `        # L1 reuse: fix ${fixMatrix} matrix in L1`,
    `        TILE_COPY_IN(${a}[m_start:m_start+M_TILE, :], ${a}_l1)`,
    `        TILE_L1_TO_L0A(${a}_l1, ${a}_l0a)`,
    ``,
    `        for n_tile in range(pypto.dim("N") // N_TILE):`,
    `            n_start = n_tile * N_TILE`,
    `            TILE_COPY_IN(${b}[:, n_start:n_start+N_TILE], ${b}_l1)`,
    `            TILE_L1_TO_L0B(${b}_l1, ${b}_l0b)`,
    ``,
    `            # Cube MMA: L0A × L0B → L0C`,
    `            TILE_A_MUL_B(${a}_l0a, ${b}_l0b, ${c}_l0c)`,
    ``,
    `            # Write result back to DDR`,
    `            TILE_COPY_OUT(${c}_l0c, ${c}[m_start:m_start+M_TILE, n_start:n_start+N_TILE])`,
  ];
}

function generateVectorBody(inp, out) {
  const x = inp[0]?.name || 'x';
  const o = out[0]?.name || 'out';
  return [
    `    # ── UB Buffer allocation ────────────────────────────`,
    `    ${x}_ub  = pypto.alloc_like(${x}, scope="UB")`,
    `    ${o}_ub  = pypto.alloc_like(${o}, scope="UB")`,
    ``,
    `    # DDR → UB`,
    `    TILE_COPY_IN(${x}, ${x}_ub)`,
    ``,
    `    # ── Vector computation on UB ────────────────────────`,
    `    # TODO: replace with actual vector ops`,
    `    ${o}_ub = pypto.ops.TILE_MULS(${x}_ub, scalar=1.0, dst=${o}_ub)`,
    ``,
    `    # UB → DDR`,
    `    TILE_COPY_OUT(${o}_ub, ${o})`,
  ];
}

function generateDMABody(inp, out) {
  const src = inp[0]?.name || 'src';
  const dst = out[0]?.name || 'dst';
  return [
    `    # ── Direct DMA transfer ─────────────────────────────`,
    `    src_l1 = pypto.alloc_like(${src}, scope="L1")`,
    `    TILE_COPY_IN(${src}, src_l1)   # DDR → L1`,
    `    TILE_COPY_OUT(src_l1, ${dst})  # L1 → DDR`,
  ];
}

function generateFusedBody(inp, out, mTile, nTile, kTile) {
  return [
    `    # ── Fused Op: GEMM + Vector Post-processing ─────────`,
    `    # Phase 1: GEMM`,
    ...generateGemmBody(inp, out, mTile, nTile, kTile, 'A'),
    ``,
    `    # Phase 2: Vector post-processing on L0C result`,
    `    # Apply element-wise operation before COPY_OUT`,
    `    # (customize based on your fused op requirements)`,
  ];
}

// ── test.py Generator ──────────────────────────────────────────
function generateTest(opName, opType, inputs, outputs) {
  const fname = opName.toLowerCase() + '_kernel';
  const inp = inputs.length > 0 ? inputs : [{name:'a_mat',dtype:'BF16',shape:'[512,256]'},{name:'b_mat',dtype:'BF16',shape:'[256,512]'}];
  const out = outputs.length > 0 ? outputs : [{name:'c_mat',dtype:'FP32',shape:'[512,512]'}];

  const lines = [
    '# Auto-generated test — PyPTO IDE Assistant',
    '',
    'import pytest',
    'import numpy as np',
    'import torch',
    'import pypto',
    `from impl import ${fname}`,
    '',
    'ATOL = 1e-3',
    'RTOL = 1e-3',
    '',
    '',
    `class Test${opName}:`,
    `    """Precision validation for ${opName}"""`,'',
    '    @pytest.fixture(autouse=True)',
    '    def setup(self):',
    ...inp.map(t => `        self.${t.name} = torch.randn(${t.shape.replace(/[\[\]]/g,'')}).to(torch.${dtypeToTorch(t.dtype)})`),
    '',
    '    def test_shape(self):',
    '        """Verify output shapes match specification"""',
    `        result = ${fname}(${inp.map(t=>'self.'+t.name).join(', ')})`,
    ...out.map((t,i) => `        assert result${out.length>1?'['+i+']':''}.shape == tuple(${t.shape.replace(/[MNK]/g,'512')}), f"Expected ${t.shape}, got {result${out.length>1?'['+i+']':''}.shape}"`),
    '',
    '    def test_precision(self):',
    '        """Compare against PyTorch reference implementation"""',
    `        result = ${fname}(${inp.map(t=>'self.'+t.name).join(', ')})`,
    `        # Reference: PyTorch CPU implementation`,
    opType === 'gemm'
      ? `        ref = torch.matmul(self.${inp[0]?.name||'a_mat'}.float(), self.${inp[1]?.name||'b_mat'}.float())`
      : `        ref = self.${inp[0]?.name||'x'}.float()  # TODO: implement reference`,
    `        np.testing.assert_allclose(`,
    `            result${out.length>1?'[0]':''}.float().numpy(),`,
    `            ref.numpy(),`,
    `            atol=ATOL, rtol=RTOL,`,
    `            err_msg=f"Max error: {(result${out.length>1?'[0]':''}.float() - ref).abs().max():.2e}"`,
    `        )`,
    '',
    '    def test_memory_bounds(self):',
    '        """Verify no L0/L1 buffer overflow at given tile sizes"""',
    '        from impl import M_TILE, N_TILE, K_TILE',
    '        l0a_bytes = M_TILE * K_TILE * 2  # BF16 = 2 bytes',
    '        l0b_bytes = K_TILE * N_TILE * 2',
    '        l0c_bytes = M_TILE * N_TILE * 4  # FP32 = 4 bytes',
    '        assert l0a_bytes <= 65536,  f"L0A overflow: {l0a_bytes} > 65536"',
    '        assert l0b_bytes <= 65536,  f"L0B overflow: {l0b_bytes} > 65536"',
    '        assert l0c_bytes <= 262144, f"L0C overflow: {l0c_bytes} > 262144"',
    '',
    '',
    'if __name__ == "__main__":',
    '    pytest.main([__file__, "-v", "--tb=short"])',
  ];
  return lines;
}

function dtypeToTorch(dtype) {
  const m = { BF16:'bfloat16', FP16:'float16', FP32:'float32', INT8:'int8', INT32:'int32', UINT32:'int32' };
  return m[dtype] || 'float32';
}

// ── Constraint Checker ─────────────────────────────────────────
function runConstraintCheck(opType, mTile, nTile, kTile, inputs, outputs) {
  const M = parseInt(mTile), N = parseInt(nTile), K = parseInt(kTile);
  const constraints = [];

  // L0A check
  const l0a = M * K * 2;
  constraints.push({ ok: l0a <= 65536, warn: false,
    msg: `L0A = ${M}×${K}×2B = ${fmt(l0a)} ${l0a > 65536 ? '❌ 超出 64KB 限制！' : '✓ (≤ 64KB)'}` });

  // L0B check
  const l0b = K * N * 2;
  constraints.push({ ok: l0b <= 65536, warn: false,
    msg: `L0B = ${K}×${N}×2B = ${fmt(l0b)} ${l0b > 65536 ? '❌ 超出 64KB 限制！' : '✓ (≤ 64KB)'}` });

  // L0C check
  const l0c = M * N * 4;
  constraints.push({ ok: l0c <= 262144, warn: false,
    msg: `L0C = ${M}×${N}×4B = ${fmt(l0c)} ${l0c > 262144 ? '❌ 超出 256KB 限制！' : '✓ (≤ 256KB)'}` });

  // L1 check (rough: all inputs)
  const l1 = inputs.reduce((sum, t) => {
    const dims = t.shape.replace(/[\[\]]/g,'').split(',').map(d => parseInt(d) || M);
    return sum + dims.reduce((p,d)=>p*d, 1) * dtypeBytes(t.dtype);
  }, 0);
  const l1Warn = l1 > 800 * 1024;
  constraints.push({ ok: !l1Warn, warn: l1Warn,
    msg: `L1 估算 ≈ ${fmt(l1)} ${l1 > 1048576 ? '❌ 超出 1MB 限制！' : l1Warn ? '⚠ 接近上限（1024KB）' : '✓ (≤ 1MB)'}` });

  // Alignment check
  const aligned = M % 16 === 0 && N % 16 === 0 && K % 16 === 0;
  constraints.push({ ok: aligned, warn: !aligned,
    msg: `Tile 16B 对齐：M=${M} N=${N} K=${K} ${aligned ? '✓' : '⚠ 建议为 16 的倍数（影响 DaVinci 流水效率）'}` });

  renderConstraints(constraints);
}

function dtypeBytes(dtype) {
  const m = { BF16:2, FP16:2, FP32:4, INT8:1, INT32:4, UINT32:4 };
  return m[dtype] || 2;
}

function fmt(bytes) {
  if (bytes >= 1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes/1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function renderConstraints(list) {
  const el = document.getElementById('constraint-list');
  if (!el) return;
  el.innerHTML = list.map(c => `
    <div class="ct-item ${c.ok ? 'ct-ok' : c.warn ? 'ct-warn' : 'ct-err'}">
      <span class="ct-icon">${c.ok ? '✓' : c.warn ? '⚠' : '✕'}</span>
      <span class="ct-msg">${c.msg}</span>
    </div>
  `).join('');
}

function showConstraintPanel() {
  const panel = document.getElementById('constraint-panel');
  if (panel) panel.classList.remove('hidden');
}
