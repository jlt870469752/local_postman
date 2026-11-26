# Postman 本地客户端对照记录

2026-11-06。原版通过 /Applications/Postman.app 的运行界面检查，界面报告 desktopVersion=12.35.5。此前 REA 提取包版本 12.35.4，两种证据分开记录。没有构建安装包。

## 本轮已修改，有测试覆盖

- 侧栏顶部横排工具，集合筛选/展开，底部折叠分区。
- Body 六种类型横排，raw 五种格式、内容保留、行号；GraphQL query/variables、binary 字节发送。
- 从 REA 已提取的 iconSprites SVG 中复用实际图标，来源见 assets 文档。
- Save 移到标题行；请求名、描述可保存。
- 参数、Headers、表单改用行列表，保留重复键、启用状态和描述；参数 Bulk Edit；URL 与参数表联动。
- 认证 No Auth/Bearer/Basic/API Key；环境选择与编辑分开；环境当前值优先替换。
- 响应 Pretty/Raw/Headers，响应字节数、导出文件；各请求 Tab 保留响应。
- 请求超时、重定向、证书验证配置传入 reqwest。
- Git 指定仓库并仅提交 localpostman-workspace.json；不再 git add 整个程序目录。尚未针对用户仓库进行实际提交/推送。

## 尚未完成，不能声称与 Postman 一致（2026-11-26 更新）

- 当前原生 Tauri 窗口的完整端到端交互仍未全部验证；浏览器预览不能证明原生 IPC。
- 集合/文件夹详情和环境编辑仍使用轻量弹窗，完整原版详情 Tab 尚未还原。
- 参数补全为 datalist；光标位置匹配、变量悬浮解析、完整快捷键与编辑器语法高亮仍未齐。
- Scripts 无 Postman sandbox 执行器；导入脚本仅作为只读文本保留。
- 可视化 Cookies 管理、OAuth、Digest，响应搜索/预览、请求取消等。证书验证、客户端证书、代理和 Cookie jar 的运行时配置已接入设置；TLS key log 在当前原生 TLS 引擎中不可用。
- Postman Collection/Environment 标准 JSON 导出未齐；已有 cURL/Collection JSON 导入、代码片段与本地工作区导出。
- Git 仅处理快进拉取，分叉、冲突需用外部 Git 工具解决；远程与认证由系统 Git 配置。
- 本地 Deployed Flows 为集合顺序执行，不包含可视化流程画布；服务不包含云托管。
- 样式、原版所有焦点/悬停与尺寸细节不能声称逐像素一致。

## 验证边界

jsdom 测试验证本地 UI 状态和 IPC 参数，不等于原生端到端通过。Rust TCP 回环测试验证实际 HTTP 编码。未向用户业务接口发送测试请求，未推送用户 Git 仓库。

## 2026-11-24 集合与创建入口修正

- 对照 Postman 12.37.4 集合右键菜单，添加本地集合、嵌套文件夹、请求的新增、重命名、描述编辑、复制、移动和删除（可撤销最近一次）。
- 删除活动/最后请求清理标签并显示空工作区；嵌套过滤保留祖先路径；导入工作区重新映射文件夹引用。
- Collections 标题行移除重复 Import，上方导入保留。Save 默认目的地和取消名称编辑已修复。
- Mock 列表有数据时保留可见 Create，创建继续打开工作区标签。Web 预览用浏览器本地保存；原生端继续读写本地工作区文件。两者独立保存。
- tests/collections.test.cjs 9 组 DOM 流程、Mock 标签回归、原有请求工作流、运行环境适配测试及 build:web 通过；未生成安装包。

## 2026-11-24 Services 分组与 JSON 导入

- 原版运行界面（12.37.4）确认 Monitors/Webhooks/Deployed Flows 为可展开分组，包含独立空态与 Create。Monitor 创建页为工作区标签，含集合、计划、Runner、环境、Run now、重试、超时、延迟、重定向、SSL 选项。
- 原版 Webhooks Create 在当前账户显示付费升级提示，未越过；其付费表单、完整 Deployed Flows 编辑器未核实，不能称为精确复刻。
- 本地三个分组已支持展开/创建/重开工作区标签/保存配置。Monitor 支持手动或客户端运行期间的间隔、每日计划；Webhook 支持 127.0.0.1 POST 触发集合执行、真实监听端口、停止与运行记录。Deployed Flows 当前提供集合顺序执行和本地触发端点，不包含原版可视化流程画布。
- 本地服务不运行 Postman Scripts 沙箱，不含云区域、邮件通知、云部署或跨设备守护调度。测试仅向回环测试服务器发送请求。
- REA 静态检查 `/Applications/Postman.app/Contents/Resources/app.asar` 的 `main-webhooks-tunnel-forwarding-d7e13a16087d15ec.min.js`，artifact SHA256 `906073586dd8cee6697c114cbe113d5545e584046d6e94328b3b318af223a3eb`，parent Evidence `ev_65ccc2895a99acedd1a32dd5c436c65b7e9a449db5c40b504aac7dbe4c489993`。仅此一个源码文件被分析，覆盖为 partial，不证明完整 Webhook 产品功能。
- Collection JSON v2/v2.1 支持粘贴和文件选择（含 BOM、collection 包装），新 ID 与嵌套引用、URL 对象/重复及禁用 query、Headers、各 Body 模式、认证继承、集合变量与 examples；脚本仅保留文本，不执行。文件路径仅保留元数据，不读取。
- tests/import-ui.test.cjs、tests/import-collection.test.mjs、tests/services.test.cjs、既有 CRUD/Mock/工作流测试、7 项 Rust 测试和 build:web 通过。浏览器观察已确认 Monitor Create 标签和 JSON 导入入口，完整原生交互尚需验收。


## 2026-11-25 未保存请求关闭与 Services 收起

- HTTP 请求标签有未保存圆点；新请求和已有请求修改关闭时提示 Save changes，提供 Don't save、Cancel、Save changes，支持 Escape 和模态焦点限制。
- Save changes 接入原 Collection/文件夹保存选择器，可改名和新建目的地；使用明确请求 ID，关闭后台标签不会保存错请求。等待本地写入成功后才关闭，失败保留名称、目的地与重试入口。
- Don't save 删除新草稿或恢复已有请求的保存快照；编辑草稿、保存基线与请求标签随本地工作区恢复。自动丢弃偏好可在 Layout options 中关闭。
- 规范化默认设置与参数列表，原样浏览 Body/Headers/Auth 等不误判修改；修复 URL/参数表编辑互相覆盖，保留导入的 body field 元数据和保存前请求顺序。
- Mock Servers 与 Monitors/Webhooks/Deployed Flows 都可独立展开收起，全部收起时四行连续位于侧栏顶部。创建仍为工作区标签。
- 原生工作区写入按顺序执行；Git 导出使用已保存请求快照，排除新草稿和本地编辑器元数据。未执行用户仓库提交或推送。
- Web 预览实际检查了分组布局和保存后关闭；原生开发进程保持运行。通过应用名访问时系统打开已有旧打包版本，本轮已退出该旧实例；尚未完成当前原生开发窗口完整端到端检查。
- 新增未保存关闭 DOM 流程、Git 导出与保存队列测试；完整前端测试、Rust 测试与 build:web 通过。检查中修复 macOS 监听 socket 非阻塞继承导致本地 Mock/Webhook 偶发读取失败。未生成安装包。


## 2026-11-26 Mock 多接口与 Collection 关联

- Mock 详情改为接口列表和响应编辑区域，保存 `collectionId`、每条接口的 `sourceRequestId`。从 Collection 创建或补充请求路由，使用首个 Example 的状态码、响应头和返回体；空响应体保留为空。
- 每条接口可独立编辑 Method、Path、状态码、Headers、Body、延迟；新增、删除、切换、重开和重启后保留。重复 Method/Path 仅保留一条，重复导入不覆盖已配置的响应。关联其他 Collection 会补充新接口，保留原有路由。
- 运行时按 Method + Path 匹配，忽略 query，明确方法优先于 `*`。不包含原版多 Example 选择规则、动态业务逻辑或状态化会话；路径变量不做模式匹配。
- 保存本地工作区成功后启动，运行期间停止后才能编辑。启动/停止/刷新有等待状态，切换标签后异步完成不会重绘当前请求；重载读取原生运行状态。
- 创建页移除未实现的公网域名、public access、sessions、auto deploy 选项，改为真实本地端口（0 自动选择）；Collections 侧栏移除空占位分组，仅有环境时显示 Environments。历史页不再显示底部分组。
- 浏览器实际验证了关联 Collection、多个接口独立状态码和返回体、切换保存；原生回环测试覆盖 GET/POST 同路径不同返回、响应头、空返回、404、通配优先级、重复路由拒绝、停止后同端口重启。完整原生窗口 UI 端到端未核实。
- 验证：11 组前端测试、9 项 Rust 测试、build:web 与 diff 检查通过。未生成安装包、未推送 Git。

## 2026-11-26 数据安全与完整性修复

- 工作区原子保存、上一有效版本备份、损坏数据防覆盖与恢复入口；原生关闭窗口等待保存，失败保留窗口与编辑内容。
- 请求响应、文件读取按来源请求隔离；历史保留发送快照；实际发送、代码片段和集合执行统一参数、认证与 Body 序列化。GET/HEAD 忽略 Body；Bulk Edit 保留描述与导入元数据。
- Git 新增仓库工作区读取和选择、差异预览、提交/推送及快进 Pull；版本校验防止覆盖外部修改，仅提交工作区文件，失败保留已提交结果供重试。
- Mock 增加重命名、删除和 CORS/OPTIONS；运行中的 Service 配置锁定，防止配置和实际运行不一致；异步删除不再关闭其他活动标签。
- 删除未接通的搜索、Console、更多入口和空响应下拉；Scripts 只在有导入脚本时显示，明确只读与不执行。
- 输入查询范围限于当前编辑器、300ms合并保存。JSDOM 同机1000条请求下10次连续输入的事件处理中位数从约97ms降至约0.65ms（不是原生渲染帧率）；即时写入为0次，停止输入后1次。
- 测试仅使用临时仓库与本地回环服务，未向业务API发请求或推送用户仓库；未生成安装包。

## 2026-11-26 Workspace 入口补齐

- 对照原版 12.38.3 的 Workspace 下拉入口，提供搜索、列表与创建。本地版新增工作区创建、切换、重命名和删除归档，不引入账户与团队。
- 原有 workspace.json 无损作为默认 My Workspace；新建为空工作区，各自独立保存集合、环境、历史、草稿、标签和 Git 配置。切换前保存当前内容，失败保留当前界面；进行中的请求与服务需结束后切换。
- 浏览器实测创建空工作区、切回后恢复原集合/环境/草稿，以及删除临时工作区；Rust 临时目录测试覆盖独立文件、旧数据迁移、损坏目的地拒绝切换、删除归档与过期写入拒绝。
- 当前开发窗口标记 Development；旧的本地安装版已退出并移到废纸篓，仅运行 Tauri dev，未生成安装包。

- 最终验证：17 个前端测试文件（测试运行器报告23项）通过；Rust 27项通过；build:web与git diff --check通过。Mock/Webhook监听器启用地址复用，回归验证同端口多次重启且拒绝同时监听；未用重复sleep掩盖失败。

## 2026-11-26 设置与语言

- 设置面板按原版保留 General、Themes、Shortcuts、Data、Certificates、Proxy、Update、About，按本地版范围不加入 AI。
- General → Application → Language 支持 English 与简体中文。切换立即翻译菜单、设置、操作和状态提示，集合、文件夹、请求名称、环境名称、URL、请求参数、请求体、响应和 Git 路径等用户数据保持原文。
- 语言、主题、快捷键、编辑器和请求运行选项保存到桌面偏好文件或浏览器本地存储；保存失败会回滚预览并保留重试入口。浏览器和桌面端数据相互独立。

- 按要求移除没有实际集合运行集成的 Add-ons/扩展页面，同时移除 Postman CLI 安装版本检测。
- 编辑器字体使用下拉选择：系统默认、Menlo、Monaco、Courier New。请求体、高亮层、行号和响应共用字体配置，选择即时生效并保存；保存失败回滚效果并保留选择供重试。
- 桌面端设置 → 数据 → 导出数据打开系统保存对话框，可选择目录与文件名；取消不写文件，也不报告导出成功。
- 设置中的导入复用现有 cURL/Collection/Environment/工作区 JSON 导入窗口，设置面板保留。完成或取消后恢复数据页和焦点；Tab 与 Escape 优先作用于导入窗口。
