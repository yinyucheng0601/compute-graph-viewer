# AscendPort Migration V3 MLA 页面功能规格

来源页面：`/Users/yin/pto/ascendport_migration/ascendport_migration_V3_MLA.html`

本规格用于在按 PTO design system 刷新页面前，锁定原页面的功能、状态、数据和交互，防止新版遗漏行为。刷新后应以本文件最后的 checklist 做功能回归验收。

## 1. 页面定位

- 页面类型：单文件、桌面端 IDE/workbench 型交互 demo。
- 业务主题：DeepSeek-V3 Flash MLA / AscendPort GPU 到昇腾迁移工作台。
- 核心体验：从已完成的 S1 解析结果开始，沿 S2-S8 逐步运行迁移流程；编辑器、计算图、代码对比、tiling、流水线、终端、问题、数据流、精度报告、性能报告随阶段联动解锁。
- 设计系统迁移分类：`ide-frame`。新版应接入 PTO `patterns/ide-frame` 作为外框，并由 `workbench-shell` 或 `ide-frame` 的 split 能力承载多 pane 布局。
- 当前页面不依赖网络、fetch、localStorage、剪贴板、下载或外部包；所有数据和脚本均内联。

## 2. 初始状态

页面 boot 后不是 S0，而是 S1 已完成状态：

- `state.step = 1`，右侧按钮显示 `运行 S2 · 算子映射`。
- 左侧代码显示 `flash_mla_decode.cu`。
- 计算图默认打开。
- 终端默认有三行：
  - `AscendPort v0.9 · target=Atlas 800T A2 (Ascend 910B)`
  - `✓ S1 解析算子已完成 — 已生成计算图，点击任意节点可定位源码。`
  - `点击右侧「运行 S2 · 算子映射」继续迁移流程。`
- 问题面板默认有 2 个问题：`__shfl_xor_sync` 无昇腾对应物、`warp_bitonic_sort` 需重写为 TopK 原语。
- 状态栏显示分支 `migrate/lightning-indexer`、步骤状态、`AscendC · CANN 8.0`、`aicore —`、`FP8 · e4m3`、`UTF-8`。

## 3. 响应式行为

- 桌面端显示完整 app。
- 当 viewport 宽度小于等于 860px 时隐藏 app，只显示移动端提示：
  - 标题：`请在桌面端打开`
  - 说明：三栏 IDE 布局需要较宽屏幕。

## 4. 顶层布局

### 4.1 Titlebar

必须保留的信息：

- macOS 风格三色圆点，仅装饰，无点击逻辑。
- 标题：`flash_mla_decode.cu — deepseek-v3 · Flash MLA · AscendPort`。
- 菜单文本：`文件`、`编辑`、`迁移`、`运行`、`帮助`，无点击逻辑。
- 连接 badge：`AscendPort 已连接 · Atlas 800T A2`。

PTO 刷新建议：

- 迁移到 `ide-frame` topbar；不要保留私有实色 titlebar 视觉。
- 这些文案属于业务内容，应放在 consuming page，不应写入共享 pattern。

### 4.2 Activity rail

原页面有 5 个 icon：

- 菜单/列表图标，无逻辑。
- 文件夹图标，默认 active。
- 搜索图标，无逻辑。
- Source control 图标，无逻辑。
- 底部设置/齿轮图标，无逻辑。

新版必须至少保留 activity rail 的存在与 active 文件树语义。若按 PTO `ide-frame` 规范，应使用 Explorer、Search、Source control、Terminal 四个固定共享按钮语义，设置类入口不应误当成已有功能。

### 4.3 Sidebar / 文件树

文件树由 `hasCpp`、`tilingReady`、`activeTab` 动态渲染。

固定节点：

- 根：`DEEPSEEK-V3 · FLASH MLA`
- 文件夹：`ops/`
- 文件：`flash_mla_decode.cu`
- 文件：`mla_ref.py`
- 文件夹：`tests/`

阶段后动态节点：

- S3 后显示 `flash_mla_decode.cpp`，带 `NEW` 标签。
- S5 后显示 `tiling.h`，带 `NEW` 标签。
- S3 后显示 `build/` 文件夹。

点击行为：

- 点击 `.cu` 节点切换到 CUDA 源码。
- 点击 `.cpp` 节点切换到当前生成阶段源码：S3 用 `s3`，S4/S5 用 `s4`，S6 及之后用 `s6`。
- 点击 `tiling.h` 切换 tiling 源码并打开右侧 Tiling 可视化。

## 5. 主编辑区

### 5.1 Editor tabs

动态 tab：

- 始终有 `flash_mla_decode.cu`。
- S3 后有 `flash_mla_decode.cpp`。
- S5 后有 `tiling.h`。

交互：

- 点击 tab 只切换视图，不关闭文件。
- tab 中的 `×` 是视觉元素，没有关闭逻辑。
- 切换普通源码 tab 时会关闭 compare、tiling、pipeline 面板。

### 5.2 Toolbar

保留：

- 路径显示：`ops / <当前文件>`。
- 按钮：`解析算子 · 计算图`。

按钮行为：

- 点击时 toggle 计算图 pane。
- 打开计算图时关闭 compare、tiling、pipeline pane。
- 手动打开会向终端追加 `解析算子 → 生成计算图(手动触发)`。
- 只有当 `state.step === 0` 时会出现 S1 预览通知；按现有初始状态此通知正常不会触发。

### 5.3 Code viewer

代码 viewer 功能：

- 自绘行号 gutter。
- 自绘语法高亮：注释、字符串、预处理、数字、关键字、函数名、类型。
- 支持四类特殊行高亮：
  - `hl-risk`：CUDA SIMT 风险。
  - `hl-add`：新增/TODO/AscendC 操作。
  - `hl-buf`：缓冲、双缓冲、流水相关。
  - `hl-new`：S4/S6/tiling 新注入关键行。
- 渲染源码时滚动到顶部。
- 图节点、数据流步骤、S6 定位会触发行级滚动和高亮。

源码视图：

- `cuda`：`flash_mla_decode.cu`，内容为 Flash MLA Sparse Decode CUDA kernel。
- `s3`：`flash_mla_decode.cpp` AscendC 骨架。
- `s4`：`flash_mla_decode.cpp` 注入显式内存层次、DataCopy、Mmad、Vector reduce。
- `s6`：`flash_mla_decode.cpp` 注入双缓冲、CopyInKV、Ping-Pong 软件流水。
- `tiling`：动态生成的 `tiling.h`，受 S5 分块选择影响。

### 5.4 Split pane 互斥规则

`#split` 有 5 列：code、graph、compare、tiling、pipeline。四个右侧辅助 pane 互斥：

- `graph-open`
- `compare-open`
- `tiling-open`
- `pipe-open`

打开其中一个时必须关闭其他三个。新版不能把这些视图同时堆叠出来，除非用户明确改变信息架构。

## 6. 计算图 pane

### 6.1 打开和关闭

- 默认打开。
- toolbar 按钮打开/收起。
- `×` 关闭。
- 打开时渲染 SVG 计算图，节点入场动画。

### 6.2 Legend

必须保留 5 类执行单元图例：

- 片上搬运
- Cube 矩阵
- Vector 向量
- Scalar 标量
- SIMT 专属 · 需重写

### 6.3 图节点

节点数据必须保留：

| id | 标题 | 单元 | 副标题 | 源码行 |
|---|---|---|---|---|
| `q` | `Q[b,q,h] · FP8` | mem | `GM→L1→L0A` | 20-25 |
| `kv` | `KV Cache · FP8` | mem | `GM→L1→L0B` | 28-32 |
| `idx` | `indices[b,topk]` | mem | `GM→UB` | 28-32 |
| `qk` | `QK^T 点积` | cube | `Cube · Mmad` | 35-45 |
| `sm` | `Softmax` | vector | `Vector · Exp/Reduce` | 48-60 |
| `shf` | `block_reduce 规约` | risk | `__shfl_xor_sync` | 16-28 |
| `sync` | `__syncthreads` | risk | `线程块同步` | 30-45 |
| `vac` | `V 累加` | vector | `Vector · Axpy` | 62-70 |
| `out` | `Output + LSE` | mem | `UB→GM` | 72-76 |

边：

- `q → qk`
- `kv → qk`
- `idx → kv`
- `qk → sm`
- `sm → vac`
- `kv → vac`
- `shf → sm`
- `sync → sm`
- `vac → out`

交互：

- 点击节点选中该节点。
- detail 区显示执行单元 badge、节点标题、副标题、说明。
- 点击节点会切换到 CUDA tab，并滚动/高亮对应源代码行。
- S2 选择 `vector` 后，`risk` 节点显示为 vector 色，并出现 `✓改写` 标记；detail 文案前缀 `【已在 S2 改写】`。

## 7. CUDA ↔ AscendC 对比 pane

打开时机：

- S3 完成后打开 `s3` 对比。
- S4 完成前执行 `openCompare('s4')`，流式日志结束后再打开数据流 panel。

行为：

- 左侧固定显示 CUDA。
- 右侧显示生成的 AscendC。
- 左侧 pane header 显示 `flash_mla_decode.cu`、`CUDA · GPU`、`悬停/点击代码 ↔ 联动对侧`。
- toolbar 文件名变成 `lightning_indexer.cu ↔ .cpp`。
- compare 打开时计算图、tiling、pipeline 关闭。

代码联动：

- 根据 `LINKMAP.s3/s4/s6` 给两侧代码行打 `link-grp`。
- 悬停或点击某组任意一侧代码行，高亮两侧同组行，并滚动对侧到对应区域。
- 鼠标离开代码区清除联动高亮。

验收重点：

- 新版必须保留“同屏对比 + 悬停/点击联动 + 对侧滚动”的行为，不只是展示两份代码。

## 8. 底部 panel

### 8.1 Tabs

始终存在：

- `终端`
- `问题`
- `输出`

动态解锁：

- S4 后显示 `数据流` tab，badge `S4`。
- S7 后显示 `精度报告` tab，badge 初始为 `!`，修复后为 `✓`。
- S8 后显示 `性能报告` tab，badge `S8`。

行为：

- `终端` 和 `输出` 都显示同一个 `#term`。
- 点击 `数据流` 时，如果内容未渲染则渲染；点击其他 tab 时停止数据流播放。
- 点击 `精度报告` 重渲染报告。
- 点击 `性能报告` 以非播放态重渲染报告。

### 8.2 Terminal

功能：

- `termLine` 追加一行日志。
- `streamLog` 以 160ms 间隔逐行输出，并显示光标。
- 有 watchdog：`lines.length * 160 + 800ms` 后强制结束，避免按钮永久 disabled。
- `termBusy` 为 true 时运行按钮不响应。

日志颜色语义：

- `p`：命令。
- `g`：成功。
- `y`：警告。
- `r`：错误/风险。
- `b`：信息。
- `a`：强调/动作。
- `d`：弱文本。

### 8.3 Problems

默认问题：

- `__shfl_xor_sync` 无昇腾对应物。
- `warp_bitonic_sort` SIMT 双调排序需重写。

S7 后问题变为 1 个：

- `WeightedHeadReduce` 精度异常，`max_abs_err 3.1e-2`，详见精度报告。

精度修复后：

- 问题数清零。
- 面板显示 `无问题 —— 精度对齐通过`。

## 9. 右侧迁移向导

### 9.1 固定区域

- 标题 kicker：`算子迁移向导`
- 主标题：`GPU → 昇腾 · 八阶段流水`
- 说明：`逐步把 CUDA 算子迁移为 AscendC。每一步都可介入 —— 点击底部按钮执行当前阶段。`
- 顶部进度条显示 S1-S8。
- footer 按钮执行下一阶段；完成后变成 `↻ 重新开始迁移`。

### 9.2 Wizard 内容渲染规则

- 只展示当前已完成/正在查看的步骤，即 `STEPS[state.step - 1]`。
- 不展示下一步详情。
- 每张 step card 显示步骤编号、标题、sub、body。
- 如果 step 有 `risk`，显示风险卡。
- 如果 step 有 `choice`，在已完成 step card 中显示选项。
- 最后追加“迁移检查清单”，显示 8 个阶段完成/当前状态。

注意：原页面中 S2 和 S5 的选择项是在该步骤完成后才显示。运行 S2/S5 时会先用默认值：

- S2 默认 `vector`。
- S5 默认 `B`。

刷新时可保留此行为以保证 parity；如果要在执行前让用户选择，需要作为产品改动明确记录。

## 10. 阶段状态机

### 10.1 全局状态

必须保留或有等价状态：

- `state.step`
- `state.choices`
- `hasCpp`
- `activeTab`
- `tilingReady`
- `graphMapped`
- `accFixed`
- `problems`
- `termBusy`
- `flowIdx`
- `flowPlaying`
- `flowTimer`
- `tileAnimTimer`

### 10.2 S1 解析算子

当前页面 S1 在 boot 时已完成；`S1.run()` 仅在理论上可执行。

S1 内容：

- 解析 CUDA AST → 计算图。
- 识别融合算子。
- 风险：SIMT 专属结构，包括 `__shfl_xor_sync`、`warp_bitonic_sort`、`cg::thread_block`、`__shared__`。
- 提示用户点击计算图节点定位源码。

S1 run 副作用：

- `hasCpp = false`
- `graphMapped = false`
- 渲染树和 tabs。
- 切回 CUDA。
- 打开计算图。

### 10.3 S2 算子映射

选择项：

- `vector`，推荐：Vector 片上归约 + TopK 原语。
- `scalar`，不推荐：Scalar 逐元素模拟。

运行日志：

- 基础映射：QKᵀ → Cube，ReLU/加权归约 → Vector，Causal 掩码 → Vector，头权重 → UB。
- 若选 `vector`，追加 risk 节点更新日志和 Top-K 顺序校验提示。
- 若选 `scalar`，追加性能利用率警告。

完成副作用：

- 如果选择 `vector`，`graphMapped = true` 并重绘计算图。
- Wizard 显示 S2 卡片和算子映射表。
- 用户在 S2 卡片中切换选择时，实时更新图状态。

### 10.4 S3 代码生成

运行后：

- `hasCpp = true`
- 文件树和 tabs 新增 `flash_mla_decode.cpp`。
- 打开 CUDA ↔ AscendC 同屏对比，使用 `s3`。
- 终端日志说明新建 `lightning_indexer.cpp`、生成 Init/Process/ComputeScores/SelectTopK、插入 TODO。

### 10.5 S4 内存层次映射

运行时：

- 打开 `s4` 对比。
- 右侧 AscendC 中新注入内存层次代码高亮和闪烁。

完成后：

- 显示底部 `数据流` tab。
- 自动切换到数据流 panel。
- 渲染硬件数据流 SVG。
- 自动播放数据流动画。

### 10.6 S5 自动 Tiling

选择项：

- A：`sTile=128`，UB 61%，L0C 48%，回 GM 16 次，cycles 1.00x。
- B：`sTile=256`，UB 88%，L0C 96%，回 GM 8 次，cycles 0.72x，推荐。
- C：`sTile=512`，UB 103%，L0C 128%，回 GM 4 次，cycles 0.95x，溢出风险。

运行时默认 B。

完成后：

- `tilingReady = true`
- 文件树和 tabs 新增 `tiling.h`。
- 默认打开 `tiling.h`。
- 右侧打开 Tiling 可视化。

交互：

- 在 wizard 或 Tiling pane 中切换 A/B/C，必须同步更新：
  - `state.choices.S5`
  - Tiling 可视化
  - 当前打开的 `tiling.h` 源码
  - wizard 选中态

### 10.7 S6 流水线编排

完成后：

- 打开 `s6` AscendC 源码。
- toolbar 文件名显示 `lightning_indexer.cpp`。
- 右侧打开流水线前后对比 pane。
- 高亮并滚动到 S6 新增软件流水代码块，行 31-38。

### 10.8 S7 精度对齐

完成后：

- `accFixed = false`
- 问题面板变为 WeightedHeadReduce 精度异常。
- 显示 `精度报告` tab，badge `!`。
- 自动打开精度报告。

报告必须包含：

- KPI：`max_abs_err`、`cos_sim`、算子通过数。
- 逐算子表。
- 异常根因说明。
- 修复 diff。
- `应用修复并复测` 按钮。

点击修复：

- `accFixed = true`
- 问题数清零。
- `accCnt = ✓`
- 重渲染报告为通过态。
- 通知：`精度修复已应用`。

### 10.9 S8 性能剖析与调优

运行时：

- 如果用户未先修复精度，S8 会自动 `accFixed = true` 并清零问题。
- `aicore` 状态栏变为 `82%`。

完成后：

- 显示并打开性能报告。
- 最终 step 为 8，按钮变成 `↻ 重新开始迁移`。
- 通知迁移完成。

报告必须包含：

- KPI：`3.1×` 端到端加速、`31% → 82%` aicore 利用率、`76%` Cube 占用、`94%` MTE 隐藏。
- 直译版和优化版 msProf 泳道图。
- 利用率对比条。
- 调优发现与建议。
- 注册结果：`aclnnLightningIndexer`。

## 11. 可视化细节

### 11.1 S4 数据流动画

硬件单元：

- `Global Mem` / `GM · HBM`
- `L1 Buffer` / `片上缓存`
- `L0A` / `Cube 输入·q`
- `L0B` / `Cube 输入·k`
- `Cube` / `Mmad · QKᵀ`
- `L0C` / `矩阵输出·logits`
- `Unified Buffer` / `UB · 头权重/打分`
- `Vector` / `ReLU · Σw·(·)`

边：

- `gm_l1`
- `l1_l0a`
- `l1_l0b`
- `l0a_cube`
- `l0b_cube`
- `cube_l0c`
- `l0c_vec`
- `gm_ub`
- `ub_vec`

步骤：

| 序号 | 标题 | 高亮单元 | 高亮边 | 代码行 |
|---|---|---|---|---|
| 1 | DataCopy 头权重 GM→UB | gm, ub | gm_ub | 30 |
| 2 | DataCopy kI GM→L1→L0B | gm, l1, l0b | gm_l1, l1_l0b | 38-40 |
| 3 | DataCopy qI GM→L1→L0A | gm, l1, l0a | gm_l1, l1_l0a | 42-45 |
| 4 | Mmad 矩阵乘 → L0C | l0a, l0b, cube, l0c | l0a_cube, l0b_cube, cube_l0c | 47-50 |
| 5 | Relu 激活 · L0C→UB→Vector | l0c, vec, ub | l0c_vec | 52-53 |
| 6 | WeightedHeadReduce 加权归约 | ub, vec | ub_vec | 54 |

交互：

- `播放`：每 1500ms 自动进入下一步。
- `暂停`：停止计时器。
- `单步`：停止播放并进入下一步。
- 每次步骤切换会生成沿边移动的 packet 动画。
- 如果 compare pane 正打开，会同步高亮 AscendC 对应行。

### 11.2 S5 Tiling 可视化

必须保留：

- 分块方案卡：A/B/C。
- S 总长固定 `2048`。
- `nTile = ceil(S_TOTAL / sTile)`。
- S 维分块条，每块显示 sTile；尾块若存在带 tail 状态。
- `演示分块搬运过程` 按钮，逐块点亮。
- UB 与 L0C 占用条和 100% capacity line。
- 溢出提示或驻留最大化提示。
- 代价评估：回 GM 次数/行、相对 cycles、sTile。

### 11.3 S6 流水线对比

必须保留：

- `播放流水时序`。
- 编排前：串行 `搬运→计算`，含 Cube 空转斜纹气泡。
- 编排后：双缓冲 Ping-Pong，`预取 n+1 ∥ 计算 n`。
- 指标：总周期 `15 → 10`、流水气泡 `21% → 4%`、吞吐提升 `1.50×`。

### 11.4 S8 性能泳道图

必须保留：

- before：MTE/Cube/Vector 串行，总耗时 18 cycle。
- after：双缓冲重叠，总耗时 10 cycle。
- `播放泳道时序` 按钮触发 cell 入场动画。
- Legend：MTE、Cube、Vector、idle。
- 对比条：aicore 总利用率、Cube 占用率、MTE 隐藏率。

## 12. 精度报告数据

逐算子表数据：

| 算子 | 单元/类型 | 初始误差 | 初始状态 | 修复后 |
|---|---|---|---|---|
| DataCopy (GM→L1/UB) | 搬运 | 0 | 通过 | 通过 |
| Mmad · QKᵀ | Cube | 2.4e-4 | 通过 | 通过 |
| Relu | Vector | 0 | 通过 | 通过 |
| WeightedHeadReduce | Vector | 3.1e-2 | 异常 | 8.0e-4，已修复 |
| TopK · Top-K 规约 | Vector | —，命中率 100%(2048/2048) | 通过 | 通过 |

异常根因：

- FP8 累加顺序不一致。
- CUDA 使用 FP32 寄存器串行累加。
- 昇腾 Vector 归约次序不同，中间 FP8/FP16 累加导致误差放大。

修复方案：

- `ReduceSum<fp16_t>` 改为 `ReduceSum<float>`。
- 增加 `SetReduceOrder(HEAD_ORDER_FIXED)`。

## 13. 通知系统

通知行为：

- 右下角出现。
- 自动 3400ms 后淡出并移除。
- `kind=ok` 使用成功边框色。
- 每个阶段完成后通知：`✓ Sx 完成`。
- 全部完成后通知：`迁移完成`。
- 精度修复后通知：`精度修复已应用`。

## 14. Reset 行为

点击完成态按钮 `↻ 重新开始迁移` 后：

- 回到 S1 已完成状态，不回到 S0。
- 清空终端。
- 关闭 compare、tiling、pipeline。
- 停止数据流播放。
- 隐藏并清空数据流、精度报告、性能报告 panel。
- `hasCpp=false`
- `graphMapped=false`
- `activeTab='cuda'`
- `tilingReady=false`
- `accFixed=false`
- 问题恢复为 2 个。
- `aicore —`
- 重新渲染 tree、tabs、CUDA、progress、wizard。
- 打开计算图。
- 终端写入就绪提示。

## 15. 内容一致性风险

原页面存在命名混用，新版刷新时必须有意识处理，不要无意丢失：

- 页面标题/源码主线是 `flash_mla_decode.cu`、Flash MLA Sparse Decode。
- 向导/终端/状态栏多处使用 `lightning_indexer.cu/.cpp`、`fused_lightning_indexer_kernel`、`aclnnLightningIndexer`。
- S1/S2/S3 文案中有 indexer/Top-K 语义，和 Flash MLA decode 源码语义并不完全一致。

验收策略：

- 若目标是视觉刷新 parity，应保留这些原文案。
- 若目标是产品语义统一，应单独列为 copy/content 修订，不应混在视觉刷新里静默修改。

## 16. PTO 设计系统刷新约束

刷新前端时必须保留功能语义，但视觉和壳层应迁移：

- 页面 shell：使用 PTO `patterns/ide-frame`，而非保留私有 `.titlebar/.activity/.sidebar/.main/.wizard/.statusbar` 壳层视觉。
- Split 行为：若新版支持拖拽或持久化 pane 尺寸，应通过 `patterns/workbench-shell` 或 `ide-frame` 初始化，不写本地 resize 内核。
- Pane 互斥和业务 view state 必须保留，即 graph/compare/tiling/pipeline 仍是可打开的业务模式。
- Buttons、tabs、badges、cards、panels、inspector/report sections 应映射到 PTO token/component，不保留私有按钮/卡片视觉系统。
- Data-viz 色彩可以作为语义编码保留：执行单元色、risk/ok/warn、泳道 cell、数据流 packet、图节点类别属于 data-viz exemption。
- 通用容器的私有 border、left rail、inset shadow、side gradient 不应原样 token-swap；应改为 PTO pane/inspector/report pattern。
- 原页面没有真实拖拽 resize、下载、复制、搜索、关闭 tab、菜单命令、activity rail 切换，这些不是遗漏项，不应误加为 parity 要求。

## 17. PTO Pattern 映射

本节把原页面的业务 surface 映射到现有 PTO patterns。映射优先级是：先用 `ide-frame` 承载页面 shell，再用具体 pattern 承载 graph/timeline/architecture 行为；如果现有 pattern 语义不匹配，不能硬套，应走 preview gate 或新增共享 pattern。

### 17.1 Shell / workbench

| 原页面区域 | PTO pattern | 嵌入方式 | 映射结论 | 备注 |
|---|---|---|---|---|
| 整体三栏 IDE shell：titlebar、activity、sidebar、editor、wizard、statusbar | `patterns/ide-frame` | direct embedding | `pattern-migrate` | 新版 root 应为 `.pto-ide-frame[data-ide-frame][data-host="standalone"]`，业务内容放入 pane slot。 |
| 主工作区多 pane：文件树、代码/图、右侧向导、底部 panel | `patterns/workbench-shell`，由 `ide-frame` 委托 | direct embedding | `pattern-migrate` | 原页面只有 CSS grid 切 pane，没有真实拖拽。若新版要可拖拽和持久化尺寸，必须用 `PtoWorkbenchShell.initResizablePanes` 或 `PtoIdeFrame.init`，不要本地写 resize 内核。 |
| 底部终端/数据流/报告 dock | `patterns/ide-frame` bottom dock 语义 + PTO tabs/buttons | direct embedding | `migrate` | Terminal 和 visualization/report 属于同一底部区域；若新版加 Terminal toggle，不能与 bottom visualization 同时显示为两个底栏。 |

### 17.2 计算图 graph

原页面计算图是 9 节点轻量算子数据流 DAG：节点是 `Q/KV/indices/QK^T/Softmax/block_reduce/__syncthreads/V/out`，边是算子依赖，点击节点联动源码行。

| 候选 pattern | 适配度 | 是否采用 | 原因 |
|---|---:|---|---|
| `patterns/model-graphviz` | 低 | 不直接采用 | 该 pattern 面向模型架构 Graphviz、module/op/state/tensor 层级、折叠 cluster、报告 overlay。当前是小型算子数据流图，没有模型层级/cluster/参数节点语义，硬套会引入错误交互和视觉假设。 |
| `patterns/pass-ir-graph-node` | 中低 | 可借鉴节点卡，不作为完整图容器 | 该 pattern 只覆盖 Pass-IR op/tensor/incast/outcast/group node card contract，不拥有 DAG layout、edge routing、源码联动 detail。若新版把节点做成 Pass-IR 风格卡片，可用 `PtoPassIrGraphNodePattern.buildNodeCardElement` 生成节点，但图 layout/edge/focus 仍需另有 pattern。 |
| 新共享 pattern：`operator-compute-graph` 或 `ascend-operator-dataflow-graph` | 高 | 推荐走 preview gate 后吸收到共享系统 | 当前图需要 compact DAG、执行单元 colormap、risk→vector 重映射、节点 detail、源码行联动、无初始选中、可选 pan/zoom。现有 registry 没有完全匹配的算子级 graph pattern。 |
| 页面内 direct SVG + PTO token | 中 | 只作为短期 parity 方案 | 如果刷新目标只是保功能，可保留产品页本地 SVG renderer，但必须把 pane shell、controls、legend、detail 映射到 PTO tokens/components，并把节点/边颜色标为 data-viz exemption。若该图会复用，应先抽成共享 pattern。 |

推荐新版映射：

- Graph pane 外壳：`ide-frame` pane header/body。
- Graph canvas：优先新增共享 `operator-compute-graph` pattern，或短期保留 direct SVG renderer。
- 节点数据：继续使用 `GNODES/GEDGES` 业务数据，不迁入共享 pattern。
- 交互：保留 `selectNode(id)`、源码行高亮、S2 `graphMapped` 状态。
- 视觉：执行单元色 `mem/cube/vector/scalar/risk` 为 data-viz colormap；普通 pane、legend、detail badge 使用 PTO token/component。
- 禁止：把此图伪装成 `model-graphviz` 模型架构图；默认状态不要选中节点。

### 17.3 S4 数据流 / 内存架构图

原页面 S4 数据流是 GM、L1、L0A/L0B、Cube、L0C、UB、Vector 的硬件数据路径动画，包含 step play/step、route packet、代码行联动。

| 原页面功能 | PTO pattern | 嵌入方式 | 映射结论 | 备注 |
|---|---|---|---|---|
| 硬件内存层级图主体 | `patterns/memory-architecture` | direct embedding | `pattern-migrate` | 应调用 `PtoMemoryArchitecturePattern.renderArchitecture` 或为 Flash MLA 增加 preset，不复制本地 SVG DOM。 |
| 路径高亮与 step focus | `patterns/memory-architecture` route/path focus APIs | direct embedding | `pattern-migrate` | 用 `setPathFocus` / `clearPathFocus` 或 route overlay，不用本地改 stroke-width；focus 用 opacity/glow。 |
| 架构图 viewport、zoom/readout、detail toggle | `patterns/hardware-architecture-viewport` | direct embedding，可选 | `migrate` | 如果新版把 S4 图做成大 architecture viewport，使用该 pattern；如果只是嵌在 bottom dock 的小面板，可不加完整 viewport chrome。 |
| S4 播放/暂停/单步控制 | PTO button/toolbar + 本页 step state；可选 `floating-playback-control` | direct embedding | `needs-decision` | 原页面确有 step playback 语义。若要统一为全局 floating playback，需要用户确认；否则保留 pane-local controls，使用 PTO buttons。 |
| packet 沿边移动动画 | `memory-architecture` route overlay extension | direct embedding / shared extension | `needs-preview` | 现有 memory pattern 支持 route focus，但 packet 动画是否作为共享能力要先 preview/确认；不要在产品页手写长期维护的 route geometry。 |

推荐新版映射：

- 若目标是“真实硬件架构图”：新增或复用 `memory-architecture` preset，把 GM/L1/L0/Cube/UB/Vector 作为可 focus 节点，S4 六个 `FLOW_STEPS` 转为 `setPathFocus` payload。
- 若目标是“轻量教学数据流”：保留本地业务 step 数据，但将 route geometry 抽入一个小型共享 graph/architecture pattern；至少不能把普通容器视觉留成本地 CSS。
- `FLOW_STEPS` 的 `code` 字段仍由产品页负责，用于联动 AscendC 对比代码行。

### 17.4 Swimlane / timeline

原页面有两类 timeline：

- S6 流水线前后对比：MTE/Cube/Vector 三行，串行 vs 双缓冲，含 bubble/idle。
- S8 性能报告泳道图：msProf 直译版 vs 优化版，MTE/Cube/Vector 三行，含 idle、播放入场动画。

| 原页面功能 | PTO pattern | 嵌入方式 | 映射结论 | 备注 |
|---|---|---|---|---|
| 单个 timed task bar | `patterns/swimlane-task` | direct canvas drawing | `pattern-migrate` | 使用 `PtoSwimlaneTaskPattern.drawTaskBar`，不要继续用 page-local absolute div cell 重写 bar。 |
| task colormap | `patterns/swimlane-task` | direct | `pattern-migrate` | 使用 `createTaskColormap` / `colorFromColormap`；MTE/Cube/Vector/idle 属于泳道数据语义。 |
| hover tooltip | `patterns/swimlane-task` | direct | `migrate` | 如果新版需要 tooltip，调用 `initHoverTooltip` 和 `formatTaskTooltip`；原页面没有 tooltip，可作为增强但不是 parity 必需。 |
| lane row / axis / before-after report shell | 产品页 layout + PTO panel/report tokens | direct | `migrate` | `swimlane-task` 拥有 task bar，不拥有整个报告 shell、KPI、axis、before-after card。 |
| idle/bubble 斜纹 | data-viz exemption 或 shared swimlane idle state | direct / needs-preview | `needs-preview` | 当前 pattern 主要绘制 task bar，idle/bubble 斜纹如果要复用，应作为 swimlane pattern 状态吸收；短期可保留为 data-viz encoding。 |

推荐新版映射：

- 把 S6/S8 的 `buildSerial/buildPipe/perfSwimBefore/perfSwimAfter` 数据结构规范化为 `{ laneId, start, duration, kind, label, status }`。
- 每条 bar 用 `drawTaskBar` 渲染；lane label、axis、legend、KPI 由产品页用 PTO tokens/components。
- 对没有输入/输出语义的 MTE/Cube/Vector event，不要伪造 `inputRawMagic/outputRawMagic`，让 `swimlane-task` 使用单段 compute bar。
- `idle/bubble` 可以先作为 data-viz exemption，但若多页面复用，先做 preview 并扩展 shared pattern。

### 17.5 Tiling / buffer occupancy

| 原页面功能 | PTO pattern | 嵌入方式 | 映射结论 | 备注 |
|---|---|---|---|---|
| S 维分块条、逐块播放 | 暂无完全匹配 pattern | direct / preview | `needs-preview` | 这是 tiling-specific strip，不等于 swimlane timed task，也不是完整 memory architecture。建议作为 `tiling-block-strip` 候选 pattern。 |
| UB / L0C 占用条 | `memory-architecture` buffer-block APIs 可借鉴 | direct / shared extension | `migrate` | 若嵌入到 architecture 图，可用 `setBufferBlocks` 表示局部 buffer occupancy；若保持右侧 tiling pane，使用 PTO progress/meter tokens 或新增 shared mini-meter pattern。 |
| A/B/C 方案选择 | PTO segmented/toggle/card primitives | direct | `migrate` | 不保留私有 `.tp-opt` 视觉；业务数据留在产品页。 |

### 17.6 精度/性能报告

| 原页面功能 | PTO pattern/component | 嵌入方式 | 映射结论 | 备注 |
|---|---|---|---|---|
| 精度 KPI、逐算子表、异常修复卡 | PTO `panel-shell` / inspector sections / table styling | direct | `migrate` | 原页面报告不是 graph pattern；用 shared components 和 tokens，删除本地 bordered card 语言。 |
| 性能 KPI、调优建议、注册结果 | PTO report/panel components + swimlane task bars | direct | `migrate` | KPI/report shell 用 PTO components；泳道 bars 用 `swimlane-task`。 |
| 修复 diff code block | PTO code/editor surface tokens | direct | `migrate` | 保留 diff 内容和按钮行为，替换本地 `.acc-diff/.acc-apply` 视觉。 |

### 17.7 Pattern 使用总表

| Pattern id | 用于哪些原功能 | 采用方式 | 状态 |
|---|---|---|---|
| `ide-frame` | 整体页面 shell、activity rail、pane headers、bottom dock/status | direct | 必须采用 |
| `workbench-shell` | 主体 split、可选拖拽/持久化 pane 尺寸 | direct，经 `ide-frame` | 必须采用或由 `ide-frame` 调用 |
| `swimlane-task-bar` | S6 pipeline bars、S8 msProf swimlane bars | direct canvas API | 推荐采用 |
| `memory-architecture-layout` | S4 GM/L1/L0/Cube/UB/Vector 数据流、路径 focus | direct API / 新 preset | 推荐采用，可能需 preset 扩展 |
| `hardware-architecture-viewport` | 大型内存架构图 viewport、zoom/readout/detail 控制 | direct，可选 | 视新版布局采用 |
| `pass-ir-graph-node` | 计算图节点卡视觉候选 | direct node card API，可选 | 只适合节点卡，不是完整 graph |
| `model-graphviz` | 不用于本页 9 节点算子图 | 不采用 | 语义不匹配 |
| 新候选 `operator-compute-graph` | 计算图完整 DAG、节点 detail、源码联动、S2 remap | preview 后共享化 | 建议新增，若该 graph 会复用 |
| 新候选 `tiling-block-strip` | S5 S 维分块条和搬运动画 | preview 后共享化 | 建议新增，若 tiling UI 会复用 |

### 17.8 Pattern 映射验收项

- [ ] 新版页面加载 `ide-frame` 和必要的 `workbench-shell` 依赖，并调用 `PtoIdeFrame.init` 或 `initAll`。
- [ ] S6/S8 timed bars 不再由 page-local `.tl-cell/.swim-cell` 视觉系统长期维护；已映射到 `swimlane-task` 或明确标为短期 parity。
- [ ] S4 内存路径不在产品页手写 route geometry；已使用 `memory-architecture` route/focus API，或已为缺失能力创建 preview。
- [ ] 计算图没有误用 `model-graphviz`；若继续 direct SVG，已标记为短期方案并记录新增 shared graph pattern 的决策。
- [ ] `pass-ir-graph-node` 只在采用 Pass-IR 节点卡语义时使用，没有被当作完整 graph renderer。
- [ ] Tiling 分块条若继续复用，已进入 preview gate 或抽为 shared mini pattern。
- [ ] 所有 pattern 的业务数据仍留在产品页；共享 pattern 不包含 Flash MLA 样例文件名、日志或阶段文案。

## 18. 功能遗漏检查 Checklist

### 18.1 Shell 和布局

- [ ] 桌面端显示完整 IDE/workbench 页面。
- [ ] 小屏显示“请在桌面端打开”提示或等价阻断。
- [ ] 顶部保留页面标题、菜单文案、连接状态语义。
- [ ] 左侧 activity rail 保留，Explorer/文件树为默认 active 语义。
- [ ] 文件树、编辑器、右侧迁移向导、底部 panel、状态栏都存在。
- [ ] 新版使用 PTO `ide-frame` 作为基础 shell。
- [ ] 新版没有保留未审批的私有整体 chrome 视觉。

### 18.2 初始状态

- [ ] 初始为 S1 已完成，不是空白 S0。
- [ ] 初始按钮为 `运行 S2 · 算子映射`。
- [ ] 初始打开计算图。
- [ ] 初始代码为 `flash_mla_decode.cu`。
- [ ] 初始问题数为 2。
- [ ] 初始终端三行就绪日志存在。
- [ ] 初始状态栏 `aicore —`。

### 18.3 文件树和 tabs

- [ ] 初始仅显示 `.cu` 和 `mla_ref.py` 等基础文件。
- [ ] S3 后出现 `.cpp` 文件和 tab，带 `NEW`。
- [ ] S5 后出现 `tiling.h` 文件和 tab，带 `NEW`。
- [ ] `.cpp` tab 在不同阶段显示正确代码版本：S3/S4/S6。
- [ ] `tiling.h` tab 受 S5 选择同步更新。
- [ ] tab 中 `×` 不应被误实现为关闭，除非产品明确新增。

### 18.4 Code viewer

- [ ] 行号 gutter 正常。
- [ ] 语法高亮正常。
- [ ] CUDA risk 行高亮正常。
- [ ] S4/S6/tiling 新增关键行高亮正常。
- [ ] 渲染新源码时滚动到顶部。
- [ ] 图节点/数据流/S6 定位能滚动并高亮代码行。

### 18.5 计算图

- [ ] toolbar 按钮可打开/关闭计算图。
- [ ] 计算图打开时关闭 compare/tiling/pipeline。
- [ ] 5 类 legend 都存在。
- [ ] 9 个节点和 9 条边完整。
- [ ] 点击节点显示 detail。
- [ ] 点击节点切回 CUDA 并高亮对应行。
- [ ] S2 vector 后 risk 节点转为 vector 语义并显示改写状态。

### 18.6 Compare 联动

- [ ] S3 后自动打开 CUDA ↔ AscendC 对比。
- [ ] S4 运行时打开 S4 对比。
- [ ] 左侧固定 CUDA，右侧为对应生成代码。
- [ ] 代码分组 hover/click 可双侧高亮。
- [ ] 代码分组 hover/click 会滚动对侧到对应位置。
- [ ] 鼠标离开代码区清除联动高亮。

### 18.7 底部 panel

- [ ] `终端`、`问题`、`输出` tab 始终存在。
- [ ] `输出` 与 `终端` 显示同一日志内容。
- [ ] S4 后解锁 `数据流` tab。
- [ ] S7 后解锁 `精度报告` tab。
- [ ] S8 后解锁 `性能报告` tab。
- [ ] 切出数据流 tab 会停止播放。
- [ ] 终端流式日志期间运行按钮不可重复触发。

### 18.8 Wizard 和状态机

- [ ] 顶部进度显示 S1-S8。
- [ ] Wizard 只展示当前已完成步骤卡片。
- [ ] 每步 card 的 body/risk/choice 内容未丢失。
- [ ] 迁移检查清单完成态/当前态正确。
- [ ] footer 按钮执行下一阶段。
- [ ] 完成后按钮变成重新开始。
- [ ] Reset 回到 S1 已完成状态。

### 18.9 S2

- [ ] S2 默认选择 vector。
- [ ] S2 支持 vector 和 scalar 两个选项。
- [ ] vector/scalar 选择文案和推荐/警告标签完整。
- [ ] 算子映射表完整显示 8 行。
- [ ] 切换 S2 选择会更新计算图 risk 映射。
- [ ] S2 终端日志按选择追加正确分支。

### 18.10 S3

- [ ] S3 后 `hasCpp` 生效，`.cpp` 出现在树和 tabs。
- [ ] S3 后打开 compare。
- [ ] S3 右侧代码为 AscendC 骨架。
- [ ] S3 日志说明 codegen、文件创建、TODO、compare 打开。

### 18.11 S4

- [ ] S4 后代码显示内存层次注入版本。
- [ ] 新注入行有醒目高亮/闪烁或等价强调。
- [ ] S4 后底部数据流自动打开。
- [ ] 数据流硬件单元和边完整。
- [ ] 播放/暂停/单步可用。
- [ ] 数据流步骤可联动右侧 AscendC 代码行。

### 18.12 S5

- [ ] S5 默认选择 B。
- [ ] A/B/C 三个分块方案数据完整。
- [ ] S5 后 `tiling.h` 解锁并自动打开。
- [ ] Tiling 可视化打开。
- [ ] 切换 A/B/C 同步源码、可视化和 wizard。
- [ ] 分块搬运动画可逐块点亮。
- [ ] UB/L0C 占用、溢出/推荐提示、代价评估完整。

### 18.13 S6

- [ ] S6 后打开 S6 源码。
- [ ] S6 新增软件流水代码块高亮并滚动到视野。
- [ ] 右侧打开流水线前后对比。
- [ ] 串行和双缓冲 timeline 都存在。
- [ ] 播放流水时序按钮可触发动画。
- [ ] 总周期、气泡、吞吐提升指标完整。

### 18.14 S7

- [ ] S7 后问题变为 WeightedHeadReduce 精度异常。
- [ ] S7 后打开精度报告。
- [ ] KPI、逐算子表、异常说明、修复 diff 完整。
- [ ] `应用修复并复测` 按钮可点击。
- [ ] 修复后 `max_abs_err=8.0e-4`、`cos_sim=0.99987`、通过数 `5/5`。
- [ ] 修复后问题清零，报告 badge 为 `✓`。

### 18.15 S8

- [ ] S8 若未手动修复精度，也会清零问题并设为修复态。
- [ ] S8 后状态栏 `aicore 82%`。
- [ ] 性能报告自动打开。
- [ ] 4 个 KPI 完整。
- [ ] 直译/优化泳道图完整。
- [ ] 利用率对比条完整。
- [ ] 调优建议 4 条完整。
- [ ] 注册 `aclnnLightningIndexer` 文案完整。
- [ ] 完成通知出现。

### 18.16 通知和计时器

- [ ] 每阶段完成后有通知。
- [ ] 精度修复后有通知。
- [ ] 通知自动消失。
- [ ] 数据流播放计时器可停止。
- [ ] Tiling 动画计时器重复点击不会叠加多个 interval。
- [ ] 终端 stream watchdog 不会让按钮永久 disabled。

### 18.17 视觉/设计系统迁移

- [ ] 页面 shell 已改用 PTO `ide-frame`。
- [ ] 多 pane/resize 若存在，使用 PTO `workbench-shell` 或 `ide-frame` API。
- [ ] 按钮、tab、badge、panel、card、report section 使用 PTO token/component。
- [ ] 数据可视化颜色被明确标记为 data-viz exemption。
- [ ] 私有 left rail、inset shadow、side gradient 没有作为普通容器视觉残留。
- [ ] 业务功能没有被视觉迁移重排到不可发现位置。
