// 智能对话:训练场景 AI 助手,右上角 #trainChatToggle 打开,默认收起(见 training-monitoring-v2.html
// 里的 #trainChatPanel)。参考 MindStudioNext 的右侧 AI 对话 inspector(前端直连 DeepSeek API、
// 用户自带 Key、按浏览器/天限额),但系统提示改为围绕当前训练运行(模型/step/loss/MFU/已定位问题)
// 作答,而不是解读离线性能分析报告。训练态由 training-run-twin.js 暴露的 window.twinGetTrainingContext()
// 实时读取,本文件不维护自己的训练状态副本。
(function () {
  const $ = (id) => document.getElementById(id);

  const DEEPSEEK = {
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    temperature: 0.3,
  };
  const KEY_STORE = 'pto_train_chat_deepseek_key';
  const QUOTA_STORE = 'pto_train_chat_daily_quota';
  const DAILY_LIMIT = 20;

  // 「消息设置」「调整图表」是固定脚本演示(见 runReminderSetupScenario/runChartAdjustScenario),
  // 其余走真实 DeepSeek 对话(sendMessage)。
  const QUICK_SUGGESTIONS = [
    { label: '消息设置', run: () => runReminderSetupScenario() },
    { label: '调整图表', run: () => runChartAdjustScenario() },
    { label: '现在训练进展怎么样？', run: (label) => sendMessage(label) },
    { label: '当前有哪些问题需要关注？', run: (label) => sendMessage(label) },
    { label: 'loss 和 MFU 正常吗？', run: (label) => sendMessage(label) },
    { label: '这些问题该先处理哪个？', run: (label) => sendMessage(label) },
  ];

  let chatHistory = [];
  let chatStreaming = false;
  let chartsOverrideActive = false; // 「调整图表」演示是否已把精度栏换成新指标,关闭面板时据此还原

  // ── 首屏欢迎语打字机效果:只要还停在欢迎屏(未开始对话),每次打开抽屉都重新播放一遍。
  // 用一个自增 token 标记"当前是第几轮打字"——如果面板被快速关了又开、上一轮的 setTimeout
  // 链还没跑完,旧的 step() 发现自己的 token 已经过期就直接放弃,不会跟新一轮抢着写同一个
  // 已被清空重建的 cursor 节点(避免 insertAdjacentText 在已脱离文档的节点上报错)。 ──
  const WELCOME_TEXT = '我可以帮你诊断问题、修改配置、定制面板。';
  let typewriterToken = 0;

  function typeWelcomeText(el, text) {
    const token = ++typewriterToken;
    el.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'wzh-chat-typewriter-cursor';
    el.appendChild(cursor);
    let i = 0;
    (function step() {
      if (token !== typewriterToken) return;
      if (i < text.length) {
        cursor.insertAdjacentText('beforebegin', text[i]);
        i += 1;
        setTimeout(step, 32);
      } else {
        setTimeout(() => { if (token === typewriterToken) cursor.remove(); }, 1200);
      }
    })();
  }

  function playWelcomeTypewriter() {
    const el = document.querySelector('#trainChatMessages .wzh-chat-welcome-text');
    if (!el) return;
    typeWelcomeText(el, WELCOME_TEXT);
  }

  // 每次打开抽屉,描边+阴影跑一圈双头光(见 .is-glow-sweep 相关 CSS);先移除类名强制回流,
  // 再加回去,保证连续多次打开也能重新播放(而不是只在 class 第一次加上时触发一次)。
  function triggerOpenGlow(panel) {
    panel.classList.remove('is-glow-sweep');
    void panel.offsetWidth;
    panel.classList.add('is-glow-sweep');
  }

  function getApiKey() { return (localStorage.getItem(KEY_STORE) || '').trim(); }
  function setApiKey(k) {
    if (k) localStorage.setItem(KEY_STORE, k.trim());
    else localStorage.removeItem(KEY_STORE);
    updateKeyUI();
  }

  // 弹窗设置/修改 Key,返回最新 key;留空确定可清除已保存的 Key。
  window.promptTrainChatApiKey = function () {
    const cur = getApiKey();
    const k = window.prompt(
      '请输入你自己的 DeepSeek API Key（以 sk- 开头）：\n\n' +
      '· 仅保存在你当前浏览器（localStorage），除了直接发给 DeepSeek 官方接口外不会上传到任何地方。\n' +
      '· 在 https://platform.deepseek.com 申请。\n' +
      '· 留空并确定可清除已保存的 Key。',
      cur
    );
    if (k === null) return cur;
    setApiKey(k);
    return getApiKey();
  };

  // Key 状态改用抽屉右上角齿轮按钮承载(见 #trainChatKeyBtn):按钮本身即入口,
  // 配置与否只通过图标颜色(.is-configured)和 title/aria-label 文案区分,不再单独占一行。
  function updateKeyUI() {
    const has = !!getApiKey();
    const btn = $('trainChatKeyBtn');
    if (btn) {
      btn.classList.toggle('is-configured', has);
      btn.title = has ? '设置 DeepSeek API Key（已配置）' : '设置 DeepSeek API Key（未配置）';
      btn.setAttribute('aria-label', btn.title);
    }
  }

  // ── 每日问答额度(纯前端,按浏览器/天;软限制,清缓存/无痕即可绕过,如需硬限制需配合后端)──
  // 额度条 UI 已去掉,这里只保留限额判定本身(sendMessage 里读 quotaLeft() 拦截超额提问)。
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function getQuota() {
    let q;
    try { q = JSON.parse(localStorage.getItem(QUOTA_STORE) || '{}'); } catch (e) { q = {}; }
    if (q.date !== todayStr()) q = { date: todayStr(), count: 0 };
    return q;
  }
  function quotaUsed() { return getQuota().count; }
  function quotaLeft() { return Math.max(0, DAILY_LIMIT - quotaUsed()); }
  function bumpQuota() {
    const q = getQuota();
    q.count += 1;
    localStorage.setItem(QUOTA_STORE, JSON.stringify(q));
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 极简 Markdown 渲染:本仓库页面不接 CDN 依赖以保持离线可用,这里只覆盖聊天回复常见的
  // 标题/加粗/行内代码/代码块/列表/段落。先整体转义再拼 HTML,模型或用户输入里的尖括号
  // 不会被当成标签解析。
  function renderMarkdown(text) {
    const lines = escHtml(text).split('\n');
    const out = [];
    let inCode = false, codeBuf = [];
    let listBuf = [], listType = null;
    function flushList() {
      if (!listBuf.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      out.push('<' + tag + '>' + listBuf.map((li) => '<li>' + li + '</li>').join('') + '</' + tag + '>');
      listBuf = []; listType = null;
    }
    function inline(s) {
      return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }
    // GFM 管道表格支持(「调整图表」演示场景的回答里要用表格罗列替换前后 + 提取结果)。
    function isSeparatorRow(line) {
      return /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line);
    }
    function splitRow(line) {
      let t = line.trim();
      if (t.startsWith('|')) t = t.slice(1);
      if (t.endsWith('|')) t = t.slice(0, -1);
      return t.split('|').map((c) => c.trim());
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim().startsWith('```')) {
        if (inCode) { out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>'); codeBuf = []; inCode = false; }
        else { flushList(); inCode = true; }
        i++; continue;
      }
      if (inCode) { codeBuf.push(line); i++; continue; }

      if (line.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
        flushList();
        const header = splitRow(line);
        let j = i + 2;
        const rows = [];
        while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
          rows.push(splitRow(lines[j]));
          j++;
        }
        out.push(
          '<table class="wzh-chat-table"><thead><tr>' +
          header.map((h2) => '<th>' + inline(h2) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>'
        );
        i = j; continue;
      }

      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) { flushList(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ol) { if (listType !== 'ol') flushList(); listType = 'ol'; listBuf.push(inline(ol[1])); i++; continue; }
      if (ul) { if (listType !== 'ul') flushList(); listType = 'ul'; listBuf.push(inline(ul[1])); i++; continue; }
      flushList();
      if (!line.trim()) { i++; continue; }
      out.push('<p>' + inline(line) + '</p>');
      i++;
    }
    flushList();
    if (inCode && codeBuf.length) out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
    return out.join('');
  }

  function getTrainingContext() {
    return typeof window.twinGetTrainingContext === 'function' ? window.twinGetTrainingContext() : null;
  }

  function buildSystemPrompt(ctx) {
    const nowStr = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
    if (!ctx) {
      return `你是 PTO（Ascend NPU 训练监控大盘）内置的 AI 助手。当前真实时间：${nowStr}。训练态数据暂未就绪，如实告知用户，不要编造具体数字。一律用中文回答，专业简洁。`;
    }
    const pct = ctx.totalSteps ? ((ctx.step / ctx.totalSteps) * 100).toFixed(1) : '--';
    const issuesText = (ctx.diagnosisMarkers || []).map((m) => {
      const stepText = m.stepFrom != null ? `step ${m.stepFrom}~${m.stepTo}` : `step ${m.step}`;
      return '- [问题' + m.num + ' · ' + String(m.severity).toUpperCase() + ' · ' + m.category + '] ' + stepText + '：' + m.label + '（' + m.sub + '）';
    }).join('\n');
    return `你是 PTO（Ascend NPU 训练监控大盘）内置的 AI 助手，服务对象是正在盯着这块训练监控大盘的算法/训练工程师。当前真实时间：${nowStr}。

当前监控的训练任务：
- 模型：${ctx.model.name}${ctx.model.summary ? '（' + ctx.model.summary + '）' : ''}
- 任务类型：${ctx.task}；并行策略：${ctx.model.parallel || '—'}；序列长度：${ctx.model.seq || '—'}；batch：${ctx.model.batch || '—'}
- 硬件规模：${ctx.hardwareLabel}
- 当前进度：step ${ctx.step.toLocaleString()} / ${ctx.totalSteps.toLocaleString()}（${pct}%）
- 实时指标：loss=${ctx.loss}（EMA ${ctx.lossEMA}）val_loss=${ctx.val}，MFU=${(ctx.mfu * 100).toFixed(1)}%
- 已训练 token 数：约 ${Number(ctx.seenTokens).toExponential(2)}
- 当前前向阶段：${ctx.phase}

本次训练已定位的问题（对应进度条上的标记，点击可查看详情与修复建议）：
${issuesText || '（暂无）'}

回答规则：
1. 先判断用户问题是否与"这次训练任务 / 当前这块监控大盘 / 上面列出的问题"相关。
   • 相关时（如"现在训练怎么样""loss 正常吗""MFU 达标吗""有哪些问题""这个问题怎么修""该不该继续跑"）：紧扣上方训练态和问题列表作答，以其中的数字为准，不编造未列出的数字或结论；确实没有涉及的就如实说"当前监控数据未涵盖"。
   • 用户说"这个/当前/这次 + 训练/任务/模型/step/问题"等指代，一律指上面这个正在监控的训练任务。
2. 与训练无关的常识、闲聊问题：直接简洁回答，不要硬扯到训练。
3. 一律用中文，专业、简洁，可用 Markdown（加粗/列表/代码块），先给结论再给依据。回答口吻像一位训练值班工程师在讨论当前这次训练，不要套用性能分析报告的模板措辞。`;
  }

  // 直接流式调用 DeepSeek;onToken(累积文本) 在每次增量到达时回调
  async function streamChat(messages, onToken) {
    const resp = await fetch(DEEPSEEK.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getApiKey(),
      },
      body: JSON.stringify({
        model: DEEPSEEK.model,
        messages,
        stream: true,
        temperature: DEEPSEEK.temperature,
      }),
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.json())?.error?.message || ''; } catch (e) { try { detail = await resp.text(); } catch (e2) { /* 忽略 */ } }
      if (resp.status === 401) throw new Error('API Key 无效或未授权（401）。请点右上角齿轮图标检查。');
      if (resp.status === 402) throw new Error('该 Key 对应账户余额不足（402）。');
      if (resp.status === 429) throw new Error('请求过于频繁或额度用尽（429），请稍后再试。');
      throw new Error(`HTTP ${resp.status}${detail ? '：' + detail : ''}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop();
      for (const line of parts) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onToken(full); }
        } catch (e) { /* 忽略心跳/不完整分片 */ }
      }
    }
    return full;
  }

  function appendUserMessage(text) {
    const msgEl = $('trainChatMessages');
    if (!msgEl) return;
    msgEl.querySelector('.wzh-chat-welcome')?.remove();
    const div = document.createElement('div');
    div.className = 'wzh-chat-message user';
    div.innerHTML = escHtml(text).replace(/\n/g, '<br>');
    msgEl.appendChild(div);
    msgEl.scrollTop = msgEl.scrollHeight;
  }

  // AI 回复统一走"头像行 + 缩进正文"外壳(不追加背景气泡——表格/卡片这类内容挤在有色
  // 气泡里会很难看),流式更新/脚本演示/错误提示都只需要改 bodyEl.innerHTML,头像行不用重建。
  function createAiMessageShell() {
    const div = document.createElement('div');
    div.className = 'wzh-chat-message ai';
    div.innerHTML =
      '<div class="wzh-chat-avatar-row">' +
        '<span class="wzh-chat-avatar"><svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"></path>' +
        '</svg></span>' +
        '<span class="wzh-chat-sender">PTO 助手</span>' +
      '</div>' +
      '<div class="wzh-chat-body-content"></div>';
    return { el: div, bodyEl: div.querySelector('.wzh-chat-body-content') };
  }

  function appendSystemNotice(text) {
    const msgEl = $('trainChatMessages');
    if (!msgEl) return;
    msgEl.querySelector('.wzh-chat-welcome')?.remove();
    const { el, bodyEl } = createAiMessageShell();
    bodyEl.innerHTML = renderMarkdown(text);
    msgEl.appendChild(el);
    msgEl.scrollTop = msgEl.scrollHeight;
  }

  function setChatBusy(busy) {
    document.querySelectorAll('.wzh-chat-suggestion').forEach((b) => { b.disabled = busy; });
    const sendBtn = $('trainChatSendBtn');
    if (sendBtn) sendBtn.disabled = busy;
    const newBtn = $('trainChatNewBtn');
    if (newBtn) newBtn.disabled = busy;
  }

  // 新建对话:按用户诉求只是"清空当前面板内容"——重置消息区回到欢迎屏 + 重放一次打字机效果,
  // 不触碰「调整图表」演示的精度栏覆盖(那个由关闭面板时的 revertChartsOverrideIfActive 负责)。
  function resetConversation() {
    if (chatStreaming) return;
    const msgEl = $('trainChatMessages');
    if (!msgEl) return;
    chatHistory = [];
    msgEl.innerHTML =
      '<div class="wzh-chat-welcome">' +
        '<svg class="wzh-chat-welcome-icon" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"></path>' +
        '</svg>' +
        '<div class="wzh-chat-welcome-text"></div>' +
      '</div>';
    playWelcomeTypewriter();
  }

  // ── 「消息设置」场景:固定的演示流程,不经 DeepSeek——用户已经把回答内容和消息预览卡片都
  // 写死了,这里按脚本直接渲染,既保证内容与产品设计一致,也不需要配置 API Key 就能演示。
  // 回答按「识别信息 → 给方案理由 → 具体方案 → 播报样例 → 确认已生效 + 邀请调整」的真实客服/
  // 运维助手套路分段,样例卡片是"任务开始运行约 6 小时后的第一次播报",不是当下这一刻的读数——
  // 任务还在排队,不能预览成"已经在跑"的样子,否则和上文的排队状态自相矛盾。──
  const REMINDER_TASK_NAME = 'openPanGu2.0flash预训练_v1';

  function buildReminderScenarioLeadMarkdown() {
    return `识别到"**${REMINDER_TASK_NAME}**"的基本信息：\n\n` +
      '- 类型：Pangu 预训练任务，预计总时长约 **5.6 天**\n' +
      '- 当前状态：排队中，预计约 **20 分钟**后开始\n' +
      '- 规模与风险：占用 **1000 张卡**，本次包含较多算法改动，重要性评级：**高**\n\n' +
      '结合规模和改动量，给你配置了一个强度相对较高的提醒方案：\n\n' +
      '- 定时播报：每 6 小时一次\n' +
      '- 事件通知：任务启动 / 结束 / checkpoint，额外单独提醒\n' +
      '- 异常升级：出现异常即刻通报 + 系统电话\n\n' +
      '播报内容固定包含：任务名、执行时长、step 进度、loss、acc、MFU、显存利用率。下面是任务运行约 6 小时后、第一次定时播报的样例：';
  }

  function buildReminderScenarioTailMarkdown() {
    return '已经配置好了，任务开始跑之后就会按这个节奏推送。如果强度太高，或者想加减播报字段，跟我说一下就行。';
  }

  function buildNotifyPreviewCard() {
    // 5.6 天 ≈ 134.4 小时的总时长下，运行 6 小时 12 分对应约 4.6% 进度（≈900 step/h）；
    // loss/acc 按本页 metricsAtStep() 的同款 acc≈1-loss/6 关系换算，避免"刚跑 6 小时"却
    // 展示成收敛后期读数的业务错误。
    const items = [
      { label: '执行时长', value: '6 小时 12 分' },
      { label: 'Step 进度', value: '5,570 / 120,000（4.6%）' },
      { label: 'loss', value: '3.862' },
      { label: 'acc', value: '35.7%' },
      { label: 'MFU', value: '53.8%' },
      { label: '显存利用率', value: '79.1%' },
    ];
    const itemsHtml = items.map((it) =>
      '<div class="wzh-chat-notify-item"><span class="wzh-chat-notify-item-label">' + escHtml(it.label) + '</span><span class="wzh-chat-notify-item-value">' + escHtml(it.value) + '</span></div>'
    ).join('');
    return '' +
      '<div class="wzh-chat-notify-card">' +
        '<div class="wzh-chat-notify-head">' +
          '<span class="wzh-chat-notify-app"><span class="wzh-chat-notify-app-dot">W</span>WeLink 消息提醒</span>' +
        '</div>' +
        '<div class="wzh-chat-notify-body">' +
          '<div class="wzh-chat-notify-task">' + escHtml(REMINDER_TASK_NAME) + '</div>' +
          '<div class="wzh-chat-notify-time">任务启动后约 6 小时 · 第 1 次定时播报</div>' +
          '<div class="wzh-chat-notify-grid">' + itemsHtml + '</div>' +
        '</div>' +
      '</div>';
  }

  function runReminderSetupScenario() {
    if (chatStreaming) return;
    const msgEl = $('trainChatMessages');
    if (!msgEl) return;

    const userText = '帮我给这个预训练任务开一下 Welink 提醒，这次改动比较大，我不想一直盯着页面。';
    appendUserMessage(userText);
    chatHistory.push({ role: 'user', content: userText });

    const { el: aiDiv, bodyEl } = createAiMessageShell();
    bodyEl.innerHTML = '<span class="wzh-chat-typing"><span></span><span></span><span></span></span>';
    msgEl.appendChild(aiDiv);
    msgEl.scrollTop = msgEl.scrollHeight;

    chatStreaming = true;
    setChatBusy(true);
    setTimeout(() => {
      const leadText = buildReminderScenarioLeadMarkdown();
      const tailText = buildReminderScenarioTailMarkdown();
      bodyEl.innerHTML = renderMarkdown(leadText) + buildNotifyPreviewCard() + renderMarkdown(tailText);
      chatHistory.push({ role: 'assistant', content: leadText + '\n\n' + tailText });
      chatStreaming = false;
      setChatBusy(false);
      msgEl.scrollTop = msgEl.scrollHeight;
    }, 650);
  }

  // ── 「调整图表」场景:同样固定脚本,不经 DeepSeek。用户的诉求不是单纯"想换个样式",而是先
  // 指出 precision/recall/f1(分类指标)和 rollout_actor_probs_pearson_corr(RL 后训练 rollout-actor
  // 概率相关系数)放在 task=pretrain 的预训练监控里本来就文不对题——这是本页 body[data-task]
  // 已经声明的真实业务背景,借这个不一致给"为什么要换"一个站得住脚的理由,而不是凭空定制。
  // 回答按「认同诊断 → 解释派生指标 → 表格列替换前/原因/替换后/提取结果 → 确认生效 + 邀请调整」
  // 的套路分段,随后调用 training-run-twin.js 暴露的 window.twinDemoApplyAccuracyOverride() 把
  // 精度栏真的换成新指标(复用真实图表引擎,不是截图/贴图)。演示场景,关闭面板时
  // revertChartsOverrideIfActive() 会调用 window.twinDemoResetAccuracyOverride() 还原成默认 8 图。──
  function buildChartAdjustReplyMarkdown() {
    return '你观察得对：当前任务是预训练（task=pretrain），precision / recall / f1 是分类任务的评估指标，rollout_actor_probs_pearson_corr 是 RL 后训练阶段（rollout 分布 vs actor 分布）才有意义的指标，放在预训练监控里确实文不对题，正好可以腾出来换成预训练更常看的指标。\n\n' +
      '另外核对了一下训练日志："数值 t 分布"这类字段没有直接埋点，是把逐层激活值分布拟合成 t 分布后算出来的自由度 ν——ν 越低说明数值尾部越重，越容易在 FP8 下溢出，正好能覆盖之前定位到的问题四（低精训练 loss 不收敛）。四项替换结果：\n\n' +
      '| 原图表 | 不适用原因 | 替换为 | 提取结果 |\n' +
      '| --- | --- | --- | --- |\n' +
      '| precision | 分类指标，预训练不适用 | WPLC val loss | 已从 eval 日志取到（每 500 step 一次） |\n' +
      '| recall | 分类指标，预训练不适用 | LAMBADA val loss | 已从 eval 日志取到（每 500 step 一次） |\n' +
      '| f1 | 分类指标，预训练不适用 | Z loss | 已从训练日志逐 step 取到 |\n' +
      '| rollout 相关系数 | RL 后训练指标，预训练不适用 | 数值 t 分布（ν） | 日志无直接字段，按激活值分布派生计算 |\n\n' +
      '已经帮你替换到精度栏了，左侧应该能看到新的 4 张图。如果这个组合不是你想要的，或者还想加别的指标，跟我说一声我再调；这是演示效果，关闭本对话框会自动还原成默认的 8 张。';
  }

  function runChartAdjustScenario() {
    if (chatStreaming) return;
    const msgEl = $('trainChatMessages');
    if (!msgEl) return;

    const userText = '精度栏里的 precision/recall/f1，还有个 rollout 相关系数，这些看着不像预训练任务该盯的指标（更像分类/RL 场景搬过来的）。能不能换成跟预训练更相关的：WPLC val loss、LAMBADA val loss、Z loss；另外还听说有个"数值 t 分布"的指标，不太确定具体是什么，麻烦帮我从训练日志里抽一下看看有没有。';
    appendUserMessage(userText);
    chatHistory.push({ role: 'user', content: userText });

    const { el: aiDiv, bodyEl } = createAiMessageShell();
    bodyEl.innerHTML = '<span class="wzh-chat-typing"><span></span><span></span><span></span></span>';
    msgEl.appendChild(aiDiv);
    msgEl.scrollTop = msgEl.scrollHeight;

    chatStreaming = true;
    setChatBusy(true);
    setTimeout(() => {
      const replyText = buildChartAdjustReplyMarkdown();
      bodyEl.innerHTML = renderMarkdown(replyText);
      chatHistory.push({ role: 'assistant', content: replyText });
      if (typeof window.twinDemoApplyAccuracyOverride === 'function') {
        chartsOverrideActive = !!window.twinDemoApplyAccuracyOverride();
      }
      chatStreaming = false;
      setChatBusy(false);
      msgEl.scrollTop = msgEl.scrollHeight;
    }, 700);
  }

  function revertChartsOverrideIfActive() {
    if (chartsOverrideActive && typeof window.twinDemoResetAccuracyOverride === 'function') {
      window.twinDemoResetAccuracyOverride();
    }
    chartsOverrideActive = false;
  }

  async function sendMessage(text) {
    if (!text || chatStreaming) return;
    const msgEl = $('trainChatMessages');
    if (!msgEl) return;

    if (!getApiKey()) {
      const k = window.promptTrainChatApiKey();
      if (!k) {
        appendUserMessage(text);
        appendSystemNotice('提示：还没有配置 DeepSeek API Key，无法对话。点右上角齿轮图标填入你自己的 key（sk- 开头）后再试。');
        return;
      }
    }

    if (quotaLeft() <= 0) {
      appendUserMessage(text);
      appendSystemNotice(`提示：今日问答已达上限（${DAILY_LIMIT} 次/天），请明天再来。`);
      return;
    }

    appendUserMessage(text);
    chatHistory.push({ role: 'user', content: text });

    const { el: aiDiv, bodyEl } = createAiMessageShell();
    bodyEl.innerHTML = '<span class="wzh-chat-typing"><span></span><span></span><span></span></span>';
    msgEl.appendChild(aiDiv);
    msgEl.scrollTop = msgEl.scrollHeight;

    const messages = [
      { role: 'system', content: buildSystemPrompt(getTrainingContext()) },
      ...chatHistory,
    ];

    chatStreaming = true;
    setChatBusy(true);
    try {
      const full = await streamChat(messages, (partial) => {
        bodyEl.innerHTML = renderMarkdown(partial);
        msgEl.scrollTop = msgEl.scrollHeight;
      });
      if (full && full.trim()) {
        chatHistory.push({ role: 'assistant', content: full });
        bumpQuota();
      } else {
        bodyEl.innerHTML = renderMarkdown('（未返回内容，请重试）');
      }
    } catch (e) {
      chatHistory.pop();
      const msg = (e && e.message) ? e.message : String(e);
      const hint = /Failed to fetch|NetworkError/i.test(msg)
        ? '网络请求失败：请检查网络连接，或确认 API Key 是否正确（点右上角齿轮图标）。'
        : msg;
      bodyEl.innerHTML = '错误：' + escHtml(hint);
    } finally {
      chatStreaming = false;
      setChatBusy(false);
      msgEl.scrollTop = msgEl.scrollHeight;
    }
  }

  function renderSuggestions() {
    const box = $('trainChatSuggestions');
    if (!box) return;
    box.innerHTML = '';
    QUICK_SUGGESTIONS.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wzh-chat-suggestion';
      btn.textContent = item.label;
      btn.addEventListener('click', () => item.run(item.label));
      box.appendChild(btn);
    });
  }

  function initPanelToggle() {
    const toggle = $('trainChatToggle');
    const panel = $('trainChatPanel');
    const closeBtn = $('trainChatCloseBtn');
    if (!toggle || !panel) return;

    function setOpen(open) {
      panel.classList.toggle('is-open', open);
      panel.setAttribute('aria-hidden', String(!open));
      toggle.classList.toggle('is-active', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-pressed', String(open));
      toggle.title = open ? '关闭智能对话' : '打开智能对话';
      toggle.setAttribute('aria-label', toggle.title);
      if (open) {
        triggerOpenGlow(panel);
        playWelcomeTypewriter();
      } else {
        revertChartsOverrideIfActive(); // 关闭对话框即撤销「调整图表」演示对精度栏的改动
      }
    }

    toggle.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
    closeBtn?.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) setOpen(false);
    });

    setOpen(false); // 默认收起
  }

  function initInput() {
    const input = $('trainChatInput');
    const sendBtn = $('trainChatSendBtn');
    if (!input || !sendBtn) return;
    function doSend() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      input.style.height = '';
      sendMessage(text);
    }
    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
    });
  }

  function initAnchorChip() {
    const nameEl = $('trainChatAnchorName');
    if (nameEl) nameEl.textContent = REMINDER_TASK_NAME;
  }

  function boot() {
    updateKeyUI();
    renderSuggestions();
    initPanelToggle();
    initInput();
    initAnchorChip();
    $('trainChatKeyBtn')?.addEventListener('click', () => window.promptTrainChatApiKey());
    $('trainChatNewBtn')?.addEventListener('click', resetConversation);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
