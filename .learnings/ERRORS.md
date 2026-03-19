## [ERR-20260306-001] sample-path-validation

**Logged**: 2026-03-06T18:08:00+08:00  
**Priority**: low  
**Status**: pending  
**Area**: docs

### Summary
手工验证聚合分组时使用了不存在的样本路径，导致 Node 读文件失败。

### Error
```
Error: ENOENT: no such file or directory, open '/Users/yin/pto/deepseek_out_pass/sample_computation_graph.json'
```

### Context
- Command/operation: Node 脚本读取样本 JSON 统计可聚合簇数量
- Input path: `/Users/yin/pto/deepseek_out_pass/sample_computation_graph.json`
- 实际情况: 该文件不在当前目录，需先 `ls`/`rg --files` 校验样本路径

### Suggested Fix
在手工验证脚本前增加文件存在性检查，或统一使用 `rg --files deepseek_out_pass | head` 选取可用样本。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md

---

## [ERR-20260316-001] rg-quote-pattern

**Logged**: 2026-03-16T03:42:32Z  
**Priority**: low  
**Status**: pending  
**Area**: docs

### Summary
在校验新写的 tiling 笔记标题和关键关键词时，`rg` 命令的引号拼接写错，导致 shell 直接报语法错误。

### Error
```
zsh:1: unmatched "
```

### Context
- Command/operation: 对 `/Users/yin/pto/业务理解/deepseek_910B_tiling_guide.md` 运行 `rg -n` 做标题和关键词校验
- Root cause: 模式字符串里混用了单双引号，导致 zsh 在命令解析阶段就中断，而不是 `rg` 本身执行失败
- Impact: 文档内容已成功写入，但多做了一次补充校验

### Suggested Fix
后续写包含反引号、中文和正则的 `rg` 模式时，优先统一用单引号包裹整个 pattern；如果 pattern 内必须含单引号，再拆成更简单的多个 `rg` 查询，避免一次命令里混合过多引号层级。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md, 业务理解/deepseek_910B_tiling_guide.md

---

## [ERR-20260316-002] shell-backtick-pattern

**Logged**: 2026-03-16T15:41:00+08:00  
**Priority**: low  
**Status**: pending  
**Area**: docs

### Summary
在用 `rg` 校验新重写的 loop/controlflow 文档时，把带反引号的搜索词直接放进 shell 命令，触发了命令替换。

### Error
```
zsh:1: command not found: 32
```

### Context
- Command/operation: 对 `业务理解/Pass_如何把前端IR变成Execute_Graph_研究笔记.md` 和 `业务理解/Loop_循环体与ControlFlow_研究笔记.md` 运行 `rg -n`
- Root cause: 搜索模式里直接包含了 Markdown 反引号内容，如 ``step `32```，zsh 先做了命令替换
- Impact: 只是最后一轮校验命令出错，文档文件本身已正常写入

### Suggested Fix
后续对包含反引号的 Markdown 文本做 `rg` 搜索时，优先使用单引号包裹整个模式，或拆成多个不含反引号的简单关键词，避免 shell 先解释 pattern。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md, 业务理解/Pass_如何把前端IR变成Execute_Graph_研究笔记.md, 业务理解/Loop_循环体与ControlFlow_研究笔记.md

---

## [ERR-20260310-001] node-check-html

**Logged**: 2026-03-10T11:31:00+08:00  
**Priority**: low  
**Status**: pending  
**Area**: tests

### Summary
把 `node --check` 直接用于 `.html` 文件会失败，因为 Node 只支持检查 JavaScript 输入。

### Error
```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".html" for /Users/yin/pto/launch.html
```

### Context
- Command/operation: `node --check launch.html`
- Goal: 校验 `launch.html` 内联脚本语法
- 实际情况: 需要先提取 `<script>` 内容，或改用浏览器级检查方式

### Suggested Fix
对 HTML 页面使用脚本提取方式做语法校验，例如先抽取最后一个 `<script>` 再交给 `node --check`。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md, launch.html, visual-test.html

---

## [ERR-20260311-001] safaridriver-enable

**Logged**: 2026-03-11T14:17:29+08:00  
**Priority**: medium  
**Status**: pending  
**Area**: tests

### Summary
尝试用 Safari WebDriver 做 `visual-test.html` 截图验收时，`safaridriver` 因未启用远程自动化而无法启动会话。

### Error
```
RuntimeError: safaridriver did not start
Password:
```

### Context
- Command/operation: 启动 `safaridriver -p 4445` 并通过 WebDriver 打开 `http://127.0.0.1:8123/visual-test.html`
- 实际情况: 本机需要先执行 `safaridriver --enable`，且该命令要求管理员密码交互
- 影响: 当前会话只能完成静态语法校验，不能完成浏览器截图验收

### Suggested Fix
在本机管理员已启用 Safari Remote Automation 后，再运行浏览器级截图/DOM 验收脚本；或安装无交互的 headless 浏览器工具链用于本地验收。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md, visual-test.html

---

## [ERR-20260311-002] qlmanage-svg-preview

**Logged**: 2026-03-11T16:32:00+08:00  
**Priority**: low  
**Status**: pending  
**Area**: tests

### Summary
尝试用 `qlmanage -t` 将本地 SVG 设计稿转成 PNG 预览时，在当前 Codex 沙箱内失败。

### Error
```
sandbox initialization failed: Operation not permitted
```

### Context
- Command/operation: `qlmanage -t -s 1600 -o /tmp /Users/yin/Downloads/L2.svg`
- Goal: 把 `L2.svg` / `L2_attention_expand.svg` 转成位图，便于在会话中直接查看设计稿
- 实际情况: 当前环境不允许 `qlmanage` 初始化其所需沙箱能力，只能退回 SVG 源码坐标分析

### Suggested Fix
后续若需要在本地自动验收 SVG 设计稿，优先使用仓库内可执行的纯前端/Node 渲染方案，避免依赖 `qlmanage`。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md

---

## [ERR-20260319-001] parallel-mv-dir-race

**Logged**: 2026-03-19T10:07:00+08:00  
**Priority**: low  
**Status**: pending  
**Area**: config

### Summary
在同一轮并行工具调用里同时创建目录并执行 `mv`，会因为执行时序不确定导致部分移动命令先于 `mkdir` 运行。

### Error
```
mv: rename /Users/yin/pto/index.html to /Users/yin/pto/pass-ir/index.html: No such file or directory
```

### Context
- Command/operation: 使用并行工具同时执行 `mkdir -p /Users/yin/pto/pass-ir ...` 和多个 `mv`
- Root cause: 目录创建与依赖该目录的移动命令不应并行
- Impact: 只有 `pass-ir/index.html` 这一步失败，其他目录移动已完成

### Suggested Fix
后续涉及“先建目录再移动文件”的操作时，先顺序完成 `mkdir -p`，再批量执行 `mv`；不要把存在依赖关系的 shell 命令放进同一个并行调用。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md

---
