# PTO 设计系统｜协作使用说明

这是一份打包好的 **PTO 设计系统**，可以丢给任何 AI 编程工具（Claude Code、Cursor、Windsurf、ChatGPT 文件上传…），让它**自动**按 PTO 的颜色、字体、间距、组件规范来生成或改造网页。

> 简单说：你给 AI 一个产品需求或现有 demo，AI 会按 PTO 样式产出网页，**不需要你再手动调样式**。

## 这个文件夹里有什么

```
design-system-share/
├── README.md                    ← 当前文件，给你看的使用说明
├── SKILL.md                     ← 给 AI 看的规则（让 AI 先读这个）
├── DESIGN.md                    ← 设计系统全景说明（颜色 / 字体 / 间距 / 组件 / 治理）
├── design-system-preview.html   ← 用浏览器打开就能看到所有组件长什么样
├── references/
│   ├── quick-reference.md       ← 一页速查：所有 token 和 class 名
│   ├── pto-design-system-map.md ← 元素分类规则（什么时候用什么按钮）
│   └── preview-gate.md          ← 遇到系统没有的样式时的审批流程
├── tokens/                      ← CSS 变量（颜色 / 间距 / 圆角 / 字体）
│   ├── foundation.css
│   ├── semantic.css
│   └── components.css
├── css/style.css                ← 真正的 class 实现
├── swimlane/styles.css          ← swimlane 模块样式（预览页要用）
└── patterns/                    ← 6 个可复用 pattern（图节点 / 泳道 / 内存架构 / AIV / AIC / Pass-IR）
```

## 怎么用

### 第 0 步：先在浏览器打开看看

双击打开 `design-system-preview.html`，先大致扫一眼系统长什么样，方便后面验收 AI 的输出。

### 场景 A：从产品需求生成新页面

1. 把整个 `design-system-share/` 文件夹一起丢给 AI 工具
2. 给 AI 这样的指令：

   > 先读 `SKILL.md`。我要一个 PTO 样式的新页面，用途是：[在这里写你的产品需求，比如"算子调试面板，左侧文件树、中间代码编辑器、右侧 inspector"]。按 Workflow A 来做。

3. AI 会：
   - 列出页面需要哪些 UI 元素（按钮、面板、表格、卡片…）
   - 把每个元素对应到 PTO 已有的 class 和 token
   - 产出符合 PTO 样式的 HTML / CSS

### 场景 B：把现有 demo 改成 PTO 样式

1. 把 `design-system-share/` 文件夹 **+ 你的 demo 文件** 一起丢给 AI
2. 给 AI 这样的指令：

   > 先读 `SKILL.md`。把这个 demo 改造成 PTO 样式，按 Workflow B 来做。

3. AI 会先给你一张 **迁移对照表**，告诉你它打算把哪个元素换成哪个 PTO class、哪些颜色换成哪个 token：

   | demo 里的元素 | 对应 PTO 组件 | 用的 class / token |
   |---|---|---|
   | `<button class="cta">运行</button>` | solid 主按钮 | `btn btn-solid` |
   | `background: #1a1a1a` | surface-2 | `var(--color-surface-2)` |
   | `padding: 16px` | space-4 | `var(--space-4)` |

4. 你看一遍没问题，让它继续，AI 就会真的改 HTML / CSS

## 验收 AI 输出时检查这几点

打开生成的页面，对比 `design-system-preview.html`，确认：

- 所有颜色都用 `var(--color-...)` 或 `var(--surface-...)`，**没有硬编码的 `#xxxxxx`**
- 间距用 `var(--space-1)` ~ `var(--space-6)`，**不要写死 `padding: 13px`**
- 按钮用 `btn` / `btn btn-solid` / `btn btn-ghost`，**没有 `.my-button`、`.custom-cta` 这种自创 class**
- AI 在最后会列出**"复用了哪些 PTO 组件"**和**"哪些地方系统没覆盖到"**
- 如果 AI 偷偷加了新颜色 / 新按钮样式但**没有标注**，直接打回让它改

## 遇到 PTO 系统没覆盖的情况怎么办

如果你的需求里有一个组件 PTO 现在没有（比如要一个特殊的进度条），AI 会：

1. **停下来**，不会瞎造
2. 做一个 preview 给你看：现有最接近的是什么、它想新加的是什么、各种状态长什么样
3. 等你说"可以用这个"再继续

详见 `references/preview-gate.md`。

## 一些常见问题

**Q：我必须用 Claude 吗？**
不用。任何能读文件夹的 AI 都行（Cursor / Windsurf / Cline / ChatGPT 文件上传 / Gemini 等）。SKILL.md 是给 AI 看的纯文本规则。

**Q：AI 没按 SKILL.md 来怎么办？**
在指令里**强调一次**：「请先读 `SKILL.md`，并按里面的 Workflow A/B 输出」。大多数情况这一句就够了。

**Q：我自己改了 PTO 主仓库的 token，这个文件夹会自动同步吗？**
不会，这是一份**复制**。主仓库改动后需要把 `DESIGN.md` / `design-system-preview.html` / `tokens/*` / `css/style.css` / `swimlane/styles.css` / `patterns/` 重新复制进来。

**Q：可以把 AI 生成的新组件回流到 PTO 系统里吗？**
可以而且应该。流程是：AI 先做 preview → 你审核 → 审核通过后**先把样式塞进 `tokens/` 和 `css/style.css`**，**再**让业务模块去消费。绝对不要先在业务模块里用、回头再补到系统里。

## 反馈 / 改进

发现 AI 经常踩同一个坑，告诉我，我会把规则写进 `SKILL.md`。
