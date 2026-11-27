// UI strings are translated locally. Request data and editable values are never translated.
const zh = {
  'Language': '语言', 'Application language': '界面语言',
  'Choose the language used throughout the application.': '选择应用界面使用的语言。',
  'Choose the language for the application interface.': '选择应用界面使用的语言。',
  'Choose the language used for menus, settings and messages.': '选择菜单、设置和提示使用的语言。',
  'General': '常规', 'Themes': '主题', 'Shortcuts': '快捷键', 'Data': '数据',
  'Certificates': '证书', 'Proxy': '代理', 'Update': '更新', 'Updates': '更新', 'About': '关于',
  'Settings': '设置', 'Settings categories': '设置分类', 'Close settings': '关闭设置', 'Open settings': '打开设置',
  'Request': '请求', 'HTTP version': 'HTTP 版本', 'Auto': '自动',
  'Select the HTTP version to use for sending the request.': '选择发送请求时使用的 HTTP 版本。',
  'Request timeout': '请求超时', 'Request timeout (ms)': '请求超时（毫秒）',
  'Set how long a request should wait for a response before timing out. To never time out, set to 0.': '设置请求等待响应的最长时间。设为 0 表示不限制。',
  'Max response size': '最大响应大小',
  'Set the maximum size of a response to download. To download a response of any size, set to 0.': '设置可下载响应的最大大小。设为 0 表示不限制。',
  'SSL certificate verification': 'SSL 证书验证', 'Enable SSL certificate verification': '启用 SSL 证书验证',
  'SSL/TLS key log': 'SSL/TLS 密钥日志', 'Unavailable with the native TLS engine used by this build.': '当前版本使用的原生 TLS 引擎暂不支持此功能。',
  'Key log file': '密钥日志文件', 'TLS key log file': 'TLS 密钥日志文件', 'Choose the local file for the session key log.': '选择保存会话密钥日志的本地文件。',
  'Disable cookies': '禁用 Cookie', 'Disable the cookie jar for all requests.': '对所有请求禁用 Cookie 存储。',
  'Response format detection': '响应格式检测', 'Working directory': '工作目录',
  'Choose the directory for files used in requests. File access is limited to this directory unless you allow access outside it.': '选择请求使用文件的目录。通过工作目录选择文件时，仅允许访问此目录，除非开启外部访问。',
  'Choose the directory used by the working-directory file picker. The explicit Select file picker can still open files you choose.': '选择工作目录文件选择器使用的目录。手动“选择文件”仍可打开你明确选择的文件。',
  'Location': '位置', 'Read files outside working directory': '读取工作目录之外的文件',
  'Allow explicitly selected request files outside the working directory.': '允许通过工作目录文件选择器读取此目录之外的请求文件。',
  'Headers': '请求头', 'Send no-cache header': '发送 no-cache 请求头',
  'Send Cache-Control: no-cache with requests unless a header is already set.': '发送 Cache-Control: no-cache；若已设置该请求头则使用现有值。',
  'Send Postman Token header': '发送 Postman Token 请求头', 'Add a unique Postman-Token header to each request.': '为每次请求添加唯一的 Postman-Token 请求头。',
  'Request behavior': '请求行为', 'Automatically follow redirects': '自动跟随重定向',
  'Follow original HTTP method': '保留原始 HTTP 方法', 'Keep the original request method when following a redirect.': '跟随重定向时保留原始请求方法。',
  'Follow Authorization header': '转发 Authorization 请求头', 'Forward the Authorization header when a redirect changes the host.': '重定向到其他主机时转发 Authorization 请求头。',
  'Maximum number of redirects': '最大重定向次数', 'Request validation': '请求验证',
  'Validate the HTTP method and request URL before sending.': '发送前验证 HTTP 方法和请求 URL。',
  'Trim keys and values': '去除键和值首尾的空白', 'Remove leading and trailing whitespace from query parameters and headers when sending.': '发送时去除查询参数和请求头键值首尾的空白。',
  'User interface': '用户界面', 'Application': '应用',
  'Always ask when closing unsaved tabs': '关闭未保存标签页时始终询问', 'Ask whether to save changes before closing a request tab.': '关闭请求标签页前询问是否保存更改。',
  'Show icons with tab names': '在标签名称旁显示图标', 'Two-pane view': '双栏视图', 'Place the request and response side by side.': '并排显示请求和响应。',
  'Swap left and right sidebars': '交换左右侧栏', 'Variable autocomplete': '变量自动补全', 'Show available variables while editing requests.': '编辑请求时显示可用变量。',
  'Editor settings': '编辑器设置', 'System default': '系统默认', 'Font family': '字体', 'Font size': '字号', 'Tab size': '制表符宽度', 'Indentation': '缩进', 'Spaces': '空格', 'Tabs': '制表符',
  'Automatically close brackets': '自动补全括号', 'Automatically close quotes': '自动补全引号', 'Line wrapping': '自动换行', 'Format JSON on paste': '粘贴时格式化 JSON',
  'Choose how LocalPostman looks on this device.': '选择此设备上 LocalPostman 的外观。',
  'Light': '浅色', 'Dark': '深色', 'System': '跟随系统', 'Accent color': '强调色', 'Orange': '橙色', 'Blue': '蓝色', 'Purple': '紫色', 'Green': '绿色',
  'orange': '橙色', 'blue': '蓝色', 'purple': '紫色', 'green': '绿色',
  'Keyboard shortcuts': '键盘快捷键', 'Enable application keyboard shortcuts. Editing keys inside text fields stay available.': '启用应用快捷键。文本框内的编辑快捷键始终可用。',
  'Send request': '发送请求', 'Save request': '保存请求', 'Create new request': '新建请求', 'Close current tab': '关闭当前标签页',
  'Switch to next tab': '切换到下一个标签页', 'Switch to previous tab': '切换到上一个标签页', 'Switch to tab at position': '切换到指定位置的标签页', 'Switch to last tab': '切换到最后一个标签页',
  'Toggle left sidebar': '切换左侧栏', 'Two-pane response view': '响应双栏视图', 'Swap sidebar side': '切换侧栏位置', 'Reset layout': '重置布局', 'Beautify JSON body': '格式化 JSON 请求体',
  'Import and export': '导入与导出', 'Export data': '导出数据', 'Export Data': '导出数据', 'Import data': '导入数据', 'Import Data': '导入数据',
  'Save the current local workspace to a JSON file, including Collections and environments.': '将当前本地工作区（含集合和环境）保存为 JSON 文件。',
  'Import cURL, a Postman Collection or environment, or a local workspace JSON file.': '导入 cURL、Postman 集合、环境或本地工作区 JSON 文件。',
  'Import cURL, a Postman or Hoppscotch Collection, an environment, or a local workspace JSON file.': '导入 cURL、Postman 或 Hoppscotch 集合、环境或本地工作区 JSON 文件。',
  'Local data': '本地数据', 'Clear request history': '清除请求历史', 'Clear history in the current workspace.': '清除当前工作区的请求历史。',
  'Reset workspace': '重置工作区', 'Reset the current workspace after creating a local recovery copy.': '创建本地恢复副本后重置当前工作区。',
  'Clear request history?': '清除请求历史？', 'Reset current workspace?': '重置当前工作区？',
  'Remove the request history in the current workspace. Collections and environments are kept.': '删除当前工作区的请求历史，保留集合和环境。',
  'Remove Collections, environments, request tabs and service configurations from the current workspace. Export a backup before continuing.': '删除当前工作区的集合、环境、请求标签页和服务配置。继续前请先导出备份。',
  'Status': '状态', 'Installed': '已安装', 'Not detected': '未检测到', 'Checking…': '正在检查…', 'Version': '版本', 'Refresh status': '刷新状态',
  'CA certificates': 'CA 证书', 'Use custom CA certificates': '使用自定义 CA 证书',
  'Trust an additional PEM or CRT certificate bundle when verifying HTTPS responses.': '验证 HTTPS 响应时额外信任指定的 PEM 或 CRT 证书包。',
  'Attach a client certificate only to requests matching its host and port.': '仅向与证书主机和端口匹配的请求附加客户端证书。',
  'CA certificate file': 'CA 证书文件', 'Client certificates': '客户端证书', 'Add Certificate': '添加证书', 'Add certificate': '添加证书',
  'New certificate': '新证书', 'Host': '主机', 'Port': '端口', 'CRT or PFX/P12 file': 'CRT 或 PFX/P12 文件',
  'PEM/CRT requires an unencrypted PKCS#8 key. PFX/P12 uses its passphrase.': 'PEM/CRT 需要未加密的 PKCS#8 密钥。PFX/P12 使用其口令。',
  'KEY file': 'KEY 密钥文件', 'Passphrase': '口令', 'Optional': '可选', 'No client certificates configured': '尚未配置客户端证书',
  'Proxy configuration': '代理配置', 'Use system proxy': '使用系统代理', 'Use the proxy configuration available to the desktop HTTP runtime.': '使用桌面 HTTP 运行环境提供的代理配置。',
  'Use custom proxy configuration': '使用自定义代理配置', 'Route HTTP requests through the proxy below.': '通过以下代理发送 HTTP 请求。',
  'Proxy type': '代理类型', 'Proxy server': '代理服务器', 'Username': '用户名', 'Password': '密码', 'Proxy bypass': '不使用代理的地址',
  'Comma-separated hosts or domains that should connect directly, such as localhost, 127.0.0.1, .example.com.': '直接连接的主机或域名，以逗号分隔，例如 localhost、127.0.0.1、.example.com。',
  'Automatically check for updates': '自动检查更新', 'A signed release feed has not been configured for this development build.': '此开发版本尚未配置已签名的更新源。',
  'Updates are checked against the release source configured for this client.': '从为此客户端配置的发布源检查更新。',
  'Check for Updates': '检查更新', 'No signed update feed is configured.': '尚未配置已签名的更新源。',
  'A local API client built with Tauri and Rust.': '使用 Tauri 和 Rust 构建的本地 API 客户端。',
  'Platform': '平台', 'Preferences': '偏好设置', 'Open data folder': '打开数据目录',
  'Collections and preferences stay on your computer. Workspace sharing uses your Git repository.': '集合和偏好设置保存在本机，工作区通过你的 Git 仓库共享。',
  'Saving…': '正在保存…', 'Unsaved changes': '未保存的更改', 'All changes saved': '所有更改已保存',
  'Loading settings…': '正在加载设置…', 'Settings have not loaded': '设置尚未加载', 'Settings require an invoke function': '设置缺少调用接口',
  'Workspace exported.': '工作区已导出。', 'History cleared.': '历史记录已清除。', 'Workspace reset.': '工作区已重置。', 'Opened data folder.': '已打开数据目录。',
  'Choose': '选择', 'Clear': '清除', 'Remove': '移除', 'Not selected': '未选择', 'Retry': '重试', 'Cancel': '取消', 'Close': '关闭',
  'Save': '保存', 'Save all': '全部保存', 'Save changes': '保存更改', 'Save changes?': '保存更改？', "Don't save": '不保存',
  'Create': '创建', 'Edit': '编辑', 'Rename': '重命名', 'Duplicate': '创建副本', 'Delete': '删除', 'Move': '移动', 'Move to': '移动到',
  'Name': '名称', 'Description': '描述', 'Copy': '复制', 'Copied': '已复制', 'Import': '导入', 'Import…': '导入…', 'Export': '导出',
  'Collections': '集合', 'COLLECTIONS': '集合', '⌄ COLLECTIONS': '⌄ 集合', 'Collection': '集合', 'Services': '服务', 'History': '历史', 'HISTORY': '历史',
  'Environments': '环境', 'ENVIRONMENTS': '环境', 'Environment': '环境', 'No Environment': '未选择环境', 'Manage environments': '管理环境',
  'Active environment': '当前环境', 'Filter items': '筛选项目', 'More panel actions': '更多面板操作', 'Import collection or environment': '导入集合或环境',
  'New request': '新建请求', '＋ New request': '＋ 新建请求', 'Add request': '添加请求', 'New collection': '新建集合', 'New Collection': '新建集合',
  'New folder': '新建文件夹', 'New Folder': '新建文件夹', 'Add folder': '添加文件夹', 'Collection actions': '集合操作', 'View more actions': '更多操作',
  'Request name': '请求名称', 'Click to rename request': '点击修改请求名称', 'Open requests': '打开的请求', 'Enter URL or paste text': '输入 URL 或粘贴文本',
  'Sending…': '正在发送…', 'Send': '发送', 'Code': '代码', 'Code snippet': '代码片段', 'Code snippet language': '代码片段语言', 'Copy snippet': '复制代码片段',
  'Close code snippet': '关闭代码片段', 'Docs': '文档', 'Params': '参数', 'Authorization': '授权', 'Body': '请求体', 'Scripts': '脚本', 'Response': '响应',
  'Save Response': '保存响应', 'Send a request to get started': '发送请求以开始', 'The response will appear here.': '响应将显示在这里。',
  'Open a request to get started': '打开请求以开始', 'Select a request from Collections or create a new one.': '从集合中选择一个请求，或新建请求。',
  'No results found': '未找到结果', 'No collections yet': '暂无集合', 'No requests in history': '暂无请求历史',
  'No matching items': '没有匹配项目', 'No items in this panel': '此面板暂无项目',
  'Query Params': '查询参数', 'Query parameters': '查询参数', 'Body fields': '请求体字段', 'Key-Value Edit': '键值编辑', 'Bulk Edit': '批量编辑',
  'KEY': '键', 'VALUE': '值', 'DESCRIPTION': '描述', 'key': '键', 'value': '值', 'description': '描述',
  '＋ Add header': '＋ 添加请求头', '＋ Add parameter': '＋ 添加参数', '＋ Add field': '＋ 添加字段',
  'Add a description for this request': '为此请求添加描述', 'Body type': '请求体类型', 'Raw body format': '原始请求体格式',
  'Beautify': '格式化', 'This request does not have a body': '此请求没有请求体', 'Request body': '请求体',
  'QUERY': '查询', 'GRAPHQL VARIABLES': 'GraphQL 变量', 'Select file': '选择文件', 'No file selected': '未选择文件', 'Choose from working directory…': '从工作目录选择…',
  'Auth type': '授权类型', 'No Auth': '无授权', 'Bearer Token': 'Bearer 令牌', 'Basic Auth': '基本认证', 'API Key': 'API 密钥',
  'Add to': '添加到', 'Header': '请求头', 'token': '令牌', 'username': '用户名', 'password': '密码',
  'This request does not use any authorization.': '此请求不使用授权。',
  'Imported scripts are preserved as text. Script execution is not available.': '已导入脚本保留为文本，暂不支持执行。', 'Preserved scripts': '保留的脚本',
  'VARIABLE': '变量', 'INITIAL VALUE': '初始值', 'CURRENT VALUE': '当前值', 'variable': '变量', 'current value': '当前值',
  'New environment': '新建环境', '＋ New environment': '＋ 新建环境', 'Untitled environment': '未命名环境', 'Add variable': '添加变量', 'Remove variable': '移除变量',
  'Delete this environment?': '删除此环境？', 'Close environments': '关闭环境',
  'Save to': '保存到', 'SAVE REQUEST': '保存请求', 'Select a collection': '选择集合', 'Select collection': '选择集合', 'Search for collection or folder': '搜索集合或文件夹',
  'No collections or folders': '暂无集合或文件夹', 'Always discard unsaved changes when closing a tab': '关闭标签页时始终丢弃未保存的更改',
  'Closing a tab will discard its changes without asking. Turn this off in Layout options.': '关闭标签页时将直接丢弃更改。可在布局选项中关闭。',
  'has unsaved changes. Save these changes to avoid losing your work.': '有未保存的更改。请保存以免丢失。',
  'Always discard unsaved changes': '始终丢弃未保存的更改', 'Layout': '布局', 'Layout options': '布局选项', 'Left sidebar': '左侧栏',
  'Swap left and right sidebar': '交换左右侧栏', 'Resize sidebar': '调整侧栏宽度', 'Resize request and response': '调整请求和响应区域', 'Toggle sidebar': '切换侧栏',
  'Text': '文本', 'JavaScript': 'JavaScript', 'HTML': 'HTML', 'XML': 'XML',
  'none': '无', 'raw': '原始', 'binary': '二进制',
  'Pretty': '格式化', 'Raw': '原始', 'Preview': '预览', 'Visualize': '可视化', 'Body / Headers': '响应体 / 响应头',
  'Paste cURL or Postman Collection JSON (v2 / v2.1), or choose a .json file. Environments and workspace JSON are also supported.': '粘贴 cURL 或 Postman 集合 JSON（v2 / v2.1），也可选择 .json 文件。同时支持环境和工作区 JSON。',
  'Paste cURL, Postman Collection JSON (v2 / v2.1), or Hoppscotch Collection JSON, or choose a .json file. Environments and workspace JSON are also supported.': '粘贴 cURL、Postman 集合 JSON（v2 / v2.1）或 Hoppscotch 集合 JSON，也可选择 .json 文件。同时支持环境和工作区 JSON。',
  'Import text': '导入文本', 'Choose JSON file': '选择 JSON 文件', 'Close import': '关闭导入', 'Imported locally': '已导入本机',
  'Workspaces': '工作区', 'Local workspace': '本地工作区', 'Create workspace': '创建工作区', 'Create Workspace': '创建工作区',
  'Rename workspace': '重命名工作区', 'Delete workspace': '删除工作区', 'Workspace name': '工作区名称', 'Search workspaces': '搜索工作区', 'Search workspaces…': '搜索工作区…',
  'No workspaces found': '未找到工作区', 'Deleted': '已删除', 'Undo': '撤销', 'You can undo the most recent deletion while the app is open.': '应用打开期间可撤销最近一次删除。',
  'Could not open your workspace': '无法打开工作区', 'Your existing data has been kept. Editing is paused to prevent overwriting it.': '已保留现有数据。为避免覆盖，暂时停用编辑。',
  'Restore last good backup': '恢复最近的有效备份',
  'Invalid workspace list': '工作区列表无效',
  'Wait for requests and stop running local services before switching workspaces.': '切换工作区前，请等待请求完成并停止正在运行的本地服务。',
  'Finish or cancel the open dialog before switching workspaces.': '切换工作区前，请完成或取消已打开的对话框。',
  'Repository changed. Review its latest workspace before continuing.': '仓库已更改，请先检查最新工作区再继续。',
  'Repository has no workspace file.': '仓库没有工作区文件。',
  'Save or discard unsaved requests before loading a repository workspace.': '加载仓库工作区前，请保存或丢弃未保存的请求。',
  'Wait for requests and stop running local services before replacing the workspace.': '替换工作区前，请等待请求完成并停止正在运行的本地服务。',
  'Repository changed outside the app. Reopen the folder to review the current workspace.': '仓库已在应用外修改，请重新打开目录检查当前工作区。',
  'Reopen the Git folder to review and connect its workspace before committing.': '提交前，请重新打开 Git 目录，检查并连接其工作区。',
  'Workspace changed after this preview. Cancel and review changes again before committing.': '预览后工作区已更改，请取消并重新检查后再提交。',
  'Save or discard unsaved requests before pulling a repository workspace.': '拉取仓库工作区前，请保存或丢弃未保存的请求。',
  'Wait for requests and stop local services before pulling.': '拉取前，请等待请求完成并停止本地服务。',
  'MOCK SERVERS': 'Mock 服务器', 'Mock servers': 'Mock 服务器', 'Mock server': 'Mock 服务器', 'Mock server name': 'Mock 服务器名称',
  'No matching mock servers': '没有匹配的 Mock 服务器', 'Deploy mock server': '部署 Mock 服务器',
  'Create a mock server from an existing mock or collection.': '从现有 Mock 或集合创建 Mock 服务器。',
  'Existing mock': '现有 Mock', 'Existing collection': '现有集合', 'Select mock': '选择 Mock', 'Select one or more mocks': '选择 Mock', 'Deploy': '部署',
  'The server runs at http://127.0.0.1 on this computer. Use 0 to choose an available port when starting.': '服务器在本机 http://127.0.0.1 运行。端口设为 0 将在启动时自动选择可用端口。',
  'Start': '启动', 'Stop': '停止', 'Working…': '正在处理…', 'Logs': '日志', 'Mock collection': 'Mock 集合', 'No collection': '未选择集合',
  'Add collection requests': '添加集合请求', 'Running at': '运行地址', 'Stop the server to edit routes.': '停止服务器后可编辑路由。', 'Stop the server to edit routes': '停止服务器后可编辑路由',
  'Routes': '路由', 'Mock routes': 'Mock 路由', 'Add route': '添加路由', 'Delete route': '删除路由', 'Route response': '路由响应',
  'No routes yet. Add a route or select a collection.': '暂无路由，请添加路由或选择集合。',
  'Select a Collection to import its requests, or add your first route.': '选择集合以导入其请求，或添加第一个路由。',
  'Method': '方法', 'Path': '路径', 'Delay (ms)': '延迟（毫秒）', 'Response headers': '响应头', 'Response body': '响应体', 'Close mock server': '关闭 Mock 服务器',
  'MONITORS': '监控', 'Monitors': '监控', 'Monitor': '监控', 'WEBHOOKS': 'Webhook', 'Webhooks': 'Webhook', 'Webhook': 'Webhook',
  'DEPLOYED FLOWS': '已部署工作流', 'Deployed Flows': '已部署工作流', 'Deployed flow': '已部署工作流',
  'Run now': '立即运行', 'Start schedule': '启动定时任务', 'Stop the service to change its configuration.': '停止服务后可修改配置。',
  'What to monitor?': '要监控哪个集合？', 'Collection to run when the webhook is called': '调用 Webhook 时运行的集合', 'Collection workflow to deploy': '要部署的集合工作流',
  'How to run the monitor?': '如何运行监控？', 'On schedule — interval': '定时运行 — 按间隔', 'On schedule — every day': '定时运行 — 每天',
  'Run manually': '手动运行', 'Every (minutes)': '间隔（分钟）', 'Time': '时间', 'Runner': '运行器', 'Local desktop': '本地桌面',
  'Runs on this computer. The endpoint is available while the desktop app is running.': '在本机运行，桌面应用运行期间可访问此端点。',
  'Retry if run fails': '运行失败时重试', 'Delay before requests (ms)': '请求前延迟（毫秒）', 'Follow redirects': '跟随重定向', 'Enable SSL validation': '启用 SSL 验证',
  'Run history': '运行历史', 'Refresh': '刷新', 'Passed': '通过', 'Failed': '失败', 'No runs yet': '暂无运行记录',
  'Work with Git': '使用 Git 协作', 'Open a local Git working directory to share saved Collections, environments and service configurations.': '打开本地 Git 工作目录，共享已保存的集合、环境和服务配置。',
  'Git operations require the desktop client.': 'Git 操作需要使用桌面客户端。',
  'Git repository': 'Git 仓库', 'Push changes': '推送更改', 'View changes': '查看更改', 'Pull': '拉取', 'Change Folder': '更换目录', 'Open Folder': '打开目录',
  'Commit message': '提交说明', 'Commit…': '提交…', 'Commit': '提交', 'Commit & Push…': '提交并推送…', 'Commit & Push': '提交并推送',
  'Open Git workspace': '打开 Git 工作区', 'Review Git changes': '检查 Git 更改', 'Load repository workspace': '加载仓库工作区', 'Use current workspace': '使用当前工作区',
  'Only saved workspace content is committed. Drafts and request history stay local.': '仅提交已保存的工作区内容，草稿和请求历史保留在本机。',
  'Repository workspace changed outside the app. Reopen the folder and review it before committing.': '仓库工作区已在应用外修改。提交前请重新打开目录并检查。',
  'No localpostman-workspace.json exists yet. Use your current workspace to create it with your first commit.': '尚无 localpostman-workspace.json，首次提交时将使用当前工作区创建。',
  'Working directory is clean': '工作目录无更改', 'No workspace changes': '工作区无更改', 'Git: checking…': 'Git：正在检查…', 'Git: clean': 'Git：无更改', 'Git: not configured': 'Git：尚未配置',
  'Name is required': '请填写名称', 'Select a collection': '请选择集合', 'Select a valid folder': '请选择有效文件夹',
  'A folder cannot be moved inside itself': '不能将文件夹移动到自身内部', 'Collection no longer exists': '集合已不存在', 'Item no longer exists': '项目已不存在',
  'Restore the collection first': '请先恢复集合',
  'Request saved': '请求已保存', 'Enter an environment name.': '请填写环境名称。',
  'The selected collection has no requests': '所选集合中没有请求', 'A local run supports up to 200 requests': '本地运行最多支持 200 个请求',
  'Use a valid interval and time': '请设置有效的间隔和时间', 'Use a /path and a valid local port': '请输入 /path 格式的路径和有效的本地端口',
  'Use a timeout from 1 to 30000 ms and a delay from 0 to 60000 ms': '超时应为 1–30000 毫秒，延迟应为 0–60000 毫秒',
  'Use a port from 0 to 65535': '端口应为 0–65535', 'Use an absolute /path without query parameters': '请输入不含查询参数的绝对 /path 路径',
  'Use an HTTP status from 100 to 599': 'HTTP 状态码应为 100–599', 'Use a response delay from 0 to 30000 ms': '响应延迟应为 0–30000 毫秒',
  'Response headers must be a JSON object': '响应头必须是 JSON 对象', 'Response headers must contain header names and string values': '响应头必须包含有效名称和字符串值',
  'A route with this method and path already exists': '此方法和路径的路由已存在', 'Add at least one route': '请至少添加一个路由',
  'Mock saved locally': 'Mock 已保存在本机', 'Collection requests are already in this mock': '此 Mock 已包含集合中的请求', 'Variable names must be unique within an environment.': '同一环境中的变量名称不能重复。',
  'Select a Postman Collection JSON object': '请选择 Postman 集合 JSON 对象', 'Expected Postman collection v2, environment, or LocalPostman workspace': '需要 Postman v2 集合、环境或 LocalPostman 工作区。',
  'Select a Collection JSON object': '请选择集合 JSON 对象', 'Expected Postman or Hoppscotch collection, environment, or LocalPostman workspace': '需要 Postman 或 Hoppscotch 集合、环境或 LocalPostman 工作区。',
};

let language = 'en';
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const observedRoots = new Set();
const attributes = ['title', 'aria-label', 'placeholder', 'alt'];
const ignored = '[data-no-translate],[translate="no"],script,style,pre,code,kbd,datalist,svg,[contenteditable="true"],.input-highlight,.code-highlight,.code-gutter,.response-code,.response-headers,.snippet-source,.mock-logs,.git-diff';

export function getLanguage() { return language; }
export function setLanguage(next) {
  language = next === 'zh-CN' ? 'zh-CN' : 'en';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    translateUi(document);
  }
  for (const root of observedRoots) translateUi(root);
  return language;
}

function interpolate(message, vars) {
  return String(message).replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(vars, name) ? String(vars[name]) : token);
}
function translatedSource(source) {
  if (Object.hasOwn(zh, source)) return zh[source];
  // Keep interpolated names, paths, parser details and server messages byte-for-byte.
  const prefixRules = [
    ['Could not save settings: ', '无法保存设置：'], ['Could not load settings: ', '无法加载设置：'],
    ['Could not read application information: ', '无法读取应用信息：'], ['Could not save before closing: ', '关闭前保存失败：'],
    ['Invalid JSON: ', 'JSON 格式无效：'], ['Imported. ', '已导入。'], ['Unresolved variable: ', '未解析的变量：'],
    ['Actions for ', '操作：'], ['Close ', '关闭：'], ['Clear ', '清除：'],
    ['Unable to read file: ', '无法读取文件：'], ['Import failed: ', '导入失败：'],
    ['Resolve the HTTP URL for ', '请解析请求的 HTTP URL：'],
  ];
  for (const [prefix, translated] of prefixRules) if (source.startsWith(prefix)) return translated + source.slice(prefix.length);
  const removedWorkspace = source.match(/^Remove “([\s\S]*)” from the workspace list\? Its local data is archived\.$/);
  if (removedWorkspace) return '从工作区列表中移除“'+removedWorkspace[1]+'”？其本地数据将归档。';
  const childRequests = source.match(/^and its (\d+) requests?$/);
  if (childRequests) return '及其 '+childRequests[1]+' 个请求';
  const repositoryCounts = source.match(/^Repository contains (\d+) Collections and (\d+) requests\. Loading replaces your current Collections, environments and service configurations\. Local history is kept, and the previous workspace is backed up\.$/);
  if (repositoryCounts) return '仓库包含 '+repositoryCounts[1]+' 个集合和 '+repositoryCounts[2]+' 个请求。加载后将替换当前集合、环境和服务配置，保留本地历史并备份原工作区。';
  const added = source.match(/^Added (\d+) collection requests?$/);
  if (added) return '已添加 '+added[1]+' 个集合请求';
  const valid = source.match(/^Enter a valid (.+) value\.$/);
  if (valid) return '请输入有效的 '+(zh[valid[1]]||valid[1])+' 值。';
  if(source === 'Enter a valid certificate port (0–65535).') return '请输入有效的证书端口（0–65535）。';
  const numbered = source.match(/^(Variable|Initial value|Current value|Remove variable|Remove certificate|Certificate file|Private key file) (\d+)$/);
  if (numbered) return ({Variable:'变量','Initial value':'初始值','Current value':'当前值','Remove variable':'移除变量','Remove certificate':'移除证书','Certificate file':'证书文件','Private key file':'私钥文件'})[numbered[1]]+' '+numbered[2];
  const entity = source.match(/^(Create|Edit|Rename|Delete|Move) (collection|folder|request|workspace|Monitor|Webhook|Deployed flow)$/);
  if (entity) return ({Create:'创建',Edit:'编辑',Rename:'重命名',Delete:'删除',Move:'移动'})[entity[1]] + ({collection:'集合',folder:'文件夹',request:'请求',workspace:'工作区',Monitor:'监控',Webhook:'Webhook','Deployed flow':'工作流'})[entity[2]];
  const shortcut = source.match(/^(.*?)( \([⌘⌥⇧].*\))$/);
  if (shortcut && Object.hasOwn(zh, shortcut[1])) return zh[shortcut[1]] + shortcut[2];
  return source;
}
export function t(source, vars = {}) {
  const text = String(source ?? '');
  return interpolate(language === 'zh-CN' ? translatedSource(text) : text, vars);
}

function preserveWhitespace(source) {
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match || !match[2]) return source;
  return match[1] + t(match[2]) + match[3];
}
function blocked(element) { return !element || !!element.closest?.(ignored); }
function updateText(node) {
  if (blocked(node.parentElement) || node.parentElement?.closest('textarea')) return;
  const previous = textSources.get(node);
  const source = previous && node.data === previous.rendered ? previous.source : node.data;
  const rendered = preserveWhitespace(source);
  if (rendered === source && !previous) return;
  // The text of an option without value is also its value. Fix it before translating.
  const option = node.parentElement;
  if (rendered !== source && option?.tagName === 'OPTION' && !option.hasAttribute('value')) option.setAttribute('value', option.value);
  textSources.set(node, { source, rendered });
  if (node.data !== rendered) node.data = rendered;
}
function updateAttributes(element) {
  if (blocked(element)) return;
  let remembered = attributeSources.get(element);
  for (const name of attributes) {
    if (!element.hasAttribute(name)) continue;
    if (name === 'title' && element.matches('.request-tab[data-select-tab]')) continue;
    const current = element.getAttribute(name), previous = remembered?.get(name);
    const source = previous && current === previous.rendered ? previous.source : current;
    const rendered = preserveWhitespace(source);
    if (rendered === source && !previous) continue;
    if (!remembered) { remembered = new Map(); attributeSources.set(element, remembered); }
    remembered.set(name, { source, rendered });
    if (current !== rendered) element.setAttribute(name, rendered);
  }
}
export function translateUi(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  if (root.nodeType === 3) { updateText(root); return; }
  if (root.nodeType === 1) { if (blocked(root)) return; updateAttributes(root); }
  const doc = root.ownerDocument || root;
  if (!doc.createTreeWalker) return;
  const walker = doc.createTreeWalker(root, 1 | 4, { acceptNode: node => blocked(node.nodeType === 1 ? node : node.parentElement) ? 2 : 1 }); // Reject excluded branches without inspecting payload descendants.
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) updateText(node);
    else updateAttributes(node);
  }
}
export function observeUi(root = typeof document !== 'undefined' ? document.body : null) {
  if (!root) return () => {};
  const MutationObserverType = root.ownerDocument?.defaultView?.MutationObserver || globalThis.MutationObserver;
  if (!MutationObserverType) { translateUi(root); return () => {}; }
  observedRoots.add(root);
  let queued = false, disconnected = false;
  const addedNodes = new Set(), textNodes = new Set(), attributeNodes = new Set();
  const attached = node => node === root || root.contains(node);
  const observer = new MutationObserverType(records => {
    if (disconnected) return;
    for (const record of records) {
      if (blocked(record.target.nodeType === 1 ? record.target : record.target.parentElement)) continue;
      if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node.nodeType === 1 || node.nodeType === 3) addedNodes.add(node);
      } else if (record.type === 'characterData') textNodes.add(record.target);
      else if (record.type === 'attributes') attributeNodes.add(record.target);
    }
    if (queued || !(addedNodes.size || textNodes.size || attributeNodes.size)) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disconnected) return;
      // Only walk newly inserted branches. Typing and status changes must not rescan Collections.
      const branches = [...addedNodes].filter(node => attached(node));
      addedNodes.clear();
      const branchSet = new Set(branches);
      const covered = node => {
        for (let parent = node.parentNode; parent; parent = parent.parentNode) if (branchSet.has(parent)) return true;
        return false;
      };
      for (const node of branches) if (!covered(node)) translateUi(node);
      for (const node of textNodes) if (attached(node) && !branchSet.has(node) && !covered(node)) updateText(node);
      for (const node of attributeNodes) if (attached(node) && !branchSet.has(node) && !covered(node)) updateAttributes(node);
      textNodes.clear(); attributeNodes.clear();
    });
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
  translateUi(root);
  return () => { disconnected = true; observer.disconnect(); addedNodes.clear(); textNodes.clear(); attributeNodes.clear(); observedRoots.delete(root); };
}
