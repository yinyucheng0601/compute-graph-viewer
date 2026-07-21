# AGENTS.md

## 模块说明

这是 PTO 算子融合模块。本模块当前带有一份本地设计系统文件副本。

## 工作区根目录

完整项目根目录是 `/Users/yin/pto`。

## 入口

- `op-fusion/index.html`

## 运行方式

必须从 PTO 根目录启动本地服务：

```sh
cd /Users/yin/pto
python3 -m http.server 8765
```

打开 `http://127.0.0.1:8765/op-fusion/index.html`。

## 共享依赖

- 根目录 `vendor/pto-design-system/`
- 本地 `app.js` 和 `styles.css`
- 根目录 `OP-fusion.html` 可能会链接或跳转到本模块。

## 给其他 Agent 的规则

- 本模块使用根目录共享的 `../vendor/...` 路径。
- 未经浏览器验证，不要切换依赖来源。
- 保持路径在根目录服务 URL 下有效。
