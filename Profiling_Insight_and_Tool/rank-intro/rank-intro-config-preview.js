(function(){
'use strict';

  /* ── 第 11 步：配置预览 ────────────────────────────────────────────
     照 config-relation-plane 那页的做法：左边一块表单改配置，右边的图跟着变。三样东西都是借的：
       · 表单照那页的 Model Architecture / MoE / Cluster 三个区排，一行两格，只留首屏那几格（EP 口径做成一格二选一）——
         每格的「高级选项」折叠、「配置」预设下拉、底部的对话输入框都不要；
       · 图就是第 10 步那块展平画布（RI.plane 借出来画到本案例自己的 canvas 上，画法一行没抄），
         左栏「训练配置 / 整网图」页签中的整网图则直接挂载那页的 model-architecture-3d-deck 组件，
         点一个结点，右边矩阵里该实例所属的单个 Layer 列亮起——整网图与矩阵同时在屏上；
       · 右栏复用 M3.makeSide 造的通用 Rank 放大卡 + 读数，容量随卡型号换。
     配置 → 图的口径：矩阵画的永远是**最近一组自洽的配置**（lastValid）；校验不过就升红横幅、图停更
     （照那页 renderConfigError 的「图形已暂停更新，仍显示上一组自洽的参数」），横幅给建议修法与
     「一键应用 / 取消修改」两个出口。口径三档（切出 / 正交 / MindFormers）切换时卡数不变，只换算 DP。
     模型是本页那套 128 卡配置的缩样（PP4 × DP8 × CP2 × TP2、EP4、MBS2、GA8；
     48 层，前两层 Dense、后 46 层 MoE，64 个路由专家）。
     五段自动播，配置每段从基线重来，查询上下文连续传递（段控点哪段就只播放一次）：
       ① 配置联动：EP 口径切到正交，DP 8 → 2 自动换算、那格闪一下，矩阵左尺换字；切回后再把 PP 4 → 8，
          Total Rank / World Size 由 128 实时变为 256，矩阵同步重排，最后 PP 8 → 4 回到 128；
       ② 内存可视：选中 R23，先把 Micro Batch 2 → 4，展示激活与总占用本身上涨；再把卡型号切到 64 GB——
          账不再变化、容量框变矮，柱子涨过容量线，矩阵上装不下的格子填浅红，取消后回到 128 GB；
       ③ 算子查询：左栏切到整网图，先点 Final RMSNorm，只亮输出端 Norm；再点 EP Combine，只亮当前实例所在的 Layer 24；
       ④ 专家查询：从 Layer 24 单列点到 R23 × L7 单格，再放大到「计算图」那一档，Expert Compute 里是 E16–E31；
       ⑤ 配置校验：DP 手输 2，2 除不尽 EP 4 → 配置建议；联动 EP 4 → 2、PP 4 → 8，
          一键应用后 Total Rank 64，并按新口径重排。 */
window.createRIConfigPreview = function(deps){
    var PR = deps.PR, SIDE = deps.SIDE, DemoPointer = deps.DemoPointer;
    var MEMORY_HEAT_LIGHT = [[0,226,232,244],[.22,166,186,230],[.44,160,130,210],[.64,196,88,158],[.82,226,68,84],[1,255,124,46]];
    function clamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }
    var RI = window.RI, PLN = RI && RI.plane; if(!PLN) return null;
    var PLC = PLN.PL, BLUE = PLN.BLUE, GiB = RI.GiB, DENSE = 2;   /* 右列复用通用 Rank 详情栏 */
    var CARDS = {'910b-32':{label:'昇腾 910 · 32 GB', hbm:32}, '910b-64':{label:'昇腾 910B · 64 GB', hbm:64}, '950':{label:'昇腾 950PR · 128 GB', hbm:128}};
    var CARD_ORDER = ['910b-32', '910b-64', '950'];
    var BASE = {layers:48, dp:8, pp:4, tp:2, cp:2, mode:'split', routed:64, topk:8, shared:1, ep:4, card:'950', mbs:2, seq:8192, ga:8};
    var HIDDEN = 4096;
    /* 字段规格：规范值（标签、pow2、量程）来自共享规则层的 FIELD_SPECS —— 与
       config-relation-plane 同一份，pow2 = 加减键按 2 的幂走，手输可以是任意整数。
       第二个参数是**本案例刻意的收窄**，写在这里是为了让分歧看得见：本案例是 128 卡
       量级的缩样，TP / CP 上界收到 16（那页是 64）、Total Rank 下界抬到 8（整机一台）、
       Seq Length 上界放到 262144。不覆盖的键一律跟着规范值走。
       ⚠️ 键名仍用本案例的短名（layers / routed / topk / mbs / seq），只有查规范值时
       映射到共享层的名字；改短名会牵动本案例上百处 data-f。 */
    function spec(field, lb, over){ var s = PR.specOf(field, over) || {}; return {lb:lb || s.label, min:s.min, max:s.max, pow2:s.pow2}; }
    var F = {layers:spec('totalLayer'), dp:spec('dp'), pp:spec('pp'),
             tp:spec('tp', null, {max:16}), cp:spec('cp', null, {max:16}),
             /* 这两格的标签本页与那页写法不同（那页作 Routed / Shared），故显式传：
                那页的 label 参与错误文案的标红匹配，不能被本页的写法带走 */
             routed:spec('routedExpert', 'Routed Expert'), topk:spec('topK'),
             shared:spec('sharedExpert', 'Share Expert'), ep:spec('ep'),
             totalRank:spec('totalRank', null, {min:8}), mbs:spec('microBatch'), seq:spec('seqLen', null, {max:262144})};
    var MODES = [['split', '切出（主流）'], ['ortho', '正交']];   /* MindFormers 那档（dp×mp 域）本案例不摆；画布那边仍认 'mf' */
    var cfg = copy(BASE), lastValid = copy(BASE), pending = null, oomAdvice = null;   /* pending：参数校验失败；oomAdvice：换卡后容量不足，等用户确认或放弃 */
    function copy(o){ var r = {}; for(var k in o) r[k] = o[k]; return r; }
    function sameConfig(a, b){ for(var k in BASE) if(a[k] !== b[k]) return false; return true; }
    /* 三个口径换算都走共享规则层（与 config-relation-plane 同一份）：
         dpS     切出口径的 DP（含 EP 组）= 每段行数 ÷ TP
         world   Total Rank —— 只有正交档的 EP 进乘积
         perRank Total Rank 每动一档 DP 动几（= world ÷ dpS） */
    function dpS(c){ return PR.dpReplica(c); }
    function world(c){ return PR.parallelWorld(c); }
    function perRank(c){ return c.tp*c.pp*c.cp*PR.epInWorld(c); }
    function gbatch(c){ return c.mbs*dpS(c)*c.ga; }
    var gcd = PR.gcd;
    function fmt(b){ return (b/GiB).toFixed(1); }
    function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    function isDark(){ return document.documentElement.getAttribute('data-theme') === 'dark'; }
    function redRGB(){ return getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '220,38,38'; }
    /* ── 校验（照那页 validate 的硬约束里与本案例有关的几条）───────────────
       **判据**走共享规则层的 PR.RULES（与 config-relation-plane 同一套谓词：
       三档 EP 的域怎么取、哪几格该标红，以后只在那里改）；**文案**仍在本页写 ——
       那页的错误文案要靠字段 label 的子串去标红 stepper，两页措辞不能合并。
       ⚠️ 层数与 PP 这条两页本来就不同：那页允许不均分（46 层配 PP 4 摆成
       12,12,11,11），本案例的展平图按等长分块画、必须整除，所以这里调用的是
       layersDivisibleByPp 而不是那页的 layersAtLeastPp。 */
    var BAD_KEY = {totalLayer:'layers', routedExpert:'routed', topK:'topk'};   /* 共享层字段名 → 本案例的 bad 键 */
    function validate(c){
      var errs = [], bad = {}, R = PR.RULES, h;
      function mark(hit){ hit.fields.forEach(function(f){ bad[BAD_KEY[f] || f] = true; }); }
      if((h = R.layersDivisibleByPp(c))){ errs.push('Total Layer ' + h.layers + ' 必须被 PP ' + h.pp + ' 整除'); mark(h); }
      if((h = R.epDomainDivisibleByEp(c))){
        errs.push(h.mode === 'mf'
          ? 'DP × TP = ' + h.domain + ' 必须被 EP ' + h.ep + ' 整除（MindFormers：EP 在 dp × mp 域上切）'
          : 'DP ' + h.dp + ' 必须被 EP ' + h.ep + ' 整除（切出口径：EP 组是从 DP 里切出来的）');
        mark(h);
      }
      if((h = R.routedDivisibleByEp(c))){ errs.push('Routed Expert ' + h.routed + ' 必须被 EP ' + h.ep + ' 整除'); mark(h); }
      if((h = R.topKWithinRouted(c))){ errs.push('Top-K ' + h.topk + ' 不能超过 Routed Expert ' + h.routed); mark(h); }
      if((h = R.worldMultipleOfNode(c, 8))){ errs.push('Total Rank ' + h.world + ' 不是整机 8 卡的整数倍'); mark(h); }
      return {ok:!errs.length, errs:errs, bad:bad};
    }
    /* 建议修法：锚住用户刚改的那一格（f），把别的字段挪到最近的合法值；算不出就 null（横幅只剩「取消修改」）。
       合法只是第一关：EP 减半会让每卡专家翻倍，所以合法稿还要过 fitCapacity 容量检查。 */
    function propose(c, f){
      var p = copy(c);
      for(var i = 0; i < 6; i++){
        if(validate(p).ok) return fitCapacity(p, f);
        /* 每轮只修一条（判据同样走共享规则层，修法留在本页 —— 该挪哪个字段是本案例
           自己的策略，不是两页共有的口径）。分支顺序与原先逐条对应：
           层数/PP → EP 域（split 与 mf 由 hit.mode 分派，正交档这条返回 null 自动跳过）
           → 专家数/EP → Top-K。 */
        var R = PR.RULES, h;
        if((h = R.layersDivisibleByPp(p))){ if(f === 'pp') p.layers = Math.ceil(p.layers/p.pp)*p.pp; else p.pp = gcd(p.layers, p.pp); }
        else if((h = R.epDomainDivisibleByEp(p))){
          if(h.mode === 'mf') p.ep = gcd(p.dp*p.tp, p.ep);
          else if(f === 'ep') p.dp = Math.max(p.ep, Math.round(p.dp/p.ep)*p.ep);
          else p.ep = gcd(p.dp, p.ep);
        }
        else if((h = R.routedDivisibleByEp(p))){ if(f === 'ep') p.routed = Math.ceil(p.routed/p.ep)*p.ep; else p.ep = gcd(p.routed, p.ep); }
        else if((h = R.topKWithinRouted(p))){ if(f === 'routed') p.topk = p.routed; else p.routed = p.topk; }
        else return null;
      }
      return validate(p).ok ? fitCapacity(p, f) : null;
    }
    /* 横幅里的改动清单：建议稿与现值不同的字段（锚点除外）+ 派生的 Total Rank */
    function changesOf(p, c, anchor){
      var out = [];
      for(var k in F) if(k !== anchor && k !== 'totalRank' && c[k] !== undefined && p[k] !== c[k]) out.push({f:k, from:c[k], to:p[k]});
      if(world(p) !== world(lastValid)) out.push({f:'totalRank', from:world(lastValid), to:world(p)});
      return out;
    }
    var adjTimer = null;
    /* 被联动改到的格闪 3 秒（照 .is-auto-adjusted）；锚点本身不闪 */
    function flash(fields){
      if(!conf) return;
      fields.forEach(function(f){ var el = conf.querySelector('.c4s[data-f="' + f + '"]'); if(el){ el.classList.remove('is-adj'); void el.offsetWidth; el.classList.add('is-adj'); } });
      clearTimeout(adjTimer);
      adjTimer = setTimeout(function(){ if(conf) conf.querySelectorAll('.c4s.is-adj').forEach(function(el){ el.classList.remove('is-adj'); }); }, 3100);
    }
    /* 改一格：合法就落地（矩阵重画）；不合法就挂起（横幅 + 描红，矩阵停在 lastValid） */
    function set(f, val){
      var c = copy(cfg), before = copy(cfg);
      if(f === 'totalRank'){
        var per = perRank(c);
        if(val % per){
          pending = {field:'totalRank', value:val, proposal:null, v:{errs:['Total Rank ' + val + ' 不是 TP × PP × CP' + (c.mode === 'ortho' ? ' × EP' : '') + ' = ' + per + ' 的整数倍'], bad:{totalRank:true}}};
          syncConf(); return;
        }
        c.dp = val/per;
      } else c[f] = val;
      var v = validate(c);
      if(v.ok){ cfg = c; lastValid = copy(c); pending = null; applyTopo(); if(f === 'totalRank') flash(['dp']); }
      else { cfg = c; pending = {field:f, value:val, proposal:propose(c, f), v:v}; }
      syncConf(); renderSide(); redraw();
    }
    /* 切口径（照 setEpMode）：卡数不变，DP 按 EP 换算 —— 同一份 128 卡，切出档读作 DP 8，正交档读作 DP 2 */
    function setMode(m){
      if(m === cfg.mode) return;
      var c = copy(cfg), was = c.mode;
      if((was === 'ortho') !== (m === 'ortho')) c.dp = m === 'ortho' ? Math.max(1, Math.round(c.dp/c.ep)) : c.dp*c.ep;
      c.mode = m;
      var v = validate(c);
      cfg = c;
      if(v.ok){ lastValid = copy(c); pending = null; applyTopo(); flash(['dp']); rulerFlash = performance.now() + 1400; }
      else pending = {field:'dp', value:c.dp, proposal:propose(c, 'dp'), v:v};
      syncConf(); renderSide(); redraw();
    }
    /* 一组配置下最重那张卡的账（GB）：建议稿能不能装进当前卡，都拿这个数跟 CARDS[card].hbm 比 */
    function peakGB(p){
      var D = memCfg(p), T = PLN.topoOf(D, {mode:p.mode, dense:DENSE}), peak = 0;
      cardsOf(T).forEach(function(card){ peak = Math.max(peak, total(PLN.memWith(D, card))); });
      return peak/GiB;
    }
    /* 校验通过的建议稿再过容量关：装得下就原样返回；装不下就逐档抬 PP（锚点是 PP 时改抬 TP），
       让更多卡分摊模型层，取第一组真能装进当前卡的；抬到量程顶还装不下就 null（横幅只剩「取消修改」） */
    function fitCapacity(p, anchor){
      var cap = CARDS[p.card].hbm;
      if(peakGB(p) <= cap) return p;
      var k = anchor === 'pp' ? 'tp' : 'pp', max = k === 'pp' ? Math.min(F.pp.max, p.layers) : F.tp.max;
      for(var v = p[k]*2; v <= max; v *= 2){
        var q = copy(p); q[k] = v;
        if(!validate(q).ok) continue;
        if(peakGB(q) <= cap) return q;
      }
      return null;
    }
    /* 目标是继续使用用户选中的小容量卡，而不是劝退修改：优先扩 Cluster 的 Total Rank，
       并联动提高 PP，让更多卡分摊模型层。逐档试算，取第一组真正能装进目标卡的配置。 */
    function proposeForCard(c){
      var cap = CARDS[c.card].hbm, maxPP = Math.min(F.pp.max, c.layers);
      for(var pp = c.pp*2; pp <= maxPP; pp *= 2){
        if(c.layers % pp) continue;
        var p = copy(c); p.pp = pp;
        if(!validate(p).ok) continue;
        var peak = peakGB(p);
        if(peak <= cap) return {cfg:p, peak:peak, world:world(p), layersPerStage:p.layers/p.pp};
      }
      return null;
    }
    function setCard(id){
      if(!CARDS[id] || id === cfg.card) return;
      var previous = oomAdvice ? oomAdvice.previous : cfg.card;
      cfg.card = id; lastValid.card = id;
      recalcOver();
      var count = over.filter(Boolean).length;
      oomAdvice = count ? {previous:previous, card:id, count:count, proposal:proposeForCard(cfg)} : null;
      flash(['card']); syncConf(); renderSide(); redraw();
      /* 容量告警在表单顶部：卡型号通常在栏底，切完后把建议送进视野。 */
      if(oomAdvice && conf) requestAnimationFrame(function(){ conf.scrollTo({top:0, behavior:'smooth'}); });
    }
    function discardCardChange(){
      if(!oomAdvice) return;
      var previous = oomAdvice.previous; oomAdvice = null;
      cfg.card = previous; lastValid.card = previous; recalcOver();
      syncConf(); renderSide(); redraw(); flash(['card']); fadeOver(0, 700);
    }
    function applyOomFix(){
      if(!oomAdvice || !oomAdvice.proposal) return;
      var p = oomAdvice.proposal.cfg; oomAdvice = null;
      cfg = copy(p); lastValid = copy(p); pending = null;
      applyTopo(); syncConf(); renderSide(); redraw(); flash(['totalRank', 'pp', 'card']); fadeOver(0, 700);
    }
    function applyFix(){
      if(!pending || !pending.proposal) return;
      var before = copy(cfg), anchor = pending.field, p = pending.proposal, ch = changesOf(p, before, anchor).map(function(x){ return x.f; });
      cfg = copy(p); lastValid = copy(p); pending = null;
      E.selLayer = null; E.layerGuide = false; netLayer = 'all';   /* 列选择清掉，整网查询同步回「全部」 */
      applyTopo(); syncConf(); renderSide(); redraw(); flash(ch);
    }
    function cancelFix(){ cfg = copy(lastValid); pending = null; syncConf(); renderSide(); redraw(); }

    /* ── 配置 → 拓扑 → 画布上的那批卡、每张卡的账 ── */
    var R23 = 23;
    var E = {ctx:null, W:0, H:0, DPR:1, tag:4, PC:[], TOPO:null, plane:null, view:{x:0, y:0, k:1}, selRank:R23, selLayer:null, layerGuide:false, hoverLayer:null, cpOn:true, tpOn:true, paintOn:false, hiCols:null, hiDomain:null, cellHeat:null, chipPaint:true, layerVisible:false, memoryMode:false, memoryByRank:null, memoryCapacity:0};   /* 默认以 PP Stage 聚合显示；Layer 明细可手动打开。 */
    var memoryPrefs = null;
    var MEM = [], CAP = 0, over = [], overA = 0, rulerFlash = 0, hiOp = null, panelTab = 'form';   /* panelTab：左栏在「表单」还是「整网图」页签 */
    var netMode = 'perf', netLayer = 1, layerPageStart = 1;   /* 整网查询默认：性能分析 · Layer 1 */
    /* netLayer 的取值：'all'（整条链正视）| 层号 | 'emb' / 'norm' / 'head'（端点列）。它与画布顶尺的列选择
       （E.selLayer）是同一件事的两个入口：翻页选层 ⇒ 画布选中同一列；画布点列 ⇒ 翻页跟到同一层；画布清空 ⇒ 回到「全部」。
       端点列只能从画布点进来（翻页器只翻 Layer），选中时翻页器没有一枚亮着。 */
    var NET_UNITS = {emb:'Emb', norm:'Norm', head:'Head'};
    /* 正视取景框（deck 场景坐标，层卡中心为原点）：层卡 720×1180 居中；输入端点卡 y -700～-522；输出端点卡从 y 520 起，
       Final RMSNorm 在 +34～+66，其后 LM Head → MTP Logits 到 +484。宽度一律 850，留出与原正视相同的左右余量。 */
    var NET_FOCUS = {layer:{width:850, height:1260, centerX:0, centerY:0}, emb:{width:850, height:268, centerX:0, centerY:-611},
                     norm:{width:850, height:140, centerX:0, centerY:570}, head:{width:850, height:492, centerX:0, centerY:803}};
    function netScope(){ return netLayer === 'all' ? 'all' : (NET_UNITS[netLayer] ? netLayer : 'layer'); }
    /* 耗时按哪一层取：「全部」时画面里仍只有一张层卡（正视一次只画一层），读数就跟着那张卡，别用另一层的数去染它 */
    function netMetricLayer(){
      if(netLayer !== 'all') return netLayer;
      var card = netHost && netHost.querySelector('.pto-model-deck__layer.is-front-layer');
      var l = card ? Number(card.dataset.layer) : NaN;
      return isFinite(l) ? l : 'all';
    }
    /* 整网查询的当前项 ⇄ 画布列：列对象照 PLN 里 cols 的形状（layer 列带 dense 标记，端点列带 id） */
    function netKeyOf(col){ return !col ? 'all' : (col.type === 'layer' ? col.layer : col.id); }
    function colOfNet(key){
      if(key === 'all') return null;
      if(NET_UNITS[key]) return {type:'unit', id:key, label:NET_UNITS[key]};
      var l = Number(key); return {type:'layer', layer:l, label:'Layer' + l, short:'L' + l, dense:l < (E.TOPO ? E.TOPO.dense : DENSE)};
    }
    function memCfg(c){ return {tp:c.tp, cp:c.cp, pp:c.pp, dp:c.dp, ep:c.ep, etp:1, layers:c.layers, hidden:HIDDEN, heads:32, kv:8, ffn:2048,
                                vocab:128256, seq:c.seq, experts:c.routed, mbs:c.mbs, ga:c.ga, hbm:CARDS[c.card].hbm}; }
    function cardsOf(T){
      var a = [], r = 0;
      for(var p = 0; p < T.pp; p++) for(var d = 0; d < T.dp; d++)
        for(var cp = 0; cp < T.cp; cp++) for(var t = 0; t < T.tp; t++, r++)
          a.push({r:r, pp:p, dp:d, dp8:d, cp:cp, tp:t, k:d*T.cp*T.tp + cp*T.tp + t, node:Math.floor(r/8), x:0, y:0, z:0});
      return a;
    }
    function total(m){ return m.reduce(function(a, x){ return a + x.bytes; }, 0); }
    function applyTopo(){
      var D = memCfg(lastValid), T = PLN.topoOf(D, {mode:lastValid.mode, dense:DENSE});
      E.TOPO = T; E.PC = cardsOf(T);
      syncPlaneToggles();
      MEM = E.PC.map(function(c){ return PLN.memWith(D, c); });
      E.memoryByRank = MEM; E.memoryCapacity = CARDS[lastValid.card].hbm*GiB;
      if(E.selRank !== null && E.selRank >= E.PC.length) E.selRank = null;
      if(E.selLayer && E.selLayer.type === 'layer' && E.selLayer.layer >= T.layers) E.selLayer = null;
      hiOp = null; E.hiCols = null; E.hiDomain = null;
      /* 算子高亮清掉之后，整网查询停着的那一层 / 端点降格为画布上的列选择（两边仍指同一列，翻页器不跳走）；
         那一层已经不存在（层数缩到它之下）则回「全部」 */
      if(!E.selLayer){
        if(typeof netLayer === 'number' && netLayer >= T.layers) netLayer = 'all';
        if(netLayer !== 'all'){ E.selLayer = colOfNet(netLayer); E.layerGuide = true; } else layerPageStart = 0;
      }
      if(E.ctx){ PLN.build(E); PLN.fit(E); zoomRead(); }
      recalcOver();
      mountNet();
    }
    function recalcOver(){ CAP = CARDS[lastValid.card].hbm*GiB; over = MEM.map(function(m){ return total(m) > CAP; }); }

    /* ── 左栏：表单 ── */
    var conf = null, side = null, cv = null, cx = null, stageEl = null, ro = null, netHost = null, netDeck = null, netSig = '', deckMuted = false;
    function stepperHTML(f){
      var s = F[f];
      return '<div class="c4s" data-f="' + f + '"><span class="lb">' + s.lb + '</span><div class="ctl">'
        + '<button type="button" data-d="-1" aria-label="减少 ' + s.lb + '">−</button><input class="rd" data-f="' + f + '" type="text" inputmode="numeric" autocomplete="off" spellcheck="false">'
        + '<button type="button" data-d="1" aria-label="增加 ' + s.lb + '">+</button></div></div>';
    }
    function derivedHTML(f, lb){ return '<div class="c4s der" data-f="' + f + '"><span class="lb">' + lb + '</span><div class="ctl"><span class="rd"></span></div></div>'; }
    /* EP 口径：与别的格同一副壳的二选一（照那页的 .cro-stepper--choice），排在 MoE 区第一格——它是「下面这些数字怎么读」的前提 */
    function modeHTML(){
      return '<div class="c4s" data-f="mode"><span class="lb">EP 口径</span><div class="ctl choice" id="c4mode" role="group" aria-label="EP 与 DP 的口径">'
        + MODES.map(function(m){ return '<button type="button" data-m="' + m[0] + '" aria-pressed="false">' + m[1] + '</button>'; }).join('') + '</div></div>';
    }
    function confHTML(){
      /* 一对页签：训练配置（下面三个区）/ 整网查询（一块画布，换掉配置表单） */
      return '<div class="cs4-head"><div class="cs-vtabs' + (panelTab === 'net' ? ' idle' : '') + '" id="c4pt" role="tablist" aria-label="配置视图">'
        + '<button type="button" role="tab" data-pt="form" aria-selected="' + (panelTab === 'form') + '">训练配置</button><button type="button" role="tab" data-pt="net" aria-selected="' + (panelTab === 'net') + '">整网查询</button><span class="knob" aria-hidden="true"></span></div></div>'
        + '<div class="cs4-netwrap" id="c4netwrap"' + (panelTab === 'net' ? '' : ' hidden') + ' aria-label="整网模型结构">'
        + '<div class="cs4-nethead"><div class="cs-vtabs cs4-subtabs" role="tablist" aria-label="整网查询类型">'
        + '<button type="button" role="tab" data-net-mode="perf" aria-selected="true">性能分析</button><button type="button" role="tab" data-net-mode="monitor" aria-selected="false">训练监控</button><span class="knob" aria-hidden="true"></span></div>'
        + '<div class="cs4-layerpager" id="c4layerpager" role="group" aria-label="模型 Layer 翻页"><button type="button" data-layer-select="all" aria-pressed="false">全部</button><span class="sep">|</span>'
        + '<button type="button" data-layer-shift="-1" aria-label="上一组 Layer">‹</button><button type="button" data-layer-slot="0" aria-pressed="true">Layer 1</button><button type="button" data-layer-slot="1" aria-pressed="false">Layer 2</button><button type="button" data-layer-shift="1" aria-label="下一组 Layer">›</button></div></div>'
        + '<div class="cs4-perf-legend" id="c4perflegend"><span class="label">整网算子耗时（绝对值）</span><div class="bar" aria-hidden="true"></div><div class="range"><span id="c4perfmin">0.04 ms</span><span id="c4perfmax">3.84 ms</span></div></div>'
        + '<div class="cs4-netdeck" id="c4net" aria-label="openPangu 整网性能结构"></div>'
        + '<div class="cs4-train-strip" id="c4trainstrip" hidden><div><span>训练步</span><b>Step 18,240</b></div><div><span>状态</span><b>稳定运行</b></div><div><span>吞吐</span><b>4,096 tok/s</b></div><div><span id="c4trainscope">Layer 1 · MFU</span><b>52.6%</b></div></div></div>'
        + '<div class="cs4-form" id="c4form"' + (panelTab === 'form' ? '' : ' hidden') + '>'
        + '<div class="cro-config-error" id="c4err" role="status" aria-live="polite"></div>'
        + '<div class="cs4-reg"><h2>Model Architecture</h2><div class="cs4-row">' + ['layers', 'dp', 'pp', 'tp', 'cp'].map(stepperHTML).join('') + '</div></div>'
        + '<div class="cs4-reg"><h2>MoE</h2><div class="cs4-row">' + modeHTML() + ['ep', 'routed', 'topk', 'shared'].map(stepperHTML).join('') + '</div></div>'
        + '<div class="cs4-reg"><h2>Cluster</h2><div class="cs4-row">' + stepperHTML('totalRank')
        + '<div class="c4s" data-f="card"><span class="lb">卡型号</span><select data-f="card" aria-label="卡型号">'
        + CARD_ORDER.map(function(id){ return '<option value="' + id + '">' + CARDS[id].label + '</option>'; }).join('') + '</select></div>'
        + derivedHTML('globalBatch', 'Global Batch') + stepperHTML('mbs') + stepperHTML('seq') + derivedHTML('hidden', 'Hidden') + '</div></div></div>';
    }
    /* 把 cfg 写进表单（不重建 DOM，闪动的动画才不会被打断）：读数、校验态、口径二选一、卡型号、横幅 */
    function syncConf(){
      if(!conf) return;
      var bad = pending ? pending.v.bad : {}, ch = pending && pending.proposal ? changesOf(pending.proposal, cfg, pending.field) : [];
      var badAll = copy(bad); ch.forEach(function(x){ badAll[x.f] = true; }); if(pending) badAll[pending.field] = true;
      for(var f in F){
        var el = conf.querySelector('.c4s[data-f="' + f + '"]'); if(!el) continue;
        /* Total Rank 是派生的：横幅挂着时它停在冻结那组的数（横幅里写的「128 → 32」才对得上），锚在它自己上时显示手输的那个数 */
        var v = f === 'totalRank' ? (pending ? (pending.field === 'totalRank' ? pending.value : world(lastValid)) : world(cfg)) : cfg[f];
        var inp = el.querySelector('input.rd'); if(inp && document.activeElement !== inp) inp.value = String(v);
        el.classList.toggle('is-invalid', !!badAll[f]);
        var s = F[f], dec = el.querySelector('button[data-d="-1"]'), inc = el.querySelector('button[data-d="1"]');
        if(dec) dec.setAttribute('aria-disabled', String(v <= s.min)); if(inc) inc.setAttribute('aria-disabled', String(v >= s.max));
      }
      conf.querySelector('.c4s[data-f="globalBatch"] .rd').textContent = String(gbatch(pending ? lastValid : cfg));
      conf.querySelector('.c4s[data-f="hidden"] .rd').textContent = String(HIDDEN);
      conf.querySelectorAll('#c4mode button').forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.m === cfg.mode)); });
      conf.querySelector('select[data-f="card"]').value = cfg.card;
      var cardField = conf.querySelector('.c4s[data-f="card"]');
      if(cardField) cardField.classList.toggle('is-invalid', !!oomAdvice);
      renderErr();
    }
    /* 横幅：既承接参数校验失败，也承接卡容量不足；两者都在配置栏顶部给出下一步。 */
    function renderErr(){
      var el = document.getElementById('c4err'); if(!el) return;
      el.classList.toggle('is-blocking', !!pending || !!oomAdvice);
      el.classList.toggle('is-guidance', !!(oomAdvice && oomAdvice.proposal) || !!(pending && pending.proposal));
      if(oomAdvice){
        var card = CARDS[oomAdvice.card], proposal = oomAdvice.proposal, fix;
        if(proposal){
          fix = '为了继续使用 ' + card.label + '（' + card.hbm + ' GB），我建议扩容 Cluster：Total Rank ' + world(cfg) + ' → ' + proposal.world
            + '；联动 PP ' + cfg.pp + ' → ' + proposal.cfg.pp + '，每卡承载层数 ' + (cfg.layers/cfg.pp) + ' → ' + proposal.layersPerStage
            + '，预计峰值降至 ' + proposal.peak.toFixed(1) + ' GB/卡。';
        } else {
          fix = '当前配置没有可自动应用的单项扩容方案；可增加 Total Rank，并提高 PP / TP，让更多卡分摊模型状态。';
        }
        el.innerHTML = proposal
          ? '<p class="cro-config-error__msg"><strong class="cro-config-error__title">配置建议</strong><span>' + esc(fix) + '</span></p>'
            + '<div class="cro-config-error__actions"><button type="button" class="pri" data-act="apply-oom">应用</button><button type="button" data-act="discard-card">取消修改</button></div>'
          : '<p class="cro-config-error__msg"><strong class="cro-config-error__title is-error">配置出错</strong><span>' + esc(card.label) + ' 容量不足：预计 ' + oomAdvice.count + ' 张卡 OOM。</span></p>'
          + '<div class="cro-config-error__fix">' + esc(fix) + '</div>'
          + '<div class="cro-config-error__actions"><button type="button" data-act="discard-card">取消修改</button></div>';
        return;
      }
      if(!pending){ el.innerHTML = ''; return; }
      var p = pending.proposal, fixTxt;
      if(p){
        var ch = changesOf(p, cfg, pending.field).map(function(x){ return F[x.f].lb + ' ' + x.from + ' → ' + x.to; });
        fixTxt = ch.length ? '为了实现将 ' + F[pending.field].lb + ' 调整为 ' + pending.value + '，我建议同步调整 ' + ch.join('、') : '为了实现将 ' + F[pending.field].lb + ' 调整为 ' + pending.value + '，无需联动调整其他字段';
        fixTxt += '；预计峰值 ' + peakGB(p).toFixed(1) + ' GB/卡，能装进 ' + CARDS[p.card].label + '';
      } else fixTxt = '没能算出兼容这个数的改法 —— 换一个值，或退回上一组参数';
      el.innerHTML = p
        ? '<p class="cro-config-error__msg"><strong class="cro-config-error__title">配置建议</strong><span>' + esc(fixTxt) + '</span></p>'
          + '<div class="cro-config-error__actions"><button type="button" class="pri" data-act="apply">应用</button><button type="button" data-act="cancel">取消修改</button></div>'
        : '<p class="cro-config-error__msg"><strong class="cro-config-error__title is-error">配置出错</strong><span>' + esc(pending.v.errs.join('；')) + '<span class="cro-config-error__frozen">图形已暂停更新，仍显示上一组自洽的参数</span></span></p>'
          + '<div class="cro-config-error__fix">' + esc(fixTxt) + '</div><div class="cro-config-error__actions"><button type="button" data-act="cancel">取消修改</button></div>';
    }
    function stepField(f, dir){
      var s = F[f], v = f === 'totalRank' ? world(cfg) : cfg[f], nv;
      if(s.pow2) nv = dir > 0 ? v*2 : Math.max(1, Math.floor(v/2)); else nv = v + dir;
      nv = Math.min(s.max, Math.max(s.min, nv));
      if(nv !== v) set(f, nv);
    }
    function typeField(inp){
      var f = inp.dataset.f, s = F[f], raw = inp.value.trim(), n = parseInt(raw, 10);
      if(!/^\d+$/.test(raw) || !isFinite(n) || n < s.min || n > s.max){ syncConf(); return; }   /* 量程外：还原 */
      if(n !== (f === 'totalRank' ? world(cfg) : cfg[f])) set(f, n);
    }
    function bindConf(){
      conf.addEventListener('click', function(e){
        var b = e.target.closest('button'); if(!b) return;
        if(b.dataset.d){
          var w = b.closest('.c4s');
          if(b.getAttribute('aria-disabled') !== 'true'){ userStop(); stepField(w.dataset.f, +b.dataset.d); }
        }
        else if(b.dataset.m){ userStop(); setMode(b.dataset.m); }
        else if(b.dataset.pt) setPanel(b.dataset.pt);
        else if(b.dataset.netMode) setNetMode(b.dataset.netMode);
        else if(b.hasAttribute('data-layer-select')) selectNetLayer(b.dataset.layerSelect);
        else if(b.hasAttribute('data-layer-slot')) selectNetLayer(+b.dataset.layerSelect);
        else if(b.dataset.layerShift) shiftLayerPage(+b.dataset.layerShift);
        else if(b.dataset.act === 'apply'){ userStop(); applyFix(); }
        else if(b.dataset.act === 'cancel'){ userStop(); cancelFix(); }
        else if(b.dataset.act === 'apply-oom'){ userStop(); applyOomFix(); }
        else if(b.dataset.act === 'discard-card'){ userStop(); discardCardChange(); }
      });
      conf.addEventListener('change', function(e){
        var t = e.target;
        if(t.matches('select[data-f="card"]')){ userStop(); setCard(t.value); }
        else if(t.matches('input.rd')){ userStop(); typeField(t); }
      });
      conf.addEventListener('keydown', function(e){ if(e.key === 'Enter' && e.target.matches('input.rd')){ e.target.blur(); } });
    }

    /* ── 中列：画布（只画 Rank 矩阵，右下角同款缩放条）；右列：通用 Rank 详情栏（M3.makeSide） ── */
    var sideP = null;
    function mount(fig){
      fig.innerHTML = '<div class="cs4"><div class="cs4-stage" id="c4stage"><canvas id="c4cv"></canvas>'
        + '<div class="c4-memory-legend" id="c4MemoryLegend" hidden><div class="c4-memory-legend__caption" id="c4MemoryLegendCaption">Rank HBM 占用</div>'
        + '<div class="c4-memory-legend__scale"><span class="end">0%</span><span class="c4-memory-legend__track" id="c4MemoryLegendTrack">'
        + '<span class="c4-memory-legend__ramp" id="c4MemoryLegendRamp" aria-hidden="true"></span><span class="c4-memory-legend__shade c4-memory-legend__shade--lo"></span><span class="c4-memory-legend__shade c4-memory-legend__shade--hi"></span>'
        + '<span class="c4-memory-legend__marker c4-memory-legend__marker--min" id="c4MemoryLegendMin"><span class="c4-memory-legend__marker-label"></span></span>'
        + '<span class="c4-memory-legend__marker c4-memory-legend__marker--max" id="c4MemoryLegendMax"><span class="c4-memory-legend__marker-label"></span></span>'
        + '<span class="c4-memory-legend__marker c4-memory-legend__marker--rank" id="c4MemoryLegendRank" hidden><span class="c4-memory-legend__marker-label"></span></span>'
        + '</span><span class="end">100%</span></div></div>'
        + '<div class="pzoom" aria-label="画布工具"><button type="button" data-z="out" title="缩小">−</button><span class="rd" id="c4zr">100%</span>'
        + '<button type="button" data-z="in" title="放大">+</button><button type="button" data-z="fit" title="适配屏幕">适配</button><span class="cs4-layer-sep" aria-hidden="true"></span>'
        + '<button class="ctog cs4-layer-toggle" id="c4cpToggle" type="button" role="switch" aria-checked="' + E.cpOn + '"' + (lastValid.cp <= 1 ? ' hidden' : '') + '><span class="sw" aria-hidden="true"></span>CP标注</button>'
        + '<button class="ctog cs4-layer-toggle" id="c4tpToggle" type="button" role="switch" aria-checked="' + E.tpOn + '"><span class="sw" aria-hidden="true"></span>TP标注</button>'
        + '<button class="ctog cs4-layer-toggle" id="c4layerToggle" type="button" role="switch" aria-checked="' + E.layerVisible + '" title="切换 Layer 明细与 PP Stage 聚合视图"><span class="sw" aria-hidden="true"></span>Layer标注</button>'
        + '<button class="ctog cs4-layer-toggle" id="c4memoryToggle" type="button" role="switch" aria-checked="' + E.memoryMode + '" title="每个 Rank 聚合成一个格子，按 HBM 容量显示权重、梯度、优化器态、激活与预留占比"><span class="sw" aria-hidden="true"></span>内存观测</button></div></div></div>';
      conf = document.getElementById('cs4conf'); side = document.getElementById('cs4side');
      stageEl = document.getElementById('c4stage'); cv = document.getElementById('c4cv'); cx = cv.getContext('2d');
      E.ctx = cx; E.hoverLayer = null;
      /* 左栏的壳（#cs4conf）是 render 摆的、窗口变化时 paint → mount 会再进来：内容重建，监听只挂一次 */
      if(conf){ conf.innerHTML = confHTML(); netHost = document.getElementById('c4net'); if(!conf.dataset.bound){ conf.dataset.bound = '1'; bindConf(); } }
      if(side && SIDE){
        sideP = SIDE(side); bindDomPanel(sideP.el); sideDomSig = '';
        sideP.onClose(function(){
          if(E.selRank === null) return false;
          E.selRank = null; sideDomSig = ''; redraw(); return false;
        });
      }
      if(!E.TOPO) applyTopo();   /* 整网查询默认停在 Layer 1，applyTopo 会让画布选中同一列 */
      mountNet();
      bindCanvas();
      if(ro) ro.disconnect();
      ro = new ResizeObserver(function(){ size(); });
      ro.observe(stageEl);
      size();
      syncConf(); syncNetControls(); renderSide();
    }
    function size(){
      if(!stageEl) return;
      var w = stageEl.clientWidth, h = stageEl.clientHeight; if(w < 20 || h < 20) return;
      E.DPR = window.devicePixelRatio || 1; E.W = w; E.H = h;
      cv.width = Math.round(w*E.DPR); cv.height = Math.round(h*E.DPR);
      if(!E.plane) PLN.build(E);
      if(!zooming) PLN.fit(E);
      zoomRead(); redraw();
    }
    function placeMemoryLegendMarker(marker, ratio, label){
      if(!marker) return;
      var value = clamp(Number(ratio) || 0, 0, 1);
      marker.style.left = (value*100).toFixed(3) + '%';
      marker.dataset.edge = value < .10 ? 'start' : (value > .90 ? 'end' : 'middle');
      var text = marker.querySelector('.c4-memory-legend__marker-label'); if(text) text.textContent = label;
    }
    function syncMemoryLegend(){
      var legend = document.getElementById('c4MemoryLegend'); if(!legend) return;
      var heatMode = E.memoryMode && Math.round(E.view.k*100) < 100;
      legend.hidden = !heatMode;
      if(!heatMode) return;
      var track = document.getElementById('c4MemoryLegendTrack');
      var ramp = document.getElementById('c4MemoryLegendRamp');
      var minMarker = document.getElementById('c4MemoryLegendMin');
      var maxMarker = document.getElementById('c4MemoryLegendMax');
      var rankMarker = document.getElementById('c4MemoryLegendRank');
      var caption = document.getElementById('c4MemoryLegendCaption');
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      var colors = dark ? PR.HEAT_RAMP : MEMORY_HEAT_LIGHT;
      if(ramp){ ramp.style.backgroundColor = PR.heatColor(0, colors); ramp.style.backgroundImage = PR.heatRampCss(colors); }
      var values = MEM.map(function(mem, rank){ return {rank:rank, ratio:clamp(total(mem)/Math.max(1,E.memoryCapacity),0,1)}; });
      var selected = E.selRank !== null && values[E.selRank] ? values[E.selRank] : null;
      var shades = legend.querySelectorAll('.c4-memory-legend__shade');
      legend.classList.toggle('is-single', !!selected);
      minMarker.hidden = !!selected; maxMarker.hidden = !!selected; rankMarker.hidden = !selected;
      Array.prototype.forEach.call(shades, function(shade){ shade.hidden = !!selected; });
      if(selected){
        caption.textContent = 'R' + selected.rank + ' · HBM 占用';
        placeMemoryLegendMarker(rankMarker, selected.ratio, 'R' + selected.rank + ' · ' + Math.round(selected.ratio*100) + '%');
        legend.title = 'R' + selected.rank + ' 的 HBM 占用为 ' + Math.round(selected.ratio*100) + '%';
        return;
      }
      var lo = values.length ? values.reduce(function(a,b){ return b.ratio < a.ratio ? b : a; }, values[0]) : {ratio:0};
      var hi = values.length ? values.reduce(function(a,b){ return b.ratio > a.ratio ? b : a; }, values[0]) : {ratio:1};
      track.style.setProperty('--memory-min',(lo.ratio*100).toFixed(3) + '%');
      track.style.setProperty('--memory-max',(hi.ratio*100).toFixed(3) + '%');
      placeMemoryLegendMarker(minMarker, lo.ratio, '最小 ' + Math.round(lo.ratio*100) + '%');
      placeMemoryLegendMarker(maxMarker, hi.ratio, '最大 ' + Math.round(hi.ratio*100) + '%');
      caption.textContent = 'Rank HBM 占用 · 当前范围';
      legend.title = '当前 Rank HBM 占用范围 ' + Math.round(lo.ratio*100) + '%–' + Math.round(hi.ratio*100) + '%；冷蓝 = 占用低，火红 = 占用高';
    }
    function zoomRead(){ var el = document.getElementById('c4zr'); if(el) el.textContent = Math.round(E.view.k*100) + '%'; syncMemoryLegend(); }
    /* 左栏页签：表单 / 整网图（整网图占掉表单的位置，不并排） */
    function setPanel(v){
      if(v === panelTab) return;
      /* 整网查询使用算子 / 性能热力口径，不能沿用 Rank HBM 聚合视图。
         自动播放切页时要保留播放计时，因此这里只静默退出内存观测。 */
      if(v === 'net' && E.memoryMode) setMemoryMode(false);
      panelTab = v;
      E.hoverLayer = null;
      if(v === 'net' && netMode === 'perf') E.selRank = null;   /* 性能分析从无 Rank 选择开始，不沿用训练配置里的 R23。 */
      if(v === 'form' && E.selRank === null && E.PC.length) E.selRank = Math.min(R23, E.PC.length - 1);   /* 整网查询里可清空 Rank；回训练配置时仍要有默认主语。 */
      var pt = document.getElementById('c4pt'), fm = document.getElementById('c4form'), nw = document.getElementById('c4netwrap');
      if(pt){ pt.classList.toggle('idle', v === 'net'); pt.querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-selected', String(b.dataset.pt === v)); }); }
      if(fm) fm.hidden = v !== 'form'; if(nw) nw.hidden = v !== 'net';
      if(v === 'net') requestAnimationFrame(function(){ mountNet(); if(netDeck) netDeck.fit(); });
      renderSide();   /* 表单 ⇄ 整网查询之间右栏要换内容：显存账 ⇄ 各域计算耗时差异 */
      redraw();
    }
    function syncNetControls(){
      if(!conf) return;
      conf.querySelectorAll('[data-net-mode]').forEach(function(b){ b.setAttribute('aria-selected', String(b.dataset.netMode === netMode)); });
      var subTabs = conf.querySelector('.cs4-subtabs'); if(subTabs) subTabs.classList.toggle('idle', netMode === 'monitor');
      var pager = document.getElementById('c4layerpager');
      if(pager){
        pager.querySelector('[data-layer-select="all"]').setAttribute('aria-pressed', String(netLayer === 'all'));
        var slots = pager.querySelectorAll('[data-layer-slot]');
        slots.forEach(function(b, i){
          var layer = layerPageStart + i;
          b.dataset.layerSelect = String(layer); b.textContent = 'Layer ' + layer; b.disabled = !E.TOPO || layer >= E.TOPO.layers;
          b.setAttribute('aria-pressed', String(netLayer === layer));
        });
        var prev = pager.querySelector('[data-layer-shift="-1"]'), next = pager.querySelector('[data-layer-shift="1"]');
        if(prev) prev.disabled = layerPageStart <= 0;
        if(next) next.disabled = !E.TOPO || layerPageStart + 2 >= E.TOPO.layers;
      }
      var legend = document.getElementById('c4perflegend'), strip = document.getElementById('c4trainstrip');
      if(legend) legend.hidden = netMode !== 'perf'; if(strip) strip.hidden = netMode !== 'monitor';
      var scope = document.getElementById('c4trainscope'); if(scope) scope.textContent = (netLayer === 'all' ? '整网' : NET_UNITS[netLayer] || 'Layer ' + netLayer) + ' · MFU';
    }
    /* 把 netLayer 铺到 deck。性能分析只用正视，不做 3D 翻转：「全部」是整条链（输入端点卡 + 当前层卡 + 输出端点卡）；
       选了层 / 端点则只留那一块（CSS 按 data-net-scope 藏掉其余，取景框让 deck 按留下的那一块适配，而不是仍按整条链的高度缩小）。
       取景框要先于 setView 设好——setView 内部会 fit。 */
    function applyNetView(){
      if(!netDeck) return;
      var scope = netScope();
      if(netHost) netHost.dataset.netScope = scope;
      netDeck.setFocusBox(scope === 'all' ? null : NET_FOCUS[scope]);
      netDeck.setView('front');
      if(scope === 'layer') netDeck.setFrontLayer(netLayer);
      netDeck.setPerformanceMetrics(netMode === 'perf' ? performanceMetrics(netMetricLayer()) : null);
      updatePerfLegend();
    }
    function setNetMode(mode){
      netMode = mode === 'monitor' ? 'monitor' : 'perf';
      E.hoverLayer = null;
      if(netMode === 'perf') E.selRank = null;   /* 从训练监控进入性能分析时也不继承已有 Rank。 */
      syncNetControls(); applyNetView(); renderSide(); redraw();
    }
    /* 算子高亮（点整网图里的一个计算节点）与列选择（点画布顶尺 / 翻页选层）互斥：任一方生效时先清掉另一方 */
    function clearOpPick(){
      E.hiDomain = null;   /* 撤掉即可：表里点的那一维会在下一帧由 syncDomain 按新锚点重建 */
      if(!hiOp && !E.hiCols) return;
      hiOp = null; E.hiCols = null;
      if(netDeck){ deckMuted = true; try{ netDeck.selectNode(''); } finally { deckMuted = false; } }
    }
    /* fromCanvas：画布已经改好了 E.selLayer，这里只让整网查询跟上；否则是翻页器发起的，反过来把画布选到同一列 */
    function selectNetLayer(layer, fromCanvas){
      if(layer !== 'all' && !NET_UNITS[layer]) layer = clamp(Number(layer) || 0, 0, Math.max(0, E.TOPO.layers - 1));
      netLayer = layer;
      if(typeof layer === 'number' && (layer < layerPageStart || layer > layerPageStart + 1)) layerPageStart = clamp(layer, 0, Math.max(0, E.TOPO.layers - 2));
      if(!fromCanvas){
        clearOpPick(); E.selLayer = colOfNet(layer); E.layerGuide = !!E.selLayer;
        /* 翻页器是**列**控件：用它就不是在看某一张卡了。选「全部」时连列也没有——
           那正是「什么都不选、整张矩阵铺满热力」的那一档，所以这里无条件清掉卡的选中。 */
        if(perfMode()) E.selRank = null;
        renderSide();
      }
      syncNetControls(); applyNetView(); redraw();
    }
    function syncNetFromCanvas(){ var next = netKeyOf(E.selLayer); if(next !== netLayer) selectNetLayer(next, true); }
    function shiftLayerPage(dir){
      layerPageStart = clamp(layerPageStart + dir, 0, Math.max(0, E.TOPO.layers - 2));
      selectNetLayer(layerPageStart);
    }
    var pan = null, suppress = false;
    function setLayerHover(col){
      col = perfMode() && col && col.type === 'layer' ? col : null;
      var prev = E.hoverLayer ? PLN.colKey(E.hoverLayer) : '', next = col ? PLN.colKey(col) : '';
      if(prev === next) return;
      E.hoverLayer = col; redraw();
    }
    function canvasLayerAt(mx, my){
      if(!perfMode() || my < PLC.RULER_TOP_H) return null;
      var col = PLN.colAt(E, mx);
      return col && col.type === 'layer' ? col : null;
    }
    function syncPlaneToggles(){
      var cpToggle = document.getElementById('c4cpToggle');
      var tpToggle = document.getElementById('c4tpToggle');
      var layerToggle = document.getElementById('c4layerToggle');
      var memoryToggle = document.getElementById('c4memoryToggle');
      if(cpToggle){ cpToggle.hidden = !E.TOPO || E.TOPO.cp <= 1; cpToggle.setAttribute('aria-checked', String(E.cpOn)); }
      if(tpToggle) tpToggle.setAttribute('aria-checked', String(E.tpOn));
      if(layerToggle){ layerToggle.setAttribute('aria-checked', String(E.layerVisible)); layerToggle.disabled = E.memoryMode; }
      if(memoryToggle) memoryToggle.setAttribute('aria-checked', String(E.memoryMode));
    }
    function rebuildPlane(){
      PLN.build(E); PLN.fit(E); zoomRead(); renderSide(); redraw();
    }
    function setMemoryMode(on){
      on = !!on;
      if(on === E.memoryMode) return;
      if(on){
        memoryPrefs = {layerVisible:E.layerVisible};
        E.memoryMode = true; E.layerVisible = false;
        E.hoverLayer = null;
      } else {
        E.memoryMode = false;
        if(memoryPrefs) E.layerVisible = memoryPrefs.layerVisible;
        memoryPrefs = null;
      }
      syncPlaneToggles(); rebuildPlane();
    }
    function bindCanvas(){
      var cpToggle = document.getElementById('c4cpToggle');
      var tpToggle = document.getElementById('c4tpToggle');
      var layerToggle = document.getElementById('c4layerToggle');
      var memoryToggle = document.getElementById('c4memoryToggle');
      cpToggle.addEventListener('click', function(){
        E.cpOn = !E.cpOn; syncPlaneToggles();
        PLN.sync(E, E.view.k); PLN.pan(E); redraw();
      });
      tpToggle.addEventListener('click', function(){
        E.tpOn = !E.tpOn; syncPlaneToggles();
        PLN.sync(E, E.view.k); PLN.pan(E); redraw();
      });
      layerToggle.addEventListener('click', function(){
        if(E.memoryMode) return;
        E.layerVisible = !E.layerVisible;
        E.hoverLayer = null;
        syncPlaneToggles(); rebuildPlane();
      });
      memoryToggle.addEventListener('click', function(){ setMemoryMode(!E.memoryMode); });
      syncPlaneToggles();
      stageEl.querySelector('.pzoom').addEventListener('click', function(e){
        var b = e.target.closest('button[data-z]'); if(!b) return;
        var mx = (PLC.RULER_LEFT_W + E.W)/2, my = (PLC.RULER_TOP_H + E.H)/2;
        if(b.dataset.z === 'fit') PLN.fit(E); else PLN.zoom(E, mx, my, E.view.k*(b.dataset.z === 'in' ? 1.25 : 1/1.25));
        zoomRead(); redraw();
      });
      cv.addEventListener('mousedown', function(e){ if(e.button !== 0) return; pan = {sx:e.clientX, sy:e.clientY, vx:E.view.x, vy:E.view.y, moved:false}; });
      cv.addEventListener('mousemove', function(e){
        var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        if(pan){
          var dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
          if(Math.abs(dx) > 3 || Math.abs(dy) > 3) pan.moved = true;
          if(pan.moved){ setLayerHover(null); E.view.x = pan.vx + dx; E.view.y = pan.vy + dy; PLN.pan(E); cv.style.cursor = 'grabbing'; redraw(); }
          return;
        }
        var tk = PLN.tick(E, mx, my), canvasCol = canvasLayerAt(mx, my);
        var ph = (tk || canvasCol) ? null : PLN.hit(E, mx, my), col = canvasCol || tk || (ph && ph.col);
        setLayerHover(col);
        cv.style.cursor = (canvasCol || tk || ph) ? 'pointer' : 'grab';
      });
      cv.addEventListener('mouseleave', function(){ if(!pan) setLayerHover(null); });
      if(!bindCanvas.up){ bindCanvas.up = true;   /* 画布每次 mount 都是新的，window 上这一条只挂一次 */
        window.addEventListener('mouseup', function(){ if(!pan) return; if(pan.moved) suppress = true; pan = null; if(cv) cv.style.cursor = 'grab'; });
      }
      cv.addEventListener('wheel', function(e){
        e.preventDefault();
        var r = cv.getBoundingClientRect();
        if(PLN.zoom(E, e.clientX - r.left, e.clientY - r.top, E.view.k*Math.exp(-e.deltaY*0.0015))){ zoomRead(); redraw(); }
      }, {passive:false});
      cv.addEventListener('click', function(e){
        if(suppress){ suppress = false; return; }
        var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        var tk = PLN.tick(E, mx, my), canvasCol = canvasLayerAt(mx, my);
        var ph = (tk || canvasCol) ? null : PLN.hit(E, mx, my);
        /* 选中 Rank / Layer（以及点空白取消选择）是播放中的辅助查看动作，不终止剧本。
           后续脚本节点仍可按自己的节奏更新选择，未选中 R23 时播放逻辑也保持完整。 */
        /* 画布上的任何一次点击都是「选列 / 选卡」手势，与整网图的算子高亮互斥：统一先清一次。
           放在分支之前是因为点空白处也要清——否则选中没了、通信域却还挂着上一张卡的成员名单。 */
        clearOpPick();
        var perfCol = canvasCol || (perfMode() && (tk || (ph && ph.col)));
        if(perfCol && perfCol.type === 'layer'){
          var perfOff = E.selLayer && PLN.colKey(E.selLayer) === PLN.colKey(perfCol);
          E.selLayer = perfOff ? null : perfCol; E.layerGuide = !perfOff; E.selRank = null;
        }
        else if(tk){
          var off = E.selLayer && PLN.colKey(E.selLayer) === PLN.colKey(tk) && E.selRank === null;
          E.selRank = null;   /* 顶尺始终是公共 Layer 轴，不继承之前点中的 EDP / Rank。 */
          E.selLayer = off ? null : tk; E.layerGuide = !off;
        }
        else if(ph && ph.col && ph.col.type === 'stage'){
          E.selRank = E.selRank === ph.c.r ? null : ph.c.r; E.selLayer = null; E.layerGuide = false;
          if(E.selRank !== null && sideP) sideP.open();
        }
        else if(ph && ph.col){
          /* 性能分析里的 Layer 格子已在上一个分支按整列选择；端点格仍可按 Rank 查看。
             显存那边不受影响——那儿的问题本来就是「这张卡的这一层装了什么」，天然是一格。 */
          if(perfMode()){
            E.selRank = E.selRank === ph.c.r ? null : ph.c.r; E.selLayer = null; E.layerGuide = false;
            if(E.selRank !== null && sideP) sideP.open();
          } else {
            var same = E.selRank === ph.c.r && E.selLayer && PLN.colKey(E.selLayer) === PLN.colKey(ph.col);
            E.selRank = same ? null : ph.c.r; E.selLayer = same ? null : ph.col; E.layerGuide = !same;
            if(!same && sideP) sideP.open();
          }
        }
        else if(ph){ E.selRank = E.selRank === ph.c.r ? null : ph.c.r; if(E.selRank !== null && sideP) sideP.open(); }
        else if(mx >= PLC.RULER_LEFT_W && my >= PLC.RULER_TOP_H){ E.selRank = null; E.selLayer = null; E.layerGuide = false; }
        syncNetFromCanvas(); renderSide(); redraw();
      });
    }
    function selectCell(r, key){
      E.selRank = r; E.layerGuide = true; E.selLayer = null; clearOpPick();
      var T = E.TOPO, l = parseInt(key.slice(1), 10);
      if(key.charAt(0) === 'L' && isFinite(l)) E.selLayer = {type:'layer', layer:l, label:'Layer' + l, short:'L' + l, dense:l < T.dense};
      if(sideP) sideP.open();
      syncNetFromCanvas(); renderSide(); redraw();
    }
    function matrixTarget(r, key){
      return function(){
        var rc = cv && PLN.cellRect(E, r, key); if(!rc) return null;
        return {element:cv, localX:rc.x + rc.w/2, localY:rc.y + rc.h/2};
      };
    }

    /* ── 画 ── */
    var raf = 0;
    function redraw(){ syncMemoryLegend(); if(!raf) raf = requestAnimationFrame(function(){ raf = 0; if(cx) drawMatrix(); if(netDeck) netDeck.refresh(); }); }
    function drawMatrix(){
      cx.setTransform(E.DPR, 0, 0, E.DPR, 0, 0); cx.clearRect(0, 0, E.W, E.H);
      syncHeat();   /* 这一帧要不要铺逐格热力、按哪一层的中位数铺——PLN.draw 里的 cellHeat 钩子读的就是这两个 */
      syncDomain();
      PLN.draw(E);
      var x0 = PLC.RULER_LEFT_W, y0 = PLC.RULER_TOP_H, RED = redRGB(), t = performance.now();
      drawCommDomain();
      /* 超容只给格子铺一层浅红，不再给整行描红框；保留格缝，避免看成全网告警。 */
      if(overA > 0.005){
        cx.save(); cx.beginPath(); cx.rect(x0, y0, E.W - x0, E.H - y0); cx.clip(); cx.globalAlpha = overA;
        var gapX = clamp(PLC.CELL_GAP*E.view.k, PLC.CELL_GAP, 3*PLC.CELL_GAP),
            gapY = clamp(PLC.ROW_GAP*E.view.k, PLC.ROW_GAP, 3*PLC.ROW_GAP), cellW = E.plane.cellW*E.view.k;
        E.PC.forEach(function(c){
          if(!over[c.r]) return;
          var block = E.plane.blocks[c.pp], row = PLN.cellRect(E, c.r, null);
          if(!block || !row || row.y + row.h < y0 || row.y > E.H) return;
          cx.fillStyle = 'rgba(' + RED + ',.22)';
          block.cols.forEach(function(col, ci){
            cx.fillRect(E.view.x + (block.x + ci*E.plane.cellW)*E.view.k, row.y, Math.max(1, cellW - gapX), Math.max(1, row.h - gapY));
          });
        });
        cx.restore();
      }
      /* 性能分析打开时，每个 Layer 列只在顶部标一枚耗时点；它是 Layer 级汇总，
         不落进 Rank × Layer 单元格，避免被误读成逐 Rank 指标。 */
      if(perfMode()) drawLayerPerformanceDots();
      /* 切口径那一下：左尺闪一层蓝——「变的是这两层字」 */
      if(rulerFlash > t){
        var a = Math.min(1, (rulerFlash - t)/700);
        cx.fillStyle = RI.hexA(BLUE, .2*a); cx.fillRect(0, y0, x0, E.H - y0);
        redraw();
      }
    }
    /* ══ 逐 Rank 逐 Layer 的耗时（构造数据）══════════════════════════════════════
       口径：一张卡跑完这一层前反向 kernel 的**纯计算**时间，**不含**它在同步点上的等待。
       等待是被别人拖出来的——混进来就再也分不清「谁慢」和「谁被拖慢」，而这张矩阵唯一
       值得答的就是这个区别。等待的代价单独算，见 columnDomainStats() 里每组的 waste。

       不用随机噪声：一幅处处均匀的热力图什么也教不了人。按并行维度分层构造，并刻意埋
       两处**形态不同**的典型故障，能不能被一眼分开正是这张矩阵存在的理由：
         · 掉队卡：一张卡全程慢 38%（降频 / 坏件），与层类型无关 → **一整行**发烫；
         · 热 EP 组：路由偏爱这一组的专家，只在 MoE 层慢 26%、dense 层完全正常
           → **隔行成组**（EP 成员在 rank 序里按 CP×TP 跨步排列）。
       而且掉队卡就落在 R23 所在的那个 EP 组里：组内 a2a 是同步点，于是「一张卡的毛病」
       会变成「四张卡的代价」——这一笔由域聚合面板算给你看。 */
    function stragglerRank(){
      var T = E.TOPO; if(!T) return -1;
      return Math.floor(T.dp/2)*T.cp*T.tp + (T.cp - 1)*T.tp + (T.tp - 1);   /* 基线 R19：PP0 · DP4 · CP1 · TP1，与 R23 同一个 EP 组 */
    }
    function hotEpGroup(){
      var T = E.TOPO; if(!T) return null;
      return {pp:Math.min(2, T.pp - 1), cp:1, tp:0, g:0};
    }
    /* 一个 EP 组横跨几台机器：组员 r 在一段里按 CP×TP 跨步排列。 */
    function epNodeSpan(c){
      var T = E.TOPO, g = Math.floor(c.dp/T.ep), rpn = T.rpn || 8;
      var first = c.pp*T.rows + g*T.ep*T.cp*T.tp + c.cp*T.tp + c.tp, last = first + (T.ep - 1)*T.cp*T.tp;
      return Math.floor(last/rpn) - Math.floor(first/rpn) + 1;
    }
    function rankLayerMs(r, layer){
      var T = E.TOPO, c = E.PC[r];
      if(!T || !c || !isFinite(Number(layer))) return 0;
      var moe = layer >= T.dense, f = 0.97 + ((r*37 + layer*11) % 13)/200;   /* 同型号卡之间 ±3% 的常态离散 */
      if(r === stragglerRank()) f *= 1.38;
      var hot = hotEpGroup();
      if(moe && hot && c.pp === hot.pp && c.cp === hot.cp && c.tp === hot.tp && Math.floor(c.dp/T.ep) === hot.g) f *= 1.26;
      if(moe && epNodeSpan(c) > 1) f *= 1.05;   /* a2a 出机器，走机间网络 */
      return layerPerformanceMs(layer)*f;
    }
    /* 一个 Layer 只由它所属 PP stage 的 Rank 执行。默认 128 Rank、PP=4 时，一层的比较对象是
       该 stage 内的 32 Rank，而不是全网 128 Rank；所有列中位、域分组与热力基准都共用这份成员集。 */
    function layerCards(layer){
      if(!E.TOPO) return [];
      var stage = clamp(Math.floor(layer/E.TOPO.lps), 0, E.TOPO.pp - 1);
      return E.PC.filter(function(c){ return c.pp === stage; });
    }

    /* ══ 并行域：谁和谁在同一个同步点上 ══════════════════════════════════════════
       成员判据照本页第 9 步 commOf() 那套（同一页里「TP / EP / DP / EDP 各是哪些卡」
       只能有一个说法），差别只有两处：这里把 (dp>>3) 参数化成 (dp / T.ep)，并且**含自己**
       —— 域聚合要把选中的这张卡也算进分布里。 */
    /* at：这个同步点多久撞一次。层级（每层 / 每 MoE 层）的域才谈得上「这一层白等多少」；
       DP / EDP 是步末各一次的梯度 All-Reduce，把它按层记就是虚报，所以只报倾斜、不报代价。 */
    var DOMAINS = [
      {k:'tp', name:'TP 组', at:'每层', perLayer:true},
      {k:'ep', name:'EP 组', at:'每 MoE 层', perLayer:true, moeOnly:true},
      {k:'cp', name:'CP 组', at:'每层', perLayer:true},
      {k:'dp', name:'DP 组', at:'步末'},
      {k:'edp', name:'EDP 组', at:'步末', moeOnly:true},
    ];
    /* ══ 整列口径的域聚合 ════════════════════════════════════════════════════════
       选中一列（而不是一张卡）时，右栏那块读数没有锚点可依：要把该 Layer 所属 PP Stage
       里的同类组都算一遍，再回答两件事——
         · 组中位耗时最高的是哪一组（组间差异：整组摊到的活多）；
         · 组内耗时差最大的是哪一组（组内差异：有人掉队，同步点在等他）。
       这两件事的处方相反，所以分开报、也分开给点击入口：点哪一行就在矩阵里标出哪一组。 */
    /* 成员判据照本页第 9 步 commOf() 那套（同一页里「TP / EP / DP / EDP 各是哪些卡」只能有一个说法），
       差别只有一处：那里的 (dp>>3) 在这里参数化成 (dp / T.ep)。 */
    function groupKeyOf(kind, c){
      var T = E.TOPO;
      return kind === 'tp' ? c.pp + '/' + c.dp + '/' + c.cp
        : kind === 'ep' ? c.pp + '/' + c.cp + '/' + c.tp + '/' + Math.floor(c.dp/T.ep)
        : kind === 'cp' ? c.pp + '/' + c.dp + '/' + c.tp
        : kind === 'dp' ? c.pp + '/' + c.cp + '/' + c.tp
        : c.pp + '/' + c.cp + '/' + (c.dp % T.ep);   /* EDP：同 CP 的专家副本；CP 对片另归约 */
    }
    function groupLabel(kind, c){
      var T = E.TOPO;
      return kind === 'tp' ? 'PP' + c.pp + '·DP' + c.dp + '·CP' + c.cp
        : kind === 'ep' ? 'PP' + c.pp + '·CP' + c.cp + '·TP' + c.tp + '·组' + Math.floor(c.dp/T.ep)
        : kind === 'cp' ? 'PP' + c.pp + '·DP' + c.dp + '·TP' + c.tp
        : kind === 'dp' ? 'PP' + c.pp + '·CP' + c.cp + '·TP' + c.tp
        : 'PP' + c.pp + '·CP' + c.cp + '·片' + (c.dp % T.ep);
    }
    function columnDomainStats(kind, layer){
      if(!E.TOPO || !E.PC.length) return null;
      var byKey = {}, order = [];
      layerCards(layer).forEach(function(c){
        var k = groupKeyOf(kind, c);
        if(!byKey[k]){ byKey[k] = {key:k, label:groupLabel(kind, c), anchor:c, ranks:[]}; order.push(byKey[k]); }
        byKey[k].ranks.push(c.r);
      });
      order.forEach(function(g){
        var v = g.ranks.map(function(x){ return rankLayerMs(x, layer); }).sort(function(a, b){ return a - b; });
        g.med = medianOf(v); g.max = v[v.length - 1];
        /* 组内耗时差。组里不足 4 张时中位数说明不了问题（两三个样本，中位紧挨着最大值），
           改用「最大 / 最小」的全幅：两张卡里有一张慢 38%，该读成组内差 38%，不是整组偏重。 */
        g.skew = g.ranks.length >= 4 ? (g.med > 0 ? g.max/g.med - 1 : 0) : (v[0] > 0 ? g.max/v[0] - 1 : 0);
        g.rel = heatMed > 0 ? g.med/heatMed - 1 : 0;
        g.waste = (g.max - g.med)*(g.ranks.length - 1);
        var best = -1;
        g.ranks.forEach(function(x){ var q = rankLayerMs(x, layer); if(q > best){ best = q; g.slowRank = x; } });
      });
      var hot = order[0], lag = order[0];
      order.forEach(function(g){ if(g.med > hot.med) hot = g; if(g.skew > lag.skew) lag = g; });
      return {kind:kind, groups:order.length, size:order[0].ranks.length,
              nodes:kind === 'ep' ? epNodeSpan(order[0].anchor) : 0, hot:hot, lag:lag};
    }

    /* ══ ① 选中列的逐格热力 ═════════════════════════════════════════════════════
       量程是**相对本列中位数**的 −8%～+45%，不是这一列的 min–max：后者会让一列健康的卡
       （彼此差 2%）里最慢的那张也烧成全红，纯属吓人。相对量程下，均匀的一列整体停在色阶
       中段、看着就是均匀，只有真掉队的那张才冲到红端。
       跨层比较不归它管——那是顶尺那排耗时点的事（固定量程 4.5 ms），两种量程的分工写在域面板表头。 */
    /* 色阶落点：**中位数固定落在色带正中**（Turbo 的青绿档 = 「正常」），两侧各占半条。
       慢的一侧量程 +40%、快的一侧 −20%：卡只会被别的事拖慢，不会莫名快出一大截，两侧不必对称。
       为什么不按这一列的 min–max 归一：那会让一列健康的卡（彼此差 3%）里最慢的那张也烧成全红，纯属吓人。 */
    var HEAT_DOWN = .20, HEAT_UP = .40;
    function heatPos(ratio){
      return ratio < 1 ? clamp(.5*(1 - (1 - ratio)/HEAT_DOWN), 0, .5) : clamp(.5 + .5*(ratio - 1)/HEAT_UP, .5, 1);
    }
    /* 真·中位数（偶数个取中间两个的平均）。不能用「四舍五入取一个下标」那种近似：
       两张卡的 TP 组里那样取到的就是**最大值**，一张掉队卡会被读成「整组偏重」，归因正好反了。 */
    function medianOf(sorted){
      var n = sorted.length; if(!n) return 0;
      return n % 2 ? sorted[(n - 1)/2] : (sorted[n/2 - 1] + sorted[n/2])/2;
    }
    /* 每一层在所属 PP stage 内的中位数：两种模式都以它为基准，所以按层缓存一份（拓扑一变就作废）。 */
    /* 「全部」档一次要铺满整张矩阵，rankLayerMs 每帧会被调用几千次；
       它是 (rank, layer, 拓扑) 的纯函数，连同每层的中位数一起按拓扑签名缓存，拓扑一变整份作废。 */
    var perfCache = {sig:'', med:null, cell:null};
    function perfCacheOf(){
      var sig = E.TOPO ? [E.TOPO.layers, E.TOPO.pp, E.TOPO.dp, E.TOPO.cp, E.TOPO.tp, E.TOPO.ep, E.TOPO.dense].join('/') : '';
      if(perfCache.sig !== sig) perfCache = {sig:sig, med:{}, cell:{}};
      return perfCache;
    }
    function msAt(r, layer){
      var c = perfCacheOf().cell, k = r + ':' + layer;
      if(c[k] === undefined) c[k] = rankLayerMs(r, layer);
      return c[k];
    }
    function colMedAt(layer){
      var m = perfCacheOf().med;
      if(m[layer] === undefined){
        var vals = layerCards(layer).map(function(c){ return msAt(c.r, layer); }).sort(function(a, b){ return a - b; });
        m[layer] = medianOf(vals);
      }
      return m[layer];
    }
    /* 三种模式，同一套色义 —— 一格的颜色永远是「它比**同一层**的其他卡快还是慢」：
         全部（什么都没选）：整张矩阵铺满 → 答「全网的热点分布在哪」，一眼看出是一整行、
                            还是隔行成组、还是某几列整体偏深；
         列模式（选中一列）：固定层、只比较所属 PP stage 的 Rank → 答「这一层谁慢」；
         行模式（选中一张卡）：固定卡、沿行走 48 层，每层各按自己那一列的中位数归一
                              → 答「这张卡在哪些层上落后于同侪」。
       行模式不用「这张卡各层的绝对耗时」上色，是因为那条信息顶尺那排耗时点已经在说了（固定量程 4.5 ms），
       而且各层绝对值的高低主要来自层本身耗时高不高，与这张卡好不好无关。改成相对同层中位后：
       一张健康的卡整行是齐的中段色，掉队卡整行发烫，热 EP 组里的卡则 dense 层正常、MoE 层发烫——
       毛病的**形状**直接读得出来，这才是选中一张卡时真正想问的。 */
    /* 普通画布手势仍把「选列」和「选卡」当成两种问法；洞察里的「定位 Rank」是例外：保留当前 Layer
       作为上下文，同时选中异常 Rank。双选时当前列与目标 Rank 整行都铺热力，右栏优先展示 Rank 信息。 */
    function perfMode(){ return panelTab === 'net' && netMode === 'perf'; }
    var heatMode = null, heatLayer = null, heatRank = null, heatMed = 0;
    function heatColumnLayer(){
      /* 点算子 → 看它命中的那一列；否则看选中的 Layer 列。端点列（Emb/Norm/Head）不铺：它们不是重复层，没有「跨 rank 分布」可言 */
      if(E.hiCols){
        for(var k in E.hiCols){
          if(!E.hiCols[k] || k.charAt(0) !== 'L') continue;
          var l = parseInt(k.slice(1), 10); if(isFinite(l)) return l;
        }
        return null;
      }
      return E.selLayer && E.selLayer.type === 'layer' ? E.selLayer.layer : null;
    }
    function syncHeat(){
      heatMode = null; heatLayer = null; heatRank = null; heatMed = 0; E.cellHeat = null;
      if(!perfMode() || !E.TOPO || !E.PC.length) return;
      var l = heatColumnLayer();
      if(l !== null){
        heatLayer = l; heatMed = colMedAt(l); if(!heatMed) return;
        if(E.selRank !== null){ heatMode = 'rowcol'; heatRank = E.selRank; }
        else heatMode = 'col';
      }
      else if(E.selRank !== null){ heatMode = 'row'; heatRank = E.selRank; }
      /* 性能分析下什么都没选（左栏翻页停在「全部」）＝ 要的是全景，整张矩阵铺满，而不是一片空白 */
      else heatMode = 'all';
      E.cellHeat = cellHeatOf;
    }
    function cellHeatOf(r, col){
      if(col.type !== 'layer') return null;   /* Emb / Norm / Head 不是重复层，没有「同层的其他卡」可比 */
      if(heatMode === 'col') return col.layer === heatLayer ? performanceColor(heatPos(msAt(r, heatLayer)/heatMed), 1) : null;
      if(heatMode === 'rowcol'){
        if(r !== heatRank && col.layer !== heatLayer) return null;
        var bothMed = col.layer === heatLayer ? heatMed : colMedAt(col.layer);
        return bothMed ? performanceColor(heatPos(msAt(r, col.layer)/bothMed), 1) : null;
      }
      if(heatMode === 'row' && r !== heatRank) return null;
      var med = colMedAt(col.layer);   /* 行模式与全部档都是逐层按各自那一列的中位数归一 */
      return med ? performanceColor(heatPos(msAt(r, col.layer)/med), 1) : null;
    }

    /* ══ ③ 算子 → 通信域 ════════════════════════════════════════════════════════
       点一枚集合通信算子，问的是「这一次通信把哪些卡拴在了一起」。答案是一个 rank 集合，
       正是矩阵里那一批行——这也是这张矩阵上「这么多格子」最直接的用处：它们是域的**成员名单**。
       梯度 All-Reduce（DP / EDP）不在前向图里，没有可点的节点，只出现在域聚合表里。 */
    /* 从域聚合表里点中的那一维（'tp'|'ep'|'dp'|'edp'）。它与算子驱动的通信域是同一块叠加层的两个入口：
       算子那条自带锚点与文案、优先级更高；这条**跟着选中卡走**——换一张卡就按新锚点重算成员，
       不必回表里再点一次（「给我看这张卡的 EP 组」本来就是一条持续的诉求，不是一次性查询）。 */
    var domPick = null;
    function syncDomain(){
      if(!domPick || heatLayer === null || !E.TOPO){ E.hiDomain = null; return; }
      /* 'auto'（由点算子进来的）在这里落实成具体的一组，落实后写回 domPick —— 面板的选中态要认它 */
      if(domPick.which === 'auto'){
        var probe = columnDomainStats(domPick.kind, heatLayer);
        domPick.which = probe && probe.lag.skew > .1 ? 'lag' : 'hot';
      }
      /* 「组中位耗时最高 / 组内耗时差最大」是跟着层走的（换一层就可能是另一组），所以每次按当前层现解析，
         不把成员名单存进 domPick —— 存了就会在翻层之后指着一组过时的卡。 */
      var cs = columnDomainStats(domPick.kind, heatLayer), g = cs && cs[domPick.which];
      if(!g){ E.hiDomain = null; return; }
      domPick.label = g.label; domPick.n = g.ranks.length;
      E.hiDomain = {kind:domPick.kind, ranks:g.ranks};
    }
    var COMM_DOMAIN = {a2a_dispatch:'ep', a2a_combine:'ep', expert_pool:'ep',
                       moe_all_gather:'tp', moe_reduce_scatter:'tp',
                       attn_all_gather:'tp', attn_reduce_scatter:'tp', logits_allgather:'tp'};
    function layerPerformanceMs(layer){
      var wave = ((layer + 3)*17 % 29)/28, base = layer < E.TOPO.dense ? 2.46 : 3.18;
      return base*(.72 + .42*wave);
    }
    function drawLayerPerformanceDots(){
      if(!E.plane || !E.TOPO) return;
      var x0 = PLC.RULER_LEFT_W, y0 = PLC.RULER_TOP_H, cellW = E.plane.cellW*E.view.k;
      cx.save(); cx.beginPath(); cx.rect(x0, 0, E.W - x0, y0); cx.clip();
      E.plane.blocks.forEach(function(block){
        if(!block) return;
        block.cols.forEach(function(col, ci){
          if(col.type !== 'layer') return;
          var x = E.view.x + (block.x + ci*E.plane.cellW)*E.view.k, r = clamp(cellW*.1, 1.5, 3);
          if(x + cellW < x0 || x > E.W) return;
          cx.beginPath(); cx.arc(x + cellW/2, y0 - r - 2, r, 0, Math.PI*2);
          cx.fillStyle = performanceColor(layerPerformanceMs(col.layer), 4.5); cx.globalAlpha = .95; cx.fill();
          cx.strokeStyle = isDark() ? 'rgba(8,10,15,.72)' : 'rgba(255,255,255,.82)'; cx.lineWidth = Math.max(.75, r*.38); cx.stroke();
        });
      });
      cx.restore();
    }
    /* ③ 通信域的成员名单铺在画布上：每个成员一条淡底 + 左尺边上一枚色签（域色照第 9 步的 VC，
       同一页里 TP 青 / EP 紫 / DP 蓝 / EDP 粉只有一套说法）。选中的那张卡的签更实，它是域的锚点。 */
    function drawCommDomain(){
      var d = E.hiDomain;
      if(!d || !d.ranks || !d.ranks.length || !E.plane) return;
      var x0 = PLC.RULER_LEFT_W, y0 = PLC.RULER_TOP_H, col = (RI.VC && RI.VC[d.kind]) || BLUE;
      cx.save(); cx.beginPath(); cx.rect(0, y0, E.W, E.H - y0); cx.clip();
      d.ranks.forEach(function(r){
        var row = PLN.cellRect(E, r, null);
        if(!row || row.y + row.h < y0 || row.y > E.H) return;
        var me = r === E.selRank;
        cx.fillStyle = RI.hexA(col, me ? .18 : .10);
        cx.fillRect(x0, row.y, E.W - x0, Math.max(1, row.h - 1));
        cx.fillStyle = RI.hexA(col, me ? 1 : .68);
        cx.fillRect(x0 - 4, row.y + 1, 3, Math.max(2, row.h - 3));
      });
      cx.restore();
    }
    /* ② 域聚合读数。三种状态：点了集合通信算子 → 那一个域的名单与代价；只选了 Layer 列 →
       五个域各自的分布；其余（没在性能分析、或选的是端点列）→ 收起。
       签名去重：redraw 是按帧跑的，状态没变就不碰 DOM。 */
    function fmtMs(v){ return v.toFixed(2); }
    function pct(v){ return (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)*100) + '%'; }
    function domainDef(kind){ return DOMAINS.filter(function(d){ return d.k === kind; })[0] || {}; }
    function domainColor(kind){ return (RI.VC && RI.VC[kind]) || BLUE; }
    function adviceHtml(html, rank){
      return '<div class="cro-config-error c4dm-advice is-blocking is-guidance">'
        + '<p class="cro-config-error__msg"><strong class="cro-config-error__title">洞察</strong><span>' + html + '</span></p>'
        + (rank === null || rank === undefined ? '' : '<div class="cro-config-error__actions"><button type="button" class="pri" data-act="locate-rank" data-rank="' + rank + '" aria-label="定位 R' + rank + '">定位</button></div>')
        + '</div>';
    }
    /* 选中列时右栏的一块：这一维在整列上分成多少组、耗时最高的是哪一组、组内耗时差最大的是哪一组。
       两张等高卡各自可点——点谁就在矩阵里标出谁的成员。 */
    function domainBlockHtml(cs, moe){
      var def = domainDef(cs.kind), c = domainColor(cs.kind);
      var card = function(which, g, label, val, bad, basis){
        var zero = val === '+0%' || val === '−0%';
        var on = !zero && domPick && domPick.kind === cs.kind && domPick.which === which;
        return '<button type="button" class="c4dm-card' + (on ? ' is-on' : '') + (bad ? ' is-bad' : '') + (zero ? ' is-zero' : '') + '"'
          + ' data-dom="' + cs.kind + '" data-which="' + which + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
          + (zero ? ' disabled aria-disabled="true"' : '')
          + ' aria-label="' + label + ' ' + esc(g.label) + '：' + basis + ' ' + val + (zero ? '，无明显差异' : '。在矩阵里标出这 ' + g.ranks.length + ' 张卡') + '">'
          + '<span class="hd"><span class="k">' + label + '</span><span class="v">' + val + '</span></span>'
          + '<span class="g">' + esc(g.label) + '</span></button>';
      };
      return '<section class="c4dm-blk" style="--dom-c:' + c + '">'
        + '<h4><em></em>' + esc(def.name) + '<span>' + cs.groups + ' 组 × ' + cs.size + ' 张'
        + (cs.kind === 'ep' && cs.nodes > 1 ? ' · 跨 ' + cs.nodes + ' 机' : '') + ' · ' + esc(def.at) + '</span></h4>'
        + '<div class="c4dm-cards">'
        + card('hot', cs.hot, '耗时最高组', pct(cs.hot.rel), cs.hot.rel > .1 && cs.hot.skew <= .1,
               '组中位比本层 PP Stage 中位')
        + card('lag', cs.lag, '组内耗时差最大', pct(cs.lag.skew), cs.lag.skew > .1,
               '最慢卡比' + (cs.lag.ranks.length >= 4 ? '组内中位' : '组内最快卡'))
        + '</div>'
        + '</section>';
    }
    function domainOffHtml(kind){
      var def = domainDef(kind);
      return '<section class="c4dm-blk is-off" style="--dom-c:' + domainColor(kind) + '">'
        + '<h4><em></em>' + esc(def.name) + '</h4><p class="c4dm-off">Dense 层不使用专家同步域</p></section>';
    }
    /* 整列口径的一句结论。优先级与逐卡口径那版一致：先组内掉队（有人拖着大家），再整组偏热（活分得不均）。 */
    function columnVerdict(all, moe){
      var lag = null, heavy = null;
      all.forEach(function(cs){
        if(!cs) return;
        if(cs.lag.skew > .1 && domainDef(cs.kind).perLayer && (!lag || cs.lag.waste > lag.lag.waste)) lag = cs;
        /* 组之所以热是因为组里混了一张掉队卡的话，它不是「负载不均」——要求组内齐平才算 */
        if(cs.hot.rel > .1 && cs.hot.skew <= .1 && (!heavy || cs.hot.rel > heavy.hot.rel)) heavy = cs;
      });
      if(lag){
        var lagBase = lag.lag.ranks.length >= 4 ? '组内中位' : '组内最快卡';
        return {html:'<b>' + esc(domainDef(lag.kind).name) + ' ' + esc(lag.lag.label) + '</b> 里 <b>R' + lag.lag.slowRank
          + '</b> 比' + lagBase + '慢 ' + pct(lag.lag.skew) + '：同步点要等它，其余 ' + (lag.lag.ranks.length - 1)
          + ' 张每过一次这一层白等约 <b>' + fmtMs(lag.lag.waste) + ' 卡·ms</b>。', rank:lag.lag.slowRank};
      }
      if(heavy){
        return {html:'<b>' + esc(domainDef(heavy.kind).name) + ' ' + esc(heavy.hot.label) + '</b> 组内齐平（'
          + pct(heavy.hot.skew) + '），但整组比本层 PP Stage 中位重 <b>' + pct(heavy.hot.rel) + '</b>：没人在等谁，'
          + '是这一组摊到的活本来就多'
          + (heavy.kind === 'ep' ? '（路由偏爱它持有的那批专家）' : '') + '。要动的是<b>负载分配</b>，不是查硬件。', rank:null};
      }
      return {html:'各维的组中位耗时差异与组内耗时差都在 ±10% 内，这一层没有木桶，也没有偏重的组。', rank:null};
    }
    function toggleDomPick(kind, which){
      if(!kind || !which) return;
      var same = domPick && domPick.kind === kind && domPick.which === which;
      domPick = same ? null : {kind:kind, which:which, label:'', n:0};
      sideDomSig = '';   /* 选中态写在面板里，强制重写一次 */
      renderSide(); redraw();
    }
    /* 委托绑在右栏壳上，绑一次 —— panel() 每次都重写内部 innerHTML，监听挂在行上会被冲掉 */
    function bindDomPanel(el){
      if(!el || el.dataset.domBound) return;
      el.dataset.domBound = '1';
      el.addEventListener('click', function(e){
        var locate = e.target.closest('button[data-act="locate-rank"]');
        if(locate){ locateRank(+locate.dataset.rank); return; }
        var row = e.target.closest('button.c4dm-card'); if(row) toggleDomPick(row.dataset.dom, row.dataset.which);
      });
    }
    function locateRank(rank){
      if(!isFinite(rank) || rank < 0 || rank >= E.PC.length) return;
      var layer = heatLayer;
      clearOpPick(); domPick = null; E.hiDomain = null;
      E.selRank = rank;
      if(layer !== null){ E.selLayer = colOfNet(layer); E.layerGuide = !!E.selLayer; }
      sideDomSig = '';
      if(sideP) sideP.open();
      syncNetFromCanvas(); renderSide(); redraw();
    }
    /* 「全部」档的全景读数：哪张卡整体落后于同侪、哪一层耗时最高。
       每张卡取它在各层「相对同层中位」比值的中位数——用中位而不是均值，免得少数几层的抖动决定排名。 */
    function overviewStats(){
      var L = E.TOPO.layers, worstRank = null, worstRatio = 0;
      E.PC.forEach(function(c){
        var rs = [];
        var lo = c.pp*E.TOPO.lps, hi = Math.min(L, lo + E.TOPO.lps);
        for(var l = lo; l < hi; l++){ var m = colMedAt(l); if(m) rs.push(msAt(c.r, l)/m); }
        rs.sort(function(a, b){ return a - b; });
        var v = medianOf(rs);
        if(v > worstRatio){ worstRatio = v; worstRank = c.r; }
      });
      var hotLayer = 0, hotMs = 0, loMs = Infinity;
      for(var l = 0; l < L; l++){
        var m = colMedAt(l);
        if(m > hotMs){ hotMs = m; hotLayer = l; }
        if(m && m < loMs) loMs = m;
      }
      return {worstRank:worstRank, worstRatio:worstRatio - 1, hotLayer:hotLayer, hotMs:hotMs, loMs:loMs};
    }
    function overviewPanelHtml(){
      var o = overviewStats(), T = E.TOPO, bad = o.worstRatio > .1;
      var advice = bad
        ? '优先检查 <b>R' + o.worstRank + '</b>：它在各层相对同层中位普遍慢 <b>' + pct(o.worstRatio) + '</b>，先核对频率、温度与硬件状态。'
        : '暂未发现持续掉队卡；可从耗时最高的 <b>L' + o.hotLayer + '</b> 继续下钻，区分层本身计算量与卡间异常。';
      return adviceHtml(advice, bad ? o.worstRank : null)
        + '<p class="c4dm-top">' + E.PC.length + ' 张 × ' + T.layers + ' 层 · 每层取所属 PP Stage 的 ' + T.rows + ' 张卡计算耗时中位，范围 <b>'
        + fmtMs(o.loMs) + ' – ' + fmtMs(o.hotMs) + ' ms</b>；矩阵显示每张卡相对同层中位的快慢。</p>'
        + '<section class="c4dm-blk" style="--dom-c:' + BLUE + '">'
        + '<h4><em></em>全网热点<span>相对同层中位</span></h4>'
        + '<div class="c4dm-cards">'
        + '<div class="c4dm-card' + (bad ? ' is-bad' : '') + '"><span class="hd"><span class="k">最慢的卡</span><span class="v">' + pct(o.worstRatio) + '</span></span><span class="g">R'
        + o.worstRank + '</span></div>'
        + '<div class="c4dm-card"><span class="hd"><span class="k">耗时最高的层</span><span class="v">' + fmtMs(o.hotMs) + ' ms</span></span><span class="g">L' + o.hotLayer
        + '</span></div></div>'
        + '</section>'
        + '<p class="c4dm-hint">点顶尺或用左栏翻页选一层，看它的各域差异；点一格看那张卡的显存账。</p>';
    }
    function domainPanelHtml(){
      var moe = heatLayer >= E.TOPO.dense;
      var peers = layerCards(heatLayer), stage = peers.length ? peers[0].pp : Math.floor(heatLayer/E.TOPO.lps);
      var all = DOMAINS.map(function(def){ return (def.moeOnly && !moe) ? null : columnDomainStats(def.k, heatLayer); });
      var verdict = columnVerdict(all, moe);
      var lead = hiOp && COMM_DOMAIN[hiOp]
        ? '<p class="c4dm-lead" style="--dom-c:' + domainColor(COMM_DOMAIN[hiOp]) + '"><b>' + esc(opLabel(hiOp))
          + '</b> 跑在 <b>' + esc(domainDef(COMM_DOMAIN[hiOp]).name) + '</b> 上，这一层共 '
          + (columnDomainStats(COMM_DOMAIN[hiOp], heatLayer) || {}).groups + ' 组。</p>'
        : '';
      return adviceHtml(verdict.html, verdict.rank)
        + '<p class="c4dm-top">L' + heatLayer + ' 比较基准 <b>' + fmtMs(heatMed) + ' ms</b>（PP' + stage + ' 内 ' + peers.length
        + ' 张卡的纯计算耗时中位数，不含通信与等待）</p>'
        + lead
        + all.map(function(cs, i){ return cs ? domainBlockHtml(cs, moe) : domainOffHtml(DOMAINS[i].k); }).join('')
        + (domPick ? '<p class="c4dm-hint">矩阵里标出的是 <b style="color:' + domainColor(domPick.kind) + '">' + esc(domPick.label || '')
              + '</b> 的 ' + domPick.n + ' 张卡 · 再点一次收起</p>' : '')
        ;
    }
    /* 算子 id → 面板上的中文名：取整网图里那枚节点的文案，两边叫法一致 */
    function opLabel(id){
      var node = netHost && netHost.querySelector('[data-node="' + id + '"]');
      var txt = node ? (node.getAttribute('aria-label') || node.textContent || '').trim() : '';
      /* 只取 · 前的主名：节点文案是「EP Combine · fused A2A」这种带限定的全称，挂进面板标题会折行 */
      return (txt || String(id).replace(/_/g, ' ')).split(' · ')[0];
    }
    /* 整网图直接挂载 config-relation-plane 使用的 model-architecture-3d-deck 组件。
       这里仅把当前案例的拓扑配置喂给组件，并把组件节点的选择翻译成矩阵列集合；DOM、投影、配色和交互均由组件自身负责。 */
    var PERFORMANCE_BASE = {
      embedding:.42, final_norm:.18, lm_head:1.64, logits_allgather:.72,
      attn_norm:.09, attn_all_gather:.46, q_a_proj:.64, kv_a_proj:.82, q_causal_conv:.17, kv_causal_conv:.21,
      q_residual_add:.06, kv_residual_add:.07, q_a_norm:.08, kv_a_norm:.09, q_b_proj:.71, kv_b_proj:.94,
      query_tensor:.05, key_tensor:.06, attention_core:3.84, o_causal_conv:.22, o_residual_add:.05, o_proj:.88,
      attn_reduce_scatter:.53, post_attention_norm:.08, mhc_attention_post:.14, pre_mlp_norm:.08,
      moe_all_gather:.44, dense_gate_up:2.12, dense_silu:.38, dense_down:1.76, moe_reduce_scatter:.48,
      gate:.31, a2a_dispatch:1.88, expert_pool:3.26, shared_expert:1.22, a2a_combine:1.67, moe_branch_add:.11,
      post_mlp_norm:.08, ffn_residual_add:.15, block_post_norm:.07, mtp_input_norms:.09, mtp_eh_proj:.74,
      mtp_decoder_layer:2.34, mtp_shared_head:1.28
    };
    function performanceMetrics(layer){
      var out = {}, index = layer === 'all' ? 0 : Number(layer) || 0;
      for(var id in PERFORMANCE_BASE){
        var salt = 0; for(var i = 0; i < id.length; i++) salt = (salt + id.charCodeAt(i)*(i + 3)) % 31;
        out[id] = +(PERFORMANCE_BASE[id]*(.91 + ((salt + index*7)%19)/100)).toFixed(3);
      }
      return out;
    }
    function performanceColor(value, max){
      return window.PtoModelArchitecture3dDeck && window.PtoModelArchitecture3dDeck.performanceColor
        ? window.PtoModelArchitecture3dDeck.performanceColor(value, max)
        : PR.heatColor(value/max, PR.HEAT_RAMP);
    }
    function updatePerfLegend(){
      var metrics = performanceMetrics(netMetricLayer()), values = Object.keys(metrics).map(function(k){ return metrics[k]; }), lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
      var minEl = document.getElementById('c4perfmin'), maxEl = document.getElementById('c4perfmax');
      if(minEl) minEl.textContent = lo.toFixed(2) + ' ms'; if(maxEl) maxEl.textContent = hi.toFixed(2) + ' ms';
    }
    var DENSE_OPS = {moe_all_gather:1, dense_gate_up:1, dense_silu:1, dense_down:1, moe_reduce_scatter:1};
    var MOE_OPS = {gate:1, a2a_dispatch:1, expert_pool:1, shared_expert:1, a2a_combine:1, moe_branch_add:1};
    var EMB_OPS = {token_ids:1, positions:1, attention_context:1, embedding_weight:1, embedding:1};
    var NORM_OPS = {final_norm:1};
    var HEAD_OPS = {lm_head_weight:1, lm_head:1, logits_allgather:1, logits:1, mtp_input_norms:1, mtp_eh_proj:1, mtp_decoder_layer:1, mtp_head_weight:1, mtp_shared_head:1, mtp_logits:1};
    function opSet(id){
      if(EMB_OPS[id]) return 'emb';
      if(NORM_OPS[id]) return 'norm';
      if(HEAD_OPS[id]) return 'head';
      if(DENSE_OPS[id]) return 'dense';
      if(MOE_OPS[id]) return 'moe';
      return 'all';
    }
    function columnForOp(id, layer){
      var set = opSet(id), o = {};
      if(set === 'emb') o.emb = true; else if(set === 'norm') o.norm = true; else if(set === 'head') o.head = true;
      else {
        var target = layer !== null && layer !== undefined && isFinite(Number(layer)) ? Number(layer)
          : (netLayer !== 'all' ? Number(netLayer) : deckLayerFor(id));
        if(target !== null && isFinite(target)) o['L' + target] = true;
      }
      return o;
    }
    function deckConfig(){
      var T = E.TOPO, ranges = [], reps = [], dsa = [], dense = [], post = [0,4,9,14,19,24,29,34,39,44];
      for(var s = 0; s < T.pp; s++){
        var lo = Math.round(s*T.lps), hi = Math.round((s + 1)*T.lps) - 1;
        ranges.push([lo, hi]); reps.push(lo);
      }
      for(var l = 0; l < T.layers; l++){ if(l < T.dense) dense.push(l); if(l % 3 === 0) dsa.push(l); }
      return {id:'openpangu-flash', label:'openPangu-2.0-Flash', layerCount:T.layers, depthGap:46,
              frontLayer:Math.max(T.dense, Math.floor(T.layers/2)), firstMoeLayer:T.dense, denseLayers:dense,
              dsaLayers:dsa, blockPostLayers:post.filter(function(l){ return l < T.layers; }),
              routedExperts:lastValid.routed, topK:lastValid.topk, stageRanges:ranges, representativeLayers:reps};
    }
    function deckSignature(){
      var T = E.TOPO;
      return [T.layers,T.pp,T.dense,lastValid.routed,lastValid.topk].join('/');
    }
    function deckLayerFor(id){
      var set = opSet(id);
      if(set === 'emb' || set === 'norm' || set === 'head') return null;
      if(set === 'dense') return 0;
      return Math.max(E.TOPO.dense, Math.floor(E.TOPO.layers/2));
    }
    function mountNet(){
      if(!netHost || !E.TOPO || !window.PtoModelArchitecture3dDeck) return;
      var sig = deckSignature(), theme = isDark() ? 'dark' : 'light';
      if(netDeck && netDeck.root === netHost && sig === netSig){
        netDeck.setTheme(theme);
        netDeck.setPerformanceMetrics(netMode === 'perf' ? performanceMetrics(netMetricLayer()) : null);
        updatePerfLegend(); syncNetControls(); return;
      }
      if(netDeck) netDeck.destroy();
      netHost.innerHTML = ''; netSig = sig;
      netDeck = window.PtoModelArchitecture3dDeck.render(netHost, {
        config:deckConfig(), initialView:'front', showChrome:false, initialTheme:theme,
        performanceMetrics:netMode === 'perf' ? performanceMetrics(netMetricLayer()) : null,
        onNodeSelect:function(selected){
          if(deckMuted || !selected) return;
          pickOp(selected.nodeId, true, selected.layer);
        }
      });
      if(netDeck) applyNetView();   /* 视图 / 取景框 / data-net-scope 一并按当前 netLayer 铺好 */
      updatePerfLegend(); syncNetControls();
      if(panelTab === 'net') requestAnimationFrame(function(){ if(netDeck) netDeck.fit(); });
    }
    /* 点组件中的一个算子：矩阵只高亮当前节点实例所属的那一个 Layer 列；
       Embedding / Norm / Head 这类整网首尾节点仍对应各自的独立列。 */
    function pickOp(id, fromDeck, selectedLayer){
      hiOp = id || null;
      var layer = selectedLayer !== null && selectedLayer !== undefined && isFinite(Number(selectedLayer))
        ? Number(selectedLayer) : (netLayer === 'all' ? deckLayerFor(id) : netLayer);
      if(id && netDeck && !fromDeck){
        /* 当前 Layer 没有这个分支（例如 L1 是 Dense、EP Combine 只在 MoE 层）时，
           自动翻到该算子真实存在的代表层，避免查询命中一张空卡。 */
        if(layer !== null && !netHost.querySelector('.pto-model-deck__layer[data-layer="' + layer + '"] [data-node="' + id + '"]')) layer = deckLayerFor(id);
        /* 端点算子（Emb / Norm / Head）没有所属层：「全部」里直接选；只留一块时若当前不是它那块端点卡，切到那块 */
        var unit = layer === null ? opSet(id) : null, next = layer !== null ? layer : (NET_UNITS[unit] && netLayer !== 'all' && netLayer !== unit ? unit : null);
        deckMuted = true;
        try{
          if(next !== null){ netLayer = next; if(typeof next === 'number') layerPageStart = clamp(next, 0, Math.max(0, E.TOPO.layers - 2)); syncNetControls(); applyNetView(); }
          netDeck.selectNode(id, layer === null ? undefined : layer);
        } finally { deckMuted = false; }
      }
      /* 与画布的选择互斥：算子高亮一生效，顶尺那一列、以及选中的那张卡都退掉——
         算子问的是「它落在哪些卡上」，答案铺在一整列上，这时再留一行选中只会两头打架 */
      if(id){ E.selLayer = null; E.layerGuide = false; if(perfMode()) E.selRank = null; }
      E.hiCols = id ? columnForOp(id, layer) : null;
      /* ③ 点的若是一枚集合通信算子，再把它的通信域（一批 rank）锁出来铺到矩阵上 */
      /* 点的若是一枚集合通信算子：整列里这一维有十几组，全亮等于没亮，所以自动挑**当下最值得看**的
         那一组（有人掉队就挑掉队那组，否则挑最热那组）。具体挑哪个要等 heatLayer 定下来才知道，
         这里先记 'auto'，由 syncDomain 落实成 hot / lag。 */
      var kind = id ? COMM_DOMAIN[id] : null;
      domPick = kind ? {kind:kind, which:'auto', label:'', n:0} : null;
      sideDomSig = '';
      renderSide(); redraw();
    }
    function netTarget(op){
      return function(){
        if(!netHost) return null;
        var node = netHost.querySelector('.pto-model-deck__layer.is-front-layer [data-node="' + op + '"]');
        if(!node){
          var layer = deckLayerFor(op);
          if(layer !== null && netDeck){ netLayer = layer; layerPageStart = clamp(layer, 0, Math.max(0, E.TOPO.layers - 2)); syncNetControls(); applyNetView(); node = netHost.querySelector('.pto-model-deck__layer.is-front-layer [data-node="' + op + '"]'); }
        }
        node = node || netHost.querySelector('[data-node="' + op + '"]');
        return node ? {element:node} : null;
      };
    }
    /* ── 右列：通用 Rank 详情栏（放大的那张 + 读数），账不随时间走、容量随卡型号 ── */
    var sideDomSig = '';
    function renderSide(){
      if(!sideP) return;
      /* 面板内容依赖热力状态（选的是列还是卡、基准中位是多少），它平时在 drawMatrix 里算；
         renderSide 会被同步调用（点击、翻页），所以这里先自己算一遍，拿的才是当前值。两处都算不冲突：colMedAt 有缓存。 */
      syncHeat(); syncDomain();
      var r = E.selRank;
      /* 洞察定位会同时保留 Layer 与 Rank：Layer 留在矩阵里提供上下文，右栏优先回答 Rank 信息。 */
      if(r !== null){
        sideDomSig = '';
        var c = E.PC[r], m = MEM[r], T = E.TOPO, tot = total(m);
        var edpNo = Math.floor(c.k/T.groupRows);
        var sub = 'PP' + c.pp + ' · ' + (T.ortho ? 'DP ' + edpNo + ' · EP ' + (c.dp % T.ep) : 'EDP ' + edpNo + ' · DP' + c.dp + ' · EP ' + (c.dp % T.ep)) + ' · CP' + c.cp + ' · TP' + c.tp + ' · node ' + Math.floor(r/8)
          + (E.selLayer && E.selLayer.type === 'layer' ? ' · Layer 实例 ' + E.selLayer.layer : '');
        sideP.head(c, sub, m);
        if(E.selLayer) sideP.closeTitle('返回 ' + E.selLayer.label + ' 耗时差异');
        sideP.update(m, tot, CAP, CARDS[lastValid.card].hbm);
        return;
      }
      /* 选中一列 → 右栏是这一层的各域计算耗时差异（标题带层号）。它取代了原先浮在画布左上的那块卡片：
         同样的内容放到右栏，既不遮挡矩阵，也有地方把五个维度摊开写。 */
      /* 「全部」档：什么都没选、整张矩阵铺满热力，右栏给全景读数（不能还写着「点一格…」） */
      if(perfMode() && heatMode === 'all'){
        var osig = ['all', E.TOPO ? [E.TOPO.layers, E.TOPO.pp, E.TOPO.dp, E.TOPO.tp, E.TOPO.ep].join('/') : ''].join('|');
        if(osig !== sideDomSig){ sideDomSig = osig; sideP.panel('全部 · 计算耗时全景', overviewPanelHtml()); sideP.open(); }
        return;
      }
      if(perfMode() && heatMode === 'col' && heatLayer !== null){
        var sig = ['dom', heatLayer, hiOp || '', domPick ? domPick.kind + domPick.which : '',
                   E.TOPO ? [E.TOPO.layers, E.TOPO.pp, E.TOPO.dp, E.TOPO.tp, E.TOPO.ep].join('/') : ''].join('|');
        if(sig !== sideDomSig){ sideDomSig = sig; sideP.panel('Layer ' + heatLayer + ' · 各域计算耗时差异', domainPanelHtml()); sideP.open(); }
        return;
      }
      sideDomSig = '';
      sideP.empty('点矩阵里的一格看那张卡的显存账；点顶部刻度或用左栏翻页选一层，这里给出那一层各卡计算耗时在 TP、EP、CP、DP、EDP 五个同步域上的差异。');
      sideP.hide();
    }

    /* ── 动画：一个「时间片」的动画槽（缩放 / 红行淡入共用，同时只会有一个）── */
    var anim = 0, zooming = false;
    function ease(t){ return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; }
    function cancelAnim(){ if(anim) cancelAnimationFrame(anim); anim = 0; zooming = false; }
    function tween(dur, fn, done){
      cancelAnim();
      var t0 = performance.now();
      (function step(t){
        var u = Math.min(1, (t - t0)/dur); fn(ease(u), u);
        if(u < 1) anim = requestAnimationFrame(step); else { anim = 0; if(done) done(); }
      })(t0);
    }
    function fadeOver(to, dur){ var from = overA; tween(dur, function(e){ overA = from + (to - from)*e; redraw(); }); }
    /* 放大到一格：k 走对数插值到「计算图」那一档，那一格的中心从现在的位置滑到画布中心 */
    function zoomTo(r, key, dur, done){
      var k0 = E.view.k, k1 = Math.min(PLC.MAX_K, PLN.detailK(E)*1.08), rc0 = PLN.cellRect(E, r, key); if(!rc0) return;
      var p0 = [rc0.x + rc0.w/2, rc0.y + rc0.h/2], pc = [(PLC.RULER_LEFT_W + E.W)/2, (PLC.RULER_TOP_H + E.H)/2];
      zooming = true;
      tween(dur, function(e){
        var k = k0*Math.pow(k1/k0, e); E.view.k = k; PLN.sync(E, k);
        var rc = PLN.cellRect(E, r, key), wx = (rc.x - E.view.x)/k + rc.w/(2*k), wy = (rc.y - E.view.y)/k + rc.h/(2*k);
        var px = p0[0] + (pc[0] - p0[0])*e, py = p0[1] + (pc[1] - p0[1])*e;
        E.view.x = px - wx*k; E.view.y = py - wy*k;
        zoomRead(); redraw();
      }, function(){ zooming = false; if(done) done(); });
    }
    function zoomBack(view, dur){
      var from = {x:E.view.x, y:E.view.y, k:E.view.k};
      zooming = true;
      tween(dur, function(e){
        var k = from.k*Math.pow(view.k/from.k, e); E.view.k = k; PLN.sync(E, k);
        E.view.x = from.x + (view.x - from.x)*e; E.view.y = from.y + (view.y - from.y)*e;
        zoomRead(); redraw();
      }, function(){ zooming = false; PLN.fit(E); zoomRead(); redraw(); });
    }

    /* ── 剧本：五段。步骤三的单个 Layer 列在步骤四收束到 R23 × L7，步骤五沿用到 Rank 总量刷新 ── */
    var SEG = [{lbl:'1 · 配置联动与World Size实时可视', c:'#9B3CF6'}, {lbl:'2 · 预览 Rank 内存受配置的影响', c:'#8FBB7A'},
               {lbl:'3 · 查询计算节点分布', c:'#3B82F6'}, {lbl:'4 · 查看 Layer x Rank 的计算图和持有专家', c:'#F59E0B'},
               {lbl:'5 · 为配置变化推荐适配方案或危险拦截', c:'#c0392b'}];
    var CAPS = [], onStage = null, onEnd = null, timers = [], mode = 'idle';
    function cap(s, html){ CAPS[s - 1] = html; if(onStage) onStage(s, false); }
    function at(ms, fn){ timers.push(setTimeout(fn, ms)); }
    function reset(nextStage){
      DemoPointer.stop();
      cancelAnim();
      var topologyChanged = !E.TOPO || !sameConfig(lastValid, BASE) || E.layerVisible !== (nextStage >= 3);
      /* 步骤四先保留算子查询命中的单个 Layer 列，再点回单格；步骤五沿用这个单格，应用新配置时才清除。 */
      var keptLayer = nextStage === 5
        ? (E.selLayer && E.selLayer.type === 'layer' ? E.selLayer : {type:'layer', layer:7, label:'Layer7', short:'L7', dense:false})
        : null;
      var keptCols = nextStage === 4 ? (E.hiCols || columnForOp('a2a_combine', deckLayerFor('a2a_combine'))) : null;
      cfg = copy(BASE); lastValid = copy(BASE); pending = null; oomAdvice = null;
      E.layerVisible = nextStage >= 3; /* 入场默认聚合 PP；查询算子时自动展开 Layer 轴。 */
      E.selRank = R23; E.selLayer = keptLayer; E.layerGuide = !!keptLayer;
      E.hiCols = keptCols; hiOp = keptCols ? 'a2a_combine' : null; overA = 0; rulerFlash = 0;
      /* 整网查询跟着留下来的选择走：步骤五留 L7 列 → Layer 7；其余段先回「全部」（步骤三要在整条链上先点 Final RMSNorm，
         再由 EP Combine 翻到 L24）。步骤四那一列是算子高亮而不是列选择，applyTopo 会把它清掉、又会把停着的层降格成列选择，
         所以等它过后再把高亮和 Layer 24 一起补回来。 */
      netLayer = keptLayer ? keptLayer.layer : 'all';
      /* 配置本来就在基线时不重建同一张矩阵，避免步骤交界处无意义地闪一下。 */
      if(topologyChanged || nextStage === 5) applyTopo(); else recalcOver();
      syncPlaneToggles();
      if(keptCols){ E.hiCols = keptCols; hiOp = 'a2a_combine'; netLayer = deckLayerFor('a2a_combine'); }
      layerPageStart = typeof netLayer === 'number' ? clamp(netLayer, 0, Math.max(0, E.TOPO.layers - 2)) : 0;
      syncNetControls(); applyNetView();
      if(nextStage === 4 && E.ctx){ PLN.fit(E); zoomRead(); }
      setPanel('form'); if(sideP) sideP.open(); syncConf(); renderSide(); redraw();
      if(conf) conf.scrollTop = 0;
    }
    function baseCaps(){
      CAPS = ['同一批 128 张卡，PP4 × DP8 × CP2 × TP2；EP4 从 DP 中切出，EDP=2。CP0 在上、CP1 在下，每个 CP 片内再排 TP0/TP1。Layer 明细默认关闭。',
              '点 R23（PP0 · DP5 · CP1 · TP1）：右栏列出它的显存账——权重、梯度、优化器态、激活与预留五档，容量为 128 GB。',
              '左栏切到<b>整网查询</b>：从 Token Embedding 到 LM Head 的一条计算流，中间那块是当前层的算子图——Pre-MLP RMSNorm 之后走哪条 FFN 由层类型决定：L0–L1 是 Dense FFN，L2 起是 MoE。点一枚算子，矩阵回答的是「它落在哪些卡上、这些卡里谁慢」。',
              '沿用上一步高亮的 <b>Layer 24 单列</b>：再点 <b>R23 × L7</b> 单格，把它放大到计算图。',
              '延续步骤四选中的 <b>R23 × L7</b>，最后再把 DP 手输成 <b>2</b>：切出口径下 EP 仍是 4，2 除不尽 4。'];
    }
    var BEATS = [
      {end:11800, b:[
        {at:1300, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('#c4mode [data-m="ortho"]'); }, function(){ setMode('ortho'); cap(1, '切到<b>正交口径</b>：DP 8 ÷ EP 4 = <b>2</b>，Total Rank 保持 128；矩阵左尺由 EDP | DP 改为 DP | EP，CP/TP 仍在各组内部。'); }, '切到正交口径'); }},
        {at:5000, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('#c4mode [data-m="split"]'); }, function(){ setMode('split'); cap(1, '切回<b>切出口径</b>：DP 恢复为 8，EP4、CP2、TP2 与 128 张卡的排布保持一致。'); }, '切回切出口径'); }},
        {at:6900, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('.c4s[data-f="pp"] button[data-d="1"]'); }, function(){ set('pp', 8); flash(['totalRank']); cap(1, '把 <b>PP 4 → 8</b>：每段层数减半，<b>Total Rank 128 → 256</b>（8 × 2 × 2 × 8），表单与矩阵同步更新。'); }, '增加 PP'); }},
        {at:9000, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('.c4s[data-f="pp"] button[data-d="-1"]'); }, function(){ set('pp', 4); flash(['totalRank']); cap(1, '演示完成后把 <b>PP 8 → 4</b>：Total Rank / World Size 回到 <b>128</b>，矩阵恢复为 4 个 Stage，为下一步的 R23 内存预览保留同一份主画面。'); }, '恢复 PP'); }}]},
      {end:11300, b:[
        {at:300, fn:function(){ DemoPointer.click(matrixTarget(R23, 'S0'), function(){ selectCell(R23, 'S0'); var m = MEM[R23]; cap(2, 'R23（PP0 · DP5 · CP1 · TP1）的显存账：五档合计 <b>' + fmt(total(m)) + ' GB</b>，卡容量为 128 GB。'); }, '点 R23 × PP0'); }},
        {at:2200, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('.c4s[data-f="mbs"] button[data-d="1"]'); }, function(){ set('mbs', 4); var m = MEM[R23]; cap(2, '<b>Micro Batch 2 → 4</b>：CP1 仍只处理后半段 token，单卡激活与总占用随批量增大；R23 当前合计 <b>' + fmt(total(m)) + ' GB</b>。'); }, '增加 Micro Batch'); }},
        {at:5200, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('select[data-f="card"]'); }, function(){ setCard('910b-64'); fadeOver(1, 800); var n = over.filter(Boolean).length;
          cap(2, '改用 <b>64 GB</b> 卡：显存账数值不变，容量线降到 64 GB；矩阵中有 <b>' + n + ' 张卡</b>超出容量。'); }, '选择 64 GB 卡'); }},
        {at:8200, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('[data-act="discard-card"]'); }, function(){ discardCardChange(); cap(2, '取消修改后恢复 <b>128 GB</b> 卡；Micro Batch 4 的占用增量仍在，下一段再恢复 MBS2 基线。'); }, '取消修改'); }}]},
      {end:10300, b:[
        {at:300, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('[data-pt="net"]'); }, function(){ setPanel('net'); }, '切到整网查询'); }},
        {at:1900, fn:function(){ DemoPointer.click(netTarget('final_norm'), function(){ pickOp('final_norm'); cap(3, '先点输出端的 <b>Final RMSNorm</b>：它不属于重复的 Transformer Layer，只对应矩阵中的单独 <b>Norm</b> 列，因此当前只高亮这一列。'); }, '点 Final RMSNorm'); }},
        {at:5600, fn:function(){ DemoPointer.click(netTarget('a2a_combine'), function(){ pickOp('a2a_combine'); cap(3, '再点 <b>EP Combine</b>：整网视图翻到 <b>Layer 24</b>，矩阵按每张卡在这一层的纯计算耗时上色；右栏分别给出 TP、EP、CP、DP、EDP 五个域的组间与组内差异。'); }, '点 EP Combine'); }}]},
      {end:10300, b:[
        {at:300, fn:function(){ DemoPointer.click(matrixTarget(R23, 'L7'), function(){ selectCell(R23, 'L7'); cap(4, '从上一步高亮的 <b>L24 单列</b> 切到一个格子：选中 <b>R23 × L7</b>，接下来只查看这张卡在这一层里的专家。'); }, '点 R23 × L7'); }},
        {at:2200, fn:function(){
          var home = {x:E.view.x, y:E.view.y, k:E.view.k};
          zoomTo(R23, 'L7', 1900, function(){ at(2000, function(){ zoomBack(home, 1900); }); });
          cap(4, '放大到一格：R23 属于 PP0 · DP5 · CP1 · TP1，在 L7 的 <b>Expert Compute</b> 持有 16 个专家 <b>E16–E31</b>（EP 位置 1，每桶 64 ÷ 4 = 16）。');
        }}]},
      {end:12300, b:[
        {at:1200, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('.c4s[data-f="dp"] input'); }, function(){ set('dp', 2); cap(5, 'DP2 不能被 EP4 整除：配置横幅报错，画布停在上一组自洽的 128 卡；建议按参数约束和 128 GB 容量联动调整。'); }, '输入 DP = 2'); }},
        {at:6000, fn:function(){ DemoPointer.click(function(){ return conf && conf.querySelector('[data-act="apply"]'); }, function(){ applyFix(); cap(5, '应用建议：EP' + cfg.ep + '、PP' + cfg.pp + '、DP' + cfg.dp + '、CP' + cfg.cp + '、TP' + cfg.tp + '，Total Rank <b>' + world(cfg) + '</b>；矩阵按新配置重排。'); }, '一键应用'); }}]}
    ];
    function runSeg(s, then){
      reset(s); baseCaps(); if(onStage) onStage(s, true);
      var B = BEATS[s - 1];
      B.b.forEach(function(x){ at(x.at, x.fn); });
      at(B.end, then);
    }
    function clearTimers(){ timers.forEach(clearTimeout); timers = []; }
    function stop(){ clearTimers(); cancelAnim(); DemoPointer.stop(); mode = 'idle'; }
    function userStop(){ if(mode !== 'idle'){ stop(); if(onEnd) onEnd(); } }
    function play(){
      stop(); mode = 'full';
      (function go(s){ if(s > SEG.length){ mode = 'idle'; if(onEnd) onEnd(); return; } runSeg(s, function(){ go(s + 1); }); })(1);
    }
    function showSeg(s){ stop(); mode = 'single'; runSeg(s, function(){ mode = 'idle'; if(onEnd) onEnd(); }); }
    baseCaps();
    return {mount:mount, play:play, stop:stop, showSeg:showSeg, caps:function(){ return CAPS; }, segs:SEG,
            redraw:function(){ syncConf(); renderSide(); mountNet(); redraw(); }, watch:function(f){ onStage = f; }, watchEnd:function(f){ onEnd = f; }};
};
})();
