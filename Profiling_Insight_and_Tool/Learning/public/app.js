const $ = (selector) => document.querySelector(selector);

const state = {
  allCards: [],
  deck: [],
  index: 0,
  selectedChapters: new Set(),
  saved: new Set(JSON.parse(localStorage.getItem('pocket-saved') || '[]')),
  doubted: new Set(JSON.parse(localStorage.getItem('pocket-doubted') || '[]')),
  mastered: new Set(JSON.parse(localStorage.getItem('pocket-mastered') || '[]')),
  todayCount: Number(localStorage.getItem(todayKey()) || 0),
  touchStartY: 0,
  touchStartX: 0,
  animating: false
};

function todayKey() {
  return `pocket-count-${new Date().toISOString().slice(0, 10)}`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function inline(text) {
  const protectedParts = [];
  const protect = (value) => {
    const index = protectedParts.push(value) - 1;
    return `\uE000${index}\uE001`;
  };
  const protectedText = text
    .replace(/`([^`]+)`/g, (_, code) => protect(`<code>${escapeHtml(code)}</code>`))
    .replace(/\\\(.+?\\\)|\\\[.+?\\\]|\$\$.+?\$\$|\$(?!\s)(?:\\.|[^$])+?\$/g, formula => protect(escapeHtml(formula)));

  return escapeHtml(protectedText)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\uE000(\d+)\uE001/g, (_, index) => protectedParts[Number(index)]);
}

function renderMarkdown(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let list = null;
  let quote = [];
  let code = [];
  let inCode = false;
  let table = [];
  let mathBlock = null;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map(x => `<p>${inline(x)}</p>`).join('')}</blockquote>`); quote = []; } };
  const closeTable = () => {
    if (table.length) {
      const rows = table.filter(row => !/^\s*\|?\s*:?-+/.test(row));
      const html = rows.map((row, i) => {
        const cells = row.replace(/^\||\|$/g, '').split('|');
        const tag = i === 0 ? 'th' : 'td';
        return `<tr>${cells.map(cell => `<${tag}>${inline(cell.trim())}</${tag}>`).join('')}</tr>`;
      }).join('');
      out.push(`<div class="table-wrap"><table>${html}</table></div>`);
      table = [];
    }
  };
  const flush = () => { closeList(); closeQuote(); closeTable(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (mathBlock) {
      if (line.trim() === mathBlock.close) {
        const formula = `${mathBlock.open}\n${mathBlock.lines.join('\n')}\n${mathBlock.close}`;
        out.push(`<div class="math-block">${escapeHtml(formula)}</div>`);
        mathBlock = null;
      } else {
        mathBlock.lines.push(raw);
      }
      continue;
    }
    if (line.trim().startsWith('```')) {
      flush();
      if (inCode) { out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(raw); continue; }
    if (line.trim() === '$$' || line.trim() === '\\[') {
      flush();
      mathBlock = { open: line.trim(), close: line.trim() === '$$' ? '$$' : '\\]', lines: [] };
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line)) { closeList(); closeQuote(); table.push(line.trim()); continue; }
    closeTable();
    if (/^>/.test(line)) { closeList(); quote.push(line.replace(/^>\s?/, '')); continue; }
    closeQuote();
    const li = line.match(/^\s*([-*]|\d+\.)\s+(.+)$/);
    if (li) {
      const type = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== type) { closeList(); list = type; out.push(`<${type}>`); }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim() || /^---+$/.test(line.trim())) continue;
    out.push(`<p>${inline(line.trim())}</p>`);
  }
  flush();
  if (code.length) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  if (mathBlock) out.push(`<p>${escapeHtml([mathBlock.open, ...mathBlock.lines].join('\n'))}</p>`);
  return out.join('');
}

function renderMath(container) {
  if (typeof renderMathInElement !== 'function') return;
  renderMathInElement(container, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false }
    ],
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    throwOnError: false,
    strict: 'ignore'
  });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function persist() {
  localStorage.setItem('pocket-saved', JSON.stringify([...state.saved]));
  localStorage.setItem('pocket-doubted', JSON.stringify([...state.doubted]));
  localStorage.setItem('pocket-mastered', JSON.stringify([...state.mastered]));
  localStorage.setItem(todayKey(), state.todayCount);
  $('#masteredCount').textContent = state.mastered.size;
  $('#masteredCollectionCount').textContent = state.mastered.size;
  $('#savedCount').textContent = state.saved.size;
  $('#doubtedCount').textContent = state.doubted.size;
  $('#streakCount').textContent = state.todayCount;
}

function reconcileProgress() {
  const valid = new Set(state.allCards.map(card => card.id));
  state.saved = new Set([...state.saved].filter(id => valid.has(id)));
  state.doubted = new Set([...state.doubted].filter(id => valid.has(id)));
  state.mastered = new Set([...state.mastered].filter(id => valid.has(id)));
  persist();
}

function currentCard() { return state.deck[state.index]; }

function showCard(direction = 'next') {
  const card = currentCard();
  if (!card) return;
  const el = $('#knowledgeCard');
  el.classList.remove('exit-left', 'exit-right', 'enter-next', 'enter-previous');
  $('#cardIndex').textContent = `CARD ${String(state.index + 1).padStart(3, '0')}`;
  $('#breadcrumb').textContent = `${card.chapter}  /  ${card.section}`;
  $('#cardTitle').textContent = card.title;
  const cardContent = $('#cardContent');
  cardContent.innerHTML = renderMarkdown(card.body);
  renderMath(cardContent);
  cardContent.scrollTop = 0;
  $('#readTime').textContent = `约 ${Math.max(1, Math.ceil(card.body.length / 420))} 分钟`;
  $('#progressText').textContent = `${state.index + 1} / ${state.deck.length}`;
  $('#progressBar').style.width = `${((state.index + 1) / state.deck.length) * 100}%`;
  $('#saveButton').classList.toggle('active', state.saved.has(card.id));
  $('#saveButton span').textContent = state.saved.has(card.id) ? '♥' : '♡';
  $('#doubtButton').classList.toggle('active', state.doubted.has(card.id));
  $('#doubtButton').setAttribute('aria-label', state.doubted.has(card.id) ? '取消存疑' : '标记为存疑');
  $('#masterButton').classList.toggle('mastered', state.mastered.has(card.id));
  $('#masterButton').innerHTML = state.mastered.has(card.id) ? '<span>✓</span>已掌握' : '<span>✓</span>我掌握了';
  $('#previousButton').disabled = state.index === 0;
  el.classList.add(direction === 'previous' ? 'enter-previous' : 'enter-next');
  state.animating = false;
}

function navigate(step) {
  if (state.animating || !state.deck.length) return;
  if (step < 0 && state.index === 0) { toast('已经是第一张了'); return; }
  state.animating = true;
  const el = $('#knowledgeCard');
  el.classList.add(step > 0 ? 'exit-left' : 'exit-right');
  setTimeout(() => {
    state.index = step > 0 ? (state.index + 1) % state.deck.length : state.index - 1;
    if (step > 0) state.todayCount += 1;
    persist();
    showCard(step > 0 ? 'next' : 'previous');
  }, 210);
}

function start(mode = 'all') {
  const selected = state.selectedChapters.size
    ? state.allCards.filter(card => state.selectedChapters.has(card.chapter))
    : state.allCards;
  const pools = {
    all: selected,
    unmastered: selected.filter(card => !state.mastered.has(card.id)),
    mastered: selected.filter(card => state.mastered.has(card.id)),
    saved: selected.filter(card => state.saved.has(card.id)),
    doubted: selected.filter(card => state.doubted.has(card.id))
  };
  const pool = pools[mode] || selected;
  if (!pool.length) {
    const messages = { unmastered: '太棒了，这些卡片都掌握了', mastered: '还没有已掌握的卡片', saved: '收藏夹还是空的', doubted: '还没有存疑的卡片' };
    toast(messages[mode] || '当前筛选没有卡片');
    return;
  }
  state.deck = shuffle(pool);
  state.index = 0;
  $('#dashboard').hidden = true;
  $('#study').hidden = false;
  showCard();
}

function goHome() {
  $('#study').hidden = true;
  $('#dashboard').hidden = false;
  persist();
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1600);
}

function buildFilters() {
  const counts = new Map();
  state.allCards.forEach(card => counts.set(card.chapter, (counts.get(card.chapter) || 0) + 1));
  $('#filterOptions').innerHTML = [...counts].map(([chapter, count], index) => `
    <label class="filter-option">
      <input type="checkbox" value="${escapeHtml(chapter)}" ${state.selectedChapters.has(chapter) || !state.selectedChapters.size ? 'checked' : ''} />
      <span>${escapeHtml(chapter)}</span><small>${count} 张</small>
    </label>`).join('');
}

function openSheet() {
  buildFilters();
  $('#sheetBackdrop').hidden = false;
  $('#filterSheet').setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => $('#filterSheet').classList.add('open'));
}

function closeSheet() {
  $('#filterSheet').classList.remove('open');
  $('#filterSheet').setAttribute('aria-hidden', 'true');
  setTimeout(() => { $('#sheetBackdrop').hidden = true; }, 300);
}

async function init() {
  persist();
  try {
    let data = window.__CARDS__;
    if (location.protocol !== 'file:') {
      try {
        let response = await fetch('./api/cards', { cache: 'no-store' });
        if (!response.ok) response = await fetch('./cards.json');
        if (response.ok) data = await response.json();
      } catch { /* Use the embedded offline snapshot. */ }
    }
    if (!data?.cards?.length) throw new Error('没有找到离线知识卡数据');
    state.allCards = data.cards;
    reconcileProgress();
    $('#totalCount').textContent = data.cards.length;
    const date = new Date(data.modifiedAt).toLocaleDateString('zh-CN');
    $('#syncNote').textContent = location.protocol === 'file:'
      ? `离线可用 · 知识快照更新于 ${date}`
      : `已同步 · ${date} 更新 · 每次刷新自动读取原文`;
    if (location.hash === '#study') start('all');
  } catch (error) {
    $('#syncNote').textContent = error.message;
    $('#syncNote').style.color = '#b5482d';
  }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

$('#startButton').addEventListener('click', () => start('all'));
$('#reviewButton').addEventListener('click', () => start('unmastered'));
$('#savedButton').addEventListener('click', () => start('saved'));
$('#doubtedButton').addEventListener('click', () => start('doubted'));
$('#masteredButton').addEventListener('click', () => start('mastered'));
$('#masteredStat').addEventListener('click', () => start('mastered'));
$('#previousButton').addEventListener('click', () => navigate(-1));
$('#nextButton').addEventListener('click', () => navigate(1));
$('#homeButton').addEventListener('click', goHome);
$('#filterButton').addEventListener('click', openSheet);
$('#closeSheet').addEventListener('click', closeSheet);
$('#sheetBackdrop').addEventListener('click', closeSheet);
$('#applyFilter').addEventListener('click', () => {
  const checked = [...document.querySelectorAll('.filter-option input:checked')].map(input => input.value);
  state.selectedChapters = checked.length === document.querySelectorAll('.filter-option input').length ? new Set() : new Set(checked);
  closeSheet();
  toast(`已选择 ${checked.length} 个范围`);
});
$('#saveButton').addEventListener('click', () => {
  const id = currentCard().id;
  state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
  persist(); showCard();
  toast(state.saved.has(id) ? '已收藏' : '已取消收藏');
});
$('#doubtButton').addEventListener('click', () => {
  const id = currentCard().id;
  state.doubted.has(id) ? state.doubted.delete(id) : state.doubted.add(id);
  persist(); showCard();
  toast(state.doubted.has(id) ? '已标记为存疑' : '已取消存疑');
});
$('#masterButton').addEventListener('click', () => {
  const id = currentCard().id;
  if (state.mastered.has(id)) state.mastered.delete(id); else state.mastered.add(id);
  persist(); showCard();
  toast(state.mastered.has(id) ? '记住了，继续保持' : '已移回待复习');
});
$('#againButton').addEventListener('click', () => {
  $('#cardContent').scrollTo({ top: 0, behavior: 'smooth' });
  const cardsRemaining = state.deck.length - state.index - 1;
  if (cardsRemaining >= 10) {
    state.deck.splice(state.index + 11, 0, currentCard());
    toast('已安排在 10 张卡片之后');
  } else {
    toast('已安排到下一轮再看');
  }
});

const stage = $('#cardStage');
stage.addEventListener('touchstart', (event) => {
  state.touchStartY = event.changedTouches[0].clientY;
  state.touchStartX = event.changedTouches[0].clientX;
}, { passive: true });
stage.addEventListener('touchend', (event) => {
  const dy = event.changedTouches[0].clientY - state.touchStartY;
  const dx = event.changedTouches[0].clientX - state.touchStartX;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.35) {
    if (dx < 0) navigate(1);
    if (dx > 0) navigate(-1);
  }
}, { passive: true });
window.addEventListener('keydown', (event) => {
  if ($('#study').hidden) return;
  if (event.key === 'ArrowRight') navigate(1);
  if (event.key === 'ArrowLeft') navigate(-1);
});

init();
