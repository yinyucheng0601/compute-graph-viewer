/* ═══════════════════════════════════════════════════════════════════════════
   config-relation-plane.js —— 「平面视图」重排 + 中栏无限画布 + 右栏详情
   只服务 config-relation-plane.html。

   ── 这一版要解决的问题 ──────────────────────────────────────────────────
   原版把 Cluster / MoE / Model Architecture / 整网 / 内存摆成四个并置的域，
   域与域之间的关系靠一层 SVG 连线表达。配置一大（46 层 × 4096 卡 × 512 EP）
   有两个后果：一是一屏摆不下，二是连线本身成了要读的第二套图 —— 「rank 1 压住
   哪几层」这种最常问的问题，要顺着一根线跨过半个屏幕才答得出来。

   这一版把 stage / layer / rank / 专家**穿插进同一个平面**：
     · 横轴 = layer，按 PP stage 分块；
     · 纵轴 = 一个 stage 内的 rank 序（按 EDP 副本分组，组内是 EP × TP×CP）；
     · 一个格子 = 「这张卡在这一层上的那一份」，MoE 层的格子里直接摆它持有的专家。
   于是交叉关系由「同一格」承担，连线整层收掉（css 里 .cro-link-layer 隐藏）。

   ── 与主脚本的关系：一行逻辑都没改 ──────────────────────────────────────
   配置、校验、reconcile、关系解析（resolveRelation）、MoE 绑定、单卡容量、
   YAML、文档、运行事件，全部还是 config-relation-observer.js 那一套：
     · 重排只是 appendChild —— 节点本身、id、已挂的监听器原样保留；
     · 画布点击一律走主脚本导出的 window.croSelect(payload)，与点集群矩阵
       格子走的是同一个入口、同一份 payload 形状；
     · 画布重绘只吃 cro:change（配置变了）与 cro:select（选择变了）两个事件。
   集群矩阵 / Layer 刻度带 / MoE 宫格没有删，只是搬进离屏的 .crop-engine：
   它们是**选择的另一条入口**（键盘导航、MoE 绑定态），也是容量栏与 deck 的
   联动源，删了就要改主脚本 —— 而这一页的前提是不改。

   ⚠️ 本文件必须排在 config-relation-observer.js 之后（读它导出的 croSelect /
   croObserver），且排在 html 末尾那段内联脚本之后（它会搬 .cro-section--structure）。
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const doc = global.document;
  const board = doc.getElementById("croBoard");
  if (!board) return;

  /* ══ 几何常量（世界坐标，单位 px @ scale 1）══════════════════════════════
     格子是横长方形而不是正方形：一行是一张卡（或一台整机）、一列是一层，读的
     时候总是先沿着行扫（这张卡压住哪几层），横向宽一点扫起来省眼力。
     ⚠️ 列宽**不是常量** —— 它由 buildLayout 按专家标签的实测宽度定（见那里），
     这两个只是上下界。 */
  const CELL_W_MIN = 34;
  const CELL_W_MAX = 260;
  /* 行高的**下界**。真值由 buildLayout 按「专家标签折成几行」算（layout.cellH），
     一行胶囊时就是这个数。 */
  const CELL_H = 22;
  /* ── stage 块之间那条缝（同时是行标写字的地方，下称「行标道」）─────────────
     宽度**不是常量**，由 laneWorldAt(k) 每帧按两种情形给（都以屏幕像素为准）：
       · 行标画得出来 —— 恰好够写下最长的那串（"整机 1024" / "rank 2047"）再加
         LANE_SLACK 的余量，一点不多留；
       · 行标画不出来（缩得太小，见 showRowText）—— 只剩 GAP_MIN_PX 这条把两个块
         分开的最小缝：没有字要写，就没有理由留一大片空地。 */
  const GAP_MIN_PX = 14;         // 没有行标时块与块之间的最小缝（屏幕像素）
  /* 行标左右的余量。单位与 labelTextW 同（探针字号下的像素），所以它跟着字号一起
     缩放 —— 写成固定的世界像素的话，缩到 10% 时这点余量在屏幕上只剩两像素，
     而 css 那点右内衬同样缩掉了，字就贴着块的左缘甚至被截。
     ⚠️ 行标是**右对齐**贴着块画的，所以这条余量减去右内衬之后，剩下的全部堆在
     文字左边。20 那时右内衬还是固定的 8 世界像素（缩小时屏幕上趋近 0），于是缩到
     中间那几档时文字右边贴着块、左边空出十几个屏幕像素，整条道看着比需要的宽一倍。
     现在右内衬改成随字号走的 em（见 css .crop-rowlabel），左右两边都恒定，余量
     本身就不必再留那么多：12 −（右内衬约 0.5em ≈ 5 屏幕像素）≈ 左边 6 像素。 */
  const LANE_SLACK = 12;
  const LANE_EDGE = 6;           // 道与块之间那点固定的世界间隙
  /* TP 分组槽始终按屏幕像素留宽：rank 文本会随缩放反向补偿字号，这条槽也必须
     同步反向补偿，否则缩小时括号会挤进 rank 文本、放大时又会留下大片空白。 */
  const TP_GUTTER_PX = 34;
  /* 槽的左侧刻意留白，让 TP 括号靠近它所修饰的 rank，而不是贴着前一块 PP Stage。
     与槽宽一样按屏幕像素折算，任何缩放下亲疏关系都不漂移。 */
  const TP_GUTTER_LEAD_PX = 12;
  /* 纵向的两级缝，都是**分区感**用的 —— 缩小之后格子糊成一片，能读出边界的
     就只剩这两条缝：
       DP_GAP   EDP 副本组之间（36 = 原先 12 的 3 倍）
       NODE_GAP 副本内整机与整机之间（原先没有缝，整机档一片连续行读不出机器边界）
     两者拉开 3 倍差，层级才读得出来：先看到副本、再看到机器。 */
  const DP_GAP = 36;
  const NODE_GAP = 12;
  const ROW_FONT_MIN = 10;       // 行标在屏幕上最小 10px，小于它就不画（而不是画成蚂蚁）
  /* （原先这里还有 NODE_CAP_RATIO / NODE_CAP_MIN_PX 两个常量，管整机行顶上那条
     「整机 N · rank a–b」的标签带。带子已撤：它与左边的行标说的是同一件事，同屏
     出现两次纯属重复。rank 区间现在是行标的第二行，见 rowMetrics 的 two 分支。） */

  /* ── 两条量尺（顶部 PP|Layer、左侧 EDP|DP）─────────────────────────────
     它们不在被 transform 的世界里，而是贴着画布边缘按**屏幕坐标**摆：刻度是用来
     读位置的，字号必须始终一样大、始终贴边。下面这些是它们占掉的边宽。 */
  const RULER_PP_H = 22;         // 顶部第一层：PP stage
  /* 顶部两层合计。第二层（列名）是两行：「Layer12」+「MoE / Dense」，两行各要
     一整个行高、中间还要一点行距，所以这一层给到 38（52-22 的 30 挤得两行贴在
     一起）。一行写不下时被截掉的正是后半截那个 MoE/Dense，而那是这一列最该先
     读到的一件事，所以宁可让量尺高一点。 */
  const RULER_TOP_H = 60;
  const RULER_EDP_W = 42;        // 左侧第一层：EDP 副本
  const RULER_LEFT_W2 = 92;      // 左侧两层合计（切出档：EDP | DP）
  const RULER_LEFT_W1 = 46;      // 左侧只有一层时（正交档 / 无 MoE：EDP ≡ DP）
  const RULER_COL_MIN = 46;      // 顶部一格刻度至少这么宽，否则隔几格才标一次
  const RULER_ROW_MIN = 16;      // 左侧一格刻度至少这么高，同理
  /* 平移边界：内容与可视区至少还留这么多重叠，不允许拖到整片空白 */
  const PAN_MARGIN = 120;
  /* 下界给到 0.03：列宽按专家标签实测之后，大配置的世界能有六七千 × 一万多像素，
     0.06 那一档的「适配」其实还装不下，会留下一截永远看不见的内容。 */
  const MIN_K = 0.03;
  /* 上界给到 16 而不是 4：格内最细那一档（逐个计算节点，见 detailScale）要求那张
     详情面板缩进格子之后字还看得清，而格子的世界高度随配置差着一个数量级 ——
     每卡 32 个专家的格子有 139px 高，k≈2 就够；每卡 4 个的只有 22px，得放到 14
     倍上去。封在 4 的话，后一类配置永远进不到最细档，等于这个功能只对半数配置存在。 */
  const MAX_K = 16;
  /* ── 一帧最多铺多少个 DOM 节点 ──────────────────────────────────────────
     两条预算，都是**整幅一起降级**而不是铺到一半停手（后者会让后半段 stage 看着
     像没有卡）：
       CELL_BUDGET —— 格子数。超了就只画块底板、行标与高亮带。
     格**内**的东西不再单列一条节点预算：三档内容全部由「这一格在屏幕上有多大」
     开闸（BLOCK_MIN_H / DETAIL_MIN_S），而屏幕就那么大 —— 一格至少 40×54 像素时
     一屏最多也就几百格，一格要占满 DETAIL_MIN_S 那个尺寸时更是只剩几十格。闸门
     本身就把节点数封住了，再挂一条总数预算只是重复计一遍。
     （原先这里有一条 NODE_BUDGET：那时专家胶囊铺满整格、只受 k ≥ 0.5 一条约束，
     几千格 × 32 枚是真会一帧建不完，才需要单独兜。现在胶囊缩进了 Expert Compute
     盒子里，跟着最细那一档走，那条约束没有对象了。） */
  const CELL_BUDGET = 12000;
  /* 热力降级档一帧最多铺多少条色带（见 render 里那段）。比 CELL_BUDGET 低一半：
     色带没有内容、只有一个背景色，但它是**每一列都铺满整个可见高度**的，
     实际盖住的面积远大于同样数量的格子。 */
  const HEAT_LOD_BUDGET = 6000;
  /* ── 交互期的重绘节流 ────────────────────────────────────────────────────
     缩放 / 拖动本身只改一条 CSS transform，是 GPU 的活，几乎不要钱；真正贵的是
     后面那次「按新视口重铺几千个节点」。原先每个 rAF 都铺一次 —— 滚轮一圈发几十
     个事件，就排了几十次全量重铺，每次几十毫秒，于是越滚越卡。
     改成 leading + trailing：手停下来之前最多每 SOFT_MIN_GAP 铺一次，手一停
     SOFT_IDLE 之后再补最后一次（那一次才是准的）。中间这段时间画面靠 transform
     自己缩放 —— 内容还在，只是边缘可能暂时空一截、行标字号暂时不是终值。 */
  const SOFT_MIN_GAP = 170;
  const SOFT_IDLE = 110;
  // 格子在屏幕上小到这个尺寸就不画了（1px 的方块与描边同量级，糊成一片色带）
  const DETAIL_MIN_W = 3.5;
  const DETAIL_MIN_H = 3;
  // 行标在屏幕上至少要有这么高才写得下字（列名已经交给顶部量尺，不受此限）

  /* ── 格内的三档 ──────────────────────────────────────────────────────────
     一格问的是「这张卡 × 这一层」。它答得多细，该由**这一格在屏幕上有多大**决定，
     而不是由某个写死的 k 决定 —— 同一个 k 下，每卡 32 个专家的格子有 139px 高、
     每卡 4 个的只有 22px，两者能写下的东西差着一个数量级。三档从粗到细：

       ① 整格上色 —— 一格不足 BLOCK_MIN_H 高。这时只剩「这是哪一套专家」一件事
          还答得出，交给底色（与热力档、整机跨 EP 那几档同一个降级方向）。
       ② 两段块 —— Attention / MoE（dense 层写 Dense）两条横带，MoE 那条带着那
          一套专家的颜色。答的是「这一层的活分成哪几块」，还不到算子的粒度；
          「同色一块 = 一整套专家」这条读法靠 MoE 带留住。
          ⚠️ 不写 Hidden：它是这一层的入口张量、不是一段活；一旦开始列张量与
          norm，这张清单就收不住（两块各有自己的入口 RMSNorm、之间还各有一次
          Residual Add）—— 那是 ③ 的事。详见 buildBands。
       ③ 逐个计算节点 —— 把这张卡在这一层里真正要跑的那些算子铺出来（Attention
          的两支投影与注意力核、MoE 的路由四步，专家编号缩进 Expert Compute 盒
          子里）。判据不是 k，是那张详情面板缩进格子之后**字还有多大**：面板高度
          随每卡专家数变（专家网格折几行），写死一个 k 会让某些配置永远进不来。

     ⚠️ **②③ 只属于卡粒度**（showSegs / showDetail 那两闸都要求 span === 1）。
     它们答的都是「**一张卡**在这一层里的活」——「上半格 Attention、下半格 MoE」
     「这里跑 Router、那里跑 Expert Compute」—— 而整机行一格是 span 张卡，这两句话
     在那里没有单一答案：那台机器的 8 张卡每一张都从头到尾跑完这两块，把它们画进一
     个机器格子里，读出来却是「这台机器上半截在做 Attention」。
     所以整机档只有 ① 一档，它的「更精细一步」不是格内长出内容，而是**换粒度** ——
     一行摊开成 span 行 rank 格子，②③ 从那时起才有意义。自适应缩放因此在「整机格
     子大到该有内容」的同一个门槛上换档（见 currentUnit），两条阶梯正好接上：
       整机·纯颜色 → rank·纯颜色 → rank·两段块 → rank·逐个算子 */
  const BLOCK_MIN_H = 54;    // 一格在屏幕上至少这么高，两段块才写得下字（两条 ≈ 27px）
  const BLOCK_MIN_W = 40;
  const BAND_FONT_MIN = 9;   // 两段块的字在屏幕上恒定这么大（与行标同一套反向缩放）
  const DETAIL_MIN_S = 1.1;  // 详情面板：设计像素 → 屏幕像素的放大率下界

  /* 详情面板的**设计像素**。面板先按这一套尺寸排一遍版，再整体 scale 进格子里
     （见 detailScale / buildDetail）—— 格子的世界尺寸随配置变（列宽由列名与专家
     网格一起定），面板的比例不该跟着变形。
     ⚠️ 这几个数同时写进 css 变量（见 buildLayout 末尾那几行 setProperty），css 侧
     一律 var() 取值：面板高度是 js 按它们算出来的，两边对不上就会截掉最后一条
     Residual Add。改这里就是改两边。 */
  const D_PANEL_W = 132;
  const D_PILL_H = 11;       // 一枚算子的高度
  const D_GAP = 2;
  const D_TITLE_H = 9;       // 组标题（Attention / MoE / Expert Compute）
  const D_PAD = 3;           // 组的内衬（上下左右同值）
  const D_CHIP_H = 8;        // 面板里那枚缩小版专家胶囊
  const D_RES_H = 10;        // 「+ Residual Add」那条

  /* （原先这里有一个 TEXT_MIN_K = 0.5：自适应粒度在这个**写死的缩放**上换档。
     已撤 —— 判据换成「整机格子大到该有内容了吗」，那是一个屏幕尺寸而不是一个 k，
     理由与格内三档同一条：同一个 k 下，每卡 32 个专家的格子有 139px 高、每卡 4 个
     的只有 22px，写死一个 k 在两种配置上换出来的画面差着一个数量级。见
     currentUnit()。） */
  /* 一行最多铺几枚专家胶囊，多出来的折行 —— 列宽因此不再随每卡专家数线性变宽
     （8 枚一行的格子比列名宽一倍，整幅平面横着拉长一倍），改成「宽度封顶、
     高度自适应」：行高由 buildLayout 按折出的行数算进 layout.cellH。 */
  const EXPERT_COLS_MAX = 4;
  /* 折行数的上限。宽度早已被上面那条封顶，多出来的专家一律往下长 —— 所以逐个铺
     编号的真正代价是**格子高度**，限行数才是限在刀刃上，比再拍一个孤零零的专家数
     说得清。
     8 行 = 32 枚：EP=8 那类配置（256 路由专家 ÷ EP 8 = 每卡 32 个）因此仍逐个铺得
     出编号 —— 原先卡在 8 枚的门槛上，这种配置整幅平面一个编号都没有，而编号正是
     这幅图最值钱的一条信息。代价是这一档行高涨到 130px 上下（9px 字 × 8 行），
     纵向世界跟着长几倍，靠滚；横向一点没变（列宽仍是 4 枚胶囊）。
     缩到看不清时不必担心堆节点：格内三档按屏幕尺寸开闸（BLOCK_MIN_H /
     DETAIL_MIN_S），编号只在最细那一档、且一屏只剩几十格时才铺得出来。 */
  const EXPERT_ROWS_MAX = 8;
  /* 每卡专家数超过这个就不逐个铺编号，整格交给颜色（同色一块 = 一整套专家）。
     不退到「E32–E63」那种区间胶囊：区间既不可点、也答不出「属于哪一套」。
     它是上面两条的乘积、不是一个独立旋钮 —— 要放宽就调 EXPERT_ROWS_MAX。 */
  const EXPERT_CHIP_MAX = EXPERT_COLS_MAX * EXPERT_ROWS_MAX;
  const EXPERT_GAP = 3;          // 与 css 里 .crop-cell 的 gap 同值（行、列同值）
  const CELL_PAD = 10;           // 格子左右描边 + 呼吸位
  const CELL_VPAD = 6;           // 格子上下描边 + 呼吸位（折行后按它给行高留边）
  /* 「一套完整专家」的配色循环长度（与 --crop-set-0..3 对应）。
     着色的单位是**一套完整专家** = 一个 MoE 层 × 一个 EDP 副本：那一块矩形里的
     卡各持一片，合起来正好是 routedExpert 个专家的一整套。相邻两套要换色，
     而相邻有两个方向 —— 左右是换层、上下是换副本 —— 所以索引取
     (层号 + 2×副本号) % 4，两个方向的邻居都必定落到不同色上。 */
  const SET_TINTS = 4;
  /* auto 粒度的切换判据：**整机格子还只够铺一块颜色吗**（见 currentUnit）。
     整机行的高度恰好是它那 span 行卡之和，所以一格长到 BLOCK_MIN_H —— 格内本该
     开始有内容的那个门槛 —— 时，整机档就已经把它能给的都给完了：它给不出格内的
     两段块（那是**一张卡**在这一层里的活，一台机器有 span 张，没有单一答案），
     能给的下一步只有换粒度，把这一行摊开成 span 行 rank 格子。两条阶梯因此在同一
     个门槛上接头：整机·纯颜色 → rank·纯颜色 → rank·两段块 → rank·逐个算子。
     反向（缩回整机）要多缩一点点（迟滞系数），免得停在阈值上来回抖。 */
  const AUTO_NODE_HYST = 1.15;
  const CHIP_CAP = 10;           // 右栏一行胶囊最多列几个，其余折成「+N」

  /* ══ 小工具 ══════════════════════════════════════════════════════════════ */
  function el(tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /* 一次 cssText 写完，而不是四次（加字号是五次）逐属性赋值：每次赋值都要走一遍
     CSSOM 的解析与失效登记，一帧上万个节点时这笔账很实。
     ⚠️ cssText 是**整条覆盖**，所以字号只能一起交给这里写，不能在调用前后另设。 */
  function place(node, x, y, w, h, font) {
    node.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`
      + (font ? `;font-size:${font}px` : "");
    return node;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* 一串连号折成区间：Layer 0–11 比 12 枚胶囊好读得多 */
  function runsOf(list) {
    const sorted = Array.from(list).sort((a, b) => a - b);
    const runs = [];
    sorted.forEach((v) => {
      const last = runs[runs.length - 1];
      if (last && v === last[1] + 1) last[1] = v;
      else runs.push([v, v]);
    });
    return runs;
  }

  /* ══ 负载热力：度量口径、色阶与成本模型 ══════════════════════════════════
     这一节回答「同一幅平面按某个度量上色，那个数从哪来」。

     ⚠️ 五个度量**都不是实测**，是按当前配置现算的推演值。诚实地说清它由两半
     构成，比给一个看着很准的数要紧：
       · 结构那一半是**确定的** —— 参数量、激活、FLOPs、通信量，全部由当前切法
         （PP / TP / CP / EP / DP、重计算档、精度档、分片档）直接推得，配置一拨
         就跟着变，没有任何拟合；
       · 位置那一半是**模型** —— 专家路由不均、机内 HCCS 与跨机 RDMA 差一个数量
         级、每台机器自己的链路与降频抖动。它们是热力图上「形状」的来源：热落在
         哪一段 stage、哪几列层、哪一批卡上。
     所以这幅图该被当作**形状**来读，不是当作读数。真值要等一次 profiling 接进来，
     那时只换 buildHeat 一处即可 —— 上色、图例、气泡都读它导出的同一个接口。 */
  const HEAT_METRICS = [
    { id: "mem", label: "内存占用", unit: "GB", digits: 1,
      tip: "这张卡为这一层留下的常驻显存：权重 / 梯度 / 优化器三段（按分片档摊薄）"
        + " + 这一段 stage 在飞的那几份激活",
      fault: "一条横带 —— 某个 EP rank 上热门专家扎堆，permute 暂存撑到触顶（OOM 的候选行）" },
    { id: "flops", label: "计算量", unit: "TFLOP", digits: 1,
      tip: "这张卡在这一层上、一个 micro-batch 要做的浮点运算（含反向与重计算）",
      fault: "一整块列区 —— PP 按层数均分，可那一段的层更重：切分不均" },
    { id: "busy", label: "计算时间", unit: "ms", digits: 2,
      tip: "上面那份计算量除以本卡真吃得到的算力 —— MoE 的 grouped matmul 效率明显低于稠密 GEMM",
      fault: "一条整机横带 —— 一台机器降频，成了拖住全局的慢卡" },
    { id: "idle", label: "空闲时间", unit: "ms", digits: 2,
      tip: "等出来的时间：PP 气泡 + 同一列里最重的那张卡拖出的负载不均 + 没被计算盖住的那段通信",
      fault: "与计算时间互补 —— 慢卡自己反而最暗（它不等人），同段其余卡全在等它；"
        + "stage 之间还有一道 PP 气泡的阶梯" },
    { id: "comm", label: "通信时间", unit: "ms", digits: 2,
      tip: "这一层摊到这张卡上的跨卡通信：TP All-Reduce、MoE 的 EP All-to-All、"
        + "摊薄到每个 micro-batch 的梯度归约、stage 边界的 P2P —— 机内走 HCCS、跨机走 RDMA",
      fault: "连续几条整机横带 —— 一个机架的 RDMA 掉速，凡是跨机的那几条通信全被拖慢" },
    /* 第六个度量与前五个不同类：前五个答「这份配置有多重」，它答「这一刻路由偏成
       什么样」—— 多一根**时间轴**（下面的 ROUTE_PHASES / routeTau）。所以它带
       tight（数值与 × 之间不留空格，"3.21×" 比 "3.21 ×" 更像一个倍数）与 live
       （色阶随时间轴变，不进 allRanges 那套按配置缓存的量程）。 */
    { id: "route", label: "专家负载", unit: "×", digits: 2, tight: true, live: true,
      tip: "这张卡在这一层收到的 token 是「均分」的多少倍 —— 1.00× 是理想均衡，"
        + "拖动右边的时间轴看它怎么一步步偏掉（非 MoE 列没有路由，留素底）" },
  ];

  /* ══ 路由塌缩时间轴 ══════════════════════════════════════════════════════
     「专家负载」这一档比另外五个多一根轴：时间。它复刻的是运行事件 2.5
     （config-relation-observer.js 的 p1-root「Router FP8 溢出，E193 吸收 98%
     token」）那条曲线 —— 但事件里给的是**一层、一个 step 的静态截面**（98% / 其余
     8 个活跃 / 247 个 dead 三根柱），这里把它摊回**整幅平面 + 一根进度轴**：塌缩
     不是一瞬间的事，它先有一段「均衡损失渐渐压不住」的慢性偏斜，最后才被一次数值
     事故推成 one-hot。两件事在图上长得完全不同，值得分开看：

       ① 正常路由    均衡损失把分布压平，每张卡都在 1× 附近，整幅一片冷
       ② 分布走偏    热门专家开始吃到几倍于均分的 token，热点成列浮出来
       ③ logits 越界 数值已经越过 FP8 上限，但**路由结果还没变** —— 图上与 ② 同形
       ④ 路由塌缩    softmax 塌成 one-hot，一张卡吃掉 98%，同层其余全灭

     ⚠️ ③ 与 ② 同形是有意的：那正是这次事故最难查的地方 —— 越界发生在数值里，
     热力图上看不出来，等图变了已经是 ④。
     τ ∈ [0,1] 是这根轴的位置；四相的 at 是它进入该相的门槛。 */
  const ROUTE_PHASES = [
    { at: 0.00, tag: "① 正常路由", clock: "max(logits) 12.4 · 均衡损失有效" },
    { at: 0.30, tag: "② 分布走偏", clock: "均衡损失失守 · 热门专家份额抬升" },
    { at: 0.60, tag: "③ logits 越界", clock: "max(logits) 1846 › FP8 448 · 路由未变" },
    { at: 0.82, tag: "④ 路由塌缩", clock: "exp() = Inf · softmax 塌成 one-hot" },
  ];
  const ROUTE_COLLAPSE_AT = ROUTE_PHASES[3].at;   // 从这里开始才向 one-hot 混合
  /* 问题一的现场数据（定位链 §3–4）：这里不用四舍五入后的 0.98 反推，保留采样
     与通信 trace 的原始口径，横幅、气泡和右栏才能互相核对。真实部署的 expert →
     EP rank 映射不是本页配置态采用的连续切分；事故记录明确给出 E193 → EP rank 23，
     所以运行态热力按观测映射落点，而不是用 floor(193 / 4) 猜一个 rank。 */
  const ROUTE_INCIDENT = Object.freeze({
    model: "openpangu-flash",
    layer: 38,
    expert: 193,
    epRank: 23,
    totalTokens: 8192,
    expertTokens: 8028,
    deadExperts: 247,
    sendTokens: 0,
    recvTokens: 9832,
  });
  const ROUTE_COLLAPSE_MAX = ROUTE_INCIDENT.expertTokens / ROUTE_INCIDENT.totalTokens;

  /* ── 这根轴的时间口径：step ────────────────────────────────────────────────
     轴上那个 τ 只是「进程」，读的人第一个问题一定是「这是多长的一段时间」。答案
     是 step，而且是**整条 run 上其它页共用的那一条时间线**：问题一的事故步钉在
     15203（training-run-twin.js 的 INCIDENT_STEP、training-log-drawer.js 的日志
     行、training-rank-swimlane.js 的泳道都是这个数），慢性偏斜从事故前 4200 步
     开始爬（twin 的 LV_SKEW_CLIMB_FROM = INCIDENT_STEP - 4200）。所以这根轴写的
     是 step 11003 → 15203。

     ⚠️ 这段时间不是一把匀速的尺子，而是**两种时间基**接在一起 —— 这正是这次事故
     难查的地方，所以宁可在轴上说清楚，不要为了「一格一格等距」把它抹平：
       · ① → ② → ③（τ 0 → 0.60）是**慢性**的，跨了四千多个 step：均衡损失一点点
         压不住，热门专家的份额慢慢抬起来。这一段按 step 线性铺。
       · ③ → ④（τ 0.60 → 1）全部发生在**同一个 step 15203 之内**：logits 越界 →
         exp() = Inf → softmax 塌成 one-hot。所以轴的后 4 成 step 号不再往前走，
         读数改写「step 15203 内」，说的是那一步里的数值级联。
     ROUTE_STEP_INSTEP_AT 取第三相的门槛：③ 的读数（max(logits) 1846 › FP8 448）
     本来就是那一步里的事。 */
  const ROUTE_STEP_FROM = 11003;
  const ROUTE_STEP_TO = 15203;
  const ROUTE_STEP_INSTEP_AT = ROUTE_PHASES[2].at;

  /* τ → 这一刻是第几个 step。inStep 为真时表示「已经进到事故步内部」，那时 step
     号不动（见上面那段），说明由 routeStepText 补。 */
  function routeStepAt(tau) {
    if (tau >= ROUTE_STEP_INSTEP_AT) return { step: ROUTE_STEP_TO, inStep: true };
    const t = ROUTE_STEP_INSTEP_AT > 0 ? tau / ROUTE_STEP_INSTEP_AT : 0;
    // 上界取事故步的前一步：15203 只属于 inStep 那一段，慢性段最多爬到 15202
    const span = ROUTE_STEP_TO - 1 - ROUTE_STEP_FROM;
    return { step: Math.round(ROUTE_STEP_FROM + span * clamp(t, 0, 1)), inStep: false };
  }

  function routeStepText(tau) {
    const s = routeStepAt(tau);
    return s.inStep ? `step ${s.step} 内` : `step ${s.step}`;
  }

  /* 第 i 相**跨了哪几个 step**：给横幅那条四段相位条用。区间左闭右开 —— 下一相的
     门槛属于下一相，所以右端取它前一步。
     ③ 与 ④ 都落回「step 15203 内」不是重复：这两相本来就发生在事故步那一步之内
     （logits 越界 → exp()=Inf → 塌成 one-hot），四段并排时正好把「前三相跨四千多
     步、后两相挤在一步里」这件事摆到明面上。 */
  function routePhaseSteps(i) {
    const a = routeStepAt(ROUTE_PHASES[i].at);
    if (a.inStep) return `step ${ROUTE_STEP_TO} 内`;
    const next = i + 1 < ROUTE_PHASES.length ? ROUTE_PHASES[i + 1].at : 1;
    const b = routeStepAt(next);
    const hi = b.inStep ? ROUTE_STEP_TO - 1 : b.step - 1;
    return hi <= a.step ? `step ${a.step}` : `step ${a.step}–${hi}`;
  }

  /* 量程按采样算的那几个（live 的自己算，见 routeRange）。allRanges 那圈循环是
     一帧几万次 evalCell 的来源，多带一个用不到的度量就是白跑一遍。 */
  const HEAT_SCALED = HEAT_METRICS.filter((m) => !m.live);

  /* 当前时间轴位置。放在模块作用域：buildHeat 建出来的模型直接读它，所以拖动
     时间轴不必重建模型（模型按 topology 缓存，重建等于每拖一格重算一次拓扑）。 */
  let routeTau = 0;

  /* 走到第几相。返回下标而不是对象：横幅那条四段相位条要按「走过 / 当前 / 未到」
     三态给样式，光有当前那一相的对象判不出前后。 */
  function routePhaseIndex(tau) {
    let idx = 0;
    ROUTE_PHASES.forEach((p, i) => { if (tau >= p.at) idx = i; });
    return idx;
  }

  function routePhase(tau) {
    return ROUTE_PHASES[routePhaseIndex(tau)];
  }

  /* 五个度量的说明 + 这套数是怎么算出来的，合并成一段：挂在工具带最右侧那枚
     「?」上（复用 config-relation-observer.js 的 cro-hint / 悬浮气泡机制，
     data-hint 一挂就接上，不必在本文件另起一套弹层）。
     原先这两段分别挂在「每枚胶囊的 title」与「胶囊行下方的常驻脚注」两处 ——
     五个胶囊一字排开时逐个悬浮才看得全，脚注常驻又占掉画布一整条。合并成一枚
     「?」之后，五句解释 + 一段方法论一次看全，画布也拿回了那一条高度。 */
  const HEAT_HINT_TEXT = "负载热力：同一幅平面按一个度量上色，交叉处那一格答的是"
    + "「这张卡在这一层上，这个度量占多少」\n\n"
    + HEAT_METRICS.map(function (m) { return "· " + m.label + "：" + m.tip; }).join("\n")
    + "\n\n这些数由当前配置与集群位置现算，不是一次真实 profiling：结构那一半"
    + "（参数量 / 激活 / FLOPs / 通信量）由切法直接推得，配置一拨就跟着变；位置"
    + "那一半是模型 —— 专家路由不均（同一份配置每次算出来一样，不是随机数）、"
    + "机内 HCCS 与跨机 RDMA 的带宽差一个数量级、每台机器自己的链路与降频抖动。"
    + "所以按形状读它：热落在哪一段 stage、哪几列层、哪一批卡上，不必细究小数点。\n\n"
    + "⚠️ 前五个度量各埋了一处**刻意构造**的典型故障 —— 一幅处处均匀的热力图什么也"
    + "教不了人，真正要练的是「看见这个形状，该想到什么」。故障点由当前配置定死，"
    + "同一份配置每次落在同一批卡上，可以指名道姓地查：\n"
    + HEAT_METRICS.filter(function (m) { return m.fault; })
      .map(function (m) { return "· " + m.label + "：" + m.fault; }).join("\n")
    + "\n（计算量的形状会**传到**计算时间上 —— 那本来就是同一件事除以算力；"
    + "两张图的差别正是算力那一半，也就是那台慢卡。）\n\n"
    + "「专家负载」多一根时间轴，与前五个不同：它复刻运行事件 2.5（Router FP8 溢出，"
    + "E193 吸收 98% token）那条曲线 —— "
    + ROUTE_PHASES.map(function (p) { return p.tag + "（" + p.clock + "）"; }).join(" → ")
    + "。\n这根轴的刻度是 **step**，与时光机、日志抽屉、rank 泳道钉的是同一条时间线："
    + "step " + ROUTE_STEP_FROM + "（慢性偏斜开始爬坡）到 step " + ROUTE_STEP_TO
    + "（问题一的事故步，loss NaN）。它不是一把匀速的尺子 —— 前三相跨了四千多个 step，"
    + "而 ③ → ④ 全部发生在 step " + ROUTE_STEP_TO + " **那一步之内**（logits 越界 → "
    + "exp() = Inf → softmax 塌成 one-hot），所以轴的后一段 step 号不再往前走。"
    + "\n前五个度量**不受**这根轴影响：那次事故改的是路由分布本身，把它一并算进"
    + "显存与耗时是另一回事，这里不替你下那个结论。";

  /* 冷蓝 → 火红。六段线性插值，亮度单调上升（深色底上「越热越亮」这条不能破）。
     中途绕开绿色：绿在这套色板里是「安全 / 正常」的语义色，热力图的中段出现一片
     绿会被读成一档状态，而它其实只是「不冷不热」。 */
  const HEAT_RAMP = [
    [0.00, 13, 30, 66],
    [0.22, 38, 86, 178],
    [0.44, 104, 78, 196],
    [0.64, 176, 66, 148],
    [0.82, 226, 68, 84],
    [1.00, 255, 124, 46],
  ];

  const HEAT_RAMP_CSS = "linear-gradient(90deg, "
    + HEAT_RAMP.map((s) => `rgb(${s[1]},${s[2]},${s[3]}) ${Math.round(s[0] * 100)}%`).join(", ") + ")";

  function heatColor(u) {
    const t = clamp(u, 0, 1);
    let i = 1;
    while (i < HEAT_RAMP.length - 1 && t > HEAT_RAMP[i][0]) i += 1;
    const a = HEAT_RAMP[i - 1];
    const b = HEAT_RAMP[i];
    const f = (t - a[0]) / ((b[0] - a[0]) || 1);
    const mix = (j) => Math.round(a[j] + (b[j] - a[j]) * f);
    return `rgb(${mix(1)},${mix(2)},${mix(3)})`;
  }

  /* ── 硬件常量 ────────────────────────────────────────────────────────────
     CARD_SPECS 里只有 hbmGB 是结构化字段，算力与互联带宽都写在 specs 那句说明
     文本里、取不出来。这张表把热力模型要用的三项显式列出来。
     ⚠️ 它是**口径常量**而不是实测：换卡型、换互联拓扑要一并改这里。
       tflops  BF16 稠密算力（910B 一档 376，与右栏规格那行同值；
               950PR 取 KNOWLEDGE.md §3.1 的 FP16 432）
       hccs    机内互联的单卡聚合带宽 GB/s
       rdma    出了机器边界的单卡网络带宽 GB/s（200 Gbps RoCE ≈ 25 GB/s）
     两者差一个数量级，正是这幅图最该让人看见的那件事。 */
  const HEAT_HW = {
    "910b-32": { tflops: 376, hccs: 392, rdma: 25 },
    "910b-64": { tflops: 376, hccs: 392, rdma: 25 },
    "950": { tflops: 432, hccs: 784, rdma: 50 },
  };

  const HEAT_GIB = 1024 * 1024 * 1024;

  /* 确定性哈希（不是随机数）：同一份配置每次画出来必须逐格一样，否则这幅图上
     「哪台机器偏热」就成了刷新一次换一个答案的噪声。 */
  function hash01(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* 一个专家在某一层上有多受宠。**只此一处** —— 前五个度量的路由不均（skewOf）
     与「专家负载」那一档的分布（routeOf）读的必须是同一份人格表，否则同一份配置
     会在两处指出两批不同的热门专家，那时两幅图互相矛盾。
     两项：一半是专家自己的性格（跨层稳定），一半随层变。区间 [0.30, 2.20]、
     均值 1.25 —— 比原先的 [0.45, 2.00] 更散：一幅处处 0.98~1.02 的热力图读不出
     任何东西，而真实 router 的不均本来就比那大得多。 */
  const EXPERT_BASE_MEAN = 1.25;

  function expertBase(e, layer) {
    return 0.30 + 1.05 * hash01(e, 7) + 0.85 * hash01(e, layer + 1);
  }

  function buildHeat(t) {
    const c = t.counts;
    const cfg = t.config || {};
    const pre = t.preset || {};
    const hw = HEAT_HW[cfg.card] || HEAT_HW["910b-64"];
    const H = Math.max(1, pre.hidden || 4096);
    const V = Math.max(1, pre.vocab || 128000);
    const iDense = Math.max(1, pre.denseIntermediate || 4 * H);
    const iMoe = Math.max(1, pre.moeIntermediate || iDense);
    const tp = Math.max(1, c.tp);
    const cp = Math.max(1, c.cp);
    const pp = Math.max(1, c.pp);
    const ep = Math.max(1, c.ep);
    const edp = Math.max(1, c.edp);
    const rpn = Math.max(1, c.ranksPerNode || 1);
    const mbn = Math.max(1, c.microBatchNum || 1);
    const topK = Math.max(1, c.topK || 1);
    const epr = Math.max(0, c.expertsPerEpRank || 0);
    const shared = Math.max(0, c.sharedExpert || 0);
    const seqLocal = Math.max(1, (cfg.seqLen || 4096) / cp);
    const tokens = Math.max(1, (cfg.microBatch || 1) * seqLocal);   // 本卡一份 micro-batch 的 token 数

    /* ── 每参数的常驻字节 ─────────────────────────────────────────────────
       口径与 config-relation-capacity.js 同源（那里是本页显存的权威实现），这里
       只取它的骨架：热力要的是格与格之间的相对轻重，不是容量栏那种逐段可核对的
       精确值。两者对不上小数点是预期的，对不上**量级**才是 bug。 */
    const bWeight = cfg.dtype === "fp8" ? 1 : 2;
    const bGrad = 2;
    const bOptim = cfg.paramsDtype === "fp32" ? 8 : 12;
    const shardMode = cfg.shardMode || "none";
    const rep = Math.max(1, c.dpReplica || 1);
    const wDiv = shardMode === "fsdp2" ? rep : 1;     // FSDP2 连权重与梯度一起切
    const oDiv = shardMode === "none" ? 1 : rep;      // ZeRO-1 起，优化器状态沿 DP 切
    const perParamBytes = (bWeight + bGrad) / wDiv + bOptim / oDiv;

    /* 激活系数与训练倍率随重计算档一起动（省显存 = 多算一遍前向）。
       系数出处见 config-relation-capacity.js 的 actCoeffs（Korthikanti 2022 §4）。 */
    const rmode = cfg.recomputeMode || (cfg.recompute ? "full" : "none");
    const sp = Boolean(cfg.seqParallel);
    const actCoeff = rmode === "full" ? (sp ? 2 : 2 * tp)
      : rmode === "selective" ? (sp ? 17 : 9 * tp + 8)
        : (sp ? 34 : 10 * tp + 24);
    const trainMul = rmode === "full" ? 8 : rmode === "selective" ? 7 : 6;

    /* ── 路由不均：这幅图上最值得看的一处「热」────────────────────────────
       专家不是等概率被选中的：router 训出来总有几个热门专家，而一张卡的负载是它
       持有的那几个专家的热度之和。热度由 (专家号, 层号) 哈希出来 —— 一半是专家
       自己的性格（跨层稳定），一半随层变，均值归一到 1。
       它同时驱动三件事：计算时间（多算的 token）、空闲时间（同列别的卡在等它）、
       通信时间（All-to-All 送出去的那一份）。
       ⚠️ 每卡专家数越多，这个和越平（大数定律）—— 这正是「EP 切太细反而更不均」
       在图上该有的样子，不是模型的瑕疵。 */
    function skewOf(layer, epIdx) {
      if (!epr) return 1;
      const lo = epIdx * epr;
      let sum = 0;
      for (let e = lo; e < lo + epr; e += 1) sum += expertBase(e, layer);
      return sum / epr / EXPERT_BASE_MEAN;
    }

    /* ══ 五处刻意构造的故障 ═════════════════════════════════════════════════
       一幅处处均匀的热力图什么也教不了人。这一节按当前配置**定死**地埋五处典型
       故障，每个度量各摊上一个、形状彼此不同 —— 练的是「看见这个形状该想到什么」：

         内存占用  一个 EP rank 上热门专家扎堆 → permute 暂存撑到触顶（横带）
         计算量    PP 按层数均分、层却不等重 → 有一段整体更重（列区）
         计算时间  一台机器降频 → 拖住全局的慢卡（整机横带）
         空闲时间  大家在等那台慢卡 → 与上一张**互补**（慢卡自己最暗）
         通信时间  一个机架的 RDMA 掉速 → 跨机那几条全被拖慢（连续几条横带）

       ⚠️ 它们是**构造**的，不是从 profiling 里读出来的 —— 与这一节上面那段说明
       同一个诚实口径。选点全部走 hash01（不是随机数）：同一份配置每次落在同一批
       卡上，才能指名道姓地查；配置一拨，故障点跟着换一批，形状照样成立。
       幅度都写成显式常量：要调「明显到什么程度」只改这几个数。 */
    const nodesTotal = Math.max(1, c.node || 1);
    const FAULT = (() => {
      // 种子把几个规模量都拌进去：换卡数 / 换切法都该换一批故障点
      const seed = (c.totalRank || 1) + 7 * nodesTotal + 13 * pp + 17 * ep + 3 * c.totalLayer;
      const pickIn = (salt, n) => (n > 0 ? Math.floor(hash01(seed, salt) * n) % n : 0);

      const slowNode = pickIn(101, nodesTotal);
      /* 慢卡与坏机架不许重叠：两条带子叠在一起，读的人分不清是一个毛病还是两个。
         机架宽度随集群规模走，小集群下整个"机架"概念不成立，索性关掉这一处。 */
      const rackSize = nodesTotal >= 6 ? Math.max(1, Math.min(4, Math.floor(nodesTotal / 4))) : 0;
      let rackLo = pickIn(202, Math.max(1, nodesTotal - rackSize));
      if (slowNode >= rackLo - 1 && slowNode < rackLo + rackSize + 1) {
        rackLo = (rackLo + rackSize + 2) % Math.max(1, nodesTotal - rackSize);
      }
      return {
        // 算力只剩这么多：降频 / 单卡 ECC 退化 / 风扇故障，都是这个形状
        slowNode, slowFactor: 0.68,
        // 慢卡落在哪一段 stage —— 同段的卡等得最久（空闲时间那张图的主形状）
        slowStage: Math.min(pp - 1, Math.floor(slowNode * rpn / Math.max(1, c.ranksPerStage))),
        // 一个机架的上联劣化：RDMA 只剩这么多，机内 HCCS 不受影响
        rackLo, rackSize, rackFactor: 0.42,
        // 这个 EP rank 上热门专家扎堆，permute / unpermute 暂存翻这么多倍
        oomEp: pickIn(303, ep), oomBoost: 2.4,
        // 这一段 stage 的层更重（更大的 intermediate / 更长的窗口），PP 没算这笔
        heavyStage: pickIn(404, pp), heavyFactor: 1.34,
      };
    })();

    const inBadRack = (node) => FAULT.rackSize > 0
      && node >= FAULT.rackLo && node < FAULT.rackLo + FAULT.rackSize;

    /* 同一列里最重的那张卡 —— 「负载不均」是差值，没有它就只有绝对值。 */
    const skewMaxCache = new Map();
    function skewMaxOf(layer) {
      if (!epr) return 1;
      let m = skewMaxCache.get(layer);
      if (m !== undefined) return m;
      m = 0;
      for (let p = 0; p < ep; p += 1) m = Math.max(m, skewOf(layer, p));
      skewMaxCache.set(layer, m);
      return m;
    }

    /* ── 「专家负载」：同一份路由分布，沿时间轴一步步偏掉 ────────────────────
       前五个度量的 skewOf 给的是**慢性**不均（router 训出来总有几个热门专家，
       同一份配置每次一样）。这一档在它之上加一根时间轴，演的是运行事件 2.5：

         α 锐化   把每个专家的基础热度取 α 次方再归一化，α 随 τ 从 1 涨到 6。
                  这是 ①→②→③ 那一段「均衡损失渐渐压不住」的样子：分布本来就不平，
                  只是被辅助损失按住；按不住之后，原本 1.3× 的专家变成 3×、5×。
                  ⚠️ 它不改变**谁**热，只改变热多少 —— 热点的位置由配置定死，
                  拖时间轴不会让热点跳到别的卡上，那才是可排查的形状。
         g 塌缩   τ 越过 ROUTE_COLLAPSE_AT 之后，分布向 one-hot 混合，到 τ=1 时
                  热点专家吃掉 98%（事件 2.5 的读数），同层其余全灭。
                  相邻层跟着抬一点：数值漂移是上游带来的，不会只落在一层里，但
                  塌缩本身只在那一层发生 —— 所以邻层是「更偏」，不是「也塌」。

       塌缩点不是随机挑的：取「天生最偏」的那个专家（跨层稳定的那一半人格分最高
       的一个），再取它最热的那一层。同一份配置每次指向同一张卡，这幅图才能被当作
       一次可复现的排查用。 */
    const routedTotal = Math.max(0, c.routedExpert || 0);
    /* 稠密模型（preset.noMoe）与「一个专家一张卡都没有」的退化配置下这一档没有
       内容：不是画成一片冷，是整条时间轴都该灰掉（见 syncHeat 里的 disabled）。 */
    const routeOn = epr > 0 && routedTotal > 0 && c.moeLayers > 0;

    /* 塌缩点（层 + EP rank + 专家）。按 topology 算一次就定了，与 τ 无关。

       挑法有一处要紧的讲究：塌缩必须落在**慢性偏斜阶段就已经最热的那张卡**上。
       否则图会讲一个自相矛盾的故事 —— 前三相眼看着 A 卡越来越烫，第四相突然是
       B 卡吃掉全部 token，读的人只能得出「塌缩不可预警」这个错结论。真实的
       router 塌缩恰恰相反：吃掉一切的那个专家，本来就是那个最受宠的专家。
       所以按「锐化到底（α 取最大值 6）时哪一格最重」来定，再在那一格里挑最重的
       那个专家 —— 与 routeOf 的分布同一把尺子量出来的答案。 */
    let hotPoint = null;
    let routeIncident = null;
    function hotOf() {
      if (hotPoint) return hotPoint;
      const moeLayers = t.layers.filter((l) => l.ffn === "moe").map((l) => l.index);

      /* openPangu 的事故不是模拟器自由挑出的“某个热点”，而是一条已经取证的数据：
         Layer 38 / E193 / EP rank 23。openPangu 的其它 EP 配置也固定跟踪 E193，只把
         它投影到当前配置的专家分片；切到参考 EP64 时再启用 rank 23 与原始 trace。 */
      const openPanguCaseFits = (cfg.model || pre.id) === ROUTE_INCIDENT.model
        && ROUTE_INCIDENT.expert < routedTotal
        && moeLayers.includes(ROUTE_INCIDENT.layer);
      if (openPanguCaseFits) {
        const exactIncident = routedTotal === 256 && ep === 64;
        /* 事故 token 数据与“投影到当前配置的哪一个 EP rank”是两件事：EP8 默认档
           同样演 E193 的 8028/8192，只是它按当前分片落在 EP6（rank108）而非事故
           部署的 EP23；切回 EP64 参考配置时才恢复 trace 里的 rank23。 */
        routeIncident = ROUTE_INCIDENT;
        hotPoint = {
          expert: ROUTE_INCIDENT.expert,
          layer: ROUTE_INCIDENT.layer,
          epIdx: exactIncident ? ROUTE_INCIDENT.epRank : t.epRankOfExpert(ROUTE_INCIDENT.expert),
          incident: routeIncident,
        };
        return hotPoint;
      }

      // 层多时抽样即可：要的是「哪一层最容易塌」，不是把每一层都排个名次
      const stride = Math.max(1, Math.ceil(moeLayers.length / 32));
      let layer = moeLayers.length ? moeLayers[0] : -1;
      let epIdx = 0;
      let best = -1;
      for (let i = 0; i < moeLayers.length; i += stride) {
        const l = moeLayers[i];
        const load = new Float64Array(ep);
        let total = 0;
        for (let e = 0; e < routedTotal; e += 1) {
          const w = Math.pow(expertBase(e, l), 6);
          load[Math.floor(e / epr)] += w;
          total += w;
        }
        // 比的是**份额**：每层的权重总和不同，拿绝对值跨层排名会挑错层
        const norm = total > 0 ? 1 / total : 0;
        for (let p = 0; p < ep; p += 1) {
          const share = load[p] * norm;
          if (share > best) { best = share; layer = l; epIdx = p; }
        }
      }
      // 那一格里最受宠的专家：事件 2.5 里的 E193 就是这个位置上的东西
      let expert = epIdx * epr;
      let bestE = -1;
      for (let k = 0; k < epr; k += 1) {
        const e = epIdx * epr + k;
        const s = expertBase(e, layer);
        if (s > bestE) { bestE = s; expert = e; }
      }
      hotPoint = { expert, layer, epIdx };
      return hotPoint;
    }

    /* 一层的分布算一次就够，但右栏现在还要把 EP rank 继续展开到每个 expert，所以
       缓存的源数据改成 expert 份额；rank 份额只做一次聚合。两份缓存都连 τ 一起记。 */
    let expertRouteCache = new Map();
    let expertRouteCacheTau = -1;
    let routeCache = new Map();
    let routeCacheTau = -1;

    function expertRouteOf(layer) {
      if (!routeOn) return null;
      if (expertRouteCacheTau !== routeTau) {
        expertRouteCache = new Map();
        expertRouteCacheTau = routeTau;
      }
      let arr = expertRouteCache.get(layer);
      if (arr) return arr;

      const hot = hotOf();
      const ramp = clamp(routeTau / ROUTE_COLLAPSE_AT, 0, 1);
      const alpha = 1 + 5 * ramp * ramp;        // 慢起快落：前半段几乎还是均衡的
      const collapseP = routeTau <= ROUTE_COLLAPSE_AT ? 0
        : (routeTau - ROUTE_COLLAPSE_AT) / (1 - ROUTE_COLLAPSE_AT);
      // 塌缩只发生在那一层；邻层跟着更偏一点（α 再抬），但不向 one-hot 走
      const d = Math.abs(layer - hot.layer);
      const p = layer === hot.layer ? collapseP : 0;
      const a = alpha * (d > 0 && d <= 3
        ? 1 + 0.5 * ROUTE_COLLAPSE_MAX * collapseP / Math.max(1, d) : 1);

      arr = new Float64Array(routedTotal);
      let total = 0;
      for (let e = 0; e < routedTotal; e += 1) {
        const w = Math.pow(expertBase(e, layer), a);
        arr[e] = w;
        total += w;
      }
      const norm = total > 0 ? 1 / total : 0;
      for (let e = 0; e < routedTotal; e += 1) arr[e] *= norm;

      if (p > 0) {
        const target = new Float64Array(routedTotal);
        target[hot.expert] = ROUTE_COLLAPSE_MAX;
        if (routeIncident) {
          /* 8028 + 164 = 8192；除 E193 外仅 8 个专家仍有 token，正好留下 247 个
             dead experts。8 个幸存者取事故前基础热度最高者，保证塌缩是原有偏斜的
             延续；164 按 21×4 + 20×4 分完，不凭空丢 token。 */
          const survivors = Array.from({ length: routedTotal }, (_, e) => e)
            .filter((e) => e !== hot.expert)
            .sort((x, y) => expertBase(y, layer) - expertBase(x, layer))
            .slice(0, 8);
          survivors.forEach((e, i) => {
            target[e] = (i < 4 ? 21 : 20) / routeIncident.totalTokens;
          });
        } else {
          const rest = Math.max(1e-12, 1 - arr[hot.expert]);
          const scale = (1 - ROUTE_COLLAPSE_MAX) / rest;
          for (let e = 0; e < routedTotal; e += 1) {
            if (e !== hot.expert) target[e] = arr[e] * scale;
          }
        }
        for (let e = 0; e < routedTotal; e += 1) {
          arr[e] = (1 - p) * arr[e] + p * target[e];
        }
      }

      expertRouteCache.set(layer, arr);
      return arr;
    }

    function routeOf(layer) {
      if (!routeOn) return null;
      if (routeCacheTau !== routeTau) { routeCache = new Map(); routeCacheTau = routeTau; }
      let arr = routeCache.get(layer);
      if (arr) return arr;

      const hot = hotOf();
      const expertShares = expertRouteOf(layer);
      arr = new Float64Array(ep);
      for (let e = 0; e < routedTotal; e += 1) {
        /* 运行态按 trace 的 E193 → EP rank 23 落点；其余专家仍沿用配置态分片。
           这条只在精确事故配置启用，避免把观测映射冒充通用切分公式。 */
        const p = routeIncident && e === hot.expert
          ? hot.epIdx : Math.floor(e / epr);
        arr[p] += expertShares[e];
      }
      // 份额 → 「均分的多少倍」：均分 = 1/ep，所以乘 ep
      for (let p = 0; p < ep; p += 1) arr[p] *= ep;
      routeCache.set(layer, arr);
      return arr;
    }

    /* 非 MoE 列没有路由可言 —— 返回 NaN 而不是 0：0 会和「dead expert」撞在色阶
       同一端上，而那两件事读起来完全不同（一个是没有这回事，一个是被饿死了）。
       渲染那边见到非有限值就留素底。 */
    function routeAt(col, rank) {
      if (!routeOn || col.type !== "layer" || !col.moe) return NaN;
      const arr = routeOf(col.layer);
      if (!arr) return NaN;
      return arr[t.coordsOfRank(rank).epIdx] || 0;
    }

    /* 色阶两端不走 allRanges 那套采样：这一档的量程随 τ 每帧都在变，而它恰好是
       **算得出来**的 —— 最重的一定在塌缩层里，最轻的一定是被饿死的那一档（0）。
       所以扫「塌缩层 + 若干代表层」的 ep 个数即可，比采样便宜两个数量级。 */
    let routeRangeCache = null;
    function routeRange() {
      if (routeRangeCache && routeRangeCache.tau === routeTau) return routeRangeCache.r;
      let hi = -Infinity;
      let lo = Infinity;
      if (routeOn) {
        const hot = hotOf();
        const moeLayers = t.layers.filter((l) => l.ffn === "moe").map((l) => l.index);
        const stride = Math.max(1, Math.ceil(moeLayers.length / 24));
        const probe = new Set([hot.layer]);
        for (let i = 0; i < moeLayers.length; i += stride) probe.add(moeLayers[i]);
        probe.forEach((l) => {
          const arr = routeOf(l);
          if (!arr) return;
          for (let p = 0; p < ep; p += 1) {
            if (arr[p] > hi) hi = arr[p];
            if (arr[p] < lo) lo = arr[p];
          }
        });
      }
      /* 两端都取实测而不是把下端钉死在 0：τ=0 那一档的全部内容就是「1× 上下那点
         起伏」，下端钉 0 会把它整片推到色阶的暖区，慢性偏斜反而看不见了。
         代价是塌缩之后下端跟着掉到 ~0 —— 那正是 dead expert 该在的位置。 */
      if (!(hi > lo)) { lo = 0; hi = Math.max(1e-9, hi > 0 ? hi : 1); }
      const r = { lo, hi };
      routeRangeCache = { tau: routeTau, r };
      return r;
    }

    /* ── 位置：同一根通信轴，落在机内还是跨机，差一个数量级 ────────────────
       一个通信组在 rank 编址上占多宽（span），就决定了它出不出得了机器：
       span ≤ 整机卡数 → 机内 HCCS；再宽就要出网卡走 RDMA，跨得越远越可能多一跳。
       每台机器再叠一点自己的抖动（链路质量、温度导致的降频）——「同一列里某几台
       机器整体偏热」正是排查慢卡时最先要看的形状，而它只能由**位置**给出。 */
    function linkBw(span, node) {
      // 抖动区间比原先宽一倍：±3% 的差别在色阶上根本分辨不出来，等于没有位置这一半
      if (span <= rpn) return hw.hccs * (0.88 + 0.24 * hash01(node, 11));
      const hops = span > rpn * 32 ? 2 : 1;          // 跨机架 / 跨 spine 多一跳
      /* 构造的问题（通信时间那张图）：一个机架的上联劣化 —— 光模块老化、一条上联
         挂了之后剩下的那条扛全部流量。只打在**跨机**这一支上：机内 HCCS 走的是另
         一套线，不该跟着掉。所以图上那几条带子只在有跨机通信的列上亮起来。 */
      const rack = inBadRack(node) ? FAULT.rackFactor : 1;
      return (hw.rdma / hops) * rack * (0.7 + 0.5 * hash01(node, 23));
    }

    const attnParams = 4 * H * H / tp;
    const denseFfn = 3 * H * iDense / tp;
    const moeFfn = 3 * H * iMoe * (epr + shared) / tp;
    const embParams = V * H / (cfg.vocabEmbDp ? 1 : tp);
    const headParams = V * H / tp;
    const lastLayerOf = t.stages.map((s) => s.hi);

    /* 一格 = 一张卡 × 一列。五个度量一次算完：idle 要用 busy 与 comm，分开算等于
       把同一串式子跑三遍。 */
    function evalCell(col, rank) {
      const co = t.coordsOfRank(rank);
      const node = co.node;
      const stage = col.stage;
      const isLayer = col.type === "layer";
      const moe = Boolean(isLayer && col.moe);
      const layer = isLayer ? col.layer : -1;
      const skew = moe ? skewOf(layer, co.epIdx) : 1;

      let params = 2 * H;                            // Final Norm：一对 γ/β，量级上可忽略
      if (isLayer) params = attnParams + (moe ? moeFfn : denseFfn);
      else if (col.id === "emb") params = embParams;
      else if (col.id === "head") params = headParams;

      /* 在飞的激活：1F1B 下越靠前的 stage 手里攥着越多份还没回收的前向 ——
         这是「同一列层，stage0 的卡比 stage3 的卡吃内存」的来源。 */
      const inflight = Math.min(mbn, Math.max(1, pp - stage));
      let actBytes;
      if (isLayer) actBytes = actCoeff * tokens * H * 2 / tp * inflight;
      else if (col.id === "head") actBytes = tokens * V * 2 / tp;   // logits 是过路的，不跨 micro-batch 攒
      else actBytes = tokens * H * 2 / tp;
      /* MoE 的 permute / unpermute 暂存：一张卡收到多少 token 就要为多少 token 开
         这块地，而收到多少正是路由不均那个数。真实训练里 MoE 的 OOM 十有八九出在
         这里 —— 也是「同一列层里某几张卡明显更吃内存」在图上唯一的来源。 */
      /* 构造的问题（内存占用那张图）：热门专家不是散开的，它们扎堆落在同一个
         EP rank 上 —— 那一条横带的 permute 暂存翻两倍多，是全图唯一会触顶的一批
         卡。与运行事件问题1 的「EP rank 17（global rank 1553）碎片 OOM」同源：
         OOM 从来不是整片一起爆，是某一条先到顶。 */
      if (moe) {
        actBytes += 2 * tokens * topK * H * 2 * skew / tp
          * (co.epIdx === FAULT.oomEp ? FAULT.oomBoost : 1);
      }
      const mem = (params * perParamBytes + actBytes) / HEAT_GIB;

      /* 计算量：一份 micro-batch 的前向 × 训练倍率（反向 + 重计算那一遍） */
      let fwd = 2 * tokens * (isLayer ? attnParams : params);
      let skewFwd = 0;                               // 前向里随路由不均伸缩的那一段
      if (isLayer) {
        fwd += 4 * tokens * seqLocal * H / tp;       // FlashAttention 的两次 S×S
        if (moe) {
          skewFwd = 2 * tokens * topK * skew * (3 * H * iMoe / tp);
          fwd += skewFwd + 2 * tokens * shared * (3 * H * iMoe / tp);
        } else {
          fwd += 2 * tokens * denseFfn;
        }
      } else if (col.id === "emb") {
        fwd = 2 * tokens * H;                        // 查表，不是 matmul
      }
      /* 层不等重（计算量那张图）：
           · 每层各带一点自己的分量（±9%）—— 注意力窗口、intermediate 都不是逐层
             一模一样的，一列一列的深浅本来就该有；
           · 再给某一段 stage 整体加一笔（构造的问题）：PP 是按**层数**均分的，
             层却不等重 —— 这一段因此整块偏亮。图上那块列区就是「切分不均」四个字
             最直接的样子，而它在配置表单里只是 pp 那一个数字，看不出来。 */
      if (isLayer) {
        const heavy = (0.91 + 0.18 * hash01(layer, 53))
          * (stage === FAULT.heavyStage ? FAULT.heavyFactor : 1);
        fwd *= heavy;
        skewFwd *= heavy;          // 空闲时间里的「等最重那张卡」用它，两处得同一把尺子
      }
      const flops = fwd * (trainMul / 2);

      /* 算力吃得到多少是分档的：grouped matmul（MoE）比稠密 GEMM 差一大截，
         查表几乎不占 Cube。再叠一点每台机器自己的抖动。 */
      const eff = moe ? 0.34
        : isLayer ? 0.52
          : col.id === "head" ? 0.46
            : col.id === "emb" ? 0.06 : 0.12;
      /* 抖动分两层，比原先那一层散得多：整机一档（同一台机器的 8 张卡同进同退，
         那是供电与散热的粒度）+ 每张卡一点自己的（个体差异）。
         构造的问题（计算时间那张图）：其中一台机器算力只剩 68% —— 降频、ECC 退化、
         风扇坏一只，在这幅图上都是同一个形状：**一条通体发烫的整机横带，横跨所有
         列**。列方向不挑食正是它与「某一层重」的区别，也是认出慢卡的关键。 */
      const rate = hw.tflops * 1e12 * eff
        * (0.92 + 0.16 * hash01(node, 31)) * (0.97 + 0.06 * hash01(rank, 47))
        * (node === FAULT.slowNode ? FAULT.slowFactor : 1);
      const busy = flops / rate * 1000;

      /* 通信：四条轴各按自己的组宽找带宽。组宽 = 这一组在 rank 编址上跨多少号，
         它决定了机内还是机外 —— 与「通信观测」那一档的 commLink 同一条判据。 */
      let comm = 0;
      let commCross = 0;
      function add(bytes, span) {
        if (!(bytes > 0)) return;
        const ms = bytes / (linkBw(span, node) * 1e9) * 1000;
        comm += ms;
        if (span > rpn) commCross += ms;
      }
      // 每层两次 TP All-Reduce（attention 出口 + FFN 出口），前反向各一遍
      if (isLayer && tp > 1) add(4 * tokens * H * 2 * 2 * (tp - 1) / tp, tp);
      // MoE 的 dispatch + combine，前反向各一遍：每个 token 复制 topK 份送出去
      if (moe && ep > 1) add(4 * tokens * topK * H * 2 * skew, c.ranksPerDp);
      // 梯度归约一个 step 只做一次，摊到每个 micro-batch 上
      if (edp > 1) add(params * 2 * 2 * (edp - 1) / edp / mbn, c.ranksPerDp * edp);
      // stage 边界的 P2P：只有这一段的最后一层发得出去
      if (isLayer && pp > 1 && layer === lastLayerOf[stage]) add(2 * tokens * H * 2, c.ranksPerStage);

      /* 空闲 = 三段等出来的时间：
           气泡    PP 的暖机与排空，(pp−1)/微批数 这一份谁也躲不掉
           不均    同一列里最重的那张卡算完之前，本卡只能干等（MoE 才有）
           露头    没被计算盖住的那段通信 —— 跨机的那部分尤其盖不住 */
      /* 气泡不再对每一段一样重：1F1B 的暖机期里，越靠后的 stage 越要干等前面几段
         先把第一份 micro-batch 递过来（末段等 pp−1 段，首段谁也不等）。所以这一项
         沿 stage 成一道**阶梯**，图上是从左到右一级一级亮起来的四块。 */
      const bubble = busy * (pp - 1) / mbn * (pp > 1 ? 0.6 + 0.8 * stage / (pp - 1) : 1);
      const imbalance = moe && skew > 0
        ? skewFwd * (trainMul / 2) * (skewMaxOf(layer) / skew - 1) / rate * 1000
        : 0;
      const exposed = (comm - commCross) * 0.2 + commCross * 0.35;
      /* 构造的问题（空闲时间那张图）：同步点上，快的等慢的 —— 那台降频的机器让
         **同一段 stage 的所有卡**都停在那儿（TP / DP 的集合通信是同步的），别的
         stage 隔着流水线也吃到半份。
         ⚠️ 慢卡自己这一项是 0：它不等人，是被等的那一个。所以这张图与「计算时间」
         恰好**互补** —— 那边最烫的一条，这边是全图唯一一条暗的。两张图并着读，
         「谁是罪魁」这个问题当场就有答案；只看一张都得不出这个结论。 */
      const straggler = node === FAULT.slowNode ? 0
        : busy * (1 / FAULT.slowFactor - 1) * (stage === FAULT.slowStage ? 1 : 0.5);
      return {
        mem,
        flops: flops / 1e12,
        busy,
        idle: bubble + imbalance + exposed + straggler,
        comm,
      };
    }

    /* 这一格踩到了埋在这个度量里的那处故障吗？踩到就在气泡末尾补一行说清是什么。
       没有这一行，图上那条带子只是「这里比较烫」，读的人还得自己猜是什么烫了它 ——
       而这幅图的全部价值就在于把「形状」翻译成「毛病」。 */
    function faultNote(metric, col, rank) {
      const co = t.coordsOfRank(rank);
      const moe = col.type === "layer" && Boolean(col.moe);
      if (metric === "mem" && moe && co.epIdx === FAULT.oomEp) {
        return `\n⚠ EP rank ${FAULT.oomEp}：热门专家扎堆，permute 暂存 ×${FAULT.oomBoost}`
          + " —— 全图最先触顶的一条，MoE 的 OOM 就是从这样一条带子开始的";
      }
      if (metric === "flops" && col.type === "layer" && col.stage === FAULT.heavyStage) {
        return `\n⚠ PP stage ${FAULT.heavyStage}：这一段的层比别段重`
          + ` ${Math.round((FAULT.heavyFactor - 1) * 100)}% —— PP 按层数均分，没算这笔`;
      }
      if (metric === "busy" && co.node === FAULT.slowNode) {
        return `\n⚠ 整机 ${FAULT.slowNode} 是慢卡：算力只剩 ${Math.round(FAULT.slowFactor * 100)}%`
          + "（降频 / ECC 退化）—— 它横跨所有列，这正是慢卡与「某一层重」的区别";
      }
      if (metric === "idle") {
        if (co.node === FAULT.slowNode) {
          return `\n本卡就是那台慢卡（整机 ${FAULT.slowNode}）：它不等人，所以在这张图上`
            + "反而是唯一一条暗带 —— 切到「计算时间」看它的另一面";
        }
        return `\n⚠ 在等整机 ${FAULT.slowNode} 那台慢卡`
          + (col.stage === FAULT.slowStage ? "（同段，等全额）" : "（隔着流水线，等半份）");
      }
      if (metric === "comm" && inBadRack(co.node)) {
        return `\n⚠ 机架 ${FAULT.rackLo}–${FAULT.rackLo + FAULT.rackSize - 1}：RDMA 只剩`
          + ` ${Math.round(FAULT.rackFactor * 100)}%（上联劣化）—— 只打在跨机那几条上，机内 HCCS 不受影响`;
      }
      return "";
    }

    /* 整机档一行代表几张卡，取**均值**（不是和）：换粒度时同一片区域的颜色不该
       整体跳档 —— 粒度换的是分辨率，不是量纲。 */
    function value(metric, col, rank, span) {
      /* 「专家负载」走自己那条路：它不是 evalCell 那五个式子里的一项（那五个由
         配置推得、与时间无关），而是一张随 τ 变的分布表。分开取还有一层好处 ——
         逐格热路径上不会为了一个用不到的度量多跑一遍那串成本模型。 */
      if (metric === "route") {
        if (span <= 1) return routeAt(col, rank);
        let s = 0;
        let n = 0;
        for (let i = 0; i < span; i += 1) {
          const x = routeAt(col, rank + i);
          if (Number.isFinite(x)) { s += x; n += 1; }
        }
        return n ? s / n : NaN;
      }
      if (span <= 1) return evalCell(col, rank)[metric];
      let sum = 0;
      for (let i = 0; i < span; i += 1) sum += evalCell(col, rank + i)[metric];
      return sum / span;
    }

    /* ── 色阶两端：整幅平面的取值范围 ─────────────────────────────────────
       逐格算一遍太贵（46 层 × 2048 行），改成采样，但采样点不是随便挑的：
         · 头两台机器逐张卡  —— 机内位置的那一档差别在这里
         · 每个 EP rank 至少一张 —— 路由不均的极值只落在这上面
         · 全程等距若干行     —— 副本与机器编号的抖动
       再把两端各留一点余量，免得没被采到的极值直接顶到色阶外。 */
    let ranges = null;
    function allRanges() {
      if (ranges) return ranges;
      const cols = [];
      t.stages.forEach((entry) => {
        if (entry.stage === 0) cols.push({ type: "unit", id: "emb", stage: entry.stage });
        for (let l = entry.lo; l <= entry.hi; l += 1) {
          cols.push({
            type: "layer", layer: l, stage: entry.stage,
            moe: Boolean(t.layers[l] && t.layers[l].ffn === "moe"),
          });
        }
        if (entry.stage === t.stages.length - 1) {
          cols.push({ type: "unit", id: "norm", stage: entry.stage });
          cols.push({ type: "unit", id: "head", stage: entry.stage });
        }
      });
      const rows = Math.max(1, c.ranksPerStage);
      const picks = new Set([0, rows - 1]);
      for (let i = 0; i < Math.min(rows, 2 * rpn); i += 1) picks.add(i);
      for (let p = 0; p < Math.min(ep, 128); p += 1) picks.add(Math.min(rows - 1, p * c.ranksPerEp));
      const stride = Math.max(1, Math.floor(rows / 96));
      for (let i = 0; i < rows; i += stride) picks.add(i);
      /* 五处构造的故障必须被采到 —— 采样漏掉极值，色阶上端就顶不到那条带子，
         整幅图会因此看起来「哪儿都差不多」，而那条带子恰恰是这张图唯一要说的话。 */
      [FAULT.slowNode, FAULT.rackLo, FAULT.rackLo + FAULT.rackSize - 1].forEach((n) => {
        if (n < 0) return;
        for (let i = 0; i < rpn; i += 1) picks.add((n * rpn + i) % rows);
      });
      picks.add(Math.min(rows - 1, FAULT.oomEp * c.ranksPerEp));

      ranges = {};
      HEAT_SCALED.forEach((m) => { ranges[m.id] = { lo: Infinity, hi: -Infinity }; });
      cols.forEach((col) => {
        picks.forEach((r) => {
          const v = evalCell(col, col.stage * c.ranksPerStage + r);
          HEAT_SCALED.forEach((m) => {
            const g = ranges[m.id];
            const x = v[m.id];
            if (x < g.lo) g.lo = x;
            if (x > g.hi) g.hi = x;
          });
        });
      });
      HEAT_SCALED.forEach((m) => {
        const g = ranges[m.id];
        if (!(g.hi > g.lo)) { g.lo = 0; g.hi = Math.max(1e-9, g.hi || 1); }
      });
      return ranges;
    }

    return {
      value,
      cell: evalCell,
      /* 「专家负载」的量程随时间轴走，不能落进 allRanges 那份按配置缓存的表里 */
      range: (metric) => (metric === "route" ? routeRange() : allRanges()[metric]),
      // 塌缩点（专家 / 层 / EP rank）：气泡与时间轴读数要指名道姓
      hot: () => (routeOn ? hotOf() : null),
      // 只有 openPangu EP64 的已取证事故有这份原始统计；通用回退返回 null
      incident: () => { if (!routeOn) return null; hotOf(); return routeIncident; },
      // 右栏 Expert Compute 矩阵：每项是该 expert 占本层 routed token 的份额
      expertRoute: (layer) => expertRouteOf(layer),
      // 这一格踩到故障没有（气泡用）；FAULT 本身给横幅，要写出「哪台机器 / 哪一段」
      note: faultNote,
      faults: FAULT,
    };
  }

  /* 当前这一档的状态。模型按 topology 惰性建、配置一变就丢（onChange 里清）。 */
  let heatMetric = HEAT_METRICS[0].id;
  let heatCache = null;
  /* 热力档自己的交叉格选择。主脚本的 relation 只表达单一对象（rank 或 layer），
     不能表达 rank × layer；这里单独保存，右栏与白框都读这一份。 */
  let heatPick = null;

  function heatModel() {
    if (!topology) return null;
    if (!heatCache || heatCache.t !== topology) {
      heatCache = { t: topology, m: buildHeat(topology) };
    }
    return heatCache.m;
  }

  function heatMeta(id) {
    return HEAT_METRICS.find((m) => m.id === id) || HEAT_METRICS[0];
  }

  /* 数值格式：同一个度量在图例两端与气泡里必须是同一种写法，否则读者要在两处
     之间做单位换算。小于 0.01 的一律写成 <0.01，不写 0.00 —— 后者读起来像「没有」。 */
  function heatFmt(v, meta) {
    if (!Number.isFinite(v)) return "—";
    const d = meta.digits;
    // tight 的度量（倍数那种）数与单位之间不留空格："3.21×" 才读得出是一个倍数
    const sp = meta.tight ? "" : " ";
    if (v >= 1000) return `${Math.round(v)}${sp}${meta.unit}`;
    if (v > 0 && v < Math.pow(10, -d)) return `<${Math.pow(10, -d)}${sp}${meta.unit}`;
    return `${v.toFixed(d)}${sp}${meta.unit}`;
  }

  /* ══ 一、重排骨架 ════════════════════════════════════════════════════════
     只搬节点，不重建 —— 搬完之后主脚本的每一次 getElementById 拿到的还是同一个
     元素，已经挂在上面的 click / keydown 监听器也原样跟着走。 */

  /* 先把整网列那三档（整网 / 典型 Layer / 两者并看）拨到「两者并看」。
     html 末尾那段内联脚本已经按默认档给 board 挂上了 is-view-net + is-view-single，
     而 config-relation-observer.css 里有一条
       .cro-board.is-view-net .cro-section--structure { display: none; }
     ——「典型 Layer」正是本文件要搬进右栏「计算节点」的那一节，不先拨档就会被它隐掉。
     「两者并看」是三档里唯一不带任何 is-view-* 隐藏规则的一档，拨过去等于把这套
     开关中性化；页签本身随后由 css 收起（.cro-net-view display:none），
     这一版里 deck 独占「整网图」档、典型 Layer 常驻右栏，两者不再互相顶替。 */
  doc.querySelector('#croNetView [data-net-view="both"]')?.click();

  const netRegion = doc.getElementById("croNetRegion");
  const yamlRegion = doc.getElementById("croYamlRegion");
  const archRegion = doc.querySelector(".cro-region--arch");
  const moeRegion = doc.querySelector(".cro-region--moe");
  const clusterRegion = doc.querySelector(".cro-region--cluster");
  const clusterGrid = doc.querySelector(".cro-cluster__grid");
  const capacity = doc.getElementById("croCapacity");
  const structureSec = doc.querySelector(".cro-section--structure");
  const layerNavSec = doc.getElementById("croLayerNav")?.closest(".cro-section");
  const sharedSec = doc.getElementById("croSharedExperts")?.closest(".cro-section");
  const routedSec = doc.getElementById("croRoutedExperts")?.closest(".cro-section");
  const modelStepper = doc.getElementById("croModelSelect")?.closest(".cro-stepper");
  // 配置预设那一格与模型下拉同属「你在看哪一份配置」的前提，一起搬进左栏顶部
  const presetStepper = doc.getElementById("croConfigPresetSelect")?.closest(".cro-stepper");
  const viewTabs = doc.getElementById("croViewTabs");

  /* ── 左栏 ── */
  const left = el("aside", "crop-left");
  left.id = "cropLeft";
  left.dataset.pane = "form";
  left.setAttribute("aria-label", "模型与训练配置");

  const leftHead = el("div", "crop-left__head");
  const leftTitle = el("h2", "crop-left__title", "模型与训练配置");
  const leftClose = el("button", "btn btn-icon btn-ghost btn-sm");
  leftClose.type = "button";
  leftClose.title = "收起配置栏";
  leftClose.setAttribute("aria-label", "收起配置栏");
  leftClose.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>';
  leftHead.append(leftTitle, leftClose);

  const leftIntro = el("div", "crop-left__intro");
  if (modelStepper) leftIntro.appendChild(modelStepper);
  if (presetStepper) leftIntro.appendChild(presetStepper);

  /* 三档：表单 / 代码 / 整网图。
     「代码」不是本文件自己实现的第三块内容 —— 它直接去点顶栏那枚「YAML 视图」，
     于是 yaml 区的显隐仍旧只有 config-relation-yaml.js 一个来源（board 上的
     is-yaml 类），这里不再造第二套开关。板面因此顺带整块让位给代码，
     那也正是一份 yaml 该有的宽度。 */
  const tabs = el("div", "segmented-control segmented-control-muted crop-tabs");
  tabs.id = "cropLeftTabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "配置栏内容");
  [
    ["form", "表单", "按域拨配置：Model Architecture / Cluster / MoE"],
    ["code", "代码", "按当前配置实时生成的训练启动 yaml（整板让位）"],
    ["net", "整网图", "整网 3D deck 正视图"],
  ].forEach(([id, label, tip], i) => {
    const btn = el("button", `btn btn-sm${i === 0 ? " is-selected" : ""}`, label);
    btn.type = "button";
    btn.dataset.pane = id;
    btn.title = tip;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
    tabs.appendChild(btn);
  });
  leftIntro.appendChild(tabs);

  const leftBody = el("div", "crop-left__body");
  const paneForm = el("div", "crop-pane crop-pane--form");
  const paneCode = el("div", "crop-pane crop-pane--code");
  const paneNet = el("div", "crop-pane crop-pane--net");
  leftBody.append(paneForm, paneCode, paneNet);

  /* ── 左栏底部那枚 AI 输入框（外观件，暂不接功能）──────────────────────
     它浮在表单之上、贴着左栏底边，而不是排在表单末尾：左栏是一条能滚很长的
     配置流，排在末尾等于「拨到底才看得见」，而这一格恰恰是拨不动那十几个数时
     才想用的东西 —— 得一直在手边。
     占位语写成一句真能提的需求（「改成 1024 张 32G 的卡…」），而不是「问我点什么」：
     用户看一眼就知道这里能接的是**整份配置的改写**，不是一个搜索框。
     ⚠️ 输入框已加进 observer 的 SELECTABLE 白名单，否则点进来就被那条
     「点空白清空选择」把当前选中对象清掉。 */
  const ai = el("form", "crop-ai");
  ai.id = "cropAi";
  ai.setAttribute("aria-label", "AI 配置助手");
  ai.addEventListener("submit", (e) => e.preventDefault());
  const aiInput = el("textarea", "crop-ai__input");
  aiInput.id = "cropAiInput";
  aiInput.rows = 1;
  aiInput.placeholder = "改成1024张32G的卡，请给出推荐配置方案";
  aiInput.setAttribute("aria-label", "描述你想要的配置改动");
  const aiSend = el("button", "btn btn-icon btn-sm crop-ai__send");
  aiSend.type = "submit";
  aiSend.title = "发送（功能待接入）";
  aiSend.setAttribute("aria-label", "发送");
  aiSend.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"></path></svg>';
  ai.append(aiInput, aiSend);

  left.append(leftHead, leftIntro, leftBody, ai);

  // 表单档的顺序按 pic/新视图.png：Model Architecture → Cluster → MoE
  if (archRegion) paneForm.appendChild(archRegion);
  if (clusterRegion) paneForm.appendChild(clusterRegion);
  if (moeRegion) paneForm.appendChild(moeRegion);

  /* EP 口径那三档（切出 / 正交 / MindFormers）原先挂在 MoE 区标题的右边 ——
     在原版那种「区标题横贯一行」的版式里说得通，搬进 344px 的左栏之后就成了
     一排游离在标题后面的按钮，既不像标题也不像表单。
     它本来就是一个**配置项**（它决定 world 的公式与 EP 从哪个域里切），所以补一个
     label 收成表单的一格，摆在 MoE 那几枚 stepper 之前 —— 它是「下面这些数字该
     怎么读」的前提，理应先读到。
     ⚠️ 只能做 #croMoeSteppers 的**兄弟**，不能塞进去：controller.mount() 每次都
     innerHTML = "" 重建那个容器，塞进去会被冲掉。按钮本体是搬的、不是重建的，
     所以主脚本挂在 #croEpMode 上的那条 click 委托与 onChange 同步原样有效。 */
  let epField = null;

  function mountEpModeField() {
    const epMode = doc.getElementById("croEpMode");
    const host = doc.getElementById("croMoeSteppers");
    if (!epMode || !host) return;
    if (!epField) {
      epField = el("div", "cro-stepper crop-field crop-field--wide");
      epField.id = "cropEpField";
      const label = el("span", "cro-stepper__label", "EP 口径");
      label.title = "EP 从哪个域里切 —— 它决定 world 的公式，也决定下面这些数字怎么读";
      epField.append(label, epMode);
    }
    /* ⚠️ controller.mount() 每次都 `innerHTML = ""` 重建这一行，而它在 boot 里跑、
       排在本文件之后 —— 首帧插进去的那一份会被冲掉。所以这一步做成**幂等的重挂**，
       每次 cro:change 之后确认一遍：不在原位就（连同里面那组按钮一起）放回去。
       按钮本体自始至终是同一个节点，主脚本挂在 #croEpMode 上的 click 委托与
       onChange 同步因此原样有效。 */
    if (epField.lastChild !== epMode) epField.appendChild(epMode);
    if (host.firstChild !== epField) host.insertBefore(epField, host.firstChild);
  }

  mountEpModeField();
  if (yamlRegion) paneCode.appendChild(yamlRegion);
  if (netRegion) paneNet.appendChild(netRegion);

  /* ── 中栏：画布 ── */
  const stage = el("div", "crop-stage");
  stage.id = "cropStage";
  stage.setAttribute("aria-label", "stage × layer × rank 平面");
  const world = el("div", "crop-world");
  world.id = "cropWorld";

  /* 两条量尺 + 它们交汇的那个角。三块都贴在画布边上、盖在世界之上，内容由
     renderRulers 按屏幕坐标铺（不进 transform，字号才不随缩放变）。 */
  const rulerTop = el("div", "crop-ruler crop-ruler--top");
  rulerTop.setAttribute("aria-label", "PP 与 Layer 位置尺");
  const rulerLeft = el("div", "crop-ruler crop-ruler--left");
  rulerLeft.setAttribute("aria-label", "数据并行副本位置尺");
  const rulerCorner = el("div", "crop-ruler__corner");

  const tools = el("div", "crop-tools");
  const mkTool = (title, svg) => {
    const b = el("button", "btn btn-icon btn-ghost btn-sm");
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = svg;
    return b;
  };
  const ICON_MINUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"></path></svg>';
  const ICON_PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';
  const zoomOut = mkTool("缩小", ICON_MINUS);
  const zoomIn = mkTool("放大", ICON_PLUS);
  const readout = el("span", "crop-tools__readout", "100%");
  const fitBtn = el("button", "btn btn-sm btn-ghost", "适配");
  fitBtn.type = "button";
  fitBtn.title = "把整幅平面缩放到刚好放进画布";

  /* 粒度开关（LOD）：自动 / 卡 / 整机。与缩放同处右下角 —— LOD 本来就是缩放的
     一部分，只是必须能**手动锁死**：自动切档时用户往往正在逐张比对某几张卡，
     图形在脚下换一套单位是最难受的一种「聪明」。
     整机档在这组配置下不成立时按钮置灰，悬浮说明为什么（见 syncUnitButtons）。 */
  const unitTabs = el("div", "segmented-control segmented-control-muted crop-units");
  unitTabs.setAttribute("role", "group");
  unitTabs.setAttribute("aria-label", "画布粒度");
  /* 名字带上「视角」二字：「卡 / 整机」两个字单看像是在选一个**对象**（哪张卡、
     哪台机器），而这一组换的是**整幅图按什么单位画**。「自适应」同理，比「自动」
     说清了它自动的是什么 —— 跟着缩放自适应地在两个视角之间切。 */
  [["auto", "自适应"], ["rank", "Rank 视角"], ["node", "整机视角"]].forEach(([id, label]) => {
    const b = el("button", `btn btn-sm${id === "auto" ? " is-selected" : ""}`, label);
    b.type = "button";
    b.dataset.unit = id;
    unitTabs.appendChild(b);
  });
  unitTabs.addEventListener("click", (event) => {
    const b = event.target.closest("[data-unit]");
    if (!b || b.disabled) return;
    unitMode = b.dataset.unit;
    scheduleRender();
  });

  /* 专家着色开关。默认开 —— 那是这幅图的主要读法（同色一块 = 一整套专家）；
     但它同时也是最占视觉带宽的一层，比对高亮、看 PP 分段时关掉更清爽，
     所以给一枚常驻开关而不是藏进设置。 */
  /* 名字写全：「专家着色」四个字读起来像「给专家上色」（一个专家一个色），
     而它其实是「一整套专家一个色」—— 着色的单位是**一套**，那正是这幅图要人
     一眼看出的分块。名字里带上单位，开关就不必靠悬浮提示才说得清。 */
  const paintBtn = el("button", "btn btn-sm crop-paint is-selected", "按完整一套专家区分着色");
  paintBtn.type = "button";
  paintBtn.setAttribute("aria-pressed", "true");
  paintBtn.title = "同色的一块 = 一整套专家（一个 MoE 层 × 一个副本）。关掉则只留结构与高亮。";
  paintBtn.addEventListener("click", () => {
    paintExperts = !paintExperts;
    paintBtn.classList.toggle("is-selected", paintExperts);
    paintBtn.setAttribute("aria-pressed", String(paintExperts));
    scheduleRender();
  });

  /* TP 是 rank 行之间的关系，开关因此只在 Rank 视角有实际画面；切到整机视角时
     暂时禁用但保留偏好，回到 Rank 视角会恢复。按钮沿用设计系统的 btn.is-selected。 */
  const tpBtn = el("button", "btn btn-sm crop-tp-toggle is-selected", "TP 分组");
  tpBtn.type = "button";
  tpBtn.setAttribute("aria-pressed", "true");
  tpBtn.addEventListener("click", () => {
    if (tpBtn.disabled) return;
    tpGroupsVisible = !tpGroupsVisible;
    tpBtn.classList.toggle("is-selected", tpGroupsVisible);
    tpBtn.setAttribute("aria-pressed", String(tpGroupsVisible));
    scheduleRender();
  });

  tools.append(tpBtn, paintBtn, unitTabs, zoomOut, readout, zoomIn, fitBtn);
  stage.append(world, rulerTop, rulerLeft, rulerCorner, tools);

  /* ── 右栏：选中详情 ── */
  /* 默认把静息态的「当前配置评估」收起，把宽度先还给主画布；用户点中具体对象时，
     cro:select 仍会按原逻辑自动展开详情栏。 */
  const right = el("aside", "crop-right is-collapsed");
  right.id = "cropRight";
  right.setAttribute("aria-label", "选中对象详情");
  const rightHead = el("div", "crop-right__head");
  const rightTitle = el("h2", "crop-right__title", "未选中");
  const rightClose = el("button", "btn btn-icon btn-ghost btn-sm");
  rightClose.type = "button";
  rightClose.title = "收起详情栏";
  rightClose.setAttribute("aria-label", "收起详情栏");
  rightClose.innerHTML = leftClose.innerHTML;
  rightHead.append(rightTitle, rightClose);
  const rightBody = el("div", "crop-right__body");
  const rightFacts = el("div", "crop-facts");
  rightBody.appendChild(rightFacts);
  right.append(rightHead, rightBody);

  // 单卡容量与典型 Layer 是原版就有的两块，整块搬来（id / 监听器不变）
  if (capacity) rightBody.appendChild(capacity);
  if (structureSec) rightBody.appendChild(structureSec);

  /* ── 离屏引擎区 ── */
  const engine = el("div", "crop-engine");
  engine.id = "cropEngine";
  engine.setAttribute("aria-hidden", "true");
  if (layerNavSec) engine.appendChild(layerNavSec);
  if (clusterGrid) engine.appendChild(clusterGrid);
  if (sharedSec) engine.appendChild(sharedSec);
  if (routedSec) engine.appendChild(routedSec);

  /* ── 中栏外壳：三档观测模式 ──────────────────────────────────────────────
     画布不再是中栏的全部：它是「配置寻优」这一档的内容。另两档（通信观测 /
     负载热力）问的是同一份配置的另外两个侧面，共用同一栏、同一份 topology：

       配置寻优  这份配置切成什么形状 —— stage × layer × rank × 专家 的平面
       通信观测  这份配置跑一个 step 会发生哪些跨卡通信、谁和谁、多大范围
       负载热力  同一幅平面按某个度量上色（内存 / 计算 / 空闲 / 通信）

     三档做成中栏自己的页签而不是顶栏的第四档：顶栏那三枚（关系视图 / YAML /
     文档）换的是**整块板面**（左栏内容跟着换），而这三档换的只有中栏 —— 左边那
     份配置表单、右边那份选中详情，在三档里读的都是同一个东西。 */
  const center = el("div", "crop-center");
  center.id = "cropCenter";
  center.dataset.mode = "config";

  const modeTabs = el("div", "tab-control crop-modes");
  modeTabs.id = "cropModes";
  modeTabs.setAttribute("role", "tablist");
  modeTabs.setAttribute("aria-label", "中栏观测模式");
  [
    ["config", "配置寻优", "这份配置切成什么形状：stage × layer × rank × 专家"],
    ["comm", "运行观测", "跑一个 step 会发生哪些跨卡通信：谁和谁、多大范围、走哪条链路"],
    ["heat", "负载热力", "同一幅平面按某个度量上色"],
  ].forEach(([id, label, tip], i) => {
    const btn = el("button", `tab-control-item${i === 0 ? " is-selected" : ""}`, label);
    btn.type = "button";
    btn.dataset.mode = id;
    btn.title = tip;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
    modeTabs.appendChild(btn);
  });

  /* ══ 通信观测档 ══════════════════════════════════════════════════════════
     这一档回答的是「这份配置跑一个 step，卡与卡之间实际发生了什么」。它不是一张
     新图，而是把并行配置**翻译**成通信事件序列 —— 每一条都由当前 counts 现算：
     组大小、组内成员的 rank 步长、跨不跨机器边界，全部随左栏拨动实时变。

     为什么值得单列一档：并行维度在配置表单里是五个数字，它们真正的代价要到通信
     里才显形 —— TP=2 的 All-Reduce 落在机内 HCCS 上几乎不要钱，同一个 TP=2 若被
     摆得跨了机器边界就要走 RDMA，慢一个数量级。这一档就是把「切法」与「链路」
     摆在同一屏上看。 */
  /* 三档链路的图例。名字与 commLink 返回的 label 同源，改一处即可。
     ⚠️ 声明必须留在这一段（DOM 组装）**之前** —— 下面那圈 forEach 是模块加载时
     就跑的，放到 renderComm 旁边会撞 const 的 TDZ。 */
  const COMM_LINKS = [["local", "机内 HCCS"], ["mixed", "机内 + 机间"], ["inter", "机间 RDMA"]];

  const comm = el("div", "crop-comm");
  comm.id = "cropComm";
  comm.setAttribute("aria-label", "运行观测");

  const commBar = el("div", "crop-comm__bar");
  const commPlay = el("button", "btn btn-icon crop-comm__play");
  commPlay.type = "button";
  commPlay.disabled = true;               // 有事件可播才亮，由 renderComm 现写
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"></path></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"></path></svg>';
  const FLOW_PLAY_TIP = "逐层播放：跟着一个 micro-batch 从 Emb 一路走到 Head，"
    + "每到一层演一遍它的跨卡通信；走到段尾交给下一段行号相同的那张卡。"
    + "一个 step 走完自动从头再来，按一下暂停";
  commPlay.title = FLOW_PLAY_TIP;
  commPlay.setAttribute("aria-label", "逐层播放");
  commPlay.innerHTML = ICON_PLAY;
  /* 播放键右边不再摆两行文字（标题 + 一句现写的读数）：那两行说的东西浮卡里都
     有，却常驻占着一整条带子的高度。换成一条**进度带** —— 与 training-monitoring-v2
     的 L2 阶段带（.tw-pano__phases）同一副语言：蓝色从左往右涨，斜线是还没走到的
     部分，进行中的那一段在交界处补一道竖线，段名上写着当前演到哪一层。
     它同时是选择器：点哪一段就从那一段开演。 */
  const commPhases = el("div", "crop-comm__phases");
  commPhases.setAttribute("role", "group");
  commPhases.setAttribute("aria-label", "一个 step 的三个阶段");

  /* 链路图例：事件条的底色染的就是这三档，颜色的意思必须和被上色的东西同屏。 */
  const commLegend = el("div", "crop-comm__legend");
  commLegend.setAttribute("aria-label", "链路图例");
  COMM_LINKS.forEach(([kind, label]) => {
    const item = el("span", "crop-comm__legend-item");
    item.dataset.link = kind;
    item.appendChild(el("span", "crop-comm__legend-swatch"));
    item.appendChild(el("span", null, label));
    commLegend.appendChild(item);
  });

  /* 图例不摆在这条带子里，而是并到页签那一行的最右端（与热力档的色阶图例同一
     位置）：它是这一档的**常量**（三档链路各是什么颜色），不随播放变；摆在带子里
     会和进度带抢那条本该整条留给"现在演到哪"的横向空间。 */
  const commExtra = el("div", "crop-comm-extra");
  commExtra.appendChild(commLegend);

  commBar.append(commPlay, commPhases);

  const commRows = el("div", "crop-comm__rows");
  /* 「点上面任意一条」那句提示留在带子里（它说的是带子的用法），而**详情卡浮到
     画布左下角** —— 它是一条一条看的东西，跟着带子长在上面就要顶着画布往下压，
     每点一条画布矮一截。浮卡不占布局高度，量尺与格子的可视区因此恒定。 */
  const commHint = el("p", "crop-comm__empty");
  comm.append(commBar, commRows, commHint);

  /* ── 画布顶上那条红横幅：这张图现在说的是什么问题 ────────────────────────
     热力图有个通病：颜色铺得再准，读的人第一眼只看得出「这里比较烫」，看不出
     「烫的是什么毛病」。而这一档每个度量都埋了一处构造好的典型故障（见 buildHeat
     的 FAULT），横幅要做的就是把那句结论直接摆在画布顶上 —— 先给答案，再让人回到
     图上去找那条带子，而不是反过来让人猜。

     摆位与做法：
       · 压在画布上、悬浮，不占布局高度 —— 占了就等于每进一次热力档画布矮一截；
       · 让开顶上那条量尺（top = RULER_TOP_H + 一点间距），不挡刻度；
       · pointer-events:none —— 它是一层注解，不是一个可点的东西，底下的格子照常
         悬浮出气泡、照常点得中。所以也不给关闭键：没有可点的东西要关。 */
  const heatBanner = el("div", "crop-heatbanner");
  heatBanner.hidden = true;
  heatBanner.setAttribute("role", "status");
  const heatBannerTag = el("span", "crop-heatbanner__tag", "本图的问题");
  const heatBannerText = el("span", "crop-heatbanner__text");
  const heatBannerLead = el("div", "crop-heatbanner__lead");
  heatBannerLead.append(heatBannerTag, heatBannerText);

  /* ── 「专家负载」那一档：横幅下面再铺一条四段相位条 ────────────────────────
     另五个度量的故障是**一句话**说得完的静态事实，横幅一行就够；这一档不同 ——
     它讲的是一条有先后的因果链（正常 → 走偏 → 越界 → 塌缩），而链条里最该被看见
     的是 ② 与 ③ 在图上**长得一样**、④ 才突然变形。一次只显示当前那一相（原先工具
     带右侧那块读数就是这么做的），读的人得靠记忆把四相接起来，也就再也读不出
     「② 和 ③ 同形」这件事。

     所以改成四段一口气铺开、按时间轴分步高亮：走过的置灰、当前的亮起、没到的
     压暗 —— 进度与因果同框，横幅本身就成了这根时间轴的图例。工具带那侧因此不再
     重复一份读数（step 号并进下面这行 lead）。 */
  const heatBannerPhases = el("div", "crop-heatbanner__phases");
  const heatBannerPhaseEls = ROUTE_PHASES.map((p, i) => {
    const seg = el("div", "crop-heatbanner__phase");
    /* 序号与相位名拆成两截：css 把这一段排成两列网格（序号一列、文字一列），
       下面那行正文落在**文字**那一列里 —— 与「正常路由」对齐，而不是与「①」对齐。
       挂在序号左边的那一竖列数字于是自己成一条对齐线，四段扫下来一眼看得出顺序。 */
    const cut = p.tag.indexOf(" ");
    const segNum = el("span", "crop-heatbanner__phase-num", cut > 0 ? p.tag.slice(0, cut) : "");
    const segTag = el("span", "crop-heatbanner__phase-tag", cut > 0 ? p.tag.slice(cut + 1) : p.tag);
    /* 正文一行两截：这一相**跨了哪几个 step** + 那一刻的数值口径。step 范围不是
       补充说明 —— 前三相跨了四千多步、后两相全挤在事故步那一步之内，四段并排时
       这个「不等宽的时间」正是最该被看见的东西（轴上只写得下首尾两个 step 号）。 */
    const segBody = el("div", "crop-heatbanner__phase-body");
    const segSteps = el("span", "crop-heatbanner__phase-steps", routePhaseSteps(i));
    const segClock = el("span", "crop-heatbanner__phase-clock", p.clock);
    segBody.append(segSteps, segClock);
    seg.append(segNum, segTag, segBody);
    heatBannerPhases.appendChild(seg);
    return { seg, clock: segClock };
  });

  heatBanner.append(heatBannerLead, heatBannerPhases);
  stage.appendChild(heatBanner);

  const commDetail = el("div", "crop-comm__detail");
  commDetail.hidden = true;
  commDetail.setAttribute("aria-label", "运行详解");
  /* 运行观测的详解与配置寻优的「当前配置评估」共用右栏位置；切档时只换内容，
     不再把详解作为浮卡压在画布左下角。 */
  rightBody.appendChild(commDetail);

  const heatDetail = el("div", "crop-heat-detail");
  heatDetail.hidden = true;
  heatDetail.setAttribute("aria-label", "负载格子详情");
  rightBody.appendChild(heatDetail);

  /* 通信连线层：一张盖在世界之上的 svg，坐标是**屏幕坐标**（与两条量尺同一套
     算法：world→screen 自己换算），所以线宽与动点不随缩放糊掉，缩放平移时线跟着
     格子走。插在量尺**之前** —— 线该被量尺压住，而不是画到刻度上面去。 */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const commFlow = doc.createElementNS(SVG_NS, "svg");
  commFlow.setAttribute("class", "crop-commflow");
  commFlow.setAttribute("aria-hidden", "true");
  stage.insertBefore(commFlow, rulerTop);

  /* ══ 负载热力档 ══════════════════════════════════════════════════════════
     这一档**不换图**：横轴仍是层、纵轴仍是卡，换的只是格子的颜色 —— 从「这一片
     属于哪一套专家」换成「这一格有多重」。交叉处那一格因此答的是一个具体问题：
     这张卡在这一层上，内存 / 计算 / 空闲 / 通信各占多少。

     不另起一幅图是有意的：热力最该回答的是「热落在哪」，而「哪」正是配置寻优那
     幅平面已经建好的坐标（stage 分块、EDP 副本分组、整机成行）。换一幅新图就要
     让人重新找一遍位置，那时颜色再准也读不出所以然。

     这一条带子与三档页签（modeTabs）合成同一行：选哪个度量（胶囊）、颜色对应
     多少（图例）都摆在页签右边，只在「负载热力」这一档亮起（.crop-heat-extra 由
     css 按 data-mode 显隐）；每个度量的解释与「这套数怎么来的」不再逐个悬浮 /
     常驻一整条，收进这一行最右侧那枚「?」的悬浮气泡（复用 config-relation-
     observer.js 的 cro-hint 机制，HEAT_HINT_TEXT 已在上面拼好）。 */
  const heatPills = el("div", "crop-heat__pills");
  heatPills.setAttribute("role", "group");
  heatPills.setAttribute("aria-label", "热力度量");
  HEAT_METRICS.forEach((m) => {
    const b = el("button", `btn btn-sm crop-heat__pill${m.id === heatMetric ? " is-selected" : ""}`, m.label);
    b.type = "button";
    b.dataset.metric = m.id;
    b.setAttribute("aria-pressed", String(m.id === heatMetric));
    heatPills.appendChild(b);
  });

  /* 图例不是装饰：一幅热力图的颜色只有配上「两端各是多少」才读得出量级，而两端
     随配置与度量一起变（换个度量连单位都不同），所以它必须每次现写。 */
  const heatLegend = el("div", "crop-heat__legend");
  const heatLegendLo = el("span", "crop-heat__legend-end", "—");
  const heatLegendRamp = el("span", "crop-heat__legend-ramp");
  heatLegendRamp.style.background = HEAT_RAMP_CSS;
  heatLegendRamp.setAttribute("aria-hidden", "true");
  const heatLegendHi = el("span", "crop-heat__legend-end", "—");
  heatLegend.append(heatLegendLo, heatLegendRamp, heatLegendHi);

  /* 最右侧那枚「?」：五个度量各是什么 + 这套数怎么算出来的，合并成一枚悬浮气泡。
     class 用 .cro-hint 而不是自己另起一套——document 上已经挂好了那整套悬浮 /
     聚焦 / 触屏点击开合的委托监听（config-relation-observer.js 的 installHints），
     data-hint 一挂就接上，点它也不会误清空当前选择（那套监听在 SELECTABLE 判定
     之前就先放行了 .cro-hint）。 */
  const heatHelp = el("button", "cro-hint crop-heat__help", "?");
  heatHelp.type = "button";
  heatHelp.dataset.hint = HEAT_HINT_TEXT;
  heatHelp.setAttribute("aria-label", "热力度量说明");
  heatHelp.setAttribute("aria-expanded", "false");

  /* 两条竖线分隔符：页签｜胶囊｜图例三段各自成组，一眼看出这不是同一类控件的
     延续。纯装饰，键盘与朗读设备都该跳过它。 */
  const heatDivider1 = el("span", "crop-toolbar__divider");
  heatDivider1.setAttribute("aria-hidden", "true");
  const heatDivider2 = el("span", "crop-toolbar__divider");
  heatDivider2.setAttribute("aria-hidden", "true");

  /* 胶囊 + 图例 + 分隔线 + 问号，合在一个子容器里：显隐只需切这一个容器的
     display（css 按 .crop-center[data-mode="heat"] 判），不必逐个元素写。 */
  /* ── 「专家负载」那一档多出来的时间轴 ────────────────────────────────────
     另外五个度量是一份配置的静态侧面，拖不动；这一档答的是「路由**这会儿**偏成
     什么样」，所以给它一根轴：播放键 + 滑杆 + 一行现写的相位读数。

     它与运行事件 2.5 的机制图（config-relation-observer.js 的 router-collapse
     四相）读同一份剧本，但那边演的是**一层的扇出**、这边铺的是**整幅平面** ——
     两个视角互为补充：机制图说「为什么会塌」，这幅图说「塌下来的时候，2048 张卡
     上看见的是什么形状」。

     只在这一档露面（css 按 .crop-heat-extra[data-metric="route"] 判）：另五个度量
     下摆着一根拖了没反应的滑杆，比没有更糟。 */
  const routeWrap = el("div", "crop-heat__route");
  routeWrap.setAttribute("role", "group");
  routeWrap.setAttribute("aria-label", "路由塌缩时间轴");

  const routePlay = el("button", "btn btn-icon btn-sm crop-heat__routeplay");
  routePlay.type = "button";
  /* 切进这一档已经自动演过一遍，所以这枚键的正职是**重播 / 暂停**，不是「开始」 */
  routePlay.title = `重播 / 暂停：step ${ROUTE_STEP_FROM} 演到 step ${ROUTE_STEP_TO}`
    + " —— 前一段偏斜是慢性的（跨四千多步），最后那一跳全发生在事故步那一步之内";
  routePlay.setAttribute("aria-label", "重播路由塌缩");
  routePlay.innerHTML = ICON_PLAY;

  const routeSlider = doc.createElement("input");
  routeSlider.type = "range";
  routeSlider.className = "crop-heat__routeslider";
  routeSlider.min = "0";
  routeSlider.max = "100";
  routeSlider.step = "1";
  routeSlider.value = "0";
  routeSlider.setAttribute("aria-label",
    `路由塌缩进程：step ${ROUTE_STEP_FROM} 到 step ${ROUTE_STEP_TO}`);

  /* 滑杆两端写死 step 号 —— 一根拖得动的轴，第一个要答的问题是「这是多长的一段
     时间」。不写的话它旁边最近的那个数字是色阶图例的热端（那个「7.87×」说的是
     颜色对应多少倍均分，与时间毫无关系），紧挨着摆在一起就会被读成轴的刻度。
     两端不是装饰性的起止点：左端 11003 是慢性偏斜开始爬坡的那一步，右端 15203
     是问题一的事故步 —— 与 twin 时光机、日志抽屉、rank 泳道钉的是同一个数。 */
  const routeFrom = el("span", "crop-heat__routeend", `step ${ROUTE_STEP_FROM}`);
  const routeTo = el("span", "crop-heat__routeend", `step ${ROUTE_STEP_TO}`);

  /* ⚠️ 滑杆右侧原先还有一块「当前相位 + step + 数值口径」的读数，已经删掉 ——
     画布顶上那条红横幅现在把四相一口气铺开、按进度高亮（见 heatBannerPhases），
     两处说的是同一件事，而横幅那份还多出前后文。同一个读数摆两遍，读的人第一个
     反应是「这两块有什么不一样」，那是白付的注意力。当前 step 并进横幅的 lead 行。 */
  const heatDivider3 = el("span", "crop-toolbar__divider");
  heatDivider3.setAttribute("aria-hidden", "true");
  routeWrap.append(heatDivider3, routePlay, routeFrom, routeSlider, routeTo);

  const heatExtra = el("div", "crop-heat-extra");
  heatExtra.dataset.metric = heatMetric;
  heatExtra.append(heatDivider1, heatPills, heatDivider2, heatLegend, routeWrap, heatHelp);

  /* 通信观测档的**口径**写在页签右边：这一档整趟行程只跟一张卡走（默认第一行那
     张），它是一个选择而不是事实 —— 不说出来，用户会把"这一行"读成"整个集群都这么
     通信"。摆在页签旁而不是带子里：它说的是这一档在数什么，不随播放变。 */
  const commNote = el("span", "crop-comm-note",
    "默认以第一行的单个 rank 作为通信故事主角，可手动切换");

  /* 页签与热力工具合成一行：三档页签始终在，热力那半只在选中「负载热力」时
     露出来（css 控制），画布拿回了原先被独立一整条工具带占掉的高度。 */
  const toolbar = el("div", "crop-toolbar");
  toolbar.id = "cropToolbar";
  toolbar.append(modeTabs, commNote, heatExtra, commExtra);

  center.append(comm, stage);

  /* 页签工具栏提升为整块内容区的第一行；三栏都从第二行开始。 */
  board.prepend(toolbar, left, center, right, engine);
  board.classList.add("is-plane");
  board.dataset.mode = "config";

  /* 用户**主动**收起右栏之后，再选中别的东西不该把它顶回来 —— 收起是一次表态，
     不是一次临时状态。只有再点开关（或收起键旁那枚）才解除。 */
  let rightPinnedClosed = false;
  // 顶栏那两枚面板开关的按下态同步器，由下面那个 IIFE 填上（setMode 也要用）
  let syncPanelButtons = () => {};

  /* 顶栏右侧补两枚面板开关（与 pic/新视图.png 右上角那两枚同位）：
     左栏 / 右栏各一枚，摆在主题键之前。 */
  (() => {
    const host = doc.querySelector(".pto-ide-frame__window-actions");
    if (!host) return;
    const mk = (title, side) => {
      const b = el("button", "pto-ide-frame__window-action");
      b.type = "button";
      b.title = title;
      b.setAttribute("aria-label", title);
      b.setAttribute("aria-pressed", "true");
      b.innerHTML = `<svg class="pto-ide-frame__window-icon" viewBox="0 0 24 24" aria-hidden="true">`
        + `<rect x="3" y="4" width="18" height="16" rx="2"></rect>`
        + (side === "left" ? `<path d="M9 4v16"></path>` : `<path d="M15 4v16"></path>`)
        + `</svg>`;
      return b;
    };
    const lb = mk("显示 / 收起配置栏", "left");
    const rb = mk("显示 / 收起详情栏", "right");
    host.prepend(lb, rb);
    const sync = () => {
      lb.setAttribute("aria-pressed", String(!left.classList.contains("is-collapsed")));
      rb.setAttribute("aria-pressed", String(!right.classList.contains("is-collapsed")));
    };
    // 别处（setMode）也会收放这两栏，那两枚键的按下态得跟着走
    syncPanelButtons = sync;
    lb.addEventListener("click", () => { left.classList.toggle("is-collapsed"); sync(); scheduleRender(); });
    rb.addEventListener("click", () => {
      right.classList.toggle("is-collapsed");
      rightPinnedClosed = right.classList.contains("is-collapsed");
      sync(); scheduleRender();
    });
    leftClose.addEventListener("click", () => { left.classList.add("is-collapsed"); sync(); scheduleRender(); });
    rightClose.addEventListener("click", () => {
      right.classList.add("is-collapsed");
      rightPinnedClosed = true;
      sync(); scheduleRender();
    });
    sync();
  })();

  /* ══ 二、左栏三档 ════════════════════════════════════════════════════════ */
  function setPane(pane) {
    left.dataset.pane = pane;
    tabs.querySelectorAll("[data-pane]").forEach((btn) => {
      const on = btn.dataset.pane === pane;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-selected", String(on));
    });
  }

  function clickViewTab(view) {
    viewTabs?.querySelector(`[data-observer-view="${view}"]`)?.click();
  }

  tabs.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-pane]");
    if (!btn) return;
    const pane = btn.dataset.pane;
    setPane(pane);
    // 代码档 = 顶栏的「YAML 视图」；另两档回到「关系视图」。开关只有一处。
    clickViewTab(pane === "code" ? "yaml" : "relation");
    if (pane === "net") global.requestAnimationFrame(() => global.croDeckController?.fit?.());
    scheduleRender();
  });

  // 顶栏三档也可能被直接点（或深链接切过去）：让左栏页签跟着它走，别对不上
  viewTabs?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-observer-view]");
    if (!btn) return;
    const view = btn.dataset.observerView;
    if (view === "yaml") setPane("code");
    else if (left.dataset.pane === "code") setPane("form");
    scheduleRender();
  });

  /* ══ 三、画布状态 ════════════════════════════════════════════════════════ */
  let topology = null;
  let relation = null;
  let layout = null;
  let view = { x: 0, y: 0, k: 1 };
  let fitted = false;
  let frame = 0;
  let softTimer = 0;      // 交互期节流的 trailing 定时器，见 scheduleRenderSoft()
  let lastRenderAt = 0;   // 上一次真正铺完节点的时刻，leading 那一半按它判
  /* 重绘代数。render() 每次都是 world.replaceChildren(frag) —— 一整批新节点，旧的
     全部脱离文档。凡是**攥着格内某个节点**的地方（连线的格内落点缓存、计算流动那
     一圈类名）都要认得出「我手上这批已经不在文档里了」，靠比这个数，比逐个
     isConnected 便宜、也比每帧重查一遍稳。 */
  let renderGen = 0;
  /* 粒度（LOD）：auto = 跟着缩放自动切，rank / node = 手动锁死。开关在右下角。
     为什么值得有这一档 —— node 是这幅图里唯一一个**物理**单位（其余 stage / DP /
     EP / TP / CP 全是逻辑切法）：它就是机房里那台服务器，8 张卡由机内互联
     （HCCS）连着，出了这个边界就得走网络（RDMA），慢一个数量级。所以「机器边界
     切断了哪根通信轴」这件事只有在整机粒度上才画得出来，而这恰好是排查慢 / hang
     时最先要问的。卡多了之后它顺带还压掉 8 倍的行数。 */
  let unitMode = "auto";
  let paintExperts = true;   // 「专家着色」开关，见右下角那枚按钮
  let tpGroupsVisible = true;
  let lastUnit = "rank";     // auto 档的迟滞值，见 currentUnit()

  /* 两枚实测探针：列宽要按**真正会画出来的那串标签**定，不能拍脑袋写死。
     探针挂在 stage（未缩放）下，量到的就是 scale=1 时的像素宽；它们各自带着与
     真元素完全相同的 class，字体 / 内衬 / 圆角因此一定一致。 */
  const probeChip = el("span", "crop-expert crop-probe");
  const probeLabel = el("span", "crop-probe crop-probe--label");
  stage.append(probeChip, probeLabel);

  function measure(node, text) {
    node.textContent = text;
    return Math.ceil(node.getBoundingClientRect().width);
  }

  /* 胶囊的高度也得实测，不能照抄 css 里那个 14px：行高按它算，css 一改字号
     行高就该跟着走（与列宽按 measure() 走是同一条理由）。 */
  function measureH(node, text) {
    node.textContent = text;
    return Math.ceil(node.getBoundingClientRect().height) || 14;
  }

  /* ── 量尺上的刻度密度 ────────────────────────────────────────────────────
     一格在屏幕上不足 minPx 时，就每隔 n 格才标一次；n 走 1 / 2 / 5 / 10 / 20…
     这个梯子（与地图、时间轴上的刻度同一套做法），不用任意整数 —— 刻度间隔本身
     要是个好读的数，否则「每 7 层标一次」比不标还费解。 */
  function niceStep(unitPx, minPx) {
    if (!(unitPx > 0)) return 1;
    let step = 1;
    const ladder = [1, 2, 5];
    let decade = 1;
    let i = 0;
    while (step * unitPx < minPx && step < 100000) {
      i += 1;
      if (i % 3 === 0) decade *= 10;
      step = ladder[i % 3] * decade;
    }
    return step;
  }

  /* 一次布局解算：把 topology 换成「哪些列、哪些行、各在世界坐标的哪儿」。
     行是**一个 stage 内**的 rank 序（ranksPerStage 行），不是全量 rank ——
     同一行在不同 stage 块上是不同的卡，这正是 PP 的几何：一段流水线一套卡。 */
  function buildLayout(t) {
    const c = t.counts;
    const rpn = Math.max(1, c.ranksPerNode || 1);

    /* ── 整机（node）能不能当一档粒度 ──────────────────────────────────────
       一个 node 是连号的整机卡数张卡（nodeOfRank = ⌊rank / 整机卡数⌋，而整机卡数
       是硬件事实、不可调）。要让它在这幅平面上恰好等于「同一个 stage 块里连续的
       8 行」，就得保证一个 node 不会骑在两个 EDP 副本之间 —— 即 ranksPerDp 能被
       整机卡数整除。ranksPerStage = edp × ranksPerDp，所以这一条成立时「不跨
       stage」自动也成立。
       除不尽的小配置（qwen2-7b 默认 ep1 / tp1 / cp1 → ranksPerDp = 1）不给这一档：
       宁可停在卡粒度，也不画一个「看着是一台机器、其实横跨两个副本」的格子 ——
       聚合视图一旦开始说谎，就比不聚合更糟。 */
    const nodeAllowed = rpn > 1 && c.ranksPerDp % rpn === 0;

    /* ── 列：Emb / 每一层 / Norm / Head ────────────────────────────────────
       只画「层」是不完整的：Emb、Final Norm、LM Head 不是层，却实实在在驻留在
       首 / 末那一段 PP 的卡上 —— 不画它们，首末两段的卡就凭空少了一块内容。
       它们与主脚本 structureColumns 里那三个端点列同名（emb / norm / head），
       点击发的也是同一种 payload（kind:"segment" + wholeColumn），于是右栏、
       典型 Layer、整网 deck 的联动全都照旧。 */
    const cols = [];
    t.stages.forEach((entry) => {
      const list = [];
      if (entry.stage === 0) {
        list.push({ type: "unit", id: "emb", label: "Emb", stage: entry.stage });
      }
      for (let l = entry.lo; l <= entry.hi; l += 1) {
        const info = t.layers[l];
        const moe = Boolean(info && info.ffn === "moe");
        list.push({
          type: "layer", layer: l, moe, stage: entry.stage,
          label: `Layer${l} · ${moe ? "MoE" : "Dense"}`,
          short: `L${l}`,
        });
      }
      if (entry.stage === t.stages.length - 1) {
        list.push({ type: "unit", id: "norm", label: "Norm", stage: entry.stage });
        list.push({ type: "unit", id: "head", label: "Head", stage: entry.stage });
      }
      cols.push(list);
    });

    /* ── 列宽与行高 ────────────────────────────────────────────────────────
       列宽的两个下界一起管：
         · 专家标签 —— MoE 层的格子里要摆下这张卡持有的那几个专家编号，编号最长
           到 routedExpert-1。写死 30px 的后果是标签被折成「+N」，而那正好丢掉了
           这幅图最值钱的一条信息。每卡专家数 ≤ EXPERT_CHIP_MAX（= 4 列 × 8 行）
           就逐个铺，宽度封顶、多出来的往下折行；再多就整格交给颜色。
         · 列名 —— 「Layer45 · Dense」这样的全名要在顶部量尺里写得下。
       两者取大，全局统一（网格错开比多几个空格更难扫）。

       ⚠️ 逐个铺的那一档**一行最多 EXPERT_COLS_MAX 枚**，多了折行：8 枚一行的
       格子有列名的两倍宽，整幅平面横着拉长一倍，扫一行卡要拖两屏。改成宽度封顶、
       高度自适应之后，横轴回到「一列 ≈ 一个层名」的尺度，多出来的专家往下长 ——
       行本来就是这幅图里更便宜的那根轴（纵向本就要滚）。
       chipsW 是**一整行胶囊**的实测宽度，连同单枚宽度一起交给 css：格子可能比它
       宽（列名更长时），限宽居中那一段在 .crop-cell[data-ffn="moe"] 里。 */
    const epr = c.expertsPerEpRank || 0;
    const maxId = Math.max(0, (c.routedExpert || 1) - 1);
    let expertMode = "none";
    let cellW = CELL_W_MIN;
    let cellH = CELL_H;
    let chipW = 0;
    let chipsW = 0;
    /* 专家网格折成几行几列。原先是这个函数里的两个局部量，现在要交出去 ——
       详情面板里那个 Expert Compute 盒子铺的是同一张网格，面板高度（panelH）
       得按同样的行数算，否则算出来的缩放比会把面板底下那条 Residual Add 截掉。 */
    let chipCols = 1;
    let chipRows = 1;
    if (t.hasMoe && epr > 0) {
      if (epr <= EXPERT_CHIP_MAX) {
        expertMode = "chips";
        chipW = measure(probeChip, `E${maxId}`);
        const chipH = measureH(probeChip, `E${maxId}`);
        chipCols = Math.min(epr, EXPERT_COLS_MAX);
        chipRows = Math.ceil(epr / chipCols);
        chipsW = chipCols * chipW + (chipCols - 1) * EXPERT_GAP;
        cellW = chipsW + CELL_PAD;
        cellH = Math.max(CELL_H, chipRows * chipH + (chipRows - 1) * EXPERT_GAP + CELL_VPAD);
      } else {
        /* 每卡专家太多，逐个铺会把格子撑成一片编号墙。这一档不铺编号、也不铺
           「E12–E27」那种区间胶囊（区间既不可点、也答不出属于哪一套），整格交给
           颜色 —— 所以列宽不必为它留任何余量，跟着列名走就行。 */
        expertMode = "range";
        cellW = CELL_W_MIN;
      }
    }
    /* 列名在顶部量尺里是**两行**（"Layer45" / "Dense"），所以列宽只要够写下两行
       里较长的那一行就行 —— 原先按一整串 "Layer45 · Dense" 量，凭空多出快一倍的
       宽度，整幅平面也就跟着横着拉长一倍。 */
    const nameW = Math.max(
      measure(probeLabel, `Layer${Math.max(0, c.totalLayer - 1)}`),
      measure(probeLabel, "Dense"),
    ) + CELL_PAD;
    cellW = clamp(Math.ceil(Math.max(cellW, nameW)), CELL_W_MIN, CELL_W_MAX);
    cellH = Math.ceil(cellH);
    /* ── 交给 css 的两组变量（全局同值，写在 .crop-world 上而不是逐格写）──────
       ① 专家网格的列数：详情面板里那个 Expert Compute 盒子按它排 grid。
       ② 详情面板那一套**设计像素**。面板的实际高度是 css 按这些数堆出来的，而
          缩放比是 js 用 panelH() 按同样的数算出来的 —— 必须同源，差一个像素就会
          在最细那一档上截掉面板底部。
       （原先这里还写 --crop-chip-w / --crop-chips-w 两个数，用来把铺满整格的胶囊
       行限宽居中。胶囊不再直接铺在格子里，那两个变量没有对象了，一并撤掉；
       chipsW 仍然留着定列宽 —— 格子的世界尺寸这一版没有动。） */
    world.style.setProperty("--crop-chip-cols", String(chipCols));
    world.style.setProperty("--crop-d-pill", `${D_PILL_H}px`);
    world.style.setProperty("--crop-d-gap", `${D_GAP}px`);
    world.style.setProperty("--crop-d-title", `${D_TITLE_H}px`);
    world.style.setProperty("--crop-d-pad", `${D_PAD}px`);
    world.style.setProperty("--crop-d-chip", `${D_CHIP_H}px`);
    world.style.setProperty("--crop-d-res", `${D_RES_H}px`);
    world.style.setProperty("--crop-d-w", `${D_PANEL_W}px`);

    /* ── stage 块之间那条「行标道」──────────────────────────────────────────
       每个 stage 块的左边都留一条空道，行标（"rank 2047" / "整机 255"）就写在
       里面。宽度**不是常量**，也不是一个拍脑袋的下界，而是每帧按「这一帧的行标
       字号有多大」现算（见外面的 laneWorldAt）：
         · 行标的字号随缩放反向放大（屏幕上恒 ≥ ROW_FONT_MIN），道就得跟着反向变宽；
         · 行标根本画不出来的那一档，道缩回 GAP_MIN_PX —— 没有字要写就不留空地。
       这里只把算它要用的两个实测值备好：最长那串行标在探针字号下的宽度，以及
       探针自己的字号（用来把宽度按真实字号等比换算）。 */
    const maxRank = Math.max(0, (c.totalRank || 1) - 1);
    const maxNode = Math.max(0, Math.ceil((c.totalRank || 1) / rpn) - 1);
    /* 两档粒度的行标不一样长，各量各的 —— 卡粒度只写一行 "rank 2047"，整机粒度写
       两行（"整机 255" + 它含的那段 rank），后者的第二行才是最长的那一串。
       用一个全局最大值会让卡粒度那一档凭空多留一截道宽。 */
    const labelTextW = measure(probeLabel, `rank ${maxRank}`);
    const labelTextWNode = Math.max(
      measure(probeLabel, `整机 ${maxNode}`),
      measure(probeLabel, `rank ${Math.max(0, maxRank - rpn + 1)}–${maxRank}`),
    );
    const probeFontPx = parseFloat(global.getComputedStyle(probeLabel).fontSize) || 11;

    const blocks = [];
    let sumW = 0;
    t.stages.forEach((entry, i) => {
      const list = cols[i];
      const bw = Math.max(cellW, list.length * cellW);
      // x 先占位，真值由 syncX(k) 写 —— 它随缩放变
      blocks.push({ stage: entry.stage, cols: list, lo: entry.lo, hi: entry.hi, x: 0, w: bw, sumBefore: sumW });
      sumW += bw;
    });
    const rows = Math.max(1, c.ranksPerStage);

    /* ── 纵向的两级缝：副本之间 DP_GAP，副本内整机之间 NODE_GAP ───────────────
       整机缝只在整机档成立时才插（nodeAllowed）：除不尽的配置里「连续 rpn 行」
       根本不是一台机器，在那里划一条缝就是画了一个假边界。
       ⚠️ 缝一律落在**整机边界之间**，整机行内部一条不插 —— 整机行的高度因此
       仍恰好等于它那几行卡之和，切粒度时几何不动、视口不跳这条守住了。 */
    const rpnEff = nodeAllowed ? rpn : c.ranksPerDp;
    const nodeGap = nodeAllowed && c.ranksPerDp > rpn ? NODE_GAP : 0;
    const nodesPerDp = Math.max(1, Math.round(c.ranksPerDp / rpnEff));
    const nodePitch = rpnEff * cellH + nodeGap;
    const groupH = nodesPerDp * nodePitch - nodeGap;   // 一个副本自己占的高度
    const groupPitch = groupH + DP_GAP;

    function rowY(r) {
      const g = Math.floor(r / c.ranksPerDp);
      const rin = r - g * c.ranksPerDp;
      const n = Math.floor(rin / rpnEff);
      return g * groupPitch + n * nodePitch + (rin - n * rpnEff) * cellH;
    }

    const layoutOut = {
      blocks,
      rows,
      cellW,
      cellH,
      expertMode,
      /* 专家网格折成几行 —— 详情面板的高度按它算（见 panelH）。range 档不铺编号、
         盒子里只有一行「E128–E191 · 64 个」，所以那一档它是 1。 */
      chipRows: expertMode === "chips" ? chipRows : 1,
      labelTextW,
      labelTextWNode,
      probeFontPx,
      lane: 0,             // 当前这一帧的行标道宽度（世界单位），由 syncX 写
      sumW,
      nodeAllowed,
      ranksPerNode: rpn,
      ranksPerDp: c.ranksPerDp,
      ranksPerEp: c.ranksPerEp,
      ranksPerStage: c.ranksPerStage,
      edp: c.edp,
      /* 左侧量尺的两层。外层永远是「一个完整模型副本」那一格（切出 / mf 档叫
         EDP，正交档 EDP ≡ DP 就叫 DP）；内层是这个副本里的 EP 那几行。

         内层在不在，判据是 **EP > 1**，不是「EDP 与 DP 是否重名」。原先按后者判，
         正交档（EDP ≡ DP = 8）就整层塌掉：512 行只挂 8 个 DP 带子，中间那 64 行
         EP 一个标都没有 —— 而这一档恰恰是用来跟切出档对读的，一对读纵轴就瞎了。
         稠密模型（EP=1）仍然只有一层：那时副本里本来就只有一行，不造层级。

         内层写什么，两档不同，因为那几行的**身份**不同：
           切出 / mf  一行 = 表单里那个 DP 的一个成员（DP = EDP × EP）→ 写 DP 号
           正交       EP 是独立的一根轴，副本内没有"内层 DP"这回事 → 写 EP 号 */
      dpPerEdp: c.edp > 0 ? Math.round(c.dp / c.edp) : 1,
      twoLevelRow: c.ep > 1,
      innerIsDp: c.edp !== c.dp,
      groupPitch,
      groupH,
      nodePitch,
      nodesPerDp,
      worldW: sumW,        // 真值由 syncX 写（要加上 n 条行标道）
      worldH: Math.max(1, c.edp) * groupPitch - DP_GAP,
      rowY,
      rowAt: (y) => {
        const g = clamp(Math.floor(y / groupPitch), 0, Math.max(0, c.edp - 1));
        const rem = y - g * groupPitch;
        const n = clamp(Math.floor(rem / nodePitch), 0, nodesPerDp - 1);
        const i = clamp(Math.floor((rem - n * nodePitch) / cellH), 0, rpnEff - 1);
        return clamp(g * c.ranksPerDp + n * rpnEff + i, 0, rows - 1);
      },
    };

    /* 按给定的行标道宽度（世界单位）把每个块的 x 与整幅世界宽重算一遍。幂等，
       可以随便多调几次；transform 与重绘之前各调一次，两处读到的几何才是同一份。
       ⚠️ 道宽由**外面**的 laneWorldAt(k) 定，不在这里算：它要知道这一帧按什么
       粒度画（整机行 8 倍高，行标的字号与显隐都不同），而粒度是 view 那边的事。 */
    layoutOut.syncX = function syncX(laneWorld) {
      layoutOut.lane = laneWorld;
      blocks.forEach((b, i) => { b.x = laneWorld * (i + 1) + b.sumBefore; });
      layoutOut.worldW = blocks.length * laneWorld + sumW;
      return laneWorld;
    };
    return layoutOut;
  }

  /* 按 rank 粒度画，这一帧的格子数在预算之内吗（见 currentUnit 的判据 ②）。
     与 render 里那笔 wanted 的账同口径，但**故意估得偏大**：render 每个可见块的
     列区间还要各往外铺一列、行区间上下各铺一行，而且真超了预算它是整幅退成「一个
     格子都不画」。估小了的后果正是那一幕 —— 切到 rank 档、然后满屏空白，比留在
     整机档的一片颜色差得多。所以宁可晚换一档：加一圈余量，再留 15% 的富余。 */
  function rankAffordable(k) {
    if (!layout) return true;
    const v = viewport();
    const w = Math.max(1, v.x1 - v.x0);
    const h = Math.max(1, v.y1 - v.y0);
    const cols = w / Math.max(1e-6, layout.cellW * k) + 4;
    const rows = h / Math.max(1e-6, layout.cellH * k) + 2;
    return cols * rows <= CELL_BUDGET * 0.85;
  }

  /* 这一帧按什么粒度画。
     ⚠️ 整机行在世界坐标里**恰好等于它那 8 行卡的高度**，所以切粒度时几何一动
     不动、视口不跳 —— 变的只是「这 8 行合成一格，还是各画一格」。 */
  function currentUnit() {
    if (!layout || !layout.nodeAllowed) return "rank";
    if (unitMode !== "auto") return unitMode;
    /* ── 换档判据：两条，都要成立才换到 rank ──────────────────────────────
       ① 整机格子已经大到「该有内容了」（≥ BLOCK_MIN_H，与 render 里 showBands
          用的是同一个数）。整机档能给的只有一块颜色 —— 格内的两段块答的是「一张
          卡在这一层里的活」，一台机器有 span 张卡，画进机器格子里读出来是错的。
          所以它的下一档不是格内长出内容，而是换粒度：一行摊开成 span 行 rank
          格子。整机行的高度恰好是那 span 行之和，所以这个门槛换算过去就是「rank
          格子刚够 BLOCK_MIN_H / span 高」。
       ② rank 格子这一帧**铺得动**（rankAffordable）。这一条是硬的：CELL_BUDGET
          之外 render 会整幅退成「只画块底板与高亮带」，一个格子都不铺 —— 那比整机
          档的一片颜色更糟。同一片区域换成 rank 粒度是 span 倍的格子数，所以在
          cellH 大的配置上（每卡 32 个专家的格子有 139px 高），① 早就成立了、②
          还差得远，那时留在整机档是唯一还画得出东西的选择。
       缩回整机要多缩一点点（迟滞系数），免得停在阈值上来回抖。 */
    const nodeCellPx = layout.cellH * layout.ranksPerNode * view.k;
    if (nodeCellPx < BLOCK_MIN_H || !rankAffordable(view.k)) lastUnit = "node";
    else if (nodeCellPx > BLOCK_MIN_H * AUTO_NODE_HYST) lastUnit = "rank";
    return lastUnit;
  }

  /* ── 行标的度量：字号、画不画、以及道要留多宽 ──────────────────────────────
     三件事必须由**同一处**给：render 画行标、laneWorldAt 留道宽、zoomBy 算不动点，
     三边各判一次就会出现「留了道却不写字」或「写了字却没道」的错位。
     字号：屏幕上恒 ≥ ROW_FONT_MIN，所以世界字号取 ROW_FONT_MIN/k（缩多少放大
     多少），上界是这一行自己的高度 —— 装不下就说明行已经矮到没法写字，那时宁可
     不画，也不画一行认不出的蚂蚁。 */
  function rowMetrics(k) {
    const span = currentUnit() === "node" ? layout.ranksPerNode : 1;
    const rowH = layout.cellH * span;
    const want = Math.max(11, ROW_FONT_MIN / k);
    /* 整机行的行标是**两行**（"整机 12" + 它含的那段 "rank 96–103"），所以每行只
       分到半个行高。放不下就退回一行，只写整机号 —— 两行都挤成蚂蚁不如少说一句。 */
    if (span > 1) {
      const f2 = Math.min(rowH * 0.44, want);
      if (f2 * k >= ROW_FONT_MIN - 0.01) return { span, rowH, font: f2, two: true, show: true };
    }
    const font = Math.min(rowH * 0.95, want);
    return { span, rowH, font, two: false, show: font * k >= ROW_FONT_MIN - 0.01 };
  }

  /* 这一帧行标道该有多宽（世界单位）。
     画得出行标 —— 恰好够写下最长的那串再加一点余量，按**这一帧的字号**等比换算
       （字号是 ROW_FONT_MIN/k，所以道宽也跟着 1/k 走，屏幕上看是恒定的一条）；
     画不出 —— 只留 GAP_MIN_PX 的最小缝，同样折回世界单位。留一大片空地却不写字
       是这条道最没有道理的一种状态。 */
  function laneWorldAt(k) {
    if (!layout) return 0;
    const m = rowMetrics(k);
    if (!m.show) return GAP_MIN_PX / Math.max(k, 1e-6);
    // 两行那一档要按更长的那一行（rank 区间）留，卡粒度只按 "rank N" 留
    const textW = m.span > 1 ? layout.labelTextWNode : layout.labelTextW;
    const tpGutter = tpGroupsVisible && topology && topology.counts.tp > 1 && m.span === 1
      ? TP_GUTTER_PX / Math.max(k, 1e-6) : 0;
    return (textW + LANE_SLACK) * (m.font / layout.probeFontPx) + LANE_EDGE + tpGutter;
  }

  // 把几何对齐到当前缩放，返回这一帧的道宽（世界单位）
  function syncGeometry(k) {
    return layout ? layout.syncX(laneWorldAt(k)) : 0;
  }

  function syncUnitButtons(unit) {
    const allowed = Boolean(layout && layout.nodeAllowed);
    const rpn = layout ? layout.ranksPerNode : 8;
    unitTabs.querySelectorAll("[data-unit]").forEach((btn) => {
      const id = btn.dataset.unit;
      btn.classList.toggle("is-selected", id === unitMode);
      btn.setAttribute("aria-pressed", String(id === unitMode));
      const off = id === "node" && !allowed;
      btn.disabled = off;
      if (off) {
        btn.title = `这组配置不给整机视角：一台 ${rpn} 卡的机器会骑在两个副本之间`
          + `（每副本 ${layout ? layout.ranksPerDp : "?"} 卡，除不尽），聚出来的格子会说谎`;
      } else if (id === "auto") {
        btn.title = "跟着缩放自动切：Rank 格缩到看不清就聚成整机，"
          + "整机格子一旦大到该有内容就摊回 Rank 格 —— 层内那两块（Attention / "
          + "MoE）是一张卡的事，只在 Rank 视角出现"
          + `（当前正按「${unit === "node" ? "整机" : "Rank"}视角」画）`;
      } else if (id === "rank") {
        btn.title = "一行 = 一张卡（rank）";
      } else {
        btn.title = `一行 = 一台整机（${rpn} 张卡，机内走 HCCS，出了这个边界才走网络）`;
      }
    });

    const tp = topology ? Math.max(1, topology.counts.tp || 1) : 1;
    const rankView = unit === "rank";
    tpBtn.disabled = tp <= 1 || !rankView;
    tpBtn.classList.toggle("is-selected", tpGroupsVisible);
    tpBtn.setAttribute("aria-pressed", String(tpGroupsVisible));
    if (tp <= 1) tpBtn.title = "当前 TP=1，没有 TP 分组";
    else if (!rankView) tpBtn.title = `TP×${tp} 分组只在 Rank 视角显示；切回 Rank 视角后恢复`;
    else tpBtn.title = `${tpGroupsVisible ? "隐藏" : "显示"}每个 PP Stage 内的 TP×${tp} rank 分组`;
  }

  /* ── 可视区（画布减去两条量尺占的边）与平移边界 ───────────────────────── */
  function rulerLeftW() { return layout && layout.twoLevelRow ? RULER_LEFT_W2 : RULER_LEFT_W1; }

  function viewport() {
    return {
      x0: rulerLeftW(),
      y0: RULER_TOP_H,
      x1: stage.clientWidth,
      y1: stage.clientHeight,
    };
  }

  /* 无限画布也要有边界：可以拖到内容大半出屏，但不允许拖到**整片空白** ——
     那时既没有参照物、也没有回来的路（用户只能狂点「适配」）。规则是内容与可视区
     至少还留 PAN_MARGIN 的重叠。 */
  function clampView() {
    if (!layout) return;
    // 行标道随缩放变宽 → 世界宽度也随缩放变，夹取之前先对齐到当前 k
    syncGeometry(view.k);
    const v = viewport();
    const w = layout.worldW * view.k;
    const h = layout.worldH * view.k;
    view.x = clamp(view.x, v.x0 + PAN_MARGIN - w, v.x1 - PAN_MARGIN);
    view.y = clamp(view.y, v.y0 + PAN_MARGIN - h, v.y1 - PAN_MARGIN);
  }

  function applyTransform() {
    clampView();
    /* 热力选中格住在随画布缩放的 world 里，运行观测主角框住在屏幕坐标 SVG 里。
       用缩放倒数抵消 transform，二者在任何缩放级别都保持同样的 2px / 5px 线宽。 */
    world.style.setProperty("--crop-cell-focus-line", `${2 / view.k}px`);
    world.style.setProperty("--crop-cell-focus-halo", `${5 / view.k}px`);
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    readout.textContent = `${Math.round(view.k * 100)}%`;
  }

  function fit() {
    if (!layout) return;
    const v = viewport();
    const W = v.x1 - v.x0;
    const H = v.y1 - v.y0;
    if (!(W > 0 && H > 0)) return;
    const bh = layout.worldH;
    if (!(bh > 0)) return;
    const pad = 24;

    /* 横向的「适配」不是一次除法：行标道的**屏幕**宽度基本恒定（字号反向缩放），
       所以世界宽度自己也是 k 的函数 —— k 越小道在世界里越宽。
       解法是几步收敛：每步按当前 k 把几何摆好、量出真实占了多少屏幕宽，超了就按
       超出比例把 k 收一点。道的屏幕宽几乎不随 k 变，所以两步就到位；上限 4 步，
       剩那点误差顶多是边上留白多一点。 */
    const A = W - pad * 2;
    const n = layout.blocks.length;
    const kMaxV = (H - pad * 2) / bh;
    let k = clamp(Math.min((A - n * GAP_MIN_PX) / Math.max(1, layout.sumW), kMaxV),
      MIN_K, MAX_K);
    for (let i = 0; i < 4; i += 1) {
      syncGeometry(k);
      const used = layout.worldW * k;
      if (used <= A + 0.5) break;
      k = clamp(k * (A / used), MIN_K, MAX_K);
    }
    syncGeometry(k);              // 先按终值把几何摆好，再按它居中
    view.k = k;
    view.x = v.x0 + (W - layout.worldW * k) / 2;
    view.y = v.y0 + (H - bh * k) / 2;
    applyTransform();
    scheduleRender();
  }

  /* 光标左边一共隔着几条行标道 —— 即 (块序号 + 1)。
     道的**屏幕**宽度几乎不随缩放变（字号反向缩放，见 laneWorldAt），块的宽度却
     是照常缩放的，所以「屏幕坐标 = view.x + 世界坐标 × k」这条对道不成立。
     zoomBy 要按不动点算 view.x，就得先把光标前面那几条道的宽度剥出来。 */
  function lanesBefore(px, laneScreen) {
    if (!layout) return 0;
    let x = view.x;
    for (let i = 0; i < layout.blocks.length; i += 1) {
      x += laneScreen;
      if (px < x + layout.blocks[i].w * view.k) return i + 1;
      x += layout.blocks[i].w * view.k;
    }
    return layout.blocks.length;
  }

  function zoomBy(factor, cx, cy) {
    const next = clamp(view.k * factor, MIN_K, MAX_K);
    if (next === view.k) return;
    const v = viewport();
    const px = cx == null ? (v.x0 + v.x1) / 2 : cx;
    const py = cy == null ? (v.y0 + v.y1) / 2 : cy;

    /* 以光标处的**内容点**为不动点。横向不能直接套 (px - view.x) × r：那样算等于
       把行标道也当成会缩放的内容，而它的屏幕宽是恒定的 —— 每滚一格，光标后面的
       块就要横向漂过 道宽 × 道数 × (1-r)，四个 stage 时一格能漂三十几像素，
       连着滚就漂得很明显。
       所以先剥掉光标前面那几条道，只让**块内偏移**参与缩放，再按缩放后的道宽
       把它们加回去。纵向没有道，照常。 */
    const laneNow = laneWorldAt(view.k) * view.k;
    const laneNext = laneWorldAt(next) * next;
    const lanes = lanesBefore(px, laneNow);
    const packed = (px - view.x - laneNow * lanes) / view.k;   // 块内偏移（世界单位）
    view.x = px - laneNext * lanes - packed * next;
    view.y = py - (py - view.y) * (next / view.k);
    view.k = next;
    applyTransform();
    scheduleRenderSoft();
  }

  function scheduleRender() {
    if (frame) return;
    frame = global.requestAnimationFrame(() => { frame = 0; render(); });
  }

  /* 交互期（滚轮缩放、拖动平移、栏宽变化）的重绘请求走这里，见 SOFT_MIN_GAP 上面
     那段：手还在动的时候按 leading + trailing 节流，手一停补最后一次准的。
     配置变了 / 选择变了不走这条 —— 那两件事必须当帧见效，走 scheduleRender()。 */
  function scheduleRenderSoft() {
    global.clearTimeout(softTimer);
    if (global.performance.now() - lastRenderAt >= SOFT_MIN_GAP) scheduleRender();
    softTimer = global.setTimeout(() => { softTimer = 0; scheduleRender(); }, SOFT_IDLE);
  }

  /* ══ 四、两条量尺 ═══════════════════════════════════════════════════════
     顶部双层「PP | Layer」、左侧双层「EDP | DP」。它们**不跟着缩放变字号**：
     刻度是用来读位置的，字必须始终一样大、始终贴着边 —— 所以量尺里的元素按
     屏幕坐标摆（world→screen 自己换算），而不是丢进那个被 transform 的世界里。
     刻度密度也跟着缩放变（niceStep）：一格挤不下就每 2 / 5 / 10 格标一次。 */
  function renderRulers(unit) {
    const v = viewport();
    const k = view.k;
    /* ⚠️ 刻度是量尺盒子的**子元素**，它的 left/top 以量尺的左上角为原点，而下面
       算出来的 sx / sy 是画布坐标 —— 两者差着量尺自身那一格偏移。顶部量尺整体右移了
       v.x0，左侧量尺整体下移了 v.y0，写样式时必须各自减掉，否则刻度与内容错开
       正好一个量尺的宽 / 高。 */
    const offX = v.x0;
    const offY = v.y0;
    const rel = relation;
    const p = rel ? rel.primary : null;
    const c = topology.counts;
    const cellW = layout.cellW;

    rulerTop.style.left = `${v.x0}px`;
    /* 高度也由这里写：css 里那条只是兜底。刻度盒是 overflow:hidden 的，两个数
       各写各的一旦错开，第二行（MoE / Dense）就被裁掉 —— 加高 RULER_TOP_H 却
       没人同步 css，正是这样丢了一整行。 */
    rulerTop.style.height = `${RULER_TOP_H}px`;
    rulerLeft.style.top = `${v.y0}px`;
    rulerLeft.style.width = `${v.x0}px`;
    rulerCorner.style.width = `${v.x0}px`;
    rulerCorner.style.height = `${v.y0}px`;
    /* 左侧量尺的宽度是**变量**（切出档两层 92、其余一层 46），而通信详情那张浮卡
       要贴着量尺右边落。把宽度露成一个 CSS 变量，浮卡的 left 就跟着量尺走，
       不必在 css 里按最宽的那一档写死一个永远偏右的内衬。 */
    stage.style.setProperty("--crop-ruler-left", `${v.x0}px`);

    /* ── 顶部：第一层 PP stage，第二层列（Emb / Layer / Norm / Head）── */
    // 通信行程正扫在哪一列（只在通信档有值），下面每一格都要和它比一次
    const beatCol = center.dataset.mode === "comm" ? flowBeat : null;
    const topFrag = doc.createDocumentFragment();
    layout.blocks.forEach((block) => {
      const sx = view.x + block.x * k;
      const sw = block.w * k;
      if (sx + sw < v.x0 || sx > v.x1) return;

      const bar = el("div", "crop-tick crop-tick--pp", `PP Stage${block.stage}`);
      bar.dataset.kind = "stage";
      bar.dataset.stage = String(block.stage);
      bar.dataset.tip = `PP Stage${block.stage} · Layer ${block.lo}–${block.hi}`
        + `（${block.hi - block.lo + 1} 层）· ${layout.ranksPerStage} 张卡`;
      /* PP 段这一层**不跟着层 / 卡的选择变色**：选一层时它所在的段必然被牵连，
         整条段带因此几乎永远亮着，那点「被牵连」的信息量等于零，却把这一层从
         「读段边界」的刻度变成了一片跟着乱闪的底色。只有直接点中这一段本身
         （p.kind === "stage"）才给选中态。 */
      if (p && p.kind === "stage" && p.stage === block.stage) bar.classList.add("is-selected");
      // 贴边裁剪：块一半划出可视区时，标签仍停在可见的那一半里
      const cx0 = Math.max(sx, v.x0 - 1);
      const cx1 = Math.min(sx + sw, v.x1);
      bar.style.left = `${cx0 - offX}px`;
      bar.style.width = `${Math.max(0, cx1 - cx0)}px`;
      bar.style.top = "0px";
      bar.style.height = `${RULER_PP_H}px`;
      topFrag.appendChild(bar);

      const step = niceStep(cellW * k, RULER_COL_MIN);
      block.cols.forEach((col, ci) => {
        const x = view.x + (block.x + ci * cellW) * k;
        const w = cellW * k;
        if (x + w < v.x0 || x > v.x1) return;
        // 端点列（Emb / Norm / Head）永远标：它们各只有一格，跳过就等于没画
        // 更新那几拍覆盖的是整段（beat.wide），量尺上就该整段的列一起标
        const flowing = Boolean(beatCol && beatCol.stage === block.stage
          && (beatCol.wide || beatCol.ci === ci));
        // 疏刻度档下也要留住正在演的那一格：它是这一帧唯一"必须写出来"的位置
        if (col.type === "layer" && step > 1 && (col.layer % step !== 0) && !flowing) return;
        /* 全名，不简写：刻度是用来对位置的，"L0" 与 "Layer0 / MoE" 差的正是
           「这一层是 Dense 还是 MoE」——那是这一列最该先读到的一件事。
           但一行写不下 —— 列宽只有几十像素，"Layer45 · Dense" 被截掉的恰好是后
           半截那个 Dense/MoE。所以拆成**两行**：层号一行、FFN 类型一行。列宽因此
           也只需按较长的那一行留（见 buildLayout 里的 nameW），整幅平面跟着窄一截。
           ⚠️ 这一格**不挂 data-tip**：名字已经把该说的说完，气泡里剩下的那句专家
           均分口径在右栏与格子的气泡里都答得出，而横向扫这一排刻度时每划过一格
           就弹一次，是纯粹的干扰。 */
        const tick = el("div", "crop-tick crop-tick--col");
        /* 缩到列宽写不下全名时改用短名（"L3"）：一格只有几十像素，"Layer3" 被
           省略号截成 "Lay…" 之后既读不出层号、也没省下地方。短名换来的那点宽度
           正好留给第二行的 Dense/MoE —— 那是这一列更该先读到的一件事。 */
        const narrow = cellW * k < RULER_COL_MIN + 12;
        if (col.type === "layer") {
          tick.appendChild(el("span", "crop-tick__name",
            narrow ? (col.short || `L${col.layer}`) : `Layer${col.layer}`));
          tick.appendChild(el("span", "crop-tick__ffn", col.moe ? "MoE" : "Dense"));
          tick.dataset.kind = "layer";
          tick.dataset.layer = String(col.layer);
          tick.dataset.moe = col.moe ? "1" : "0";
          if (p && p.kind === "layer" && p.layer === col.layer) tick.classList.add("is-selected");
          else if (rel && rel.layers.has(col.layer)) tick.classList.add("is-related");
        } else {
          // Emb / Norm / Head 本来就是一个词，不拆行
          tick.appendChild(el("span", "crop-tick__name", col.label));
          tick.dataset.kind = "unit";
          tick.dataset.unit = col.id;
          if (p && p.kind === "segment" && p.segment === col.id) tick.classList.add("is-selected");
          else if (rel && rel.units.has(col.id)) tick.classList.add("is-related");
        }
        /* 通信行程扫到的那一列：量尺上标出来，才知道"现在演到模型的哪儿了"。
           它盖过选中/牵连两态 —— 播放期间这一格答的是"当前"，不是"你选过什么"。 */
        if (flowing) tick.classList.add("is-flowing");
        tick.style.left = `${x - offX}px`;
        tick.style.width = `${Math.max(w, step > 1 ? RULER_COL_MIN : 0)}px`;
        tick.style.top = `${RULER_PP_H}px`;
        tick.style.height = `${RULER_TOP_H - RULER_PP_H}px`;
        topFrag.appendChild(tick);
      });
    });
    rulerTop.replaceChildren(topFrag);

    /* ── 左侧：第一层 EDP 副本，第二层它对应的那段 DP 号 ── */
    const leftFrag = doc.createDocumentFragment();
    const outerW = layout.twoLevelRow ? RULER_EDP_W : v.x0;
    /* 外层的名字只看 EDP 与 DP 是否真的是两个量 —— 与「内层在不在」无关：
       正交档两层都在，外层却仍该叫 DP。 */
    const dName = layout.innerIsDp ? "EDP" : "DP";
    const rowStep = niceStep(layout.ranksPerEp * layout.cellH * k, RULER_ROW_MIN);
    /* 一段行区间在世界坐标里占多高：中间可能夹着整机缝，不能再按「行数 × 行高」
       乘出来 —— 那会让左侧量尺与内容错开，越往下差得越多。一律走 rowY 反算。 */
    const spanH = (rFrom, rTo) => layout.rowY(rTo - 1) + layout.cellH - layout.rowY(rFrom);

    for (let g = 0; g < layout.edp; g += 1) {
      const y = view.y + layout.rowY(g * layout.ranksPerDp) * k;
      const h = layout.groupH * k;
      if (y + h < v.y0 || y > v.y1) continue;

      const cy0 = Math.max(y, v.y0 - 1);
      const cy1 = Math.min(y + h, v.y1);
      const band = el("div", "crop-tick crop-tick--edp", `${dName} ${g}`);
      band.dataset.tip = `${dName}${g} · 一个完整模型副本`
        + (layout.innerIsDp
          ? `\nEDP = ${c.edp}（DP ${c.dp} ÷ EP ${c.ep}）—— 与表单里那个 DP 不是同一个量`
            + `\n这一段对应 DP ${g * layout.dpPerEdp}–${(g + 1) * layout.dpPerEdp - 1}`
          : `\n正交档下 EP 是独立的一根轴，EDP ≡ DP ${c.dp}`
            + `\n这一段里横着的 ${c.ep} 行是 EP0–EP${c.ep - 1}，合持一整套专家`);
      band.style.left = "0px";
      band.style.width = `${outerW}px`;
      band.style.top = `${cy0 - offY}px`;
      band.style.height = `${Math.max(0, cy1 - cy0)}px`;
      leftFrag.appendChild(band);

      if (!layout.twoLevelRow) continue;

      // 内层：这个副本里的每一个 DP 成员（= 一个 EP rank 占的那几行）
      for (let e = 0; e < c.ep; e += rowStep) {
        const r = g * layout.ranksPerDp + e * layout.ranksPerEp;
        const rEnd = Math.min((g + 1) * layout.ranksPerDp,
          r + layout.ranksPerEp * rowStep);
        const ty = view.y + layout.rowY(r) * k;
        const th = spanH(r, rEnd) * k;
        if (ty + th < v.y0 || ty > v.y1) continue;
        const dpNo = g * layout.dpPerEdp + e;
        const tick = el("div", "crop-tick crop-tick--dp",
          layout.innerIsDp ? `DP ${dpNo}` : `EP ${e}`);
        tick.dataset.tip = (layout.innerIsDp
          ? `DP ${dpNo} —— 表单里那个 DP ${c.dp} 的第 ${dpNo} 个成员\n它在 ${dName}${g} 这个副本里，占 EP${e}`
          : `EP ${e} —— ${dName}${g} 这个副本里的第 ${e} 个专家并行分片`)
          + (rowStep > 1 ? `（刻度每 ${rowStep} 个 EP 标一次）` : "");
        tick.style.left = `${outerW}px`;
        tick.style.width = `${v.x0 - outerW}px`;
        tick.style.top = `${Math.max(ty, v.y0) - offY}px`;
        tick.style.height = `${Math.max(0, Math.min(ty + th, v.y1) - Math.max(ty, v.y0))}px`;
        leftFrag.appendChild(tick);
      }
    }
    rulerLeft.replaceChildren(leftFrag);

    rulerCorner.textContent = layout.twoLevelRow
      ? (layout.innerIsDp ? "EDP | DP" : "DP | EP") : dName;
    rulerCorner.dataset.tip = layout.twoLevelRow
      ? (layout.innerIsDp
        ? `纵轴两层：外层 EDP ${c.edp}（矩阵真正的行数），内层是它对应的 DP 号`
          + `（表单里那个 DP ${c.dp}）。EDP = DP ÷ EP ${c.ep}。`
        : `纵轴两层：外层 DP ${c.dp} 个模型副本，内层是副本里的 EP ${c.ep} 个分片。`
          + `\n正交档 EP 独占 rank，EDP ≡ DP —— 与切出档是同一批卡的两种读法。`)
      : `纵轴 = DP ${c.dp} 个模型副本`;
    // 量尺读的是「哪一行 / 哪一列」，粒度切换不改它俩，只在 title 里报一下当前档
    rulerCorner.title = unit === "node" ? "当前按整机粒度画" : "当前按卡粒度画";
  }

  /* ══ 四·五、格内的两种内容：两段块 与 详情面板 ══════════════════════════
     三档的选档逻辑在 render 里（BLOCK_MIN_H / DETAIL_MIN_S），这里只管「选到某
     一档之后，那一格里长什么样」。 */

  /* ── 关键计算节点的词表 ──────────────────────────────────────────────────
     id 与文案照抄 patterns/model-architecture-3d-deck 那张「典型 Layer」卡（见
     model-architecture-3d-deck-pattern.js 里 layerHtml 的那批 graphNode）：平面
     里的一个算子，与整网图、与右栏结构条里的同一个算子，必定同名。

     只取**关键**的那些：整层 ~25 个节点铺进一个格子既写不下，也不是这一档要答的
     问题（那是整网图的活）。取舍按「这一格在训练里为什么慢、为什么爆」来定 ——
     Attention 留两支 Q/KV 投影与注意力核（TP 切在这儿，长序列爆在这儿），MoE 留
     路由四步（Router 打分 → EP Dispatch → 专家算 → EP Combine，慢和 hang 都在
     这条链上）。中间那些纯粹的 RMSNorm / Conv / SiLU 折进相邻节点，不单列。

     ⚠️ 这里**不带 op**（deck 那边每个节点有一个 data-op，用来取语义色）。整幅平面
     上唯一带颜色的东西是专家 —— 颜色在这幅图里已经被占用了，它说的是「这一片属于
     哪一套专家」。再给算子铺一层 deck 的语义色，就是在同一个画面上并排放两套互不
     相干的色码，读的人分不清哪一片绿说的是哪件事。算子之间的区别由**文案与位置**
     说，那本来就够了。 */
  const ATTN_ROWS = [
    [["attn_norm", "Input RMSNorm"]],
    [["q_a_norm", "Q LayerNorm"], ["kv_a_norm", "KV LayerNorm"]],
    [["q_b_proj", "Q Up Linear"], ["kv_b_proj", "KV Up Linear"]],
    [["attention_core", "Sparse FlashAttention"]],
    [["o_proj", "Output Projection"]],
  ];
  /* ⚠️ 两组各以自己的**入口 norm** 开头（Attention 那组是 attn_norm「Input
     RMSNorm」，这两组是 pre_mlp_norm「Pre-MLP RMSNorm」）—— pre-norm 结构里
     每一块前面都有一次归一化，deck 那张「典型 Layer」卡上也是这么排的
     （model-architecture-3d-deck-pattern.js：attn_norm → … → pre_mlp_norm →
     gate / dense_gate_up）。原先只有 Attention 那组写了 norm、FFN 这两组从
     Router / Gate 直接开始，两块的读法因此不对等：看着像「Attention 要先归一化、
     MoE 不用」。要么两块都不写 norm（那是更粗的一档该做的事），要么两块都写。 */
  const DENSE_ROWS = [
    [["pre_mlp_norm", "Pre-MLP RMSNorm"]],
    [["dense_gate_up", "Gate / Up Linear"]],
    [["dense_silu", "SiLU × Multiply"]],
    [["dense_down", "Dense Down Linear"]],
  ];
  /* MoE 那一组：Expert Compute 不是一枚算子而是一个盒子（里面是这张卡持有的那
     几个专家），所以它在这张表里留一个 null 占位，由 buildDetail 换成盒子
     （位置由 indexOf(null) 现找，不写死下标 —— 这张表增删一行就会错位）。 */
  const MOE_ROWS = [
    [["pre_mlp_norm", "Pre-MLP RMSNorm"]],
    [["gate", "Router"]],
    [["a2a_dispatch", "EP Dispatch"]],
    null,
    [["a2a_combine", "EP Combine"]],
  ];
  // 端点列（Emb / Norm / Head）不是一层，没有 Attention/FFN 两段，只有各自那几枚
  const UNIT_ROWS = {
    emb: [[["embedding", "Token Embedding"]]],
    norm: [[["final_norm", "Final RMSNorm"]]],
    head: [[["lm_head", "LM Head"]], [["logits", "Logits"]]],
  };

  /* 一组（Attention / MoE / Dense FFN）在设计像素下有多高。rows 是里面的算子行数，
     extra 给 MoE 那一组补「专家盒子比一枚算子高出多少」。 */
  function detailGroupH(rows, extra) {
    return D_TITLE_H + D_GAP + rows * D_PILL_H + (rows - 1) * D_GAP
      + 2 * D_PAD + 2 + (extra || 0);
  }

  // 专家盒子的高度：标题 + chipRows 行胶囊（或一行「E128–E191 · 64 个」）
  function detailExpertsH(chipRows) {
    return D_TITLE_H + D_GAP + chipRows * D_CHIP_H + (chipRows - 1) * D_GAP
      + 2 * D_PAD + 2;
  }

  /* 一格的详情面板在设计像素下有多高。必须与 css 里那套 var() 算出来的实际高度
     一致 —— 面板是按这个数去算缩放比的，算小了会把最后一条 Residual Add 截掉。 */
  function panelH(col, chipRows) {
    if (col.type === "unit") {
      const rows = (UNIT_ROWS[col.id] || UNIT_ROWS.emb).length;
      return rows * D_PILL_H + (rows - 1) * D_GAP;
    }
    const ffnH = col.moe
      ? detailGroupH(MOE_ROWS.length, detailExpertsH(chipRows) - D_PILL_H)
      : detailGroupH(DENSE_ROWS.length);
    // Attention 组 + 残差 + FFN 组 + 残差
    return detailGroupH(ATTN_ROWS.length) + ffnH + 2 * (D_RES_H + 2 * D_GAP);
  }

  /* 面板缩进这一格之后的比例。留 2px 世界余量给格子的描边。 */
  function detailScale(cellW, rowH, h) {
    return Math.min((cellW - 2) / D_PANEL_W, (rowH - 2) / h);
  }

  function opPill(spec, cls) {
    const [id, label] = spec;
    const n = el("div", `crop-op${cls ? ` ${cls}` : ""}`, label);
    n.dataset.node = id;
    return n;
  }

  function opRow(list) {
    const row = el("div", "crop-detail__row");
    list.forEach((spec) => row.appendChild(opPill(spec)));
    return row;
  }

  function opGroup(title, rows, boxAt, box) {
    const g = el("div", "crop-detail__group");
    g.appendChild(el("div", "crop-detail__title", title));
    rows.forEach((r, i) => g.appendChild(i === boxAt ? box : opRow(r)));
    return g;
  }

  /* ── Expert Compute 盒子 ────────────────────────────────────────────────
     格内胶囊从「铺满整格」缩进这里之后，它答的问题变了：原先是「这张卡持有哪几
     个专家」（编号本身就是主角），现在是「这张卡在这一层的活里，专家计算占多大
     一块、装着哪几个」—— 编号仍在，但它是这条链上的一环，不再是整格的全部。 */
  function expertBox(experts, chipsOn, rangeText, p, rel) {
    const box = el("div", "crop-detail__group crop-detail__experts");
    box.appendChild(el("div", "crop-detail__title", "Expert Compute"));
    const grid = el("div", "crop-detail__grid");
    if (chipsOn) {
      experts.forEach((e) => {
        const chip = el("span", "crop-expert crop-expert--mini", `E${e}`);
        chip.dataset.kind = "expert";
        chip.dataset.expert = e;
        if (p && p.kind === "expert" && p.expert === e) chip.classList.add("is-selected");
        else if (rel && rel.experts.has(e)) chip.classList.add("is-related");
        grid.appendChild(chip);
      });
    } else {
      /* 每卡专家多过 EXPERT_CHIP_MAX：逐个铺就是一面编号墙。这一格给区间与个数
         —— 它不是可点的对象（那条理由没变），但在这张面板里它答的是「这一环装了
         多少活」，那个问题一个数就答完了。 */
      grid.appendChild(el("span", "crop-detail__count", rangeText || "—"));
    }
    box.appendChild(grid);
    return box;
  }

  function residual() {
    return el("div", "crop-detail__res", "+ Residual Add");
  }

  /* 一格的详情面板。scale 由调用方算好（每一帧、每一种列各算一次，不逐格算）。 */
  function buildDetail(col, ctx, scale, h) {
    const panel = el("div", "crop-detail");
    panel.style.cssText = `height:${h}px;transform:scale(${scale})`;
    if (col.type === "unit") {
      panel.classList.add("crop-detail--unit");
      (UNIT_ROWS[col.id] || UNIT_ROWS.emb).forEach((r) => panel.appendChild(opRow(r)));
      return panel;
    }
    panel.appendChild(opGroup("Attention", ATTN_ROWS, -1, null));
    panel.appendChild(residual());
    panel.appendChild(col.moe
      ? opGroup("MoE", MOE_ROWS, MOE_ROWS.indexOf(null),
        expertBox(ctx.experts, ctx.chipsOn, ctx.rangeText, ctx.primary, ctx.rel))
      : opGroup("Dense FFN", DENSE_ROWS, -1, null));
    panel.appendChild(residual());
    return panel;
  }

  /* ── 中档：两段块 ────────────────────────────────────────────────────────
     Attention / MoE（dense 层写 Dense）两条横带 —— 一层的活就是这两块，
     从上到下就是数据流的次序。MoE 那条带着「这一套专家」的颜色：整格上色那一档
     说的同一件事，在这里由一半的面积继续说，所以缩放穿过这个档口时「同色一块」
     的图案不断。dense 层那条走中性色 —— 那一层里本来就没有专家，涂成一套专家的
     颜色是在说谎。

     ⚠️ **这一档不写 Hidden**（原先它是三条里的第一条）。Hidden 不是一段活，它是
     这一层的**入口张量** —— 把一个张量与两个计算块并排列成「这一层分成哪几段」，
     是把两类东西摆在同一张清单上。而且一旦开始列张量与norm，这张清单就收不住了：
     Attention 前有 Input RMSNorm、MoE 前有 Pre-MLP RMSNorm（见 ATTN_ROWS /
     MOE_ROWS，两处都照抄 model-architecture-3d-deck 那张「典型 Layer」卡），两块
     之间还各有一次 Residual Add —— 那是**下一档**（逐个计算节点）的事，它有的是
     地方按次序铺完。这一档只答「这一层的活分成哪几块」，答案就是两块。
     省下的那三分之一面积也不白给：两条带子各拿到半格（一格 54px 时约 27px 一条），
     字与色块都比原先三条 18px 的读得清。

     ⚠️ 只在**卡粒度**铺（调用处 showSegs 已经要求 span === 1）：这两段说的是「一张
     卡在这一层里的活」，整机行一格是 span 张卡，那里没有单一答案 —— 详见文件开头
     「格内的三档」那段末尾。 */
  function buildBands(col) {
    const wrap = el("div", "crop-segs");
    const seg = (kind, text) => {
      const s = el("div", "crop-seg", text);
      s.dataset.seg = kind;
      return s;
    };
    if (col.type === "unit") {
      wrap.appendChild(seg("unit", UNIT_LABEL[col.id] || col.id));
      return wrap;
    }
    wrap.appendChild(seg("attn", "Attention"));
    /* dense 那条仍写短名「Dense」而不是详情面板里的组标题「Dense FFN」：一格最窄
       只有 BLOCK_MIN_W = 40px，9px 字下「Dense FFN」正好被 overflow 切掉半截。 */
    wrap.appendChild(seg(col.moe ? "moe" : "dense", col.moe ? "MoE" : "Dense"));
    return wrap;
  }

  /* 为可视行生成 TP 通信组。普通 / 正交口径下同组 rank 连续，画一只括号；
     MindFormers 把 TP 吃进 DP×MP 域后，叠加 CP 时同组成员可能带步长，此时改画
     每行的 Tn 成员标记，不能用一个连续括号把中间的非成员也圈进去。 */
  function renderTpGroups(frag, block, r0, r1, k, primary) {
    const c = topology.counts;
    const rowInfo = rowMetrics(k);
    if (!tpGroupsVisible || c.tp <= 1 || currentUnit() !== "rank" || !rowInfo.show) return;

    const domain = commDomain(c, "tp");
    const stageStart = block.stage * layout.ranksPerStage;
    const groups = new Map();
    for (let row = r0; row <= r1; row += 1) {
      const anchor = stageStart + row;
      const members = commPeers(domain, anchor).filter((rank) => rank >= stageStart
        && rank < stageStart + layout.ranksPerStage);
      const key = members.join(",");
      if (!groups.has(key)) groups.set(key, members);
    }

    const gutterW = TP_GUTTER_PX / Math.max(k, 1e-6);
    const leadInset = TP_GUTTER_LEAD_PX / Math.max(k, 1e-6);
    const lineInset = 3 / Math.max(k, 1e-6);
    const x = block.x - layout.lane + leadInset;
    groups.forEach((members, key) => {
      const rows = members.map((rank) => rank - stageStart);
      const contiguous = rows.every((row, i) => i === 0 || row === rows[i - 1] + 1);
      const selected = Boolean(primary && primary.kind === "rank" && members.includes(primary.rank));
      const memberText = members.map((rank) => {
        const co = topology.coordsOfRank(rank);
        return `rank ${rank}（T${co.tpIdx}）`;
      }).join("、");
      const tip = `TP×${c.tp} 分组\n${memberText}`
        + (contiguous ? "" : "\n成员在 rank 轴上不连续，因此逐行标出 TP shard");

      if (contiguous) {
        const first = rows[0];
        const last = rows[rows.length - 1];
        /* 端帽穿过首尾 rank 标签的纵向中心，读起来是“这两个名字属于一组”，
           而不是把整行高度连同留白一起框进去。 */
        const top = layout.rowY(first) + layout.cellH / 2;
        const bottom = layout.rowY(last) + layout.cellH / 2;
        const bracket = el("div", "crop-node crop-tp-bracket");
        bracket.dataset.tpKey = key;
        bracket.dataset.tpMembers = key;
        bracket.dataset.tip = tip;
        if (selected) bracket.classList.add("is-selected");
        const label = el("span", "crop-tp-bracket__label",
          (bottom - top) * k >= 32 ? `TP×${c.tp}` : "TP");
        bracket.appendChild(label);
        place(bracket, x, top, gutterW - leadInset - lineInset,
          Math.max(1, bottom - top), rowInfo.font);
        bracket.style.setProperty("--crop-tp-line", `${1 / k}px`);
        bracket.style.setProperty("--crop-tp-cap", `${6 / k}px`);
        frag.appendChild(bracket);
        return;
      }

      rows.forEach((row, i) => {
        if (row < r0 || row > r1) return;
        const rank = members[i];
        const marker = el("div", "crop-node crop-tp-marker", `T${topology.coordsOfRank(rank).tpIdx}`);
        marker.dataset.tpKey = key;
        marker.dataset.tpMembers = key;
        marker.dataset.rank = String(rank);
        marker.dataset.tip = tip;
        if (selected) marker.classList.add("is-selected");
        place(marker, x, layout.rowY(row), gutterW - leadInset - lineInset,
          layout.cellH, rowInfo.font);
        marker.style.setProperty("--crop-tp-line", `${1 / k}px`);
        marker.style.setProperty("--crop-tp-cap", `${6 / k}px`);
        frag.appendChild(marker);
      });
    });
  }

  /* ══ 五、画布重绘（视口裁剪 + 两档粒度）══════════════════════════════════
     世界很大（46 层 × 512 行 = 2 万多格），但一屏永远只看得见几百上千格：每帧
     按当前 transform 反解出可见的行 / 列区间，只铺那一段。再小就走两级降级 ——
     先聚成整机行（8 张卡一格），再退到「只画块与高亮带」。 */
  function render() {
    if (!topology || !layout) return;
    // 行标道随缩放变宽 → block.x 也随之变，铺任何东西之前先对齐到当前 k
    syncGeometry(view.k);
    const v = viewport();
    if (!(v.x1 > v.x0 && v.y1 > v.y0)) return;

    const k = view.k;
    const cellW = layout.cellW;
    const unit = currentUnit();
    const span = unit === "node" ? layout.ranksPerNode : 1;   // 一行合几张卡
    syncUnitButtons(unit);
    renderRulers(unit);

    const wx0 = (v.x0 - view.x) / k;
    const wy0 = (v.y0 - view.y) / k;
    const wx1 = (v.x1 - view.x) / k;
    const wy1 = (v.y1 - view.y) / k;

    const rel = relation;
    const p = rel ? rel.primary : null;
    // rel.nodes 是主脚本 resolveRelation 已经算好的「这次选择牵连到哪些节点」，
    // 整机档的高亮直接读它，不必自己再 union 一遍
    const relNodes = rel ? new Set(rel.nodes) : null;
    const primaryNode = p && p.kind === "rank" ? topology.nodeOfRank(p.rank) : null;
    const frag = doc.createDocumentFragment();

    const c = topology.counts;
    const epr = c.expertsPerEpRank || 0;

    /* 行标的字号与显隐 —— 与 laneWorldAt 留道宽用的是**同一份**度量（rowMetrics），
       两边各判一次就会出现「留了道却不写字」或「写了字却没道」的错位。 */
    const rowH = layout.cellH * span;
    const rowInfo = rowMetrics(k);
    const rowFontWorld = rowInfo.font;
    const showRowText = rowInfo.show;
    const rowTwoLine = rowInfo.two;
    /* ── 格内选到第几档 ──────────────────────────────────────────────────
       两道闸都按「这一格在屏幕上有多大」判，理由见 BLOCK_MIN_H 那一段。
       字号那一档（两段块）与行标同一套做法：世界字号取 BAND_FONT_MIN / k，
       屏幕上因此恒定 9px；格子太矮时再让位给 rowH / 5.6，宁可小也不撑破。 */
    const cellPxW = cellW * k;
    const cellPxH = rowH * k;
    /* ⚠️ 格内有内容的那两档（两段块 / 详情面板）**只在卡粒度成立** —— 它们答的是
       「一张卡在这一层里的活」，整机行一格是 span 张卡，那里没有单一答案。整机档
       只有「一块颜色」这一档，再要细就该换粒度（自适应正是在同一个门槛上换的，
       见 currentUnit）。理由与那条阶梯见文件开头「格内的三档」末尾。 */
    const cellIsRank = span === 1;
    const showBands = cellIsRank && cellPxH >= BLOCK_MIN_H && cellPxW >= BLOCK_MIN_W;
    const bandFontWorld = Math.min(rowH / 5.6, BAND_FONT_MIN / k);
    /* ── 最细那一档：整幅**一个**缩放比、**一个**档口 ─────────────────────
       比例按最高的那种面板（有 MoE 层就是 MoE 那一种）算一次，dense 列与端点列
       共用它，各自的面板高度不同、居中放着就行。
       ⚠️ 不能各算各的。各算各的时候 dense 面板矮、比例就大，于是它比 MoE 早一截
       进最细档 —— 中间那段缩放里，同一屏上 dense 列已经是计算图、MoE 列还是两段
       块，一幅图上并排摆着两种粒度，读的人会以为那是两种层的**区别**，而它其实
       只是两个门槛。同理，比例统一之后两种列里的算子块也一样大，横着扫一行时
       字号不跳。 */
    const chipRows = layout.chipRows || 1;
    const detailTallest = panelH(
      { type: "layer", moe: Boolean(topology.hasMoe) }, chipRows);
    const detailS = detailScale(cellW, rowH, detailTallest);
    // 与两段块同一条：整机行一格是 span 张卡，一份算子链在那里没有单一答案
    const detailOn = cellIsRank && detailS * k >= DETAIL_MIN_S;
    const detailCache = new Map();
    const detailFor = (col) => {
      const key = col.type === "unit" ? `u:${col.id}` : (col.moe ? "moe" : "dense");
      let d = detailCache.get(key);
      if (!d) {
        d = { h: panelH(col, chipRows), s: detailS, on: detailOn };
        detailCache.set(key, d);
      }
      return d;
    };
    /* 热力档：整幅平面改按一个度量上色。色阶两端每帧读一次（模型自己缓存），
       别在格子循环里问 —— 那是一帧几千次的重复问答。 */
    const heatOn = center.dataset.mode === "heat";
    const hm = heatOn ? heatModel() : null;
    const hRange = hm ? hm.range(heatMetric) : null;
    const hSpan = hRange ? Math.max(1e-12, hRange.hi - hRange.lo) : 1;
    /* （原先整机行顶上还压着一条「整机 N · rank a–b」的标签带。它与左边的行标
       说的是同一件事，同屏出现两次纯属重复 —— 而且那条带横贯整个 stage 块，每 8
       行来一条，把「一整套专家」那层颜色压在下面。现在整机号与 rank 区间都归左边
       的行标，写成两行右对齐，见 rowMetrics 的 two 分支。） */

    /* 可见行区间对所有 stage 块都一样（纵轴是共用的），先算一次；
       并且对齐到当前粒度的整行边界，整机档才不会从半台机器画起。 */
    let r0 = clamp(layout.rowAt(wy0) - span, 0, layout.rows - 1);
    const r1 = clamp(layout.rowAt(wy1) + span, 0, layout.rows - 1);
    r0 -= r0 % span;
    const rowsVisible = Math.floor((r1 - r0) / span) + 1;

    /* 先数一遍这一帧总共要铺多少格，再决定铺不铺 —— 而不是边铺边扣预算。
       边铺边扣的结果是「前两个 stage 有格子、后两个空着」，那读起来像是后半段
       没有卡，比整幅都不画格子更糟。要降级就整幅一起降：留下 stage 块、行标与
       高亮带，格子等放大了再回来。 */
    const visible = layout.blocks.filter((b) => !(view.x + (b.x + b.w) * k < v.x0
      || view.x + b.x * k > v.x1))
      .map((block) => ({
        block,
        c0: clamp(Math.floor((wx0 - block.x) / cellW) - 1, 0, block.cols.length - 1),
        c1: clamp(Math.ceil((wx1 - block.x) / cellW) + 1, 0, block.cols.length - 1),
      }));
    const wanted = visible.reduce((n, x) => n + (x.c1 - x.c0 + 1) * rowsVisible, 0);
    const drawCells = cellW * k >= DETAIL_MIN_W && rowH * k >= DETAIL_MIN_H
      && wanted <= CELL_BUDGET;
    /* （原先这里还有一条「格子数 × 每卡专家数」的总节点闸。胶囊铺满整格的那一版
       需要它 —— 那时胶囊只受 k ≥ 0.5 一条约束，几千格 × 32 枚一帧真的建不完。
       现在格内三档全部按屏幕尺寸开闸：两段块那一档一格至少 40×54 像素，一屏顶多
       几百格；最细那一档一格要占到面板尺寸，一屏只剩几十格。闸门自己把节点数封住
       了，再算一遍总数是白算。） */

    visible.forEach(({ block, c0, c1 }) => {
      // 块底板
      const plate = el("div", "crop-node crop-block");
      place(plate, block.x - 4, -4, block.w + 8, layout.worldH + 8);
      frag.appendChild(plate);

      renderTpGroups(frag, block, r0, r1, k, p);

      // 列高亮带：缩到看不见格子时，靠它读出「哪几层被牵连」
      for (let ci = c0; ci <= c1; ci += 1) {
        const col = block.cols[ci];
        const hit = col.type === "layer"
          ? Boolean(rel) && rel.layers.has(col.layer)
          : Boolean(rel) && rel.units.has(col.id);
        if (!hit) continue;
        const band = el("div", "crop-node crop-band");
        if (p && ((p.kind === "layer" && p.layer === col.layer)
          || (p.kind === "segment" && p.segment === col.id))) {
          band.classList.add("crop-band--selected");
        }
        place(band, block.x + ci * cellW, 0, cellW, layout.worldH);
        frag.appendChild(band);
      }

      /* ── 热力的降级档：缩到画不出格子时，按行成带 ────────────────────────
         配置寻优档里格子画不出来还剩行/列高亮带可读；热力档不行 —— 那一档的全部
         内容就是这片颜色，退成空白等于在「先缩到看全局」这一步上什么都不给，
         而那恰恰是热力图最该答话的一步（热在哪一片，不是热在哪一格）。
         所以这里把纵向分辨率降到预算之内：一列一列地铺色带，带高由「可见格数 ÷
         预算」定，颜色取带中那张卡的值。答的仍是同一个问题，只是从「一张卡」粗到
         「一撮卡」；要逐卡就放大，格子自己会回来。
         ⚠️ 取样是带中一张卡而不是带内均值：均值要多算 bandRows 倍，而这一档的读法
         本来就是「这一片偏冷还是偏热」，一张代表卡足够，代价却差一个量级。 */
      if (heatOn && !drawCells) {
        const colN = c1 - c0 + 1;
        const rawRows = r1 - r0 + 1;
        const bandRows = Math.max(1, Math.ceil(rawRows * colN / HEAT_LOD_BUDGET));
        for (let ci = c0; ci <= c1; ci += 1) {
          const col = block.cols[ci];
          for (let r = r0; r <= r1; r += bandRows) {
            const hi = Math.min(r1, r + bandRows - 1);
            const y0 = layout.rowY(r);
            const bv = hm.value(heatMetric, col, block.stage * layout.ranksPerStage
              + r + ((hi - r) >> 1), 1);
            // 与格子那边同一条：取不出值的列不铺带（「专家负载」下的非 MoE 列）
            if (!Number.isFinite(bv)) continue;
            const tile = el("div", "crop-node crop-heattile");
            place(tile, block.x + ci * cellW, y0, cellW,
              layout.rowY(hi) + layout.cellH - y0);
            /* ⚠️ 必须排在 place 之后：place 写的是整条 cssText，会把先设的
               自定义属性一起冲掉（与格子那边同一条注意事项）。 */
            tile.style.setProperty("--crop-heat", heatColor((bv - hRange.lo) / hSpan));
            frag.appendChild(tile);
          }
        }
      }

      /* ── 逐行 ──────────────────────────────────────────────────────────
         span = 1 时一行是一张卡，span = 整机卡数时一行是一台机器；两档共用同一
         套坐标（整机行的高度恰好等于它那几行卡之和），所以下面只有「标签写什么、
         专家怎么写、高亮按谁判」三处分叉。 */
      for (let r = r0; r <= r1; r += span) {
        const rank = block.stage * layout.ranksPerStage + r;
        const lastRank = rank + span - 1;
        const y = layout.rowY(r);
        const co = topology.coordsOfRank(rank);
        const isNode = span > 1;
        const nodeId = co.node;
        const epLo = co.epIdx;
        const epHi = isNode
          ? Math.floor(((r + span - 1) % layout.ranksPerDp) / layout.ranksPerEp)
          : epLo;
        /* 只取本行首个 EP rank 的那一批：跨 EP 的整机行不铺胶囊（chipsOK 会否掉），
           气泡里那个「E?–E?」的区间改由 cellTip 悬浮时现算 —— 所以这里不必再为
           每一行多查一次 expertsOfEpRank。 */
        const expertsLo = epr ? topology.expertsOfEpRank(epLo) : [];
        const eLo = expertsLo.length ? expertsLo[0] : null;

        const rowHit = Boolean(rel) && (isNode ? relNodes.has(nodeId) : rel.ranks.has(rank));
        const rowSel = isNode ? primaryNode === nodeId : Boolean(p && p.kind === "rank" && p.rank === rank);

        /* ⚠️ 行标与整机标签带上**不挂 data-tip**：它们就是一个名字，气泡里那几行
           （PP / DP / EP / 专家区间）在右栏里写得更全 —— 而扫一整列行标时，鼠标
           每划过一行就弹一次气泡，是这幅图上最吵的一处。点进去看，不要悬浮。
           格子（.crop-cell）的气泡留着：那里问的是「这张卡 × 这一层」，右栏答不了。 */
        if (showRowText) {
          const label = el("div", "crop-node crop-rowlabel");
          label.appendChild(el("span", "crop-rowlabel__name",
            isNode ? `整机 ${nodeId}` : `rank ${rank}`));
          /* 整机档补第二行：这台机器含哪几张卡。它与整机号右对齐叠在一起，
             是「整机 12 / rank 96–103」这一件事的两半，不再另起一条横贯的标签带。 */
          if (isNode && rowTwoLine) {
            label.appendChild(el("span", "crop-rowlabel__sub", `rank ${rank}–${lastRank}`));
          }
          label.dataset.kind = isNode ? "node" : "rank";
          label.dataset.rank = rank;
          label.dataset.node = nodeId;
          if (rowSel) label.classList.add("is-selected");
          else if (rowHit) label.classList.add("is-related");
          /* 行标写在块左边那条「行标道」里，右端贴着块 —— 道宽随缩放变，见 syncX。
             字号必须和坐标一起交给 place：它写的是整条 cssText，分开设会被覆盖。 */
          place(label, block.x - layout.lane + 4, y, layout.lane - 10, rowH, rowFontWorld);
          frag.appendChild(label);
        }

        if (rowHit) {
          const band = el("div", "crop-node crop-band");
          if (rowSel) band.classList.add("crop-band--selected");
          place(band, block.x, y, block.w, rowH);
          frag.appendChild(band);
        }

        if (!drawCells) continue;

        for (let ci = c0; ci <= c1; ci += 1) {
          const col = block.cols[ci];
          const moe = col.type === "layer" && col.moe;
          const cell = el("div", "crop-cell crop-node");
          const ds = cell.dataset;
          ds.kind = isNode ? "node" : "cell";
          ds.rank = rank;
          ds.node = nodeId;
          ds.stage = block.stage;
          if (col.type === "layer") ds.layer = col.layer;
          else ds.unit = col.id;
          ds.ffn = col.type === "unit" ? "unit" : (moe ? "moe" : "dense");
          // EP 号挂在格子上而不是每一枚胶囊上：一格里的胶囊全属于同一个 EP rank，
          // 写在这里是 1 次属性写，写在胶囊上是 epr 次。pick() 顺着格子读。
          if (moe) ds.epRank = epLo;

          /* ── 着色 = 「一套完整专家」──────────────────────────────────────
             一套完整专家 = **一个 MoE 层 × 一个 EDP 副本**：那一列一段里的
             ranksPerDp 张卡各持一片，合起来正好是 routedExpert 个专家的一整套。
             所以整块矩形一个颜色，相邻的两套换色：左右相邻是换了一层（层号 +1），
             上下相邻是换了一个副本（副本号 +1）。索引取 (层号 + 2×副本号) % 4，
             两个方向的邻居因此一定不同色。
             ⚠️ 这不是 EP 的颜色 —— EP 是这一套内部的分片，同一套里的每张卡颜色
             相同、编号不同，那才是「一套被切开」该有的读法。 */
          /* ── 这一格落在三档里的哪一档 ────────────────────────────────────
             热力档一律留在最粗那一档：那时格子底色说的是「多重」，格内的结构说的
             是「里面有什么」，两套编码叠在同一格上谁也读不清。要看结构就切回配置
             寻优那一档。 */
          const d = detailFor(col);
          const showDetail = !heatOn && d.on;
          const showSegs = !heatOn && !showDetail && showBands;

          /* 详情面板里的 Expert Compute 逐个铺得出编号吗？两个条件：每卡专家数没
             超过 EXPERT_CHIP_MAX（超了就是一面编号墙），且这一格只对应**一个**
             EP rank —— 整机档一行跨了几个 EP 时「这一格持有哪几个」没有单一答案，
             那时盒子里给区间与个数。 */
          const chipsOK = layout.expertMode === "chips" && eLo != null && epLo === epHi;

          /* 上面那套颜色**落在哪儿**随档位走，说的始终是同一件事：
               · 最粗档 —— 落在格子底上（data-paint="bg"）。那时它是唯一还能表达
                 「这一片属于哪一套」的东西。
               · 两段块 —— 落在 MoE 那一条带上。面积小了一半，但「同色一块 =
                 一整套专家」的图案不断，穿过档口时不会突然改口。
               · 详情面板 —— 落在 Expert Compute 里那几枚编号上。编号与颜色本来就
                 是同一件事的两半（这一片属于哪一套），分开摆等于让底色去和选中高亮
                 抢面积。
             ⚠️ --crop-set 无论哪一档都要写：后两档靠它给带子和胶囊上色。 */
          const paint = paintExperts && moe && !heatOn;
          if (paint && !showDetail && !showSegs) ds.paint = "bg";

          const colHit = col.type === "layer"
            ? Boolean(rel) && rel.layers.has(col.layer)
            : Boolean(rel) && rel.units.has(col.id);
          if (rowSel && colHit) cell.classList.add("is-selected");
          else if (rowHit && colHit) cell.classList.add("is-cross");
          else if (rowHit || colHit) cell.classList.add("is-related");
          if (heatOn && heatPick && heatPick.rank === rank
            && (col.type === "layer"
              ? heatPick.layer === col.layer
              : heatPick.unit === col.id)) {
            cell.classList.add("is-heat-selected");
          }

          /* ⚠️ 这里**不写** data-tip：那串气泡文案有五六行、要拼四五个模板字符串，
             一帧几千格就是几千个长字符串，而其中至多一个会被人看到。改成悬浮时
             现拼，见下面 stage 上那条 pointerover（cellTip）。 */
          /* 整机档的格子不再让出顶上那条标签带（已撤），整行都归格子。
             两段块那一档要给格子写一个世界字号（带子的字继承它），最细那一档不写
             —— 面板内部一律用设计像素，再由 transform 整体缩放。 */
          place(cell, block.x + ci * cellW, y, cellW - 1, rowH - 1,
            showSegs ? bandFontWorld : 0);
          /* ⚠️ 必须排在 place 之后：place 写的是整条 cssText，会把先设的
             自定义属性一起冲掉。 */
          if (paint) {
            cell.style.setProperty("--crop-set",
              `var(--crop-set-${(col.layer + 2 * co.dpIdx) % SET_TINTS})`);
          }
          /* 热力：一格一个颜色，冷蓝到火红。值写不进 dataset（一帧几千次字符串
             转换），气泡要用时由 cellTip 按同一个模型现算一遍。 */
          if (hm) {
            /* 取不出值的格子（「专家负载」下的非 MoE 列）留素底、不写 data-heat：
               把它涂成色阶最冷那一端，就等于说「这里的路由被饿死了」，而真相是
               这一列压根没有路由。留白是这里唯一诚实的画法。 */
            const hv = hm.value(heatMetric, col, rank, span);
            if (Number.isFinite(hv)) {
              ds.heat = "1";
              cell.style.setProperty("--crop-heat", heatColor((hv - hRange.lo) / hSpan));
            }
          }

          /* ── 格内的内容 ────────────────────────────────────────────────
             最细档铺详情面板，中档铺两段块，最粗档什么都不铺（颜色已经落在格子
             底上）。面板里的算子块一律不带 data-kind、也不吃指针事件：pick() 是
             顺着 closest("[data-kind]") 往上找的，所以点在算子上等于点在这一格上
             （问的仍是「这张卡 × 这一层」）。唯一例外是专家胶囊 —— 它本来就是一
             个可点的对象，data-kind="expert" 照旧，pick() 顺着父格子取坐标。 */
          if (showDetail) {
            /* 铺不出编号时盒子里给区间与个数。整机档一行跨了几个 EP，区间要从首尾
               两个 EP 各取一次 —— 这一步只在真的铺面板的那几十格上做，逐行预算不
               起（与 cellTip 里同一条理由）。 */
            let rangeText = null;
            if (moe && !chipsOK && expertsLo.length) {
              const hiList = epHi === epLo ? expertsLo : topology.expertsOfEpRank(epHi);
              const e0 = expertsLo[0];
              const e1 = hiList[hiList.length - 1];
              if (Number.isFinite(e1)) rangeText = `E${e0}–E${e1} · ${e1 - e0 + 1} 个`;
            }
            cell.classList.add("crop-cell--detail");
            cell.appendChild(buildDetail(col, {
              experts: expertsLo, chipsOn: chipsOK, rangeText, primary: p, rel,
            }, d.s, d.h));
          } else if (showSegs) {
            cell.appendChild(buildBands(col));
          }
          frag.appendChild(cell);
        }
      }
    });

    world.replaceChildren(frag);
    tpHoverKey = null;
    renderGen += 1;                            // 这一批格内节点是新的，见 renderGen 那段
    lastRenderAt = global.performance.now();   // 交互期节流的 leading 那一半按它判
  }

  /* ══ 格子气泡：悬浮时现拼 ════════════════════════════════════════════════
     render 里不再给每个格子预拼 data-tip —— 那串文案有五六行、要拼四五个模板
     字符串，一帧几千格就是几千个长字符串，而其中至多有一个会被人看到。
     这里在 pointerover 时按格子身上那几个 data-* 现算一遍，写回 data-tip。
     ⚠️ 时序：主脚本的气泡层委托在 **document** 的冒泡阶段（installTipLayer），
     这条挂在 stage 上、是它的后代，冒泡时必定先跑 —— 等它去读 data-tip，值
     已经就位。格子每次重绘都是新节点，缓存自然失效，不必自己清。 */
  const UNIT_LABEL = { emb: "Emb", norm: "Norm", head: "Head" };

  /* 热力档下，气泡末尾补一行「这一格是多少」。给绝对值也给档位（在冷热之间的
     位置）—— 单看 12.4 GB 不知道算不算重，看了「本图第 87%」才知道它是不是那批
     最烫的格子之一。整机行给的是那几张卡的均值，与格子上色同一口径。 */
  function heatTip(cell) {
    if (center.dataset.mode !== "heat") return "";
    const hm = heatModel();
    if (!hm) return "";
    const col = cell.dataset.unit
      ? { type: "unit", id: cell.dataset.unit, stage: Number(cell.dataset.stage) }
      : {
        type: "layer", layer: Number(cell.dataset.layer), stage: Number(cell.dataset.stage),
        moe: cell.dataset.ffn === "moe",
      };
    const span = cell.dataset.kind === "node" ? Math.max(1, topology.counts.ranksPerNode || 1) : 1;
    const meta = heatMeta(heatMetric);
    const v = hm.value(heatMetric, col, Number(cell.dataset.rank), span);
    const r = hm.range(heatMetric);
    if (!Number.isFinite(v)) {
      return heatMetric === "route" ? "\n专家负载：这一列不是 MoE 层，没有路由" : "";
    }
    const pct = Math.round(clamp((v - r.lo) / Math.max(1e-12, r.hi - r.lo), 0, 1) * 100);
    let line = `\n${meta.label}${span > 1 ? "（本机均值）" : ""} ${heatFmt(v, meta)}`
      + ` · 本图冷热第 ${pct}%`;
    /* 「专家负载」的倍数配上「占本层多少 token」才落地（1× 在 EP=64 下是 1.6%），
       再补一句当前演到哪一相 —— 同一张卡在 ② 和 ④ 是两个数，不说清哪一刻等于没说。 */
    if (heatMetric === "route") {
      const c2 = topology.counts;
      const share = v / Math.max(1, c2.ep || 1) * 100;
      const hot = hm.hot();
      line += `\n占本层 token ${share < 0.01 ? "<0.01" : share.toFixed(2)}%`
        + ` · ${routePhase(routeTau).tag} · ${routeStepText(routeTau)}`;
      if (hot && col.type === "layer" && col.layer === hot.layer
        && topology.coordsOfRank(Number(cell.dataset.rank)).epIdx === hot.epIdx) {
        line += `\n⚠ 塌缩点：E${hot.expert} 的 token 聚集到这张卡`;
        const incident = hm.incident();
        if (incident) {
          line += `（${incident.expertTokens}/${incident.totalTokens}，`
            + `${(incident.expertTokens / incident.totalTokens * 100).toFixed(1)}%）`
            + `\nAll-to-All：send=${incident.sendTokens} / recv=${incident.recvTokens}`;
        }
      }
    } else {
      // 前五个度量：踩到那处构造的故障就说清是什么烫了它
      line += hm.note(heatMetric, col, Number(cell.dataset.rank));
    }
    return line;
  }

  function cellTip(cell) {
    if (!topology) return "";
    const c = topology.counts;
    const rank = Number(cell.dataset.rank);
    const isNode = cell.dataset.kind === "node";
    const span = isNode ? Math.max(1, c.ranksPerNode || 1) : 1;
    const lastRank = Math.min((c.totalRank || 1) - 1, rank + span - 1);
    const co = topology.coordsOfRank(rank);
    const who = isNode ? `整机 ${co.node}（rank ${rank}–${lastRank}）` : `rank ${rank}`;
    const stageNo = cell.dataset.stage;

    if (cell.dataset.unit) {
      const label = UNIT_LABEL[cell.dataset.unit] || cell.dataset.unit;
      return `${who} × ${label}\n${label} 不是一层，`
        + `是驻留在 PP Stage${stageNo} 这一段卡上的端点结构`
        + heatTip(cell);
    }

    const moe = cell.dataset.ffn === "moe";
    const label = `Layer${cell.dataset.layer} · ${moe ? "MoE" : "Dense"}`;
    let text = `${who} × ${label}\nPP Stage${stageNo}`;
    text += heatTip(cell);
    if (moe && c.expertsPerEpRank > 0) {
      /* 整机行可能跨几个 EP rank，合持的区间要从首尾两个 EP 各取一次 ——
         这一步原先在 render 的逐行循环里每行都做，现在只在真的悬浮时做一次。 */
      const r = rank % c.ranksPerStage;
      const epLo = co.epIdx;
      const epHi = span > 1
        ? Math.floor(((r + span - 1) % c.ranksPerDp) / c.ranksPerEp)
        : epLo;
      const lo = topology.expertsOfEpRank(epLo);
      const hi = epHi === epLo ? lo : topology.expertsOfEpRank(epHi);
      const dName = c.edp === c.dp ? "DP" : "EDP";
      if (lo.length && hi.length) {
        text += `\n${isNode ? "本机合持" : "本卡持有"}路由专家 E${lo[0]}–E${hi[hi.length - 1]}`
          + `\n这一列 × 这一个 ${dName} 副本 = 一整套 ${c.routedExpert} 个专家`
          + (paintExperts ? "（同色的那一块）" : "")
          + `\n编号每层各自从 0 数到 ${c.routedExpert - 1}，不跨层累计`;
      }
    }
    return text;
  }

  let tpHoverKey = null;
  function paintTpHover(group) {
    world.querySelectorAll(".is-tp-peer").forEach((node) => node.classList.remove("is-tp-peer"));
    tpHoverKey = group ? group.dataset.tpKey : null;
    if (!group) return;
    const members = new Set((group.dataset.tpMembers || "").split(",").map(Number));
    world.querySelectorAll("[data-rank]").forEach((node) => {
      if (members.has(Number(node.dataset.rank))) node.classList.add("is-tp-peer");
    });
    world.querySelectorAll("[data-tp-key]").forEach((node) => {
      if (node.dataset.tpKey === tpHoverKey) node.classList.add("is-tp-peer");
    });
  }

  stage.addEventListener("pointerover", (event) => {
    const tpGroup = event.target.closest?.(".crop-tp-bracket, .crop-tp-marker");
    if (tpGroup) {
      if (tpGroup.dataset.tpKey !== tpHoverKey) paintTpHover(tpGroup);
      return;
    }
    const cell = event.target.closest?.(".crop-cell");
    if (!cell) return;
    /* 热力读数已经常驻右栏；悬浮气泡会遮住相邻色块，也与右栏重复。 */
    if (center.dataset.mode === "heat") {
      delete cell.dataset.tip;
      return;
    }
    if (cell.dataset.tip) return;
    cell.dataset.tip = cellTip(cell);
  });

  stage.addEventListener("pointerout", (event) => {
    const tpGroup = event.target.closest?.(".crop-tp-bracket, .crop-tp-marker");
    if (!tpGroup) return;
    const next = event.relatedTarget?.closest?.(".crop-tp-bracket, .crop-tp-marker");
    if (next && next.dataset.tpKey === tpGroup.dataset.tpKey) return;
    paintTpHover(null);
  });

  /* ══ 五、画布交互 ════════════════════════════════════════════════════════ */
  let drag = null;

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    /* 缩放键那一组与通信详情浮卡都浮在画布上，但它们不是画布内容：在它们上面
       按下既不该起拖，抬起时也不该走 pick(null) 把当前选择清掉。 */
    if (event.target.closest?.(".crop-tools, .crop-comm__detail")) return;
    drag = {
      id: event.pointerId,
      x0: event.clientX, y0: event.clientY,
      vx: view.x, vy: view.y,
      moved: false,
      target: event.target.closest?.("[data-kind], .crop-tp-bracket, .crop-tp-marker") || null,
    };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-panning");
  });

  stage.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x0;
    const dy = event.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    view.x = drag.vx + dx;
    view.y = drag.vy + dy;
    applyTransform();
    scheduleRenderSoft();
  });

  const endDrag = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const wasDrag = drag.moved;
    const target = drag.target;
    drag = null;
    stage.classList.remove("is-panning");
    try { stage.releasePointerCapture(event.pointerId); } catch (_) { /* 已释放 */ }
    if (wasDrag || event.button === 1
      || target?.matches?.(".crop-tp-bracket, .crop-tp-marker")) return;
    pick(target);
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    stage.classList.remove("is-panning");
  });

  /* 画布上的一切点击都由这里收口，且**必须**吞掉冒泡：主脚本在 document 上
     挂了「点到白名单之外 = 清空选择」的兜底（见 observer.js 的 SELECTABLE），
     这几个新元素当然不在那份白名单里 —— 不吞的话，刚选中就被自己清掉。
     空白处的清空由下面显式调用 croSelect(null) 完成，语义一个不少。 */
  stage.addEventListener("click", (event) => { event.stopPropagation(); });

  /* 本文件所有的「发出一次选择」都走这里。
     nodeId 只在整机档点整机行时给：主脚本的 resolveRelation 没有 kind:"node"
     这一档（那是两页共用的口径层，不该为这一页去加），所以整机档发的仍是这台
     机器**首卡**的 kind:"rank"，靠 rel.nodes 把整行点亮；nodeId 只是记下「这一击
     问的是一台机器」，好让右栏把标题和读数按整机口径写，而不是冒充成一张卡。 */
  let pickedNode = null;

  function emit(payload, nodeId = null) {
    const select = global.croSelect;
    if (typeof select !== "function") return;
    pickedNode = nodeId;
    select(payload);
  }

  function rankPayload(rank) {
    const co = topology.coordsOfRank(rank);
    // payload 与集群矩阵格子那条完全一致（见 observer.js 的 renderCluster）
    return {
      kind: "rank", rank, stage: co.stage, dpIdx: co.dpIdx, epRank: co.epIdx,
      tpIdx: co.tpIdx, cpIdx: co.cpIdx, node: co.node,
    };
  }

  function pick(target) {
    // 主脚本还没 boot（croSelect 未导出）或拓扑还没派下来：这一击没有可回答的对象
    if (typeof global.croSelect !== "function" || !topology) return;

    /* 通信观测档里，画布上的一格问的不是「这是什么」而是「**从这儿开始演**」——
       这一档的主体是那条时间轴，右栏那份静态档案（这张卡是谁、持有哪些专家）在
       这里既答非所问、又要抢掉画布近三分之一的宽度。所以这一档下点格子不发选择，
       直接把行程挪到那一列开播；其余对象（行标、量尺、stage 带）照旧发选择。 */
    if (center.dataset.mode === "comm" && target) {
      const host = target.closest?.(".crop-cell");
      if (host && flowJumpToCell(host)) return;
    }

    /* 热力格子点击选的是 rank × layer 交叉点，不再退化成只选中 rank。行标、列标
       仍继续走下面原有的 relation 通路，分别表达整行与整列。 */
    if (center.dataset.mode === "heat" && target) {
      const host = target.closest?.(".crop-cell");
      if (host) {
        selectHeatCell(host);
        return;
      }
    }

    if (!target) { emit(null); return; }
    const kind = target.dataset.kind;

    if (kind === "stage") { emit({ kind: "stage", stage: Number(target.dataset.stage) }); return; }
    if (kind === "layer") { emit({ kind: "layer", layer: Number(target.dataset.layer) }); return; }
    if (kind === "unit") {
      /* Emb / Norm / Head 不是层，是端点结构列。payload 与在「典型 Layer」里点整列
         同形（kind:"segment" + wholeColumn），主脚本据此按 stageAnchor 反查它驻留
         在哪一段 PP 的哪批卡上 —— 那正是这几列在平面里该亮起的范围。 */
      emit({ kind: "segment", segment: target.dataset.unit, wholeColumn: true, layers: [] });
      return;
    }
    if (kind === "rank" || kind === "cell") { emit(rankPayload(Number(target.dataset.rank))); return; }
    if (kind === "node") {
      emit(rankPayload(Number(target.dataset.rank)), Number(target.dataset.node));
      return;
    }
    if (kind === "expert") {
      /* 专家在**每个 MoE 层**都有一份实例，「哪一个」要靠 stage / layer / DP 副本
         三件事定死 —— 平面视图里这三件事就写在格子的坐标上，直接交给主脚本，
         不必像原版那样先在别处点一下把宫格「绑定」起来。
         ⚠️ 这四个值挂在**父格子**上，不在胶囊上：一格里的胶囊共用同一套坐标，
         写在格子上是 1 次属性写、写在胶囊上是 epr 次（见 render 里那段注释）。 */
      const host = target.closest(".crop-cell");
      if (!host) { emit(null); return; }
      const co = topology.coordsOfRank(Number(host.dataset.rank));
      emit({
        kind: "expert",
        expert: Number(target.dataset.expert),
        epRank: Number(host.dataset.epRank),
        deckNode: "expert_pool",
        scopeStage: Number(host.dataset.stage),
        scopeLayer: Number(host.dataset.layer),
        dpIdx: co.dpIdx,
      });
      return;
    }
    emit(null);
  }

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
      view.x -= event.deltaY;
      applyTransform();
      scheduleRenderSoft();
      return;
    }
    zoomBy(Math.exp(-event.deltaY * 0.0015), cx, cy);
  }, { passive: false });

  stage.addEventListener("dblclick", (event) => {
    if (event.target.closest("[data-kind], .crop-tp-bracket, .crop-tp-marker")) return;
    fit();
  });

  zoomIn.addEventListener("click", () => zoomBy(1.25));
  zoomOut.addEventListener("click", () => zoomBy(1 / 1.25));
  fitBtn.addEventListener("click", fit);

  // 画布上的键盘可达性：Tab 进来之后方向键平移、+/- 缩放、0 适配
  stage.tabIndex = 0;
  stage.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 120 : 40;
    if (event.key === "ArrowLeft") view.x += step;
    else if (event.key === "ArrowRight") view.x -= step;
    else if (event.key === "ArrowUp") view.y += step;
    else if (event.key === "ArrowDown") view.y -= step;
    else if (event.key === "+" || event.key === "=") { zoomBy(1.25); return; }
    else if (event.key === "-" || event.key === "_") { zoomBy(1 / 1.25); return; }
    else if (event.key === "0") { fit(); return; }
    else return;
    event.preventDefault();
    applyTransform();
    scheduleRenderSoft();
  });

  /* ══ 六、右栏详情 ════════════════════════════════════════════════════════ */
  /* 可点的胶囊是按钮（右栏因此也是一个选择入口，与画布互为反向查询），
     不可点的是 span —— 不给读屏和 Tab 序添一个按不动的站点。 */
  function chip(text, tip, onClick) {
    const node = el(onClick ? "button" : "span",
      `crop-chip${onClick ? "" : " crop-chip--static"}`, text);
    if (onClick) {
      node.type = "button";
      node.addEventListener("click", onClick);
    }
    if (tip) node.title = tip;
    return node;
  }

  function kvRow(key, nodes, plain) {
    const row = el("div", "crop-kv");
    row.appendChild(el("span", "crop-kv__k", key));
    const v = el("span", `crop-kv__v${plain ? " crop-kv__v--plain" : ""}`);
    if (typeof nodes === "string") v.textContent = nodes;
    else nodes.forEach((n) => v.appendChild(n));
    row.appendChild(v);
    return row;
  }

  function section(title) {
    const sec = el("div", "crop-sec");
    sec.appendChild(el("div", "crop-sec__title", title));
    return sec;
  }

  /* 一串编号 → 一排胶囊（连号折成区间，超出 CHIP_CAP 折成「+N」）。
     onPick 给了就可点：右栏因此也是一个选择入口，与画布互为反向查询。 */
  function chipRun(values, label, onPick) {
    const runs = runsOf(values);
    const out = [];
    runs.slice(0, CHIP_CAP).forEach(([a, b]) => {
      const text = a === b ? `${label} ${a}` : `${label} ${a}–${b}`;
      out.push(chip(text, null, onPick && a === b ? () => onPick(a) : null));
    });
    if (runs.length > CHIP_CAP) {
      const rest = runs.slice(CHIP_CAP).reduce((n, [a, b]) => n + (b - a + 1), 0);
      out.push(el("span", "crop-chip crop-chip--more", `+${rest}`));
    }
    return out;
  }

  /* 关系集里第一个 MoE 层。没有就退回第一个层（稠密模型下右栏本来也不列专家）。 */
  function firstMoeLayer(layers) {
    let fallback = null;
    for (const l of layers) {
      if (fallback == null) fallback = l;
      if (topology.layers[l] && topology.layers[l].ffn === "moe") return l;
    }
    return fallback;
  }

  /* ══ 六之二、静息态右栏：当前配置评估 ══════════════════════════════════════
     没选东西时右栏原先只有一句「点点看」。但这一栏最该在**没选东西**的时候回答
     的问题不是「怎么用」，而是「手上这份配置到底能不能跑」—— 那是打开这一页的
     第一个动机，也是左栏拨完十几个数之后每次都要重新问一遍的事。选中态答的是
     「这个对象是什么」，静息态该答的是「这份配置怎么样」，两者不是同一个问题。

     四层判据分开列、不揉成一个总分（超参寻优.md 五之3.3：「关键不是只让预测更准，
     而是让用户知道准到什么程度」）：
       L-A 可行性  布尔。硬约束，过不了连被排名的资格都没有。
       L-B 容量    有公式、有分段口径，误差来自待标定的系数 —— 排序可信，绝对值待校准。
       L-C 效率    气泡率有闭式解，重计算开销是经验系数，而吞吐与 step time
                   **本页没有模型**。那一行必须如实写「未建模」，不拿编出来的数占位。
       L-D 风险    跨机通信域、软告警，以及这份估算本身的证据等级。
     把 C 的估算和 B 的公式画成同一副长相就是在骗人，所以每一行右侧都带证据标。

     数据面只有两个，都是已经存在的：topology（含 warnings / counts / preset / card）
     与 croCapacityModel.measureAll（容量栏那份 measure）。这里**不自己算一遍显存**
     —— 同一页两处各报一个不同的显存数，是这一页最不能出的错。
     ═════════════════════════════════════════════════════════════════════════ */
  const GIB = 1024 * 1024 * 1024;

  /* 证据等级（超参寻优.md 五之3.3 的 A/B/C/D）。这一页目前一个实测数都没有，
     所以只用得到后两档；标签仍按三种写全，将来接上短跑回流时不必改这里的形状。 */
  const EVIDENCE = {
    formula: {
      tag: "公式",
      title: "证据等级：解析式\n\n由本页已有的口径直接算出，不含经验系数 —— "
        + "换一组参数它一定跟着变，且变的方向可以推导。",
    },
    est: {
      tag: "估算",
      title: "证据等级 C：带经验系数的估算\n\n量级与排序可信，绝对值待实测标定。"
        + "本页的运行时开销系数与部分卡型 HBM 仍是占位值 —— 拿它比较两份配置是稳的，"
        + "拿它承诺「一定不 OOM」不稳。",
    },
    none: {
      tag: "未建模",
      title: "证据等级 D：本页没有这一项的模型\n\n「未建模」不等于「等于零」，"
        + "是「算不出来」。要补上它得靠短跑实测（超参寻优.md 六之3 的候选评测那一步）。",
    },
  };

  /* 一行指标：名 · 读数 · 证据标。等级只染读数的颜色，不整行铺底 ——
     一栏里摞十几行，铺底会让「偏满」看着比「越界」还吵。 */
  function metric(name, value, opts) {
    const o = opts || {};
    const row = el("div", "crop-metric");
    /* pending = 这一项只有真跑一遍才知道。此刻**不写结果** —— 摆一个占位读数、
       和旁边那些算得出来的数长成同一副样子，就是在冒充已知。等级一并压成 none
       （灰点），因为「还没跑」既不是通过也不是不通过。 */
    const pending = !!o.pending;
    if (pending) row.dataset.pending = "1";
    const lv = pending ? "none" : (o.level || "");
    if (lv) row.dataset.level = lv;
    /* 行首那枚色点：整栏纵向扫下来就是一份巡检清单（绿通过 / 黄偏紧 / 红越界 /
       灰未知），不必逐行读数字才看得出这一层有没有事。颜色只由 data-level 定，
       见 css 里 .crop-metric__dot 那几条。 */
    row.appendChild(el("span", "crop-metric__dot"));
    if (o.tip) row.title = o.tip;
    row.appendChild(el("span", "crop-metric__k", name));
    row.appendChild(el("span", "crop-metric__v", pending ? "待实跑" : value));
    const ev = EVIDENCE[pending ? "none" : (o.evidence || "formula")];
    const tag = el("span", "crop-metric__ev", ev.tag);
    tag.title = ev.title;
    row.appendChild(tag);
    return row;
  }

  /* 一层评估 = 一个 crop-sec，标题前挂层号。层号不是装饰：四层的判据性质不同，
     混在一张平表里读，会让「预计 OOM」和「气泡率 23%」看着一样硬。 */
  function gradeSec(tag, title, note, opts) {
    const o = opts || {};
    const sec = el("div", "crop-sec crop-grade");
    /* 整层待实跑（L-C）：压暗一档，让「这一层现在还答不了」在扫版时就看得见，
       而不必逐行去读那几个「待实跑」。 */
    if (o.pending) sec.dataset.pending = "1";
    const head = el("div", "crop-sec__title crop-grade__head");
    head.appendChild(el("span", "crop-grade__tag", tag));
    head.appendChild(el("span", "crop-grade__name", title));
    /* 每层那一段导读原先是标题下方一整段小字 —— 四层摞起来就是四段，评估栏第一屏
       全是解释、一个读数都看不见。它答的是「这一层的判据是什么性质」，属于要看才看，
       所以改挂成标题右侧的问号（走页面统一的 data-hint 气泡，与 MoE 那节标题同一套：
       observer 的 installHints 是 document 级委托，这里只要造出触发点即可）。 */
    if (note) head.appendChild(gradeHint(note));
    sec.appendChild(head);
    return sec;
  }

  /* ── 单卡容量卡片 ──────────────────────────────────────────────────────
     容器造一次就留着（capWrap），每次 renderAssessment 只把它重新挂到 L-B 下面：
     #croCapacity 本体自始至终是同一个节点，config-relation-capacity.js 挂在它上面
     的监听与逐段写入原样有效 —— 这一栏的权威实现在那边，本文件一个数都不重算。
     默认收起：它答的是「那 78% 里装的是什么」，属于点开看构成，不是第四层判据。 */
  let capWrap = null;
  let capToggle = null;
  let capCollapsed = true;

  function syncCapCard() {
    if (!capWrap) return;
    capWrap.classList.toggle("is-collapsed", capCollapsed);
    capToggle.setAttribute("aria-expanded", String(!capCollapsed));
    capToggle.title = capCollapsed ? "展开单卡容量" : "收起单卡容量";
  }

  function capCard() {
    if (!capWrap) {
      capWrap = el("div", "crop-capcard");
      capToggle = el("button", "crop-capcard__toggle");
      capToggle.type = "button";
      capToggle.setAttribute("aria-label", "单卡容量");
      capToggle.innerHTML = '<svg class="crop-capcard__chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';
      capToggle.appendChild(el("span", "crop-capcard__label", "单卡容量 · 这 78% 里装的是什么"));
      capToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        capCollapsed = !capCollapsed;
        syncCapCard();
      });
      capWrap.appendChild(capToggle);
      capWrap.appendChild(capacity);
    }
    /* 标题里那个百分比要跟着当前最紧的卡走，不能写死 */
    syncCapCard();
    return capWrap;
  }

  /* 与 observer 的 buildHint 同款触发点（.cro-hint + data-hint）。不直接调那一个，
     是因为它没挂到 global 上；样式与气泡逻辑仍旧完全共用，这里不另起一套。 */
  function gradeHint(text) {
    const btn = el("button", "cro-hint");
    btn.type = "button";
    btn.dataset.hint = String(text);
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "说明");
    btn.textContent = "?";
    return btn;
  }

  const pctText = (x) => `${Math.round(x * 100)}%`;
  const gbText = (bytes) => `${(bytes / GIB).toFixed(1)} GB`;

  function renderAssessment() {
    const topo = topology;
    const c = topo.counts;
    const cfg = topo.config || {};
    const preset = topo.preset || {};
    const perNode = c.ranksPerNode || 8;
    const model = global.croCapacityModel || null;
    const all = model ? model.measureAll(topo) : [];
    const fullest = all.length ? all.reduce((a, b) => (b.ratio > a.ratio ? b : a), all[0]) : null;
    const thinnest = all.length ? all.reduce((a, b) => (b.ratio < a.ratio ? b : a), all[0]) : null;
    const level = fullest ? model.levelOf(fullest.ratio) : "none";
    const tightLine = model ? model.THRESHOLD.tight : 0.70;

    /* ── 总判定：一句话回答「能不能跑」──────────────────────────────────
       等级完全由容量定 —— 前两关到得了这里就已经是过了的：不自洽的配置根本发不出
       cro:change（见主脚本 emit 末尾那句 return），画布与本栏都停在上一组自洽参数上。
       第三关是唯一一个「配得通、也切得开，却仍然跑不起来」的关卡。 */
    const HEAD = {
      safe: "预计可跑", tight: "可跑 · 余量偏紧",
      alert: "可跑 · 已越预警线", over: "预计 OOM", none: "容量未估算",
    };
    const bar = el("div", "crop-verdict");
    bar.dataset.level = level;
    const barHead = el("div", "crop-verdict__head");
    /* 判定语做大（title-sm 一档）并前置一枚同色状态点：这是整栏唯一一句要在一米开外
       就读得到的话 —— 打开这一页的第一个动机就是它。其余各行仍是正文尺寸，
       不跟着抬，否则「大」就不再是重点而是噪音。 */
    const badge = el("span", "crop-verdict__badge");
    badge.appendChild(el("span", "crop-verdict__badge-dot"));
    badge.appendChild(el("span", "crop-verdict__badge-text", HEAD[level] || HEAD.none));
    barHead.appendChild(badge);
    barHead.appendChild(el("span", "crop-verdict__scope",
      fullest ? `最紧 Stage${fullest.stage} · ${pctText(fullest.ratio)}` : "—"));
    bar.appendChild(barHead);
    /* ── 语义可视化：一根占用尺 ────────────────────────────────────────
       「预计可跑」是个结论，凭据是「最紧的那张卡装到了几成」。把那一成画出来，
       连同 70% 波动线的刻度 —— 判定的颜色于是有了一个看得见的来处，而不是
       一个要读完下面整段文字才成立的断言。没有可估算 stage 时不画。 */
    if (fullest) {
      const gauge = el("div", "crop-verdict__gauge");
      gauge.title = `${gbText(fullest.total)} / ${gbText(fullest.cap)}`
        + `（Stage${fullest.stage}），波动线 ${pctText(tightLine)}`;
      const fill = el("div", "crop-verdict__gauge-fill");
      fill.style.width = `${Math.min(100, Math.max(2, fullest.ratio * 100))}%`;
      const mark = el("div", "crop-verdict__gauge-mark");
      mark.style.left = `${tightLine * 100}%`;
      gauge.append(fill, mark);
      bar.appendChild(gauge);
      const scale = el("div", "crop-verdict__gauge-scale");
      scale.appendChild(el("span", null, gbText(fullest.total)));
      scale.appendChild(el("span", null, `波动线 ${pctText(tightLine)}`));
      scale.appendChild(el("span", null, gbText(fullest.cap)));
      bar.appendChild(scale);
    }
    let barText;
    if (!fullest) {
      barText = "当前没有可估算的 stage。";
    } else if (level === "over") {
      barText = `最紧的那张卡要装 ${gbText(fullest.total)}，超出单卡 ${gbText(fullest.cap)} `
        + `共 ${gbText(fullest.total - fullest.cap)}。前两关都过了，卡在第三关「跑得下」—— `
        + `OOM 会在前几个 step 发生，而那时通常已经排了几小时队。`;
    } else if (level === "alert" || level === "tight") {
      barText = `最紧的那张卡装 ${gbText(fullest.total)} / ${gbText(fullest.cap)}，`
        + `余量 ${gbText(fullest.cap - fullest.total)}。预留段本身还在逐 step 波动，`
        + `「还没满」不等于「跑得下」——`
        + (level === "alert" ? "这一档建议先减容器再开训。" : "这一档可跑，但没给抖动留多少地方。");
    } else {
      barText = `三关都过：并行维乘积对得上卡数、切分维度整除得了模型结构、`
        + `最紧的那张卡装 ${gbText(fullest.total)} / ${gbText(fullest.cap)}，`
        + `还剩 ${gbText(fullest.cap - fullest.total)}。`;
    }
    bar.appendChild(el("p", "crop-verdict__text", barText));
    rightFacts.appendChild(bar);

    /* ── L-A 可行性 ──────────────────────────────────────────────────── */
    const secA = gradeSec("L-A", "可行性", "三关都是硬约束。不自洽的配置在左栏就被拦下并停更下游，"
      + "所以这里看得到的一定是一份已经过关的配置 —— 这几行说的是「过在哪」，不是「过没过」。");
    const worldFactors = [`DP ${c.dp}`, `PP ${c.pp}`, `TP ${c.tp}`, `CP ${c.cp}`];
    const worldNums = [c.dp, c.pp, c.tp, c.cp];
    if (c.epMode === "orthogonal") { worldFactors.push(`EP ${c.ep}`); worldNums.push(c.ep); }
    secA.appendChild(metric("配得通", `${worldNums.join("×")} = ${c.totalRank}`, {
      level: "safe",
      tip: `并行维乘积对得上卡数：${worldFactors.join(" × ")} = ${c.totalRank} = Total Rank。\n\n`
        + (c.epMode === "orthogonal"
          ? "正交档下 EP 独占 rank，进乘积。"
          : `${c.epMode === "mf" ? "mf" : "切出"}档下 EP 是从已有的卡里再切一刀，不进乘积。`)
        + `\nVPP ${c.vpp} 同样不进乘积 —— 它一张卡都不多占，只把本卡的层再拆成几段轮流跑。`
        + "\n\n这一关不过，启动器当场拒绝，秒级失败。",
    }));
    const splits = [];
    if (preset.heads) splits.push(`注意力头 ${preset.heads} ÷ TP ${c.tp} = ${preset.heads / c.tp} 头/卡`);
    if (c.cp > 1 && c.cpMode === "ulysses" && preset.heads) {
      splits.push(`Ulysses 档：头 ${preset.heads} ÷ (TP×CP = ${c.tp * c.cp}) = ${preset.heads / (c.tp * c.cp)}`);
    }
    if (c.cp > 1 && c.cpMode !== "ulysses") {
      splits.push(`Ring 档：Seq ${cfg.seqLen} ÷ 2×CP ${2 * c.cp} = ${cfg.seqLen / (2 * c.cp)}`);
    }
    if (preset.denseIntermediate) splits.push(`Dense intermediate ${preset.denseIntermediate} ÷ TP ${c.tp}`);
    if (c.moeLayers && preset.moeIntermediate) splits.push(`MoE intermediate ${preset.moeIntermediate} ÷ TP ${c.tp}`);
    splits.push(`${c.totalLayer} 层分 ${c.pp} 个 PP stage`
      + (c.vpp > 1 ? `，再按 VPP ${c.vpp} 交错（层数须被 PP×VPP = ${c.pp * c.vpp} 整除）` : "（本页允许不均分）"));
    if (c.moeLayers) {
      splits.push(`路由专家 ${c.routedExpert} ÷ EP ${c.ep} = ${c.expertsPerEpRank} 个/卡`);
      splits.push(`Top-K ${c.topK} ≤ 路由专家 ${c.routedExpert}`);
    }
    secA.appendChild(metric("切得开", `${splits.length} 条整除全通过`, {
      level: "safe",
      tip: "切分维度整除得了被它切的模型结构：\n· " + splits.join("\n· ")
        + "\n\n这一关不过，框架建图时报错，分钟级失败。",
    }));
    secA.appendChild(metric("跑得下", fullest ? `${pctText(fullest.ratio)} · Stage${fullest.stage}` : "—", {
      level, evidence: "est",
      tip: "最紧的那张卡装不装得下 —— 详见下面 L-B 与本栏底部的「单卡容量」。\n\n"
        + "它是唯一一个「配得通、也切得开，却仍然跑不起来」的关卡，"
        + "而且失败发生在前几个 step，那时通常已经排了几小时队。",
    }));
    rightFacts.appendChild(secA);

    /* ── L-B 容量 ────────────────────────────────────────────────────── */
    const secB = gradeSec("L-B", "容量", "与「单卡容量」卡片完全同源（同一份 measure，不另算一遍）。"
      + "这几个数适合用来比较两份配置的高下，不适合当成「一定不会 OOM」的承诺。");
    if (fullest) {
      secB.appendChild(metric("最紧的卡", `Stage${fullest.stage} · ${pctText(fullest.ratio)}`, {
        level, evidence: "est",
        tip: `${gbText(fullest.total)} / ${gbText(fullest.cap)}，在飞 ${fullest.inflight} 份 micro-batch。\n\n`
          + "取最满的那一张而不是平均：容量在集群上本来就不均（各 stage 层数不等、"
          + "stage0 多背 embedding、末段多背 head），而 OOM 只需要一张卡爆。",
      }));
      /* 「最紧的卡」这一行给的是一个占比，而「装的到底是什么」全在单卡容量那一栏里
         —— 六段柱子逐段写着权重 / 梯度 / 优化器 / 激活 / 预留。它原先与评估栏并列摆在
         右栏底部，读的人得先记住 78% 再滚下去找那根柱子。改成挂在这一行**正下方**的
         一张卡片：占比与它的构成前后相邻，一句「为什么是 78%」当场答完。
         默认收起 —— 它是「点开看构成」，不是评估栏的第四层判据；展开态记在
         capCollapsed 上，本次会话内跨重渲染保留（renderAssessment 每次都重跑）。 */
      if (capacity) {
        secB.appendChild(capCard());
        capToggle.querySelector(".crop-capcard__label").textContent =
          `单卡容量 · 这 ${pctText(fullest.ratio)} 里装的是什么`;
      }
      const spread = thinnest && thinnest.ratio > 0 ? fullest.ratio / thinnest.ratio : 1;
      const spreadLevel = spread < 1.10 ? "safe" : (spread < 1.30 ? "tight" : "alert");
      secB.appendChild(metric("stage 间不平衡", `×${spread.toFixed(2)}`, {
        level: spreadLevel, evidence: "est",
        tip: `最满 Stage${fullest.stage} ${pctText(fullest.ratio)} ÷ 最空 Stage${thinnest.stage} ${pctText(thinnest.ratio)}。\n\n`
          + "这是本页独有的一个可观测量：1F1B 下 Stage0 在飞的 micro-batch 最多、天然最重，"
          + "但差得越多，整个集群就被最紧那一张卡浪费得越多 —— "
          + "PP 的层分配、按层数重计算、VPP 都能把它压平。\n"
          + "×1.10 以内算齐，超过 ×1.30 值得回头看 PP 是怎么切的。",
      }));
      const stuck = fullest.values.base + fullest.values.reserve;
      const stuckShare = stuck / fullest.total;
      const stuckLevel = stuckShare < 0.25 ? "safe" : (stuckShare < 0.40 ? "tight" : "alert");
      secB.appendChild(metric("压不掉的那部分", `${gbText(stuck)} · ${pctText(stuckShare)}`, {
        level: stuckLevel, evidence: "est",
        tip: `运行时底座 ${gbText(fullest.values.base)}（固定，与配置无关）\n`
          + `+ 通信 buffer ${gbText(fullest.reserveParts.comm)}（∝ HCCL 通信域个数）\n`
          + `+ 算子 workspace ${gbText(fullest.reserveParts.workspace)}（∝ 一层的 token 张量）\n`
          + `+ 碎片 ${gbText(fullest.reserveParts.frag)}（∝ 已用量）\n`
          + (fullest.reserveParts.unshard > 0
            ? `+ FSDP2 all-gather 暂存 ${gbText(fullest.reserveParts.unshard)}\n` : "")
          + "\n这几段调重计算、调分片都压不掉。占比越高，说明并行域开得越碎 —— "
          + "「加 EP / 加 PP 减容器」到某个点之后会开始反过来吃显存，就是这一行先看出来的。",
      }));
      const room = fullest.cap * tightLine - fullest.total;
      secB.appendChild(metric(`距 ${pctText(tightLine)} 波动线`,
        `${room >= 0 ? "+" : "−"}${gbText(Math.abs(room))}`, {
          level: room >= 0 ? "safe" : (fullest.ratio > 1 ? "over" : "alert"), evidence: "est",
          tip: "波动线不是 OOM 线：预留段算的是**稳态值**，而通信 buffer 与碎片本身还在逐 step 波动，"
            + `越过 ${pctText(tightLine)} 之后这点波动就足以把余量吃光。\n\n`
            + "寻优时这条线该当**约束**用（峰值 ≤ 它），而不是当目标去逼近 —— "
            + "把占比顶到 100% 的推荐会系统性地推出一批在真实抖动下 OOM 的配置。",
        }));
    } else {
      secB.appendChild(el("p", "crop-grade__note", "当前没有可估算的 stage。"));
      /* 没有可估算的 stage 就没有那张卡片可挂，容量栏得有个去处 —— 不放回右栏
         底部的话它会跟着上一次的 capWrap 一起从 DOM 里消失。 */
      if (capacity && capacity.parentNode !== rightBody) {
        rightBody.insertBefore(capacity, structureSec || null);
      }
    }
    rightFacts.appendChild(secB);

    /* ── L-C 效率 ────────────────────────────────────────────────────── */
    /* L-C 整层压暗：这一层要回答的正题（跑得多快）本页给不出，只有两个解析式
       和一个经验系数陪着 —— 版面上就该比 L-A / L-B 轻一档，而不是与它们并列。 */
    const secC = gradeSec("L-C", "效率", "这一层目前只有解析式。吞吐与 step time 本页没有模型，"
      + "那一行如实写「未建模」—— 不拿一个编出来的数占位，是这一栏能被信任的前提。\n\n"
      + "标着「待实跑」的几行不写结果：它们只有真跑一遍（短跑实测回流）才知道，"
      + "此刻摆一个占位数就是在冒充已知。", { pending: true });
    const bubble = c.pp > 1 ? (c.pp - 1) / (Math.max(1, c.microBatchNum) * Math.max(1, c.vpp)) : 0;
    const bubbleLevel = c.pp <= 1 ? "safe" : (bubble < 0.05 ? "safe" : (bubble < 0.15 ? "tight" : "alert"));
    secC.appendChild(metric("流水线气泡", c.pp > 1 ? pctText(bubble) : "—（PP=1，无流水线）", {
      level: bubbleLevel,
      tip: c.pp > 1
        ? `(PP ${c.pp} − 1) ÷ (micro_batch_num ${c.microBatchNum} × VPP ${c.vpp}) = ${pctText(bubble)}\n\n`
          + "流水线里空转掉的那部分时间。这是本页少数几个有闭式解、不带经验系数的效率量。\n\n"
          + "压它只有两条路：抬 micro_batch_num（代价只有一步墙钟变长，显存越过 PP×VPP 之后不再变），"
          + "或开 VPP（代价是激活峰值整体抬高、stage 间通信按 VPP 倍增）。"
        : "PP = 1，没有流水线，也就没有气泡。",
    }));
    const RECOST = { none: 0, selective: 0.20, full: 0.30 };
    const rmode = cfg.recomputeMode || "none";
    let recost = RECOST[rmode] || 0;
    let recostNote = "";
    if (rmode === "layers" && all.length) {
      const rl = all.reduce((n, m) => n + m.recomputed, 0);
      const tl = all.reduce((n, m) => n + m.layers, 0);
      recost = tl ? 0.30 * (rl / tl) : 0;
      recostNote = `全网 ${tl} 层里重算了 ${rl} 层，按「全开」的 +30% 线性折算。\n\n`;
    }
    const recostLevel = recost < 0.05 ? "safe" : (recost < 0.25 ? "tight" : "alert");
    secC.appendChild(metric("重计算算力开销", recost > 0 ? `约 +${pctText(recost)}` : "0（未开）", {
      level: recostLevel, evidence: "est", pending: recost > 0,
      tip: (recost > 0 ? `若按经验系数折算约 +${pctText(recost)} —— 但这是算力开销，`
          + "本页没有算力模型，实际拖慢多少要跑一遍才知道。\n\n" : "")
        + recostNote
        + "反向要多跑一遍前向。前向 : 反向 ≈ 1 : 2，所以整层重算 ≈ +1/3 ≈ +30%（「全开」档），"
        + "只重算 FFN 段的「选择性」档取 +20%。\n\n"
        + "⚠️ 本页的容量栏未建模算力，这个数是经验系数，不是从算子测出来的。"
        + "它的用处是提醒：重计算是这一页汇率最高的省显存旋钮，但不是免费的 —— "
        + "把它当作 L-B 那根柱子的价签来读。",
    }));
    const mbs = Math.max(1, cfg.microBatch || 1);
    const gbs = mbs * Math.max(1, cfg.dp || 1) * Math.max(1, c.microBatchNum);
    const tokens = gbs * Math.max(1, cfg.seqLen || 1);
    secC.appendChild(metric("一步过的 token", tokens.toLocaleString("en-US"), {
      tip: `Global Batch ${gbs} 条 × Seq Length ${cfg.seqLen} = ${tokens.toLocaleString("en-US")} token。\n`
        + `其中 Global Batch = Micro Batch ${mbs} × DP ${cfg.dp} × micro_batch_num ${c.microBatchNum}。\n\n`
        + "它是训练语义的一部分，不是性能旋钮：寻优器可以重新分配 MBS 与 micro_batch_num，"
        + "但**不能改这个乘积** —— 改了就不是同一次训练，两份配置的 loss 曲线不再可比。",
    }));
    secC.appendChild(metric("吞吐 / step time", "未建模", {
      level: "none", evidence: "none", pending: true,
      tip: "本页没有算力模型、没有 HCCL 效率模型，也没有实测回流，因此给不出 tokens/s 或 step time。\n\n"
        + "这一格正是「配置分析」与「配置寻优」的分界：没有它，页面只能回答「合不合法、装不装得下」，"
        + "回答不了「哪一组最快」。补它的路子是候选短跑实测，不是再加一个公式。",
    }));
    rightFacts.appendChild(secC);

    /* ── L-D 风险与可信度 ────────────────────────────────────────────── */
    const secD = gradeSec("L-D", "风险与可信度", "跨机通信域是断崖式的代价，不是线性扣分；"
      + "而估算本身的证据等级，决定了上面那些数值敢不敢直接拿去开训。");
    const tpcpSpan = Math.max(1, c.tp * c.cp);
    const tpcpCross = tpcpSpan > perNode;
    secD.appendChild(metric("TP×CP 域", `${tpcpSpan} 卡 / 整机 ${perNode} 卡`, {
      level: tpcpCross ? "alert" : "safe",
      tip: tpcpCross
        ? `TP ${c.tp} × CP ${c.cp} = ${tpcpSpan} 张卡，超过单机 ${perNode} 卡 —— 张量并行组被迫跨节点。\n\n`
          + "机内走 HCCS，出了这台机器走 RDMA，慢一个数量级；而 TP 的通信是每层都要的。\n"
          + "寻优时这条该当**硬红线**用：跨机的候选无论显存数字多好看，都该直接降权而不是参与排序。"
        : `TP ${c.tp} × CP ${c.cp} = ${tpcpSpan} 张卡，落在单机 ${perNode} 卡之内，全程走 HCCS。\n\n`
          + "这是这一页最该守住的一条边界 —— TP 通信最频密，一旦跨出单机就是断崖。",
    }));
    if (c.moeLayers && c.ep > 1) {
      const epSpan = Math.max(1, c.ranksPerDp);
      const epNodes = Math.ceil(epSpan / perNode);
      secD.appendChild(metric("EP all-to-all 域", `${epSpan} 卡 · ${epNodes} 台`, {
        level: epNodes <= 1 ? "safe" : "tight",
        tip: `一整套专家摊在 ${c.ep} 个 EP rank 上，连同组内的 ${Math.max(1, c.ranksPerEp)} 卡，`
          + `整个域横跨 ${epSpan} 张卡 / ${epNodes} 台机器。\n\n`
          + "每个 MoE 层要走两次 all-to-all。EP 越大，每卡背的专家参数越少，"
          + "但这两次 all-to-all 横跨的机器越多 —— 这是 MoE 配置里最典型的一笔权衡，"
          + "而它在纯显存视角下完全看不见。",
      }));
    }
    const warns = topo.warnings || [];
    secD.appendChild(metric("软告警", warns.length ? `${warns.length} 条` : "无", {
      level: warns.length ? "tight" : "safe",
      tip: warns.length
        ? "不拦截、但会实打实影响性能或显存的那些事。逐条列在下面。"
        : "当前配置没有触发任何软告警。",
    }));
    warns.forEach((text) => secD.appendChild(el("p", "crop-warn", text)));
    const placeholder = /占位/.test((topo.card && topo.card.hbmNote) || "");
    secD.appendChild(metric("估算证据等级", placeholder ? "D · 含占位数据" : "C · 公式加经验系数", {
      level: placeholder ? "alert" : "tight", evidence: "est",
      tip: (placeholder
        ? `当前卡型「${topo.card.label}」的单卡 HBM 是占位值（${topo.card.hbmNote}），`
          + "L-B 的所有绝对值都建立在这个数上 —— 换算成占比仍可用来排序，但不要拿 GB 数去承诺。\n\n"
        : "")
        + "此外运行时开销的四项系数（底座 / 通信 buffer / workspace / 碎片）标注「待实测标定」。\n\n"
        + "── 四档的定义 ──\n"
        + "A：相同模型、卡型、框架版本的实测；\n"
        + "B：相同算子形状与拓扑的历史数据；\n"
        + "C：白盒公式加部分经验系数；\n"
        + "D：存在未覆盖算子或硬件占位数据。\n\n"
        + "证据不足时，正确的下一步不是硬给一个「最优」，而是去补最有信息价值的那次实测。",
    }));
    rightFacts.appendChild(secD);

    /* 原先那句「点点看」不能丢：它是这幅平面唯一的操作提示。挪到评估之后当页脚，
       静息态因此同时答了两件事 —— 这份配置怎么样、以及接下来能点什么。 */
    rightFacts.appendChild(el("p", "crop-empty",
      "点画布上的 rank 行、layer 列、PP Stage 条或格子里的专家，这里会换成它的详情；"
      + "与它交叉的行、列、格会在画布上同时亮起来。"));
  }

  function renderDetail() {
    rightFacts.replaceChildren();
    const rel = relation;
    const p = rel ? rel.primary : null;
    /* 容量栏在两种状态下住在不同的地方：静息态是 L-B 里的一张可收起卡片（见 capCard），
       选中态回到右栏底部、与「典型 Layer」并列 —— 那里它答的是「选中这张卡装了什么」。
       同一个节点搬来搬去而不是造两份：config-relation-capacity.js 认的是
       #croCapacity 这一个 id，复制一份就等于同页两处各报一个显存数。
       ⚠️ 搬回来只在**有选择**时做；静息态交给紧随其后的 renderAssessment，
       否则一次渲染里节点要被挪两趟。 */
    if (p && capacity && capacity.parentNode !== rightBody) {
      rightBody.insertBefore(capacity, structureSec || null);
    }

    /* 静息态（没选东西）：不再只写一句「点点看」，而是**评估手上这份配置** ——
       能不能跑，以及 L-A~L-D 四层各自的读数（见 renderAssessment 的注释）。
       首帧例外：主脚本 boot 还没把拓扑派下来时（本文件的 script 排在它之后，但
       DOMContentLoaded 那一趟里 renderDetail 可能先跑），没有数可评，退回原来
       那句操作提示 —— 评估栏会在紧随其后的 cro:change 里补上。 */
    if (!p) {
      if (!topology) {
        rightTitle.textContent = "未选中";
        rightFacts.appendChild(el("p", "crop-empty",
          "点画布上的 rank 行、layer 列、PP Stage 条或格子里的专家，这里显示它的详情；"
          + "与它交叉的行、列、格会在画布上同时亮起来。"));
        return;
      }
      rightTitle.textContent = "当前配置评估";
      renderAssessment();
      return;
    }
    if (!topology) return;

    const c = topology.counts;
    // 右栏里的胶囊也走本文件那个 emit —— 它顺带把 pickedNode 清掉，
    // 免得从整机跳到某一层之后标题还挂着「Node N」
    const select = emit;

    const dName = c.edp === c.dp ? "DP" : "EDP";

    if (p.kind === "rank") {
      const co = topology.coordsOfRank(p.rank);

      /* 这一击是从整机档点过来的：底下发出去的仍是首卡的 kind:"rank"（主脚本没有
         node 这一档），但右栏必须按**整机**口径写 —— 标题写 Rank 96 而用户点的是
         「Node 12」，那就是在冒充成一张卡。整机比一张卡多答两件事：这台机器上是哪
         8 张卡，以及它们合起来持有的专家区间。 */
      const asNode = pickedNode != null && co.node === pickedNode;
      if (asNode) {
        const rpn = c.ranksPerNode || 8;
        const lo = pickedNode * rpn;
        const hi = Math.min(c.totalRank - 1, lo + rpn - 1);
        rightTitle.textContent = `Node ${pickedNode}`;
        const box = section("整机");
        box.appendChild(kvRow("本机卡", `rank ${lo}–${hi}（${hi - lo + 1} 张）`, true));
        const coHi = topology.coordsOfRank(hi);
        box.appendChild(kvRow("EP 覆盖", co.epIdx === coHi.epIdx
          ? `EP ${co.epIdx}（整机正好一个 EP 组）`
          : `EP ${co.epIdx}–${coHi.epIdx}（${coHi.epIdx - co.epIdx + 1} 个 EP 组）`, true));
        if (c.expertsPerEpRank > 0) {
          const eLo = topology.expertsOfEpRank(co.epIdx)[0];
          const hiSet = topology.expertsOfEpRank(coHi.epIdx);
          box.appendChild(kvRow("合持路由专家",
            `E${eLo}–E${hiSet[hiSet.length - 1]}（每卡 ${c.expertsPerEpRank} 个）`, true));
        }
        box.appendChild(kvRow("机内互联",
          `${hi - lo + 1} 张卡走 HCCS；出了这台机器走 RDMA，慢一个数量级`, true));
        rightFacts.appendChild(box);
      } else {
        rightTitle.textContent = `Rank ${p.rank}`;
      }

      // 整机档下方这一段说的是**首卡**的坐标，标题必须把这一点讲明白
      const base = section(asNode ? `首卡 rank ${p.rank}` : "基础信息");
      const pos = [
        chip(`${dName} ${co.dpIdx}`, `${dName === "EDP"
          ? `EDP ${c.edp}（DP ${c.dp} ÷ EP ${c.ep}）里的第 ${co.dpIdx} 个完整副本` : "数据并行副本号"}`),
        chip(`PP Stage ${co.stage}`, "这张卡承担的那一段流水线",
          select ? () => select({ kind: "stage", stage: co.stage }) : null),
        chip(`EP ${co.epIdx}`, "它在 all-to-all 域里的位置，决定手上是哪一批路由专家"),
      ];
      if (c.tp > 1) pos.push(chip(`TP ${co.tpIdx}`, `持有该层权重的第 ${co.tpIdx + 1}/${c.tp} 片`));
      if (c.cp > 1) pos.push(chip(`CP ${co.cpIdx}`, `序列的第 ${co.cpIdx + 1}/${c.cp} 段`));
      pos.push(chip(`Node ${co.node}`, `整机 ${c.ranksPerNode} 卡`));
      base.appendChild(kvRow("并行结构位置", pos));
      base.appendChild(kvRow("所在模型层", chipRun(rel.layers, "Layer",
        select ? (l) => select({ kind: "layer", layer: l }) : null)));
      if (c.expertsPerEpRank > 0 && rel.experts.size) {
        base.appendChild(kvRow("持有专家", chipRun(rel.experts, "Expert",
          select ? (e) => select({
            kind: "expert", expert: e, epRank: co.epIdx, deckNode: "expert_pool",
            // scopeLayer 必须落在**MoE 层**上：这一段 PP 的前几层可能是 Dense，
            // 拿它当作用域会让关系集收敛到一个根本没有专家的层
            scopeStage: co.stage, scopeLayer: firstMoeLayer(rel.layers), dpIdx: co.dpIdx,
          }) : null)));
        base.appendChild(kvRow("每 MoE 层专家数",
          `${c.expertsPerEpRank} 路由${c.sharedExpert ? ` + ${c.sharedExpert} 共享` : ""}`, true));
      }
      rightFacts.appendChild(base);
      rightFacts.appendChild(cardSection());
      return;
    }

    if (p.kind === "layer") {
      /* 选中对象可能已经不在新拓扑里（层数被调小的那一帧，主脚本的
         reapplySelection 会跟着清空，但两条通路的先后不该由这里假设）。 */
      const info = topology.layers[p.layer];
      if (!info) return;
      rightTitle.textContent = `Layer ${p.layer}`;
      const base = section("基础信息");
      base.appendChild(kvRow("所属 PP Stage", [
        chip(`PP Stage ${info.stage}`, null, select ? () => select({ kind: "stage", stage: info.stage }) : null),
      ]));
      base.appendChild(kvRow("FFN 类型", info.ffn === "moe" ? "MoE" : "Dense", true));
      base.appendChild(kvRow("Attention", String(info.attention || "std"), true));
      base.appendChild(kvRow("承载卡数", `${rel.ranks.size} 张`, true));
      base.appendChild(kvRow("涉及节点", `${rel.nodes.length} 个`, true));
      rightFacts.appendChild(base);
      const who = section("承载这一层的 rank");
      who.appendChild(kvRow("rank", chipRun(rel.ranks, "rank",
        select ? (r) => {
          const co = topology.coordsOfRank(r);
          select({ kind: "rank", rank: r, stage: co.stage, dpIdx: co.dpIdx, epRank: co.epIdx,
            tpIdx: co.tpIdx, cpIdx: co.cpIdx, node: co.node });
        } : null)));
      rightFacts.appendChild(who);
      rightFacts.appendChild(cardSection());
      return;
    }

    if (p.kind === "stage") {
      const entry = topology.stages[p.stage];
      if (!entry) return;
      rightTitle.textContent = `PP Stage ${p.stage}`;
      const base = section("基础信息");
      base.appendChild(kvRow("层范围", `Layer ${entry.lo}–${entry.hi}`, true));
      base.appendChild(kvRow("层数", `${entry.count} 层`, true));
      base.appendChild(kvRow("卡数", `${rel.ranks.size} 张`, true));
      base.appendChild(kvRow(`${dName} 副本`, `${c.edp} 个 × ${c.ranksPerDp} 卡`, true));
      rightFacts.appendChild(base);
      rightFacts.appendChild(cardSection());
      return;
    }

    if (p.kind === "expert" || p.kind === "epRank") {
      rightTitle.textContent = p.kind === "expert" ? `Expert ${p.expert}` : `EP rank ${p.epRank}`;
      const base = section("基础信息");
      base.appendChild(kvRow("所属 EP rank", `EP ${p.epRank} / ${c.ep}`, true));
      base.appendChild(kvRow("同组专家", chipRun(topology.expertsOfEpRank(p.epRank), "E")));
      base.appendChild(kvRow("落在层", chipRun(rel.layers, "Layer",
        select ? (l) => select({ kind: "layer", layer: l }) : null)));
      base.appendChild(kvRow("落在卡", `${rel.ranks.size} 张`, true));
      rightFacts.appendChild(base);
      rightFacts.appendChild(cardSection());
      return;
    }

    if (p.kind === "sharedExpert") {
      rightTitle.textContent = `共享专家 SE${p.shared}`;
      const base = section("基础信息");
      base.appendChild(kvRow("口径", "每个 token 都经过，不参与 top-K 路由；每张卡一份", true));
      base.appendChild(kvRow("落在层", chipRun(rel.layers, "Layer")));
      rightFacts.appendChild(base);
      rightFacts.appendChild(cardSection());
      return;
    }

    // segment（典型 Layer 里的算子条 / 整列）：右栏给一份口径摘要即可
    rightTitle.textContent = (rel.labels && rel.labels.arch) || "选中对象";
    const base = section("基础信息");
    base.appendChild(kvRow("涉及层", chipRun(rel.layers, "Layer")));
    base.appendChild(kvRow("涉及卡", `${rel.ranks.size} 张`, true));
    rightFacts.appendChild(base);
    rightFacts.appendChild(cardSection());
  }

  /* ══ 热力右栏：一个 rank × layer 交叉格的常驻读数 ═════════════════════════
     relation 负责行 / 列等单对象联动；heatPick 专门负责二维交叉格。两份状态分开，
     点击一列或一行时不会把正在核对的单格读数冲掉。 */
  function heatPickFromCell(cell) {
    if (!cell) return null;
    return {
      rank: Number(cell.dataset.rank),
      stage: Number(cell.dataset.stage),
      layer: cell.dataset.layer == null ? null : Number(cell.dataset.layer),
      unit: cell.dataset.unit || null,
      span: cell.dataset.kind === "node"
        ? Math.max(1, topology.counts.ranksPerNode || 1) : 1,
    };
  }

  function selectHeatCell(cell) {
    heatPick = heatPickFromCell(cell);
    renderHeatDetail();
    scheduleRender();
  }

  /* 当前度量的全图最大格。默认只在真正的 Layer 列里找：Emb / Norm / Head 虽然也
     有成本，但右栏此处的合同是 rank × layer，不能默认选成一个端点结构。 */
  function heatWorstPick() {
    const hm = heatModel();
    if (!hm || !layout) return null;
    /* 专家负载不是“从均衡首帧找最大值”，而是跟踪这次事故的已知塌缩点。
       否则自动播放从 τ=0 起步时会选中一张普通热点卡，动画终局虽然 E193 变红，
       右栏却还停在别处，事故证据永远不会自动出现。 */
    if (heatMetric === "route") {
      const hot = hm.hot();
      if (!hot) return null;
      const stage = topology.stageOfLayer(hot.layer);
      return {
        rank: topology.rankOf(stage, 0, hot.epIdx, 0),
        stage,
        layer: hot.layer,
        unit: null,
        span: 1,
        isIncidentFocus: Boolean(hm.incident()),
        worstMetric: heatMetric,
        worstTau: routeTau,
      };
    }
    let best = null;
    let bestValue = -Infinity;
    layout.blocks.forEach((block) => {
      block.cols.forEach((col) => {
        if (col.type !== "layer") return;
        for (let row = 0; row < layout.ranksPerStage; row += 1) {
          const rank = block.stage * layout.ranksPerStage + row;
          const value = hm.value(heatMetric, col, rank, 1);
          if (!Number.isFinite(value) || value <= bestValue) continue;
          bestValue = value;
          best = {
            rank, stage: block.stage, layer: col.layer, unit: null, span: 1,
            isWorst: true, worstMetric: heatMetric, worstTau: routeTau,
          };
        }
      });
    });
    return best;
  }

  function selectHeatWorst() {
    heatPick = heatWorstPick();
    renderHeatDetail();
  }

  /* 右栏放大的是“选中这一格”的 Expert Compute，不是全层 256 expert 总览：专家
     集合直接取该格 EP rank 的 expertsOfEpRank()，与配置寻优放大格子的来源完全相同。
     颜色直接走 heatColor，同一根时间轴每 120ms 重绘，因此 E193 的升温与画布上的
     rank 热带严格同拍。 */
  function routeExpertMatrix(hm, col, hot, incident, co) {
    if (!col.moe || !hot) return null;
    const shares = hm.expertRoute(col.layer);
    if (!shares || !shares.length) return null;

    let experts = topology.expertsOfEpRank(co.epIdx).slice();
    const exactObservedMapping = incident && topology.counts.ep === 64
      && co.epIdx === hot.epIdx && !experts.includes(hot.expert);
    /* EP64 事故 trace 只证明 E193 在 rank23，未给同卡另外三位的编号。配置态的连续
       切分与这条观测映射冲突时，不编造三个 ID：保留四个槽位，只写已知的 E193。 */
    if (exactObservedMapping) {
      experts = Array.from({ length: Math.max(1, topology.counts.expertsPerEpRank) }, () => null);
      experts[experts.length - 1] = hot.expert;
    }
    if (!experts.length) return null;

    const known = experts.filter(Number.isFinite);
    const rangeText = known.length
      ? `E${Math.min(...known)}–E${Math.max(...known)}` : `${experts.length} experts`;
    const sec = section(`Expert Compute · 本格 ${rangeText}`);
    sec.classList.add("crop-route-experts");
    const totalTokens = incident ? incident.totalTokens : 0;
    const hotShare = shares[hot.expert] || 0;
    const localShare = known.reduce((sum, expert) => sum + (shares[expert] || 0), 0);
    const alive = known.filter((expert) => totalTokens
      ? Math.round((shares[expert] || 0) * totalTokens) > 0 : (shares[expert] || 0) > 1e-8).length;
    const meta = el("div", "crop-route-experts__meta");
    meta.appendChild(el("span", "crop-route-experts__step",
      `${routeStepText(routeTau)} · ${routePhase(routeTau).tag}`));
    meta.appendChild(el("span", "crop-route-experts__read",
      incident
        ? `本格 ${Math.round(localShare * totalTokens)} token · 活跃 ${alive}/${known.length}`
        : `本格 ${(localShare * 100).toFixed(2)}% · 活跃 ${alive}/${known.length}`));
    sec.appendChild(meta);

    const grid = el("div", "crop-detail__grid crop-route-experts__grid");
    grid.style.setProperty("--crop-chip-cols", String(Math.min(8, experts.length)));
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", `rank ${co.rank} × Layer ${col.layer} 本地专家 token 负载矩阵`);
    experts.forEach((expert) => {
      const knownExpert = Number.isFinite(expert);
      const share = knownExpert ? (shares[expert] || 0) : 0;
      const isHot = expert === hot.expert;
      const chip = el("span", `crop-expert crop-expert--mini crop-route-expert${isHot ? " is-hot" : ""}`,
        knownExpert ? `E${expert}` : "—");
      const tokens = totalTokens ? Math.round(share * totalTokens) : null;
      const load = share * shares.length;
      /* 固定以事故终态 98% 为热端，而不是每帧拿当前最大值重新拉伸：这样正常态整片
         是冷的，E193 真正聚集 token 时才一路走到火红。0.45 次幂抬高中段辨识度。 */
      const u = clamp(Math.pow(share / Math.max(1e-12, ROUTE_COLLAPSE_MAX), 0.45), 0, 1);
      chip.style.setProperty("--crop-heat", heatColor(u));
      if (knownExpert) chip.dataset.expert = expert;
      else chip.classList.add("is-unknown");
      chip.setAttribute("role", "gridcell");
      chip.setAttribute("aria-label", knownExpert
        ? `Expert ${expert}，${tokens == null ? `${(share * 100).toFixed(3)}%` : `${tokens} token`}，均分的 ${load.toFixed(2)} 倍`
        : "事故 trace 未提供本地专家编号");
      chip.title = knownExpert
        ? `E${expert}\n${tokens == null ? `份额 ${(share * 100).toFixed(3)}%` : `${tokens} token · 份额 ${(share * 100).toFixed(3)}%`}\n均分的 ${load.toFixed(2)}×`
        : "该槽位的 expert ID 未出现在事故 trace 中";
      grid.appendChild(chip);
    });
    sec.appendChild(grid);

    const legend = el("div", "crop-route-experts__legend");
    legend.append(
      el("span", "", "0 token"),
      el("span", "crop-heat__legend-ramp"),
      el("span", "", incident && known.includes(hot.expert)
        ? `E${hot.expert} ${Math.round(hotShare * totalTokens)} token` : "高负载"),
    );
    legend.querySelector(".crop-heat__legend-ramp").style.background = HEAT_RAMP_CSS;
    sec.appendChild(legend);
    return sec;
  }

  function renderHeatDetail() {
    heatDetail.replaceChildren();
    const active = center.dataset.mode === "heat";
    heatDetail.hidden = !active || !heatPick;
    if (!active) return;
    rightTitle.textContent = "负载详情";
    if (!heatPick || !topology) {
      heatDetail.hidden = false;
      heatDetail.appendChild(el("p", "crop-empty", "当前度量没有可用的 Layer 格子。"));
      return;
    }

    const hm = heatModel();
    if (!hm) return;
    const c = topology.counts;
    const p = heatPick;
    const co = topology.coordsOfRank(p.rank);
    const col = p.layer == null
      ? { type: "unit", id: p.unit, stage: p.stage }
      : {
        type: "layer", layer: p.layer, stage: p.stage,
        moe: Boolean(topology.layers[p.layer] && topology.layers[p.layer].ffn === "moe"),
      };
    const meta = heatMeta(heatMetric);
    const value = hm.value(heatMetric, col, p.rank, p.span || 1);
    const range = hm.range(heatMetric);
    const pct = Number.isFinite(value) && range
      ? Math.round(clamp((value - range.lo) / Math.max(1e-12, range.hi - range.lo), 0, 1) * 100)
      : null;
    const dName = c.edp === c.dp ? "DP" : "EDP";

    const where = section("选中格");
    where.appendChild(kvRow("位置", `rank ${p.rank} × ${p.layer == null ? (UNIT_LABEL[p.unit] || p.unit) : `Layer ${p.layer}`}`, true));
    where.appendChild(kvRow("当前度量", Number.isFinite(value) ? heatFmt(value, meta) : "不适用", true));
    const isCurrentWorst = p.isWorst && p.worstMetric === heatMetric
      && (heatMetric !== "route" || Math.abs(p.worstTau - routeTau) < 1e-6);
    where.appendChild(kvRow("冷热位置", pct == null ? "—"
      : `${isCurrentWorst ? "Layer 格最大 · " : ""}本图第 ${pct}%`, true));
    where.appendChild(kvRow("物理位置", `PP Stage${co.stage} · Node ${co.node}`, true));
    where.appendChild(kvRow("并行坐标",
      `${dName} ${co.dpIdx} · EP ${co.epIdx} · TP ${co.tpIdx} · CP ${co.cpIdx}`, true));
    heatDetail.appendChild(where);

    const metrics = section("同格指标");
    HEAT_METRICS.forEach((m) => {
      const v = hm.value(m.id, col, p.rank, p.span || 1);
      metrics.appendChild(kvRow(m.label, Number.isFinite(v) ? heatFmt(v, m) : "不适用", true));
    });
    heatDetail.appendChild(metrics);

    /* 专家负载的最热点要能直接完成一次诊断，而不是只给一个红格子。右栏保留定位链
       里的四个可核对原始量：专家 token、dead experts、send/recv、最终判据。 */
    const hot = heatMetric === "route" ? hm.hot() : null;
    const incident = heatMetric === "route" ? hm.incident() : null;
    const expertMatrix = heatMetric === "route" ? routeExpertMatrix(hm, col, hot, incident, co) : null;
    if (expertMatrix) heatDetail.appendChild(expertMatrix);
    const onIncident = hot && incident && p.layer === hot.layer && co.epIdx === hot.epIdx;
    if (onIncident) {
      const evidence = section("事故证据 · step 15203");
      evidence.appendChild(kvRow("聚集专家", `Layer ${incident.layer} · Expert ${incident.expert}`, true));
      evidence.appendChild(kvRow("位置映射", hot.epIdx === incident.epRank
        ? `EP rank ${incident.epRank}`
        : `当前配置 EP rank ${hot.epIdx} · 事故部署 EP rank ${incident.epRank}`, true));
      evidence.appendChild(kvRow("Token 分配",
        `${incident.expertTokens} / ${incident.totalTokens}（${(incident.expertTokens / incident.totalTokens * 100).toFixed(1)}%）`, true));
      evidence.appendChild(kvRow("Dead experts", `${incident.deadExperts} / ${c.routedExpert}`, true));
      evidence.appendChild(kvRow(`事故 rank ${incident.epRank} buffer`, `send=${incident.sendTokens} · recv=${incident.recvTokens}`, true));
      evidence.appendChild(el("p", "crop-warn",
        `Router 输出塌缩为近 one-hot：1 个 EP rank 承载几乎全部 token，其余 ${Math.max(0, c.ep - 1)} 个 rank 空等，最终触发 All-to-All send/recv 失配。`));
      heatDetail.appendChild(evidence);
    }

    const note = hm.note(heatMetric, col, p.rank);
    if (note) heatDetail.appendChild(el("p", "crop-warn", note.trim()));
  }

  /* 卡规格：选中任何对象都值得同屏看到「跑在什么卡上」——右栏下面紧接着就是
     单卡容量（那一栏是这份规格的后果），两块贴在一起才读成一句话。 */
  function cardSection() {
    const card = topology.card || {};
    const sec = section("规格");
    sec.appendChild(kvRow("卡型号", card.label || "—", true));
    sec.appendChild(kvRow("单卡显存", `${card.hbmGB} GB`, true));
    sec.appendChild(kvRow("整机卡数", `${card.ranksPerNode || 8} 卡`, true));
    if (card.specs) {
      const note = el("p", "crop-empty", card.specs);
      note.style.textAlign = "left";
      note.style.padding = "0";
      sec.appendChild(note);
    }
    return sec;
  }

  /* ── 右栏「计算节点」（= 原版的典型 Layer）的两处补写 ─────────────────────
     1) 五列统一拆成两行：第一行只写 Emb / Dense xN / MoE xN / Norm / Head，第二行
        用小字写 PP stage 与 Layer 范围。端点列按 stageAnchor 补范围；Dense / MoE
        则从它们真实覆盖的层反推首尾 stage，不再把层号塞在第一行括号里。
     2) 有选择时只留相关的那几列。336px 的一栏摆五列，每列都窄得读不出算子名；
        而一次选择通常只压住其中一两列 —— 无关的那几列留着只是噪声。
        显隐由 css 做（.is-related / .is-selected 是主脚本铺的），这里只补名字。
     ⚠️ 时序：renderStructure 是 controller.onChange 的监听者，applyRelation 是
     emitSelect 里同步跑的，两者都在 document 派发 cro:change / cro:select **之前**
     完成，所以本函数挂在那两个事件上一定读得到最终的 DOM。 */
  function annotateStructure() {
    if (!topology || !structureSec) return;
    const stages = topology.stages;
    if (!stages || !stages.length) return;
    const first = stages[0];
    const last = stages[stages.length - 1];
    const at = { emb: first, norm: last, head: last };
    const layerSpan = (ffn) => {
      const layers = topology.layers.filter((layer) => layer && layer.ffn === ffn);
      if (!layers.length) return null;
      const lo = layers[0].index;
      const hi = layers[layers.length - 1].index;
      return {
        lo, hi,
        stageLo: topology.stageOfLayer(lo),
        stageHi: topology.stageOfLayer(hi),
      };
    };
    const spans = { dense: layerSpan("dense"), moe: layerSpan("moe") };
    structureSec.querySelectorAll(".cro-structure__col").forEach((col) => {
      const segment = col.dataset.segment;
      const endpoint = at[segment];
      const span = spans[segment] || (endpoint ? {
        lo: endpoint.lo, hi: endpoint.hi,
        stageLo: endpoint.stage, stageHi: endpoint.stage,
      } : null);
      if (!span) return;
      const name = col.querySelector(".cro-structure__name");
      const mark = `${segment}:${span.stageLo}-${span.stageHi}:${span.lo}-${span.hi}`;
      if (!name || name.dataset.cropAnnotated === mark) return;
      const raw = name.dataset.cropBase || name.textContent;
      const base = raw.replace(/（L\d+~L\d+）$/, "");
      name.dataset.cropBase = base;
      /* 五列都分两行写：第一行负责“是什么 / 有几个”，第二行负责“位于哪里”。
         右栏每列只有几十像素宽，把范围塞在第一行括号里会优先截掉位置信息；拆开后
         也不再需要括号，第二行天然就是第一行的定语。 */
      const stageText = span.stageLo === span.stageHi
        ? `PP${span.stageLo}` : `PP${span.stageLo}~PP${span.stageHi}`;
      const atText = `${stageText} · L${span.lo}~L${span.hi}`;
      const text = `${base} ${atText}`;
      name.replaceChildren();
      const top = doc.createElement("span");
      top.className = "cro-structure__name-main";
      top.textContent = base;
      const sub = doc.createElement("span");
      sub.className = "cro-structure__name-at";
      sub.textContent = atText;
      name.append(top, sub);
      name.title = `${base} · ${stageText} · Layer ${span.lo}–${span.hi}`;
      name.setAttribute("aria-label", text);
      name.dataset.cropAnnotated = mark;
    });
  }

  /* 主脚本在 document 上有一条兜底：点到 SELECTABLE 白名单之外 = 清空当前选择
     （见 config-relation-observer.js 里那份名单）。本文件新造的几类可点对象
     ——画布、右栏胶囊、左右栏页签与收起键——当然不在名单里，而名单写在闭包中、
     两页共用，不宜为这一页去改它。
     于是改成**只吞自己那几类**的冒泡：命中就 stopPropagation，其余一律放行 ——
     .cro-hint 的说明气泡、.cro-stepper、单卡容量栏那些原有通路一条都没动。
     （画布整块由上面 stage 那条 click 收口，它里面没有原版的东西。） */
  const OWN_CLICKABLE = ".crop-chip, .crop-tabs [data-pane],"
    + " .crop-left__head button, .crop-right__head button";
  [left, right].forEach((panel) => {
    panel.addEventListener("click", (event) => {
      if (event.target.closest?.(OWN_CLICKABLE)) event.stopPropagation();
    });
  });

  /* ══ 六·五、通信观测档 ═══════════════════════════════════════════════════
     ── 这一档在算什么 ──────────────────────────────────────────────────────
     左栏那五个并行度（TP / CP / EP / PP / DP）在表单里只是五个数字。它们真正的
     代价要到通信里才显形：一次 All-Reduce 到底摊在几张卡上、那几张卡是不是同一
     台机器里的、一个 step 里要发生几轮。这一档把配置**翻译**成一串通信事件，
     每一条现算，不查表、不写死。

     ── 一条通信事件由三件事定死 ────────────────────────────────────────────
       域（domain）  谁和谁通信 —— 一个通信组是 rank 编址里等距的一串
       内容           传的是什么（激活 / 部分和 / 梯度 / token 隐状态）
       链路           这一串 rank 跨不跨机器边界 —— 机内 HCCS 还是机间 RDMA

     第三件是这一档存在的理由。rank 编址是
         rank = stage×ranksPerStage + edp×ranksPerDp + ep×ranksPerEp + inner
     所以每个域在 rank 轴上都是「步长 stride、个数 count」的一串等差数列，跨度
     span = stride×(count−1)+1。拿它和 ranksPerNode（一台机器几张卡）一比就知道
     这一组落在机器里面还是外面 —— 而这正是「同一个 TP=2，摆得对与摆得不对差一
     个数量级」的全部原因。

     ── 口径来源 ────────────────────────────────────────────────────────────
     事件清单按 Profiling_Insight_and_Tool/GPT问答总结-config待办.md 的「层内前向
     与反向通信」「层外或参数同步通信」两张表，与 ParallelDemo 知识库同源。 */

  /* 每个域在 rank 轴上的 (stride, count)。mf 档的 inner 只装 CP、TP 被 EP 那一维
     吃掉（见主脚本 shardOf 的注释），所以 TP / CP 两个域的步长要分档给。 */
  function commDomain(c, id) {
    const mf = c.epMode === "mf";
    switch (id) {
      case "tp":
        return { name: "TP", stride: mf ? c.ranksPerEp : 1, count: Math.max(1, c.tp) };
      case "cp":
        return { name: "CP", stride: mf ? 1 : Math.max(1, c.tp), count: Math.max(1, c.cp) };
      case "ep":
        return { name: "EP", stride: c.ranksPerEp, count: Math.max(1, c.ep) };
      case "edp":
        return { name: "EDP", stride: c.ranksPerDp, count: Math.max(1, c.edp) };
      /* 非专家权重的复制域：成员在 (edp, ep) 两维上铺开，合起来正好铺满一个
         stage，所以步长是 ranksPerEp、个数是 dpReplica（见主脚本 dpReplicaOf）。 */
      case "dp":
        return { name: "DP", stride: c.ranksPerEp, count: Math.max(1, c.dpReplica) };
      /* PP 是**点对点**不是集合通信：一次只有相邻两个 stage 的对应两张卡在说话，
         所以 count 固定是 2，而不是 pp。 */
      case "pp":
        return { name: "PP", stride: c.ranksPerStage, count: c.pp > 1 ? 2 : 1 };
      default:
        return { name: "—", stride: 1, count: 1 };
    }
  }

  /* 一个通信组落在哪几台机器上。返回的 kind 有三档，差别是真的：
       local  整组在一台机器里 —— 走 HCCS，带宽是机间的一个数量级以上
       mixed  组内既有机内成员也有机外的 —— 一次集合通信被机器边界切成两段，
              实际带宽由慢的那一段兜底（这一档最容易被配置调出来，也最容易漏看）
       inter  成员两两不同机 —— 整组走 RDMA */
  function commLink(c, dom) {
    const per = Math.max(1, c.ranksPerNode || 1);
    if (dom.count <= 1) return { kind: "none", label: "无跨卡通信", nodes: 1 };
    const span = dom.stride * (dom.count - 1) + 1;
    const nodes = Math.min(dom.count, Math.ceil(span / per));
    if (span <= per) return { kind: "local", label: "机内 HCCS", nodes: 1 };
    if (dom.stride < per) return { kind: "mixed", label: "机内 HCCS + 机间 RDMA", nodes };
    return { kind: "inter", label: "机间 RDMA", nodes };
  }

  /* 组内成员的 rank 列表（以 anchor 所在的那一组为例）。anchor 默认取当前选中的
     卡 —— 「谁和谁」这个问题问的从来是**具体某张卡**的同伴，选了 rank 2047 却给
     rank 0 的组，答非所问。 */
  function commPeers(dom, anchor) {
    if (dom.count <= 1) return [anchor];
    const idx = Math.floor(anchor / dom.stride) % dom.count;
    const base = anchor - idx * dom.stride;
    const out = [];
    for (let i = 0; i < dom.count; i += 1) out.push(base + i * dom.stride);
    return out;
  }

  function commPeerText(list) {
    if (list.length <= 6) return list.map((r) => `rank ${r}`).join(" · ");
    const head = list.slice(0, 3).map((r) => `rank ${r}`).join(" · ");
    return `${head} … rank ${list[list.length - 1]}（共 ${list.length} 个）`;
  }

  /* ── 事件清单 ────────────────────────────────────────────────────────────
     按「一个 step 里最后一个 micro-batch 穿过一个 layer」的时间序排，三段：
       fwd   前向：进 stage → Attention → Router → MoE → 出 stage
       bwd   反向：主体与前向镜像；梯度就绪后允许插入跨 EDP 的异步梯度桶
       sync  同步 / 更新：等待其余梯度同步完成，并在需要时拼回分片参数
     每条都带一个 when 判据 —— 并行度为 1 的维度不产生通信，那一条整条不出现，
     而不是列出来标一句「本配置下没有」。清单长度本身就是一个读数。 */
  function commSteps(c) {
    const moe = c.moeLayers > 0 && c.ep > 1;
    const ulysses = c.cpMode === "ulysses";
    // 优化器状态切没切，决定更新阶段有没有那一趟参数 All-Gather（见下面最后一条）
    const shardMode = (topology && topology.config && topology.config.shardMode) || "none";
    const sharded = shardMode !== "none";
    /* 每条都带两件事，浮卡直接照读：
         why    传的这份东西是**给谁用的、用来做什么** —— 只写"传部分和"答不了
                「为什么非传不可」，而那才是并行策略贵在哪儿的解释
         kind   这份数据属于哪一类（激活 / 梯度 / 优化器状态）。三类的代价随配置
                变化的方式完全不同（激活跟 batch×seq 走、梯度跟参数量走、优化器
                状态跟切分档走），所以浮卡上单挂一枚标签。路由统计那条两类都不
                沾，就不给标签 —— 硬塞一个进去反而是错的。 */
    const raw = [
      { phase: "fwd", when: c.pp > 1, dom: "pp", module: "Stage 入口", event: "PP Recv",
        payload: "上一个 stage 传来的边界激活 [B,S,H]", kind: "activation",
        why: "本段拿到它才能接着往下算自己负责的那几层", per: "每个 micro-batch 1 次" },
      { phase: "fwd", when: c.cp > 1, dom: "cp", module: "Attention",
        event: ulysses ? "CP All-to-All" : "CP Ring Send/Recv",
        payload: ulysses ? "重排 Q/K/V 与 Attention 输出" : "分块的 K/V",
        kind: "activation",
        why: ulysses
          ? "序列切开之后，每张卡要换成拿完整序列、只算自己那几个 head"
          : "本卡的 Q 要轮流见过所有卡上的 K/V，才算得出完整的注意力",
        per: "每层 1 轮" },
      { phase: "fwd", when: c.tp > 1, dom: "tp", module: "Attention", event: "TP All-Reduce",
        payload: "W_O 行切后，各 TP rank 算出的部分和", kind: "activation",
        why: "几份部分和相加才是这一层完整的 Attention 输出，少一份结果就是错的",
        per: "每层 1 次" },
      { phase: "fwd", when: moe, dom: "ep", module: "Router", event: "All-Reduce（可选）",
        payload: "专家 token 计数、负载均衡统计", kind: null,
        why: "各卡对齐同一份负载统计，才算得出一致的辅助损失与丢弃阈值",
        per: "依实现而定，可能没有" },
      { phase: "fwd", when: moe, dom: "ep", module: "Routed MoE", event: "Dispatch All-to-All",
        payload: "token 隐状态 + 路由信息，从原始 rank 发往专家所在 rank",
        kind: "activation",
        why: "专家只在自己那张卡上，token 必须先送到它那儿才算得了",
        per: "每个 MoE 层 1 次" },
      { phase: "fwd", when: moe, dom: "ep", module: "Routed MoE", event: "Combine All-to-All",
        payload: "专家输出从专家 rank 返回 token 原始 rank", kind: "activation",
        why: "算完的结果要回到 token 原来那张卡，才能接着往下一层走",
        per: "每个 MoE 层 1 次" },
      { phase: "fwd", when: c.sharedExpert > 0 && c.tp > 1, dom: "tp", module: "Shared Expert",
        event: "TP All-Reduce", payload: "共享专家 MLP 的部分和（不走 EP All-to-All）",
        kind: "activation", why: "相加才是共享专家这一路的完整输出，再与路由专家的结果相加",
        per: "每个 MoE 层 1 次" },
      /* Dense 层的 FFN 也是行切的，出口同样要 All-Reduce —— 一层里其实有**两次**
         TP All-Reduce（attention 出口 + FFN 出口，见上面 buildHeat 里那段口径）。
         原先清单只列了 attention 那次，Dense 层在行程里就成了「只有一条通信」，
         与实际差一半。MoE 层的 FFN 走专家那条路（Dispatch/Combine），所以这一条
         只在 Dense 层发生，与上面 MoE 那几条互斥。 */
      { phase: "fwd", when: c.tp > 1, dom: "tp", module: "MLP（Dense）",
        event: "TP All-Reduce", payload: "FFN 行切后，各 TP rank 算出的部分和",
        kind: "activation", why: "相加才是这一层完整的 FFN 输出",
        per: "每个 Dense 层 1 次" },
      { phase: "fwd", when: c.pp > 1, dom: "pp", module: "Stage 出口", event: "PP Send",
        payload: "本 stage 算完的边界激活 [B,S,H]", kind: "activation",
        why: "交给下一段接着做前向，本段这一个 micro-batch 到此为止",
        per: "每个 micro-batch 1 次" },

      { phase: "bwd", when: c.pp > 1, dom: "pp", module: "Stage 出口", event: "PP Recv",
        payload: "下一个 stage 回传的 dL/dx [B,S,H]", kind: "gradient",
        why: "有了下游传回的梯度，本段才能接着往回求导", per: "每个 micro-batch 1 次" },
      // 与前向那条 Dense FFN 严格镜像：反向里它排在最前（前向排在最后）
      { phase: "bwd", when: c.tp > 1, dom: "tp", module: "MLP（Dense）",
        event: "TP All-Reduce", payload: "FFN 行切产生的输入梯度部分和",
        kind: "gradient", why: "相加才是这一层 FFN 输入的完整梯度",
        per: "每个 Dense 层 1 次" },
      { phase: "bwd", when: c.sharedExpert > 0 && c.tp > 1, dom: "tp", module: "Shared Expert",
        event: "TP All-Reduce", payload: "共享专家 MLP 的梯度部分和", kind: "gradient",
        why: "相加才是共享专家那一路的完整输入梯度", per: "每个 MoE 层 1 次" },
      { phase: "bwd", when: moe, dom: "ep", module: "Routed MoE", event: "Combine 反向 All-to-All",
        payload: "输出梯度从 token 原始 rank 发回专家 rank", kind: "gradient",
        why: "专家要拿到自己那份输出梯度，才算得出它自己的权重梯度",
        per: "每个 MoE 层 1 次" },
      { phase: "bwd", when: moe, dom: "ep", module: "Routed MoE", event: "Dispatch 反向 All-to-All",
        payload: "专家算出的输入梯度发回 token 原始 rank", kind: "gradient",
        why: "token 那张卡要拿回梯度，才能接着往前一层传",
        per: "每个 MoE 层 1 次" },
      /* 专家权重在每个 EDP 副本里各算出一份梯度；该层的专家反向一结束，同一
         专家分片就可以跨 EDP 启动梯度桶同步，不必等整条反向全部走完。把这一拍
         放在 Dispatch 反向之后，画布会先演完本层 EP 域内的输入梯度回传，再沿
         EDP 轴连到持有同一专家分片的那些 rank。存在梯度累积时，只有最后一个
         micro-batch 发起通信，前面的 micro-batch 只在本地累积。 */
      { phase: "bwd", when: moe && c.edp > 1, dom: "edp", module: "Routed Expert",
        event: "EDP Reduce-Scatter（梯度桶）",
        payload: "该 MoE 层中，本卡所持专家分片的参数梯度", kind: "gradient",
        why: "不同 EDP 用不同数据算出了同一专家分片的梯度，必须聚合后才能得到一致的专家更新；梯度一就绪便可与前面层的反向计算重叠",
        per: c.microBatchNum > 1
          ? `每个 step、每个 MoE 层 1 次；仅最后一个 micro-batch 发起（前 ${c.microBatchNum - 1} 个只本地累积）`
          : "每个 step、每个 MoE 层 1 次（梯度就绪即启动）" },
      { phase: "bwd", when: c.tp > 1, dom: "tp", module: "Attention",
        event: "TP All-Reduce / Reduce-Scatter",
        payload: "QKV 列切产生的输入梯度部分和", kind: "gradient",
        why: "相加才是这一层输入的完整梯度（切了优化器就直接 Reduce-Scatter 到各自那一片）",
        per: "每层约 1 次" },
      { phase: "bwd", when: c.cp > 1, dom: "cp", module: "Attention",
        event: ulysses ? "CP All-to-All（反向）" : "CP Ring Send/Recv（反向）",
        payload: "分块 K/V 对应的梯度", kind: "gradient",
        why: "每张卡要收齐自己那段序列的 K/V 梯度，才对得上它持有的那一段激活",
        per: "每层 1 轮" },
      { phase: "bwd", when: c.pp > 1, dom: "pp", module: "Stage 入口", event: "PP Send",
        payload: "回传给上一个 stage 的 dL/dx [B,S,H]", kind: "gradient",
        why: "上一段拿到它才能接着往回求导", per: "每个 micro-batch 1 次" },

      { phase: "sync", when: c.dpReplica > 1, dom: "dp",
        module: "Attention / Router / Shared Expert",
        event: "DP All-Reduce / Reduce-Scatter", payload: "非专家权重的参数梯度",
        kind: "gradient",
        why: "同一份权重在各 DP 副本上各算出一份梯度，必须平均成一份，优化器才更新得出一致的权重",
        per: "每个 step 1 次（与 micro-batch 数无关）" },
      /* 切了优化器状态（ZeRO-1 / FSDP2）才有的那一趟回程：每张卡只更新自己那一片
         参数，下一个 step 的前向要用完整权重，所以更新完还要 All-Gather 拼回来。
         不切（shardMode: none）时每张卡自己就持有完整的优化器状态与权重，这一条
         整条不存在 —— 这也正是"切分省显存、代价是多一趟通信"那笔账。 */
      { phase: "sync", when: sharded && c.dpReplica > 1, dom: "dp", module: "Optimizer",
        event: "参数 All-Gather",
        payload: "优化器更新完的那一片参数（" + (shardMode === "fsdp2" ? "FSDP2" : "ZeRO-1") + "）",
        kind: "optimizer",
        why: "每张卡只更新了自己那一片，下一个 step 的前向要用完整权重，得先拼回来",
        per: "每个 step 1 次（FSDP2 下每层前向还要再来一次）" },
    ];
    return raw.filter((s) => s.when).map((s, i) => {
      const dom = commDomain(c, s.dom);
      return Object.assign({}, s, { id: `cs${i}`, domain: dom, link: commLink(c, dom) });
    });
  }

  /* 阶段名摆在每一行左侧，不带描述文字：箭头方向已经把「前向 / 反向」说完了，
     再补一句「进 stage → Attention → …」是把下面那排事件条又用文字复述一遍。 */
  const COMM_PHASES = [["fwd", "前向"], ["bwd", "反向"], ["sync", "同步 / 更新"]];

  function renderComm() {
    if (!topology) return;
    if (center.dataset.mode === "comm") rightTitle.textContent = "运行详解";
    const c = topology.counts;
    const steps = commSteps(c);
    /* 拍里存的 step 是**上一次**算出来的对象，配置一拨就整批换新 —— 按 id 认回来，
       认不回（这条通信在新配置里根本不存在了）就把拍丢掉。rank 越界同理。 */
    if (flowBeat) {
      const s = flowBeat.step ? steps.find((x) => x.id === flowBeat.step.id) : null;
      const ok = flowBeat.rank < c.totalRank && (flowBeat.step ? Boolean(s) : true);
      flowBeat = ok ? Object.assign({}, flowBeat, { step: s }) : null;
    }
    const sel = commSelId();
    // 正在演的那一拍自带 rank（行程会跨段换卡），没有拍时才回到"选中的卡 / 默认卡"
    const anchor = flowBeat ? flowBeat.rank : commAnchor();

    /* 行程整趟**常驻**（不再只在按播放时才排）：上面那条阶段带要按它分宽、标进度，
       而它一趟只有一两百个小对象，配置或锚点一变重排一次，代价可以忽略。 */
    flowSeq = flowBeats(steps, flowRowOf(anchor));
    flowPos = flowIndexOf(flowSeq, flowBeat);
    renderPhases();

    /* 事件条只列**当前阶段**那一行。三行常驻要吃掉画布近三分之一的高度，而任一
       时刻真正在演的只有一个阶段 —— 另外两行既不在演、也不该被误读成"同时发生"。
       换阶段由上面那条带子管（点它就跳过去），这里跟着换内容。 */
    const activePhase = flowBeat ? flowBeat.phase : "fwd";
    commRows.textContent = "";
    {
      /* 只列**当前这一列真会发生**的那几条，而不是这一阶段的全部：Dense 层没有
         MoE 的两次 All-to-All、段中间的层没有 PP 收发 —— 把不发生的也摆出来，这
         一行就从"现在在做什么"退回成一张不随位置变的清单。 */
      const list = commRowSteps(steps, activePhase);
      const row = el("div", "crop-comm__row");
      row.dataset.phase = activePhase;
      // 左侧标题写这一拍落在哪一列（"Layer 13" / "Emb" / "Stage 1 全部参数"）
      row.appendChild(el("span", "crop-comm__row-label", flowBeat ? flowBeat.label : "—"));
      const track = el("div", "crop-comm__track");
      // 同名事件（一层里 Attention 与 MLP 各有一次 TP All-Reduce）才补模块名
      const names = list.map((x) => x.event);
      list.forEach((s) => {
        const b = el("button", "crop-comm__step");
        b.type = "button";
        b.dataset.id = s.id;
        b.dataset.link = s.link.kind;
        if (s.id === sel) {
          b.classList.add("is-selected");
          // 播放时再加一档：正在演的那一条要一眼认出来，而不是只比周围亮一点
          if (flowPlaying) b.classList.add("is-playing");
          // 播放时当前这一条会一路往后跑，带子可能已经横向滚出视野
          if (flowPlaying) global.requestAnimationFrame(() => {
            b.scrollIntoView({ block: "nearest", inline: "nearest" });
          });
        }
        b.title = `${s.module} / ${s.event} —— ${s.payload}（${s.link.label}）`;
        /* 只写一行事件名。原先第二行的「模块 · 范围」撤掉 —— 那两项浮卡里写得更
           全（还带传输内容与频次），而这一行每换一拍就重排一次，两行会让它在画布
           上方晃得很厉害。 */
        const dup = names.filter((n) => n === s.event).length > 1;
        b.append(el("span", "crop-comm__step-event", dup ? `${s.module} · ${s.event}` : s.event));
        track.appendChild(b);
      });
      if (!list.length) {
        track.appendChild(el("span", "crop-comm__row-empty", "这一列没有跨卡通信"));
      }
      row.appendChild(track);
      commRows.appendChild(row);
    }

    commPlay.disabled = !steps.length;
    renderCommDetail(steps, anchor, c);
    flowSync();
  }

  /* 当前这一拍所在的列真会发生哪几条通信。没有拍时退回整段清单（这一档刚打开、
     还没落到任何一列上），Emb / Norm / Head 那几列不是层，一条也不发生。 */
  function commRowSteps(steps, phase) {
    const list = steps.filter((s) => s.phase === phase);
    if (!flowBeat || flowBeat.phase !== phase || phase === "sync") return list;
    if (flowBeat.layer == null) return [];
    const entry = flowStageOf(flowBeat.rank);
    return list.filter((s) => flowApplies(s, flowBeat.layer, entry));
  }

  function renderCommDetail(steps, anchor, c) {
    commDetail.textContent = "";
    flowMicro = null;              // 浮卡整块重建，舞台里那些节点跟着作废
    const s = flowBeat ? flowBeat.step : null;
    commHint.textContent = s ? ""
      : (steps.length
        ? "按左边的播放键，跟着一个 step 里的最后一个 micro-batch 从 Emb 走到 Head、再完成梯度同步；或点任意一条单看 ——"
          + "画布上会画出这一条是谁和谁在通信（青线机内、绯线机间，动点表示数据方向），"
          + "右侧运行详解会同步显示它的范围与频次。"
        : "把左栏任意一个并行度（TP / CP / EP / PP / DP）拨大，这里就会列出它带来的通信。");
    commHint.hidden = Boolean(flowBeat);
    // 浮卡挂在画布上（画布三档都在），所以它自己要认得「现在是不是通信档」
    commDetail.hidden = !flowBeat || center.dataset.mode !== "comm";
    if (!flowBeat) return;
    /* 行程扫到不产生跨卡通信的那几列（Emb / Head、并行度为 1 的 Dense 层）：浮卡
       不消失，改说这一列本身没有通信 —— 消失会让人以为播放断了，而"这一列没有
       跨卡通信"恰恰是这一档要给的读数之一。 */
    if (!s) {
      const card0 = el("div", "crop-comm__card");
      const head0 = el("div", "crop-comm__card-head");
      head0.append(el("h3", "crop-comm__card-title",
        `${flowBeat.label} · rank ${anchor}`));
      card0.appendChild(head0);
      const body0 = el("div", "crop-comm__card-body");
      const r0 = el("div", "crop-comm__kv");
      r0.append(el("span", "crop-comm__kv-k", "这一列"));
      r0.append(el("span", "crop-comm__kv-v", "不产生跨卡通信 —— 本卡算完直接进下一列"));
      body0.appendChild(r0);
      card0.appendChild(body0);
      commDetail.appendChild(card0);
      return;
    }
    const peers = commPeers(s.domain, anchor);
    const card = el("div", "crop-comm__card");

    /* 第一行只放两枚标签：走哪条链路（染色的那枚）+ 传的是哪一类数据（中性的那
       枚）。它们是这张卡上仅有的两个**分类**读数，与标题混在一行时会被读成标题的
       一部分；单独占一行，扫一眼就知道"这一条贵不贵、传的是什么"。
       数据类别为空的那条（路由的负载统计既不是激活也不是梯度）不给标签。 */
    const tags = el("div", "crop-comm__card-tags");
    const link = el("span", "crop-comm__card-link", s.link.label);
    link.dataset.link = s.link.kind;
    tags.appendChild(link);
    if (s.kind) tags.appendChild(el("span", "crop-comm__card-kind", s.kind));
    card.appendChild(tags);

    /* 阶段（前向 / 反向 / 更新）不再在浮卡里挂一枚胶囊：页签下那条阶段带一直亮着
       当前是哪一段，浮卡再写一遍是同一件事说第二遍，还挤掉了标题的横向空间。 */
    const head = el("div", "crop-comm__card-head");
    /* 标题带上层号与卡号：行程是一层一层往前推的，浮卡不写「在哪一层、哪张卡」，
       连着看几拍就分不清换的是层还是卡。 */
    const at = flowBeat && flowBeat.label ? `${flowBeat.label} · rank ${anchor} — ` : "";
    head.append(el("h3", "crop-comm__card-title", `${at}${s.module} / ${s.event}`));
    card.appendChild(head);

    /* 五条一行一条、key 一列 value 一列（css 里那个两列网格）：原先长的独占一行、
       短的两两并排，读起来每一行的 key 都在不同的位置上，扫下来要重新找一次左缘。 */
    const body = el("div", "crop-comm__card-body");
    [
      ["传输内容", s.why ? `${s.payload} —— ${s.why}` : s.payload],
      ["谁和谁", commPeerText(peers)],
      ["通信范围", `${s.domain.name} group · ${s.domain.count} 个 rank`
        + (s.domain.stride > 1 ? ` · 步长 ${s.domain.stride}` : " · rank 连号")],
      ["跨几台机器", s.link.kind === "none" ? "—"
        : `${s.link.nodes} 台（每台 ${c.ranksPerNode} 卡）`],
      ["频次", s.per],
    ].forEach(([k, v]) => {
      const r = el("div", "crop-comm__kv");
      r.append(el("span", "crop-comm__kv-k", k));
      r.append(el("span", "crop-comm__kv-v", v));
      body.appendChild(r);
    });
    card.appendChild(body);

    /* MoE 那三条（Router 打分 / Dispatch / Combine）另配一台微观舞台：画布上的
       连线只答得出"哪几张卡在同一个 EP 域里"，答不了 all-to-all 里面到底在搬什么。
       其余事件不给 —— 一条 TP All-Reduce 没有 per-token 这一层可讲。 */
    if (s.dom === "ep" && flowBeat && c.expertsPerEpRank > 0) {
      renderMoeStage(card, flowBeat, s, c);
    }
    commDetail.appendChild(card);
  }

  /* ══ MoE 微观舞台：router → dispatch → combine ═══════════════════════════
     画布上那几条 all-to-all 连线答的是**通信组**（哪几张卡在同一个 EP 域里），
     答不了里面发生了什么 —— 而 all-to-all 恰恰是三件事的合成：
       router    在卡内给每个 token 对全部 E 个专家打分、取最高的 k 个（零通信）
       dispatch  按目的地把 token 重排、发往持有那几个专家的卡
       combine   专家算完，结果按原 token 次序送回原卡
     这一段把这三件事画进浮卡：一排抽样 token 在上，它们这一拍要去的那几张卡在下，
     中间是**每个 token 自己**的 top-k 连线。焦点 token 每拍轮换一遍 16 个 —— 一次
     只亮一个 token 的 k 条线，既看得清"一个 token 选 k 个专家"，也避免 16×k 条线
     糊成一片。

     ── 为什么专家分布是不均的 ──────────────────────────────────────────────
     同一层各卡共用同一份 router 权重，所以打分偏好一致；每个 token 再叠自己的
     噪声。结果就是各专家收到的 token 数天然不均 —— 这不是画着好看，而是 MoE 最
     关键的性能事实（负载均衡 aux loss 与 capacity factor 要治的正是这个病）。
     口径与 ParallelDemo/dist.html 的 _moeAffinity / _moePickTok 同源。 */
  const MOE_TOK_SHOWN = 16;      // 抽样几个 token（真实 token 数写在标题里）
  const MOE_DEST_MAX = 8;        // 目的卡最多列几张，其余折成「+N」
  const MOE_VB_W = 480;          // 舞台的 viewBox 宽（浮卡宽度按它定）
  const MOE_VB_H = 92;

  function moeRnd(seed) {
    let s = (seed * 2654435761) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 一层一份专家亲和度（相对热度 0.35~1.35）：同层各卡共用 router 权重，偏好一致
  function moeAffinity(E, layer) {
    const rnd = moeRnd(layer * 7919 + 13);
    const w = [];
    for (let i = 0; i < E; i += 1) w.push(0.35 + rnd());
    return w;
  }

  /* 单个 token 的 top-k：亲和度 × 这个 token 自己的噪声，取前 k。
     ⚠️ 逐 token 各算一次 —— top-k 是 per-token 的，不是每卡或每 EP 组选一次。 */
  function moePickTok(E, k, aff, seed) {
    const rnd = moeRnd(seed);
    const scored = [];
    for (let i = 0; i < E; i += 1) scored.push({ i, sc: aff[i] * (0.3 + rnd()) });
    scored.sort((a, b) => b.sc - a.sc);
    return scored.slice(0, k).map((o) => o.i).sort((a, b) => a - b);
  }

  /* 这一拍的路由结果。返回抽样 token 各自选了哪些专家、那些专家落在哪几张卡上。
     专家 → 卡：专家按 EP 位连号切（epIdx = ⌊e / 每卡专家数⌋，见 observer 的
     epRankOfExpert），EP 组的成员 rank 由 commPeers 现算 —— 与画布上那几条线用的
     是同一份成员名单，两处不会各说各话。 */
  function moeRoute(beat, s, c) {
    const E = Math.max(1, c.routedExpert || 1);
    const epr = Math.max(1, c.expertsPerEpRank || 1);
    const k = clamp(c.topK || 1, 1, E);
    const layer = beat.layer == null ? 0 : beat.layer;
    const aff = moeAffinity(E, layer);
    const peers = commPeers(s.domain, beat.rank);
    const rpn = Math.max(1, layout ? layout.ranksPerNode : 1);

    const destBy = new Map();      // rank → { rank, kind, n, experts:Set }
    const tokens = [];
    for (let i = 0; i < MOE_TOK_SHOWN; i += 1) {
      const experts = moePickTok(E, k, aff, layer * 1000 + i * 31 + 7);
      const ranks = [];
      experts.forEach((e) => {
        const epIdx = Math.min(peers.length - 1, Math.floor(e / epr));
        const r = peers[epIdx];
        if (r === undefined) return;
        let d = destBy.get(r);
        if (!d) {
          d = {
            rank: r, n: 0, experts: new Set(),
            kind: Math.floor(r / rpn) === Math.floor(beat.rank / rpn) ? "local" : "inter",
          };
          destBy.set(r, d);
        }
        d.experts.add(e);
        if (ranks.indexOf(r) < 0) ranks.push(r);
      });
      ranks.forEach((r) => { destBy.get(r).n += 1; });   // 这张卡收到几个抽样 token
      tokens.push({ experts, ranks });
    }

    /* 目的卡按收到的 token 数排序，超出的**不丢掉**，折成最后一格「+N 张」。
       丢掉的后果是：标题说"每个 token 选 8 个专家"，画面上却只有两三条线 —— 那正
       是这台舞台最该说清的一件事（k 个专家散落在很多张卡上，才有 all-to-all）。
       截断只截"分别是哪几张"，不截总量。 */
    const all = Array.from(destBy.values()).sort((a, b) => b.n - a.n || a.rank - b.rank);
    const over = all.length > MOE_DEST_MAX;
    const dests = all.slice(0, over ? MOE_DEST_MAX - 1 : MOE_DEST_MAX);
    dests.forEach((d) => { d.label = d.rank === beat.rank ? "本卡" : `r${d.rank}`; });
    const index = new Map(dests.map((d, i) => [d.rank, i]));
    const rest = all.slice(dests.length);
    let restSlot = null;
    if (over) {
      restSlot = {
        rank: null, n: 0, label: `+${rest.length} 张`,
        kind: rest.some((d) => d.kind === "inter") ? "inter" : "local",
      };
      rest.forEach((d) => index.set(d.rank, dests.length));
      dests.push(restSlot);
    }
    tokens.forEach((t) => {
      const seen = [];
      t.ranks.forEach((r) => {
        const i = index.get(r);
        if (i !== undefined && seen.indexOf(i) < 0) seen.push(i);
      });
      t.dests = seen;
      if (restSlot && seen.indexOf(dests.length - 1) >= 0) restSlot.n += 1;
    });
    return {
      tokens, dests, k, E,
      hidden: rest.length,
      inter: all.filter((d) => d.kind === "inter").length,
      nodes: all.length,
    };
  }

  /* 本卡这一拍手里有多少 token。B×S 是一份 micro-batch 的 token 数，CP 把序列切了、
     开 SP 之后 TP 再切一刀 —— 与 buildHeat 里那个 tokens 同一口径。 */
  function moeTokenCount(c) {
    const cfg = (topology && topology.config) || {};
    const seqLocal = Math.max(1, (cfg.seqLen || 4096) / Math.max(1, c.cp || 1));
    const per = Math.max(1, cfg.microBatch || 1) * seqLocal;
    return Math.max(1, Math.round(cfg.seqParallel ? per / Math.max(1, c.tp || 1) : per));
  }

  /* 热力色阶的淡染版：目的卡整张按同一个负载值上色、卡底那条按全饱和上色，两者
     因此是同一件事的两种强度。heatColor 返回的是 "rgb(r,g,b)"，这里只补一层 alpha
     —— 不用 color-mix 是为了让 svg 的 fill 在旧一点的内核上也拿得到确定的值。 */
  function moeHeatFill(u, alpha) {
    const c = heatColor(u);
    if (alpha >= 1) return c;
    if (alpha <= 0) return "transparent";
    return c.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  }

  function moeFmtN(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  }

  /* 舞台本体。几何全部写死在 viewBox 里（480×92），浮卡按它定宽 —— 舞台里的字是
     9px 的编号，跟着卡宽伸缩会糊。 */
  function renderMoeStage(card, beat, s, c) {
    const route = moeRoute(beat, s, c);
    if (!route.dests.length) return;
    const dir = flowMode(s);                       // out=发出去 in=收回来
    const isRouter = /Router/.test(s.module);      // 打分那一条：本地计算，零通信

    const wrap = el("div", "crop-moe");
    const tokN = moeTokenCount(c);
    wrap.appendChild(el("div", "crop-moe__head",
      `本卡 ${moeFmtN(tokN)} 个 token（抽样 ${MOE_TOK_SHOWN} 个演示）`
      + ` · router 逐 token 打分，各选 ${route.k}/${route.E} 个专家`));

    const svgEl = svg("svg", "crop-moe__stage");
    svgEl.setAttribute("viewBox", `0 0 ${MOE_VB_W} ${MOE_VB_H}`);
    svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // ① 上排：抽样 token
    const tw = (MOE_VB_W - (MOE_TOK_SHOWN - 1) * 3) / MOE_TOK_SHOWN;
    const tokEls = [];
    const tokX = [];
    for (let i = 0; i < MOE_TOK_SHOWN; i += 1) {
      const x = i * (tw + 3);
      const r = svg("rect", "crop-moe__tok");
      r.setAttribute("x", x); r.setAttribute("y", 2);
      r.setAttribute("width", tw); r.setAttribute("height", 13);
      r.setAttribute("rx", 2);
      svgEl.appendChild(r);
      tokEls.push(r);
      tokX.push(x + tw / 2);
    }

    // ③ 下排：这一拍要发往的那几张卡（宽度里那条实心 = 收到几个抽样 token）
    const n = route.dests.length;
    const dw = (MOE_VB_W - (n - 1) * 5) / n;
    const dy = MOE_VB_H - 24;
    const destX = [];
    const bars = [];
    const boxes = [];
    route.dests.forEach((d, i) => {
      const x = i * (dw + 5);
      destX.push(x + dw / 2);
      const box = svg("rect", "crop-moe__dest");
      box.dataset.link = d.kind;
      box.setAttribute("x", x); box.setAttribute("y", dy);
      box.setAttribute("width", dw); box.setAttribute("height", 22);
      box.setAttribute("rx", 3);
      svgEl.appendChild(box);
      boxes.push(box);
      /* 卡底那条实心 = 这张卡到此为止收到几个抽样 token。宽度与**颜色**都由
         updateMoeFocus 每拍现写：router 打分是一个 token 一个 token 出结果的，
         这条要跟着长，长得快的那几张自然从冷色走到暖色。 */
      const bar = svg("rect", "crop-moe__bar");
      bar.setAttribute("x", x); bar.setAttribute("y", dy + 16);
      bar.setAttribute("width", 0);
      bar.setAttribute("height", 6);
      svgEl.appendChild(bar);
      bars.push(bar);
      const t1 = svg("text", "crop-moe__dest-t");
      t1.setAttribute("x", x + dw / 2); t1.setAttribute("y", dy + 11);
      t1.textContent = d.label;
      svgEl.appendChild(t1);
    });

    // ② 中间：焦点 token 的 top-k 连线（每帧由 flowDraw 改 d，见 updateMoeFocus）
    const lines = [];
    const dots = [];
    for (let i = 0; i < MOE_DEST_MAX; i += 1) {
      const path = svg("path", "crop-moe__line");
      path.setAttribute("d", "M0 0");
      svgEl.appendChild(path);
      lines.push(path);
    }
    if (!isRouter) {
      for (let i = 0; i < MOE_DEST_MAX; i += 1) {
        const dot = svg("circle", "crop-moe__dot");
        dot.setAttribute("r", "2.6");
        dot.setAttribute("cx", -10); dot.setAttribute("cy", -10);
        svgEl.appendChild(dot);
        dots.push(dot);
      }
    }
    wrap.appendChild(svgEl);

    const foot = `${MOE_TOK_SHOWN} 个 token × top-${route.k} = ${MOE_TOK_SHOWN * route.k} 次激活`
      + ` · 落在 ${route.nodes} 张卡上（${route.inter} 张在机外）`
      + (route.hidden > 0 ? ` · 收得最多的 ${MOE_DEST_MAX - 1} 张单列，其余合成末格` : "")
      + (isRouter
        ? " · 打分在卡内完成，这一步零通信；卡底那条随打分长出来，颜色同「负载热力」的色阶"
        : "");
    wrap.appendChild(el("div", "crop-moe__foot", foot));
    card.appendChild(wrap);

    /* 每个 token 打完分之后各卡的累计数（前缀和）。router 那一拍按它逐格长，
       dispatch / combine 直接用最后一格 —— 到那两步路由早就定完了，再让它慢慢长
       会把"已经定好的分配"读成"正在决定"。 */
    const running = new Array(n).fill(0);
    const prefix = route.tokens.map((tk) => {
      tk.dests.forEach((di) => { running[di] += 1; });
      return running.slice();
    });
    const last = prefix[prefix.length - 1] || running;
    const maxN = Math.max(1, ...last);

    flowMicro = {
      route, tokEls, tokX, destX, lines, dots, dir, isRouter, focus: -1,
      bars, boxes, prefix, maxN, dw,
    };
    updateMoeFocus(0, 0);
  }

  /* 焦点 token 走到第几个、这个 token 内部的进度。由 flowDraw 每帧调：一拍之内
     16 个 token 轮一遍 —— "每个 token 各自选自己的 k 个专家"这件事，只有一个一个
     亮过去才看得出来。 */
  function updateMoeFocus(idx, u) {
    if (!flowMicro) return;
    const m = flowMicro;
    const tok = m.route.tokens[idx];
    if (!tok) return;
    if (m.focus !== idx) {
      m.tokEls.forEach((r, i) => r.classList.toggle("is-focus", i === idx));
      /* 各卡的累计条：router 那一拍随打分逐个长起来 —— 一开始全是同一档冷色，
         谁被选得多谁就先走向暖色，「负载不均」是**长出来**的而不是一上来就摆好。
         颜色复用负载热力那条色阶（heatColor），量纲是「相对最热的那张卡」。 */
      const cum = m.prefix[m.isRouter ? idx : m.prefix.length - 1] || [];
      m.bars.forEach((bar, i) => {
        const v = cum[i] || 0;
        const u = v / m.maxN;
        bar.setAttribute("width", v ? Math.max(2, m.dw * (v / MOE_TOK_SHOWN)) : 0);
        bar.style.fill = heatColor(u);
        // 整张卡跟着同一个值淡染：卡与卡底那条必须是同一件事的两种强度
        if (m.boxes[i]) {
          m.boxes[i].style.fill = moeHeatFill(u, v ? 0.26 : 0);
          /* 描边与底色同色阶、同一个值，只是实一档：一张卡的框和它的底若一个按
             热力走、另一个停在中性灰，扫过去会读成两套无关的编码。还没被选到的
             那几张（v=0）底色是透明的，描边取色阶最冷那一端的淡色 —— 仍在同一副
             色阶上，只是"最轻"。机内 / 机间那一档因此从描边的**颜色**挪到它的
             虚实上（见 css 里 .crop-moe__dest[data-link="inter"]）。 */
          m.boxes[i].style.stroke = moeHeatFill(u, v ? 0.72 : 0.34);
        }
      });
      m.focus = idx;
    }
    const y0 = 15;
    const y1 = MOE_VB_H - 24;
    m.lines.forEach((path, i) => {
      const di = tok.dests[i];
      if (di === undefined) { path.setAttribute("d", "M0 0"); path.style.opacity = 0; return; }
      const x0 = m.tokX[idx];
      const x1 = m.destX[di];
      const cy = (y0 + y1) / 2;
      path.setAttribute("d", `M ${x0} ${y0} C ${x0} ${cy} ${x1} ${cy} ${x1} ${y1}`);
      path.style.opacity = "";
    });
    m.dots.forEach((dot, i) => {
      const di = tok.dests[i];
      if (di === undefined) { dot.style.opacity = 0; return; }
      dot.style.opacity = "";
      const x0 = m.tokX[idx];
      const x1 = m.destX[di];
      const cy = (y0 + y1) / 2;
      // 与连线同一条三次贝塞尔上取点；combine 那几条反着走
      const t = m.dir === "in" ? 1 - u : u;
      const a = 1 - t;
      const x = a * a * a * x0 + 3 * a * a * t * x0 + 3 * a * t * t * x1 + t * t * t * x1;
      const y = a * a * a * y0 + 3 * a * a * t * cy + 3 * a * t * t * cy + t * t * t * y1;
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y);
    });
  }

  /* ── 播放：把一个 micro-batch 在这张卡上往前走的路线演一遍 ────────────────
     带子答的是「有哪些通信」，这一段答的是「它发生在**哪儿**、按什么次序」。

     ── 时间轴是"逐层推进"，不是"清单从头念到尾" ────────────────────────────
     清单里那几条前向事件（PP Recv / CP / TP / MoE 的两次 All-to-All / PP Send）
     不是一个 step 里各来一次 —— 除了进出 stage 那两条，其余**每一层都要来一遍**。
     所以真正的时间轴是：
         进 stage → Layer L0 的那几条 → Layer L0+1 的那几条 → … → 出 stage
         → 激活交给下一段里行号相同的那张卡 → 那张卡的第一层
     一个「拍」(beat) 因此是三元组 (rank, layer, event)，画在平面上就是沿横轴
     一列一列往右推，推到块尾跳到下一块的第一列 —— 那一跳正是 PP。这也是这一档
     和带子的分工：带子是清单（每类事件列一次），画布是行程。

     ── 哪些事件落在哪一层 ──────────────────────────────────────────────────
       Stage 入口 / 出口        只在本段的首层 / 末层
       Router / MoE / 共享专家  只在 MoE 层（Dense 层没有专家，也就没有 All-to-All）
       TP / CP                  每一层都有
     后段的全参数同步 / 回收不属于任何一层，按整段表示；专家梯度桶是例外，它在
     对应 MoE 层的反向梯度就绪后立刻跨 EDP 启动。

     ── 连线怎么染色 ────────────────────────────────────────────────────────
     同一条 TP All-Reduce，落在连号的 8 行上（一台机器里）和被步长撑到跨了三台
     机器，在带子里都只是一枚同样的方块 —— 只有画到平面上才看得出差别。所以线的
     颜色不按事件的整体链路档（那是带子的事），而是**逐条**按「这一条线的两端是
     不是同一台机器」染：青 = 机内 HCCS，绯 = 机间 RDMA（避开专家那四色，见 css 的
     --crop-link-*）。一屏里青绯各占多少，
     就是这份摆法的代价。

     ⚠️ 屏幕坐标每帧现算（而不是建线时算一次）：播放期间用户照样可以缩放平移，
     线必须钉在格子上。常见的 DP=16 要把 15 个对端完整画出，否则等距抽样会让
     通信组看起来像是无规律地漏了几张卡；更大的 DP 域才按 FLOW_LINKS_MAX 抽样，
     避免 DP=64 那种域全画
     出来是一团毛线，等距抽样既留下近邻也留下最远的那一端。 */
  const FLOW_LINKS_MAX = 15;

  let flowLinks = [];       // 当前这一拍在平面上的连线
  let flowCtx = null;       // { beat, mode, src }
  let flowSeq = [];         // 这一趟行程的所有拍
  let flowPos = -1;
  // 正在看的那一拍 { rank, stage, ci, layer, unit, label, step }；null = 什么都没选
  let flowBeat = null;
  let flowPlaying = false;
  let flowRaf = 0;
  let flowT0 = 0;
  let flowPhaseCell = null;   // 阶段带上正在涨的那一段（每帧只改它的 --prog）
  let flowMicro = null;       // 浮卡里那台 MoE 微观舞台（见 renderMoeStage）
  /* 一拍多久。整趟按**总时长**反推而不是写死一个常数：46 层的配置有两百多拍，
     固定一拍一个常数要么深模型看不完、要么小模型一闪而过。按总时长定，深模型
     自动走快、小模型自动走慢，再夹在上下界里保证动点还看得清方向。
     ⚠️ 这三个数是**同一档速度**的三个面，要调就一起按比例调（现在这一档是原先的
     一半速）—— 只改总时长会被上下界夹住，只改上下界又和总时长打架。 */
  const FLOW_TRIP_MS = 120000;
  const FLOW_BEAT_MIN = 640;
  const FLOW_BEAT_MAX = 2200;
  function flowBeatMs() {
    if (!flowPlaying || !flowSeq.length) return FLOW_BEAT_MAX;
    return clamp(Math.round(FLOW_TRIP_MS / flowSeq.length), FLOW_BEAT_MIN, FLOW_BEAT_MAX);
  }

  // 带子的选中态、浮卡看的都是「正在看哪一条」，而那是拍的一部分，不另存一份
  function commSelId() { return flowBeat && flowBeat.step ? flowBeat.step.id : null; }

  /* 默认从哪张卡看起：**第一行**（rank 0）。行程会自己跨段换卡（0 → 32 → 64 →
     96），所以起点取第一段的第一张卡，整趟正好是「一个 micro-batch 从 Emb 一路
     走到 Head」的全程 —— 而不是从中间某一段切进去。 */
  function commAnchor() {
    const onRank = Boolean(relation && relation.primary && relation.primary.kind === "rank");
    return onRank ? relation.primary.rank : 0;
  }

  // 行程沿着**同一行**往右走：换段只换 stage，行号（段内第几张卡）一路不变
  function flowRowOf(rank) {
    return clamp(rank % Math.max(1, topology.counts.ranksPerStage), 0,
      Math.max(0, topology.counts.ranksPerStage - 1));
  }

  function flowStageOf(rank) {
    const rps = Math.max(1, topology.counts.ranksPerStage);
    const st = clamp(Math.floor(rank / rps), 0, topology.stages.length - 1);
    return topology.stages.find((e) => e.stage === st) || topology.stages[0];
  }

  /* 这一条事件在这一层发生吗。三类判据：
       进 / 出 stage   只在本段的首层 / 末层，且**那一侧真的还有一段** —— 第一段
                       没有上游可收、最后一段没有下游可发
       专家那几条      只在 MoE 层（Dense 层没有专家，也就没有 All-to-All）
       Dense 的 FFN    反过来只在 Dense 层（MoE 层的 FFN 走的是专家那条路）
     其余（Attention 的 TP / CP）每一层都有。 */
  function flowApplies(s, layer, entry) {
    if (s.module === "Stage 入口") return layer === entry.lo && entry.stage > 0;
    if (s.module === "Stage 出口") {
      return layer === entry.hi && entry.stage < topology.stages.length - 1;
    }
    const info = topology.layers[layer];
    const moe = Boolean(info && info.ffn === "moe");
    if (s.dom === "ep" || s.dom === "edp" || s.module === "Shared Expert") return moe;
    if (s.module === "MLP（Dense）") return !moe;
    return true;
  }

  /* 一趟行程 = 沿着**同一行**把整幅平面从左扫到右：Emb → 第一段的每一层 → 出段
     → 下一段（行号相同的那张卡，rank + 每段卡数）→ … → Norm → Head。
     每扫到一列，就把这一列会发生的前向通信按序演一遍；不产生跨卡通信的列
     （Emb / Head、并行度为 1 时的 Dense 层）也占一拍 —— 行程是连续的，跳过它们
     会让"走到哪儿了"断档，而"这一列没有通信"本身就是一个读数。

     所以拍带的是**列坐标**（stage + 块内第几列）而不只是层号：Emb / Norm / Head
     不是层，却同样是这幅平面上的一列。 */
  function flowBeats(steps, row) {
    if (!topology || !layout || !topology.stages.length) return [];
    const rps = Math.max(1, topology.counts.ranksPerStage);
    const r = clamp(row, 0, rps - 1);
    const out = [];

    /* 一趟扫描：前向从左往右，反向**整个掉头**（块倒着走、块内的列也倒着走）——
       反向是沿着同一条路走回来的，顺着扫等于把回程画成又一趟去程。 */
    const sweep = (phase, back) => {
      const list = steps.filter((s) => s.phase === phase);
      const blocks = back ? layout.blocks.slice().reverse() : layout.blocks;
      blocks.forEach((block) => {
        const entry = topology.stages.find((e) => e.stage === block.stage);
        if (!entry) return;
        const rank = block.stage * rps + r;
        const cols = block.cols.map((col, ci) => ({ col, ci }));
        if (back) cols.reverse();
        cols.forEach(({ col, ci }) => {
          const at = {
            rank,
            stage: block.stage,
            ci,
            phase,
            layer: col.type === "layer" ? col.layer : null,
            unit: col.type === "layer" ? null : col.id,
            label: col.type === "layer" ? `Layer ${col.layer}` : col.label,
          };
          const hits = col.type === "layer"
            ? list.filter((s) => flowApplies(s, col.layer, entry))
            : [];
          if (!hits.length) { out.push(Object.assign({ step: null }, at)); return; }
          hits.forEach((s) => out.push(Object.assign({ step: s }, at)));
        });
      });
    };
    sweep("fwd", false);
    sweep("bwd", true);
    /* 后段的同步 / 更新不属于任何**一层** —— 它处理的是这张卡上**全部**参数，
       一个 step 末尾一次。所以它既不该扫列（那会读成"一层一层地同步"），
       也不该像原先那样落在某一列上（落在块中段那一列，看起来就成了"只有 Layer 6
       在同步"，纯属摆错位置）。
       改成一段一拍、框住**整块**：每个 stage 的那一行整段亮起来，说的正是"这一
       段里所有层的参数一起交换"。段与段之间仍按左到右走一遍，因为每一段的卡都
       各自要同步一次，而这幅平面上它们是分开的几块。 */
    const sync = steps.filter((s) => s.phase === "sync");
    layout.blocks.forEach((block) => {
      const rank = block.stage * rps + r;
      const mid = Math.max(0, Math.floor(block.cols.length / 2));
      sync.forEach((s) => out.push({
        rank,
        stage: block.stage,
        ci: mid,                 // 连线挂在块中间，白框由 wide 铺满整块
        phase: "sync",
        wide: true,
        layer: null,
        unit: null,
        label: `Stage ${block.stage} 全部参数`,
        step: s,
      }));
    });
    return out;
  }

  /* 拍在整趟行程里的序号。行程每次都是现排的（配置、锚点一变就重排），所以认的
     不是对象本身而是它的四个坐标：阶段 + 卡 + 列 + 事件。四者合起来在一趟里唯一。 */
  function flowIndexOf(seq, beat) {
    if (!beat) return -1;
    const id = beat.step ? beat.step.id : null;
    return seq.findIndex((b) => b.phase === beat.phase && b.rank === beat.rank
      && b.ci === beat.ci && (b.step ? b.step.id : null) === id);
  }

  // 阶段带上每一段的起点与拍数（三段在行程里是连续的三块）
  function flowSpanOf(key) {
    const from = flowSeq.findIndex((b) => b.phase === key);
    if (from < 0) return { from: -1, n: 0 };
    let n = 0;
    for (let i = from; i < flowSeq.length && flowSeq[i].phase === key; i += 1) n += 1;
    return { from, n };
  }

  /* 阶段带：前向 / 反向 / 更新三段，蓝色从左往右涨到当前这一拍，斜线是还没走到的
     部分。与 training-monitoring-v2 的 L2 阶段带同一副语言，这里换成本页的主色。

     三段**等宽**，不按拍数分宽：更新只有几拍，按拍数分会被压成一条缝，既读不出
     字、也点不中 —— 而这条带子在这里的第一职责是「现在演到哪一阶段、点哪儿能跳
     过去」，不是「三段各占多久」（那是 v2 面板上按实测耗时分宽的那条带子的活）。
     段内的进度仍然是真的：蓝色涨到这一段的第几拍。

     正在演的那一段把**当前位置**写进段名（"前向 · Layer 13"）：段名是这条带子上
     唯一一处能一直写字的地方，而"演到哪一层"正是播放时每一拍都在变的那个读数。 */
  function renderPhases() {
    commPhases.textContent = "";
    flowPhaseCell = null;
    if (!flowSeq.length) return;
    COMM_PHASES.forEach(([key, name]) => {
      const span = flowSpanOf(key);
      if (!span.n) return;               // 这份配置里这一阶段没有通信，不占位
      const cell = el("button", "crop-comm__ph");
      cell.type = "button";
      cell.dataset.phase = key;
      let state = "pending";
      let prog = 0;
      let label = name;
      if (flowPos >= span.from + span.n) { state = "done"; prog = 1; }
      else if (flowPos >= span.from) {
        state = "running";
        // 播放中这一格由 flowDraw 每帧连续涨；停住时直接标到"这一拍已走完"
        prog = (flowPos - span.from + (flowPlaying ? 0 : 1)) / span.n;
        flowPhaseCell = { el: cell, from: span.from, n: span.n };
        if (flowBeat && flowBeat.label) label = `${name} · ${flowBeat.label}`;
      }
      cell.classList.add(`is-${state}`);
      cell.style.setProperty("--prog", prog.toFixed(4));
      cell.title = `${name} · 共 ${span.n} 拍（点这里从这一阶段开始播）`;
      cell.append(el("span", "crop-comm__ph-n", label));
      commPhases.appendChild(cell);
    });
  }

  /* 手点带子里的一条时，把它摆到哪一列：取这一条在本段里**最早**发生的那一层
     （PP Recv 在首层、PP Send 在末层、MoE / EDP 梯度桶在第一个 MoE 层）。后段的
     全参数同步 / 回收不属于任何一层，落在块中段一列作代表。 */
  function flowBeatFor(s, rank) {
    const entry = flowStageOf(rank);
    const block = layout.blocks.find((b) => b.stage === entry.stage) || layout.blocks[0];
    let ci = s.phase === "sync" ? -1
      : block.cols.findIndex((col) => col.type === "layer" && flowApplies(s, col.layer, entry));
    if (ci < 0) {
      const first = block.cols.findIndex((col) => col.type === "layer");
      ci = first < 0 ? 0
        : Math.min(block.cols.length - 1, first + Math.floor((block.cols.length - first) / 2));
    }
    const col = block.cols[ci];
    // 更新那两条同步的是整段的全部参数，不落在某一列上（见 flowBeats 里那段）
    const wide = s.phase === "sync";
    return {
      rank,
      stage: block.stage,
      ci,
      phase: s.phase,
      wide,
      layer: wide || col.type !== "layer" ? null : col.layer,
      unit: wide || col.type === "layer" ? null : col.id,
      label: wide ? `Stage ${block.stage} 全部参数`
        : (col.type === "layer" ? `Layer ${col.layer}` : col.label),
      step: s,
    };
  }

  /* 数据往哪个方向流。事件名本身已经把方向写死了，不必另建一张表：
       out     本卡发出去（PP Send / Dispatch）
       in      收进来（PP Recv / Combine）
       ring    只和环上的下一个邻居说话（CP Ring）
       both    同时双向（泛指的 All-to-All）
       reduce  先聚后散（All-Reduce / Reduce-Scatter）—— 先各家把部分和交上来，
               再把结果发回去，正是这类集合通信为什么贵的那两趟 */
  function flowMode(s) {
    const e = s.event;
    if (/Ring/.test(e)) return "ring";
    if (/Recv/.test(e)) return "in";
    if (/Send/.test(e)) return "out";
    if (/Dispatch/.test(e)) return /反向/.test(e) ? "in" : "out";
    if (/Combine/.test(e)) return /反向/.test(e) ? "out" : "in";
    if (/All-to-All/.test(e)) return "both";
    return "reduce";
  }

  function flowBlockOf(rank) {
    const rps = Math.max(1, layout.ranksPerStage);
    const st = Math.floor(rank / rps);
    return layout.blocks.find((b) => b.stage === st) || layout.blocks[0];
  }

  /* 一条通信画在块的哪一列。拍本身带着列坐标（stage + 块内第几列），同段的两端
     直接用它；只有 PP 例外 —— 它是相邻两段之间的点对点，早的那头画在块尾、晚的那
     头画在块首，线才横跨在两块中间的空当上，而不是从块中间穿出去。 */
  function flowCol(s, block, otherStage, beat) {
    const n = block.cols.length;
    if (s.dom === "pp") return block.stage <= otherStage ? n - 1 : 0;
    if (beat && block.stage === beat.stage) return beat.ci;
    const first = block.cols.findIndex((col) => col.type === "layer");
    if (first < 0) return Math.floor(n / 2);
    return Math.min(n - 1, first + Math.floor((n - first) / 2));
  }

  /* ══ 连线的**格内落点** ══════════════════════════════════════════════════
     缩到只剩一块颜色时，一条通信画到格子中心就够了 —— 那一档格子里本来就没有别的
     东西可指。格内一旦铺开内容（两段块 / 算子面板），中心点就开始说错话：
     「EP Dispatch 从这张卡发出去」这句话的主语是**格子里那一枚 EP Dispatch 块**，
     它离格子中心可能差着大半格；线从中心飞出来，读的人对不上是哪一步发的。

     两档共用同一份规格 —— flowAnchorOf 返回的 { seg, at }：
       · 算子面板 —— at 指名那枚算子（id 与 ATTN_ROWS / MOE_ROWS 同一套，也与 deck
         那张「典型 Layer」卡同名）；"head" / "tail" 指那一组的第一 / 最后一枚
         （PP 进出段落在层的头尾上，而头尾是什么随 dense / MoE 变，指名反而写不全）；
         "experts" 指 Expert Compute 那个盒子。
       · 两段块 —— 只落到 seg 那一条带上：那一档格内只有两条带，再细没有对象。
     取不到（格子滚出视口、这一档不铺格子、整机粒度、或者这条通信本来就不属于某一
     枚块）一律退回格子中心，也就是原先的行为。 */
  function flowAnchorOf(s) {
    /* 更新那两拍同步的是整段的全部参数（beat.wide），不落在某一枚块上 —— 它的
       module 写着 "Attention / Router / Shared Expert"，正说明它不是某一处的事。 */
    if (!s || s.phase === "sync") return null;
    const e = s.event || "";
    // PP：进段落在这一层的头上（Input RMSNorm），出段落在尾上（Down / EP Combine）
    if (s.module === "Stage 入口") return { seg: "attn", at: "head" };
    if (s.module === "Stage 出口") return { seg: "ffn", at: "tail" };
    // CP 切的是序列，收发都围着注意力核那一枚
    if (s.dom === "cp") return { seg: "attn", at: "attention_core" };
    // TP 切的是 QKV 的列，部分和要到输出投影之后才凑齐
    if (s.module === "Attention") return { seg: "attn", at: "o_proj" };
    if (s.module === "Router") return { seg: "ffn", at: "gate" };
    if (s.dom === "ep") {
      return { seg: "ffn", at: /Dispatch/.test(e) ? "a2a_dispatch" : "a2a_combine" };
    }
    // 专家权重的梯度归约：落在 Expert Compute 那个盒子上，那才是这些权重所在处
    if (s.dom === "edp") return { seg: "ffn", at: "experts" };
    if (s.module === "MLP（Dense）") return { seg: "ffn", at: "tail" };
    // 共享专家与路由专家并联，面板里没有单独一枚；落到 FFN 那一组上
    if (s.module === "Shared Expert") return { seg: "ffn", at: null };
    return null;
  }

  /* 「这张卡 × 这一列」那一格的 DOM。层号在整个模型里唯一、端点列每行也只有一个，
     所以 rank + 层号 / 端点 id 就够定位，不必再带 stage。 */
  function flowCellEl(rank, block, ci) {
    const col = block && block.cols[ci];
    if (!col) return null;
    return world.querySelector(col.type === "layer"
      ? `.crop-cell[data-rank="${rank}"][data-layer="${col.layer}"]`
      : `.crop-cell[data-rank="${rank}"][data-unit="${col.id}"]`);
  }

  // 格内那枚块。面板档按组 + at 找，两段块档只认那条带；都取不到就 null
  function flowInnerEl(cell, spec) {
    if (!cell || !spec) return null;
    const panel = cell.querySelector(".crop-detail");
    if (panel) {
      const groups = panel.querySelectorAll(":scope > .crop-detail__group");
      // 端点列（Emb / Norm / Head）的面板不分组，只有几枚算子：取第一枚
      if (!groups.length) return panel.querySelector("[data-node]");
      const g = groups[spec.seg === "attn" ? 0 : Math.min(1, groups.length - 1)];
      if (!g) return null;
      if (spec.at === "experts") return g.querySelector(".crop-detail__experts") || g;
      const ops = g.querySelectorAll("[data-node]");
      if (spec.at === "head") return ops[0] || g;
      if (spec.at === "tail") return ops[ops.length - 1] || g;
      if (spec.at) return g.querySelector(`[data-node="${spec.at}"]`) || g;
      return g;
    }
    const segs = cell.querySelector(".crop-segs");
    if (!segs) return null;
    return segs.querySelector(spec.seg === "attn"
      ? '.crop-seg[data-seg="attn"]'
      : '.crop-seg[data-seg="moe"], .crop-seg[data-seg="dense"]')
      || segs.querySelector('.crop-seg[data-seg="unit"]');
  }

  let flowAnchorGen = -1;
  const flowAnchorCache = new Map();

  /* 那枚块的中心，量成**相对这一格左上角的世界单位偏移** { dx, dy }。
     ⚠️ 量一次就够，之后逐帧只做 world→screen 的乘加：格内的排版在一次重绘之内是
     常量（面板按设计像素排好再整体 scale，带子的字号也是重绘时写死的），变的只是
     外面那一条 transform。反过来每帧对着十几条线的两端各读一次
     getBoundingClientRect，就是每帧几十次「读—写—读」交替，每次都逼出一趟强制
     重排 —— 而这一档正是一秒 60 帧都在跑的那一档。
     ⚠️ 存的是**相对格子的偏移**，不是绝对世界坐标：行标道的宽度随缩放变（见
     laneWorldAt），块的 x 跟着变，而重绘是节流的 —— 存绝对坐标的话，缩放那 170ms
     里线的起点会从格子上漂开。偏移是格内的量，与外面那条道无关，怎么缩都对得上。
     缓存按 renderGen 整批作废：重绘换了一批节点，量出来的旧偏移就不作数了。 */
  function flowInnerWorld(rank, block, ci, spec) {
    if (!spec || !layout || currentUnit() === "node") return null;
    if (flowAnchorGen !== renderGen) {
      flowAnchorCache.clear();
      flowAnchorGen = renderGen;
    }
    const key = `${rank}|${block.stage}|${ci}|${spec.seg}|${spec.at || ""}`;
    if (flowAnchorCache.has(key)) return flowAnchorCache.get(key);
    const cellEl = flowCellEl(rank, block, ci);
    const el = flowInnerEl(cellEl, spec);
    let out = null;
    if (el) {
      const r = el.getBoundingClientRect();
      const c = cellEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && view.k > 0) {
        out = {
          dx: (r.left + r.width / 2 - c.left) / view.k,
          dy: (r.top + r.height / 2 - c.top) / view.k,
        };
      }
    }
    flowAnchorCache.set(key, out);
    return out;
  }

  /* ══ 格内的计算流动 ══════════════════════════════════════════════════════
     一拍之内，把主角那一格内部的块按数据流次序点一遍白边：走过的留一道淡白边、
     正在算的那一枚是实白、这一拍的通信落点再单挂一圈 —— 于是「这条线是算到哪一步
     才发出去的」在图上看得见，而不是一条线突然从格子里飞出来。

     ⚠️ 起点不是每拍都从头来。一层里常有好几拍（TP、Router、Dispatch、Combine…），
     每拍都从 Input RMSNorm 重新点一遍就成了原地打转；同一格上连着的这几拍要从上一
     拍停下的那一枚接着往下点，那才是「一个 micro-batch 穿过这一层」的样子。换了格
     子（换层 / 换段 / 换卡）才归零。
     ⚠️ 只点主角那一格。对端那十几张卡也同时点，就是满屏白框闪 —— 而且它们那一格的
     内容在屏幕上往往还没铺出来（滚出视口就没有 DOM）。 */
  const FLOW_SWEEP_SEL = "[data-node], .crop-detail__experts, .crop-detail__res, .crop-seg";
  let flowSweep = null;

  function flowSweepStrip(sw) {
    if (!sw) return;
    sw.els.forEach((el) => el.classList.remove("is-flow", "is-flowdone", "is-flowsrc"));
  }

  function flowSweepReset() {
    flowSweepStrip(flowSweep);
    flowSweep = null;
  }

  /* 这一拍要点哪一格、从第几枚点到第几枚。resume 是上一拍的落点（同一格才接着走）。 */
  function flowSweepBuild(beat, resume) {
    flowSweepStrip(flowSweep);
    flowSweep = null;
    if (!beat || !layout || beat.wide || currentUnit() === "node") return;
    const block = flowBlockOf(beat.rank);
    const ci = clamp(beat.ci, 0, block.cols.length - 1);
    const els = Array.from(
      flowCellEl(beat.rank, block, ci)?.querySelectorAll(FLOW_SWEEP_SEL) || []);
    // 一枚也没有（整格上色那一档）或只有一枚：没有「逐个」可言，白框自己说完了
    if (els.length < 2) return;
    const key = `${beat.rank}|${block.stage}|${ci}`;
    const target = flowSweepTarget(els, beat, block, ci);
    const from = resume && resume.key === key ? clamp(resume.idx + 1, 0, target) : 0;
    flowSweep = { key, els, from, target, idx: -1, gen: renderGen, beat };
  }

  // 这一拍点到哪一枚为止 = 这条通信的落点那一枚；不落在某一枚上就点完整格
  function flowSweepTarget(els, beat, block, ci) {
    const el = flowInnerEl(flowCellEl(beat.rank, block, ci), flowAnchorOf(beat.step));
    const i = el ? els.indexOf(el) : -1;
    return i >= 0 ? i : els.length - 1;
  }

  /* 重绘换了一批 DOM：重新取一遍节点，进度（from / target / idx）原样保留。
     数目对不上说明格内换了一档（两段块 ↔ 算子面板），那时重建、从头点。 */
  function flowSweepReattach() {
    const sw = flowSweep;
    const block = flowBlockOf(sw.beat.rank);
    const ci = clamp(sw.beat.ci, 0, block.cols.length - 1);
    const els = Array.from(
      flowCellEl(sw.beat.rank, block, ci)?.querySelectorAll(FLOW_SWEEP_SEL) || []);
    if (els.length !== sw.els.length) {
      flowSweep = null;              // 旧节点已脱离文档，不必再摘类名
      flowSweepBuild(sw.beat, null);
      return;
    }
    sw.els = els;
    sw.gen = renderGen;
    sw.idx = -1;                     // 逼下一步重新贴一遍类名
  }

  function flowSweepAt(t) {
    if (!flowSweep) return;
    if (flowSweep.gen !== renderGen) flowSweepReattach();
    if (!flowSweep) return;
    const sw = flowSweep;
    const idx = clamp(sw.from + Math.floor(t * (sw.target - sw.from + 1)), sw.from, sw.target);
    if (idx === sw.idx) return;
    sw.idx = idx;
    sw.els.forEach((el, i) => {
      el.classList.toggle("is-flow", i === idx);
      el.classList.toggle("is-flowdone", i >= sw.from && i < idx);
      el.classList.toggle("is-flowsrc", i === sw.target);
    });
  }

  function flowPoint(rank, s, otherRank, beat) {
    const rps = Math.max(1, layout.ranksPerStage);
    const block = flowBlockOf(rank);
    const row = clamp(rank - block.stage * rps, 0, layout.rows - 1);
    const ci = clamp(flowCol(s, block, Math.floor(otherRank / rps), beat),
      0, block.cols.length - 1);
    /* 格内铺了内容的那两档钉到那枚块上；取不到就退回格子中心 —— 缩到只剩一块颜色
       时那本来就是唯一的落点。更新那两拍框的是整块（beat.wide），也走中心。 */
    const inner = beat && beat.wide ? null
      : flowInnerWorld(rank, block, ci, flowAnchorOf(s));
    const wx = block.x + ci * layout.cellW
      + (inner ? inner.dx : layout.cellW / 2);
    const wy = layout.rowY(row) + (inner ? inner.dy : layout.cellH / 2);
    return { x: view.x + wx * view.k, y: view.y + wy * view.k };
  }

  function flowPeersOf(s, anchor) {
    const all = commPeers(s.domain, anchor);
    if (/Ring/.test(s.event)) {
      const i = all.indexOf(anchor);
      const nxt = all[(Math.max(0, i) + 1) % all.length];
      return nxt === anchor ? [] : [nxt];
    }
    const list = all.filter((r) => r !== anchor);
    if (list.length <= FLOW_LINKS_MAX) return list;
    const out = [];
    const stride = (list.length - 1) / (FLOW_LINKS_MAX - 1);
    for (let i = 0; i < FLOW_LINKS_MAX; i += 1) out.push(list[Math.round(i * stride)]);
    return Array.from(new Set(out));
  }

  /* 弯曲的控制点：从两端连线的中点朝法线方向让开一段。同一束线交替左右、并按序号
     逐渐加大让开量，几十行跨度上的一束线才不会叠成一条。 */
  function flowBow(a, b, i, n) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const sign = i % 2 ? -1 : 1;
    const amp = Math.min(120, d * 0.2) * (1 + Math.floor(i / 2) * (n > 2 ? 0.3 : 0)) * sign;
    return { x: (a.x + b.x) / 2 - (dy / d) * amp, y: (a.y + b.y) / 2 + (dx / d) * amp };
  }

  function flowAt(a, cp, b, t) {
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * cp.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * cp.y + t * t * b.y,
    };
  }

  function svg(tag, cls) {
    const n = doc.createElementNS(SVG_NS, tag);
    if (cls) n.setAttribute("class", cls);
    return n;
  }

  function flowClear() {
    flowLinks = [];
    flowCtx = null;
    commFlow.textContent = "";
    /* 只摘掉格内那一圈类名、**不清** flowSweep：下一拍要靠它接着往下点。真正的
       归零在退出通信档 / 没有拍可播的地方（flowSweepReset）。 */
    flowSweepStrip(flowSweep);
  }

  function flowBuild(beat) {
    /* 计算流动的接力点要在 flowClear 之前取：flowClear 只摘类名、不动 flowSweep，
       正是为了让「上一拍点到第几枚」还读得到（见 flowSweepBuild 的 resume）。 */
    const resume = flowSweep ? { key: flowSweep.key, idx: flowSweep.idx } : null;
    flowClear();
    /* 计时器**先**归零再判有没有线可画：不产生跨卡通信的那几列（Emb / Head、
       并行度为 1 的 Dense 层）同样占一拍，漏掉这一行会让行程在那些列上瞬间穿过去。 */
    flowT0 = global.performance.now();
    if (!beat || !layout || !topology) return;
    const s = beat.step;
    const anchor = beat.rank;
    const g = svg("g");

    /* 主角那一格的白框。它比连线更早建、也**不依赖有没有通信** —— 行程扫到 Emb
       这种不通信的列时，"现在演的是哪张卡的哪一格"照样要答得出来。
       白线在浅底上会糊掉，所以底下垫一条半透明深色的粗框：两条同心矩形合起来读
       作"一圈带光晕的白描边"，在专家色块、热力火红、素底上都立得住。 */
    const halo = svg("rect", "crop-commflow__cell-halo");
    const cell = svg("rect", "crop-commflow__cell");
    g.append(halo, cell);

    const peers = s ? flowPeersOf(s, anchor) : [];
    const rpn = Math.max(1, layout.ranksPerNode);
    const mode = s ? flowMode(s) : "out";
    peers.forEach((peer, i) => {
      /* 逐条判机内 / 机间：这正是这一档要看的东西，用整组的 link.kind 一刀切会把
         「mixed」那一档最值钱的信息（哪几条出了机器）抹平成一个颜色。 */
      const kind = Math.floor(peer / rpn) === Math.floor(anchor / rpn) ? "local" : "inter";
      const path = svg("path", "crop-commflow__line");
      path.dataset.link = kind;
      const end = svg("circle", "crop-commflow__end");
      end.setAttribute("r", "4.5");
      end.dataset.link = kind;
      /* 对端那张卡也框出来，但只用一条细的半透明白线 —— 主角是实白粗框，两者一
         眼分得出主次。没有这一圈就只剩一个落在格子中间的小圆点，读不出"通信的
         另一头是**哪一格**"。 */
      const peerCell = svg("rect", "crop-commflow__cell crop-commflow__cell--peer");
      const dot = svg("circle", "crop-commflow__dot");
      dot.setAttribute("r", "4");
      dot.dataset.link = kind;
      let dot2 = null;
      if (mode === "both") {
        dot2 = svg("circle", "crop-commflow__dot");
        dot2.setAttribute("r", "4");
        dot2.dataset.link = kind;
      }
      g.append(peerCell, path, end, dot);
      if (dot2) g.appendChild(dot2);
      flowLinks.push({ peer, i, n: peers.length, path, end, dot, dot2, peerCell });
    });
    // 线的起点标记只在真有线的时候建：没有通信的那几拍，白框自己就说完了
    const src = peers.length ? svg("circle", "crop-commflow__anchor") : null;
    if (src) {
      src.setAttribute("r", "6");
      g.appendChild(src);
    }
    commFlow.appendChild(g);
    flowCtx = { beat, mode, src, halo, cell };
    flowSweepBuild(beat, resume);
    /* 先把两端的格内落点各问一遍再交给 flowDraw：flowPoint 是纯读的，而 flowDraw
       是一边读一边写 SVG 属性 —— 冷缓存那一帧里读写交替，几十条线就是几十趟强制
       重排。预热一次之后，flowDraw 那边全是缓存命中。 */
    if (s) {
      flowLinks.forEach((l) => {
        flowPoint(anchor, s, l.peer, beat);
        flowPoint(l.peer, s, anchor, beat);
      });
    }
    flowDraw();
  }

  /* 主角那一格在屏幕上的矩形。整机视角下一行是 8 张卡合成的一格，框就该框住那
     一整格（行首对齐到粒度边界）—— 否则框会横穿一条整机行的中间。 */
  function flowCellRect(beat) {
    const rps = Math.max(1, layout.ranksPerStage);
    const block = flowBlockOf(beat.rank);
    const span = currentUnit() === "node" ? layout.ranksPerNode : 1;
    let row = clamp(beat.rank - block.stage * rps, 0, layout.rows - 1);
    row -= row % span;
    const ci = clamp(beat.ci, 0, block.cols.length - 1);
    // 更新那几拍框住整块：它同步的是这一段所有层的参数，不是某一列（beat.wide）
    const wx = beat.wide ? block.x : block.x + ci * layout.cellW;
    const ww = beat.wide ? block.w : layout.cellW;
    return {
      x: view.x + wx * view.k,
      y: view.y + layout.rowY(row) * view.k,
      w: ww * view.k,
      h: layout.cellH * span * view.k,
    };
  }

  function flowDraw() {
    if (!flowCtx || !layout) return;
    syncGeometry(view.k);
    const { beat, mode, src, halo, cell } = flowCtx;
    const s = beat.step;
    const anchor = beat.rank;

    // 主角那一格：每帧现算（缩放平移时框要一直贴着那张卡）
    const box = (node, rect) => {
      node.setAttribute("x", rect.x);
      node.setAttribute("y", rect.y);
      node.setAttribute("width", Math.max(1, rect.w));
      node.setAttribute("height", Math.max(1, rect.h));
    };
    const r = flowCellRect(beat);
    box(halo, r);
    box(cell, r);
    // 动点自己循环：静态选中一条（没按播放）也要看得出方向
    const beatMs = flowBeatMs();
    const t = ((global.performance.now() - flowT0) % beatMs) / beatMs;
    /* 阶段带上正在涨的那一段：拍与拍之间是**连续**涨的，只改 --prog、不重建 DOM
       （与 training-monitoring-v2 的 tickProgress 同一手法）。 */
    /* 浮卡里那台 MoE 舞台：一拍之内把 16 个抽样 token 轮一遍，每个 token 各亮它
       自己的 top-k 连线（router 是 per-token 的，一次亮 16×k 条只会糊成一片）。 */
    if (flowMicro) {
      const step16 = t * MOE_TOK_SHOWN;
      updateMoeFocus(Math.min(MOE_TOK_SHOWN - 1, Math.floor(step16)), step16 % 1);
    }
    // 格内的计算流动：逐枚点白边，点到这一拍的通信落点为止（见 flowSweepAt）
    flowSweepAt(t);
    if (flowPlaying && flowPhaseCell && flowPhaseCell.n) {
      const p = (flowPos - flowPhaseCell.from + t) / flowPhaseCell.n;
      flowPhaseCell.el.style.setProperty("--prog", clamp(p, 0, 1).toFixed(4));
    }
    let head = null;
    flowLinks.forEach((l) => {
      const A = flowPoint(anchor, s, l.peer, beat);
      const B = flowPoint(l.peer, s, anchor, beat);
      const cp = flowBow(A, B, l.i, l.n);
      if (!head) head = A;
      /* 对端那一格的细白框。PP 的对端在另一段里（列号由 flowCol 现判），所以这里
         按"那张卡 + 它那一端落在哪一列"重算一次，不能直接套主角那一拍的列。 */
      box(l.peerCell, flowCellRect({
        rank: l.peer,
        ci: flowCol(s, flowBlockOf(l.peer), beat.stage, beat),
        wide: beat.wide,
      }));
      l.path.setAttribute("d", `M ${A.x} ${A.y} Q ${cp.x} ${cp.y} ${B.x} ${B.y}`);
      l.end.setAttribute("cx", B.x);
      l.end.setAttribute("cy", B.y);

      let out = mode === "out" || mode === "ring" || mode === "both";
      let tt = t;
      if (mode === "reduce") {           // 前半程聚上来、后半程散回去
        out = t >= 0.5;
        tt = out ? (t - 0.5) * 2 : t * 2;
      }
      const p = out ? flowAt(A, cp, B, tt) : flowAt(B, cp, A, tt);
      l.dot.setAttribute("cx", p.x);
      l.dot.setAttribute("cy", p.y);
      if (l.dot2) {                      // All-to-All：同一条线上两个方向同时在跑
        const q = flowAt(B, cp, A, tt);
        l.dot2.setAttribute("cx", q.x);
        l.dot2.setAttribute("cy", q.y);
      }
    });
    if (head && src) {
      src.setAttribute("cx", head.x);
      src.setAttribute("cy", head.y);
    }
  }

  function flowTick() {
    flowRaf = 0;
    if (!flowCtx && !flowPlaying) return;
    if (flowPlaying && global.performance.now() - flowT0 >= flowBeatMs()) {
      /* 换到下一拍：flowAdvance → setBeat → renderComm → flowSync 那条链里已经
         重建了连线、也重新排了下一帧，这里必须**直接返回**，否则本帧会再排一次，
         往后每换一拍就多一条 rAF 链。行程走完会绕回第一拍接着播，只有拍数为 0
         那一种情况才停，链断在 setPlaying(false) 上，由 flowLoop 兜底续上。 */
      flowAdvance();
      flowLoop();
      return;
    }
    flowDraw();
    flowRaf = global.requestAnimationFrame(flowTick);
  }

  function flowLoop() { if (!flowRaf) flowRaf = global.requestAnimationFrame(flowTick); }

  function flowStopRaf() {
    if (flowRaf) global.cancelAnimationFrame(flowRaf);
    flowRaf = 0;
  }

  function setPlaying(on) {
    if (flowPlaying === on) return;
    flowPlaying = on;
    commPlay.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    commPlay.classList.toggle("is-playing", on);
    commPlay.title = on ? "暂停" : FLOW_PLAY_TIP;
    commPlay.setAttribute("aria-label", on ? "暂停播放" : "逐层播放");
  }

  function setBeat(beat) {
    flowBeat = beat;
    renderComm();                        // 带子的选中态 + 浮卡 + 连线一起重写
  }

  /* 走完最后一拍就**回到开头接着播**，不停在末拍上。
     停在末拍的问题不是"停"，而是停下来之后那一拍的动点还在原地循环 —— 看起来
     和正常播放的一拍一模一样，只是永远不往下走，读成"这一步要等很久"。训练本来
     也是一个 step 接一个 step，绕回去正是它的样子。要停由用户按暂停。 */
  function flowAdvance() {
    flowPos = flowSeq.length ? (flowPos + 1) % flowSeq.length : 0;
    if (!flowSeq.length) { setPlaying(false); return; }
    setBeat(flowSeq[flowPos]);
  }

  /* 连线跟着「正在看的那一拍」走：点一条看一条、播放时一拍拍自动往后推，两条通路
     合并在这里，renderComm 末尾调一次就够。 */
  function flowSync() {
    const inComm = center.dataset.mode === "comm";
    /* 只要有拍就亮那一层 svg：没有通信的拍（Emb / Head、并行度为 1 的 Dense 层）
       里它画的是主角那一格的白框 —— 那一格照样要标出来。 */
    commFlow.classList.toggle("is-on", Boolean(flowBeat) && inComm);
    if (!flowBeat || !inComm) {
      flowClear();
      flowSweepReset();
      setPlaying(false);
      flowStopRaf();
      refreshRulers();
      return;
    }
    flowBuild(flowBeat);
    flowLoop();
    /* 顶部量尺要标出「现在扫到哪一列」。只重铺量尺，**不走 scheduleRender** ——
       那一趟要重建整幅平面的几千个格子，而行程每秒换一拍，一秒一次全量重铺会
       在播放期间抖成一片。量尺只有可视区那十几格。 */
    refreshRulers();
  }

  function refreshRulers() {
    if (!topology || !layout) return;
    syncGeometry(view.k);
    renderRulers(currentUnit());
  }

  /* 在画布上点中一格 = 把行程挪到这一格、从这儿往右接着演（见 pick 里那一支）。
     行程认的是**行**，所以点到别的行要整趟重排；落点取**当前那一阶段**里这一列的
     第一拍 —— 一格上可能有好几拍（一层里几条通信），从头一条起演才是"从这儿开始"。 */
  function flowJumpToCell(host) {
    if (!topology || !layout) return false;
    const rank = Number(host.dataset.rank);
    if (!Number.isFinite(rank)) return false;
    const seq = flowBeats(commSteps(topology.counts), flowRowOf(rank));
    if (!seq.length) return false;
    const layer = host.dataset.layer === undefined ? null : Number(host.dataset.layer);
    const unit = host.dataset.unit || null;
    /* 从**当前那一阶段**的这一格开演，不是一味回到前向：正在看反向的人点一格，
       问的是"反向走到这儿是什么样"，把他甩回前向等于换了个问题。当前阶段就是这一
       拍所在的阶段（阶段带上高亮的那一段），还没开演过则是前向。 */
    const phase = (flowBeat && flowBeat.phase) || "fwd";
    const atCell = (b) => b.rank === rank
      && (layer == null ? b.unit === unit : b.layer === layer);
    let i = seq.findIndex((b) => b.phase === phase && atCell(b));
    // 这一阶段不落在列上（更新那一段是整块一拍）：退到这一阶段里这张卡的第一拍
    if (i < 0) i = seq.findIndex((b) => b.phase === phase && b.rank === rank);
    // 这张卡在这一阶段一拍都没有：退到这一阶段的开头，阶段总比列更该守住
    if (i < 0) i = seq.findIndex((b) => b.phase === phase);
    if (i < 0) i = 0;
    flowSeq = seq;
    flowPos = i;
    setPlaying(true);
    setBeat(seq[i]);
    return true;
  }

  /* 进这一档时若还什么都没选，就摆好行程的第一拍 —— 这一档打开就该在动，而不是
     先摆一屏静态清单等人去点。 */
  function flowDefaultBeat(rank) {
    if (!topology || !layout) return null;
    const r = rank == null ? commAnchor() : rank;
    const seq = flowBeats(commSteps(topology.counts), flowRowOf(r));
    if (!seq.length) return null;
    /* 落在**这张卡**那一段的第一拍，而不是整趟的第一拍：点中 stage 2 的某张卡
       却把画面拉回 Emb，等于把人刚问的那个位置甩掉了。默认的 rank 0 本来就在第
       一段，所以"从 Emb 开始"这条对默认情形自动成立。 */
    const i = seq.findIndex((b) => b.rank === r);
    return seq[i < 0 ? 0 : i];
  }

  commRows.addEventListener("click", (event) => {
    const b = event.target.closest(".crop-comm__step");
    if (!b) return;
    /* 与热力那排胶囊同理：点带子里的一条不是「点画布空白」，不该把当前选中的那张
       卡清掉 —— 而这一档的「谁和谁」正是以那张卡为锚（见 config-relation-
       observer.js 的 SELECTABLE 兜底）。 */
    event.stopPropagation();
    setPlaying(false);                   // 手点一条 = 接管时间轴
    if (commSelId() === b.dataset.id) { setBeat(null); return; }
    const s = commSteps(topology.counts).find((x) => x.id === b.dataset.id);
    if (!s) return;
    setBeat(flowBeatFor(s, flowBeat ? flowBeat.rank : commAnchor()));
  });

  commPlay.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!topology || commPlay.disabled) return;
    if (flowPlaying) { setPlaying(false); return; }
    /* 行程由 renderComm 常驻维护（按当前这一行排）。这里只挑从哪一拍接着走：
       还没落到任何一拍上就从头，否则接着当前这一拍（播到末拍会自己绕回开头，
       所以这里不必再为"停在末拍"单开一条）。 */
    if (!flowSeq.length) {
      flowSeq = flowBeats(commSteps(topology.counts), flowRowOf(commAnchor()));
    }
    if (!flowSeq.length) return;
    const i = Math.max(0, flowIndexOf(flowSeq, flowBeat));
    flowPos = i;
    setPlaying(true);
    setBeat(flowSeq[flowPos]);
  });

  /* 阶段带一击 = 从这一阶段的第一拍开演。它既是进度条也是选择器 —— 想直接看反向
     那一段，不必把前向几十拍等完。 */
  commPhases.addEventListener("click", (event) => {
    const b = event.target.closest("[data-phase]");
    if (!b || !flowSeq.length) return;
    event.stopPropagation();
    const span = flowSpanOf(b.dataset.phase);
    if (span.from < 0) return;
    flowPos = span.from;
    setPlaying(true);
    setBeat(flowSeq[span.from]);
  });

  /* ── 三档切换 ──────────────────────────────────────────────────────────── */
  function setMode(mode) {
    center.dataset.mode = mode;
    board.dataset.mode = mode;
    modeTabs.querySelectorAll("[data-mode]").forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-selected", String(on));
    });
    // 浮卡与连线都挂在画布上而画布三档都在，离开通信档必须自己收起来
    if (mode !== "comm") {
      commDetail.hidden = true;
      setPlaying(false);
      flowClear();
      flowSweepReset();
      flowStopRaf();
      commFlow.classList.remove("is-on");
    }
    /* 通信与热力两档默认切到 **Rank 视角**：它们答的都是「**这张卡**在这一层上
       怎么样」—— 通信问的是这张卡和谁通信，热力问的是这张卡这一层多重。自适应
       档一缩小就把 8 张卡聚成一行，那个问题当场问不出来（行程的主角落在整机行
       里、热力的那一格是 8 张卡的平均）。默认只是默认：这一组按钮照常可点，
       用户切回自适应 / 整机之后本档内不再被顶回来（下次进这一档才重置）。 */
    if (mode === "comm" || mode === "heat") unitMode = "rank";
    if (mode === "comm") {
      // 进这一档就该有东西在动：还没选过就摆好行程的第一拍（默认那一行的最左列）
      if (!flowBeat) flowBeat = flowDefaultBeat();
      renderComm();
    }
    if (mode === "heat") {
      syncHeat();
      /* 热力档不沿用配置档留下的行 / 列选择；先把视线落到当前度量最严重的单格。 */
      if (relation) emit(null);
      selectHeatWorst();
      // 进这一档时正停在「专家负载」上：同样自动演一遍，不必先去找播放键
      if (heatMetric === "route") startRouteDemo();
    } else {
      // 「专家负载」的时间轴同理：画布都不在这一档了，让它在后台自己走没有意义
      setRoutePlaying(false);
      syncHeatBanner(null);        // 那条红横幅说的是热力图，别档里没有它要注解的东西
    }

    /* 详情栏在另两档里默认收起。
       它答的是「你选中的那个对象是什么」—— 刚切过来还没选任何东西，那一栏就是
       一句「未选中」的空话，却占着 336px；而通信与热力两档恰恰最吃画布宽度
       （一条通信要横跨几个 stage 块，热力要看整片色分布）。
       ⚠️ 不写 rightPinnedClosed —— 那面旗子记的是**用户**的表态，这里是页面替他
       收的。所以随后在画布上点中任何东西，cro:select 那条会照常把它推回来，
       正是「点了才出现」。回到配置档时，若此刻确有选中对象就还原。 */
    if (mode === "config") {
      /* 进这一档默认停在**当前配置评估**，而不是停在上一次点剩下的那个对象上：
         这一档回答的是「这份配置切成什么形状、跑不跑得起来」，是整份配置的事；
         而右栏里挂着的那份「Rank 96 是谁」是上一趟调查的残留 —— 换档回来第一眼
         该看到的是全局判定，要看某个对象再点它。清空同时也把画布上的高亮撤掉，
         省得平面上还亮着一行一列却无人认领。 */
      if (relation) emit(null);
      if (!rightPinnedClosed) right.classList.remove("is-collapsed");
    } else if (mode === "comm") {
      /* 运行观测把详解放进右栏，进入本档时默认展示；用户主动收起后仍尊重其选择。 */
      rightTitle.textContent = "运行详解";
      if (!rightPinnedClosed) right.classList.remove("is-collapsed");
    } else if (mode === "heat") {
      rightTitle.textContent = "负载详情";
      renderHeatDetail();
      if (!rightPinnedClosed) right.classList.remove("is-collapsed");
    } else {
      right.classList.add("is-collapsed");
    }
    syncPanelButtons();
    /* 画布从 display:none 里回来时视口尺寸才算得准，等一帧再铺。
       ⚠️ 这里**不能**调 fit()：切一趟页签回来就把用户的缩放与位置抹掉，等于
       每次去看一眼通信都要重新找回刚才在看的那几张卡。只夹一次边界（隐藏期间
       视口是 0，位置可能被 clamp 到界外）再重铺。 */
    /* 三档看的是**同一块画布**：热力换的只是格子的颜色，通信要的是「这条通信落在
       平面的哪一片」（后续播放要在这张矩阵上画线）。所以画布在三档里都不收，
       「换档之后带子高度变了、画布可视区跟着变」这条对三档都成立。 */
    global.requestAnimationFrame(() => { clampView(); applyTransform(); scheduleRender(); });
  }

  /* 横幅那句话：把当前这张图埋的那处故障翻译成一句人话，并且**指名道姓** ——
     「有一台机器慢」是废话，「整机 37 降频到 68%」才查得下去。
     六个度量各一句；「专家负载」那一档的问题随时间轴走，所以它写的是当前那一相。 */
  function heatBannerLine(hm) {
    if (!hm) return "";
    const F = hm.faults;
    /* 这一档的 lead 行不再重复相位名 —— 它就写在下面那条四段相位条上，而且是四相
       同框。lead 只留两样下面那条说不了的：拖到了第几个 step，以及塌缩点是哪张卡。 */
    if (heatMetric === "route") {
      const hot = hm.hot();
      const incident = hm.incident();
      if (!hot) return "";
      return `${routeStepText(routeTau)} —— 塌缩点在 Layer ${hot.layer} 的 E${hot.expert}`
        + `（EP rank ${hot.epIdx}）`
        + (routeTau > ROUTE_COLLAPSE_AT
          ? `：它正在吃掉本层 ${incident ? `${incident.expertTokens}/${incident.totalTokens}（${(ROUTE_COLLAPSE_MAX * 100).toFixed(1)}%）` : `${Math.round(ROUTE_COLLAPSE_MAX * 100)}%`} 的 token`
            + (incident ? `，${incident.deadExperts} 个 dead experts，send=${incident.sendTokens}/recv=${incident.recvTokens}` : "，同层其余全灭")
          : "：这会儿还只是偏，拖到底看它塌下去");
    }
    if (heatMetric === "mem") {
      return `MoE 显存不均 · EP rank ${F.oomEp} 上热门专家扎堆，permute 暂存 ×${F.oomBoost}`
        + " —— 图上那条横带是全图最先触顶的一批卡，MoE 的碎片 OOM 就是从这里开始的";
    }
    if (heatMetric === "flops") {
      return `PP 切分不均 · stage ${F.heavyStage} 这一段的层比别段重`
        + ` ${Math.round((F.heavyFactor - 1) * 100)}% —— PP 是按「层数」均分的，层却不等重，`
        + "所以整块列区偏亮；配置表单里它只是 pp 那一个数字，看不出来";
    }
    if (heatMetric === "busy") {
      return `慢卡 · 整机 ${F.slowNode} 的算力只剩 ${Math.round(F.slowFactor * 100)}%`
        + "（降频 / ECC 退化）—— 它是一条横跨所有列的带子，这正是它与「某一层重」的区别";
    }
    if (heatMetric === "idle") {
      return `同步点上的等待 · 全场在等整机 ${F.slowNode}（它在 PP stage ${F.slowStage}，同段等全额、`
        + "隔段等半份）—— 注意慢卡自己是唯一那条「暗」带：它不等人。与「计算时间」并着读";
    }
    if (heatMetric === "comm") {
      if (!F.rackSize) return "集群太小，机架级链路故障在这个规模上不成立（把卡数拨大再看）";
      return `机架级链路劣化 · 机架 ${F.rackLo}–${F.rackLo + F.rackSize - 1} 的 RDMA 只剩`
        + ` ${Math.round(F.rackFactor * 100)}%（上联光模块老化）—— 只打在「跨机」那几条通信上，`
        + "机内 HCCS 不受影响，所以带子只在有跨机通信的列上亮";
    }
    return "";
  }

  function syncHeatBanner(hm) {
    const model = hm || heatModel();
    const line = center.dataset.mode === "heat" ? heatBannerLine(model) : "";
    heatBanner.hidden = !line;
    heatBannerText.textContent = line;

    /* 四段相位条只属于「专家负载」那一档：别的度量没有时间轴，铺四段等于凭空多出
       一条读不动的进度。is-route 一挂，css 才把 .crop-heatbanner__phases 放出来。 */
    const isRoute = Boolean(line) && center.dataset.mode === "heat" && heatMetric === "route";
    heatBanner.classList.toggle("is-route", isRoute);
    heatBannerTag.textContent = isRoute ? "路由塌缩" : "本图的问题";
    if (!isRoute) return;

    const idx = routePhaseIndex(routeTau);
    heatBannerPhaseEls.forEach((p, i) => {
      p.seg.classList.toggle("is-active", i === idx);
      p.seg.classList.toggle("is-past", i < idx);
    });
    /* 末相把塌缩点写实：不指名道姓的话，「④ 路由塌缩」只是一句形容词，而这幅图
       真正的用处是**指到那张卡上**（同一份配置每次指同一张，可复现）。 */
    const hot = model ? model.hot() : null;
    const incident = model ? model.incident() : null;
    const last = heatBannerPhaseEls[heatBannerPhaseEls.length - 1];
    last.clock.textContent = routeTau >= 1 && hot
      ? `E${hot.expert} 吃掉 ${incident ? `${incident.expertTokens}/${incident.totalTokens}` : `${Math.round(ROUTE_COLLAPSE_MAX * 100)}%`} · Layer ${hot.layer} · EP rank ${hot.epIdx}`
      : ROUTE_PHASES[ROUTE_PHASES.length - 1].clock;
  }

  /* 胶囊的选中态、图例两端跟着当前度量一起写。「这是推演不是实测」那句不再是
     常驻脚注 —— 已经并进 HEAT_HINT_TEXT，挂在工具带最右侧那枚「?」上（见上面
     heatHelp 的构造），换度量不必重写它，静态挂一次就够。 */
  function syncHeat() {
    heatPills.querySelectorAll("[data-metric]").forEach((btn) => {
      const on = btn.dataset.metric === heatMetric;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    const meta = heatMeta(heatMetric);
    const hm = heatModel();
    const r = hm ? hm.range(heatMetric) : null;
    heatLegendLo.textContent = r ? heatFmt(r.lo, meta) : "—";
    heatLegendHi.textContent = r ? heatFmt(r.hi, meta) : "—";
    heatLegend.title = `冷蓝 = 这幅平面上最轻的一格，火红 = 最重的一格（${meta.label}）`;
    syncHeatBanner(hm);

    /* 时间轴那一组：只在「专家负载」露面。相位读数已经并进画布顶上那条横幅的四段
       相位条（syncHeatBanner 里写），这里只剩「拖不拖得动」这一件事。 */
    heatExtra.dataset.metric = heatMetric;
    if (heatMetric === "route") {
      const hot = hm ? hm.hot() : null;
      routeWrap.title = hot
        ? `塌缩点：Layer ${hot.layer} 的 E${hot.expert}（EP rank ${hot.epIdx}）—— 由当前配置定死，拖时间轴只改偏多少，不改偏在哪`
        : "当前配置没有路由专家（EP / Routed 不成立），这一档无内容";
      routeSlider.disabled = !hot;
      routePlay.disabled = !hot;
    }
  }

  heatPills.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-metric]");
    if (!btn) return;
    /* 主脚本在 document 上有一条「点到白名单之外 = 清空当前选择」的兜底（见
       config-relation-observer.js 的 SELECTABLE）。换一个度量不是「点空白」——
       正在看的那张卡不该因此被丢掉，与左右栏那几类自有可点对象同一处理。 */
    event.stopPropagation();
    heatMetric = btn.dataset.metric;
    syncHeat();
    /* 切到「专家负载」= 自动从头演一遍（这一档停在 τ=0 就是一片均衡，看起来像
       没坏的样子）；切走则停播 —— 另五个度量不吃这根轴，让它在后台自己走等于
       白烧一帧。 */
    if (heatMetric === "route") startRouteDemo();
    else setRoutePlaying(false);
    selectHeatWorst();
    scheduleRender();
  });

  /* ── 时间轴的播放 ────────────────────────────────────────────────────────
     一趟约 6 秒（50 格 × 120ms），走到头**定格**而不是回到起点循环：末相才是这次
     事故最终的样子，定格比转圈更有用（与运行事件那边机制图停在末相同一条理由）。
     再点一次播放键就从头开始 —— 已经在末尾时先归零。

     ⚠️ 切到这一档**自动从头演一遍**（startRouteDemo），不必先找播放键：另外五个
     度量切过去就是一张成品图，这一档切过去若停在 τ=0，看到的是一片均衡 —— 那正是
     「什么都没发生」的样子，读的人会以为这一档坏了。塌缩是这一档的全部内容，它得
     自己演出来。播放键留着，管的是**重播与暂停**。 */
  let routeTimer = 0;

  function setRoutePlaying(on) {
    if (on && !routeTimer) {
      if (routeTau >= 1) setRouteTau(0);
      routeTimer = global.setInterval(() => {
        setRouteTau(Math.min(1, routeTau + 0.02));
        if (routeTau >= 1) setRoutePlaying(false);
      }, 120);
    } else if (!on && routeTimer) {
      global.clearInterval(routeTimer);
      routeTimer = 0;
    }
    routePlay.innerHTML = routeTimer ? ICON_PAUSE : ICON_PLAY;
    routePlay.setAttribute("aria-pressed", String(Boolean(routeTimer)));
  }

  /* 从头演一遍。与「点播放键」的区别只有一处：这里**一律**归零重来，不管上一次
     停在哪 —— 切进这一档是一次「重新看一遍」的动作，接着上次的位置往下走等于把
     前三相那段慢性偏斜跳过去，而那半正是这一档要讲的东西。 */
  function startRouteDemo() {
    setRoutePlaying(false);
    setRouteTau(0);
    setRoutePlaying(true);
  }

  function setRouteTau(v) {
    routeTau = clamp(v, 0, 1);
    routeSlider.value = String(Math.round(routeTau * 100));
    /* 色阶两端跟着 τ 变（塌缩那一刻量程从 ~3× 跳到 ~60×），所以每一格都要重写
       图例 —— 不写的话颜色变了、刻度没变，读出来的倍数全是错的。 */
    syncHeat();
    renderHeatDetail();
    scheduleRender();
  }

  routeSlider.addEventListener("input", (event) => {
    event.stopPropagation();
    setRoutePlaying(false);          // 手动拖动 = 接管，播放让位
    setRouteTau(Number(routeSlider.value) / 100);
  });
  // 滑杆与播放键都在 SELECTABLE 白名单之外，不挡下来会被当成「点了画布空白」
  routeSlider.addEventListener("click", (event) => event.stopPropagation());
  routePlay.addEventListener("click", (event) => {
    event.stopPropagation();
    setRoutePlaying(!routeTimer);
  });

  modeTabs.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-mode]");
    if (btn) setMode(btn.dataset.mode);
  });

  /* ══ 七、接上主脚本的两个事件 ═════════════════════════════════════════════ */
  function onChange(t) {
    if (!t) return;
    // 「EP 口径」那一格被 controller.mount() 冲掉过就放回去，见 mountEpModeField
    mountEpModeField();
    topology = t;
    layout = buildLayout(t);
    annotateStructure();
    /* 静息态右栏评的是**当前配置**，配置变了它必须跟着重算；选中态不必 ——
       那一支答的是「这个对象是什么」，由 cro:select 驱动，与配置无关。 */
    if (!relation) renderDetail();
    // 世界尺寸变了（层数 / 卡数被拨动），首次或规模跳变时重新适配
    if (!fitted) { fitted = true; fit(); }
    scheduleRender();
    /* 通信观测档整档由 counts 现算，配置一拨（并行度、卡数、EP 口径）就要重列。
       播放同时停掉：事件清单本身换了一份，接着往下播等于在两份时间轴之间跳。 */
    setPlaying(false);
    renderComm();
    /* 热力模型按 topology 的身份缓存，换一份配置自动失效；图例两端是现写的
       文本，得在这里补一次 —— 否则色阶还标着上一份配置的量程。 */
    if (center.dataset.mode === "heat") {
      syncHeat();
      selectHeatWorst();
    }
  }

  /* 「高级选项」在这一栏里是一句可点的蓝字，不是一枚按钮 —— 悬浮气泡跟着一起撤：
     那句气泡说的是「这个折叠里收了哪几格」，展开一看就知道，而气泡本身要靠一块
     比字大一圈的热区才触发得到，正是要去掉的那块热区。
     只摘 data-hint（主脚本那套气泡的唯一触发条件），按钮的展开逻辑一行没动。
     ⚠️ 折叠是 controller.mount() 建的，而 mount 在主脚本 boot 里跑，排在本文件
     之后，所以这件事得等到 DOMContentLoaded 之后再做。 */
  function stripAdvancedHints() {
    left.querySelectorAll(".cro-advanced-toggle").forEach((btn) => {
      delete btn.dataset.hint;
      delete btn.dataset.hintReason;
    });
  }

  doc.addEventListener("cro:change", (event) => onChange(event.detail));
  doc.addEventListener("cro:select", (event) => {
    relation = event.detail || null;
    board.classList.toggle("is-focused", Boolean(relation));
    const selected = relation && relation.primary;
    const forceConfigDetail = center.dataset.mode === "config" && selected
      && (selected.kind === "rank" || selected.kind === "layer");
    /* 配置寻优里点具体 rank / layer 的直接结果就是右栏详情，即使用户之前手动收起过，
       这一击也要重新打开；其他对象与其他页签仍尊重用户的收起状态。 */
    if (forceConfigDetail) rightPinnedClosed = false;
    if (relation && (forceConfigDetail || !rightPinnedClosed)) {
      right.classList.remove("is-collapsed");
      syncPanelButtons();
    }
    renderDetail();
    if (center.dataset.mode === "heat") renderHeatDetail();
    annotateStructure();
    scheduleRender();
    /* 通信观测的「谁和谁」以选中的那张卡为锚。在画布上点中另一张卡 = 换一个视角
       重看，所以行程停下来、锚点跟过去、从新那张卡所在段的第一层重新摆一拍 ——
       否则连线还画在上一张卡上，与刚点亮的那一行对不上。 */
    if (center.dataset.mode === "comm"
      && relation && relation.primary && relation.primary.kind === "rank") {
      setPlaying(false);
      flowBeat = flowDefaultBeat(relation.primary.rank);
    }
    renderComm();
  });

  /* 拉窗口、收放左右栏都是**连续**的（一次拖拽几十上百个事件），与滚轮缩放同类，
     所以同样走节流的那条 —— 否则一次拖窗口就排上百次全量重铺。 */
  global.addEventListener("resize", () => { scheduleRenderSoft(); });

  /* 左右栏收放会改画布宽度，但那是 CSS 过渡、没有 resize 事件；
     ResizeObserver 盯住画布本身，宽高一变就重绘（虚拟化按视口裁剪，必须跟上）。 */
  if (global.ResizeObserver) {
    new global.ResizeObserver(() => scheduleRenderSoft()).observe(stage);
  }

  /* 主脚本 boot 挂在 DOMContentLoaded 上，且它的 script 标签排在本文件之前 ——
     监听器按注册序跑，boot() 先走完（含那次 controller.refresh() 发出的
     cro:change），本文件这一段才轮到。所以此刻 topology 通常已经就位；
     真正要补的只有一件事：boot 里的首帧是按**还没铺开**的画布宽度适配的，
     rAF 之后按终局宽高再适配一次。 */
  doc.addEventListener("DOMContentLoaded", () => {
    if (!topology) onChange(global.croObserver && global.croObserver.topology);
    stripAdvancedHints();
    renderDetail();
    renderComm();
    global.requestAnimationFrame(() => { fit(); scheduleRender(); });
  }, { once: true });

  applyTransform();
  renderDetail();
})(window);
