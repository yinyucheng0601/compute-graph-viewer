# PTO ArkUI Dark Token Plan

## Decision

PTO 的 design system 方向固定为：

- `视觉标准 = ArkUI-style dark`
- `缺失项补全 = DevUI-style`
- `工程落地 = PTO 自己的 token system`

这意味着：

- 所有视觉判断优先参考 ArkUI / HarmonyOS 的 dark 语言
- 只有 ArkUI 没有给足的地方，才参考 DevUI 的 token 分层和组件体系
- 最终交付物不是 ArkUI 或 DevUI 的复制品，而是一套适合 PTO 的 token system

## Why This Direction

### ArkUI 适合 PTO 的原因

- C 端质感更强，视觉层级更干净
- 深色模式更自然，不像传统后台 UI 那样“灰块堆叠”
- 控件密度、留白、圆角、状态反馈更统一
- 更适合把 PTO 从“工程 demo 风格”拉到“产品化工具”层级

### DevUI 仍然需要保留的原因

- Token 分类更完整
- 组件覆盖更系统
- Theme switch 的工程化思路更成熟
- 更适合做企业工具类复杂控件的落地补全

## Core Principle

### 主规则

- 视觉决策全部按 ArkUI-style dark 定
- token 分层、命名、组件补全按 DevUI-style 学习
- 模块内不允许继续扩散新的视觉体系

### 具体解释

- 颜色、圆角、阴影、留白、控件状态、深色层级：
  - 以 ArkUI dark 为准
- semantic token、component token、theme alias、runtime theme：
  - 参考 DevUI 的组织方式
- 模块特有图形语义：
  - 保留在 view token 层

## PTO Target Architecture

PTO 的 token system 建议做四层。

### 1. Foundation Tokens

只放纯基础值，不带业务语义。

内容包括：

- neutral gray ramp
- accent palette
- status palette
- spacing scale
- radius scale
- shadow scale
- typography scale
- z-index scale
- motion duration / easing

示例：

```css
:root {
  --ark-neutral-0: #0b0d10;
  --ark-neutral-1: #0f1115;
  --ark-neutral-2: #14181f;
  --ark-neutral-3: #1a2029;
  --ark-neutral-4: #232b36;

  --ark-blue-500: #8ab4f8;
  --ark-purple-500: #9b8cff;
  --ark-green-500: #61c48b;
  --ark-orange-500: #f3a347;
  --ark-red-500: #ef6b73;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 999px;
}
```

### 2. Semantic Tokens

这一层才是 PTO 真正的主题语义层。

示例：

```css
:root[data-theme='dark'] {
  --background: var(--ark-neutral-1);
  --background-elevated: var(--ark-neutral-2);
  --surface-1: #11161c;
  --surface-2: #171d25;
  --surface-3: #1d2530;

  --foreground: rgba(255, 255, 255, 0.92);
  --foreground-secondary: rgba(255, 255, 255, 0.72);
  --foreground-muted: #8b8f97;
  --foreground-disabled: rgba(255, 255, 255, 0.38);

  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.10);
  --border-strong: rgba(255, 255, 255, 0.16);

  --primary: var(--ark-blue-500);
  --primary-hover: #9dc0fa;
  --primary-foreground: #0f1115;

  --accent: var(--ark-purple-500);
  --success: var(--ark-green-500);
  --warning: var(--ark-orange-500);
  --danger: var(--ark-red-500);

  --focus-ring: rgba(138, 180, 248, 0.42);
}
```

### 3. Component Tokens

用于统一 PTO 中反复出现的通用组件。

示例：

```css
:root {
  --toolbar-height: 44px;

  --button-height-sm: 28px;
  --button-height-md: 34px;
  --button-height-lg: 40px;
  --button-radius: var(--radius-md);

  --input-height-md: 34px;
  --input-radius: var(--radius-md);
  --panel-radius: var(--radius-lg);
  --card-radius: var(--radius-lg);

  --panel-padding: 16px;
  --panel-padding-lg: 20px;
  --table-row-height: 36px;
}
```

### 4. View Tokens

仅保留模块特有、无法抽成通用组件的语义。

示例：

```css
:root {
  --sw-stitch-0: #8f7cff;
  --sw-stitch-1: #5a92e6;
  --eo-query: #7ca8f8;
  --eo-key: #9d86ff;
  --eo-weight: #52c0a0;
}
```

规则是：

- view token 不得重复定义 global semantic token
- view token 只负责领域语义，不负责基础 neutral / text / border

## Visual Rules For PTO

### 1. Dark Surface Hierarchy

PTO 以后不再用大量“白色 alpha 叠加”来凑深色层级。

应改成更明确的 ArkUI-style 层级：

- page background
- elevated background
- card / panel background
- hover surface
- selected surface

要求：

- 层级差异清楚，但不能太亮
- 选中态不能只靠加粗边框，也要有表面变化
- 所有模块使用同一套 neutral ramp

### 2. Typography

PTO 需要统一文字等级，不再允许每个模块随意写 `9px`、`10.5px`、`7.5px`。

建议统一为：

- `display-lg`: 28px / 700
- `title-md`: 20px / 700
- `title-sm`: 16px / 700
- `body-md`: 14px / 500
- `body-sm`: 12px / 500
- `label-xs`: 11px / 600

规则：

- UI 主文本默认用 sans
- 数据值、路径、shape、magic id 再用 mono
- 不再让 monospace 主导整个产品观感

### 3. Radius

ArkUI 风格不是大面积胶囊，而是更克制的圆角矩形。

建议：

- 按钮：`8px`
- 输入框：`8px`
- 面板：`12px`
- 大卡片：`16px`
- tag / badge：允许 `999px`

规则：

- 按钮统一圆角矩形
- 只有 tag / chip 才用胶囊型

### 4. Accent Usage

PTO 当前问题是多个模块把不同颜色当主色。

以后规则：

- 全局唯一主高亮色：`primary blue`
- 紫色不再作为通用 active button primary
- 紫色、绿色、橙色只用于语义或 view-level domain meaning

### 5. Shadows And Borders

ArkUI-style dark 更依赖“轻阴影 + 精准边框”，不是重投影。

建议：

- 常规卡片：弱边框 + 极轻阴影
- overlay / popover：中等阴影
- 选中态：优先边框 + ring，不要堆重阴影

## What PTO Should Borrow From DevUI

仅借工程方法，不借视觉。

### Borrow 1: Token Categories

参考 `devui/design-token/*` 的分类，把 PTO 分成：

- color
- font
- shadow
- border-radius
- z-index
- motion

### Borrow 2: Theme Runtime

参考 `devui/theme/*` 和 `src/main.ts` 的做法：

- dark / light theme 都用同一套 key
- 当前主题切换只切 value，不改 token 名

### Borrow 3: Component Consumption

参考 DevUI 组件里按 token 消费，而不是直接写值：

- button
- card
- data-table
- form

这正好对应 PTO 最缺的公共组件层。

### Borrow 4: Theme Doc / Token Doc

PTO 也应该像 DevUI 一样，最终有一份 token 文档，而不是只藏在 CSS 里。

## File Structure Proposal

建议新建：

```text
pto/
├── tokens/
│   ├── foundation.css
│   ├── semantic.css
│   ├── components.css
│   ├── tokens.js
│   └── themes/
│       ├── dark.css
│       └── light.css
├── docs/
│   ├── design-token-spec.md
│   └── arkui-dark-guidelines.md
```

说明：

- `foundation.css`
  - 只放原始色板、spacing、radius、shadow
- `semantic.css`
  - 放语义别名
- `components.css`
  - 放按钮、输入、面板、表格等组件 token
- `themes/dark.css`
  - PTO 当前默认主题
- `themes/light.css`
  - 先预留，不急着做细节
- `tokens.js`
  - 给 JS 渲染逻辑消费

## Mapping PTO Modules Into The New System

### `css/style.css`

角色：

- 先演化为 semantic token 和 component token 的主要入口

动作：

- 先保留现有变量名，逐步 alias 到新 token
- 不直接大爆炸式替换

### `execution-overlay`

角色：

- 第一批迁移样板模块

原因：

- 这个模块已经最接近 semantic token 结构

动作：

- 把 `--eo-*` 中的 neutral / text / border 改成引用全局 semantic token
- 只保留 pipeline-specific token

### `swimlane`

角色：

- 第二批迁移

动作：

- 保留 `--sw-*` 命名
- 但所有 surface / border / text / control 都要回收至全局

### `mem_viewer`

角色：

- 第三批迁移

动作：

- 停止重定义 `--text-primary`、`--text-secondary`
- 把按钮和 badge 收到全局 component token
- 仅保留布局尺寸 token

### `source-flow` / `pass-ir`

角色：

- 中等成本收敛模块

动作：

- 把 inline style block 中的控件视觉规则迁移到全局 component token
- 保留 feature-specific layout

### `model-architecture`

角色：

- 高风险模块

动作：

- 必须引入 `tokens.js`
- 把 graph color constants 改成 semantic / view token map

### `indexer-exec`

角色：

- 高风险模块

动作：

- 先统一中性色和文本色
- 再统一按钮、卡片、表格、overlay

## JS Token Strategy

PTO 不能只做 CSS token 化。

以下区域必须用 JS token map：

- `model-architecture/app.js`
- `js/nav.js`
- `js/scan_passes.js`
- `indexer-exec/index.html` 里的 inline style objects

推荐形式：

```js
export const PTO_THEME_TOKENS = {
  dark: {
    background: '#0F0F0F',
    foreground: 'rgba(255,255,255,0.92)',
    primary: '#8AB4F8',
    accent: '#9B8CFF',
    success: '#61C48B',
    warning: '#F3A347',
    danger: '#EF6B73',
  },
};
```

然后 JS 渲染逻辑从这里拿值，不再写死。

## Non-Negotiable Rules

### Rule 1

业务模块不允许新增裸 `#hex` / `rgba(...)`，除非是在 token 文件里。

### Rule 2

模块不允许重定义全局 semantic token。

### Rule 3

全局主高亮色只有一个：`primary blue`。

### Rule 4

按钮统一圆角矩形，tag / badge 才允许胶囊。

### Rule 5

默认 UI 文本不用 monospace。

### Rule 6

JS 渲染颜色必须走 token map。

## Migration Order

1. 定义 ArkUI-style dark foundation tokens
2. 定义 semantic tokens
3. 定义 component tokens
4. 改造 `css/style.css` 为 alias layer
5. 迁移 `execution-overlay`
6. 迁移 `swimlane`
7. 迁移 `mem_viewer`
8. 迁移 `source-flow`
9. 迁移 `pass-ir`
10. 迁移 `model-architecture`
11. 迁移 `indexer-exec`
12. 最后再引入 light theme

## Immediate Next Step

下一步最合理的是直接产出 `dark token v1`。

建议执行内容：

1. 新建 `tokens/foundation.css`
2. 新建 `tokens/semantic.css`
3. 新建 `tokens/components.css`
4. 新建 `tokens/themes/dark.css`
5. 新建 `tokens/tokens.js`
6. 让 `css/style.css` 先变成 alias 层

这是把 ArkUI-style dark 真正落到 PTO 的第一步。
