# 更新记录

- 2026-09-11：精简 v4 左侧重复工具栏与 Router KPI，只保留 Top1 Expert/Owner，将 Idle/CV 下沉事件详情；修复窄面板下架构 Module 展开/收起按钮的暗色可见性和点击命中区域。
- 2026-09-11：将共享 `model-architecture-front-view` Pattern 接入 openPangu MoE 事故回放 v4，替换页面私有架构坐标/分层；补齐 46 Layer pager、Dense/MoE 分支、mHC ×4 residual、256 Routed Experts、E193 placement/load 与 Dispatch→Router 联动。
- 2026-09-11：完成 openPangu 模型正视图事实层 Phase 1A，生成并验证 `model_architecture_graph.v1`，补齐 mHC/MoME 残差语义、互斥 MoE 通信分支与 E000–E255 Routed Experts 父子层级。
- 2026-09-11：在 openPangu MoE 事故回放规格中新增模型正视图专项纠偏，明确源码解析产物、mHC/MoME 残差语义、Routed Experts 父子层级、256 Expert 全量展开及前后端交付边界。
- 2026-09-11：扩展 openPangu MoE 事故回放规格，记录 v4 多数据源审计结果，并新增 schema-first 单一 artifact、跨视图一致性校验和六阶段架构纠偏计划。
- 2026-09-10：新增 training-structure-time-v4 MoE 通信异常现场回放：固定 Step 15203、EP Group / EP Rank 层级、异常事件基线详情、L38 training sidecar 定位和 256 Routed Experts 双向联动；v3 已归档到本地 `.local-archive/`。
- 2026-09-10：新增 openPangu MoE 通信异常现场回放规格，明确固定 step 入口、EP Group/EP Rank 泳道层级、异常事件状态、Layer 选择与 Router/Routed Experts/EP 通信双向联动。
- 2026-09-09：升级 training-timeline.v2，保留 ST 的 reduce-scatter / clip / optimizer / params-all-gather 参考形状；新增参数组、optimizer state shard、collective group 和独立训练运行时图，完成 Optimizer 事件双向联动。
- 2026-09-09：Rank 展开后移除重复摘要通信；Optimizer 保留真实时长并设 4px 最低可见宽度；补齐 Pro 可见节点到演示事件的映射；dropdown 改用 input tokens，不再伪装为按钮。
- 2026-09-09：事件按绘制区间分轨，激活驻留独立展示；展开的 DP/PP 不再叠画所有 Rank。删除默认状态摘要，hover 缩为一句，info 改用浅色 panel-shell 与系统链接按钮。
- 2026-09-09：默认全部 DP；修复 Pro 的 L1 / L2 结构展开；泳道行头去除 tag 边框、完整显示 Rank 名称并对齐展开按钮；补充行头与事件 / 并集 hover 说明。
- 2026-09-09：按轻量 demo 范围收敛数据：仅 L2 典型算子，其他层 / 输出头为概览；保留 8 MB/DP 的完整 step 调度、通信和交互。撤销全层明细方案，保留 schema + 离线生成器 + JSON 消费前端。
- 2026-09-09：恢复完整 step / 全部 MB 视角，拆分 MB 焦点与结构选择，修复并集边界及通信参与者投影；ST 保留为研究证据。
