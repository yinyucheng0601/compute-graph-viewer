/* ═══════════════════════════════════════════════════════════════
   PyPTO IDE Assistant — Main Controller
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── Global State ──────────────────────────────────────────────
const IDE = {
  currentScenario: 'coding',
  aiPanelOpen: false,
  aspTab: 'chat',
};

// ── Scenario switching ─────────────────────────────────────────
function switchScenario(name) {
  if (IDE.currentScenario === name) return;

  // Deactivate old
  document.querySelectorAll('.scenario').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.ab-btn[data-scenario]').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tb-tab[data-scenario]').forEach(el => el.classList.remove('active'));

  // Activate new
  const sc = document.getElementById('scenario-' + name);
  if (sc) sc.classList.add('active');
  document.querySelectorAll(`[data-scenario="${name}"]`).forEach(el => el.classList.add('active'));

  IDE.currentScenario = name;

  // Update status bar
  const labels = { coding: 'Coding', precision: 'Precision Debug', swimlane: 'Perf Swimlane' };
  document.getElementById('sb-scenario').textContent = labels[name] || name;

  // Trigger scenario init if needed
  if (name === 'precision' && !window._graphInitialized) {
    setTimeout(initPrecisionGraph, 100);
    window._graphInitialized = true;
  }
  if (name === 'swimlane') {
    setTimeout(resizeSwimlaneCanvas, 50);
  }
}

// ── AI Panel ──────────────────────────────────────────────────
function toggleAIPanel() {
  IDE.aiPanelOpen = !IDE.aiPanelOpen;
  const panel = document.getElementById('ai-side-panel');
  if (IDE.aiPanelOpen) {
    panel.classList.remove('hidden');
    populateSnippets();
    populateDocs();
  } else {
    panel.classList.add('hidden');
  }
}

function switchAspTab(tab, btn) {
  IDE.aspTab = tab;
  document.querySelectorAll('.asp-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.asp-body').forEach(b => b.classList.add('hidden'));
  const panel = document.getElementById('asp-' + tab + '-panel');
  if (panel) panel.classList.remove('hidden');
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── Chat Handler ───────────────────────────────────────────────
const CHAT_CONTEXTS = {
  coding: {
    responses: [
      '根据你描述的规格，我建议使用 `TILE_A_MUL_B` + `TILE_COPY_IN` 的组合。L1 reuse 设为 A 矩阵可以减少 DDR 带宽压力。',
      '注意：当 K_tile > 256 时，L0A 可能溢出（64KB 限制）。建议将 K_tile 调整为 ≤ 128。',
      '已检测到 BF16 输出可能存在精度风险。建议在 `@pypto.frontend.jit` 装饰符的参数中添加 `precision_mode="allow_fp32_cpu_offload"`。',
      '生成 impl.py 时我会自动添加 `unroll_list=[1]` 和 `submit_before_loop=True` 以保证精度。你可以在生成后根据性能需求调整。',
    ]
  },
  precision: {
    responses: [
      '检测到 `TILE_A_MULACC_B` 算子的累积误差。这类算子在 BF16 模式下对尾数截断敏感，推荐应用 P1（frontend.jit）+ P3（unroll_list=[1]）策略。',
      '二分定位结果：精度误差在 Step 42~67 之间突变，很可能是 `softmax_div` 算子引入了数值溢出。请插入检查点验证。',
      '当前误差模式与 L0C 累加截断有关。建议检查 `TILE_A_MUL_B` 的输出 Tensor 是否在 `COPY_OUT` 前做了显式的类型转换。',
      '这个误差表现为整体偏移而非随机噪声，通常是 `inplace` 操作覆盖了中间结果导致的，请尝试 P2（inplace=False）。',
    ]
  },
  swimlane: {
    responses: [
      '分析完成：AIC 核 #7、#12、#18 存在明显 bubble，原因是上游 DMA 搬移任务链路过长，建议增大 `CubeNBuffer` 以填充等待间隙。',
      '负载方差较高，AIC 核平均利用率 78%，但有 3 个核利用率低于 50%。建议调整 tiling 参数使 task 更均匀分配。',
      '检测到 `TILE_L1_TO_L0A` 操作占用关键路径 23%，可以通过 `L1 reuse` 将重复搬移次数从 N 减少到 1。',
      'Vector 核与 Cube 核存在资源竞争。将 `AIV:AIC` 比例从 1:1 调整为 2:3 预计可提升整体吞吐 15%。',
    ]
  },
  global: {
    responses: [
      'PyPTO 的 `@pypto.frontend.jit` 装饰符会启用编译器的高精度模式，对矩阵乘法和向量累加算子效果最明显。',
      'DaVinci 架构的 L1 Buffer 为 1024KB，L0A/L0B 各 64KB，L0C 256KB。在设计 tiling 时需要保证三级 buffer 不溢出。',
      '精度调试的推荐流程：先用 `unroll_list=[1]` 关闭展开，如果误差消失则是展开顺序问题；如果误差依然存在，检查 inplace 操作。',
    ]
  }
};

const _chatCounters = {};

function sendChat(ctx) {
  const inputId = ctx + '-input';
  const chatId = ctx + '-chat';
  const input = document.getElementById(inputId);
  const chat = document.getElementById(chatId);
  if (!input || !input.value.trim()) return;

  const userText = input.value.trim();
  input.value = '';

  appendMsg(chat, 'user', userText);

  // Show typing indicator
  const typingId = 'typing-' + ctx + '-' + Date.now();
  appendTyping(chat, typingId);

  setTimeout(() => {
    removeTyping(typingId);
    const responses = (CHAT_CONTEXTS[ctx] || CHAT_CONTEXTS.global).responses;
    const idx = (_chatCounters[ctx] = ((_chatCounters[ctx] || 0) + 1) % responses.length);
    appendMsg(chat, 'ai', responses[idx]);
  }, 900 + Math.random() * 600);
}

function handleChatKey(event, ctx) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendChat(ctx);
  }
}

function appendMsg(container, role, text) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  const avatar = document.createElement('div');
  avatar.className = 'cm-avatar';
  avatar.textContent = role === 'ai' ? 'AI' : 'ME';
  const bubble = document.createElement('div');
  bubble.className = 'cm-bubble';
  bubble.innerHTML = text.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
  div.appendChild(avatar);
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTyping(container, id) {
  const div = document.createElement('div');
  div.className = 'chat-msg ai';
  div.id = id;
  div.innerHTML = '<div class="cm-avatar">AI</div><div class="cm-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function clearChat(chatId) {
  const chat = document.getElementById(chatId);
  if (!chat) return;
  chat.innerHTML = '';
  const ctx = chatId.replace('-chat', '');
  appendMsg(chat, 'ai', 'Already cleared. Feel free to continue.');
}

// ── API Docs Data ──────────────────────────────────────────────
const API_DOCS = [
  { name: 'pypto.frontend.jit', desc: '将 kernel 函数 JIT 编译，启用精度优化路径', tags: ['precision','compile'], sig: '@pypto.frontend.jit\ndef kernel_func(...)' },
  { name: 'TILE_COPY_IN', desc: 'DDR → L1 / L1 → UB 数据搬移算子', tags: ['dma','memory'], sig: 'TILE_COPY_IN(src, dst, shape, dtype)' },
  { name: 'TILE_COPY_OUT', desc: 'L1/UB → DDR 写回算子', tags: ['dma','memory'], sig: 'TILE_COPY_OUT(src, dst, shape, dtype)' },
  { name: 'TILE_L1_TO_L0A', desc: 'L1 → L0A 数据搬移（Cube A 矩阵输入）', tags: ['dma','cube'], sig: 'TILE_L1_TO_L0A(l1_buf, l0a_buf, m, k)' },
  { name: 'TILE_L1_TO_L0B', desc: 'L1 → L0B 数据搬移（Cube B 矩阵输入）', tags: ['dma','cube'], sig: 'TILE_L1_TO_L0B(l1_buf, l0b_buf, k, n)' },
  { name: 'TILE_A_MUL_B', desc: 'Cube 矩阵乘：L0A × L0B → L0C', tags: ['cube','gemm'], sig: 'TILE_A_MUL_B(l0a, l0b, l0c, m, k, n)' },
  { name: 'TILE_A_MULACC_B', desc: 'Cube 矩阵乘累加：L0C += L0A × L0B', tags: ['cube','gemm'], sig: 'TILE_A_MULACC_B(l0a, l0b, l0c, m, k, n)' },
  { name: 'TILE_MULS', desc: 'UB 向量标量乘法', tags: ['vector','ub'], sig: 'TILE_MULS(src, scalar, dst, count)' },
  { name: 'TILE_ADD', desc: 'UB 向量逐元素加法', tags: ['vector','ub'], sig: 'TILE_ADD(src0, src1, dst, count)' },
  { name: 'loop_unroll', desc: '控制循环展开次数，影响性能与精度', tags: ['perf','precision'], sig: 'loop_unroll=N  # 0=auto, 1=disable' },
];

function populateDocs(filter = '') {
  const list = document.getElementById('docs-list');
  if (!list) return;
  const lower = filter.toLowerCase();
  const filtered = filter ? API_DOCS.filter(d =>
    d.name.toLowerCase().includes(lower) || d.desc.toLowerCase().includes(lower) || d.tags.some(t => t.includes(lower))
  ) : API_DOCS;

  list.innerHTML = filtered.map(d => `
    <div class="doc-item" onclick="insertApiSnippet('${d.name}')">
      <div class="doc-item-name">${d.name}</div>
      <div class="doc-item-desc">${d.desc}</div>
      ${d.tags.map(t => `<span class="doc-item-tag">${t}</span>`).join('')}
    </div>
  `).join('');
}

function searchDocs(val) { populateDocs(val); }

function insertApiSnippet(name) {
  const doc = API_DOCS.find(d => d.name === name);
  if (!doc) return;
  showToast(`已复制 ${name} 签名`, 'success');
  try { navigator.clipboard.writeText(doc.sig); } catch(e) {}
}

// ── Code Snippets ──────────────────────────────────────────────
const SNIPPETS = [
  {
    name: 'GEMM kernel 模板',
    preview: '@pypto.frontend.jit\ndef gemm_kernel(a, b, c):',
    code: `@pypto.frontend.jit
def gemm_kernel(a_mat: BF16[M, K], b_mat: BF16[K, N], c_mat: FP32[M, N]):
    with pypto.scope("L1"):
        a_l1 = TILE_COPY_IN(a_mat, shape=[M_TILE, K])
        b_l1 = TILE_COPY_IN(b_mat, shape=[K, N_TILE])
    with pypto.scope("L0"):
        a_l0a = TILE_L1_TO_L0A(a_l1, m=M_TILE, k=K)
        b_l0b = TILE_L1_TO_L0B(b_l1, k=K, n=N_TILE)
        c_l0c = TILE_A_MUL_B(a_l0a, b_l0b, m=M_TILE, k=K, n=N_TILE)
    TILE_COPY_OUT(c_l0c, c_mat)`
  },
  {
    name: 'SoftMax UB kernel',
    preview: 'def softmax_kernel(x, out):',
    code: `def softmax_kernel(x: BF16[N], out: BF16[N]):
    x_ub = TILE_COPY_IN(x, shape=[N])          # DDR → UB
    max_val = TILE_REDUCE_MAX(x_ub, axis=0)     # max for stability
    x_sub = TILE_SUB(x_ub, max_val)             # x - max
    x_exp = TILE_EXP(x_sub)                     # exp(x - max)
    x_sum = TILE_REDUCE_SUM(x_exp, axis=0)      # sum
    x_div = TILE_DIVS(x_exp, x_sum)             # / sum
    TILE_COPY_OUT(x_div, out)`
  },
  {
    name: 'L1 reuse 循环',
    preview: 'for n_tile in range(N // N_TILE):',
    code: `# L1 reuse: A matrix fixed in L1, iterate over N tiles
a_l1 = TILE_COPY_IN(a_mat[m_start:m_start+M_TILE, :], shape=[M_TILE, K])
a_l0a = TILE_L1_TO_L0A(a_l1, m=M_TILE, k=K)

for n_tile in range(N // N_TILE):
    n_start = n_tile * N_TILE
    b_l1 = TILE_COPY_IN(b_mat[:, n_start:n_start+N_TILE], shape=[K, N_TILE])
    b_l0b = TILE_L1_TO_L0B(b_l1, k=K, n=N_TILE)
    c_l0c = TILE_A_MUL_B(a_l0a, b_l0b, m=M_TILE, k=K, n=N_TILE)
    TILE_COPY_OUT(c_l0c, c_mat[m_start:m_start+M_TILE, n_start:n_start+N_TILE])`
  },
];

function populateSnippets() {
  const list = document.getElementById('snippet-list');
  if (!list || list.children.length > 0) return;
  list.innerHTML = SNIPPETS.map((s, i) => `
    <div class="snippet-item" onclick="copySnippet(${i})">
      <div class="snippet-name">${s.name}</div>
      <div class="snippet-preview">${escapeHtml(s.preview)}</div>
    </div>
  `).join('');
}

function copySnippet(idx) {
  try { navigator.clipboard.writeText(SNIPPETS[idx].code); } catch(e) {}
  showToast('代码片段已复制', 'success');
}

// ── Utilities ──────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function copyCode(paneId) {
  const pane = document.getElementById(paneId);
  if (!pane) return;
  const text = pane.querySelectorAll('.line');
  const code = text.length > 0
    ? Array.from(text).map(l => l.textContent).join('\n')
    : pane.textContent;
  try { navigator.clipboard.writeText(code); showToast('代码已复制', 'success'); }
  catch(e) { showToast('复制失败', 'error'); }
}

function switchCodeTab(tab, btn) {
  document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.code-pane').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const pane = document.getElementById('code-' + tab);
  if (pane) pane.classList.add('active');
}

// ── Tensor Row Management ──────────────────────────────────────
let _inputTensorIdx = 2, _outputTensorIdx = 1;

function addInputTensor() {
  const list = document.getElementById('input-tensors-list');
  const row = createTensorRow(_inputTensorIdx++, false);
  list.appendChild(row);
}
function addOutputTensor() {
  const list = document.getElementById('output-tensors-list');
  const row = createTensorRow(_outputTensorIdx++, true);
  list.appendChild(row);
}
function removeTensor(btn) {
  const row = btn.closest('.tensor-row');
  if (row) row.remove();
}
function createTensorRow(idx, isOut) {
  const div = document.createElement('div');
  div.className = 'tensor-row' + (isOut ? ' out-row' : '');
  div.dataset.idx = idx;
  div.innerHTML = `
    <input class="ti-name" placeholder="${isOut ? 'output' : 'input'}_${idx}" value="">
    <select class="ti-dtype">
      ${isOut ? '<option>FP32</option><option>BF16</option><option>FP16</option><option>INT32</option>'
              : '<option>BF16</option><option>FP16</option><option>FP32</option><option>INT8</option>'}
    </select>
    <input class="ti-shape" placeholder="[D,...]" value="">
    <button class="ti-del" onclick="removeTensor(this)">✕</button>`;
  return div;
}

// ── Radio group click handler ──────────────────────────────────
document.addEventListener('click', function(e) {
  const opt = e.target.closest('.radio-opt');
  if (!opt) return;
  const group = opt.closest('.radio-group');
  if (!group) return;
  group.querySelectorAll('.radio-opt').forEach(o => o.classList.remove('active'));
  opt.classList.add('active');
  const input = opt.querySelector('input[type="radio"]');
  if (input) input.checked = true;
});

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Drag & drop on profile area
  const dropArea = document.getElementById('profile-drop');
  if (dropArea) {
    dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('drag-over'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
    dropArea.addEventListener('drop', e => {
      e.preventDefault();
      dropArea.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleProfileFile(file);
    });
  }
});

function handleProfileFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (window.loadProfileData) loadProfileData(data);
    } catch(err) {
      showToast('文件解析失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function loadProfile(input) {
  const file = input.files[0];
  if (file) handleProfileFile(file);
}
