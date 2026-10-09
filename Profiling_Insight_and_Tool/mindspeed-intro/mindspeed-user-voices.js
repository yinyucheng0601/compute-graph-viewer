(() => {
  const voices = [
    {
      title: '并行切分、算子约束与精度定位',
      source: '何*｜华为（盘古）',
      quote: '比较容易出现在并行切分不对，或有些融合算子不满足约束条件，可能需要几个迭代，一开始打得粗一点再打到细节点，打印完还要识别到哪一行代码或哪个算子有问题；打印出来之后还要自己写工具做tensor对比、算矩阵相似度。如果能直接可视化整网模型、对应到代码，点选节点自动加dump，再可视化对比golden差异，会方便很多。',
      solution: '用户上传或粘贴 YAML、JSON、Shell 启动配置，让 MCP 先统一字段，再检查 TP/PP/CP/EP/VPP、层数、Attention Head、专家数、序列长度和总 Rank 等已建模的切分约束；若不合法，说明不能改的字段后获取经过复验的最小修改方案，并查看每个 Rank 的并行坐标和通信组。当前能直接解决“并行切分配置不合法”这一部分；不能分析融合算子专有约束，也不能自动 Dump、比较 Tensor 或定位代码行。',
      tools: ['parse_training_config', 'validate_parallel_config', 'suggest_config_fixes', 'compute_rank_topology']
    },
    {
      title: 'AI 结论必须带方法与证据',
      source: '张**｜华为（盘古）',
      quote: '如果专家完全不懂profile分析、全靠AI给结果，短期不可靠。应该是有经验专家把经验提炼给AI；AI分析时不光给结果，还把要注意的分析方法同时交给专家，过程和结果结合起来才可信。',
      solution: '用户要求“给结论，同时说明规则、公式、来源、假设和置信等级”。MCP 用确定性规则计算，返回规则编号、相关字段、约束公式、来源引用和假设；Rank 结果标记为 `page-derived`，容量结果标记为 `theoretical`，便于专家复核。该能力只覆盖配置、拓扑和理论容量结论，不覆盖 Profiling 专家诊断。',
      tools: ['validate_parallel_config', 'compute_rank_topology', 'suggest_config_fixes', 'estimate_training_capacity']
    },
    {
      title: '报错应直指参数与约束',
      source: '李**｜华为（盘古）',
      quote: '算子报错信息经常不明确。有时plog里有有效信息，但Python侧不会直接显示，用户还要自己去查plog。问题可能来自整网代码，也可能是某个shape不支持，当前报错往往不说明具体原因。如果能直接指出哪个参数的shape是什么、违反了什么约束，就能更快定位；参数使用错误也应该直接报出，避免完整跑完后才从精度异常中发现。',
      solution: '用户在启动训练前提交配置，MCP 会把已支持的配置参数映射成统一字段，明确指出具体字段值违反了哪条约束及对应公式，并可生成修复候选。例如 Attention Head 不能被 TP 整除、序列长度不满足 CP 规则、专家数不能被 EP 整除。当前不能读取 plog，也不能诊断运行时算子的任意 Tensor shape、dtype 或内存越界。',
      tools: ['parse_training_config', 'validate_parallel_config', 'suggest_config_fixes']
    },
    {
      title: '架构、拓扑与性能数据要联动',
      source: 'G23｜英伟达',
      quote: '架构与性能联动依靠全局时间戳、算子ID、计算图节点ID、rank及张量ID建立映射。工具先导入PyTorch graph IR，再在训练过程中采集算子耗时、算力、显存和通信数据，并挂载到Transformer、Attention、FFN等模型节点。界面按集群拓扑、DP/TP/PP/MoE并行时序、模型与算子联动三层下钻，可查看异常rank、流水线气泡、负载倾斜、通信等待、权重读取、梯度计算及跨rank规约。',
      solution: '用户提供模型、集群和并行配置后，可询问“Rank 13 在哪个节点、哪个 PP Stage，TP/DP/CP/EP 组成员是谁”或“每个 Stage 承担哪些层”。MCP 返回逐 Rank 坐标、节点、Stage 和通信组，先解决静态集群与并行拓扑映射。当前结果是 `page-derived`，不能导入 graph IR，也不能把耗时、显存或通信实测数据挂到拓扑上，更不能据此识别异常 Rank、气泡或倾斜。',
      tools: ['compute_rank_topology', 'validate_parallel_config']
    },
    {
      title: '训推一致性与线上漂移定位',
      source: 'G23｜英伟达',
      quote: '上线前先核对训推两端混合精度、loss scaling、归一化、激活算子，校验是否统一用TE算子、并行分片和NCCL同步；再锁版本、保证训推同镜像。线上开NVTX张量埋点，定时导权重和中间特征快照；发生漂移后按单卡、多卡、算子、并行、数据链路分层定位。',
      solution: '用户分别提交训、推配置或启动参数，让 MCP 显式列出已映射、未识别、已忽略和缺失字段；对训练配置做并行约束校验、Rank 拓扑展开和理论容量预检，提前发现已建模的分片配置错误或理论 OOM 风险。当前没有专用的训推一致性比较 Tool；不能核对 TE 算子、NCCL 运行同步、镜像版本，也不能采集 NVTX、权重或特征快照。',
      tools: ['parse_training_config', 'validate_parallel_config', 'compute_rank_topology', 'estimate_training_capacity']
    }
  ];

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const renderCard = (voice, index) => {
    const card = element('article', 'real-voice-card');
    const meta = element('div', 'real-voice-card__meta');
    meta.append(
      element('span', 'real-voice-card__index', `VOICE ${String(index + 1).padStart(2, '0')}`),
      element('span', 'voice-trust-label voice-trust-label--real', '真实原声'),
      element('span', 'real-voice-card__source', `声音来源 · ${voice.source}`)
    );

    const quote = element('blockquote');
    quote.append(element('p', '', `“${voice.quote}”`));

    const solution = element('p', 'real-voice-card__solution');
    solution.append(element('strong', '', 'MCP对应解决方案与Tool'), document.createTextNode(voice.solution));

    const tools = element('ul', 'real-voice-card__tools');
    tools.setAttribute('aria-label', 'MCP 对应工具');
    voice.tools.forEach((tool) => tools.append(element('li', '', tool)));

    card.append(meta, element('h3', '', voice.title), quote, solution, tools);
    return card;
  };

  const renderFloor = (mount) => {
    const section = element('section', 'real-user-voices');
    section.setAttribute('aria-labelledby', 'real-user-voices-title');

    const shell = element('div', 'shell');
    const head = element('div', 'real-voice-head');
    const heading = element('div');
    heading.append(
      element('p', 'eyebrow', 'Real field voices · 5 / 5'),
      element('h2', '', '来自真实现场的 5 个问题。')
    );
    heading.querySelector('h2').id = 'real-user-voices-title';

    head.append(heading);

    const grid = element('div', 'real-voice-grid');
    voices.forEach((voice, index) => grid.append(renderCard(voice, index)));
    shell.append(head, grid);
    section.append(shell);
    mount.replaceChildren(section);
  };

  document.querySelectorAll('[data-real-user-voices]').forEach(renderFloor);
})();
