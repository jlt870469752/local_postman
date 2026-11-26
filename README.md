# LocalPostman

使用 Tauri 2 + Rust 和本地 Web UI 的桌面 API 客户端，不使用 Electron、账户或云同步。Collection 等配置通过本地 Git 仓库提交和推送。

## 开发运行

需要 Node.js、Rust 与 Tauri 的系统开发依赖。

```bash
npm install
npx tauri dev
```

只预览前端使用 `npm run dev`，地址为 http://127.0.0.1:1420/。浏览器与桌面端分别保存数据；HTTP 请求、本地服务和 Git 操作需要桌面端。验收之前使用开发模式，不生成安装包。`npm run build:web` 只检查并构建前端资源。

## 当前功能

- Collection、嵌套文件夹和请求的增删改查、复制、移动与删除撤销。
- 本地 Workspace 创建、搜索、切换、重命名与删除归档；各工作区独立保存集合、环境、历史和 Git 配置。
- 多请求标签、未保存关闭提示、环境变量、Query/Headers 行编辑与 Bulk Edit。
- cURL 和 Postman Collection v2/v2.1 JSON 导入；代码片段导出。
- Bearer/Basic/API Key 认证、Raw/JSON、表单、GraphQL、Binary 请求；响应和本地历史。
- 本地 Mock 关联 Collection、多接口独立返回、CORS、启动停止与请求日志。
- 本地集合定时执行、Webhook 触发和顺序执行服务；服务仅在客户端运行时工作。
- Git 打开工作目录、加载已有工作区、差异预览、提交/推送及仅允许快进的 Pull。仅提交 `localpostman-workspace.json`，保留仓库中的其他暂存文件。远程地址、Git 身份和凭据通过系统 Git 配置。
- 设置面板包含 General、Themes、Shortcuts、Data、Certificates、Proxy、Update、About（按要求不加入 AI）。General 中可选择 English 或简体中文，切换立即更新界面并保存到本机偏好设置；请求超时、响应大小、Cookie、重定向、证书、代理、编辑器和布局选项也从这里配置。

## 保存与恢复

macOS 桌面数据位于 `~/Library/Application Support/LocalPostman/workspace.json`。保存使用原子替换，保留上一份有效数据 `workspace.json.bak`。读取损坏数据时暂停编辑，可重试或恢复备份；恢复前保留损坏原件。Git 加载前另存 `workspace.json.before-git-load-*`，后续自动保存不会覆盖这份存档，可通过顶部 Import 导回。

连续输入延迟 300ms 合并保存，切换请求、显式保存和关闭窗口时保存最新内容。草稿和请求历史留在本机，Git 只导出已保存请求。打开仓库不会立即覆盖本地数据，需在应用内选择加载仓库工作区或使用当前工作区。加载和 Pull 前需保存或丢弃请求草稿，并停止运行中的本地服务。外部修改和仓库分叉不会自动覆盖或解决。

## 验证与边界

```bash
node --test tests/*.test.cjs tests/*.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:web
```

尚无 Postman Scripts 沙箱、OAuth、可视化 Cookie 管理、完整可视化 Flow 编辑器或 Git 冲突编辑器。证书验证、客户端证书、代理和 Cookie jar 的运行时配置已支持；TLS key log 和自动更新源因当前开发版本未配置而不可用。导入脚本仅保留为只读文本。Mock 当前按 Method + Path 精确匹配，忽略 query，不支持路径变量或多个 Example 的匹配选择。更多对照记录见 [docs/postman-parity.md](docs/postman-parity.md)。
