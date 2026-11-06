# LocalPostman

本地优先的 Postman 基础替代品，使用浏览器原生 UI + Node HTTP 静态服务器，不使用 Electron。

## 运行

```bash
npm start
# 打开 http://localhost:4173
```

## 当前能力

- GET/POST/PUT/PATCH/DELETE/HEAD 请求发送
- Headers、JSON/Raw Body、Query 参数、环境变量 `{{name}}`
- 本地集合、请求历史、测试脚本占位
- localStorage 持久化与 JSON 导出
- Git 状态查看、提交和 push（需当前目录是 Git 仓库并配置 remote）

所有请求由浏览器直接发出；跨域接口需要服务端 CORS。后续可继续加入 OpenAPI 导入、请求脚本沙箱、文件上传和更完整的 Git 冲突处理。
