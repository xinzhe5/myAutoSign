# myAutoSign 功能升级开发计划

## 1. 背景与目标

当前项目是一个轻量 Chrome/Edge MV3 扩展，主要能力是：

- 每天定时随机打开 Linux.do 和 AnyRouter 页面。
- 通过手动配置多个 new-api 站点执行签到。
- 在设置页展示最近自动打开和 new-api 签到反馈。

参考项目 `all-api-hub-main` 中有三类需要迁移到本项目的核心能力：

- 账号管理与自动签到页面分离。
- 新增账号时支持在目标站点自动识别账号信息。
- AnyRouter 不是只打开页面，而是通过 Cookie 认证调用 `/api/user/sign_in` 执行真实签到。

本次升级目标是保留当前项目轻量结构，不整体迁移 React/WXT 架构，但按参考项目的功能模型重构：

- 建立统一账号管理。
- 建立独立自动签到页面。
- 建立可扩展签到 provider。
- 集成 new-api 与 AnyRouter 的真实签到。
- 集成新增账号自动识别能力，自动获取 userId、accessToken、username 等参数。

## 2. 设计原则

- 保留 MV3 原生 HTML/CSS/JS 方案，避免引入大型前端构建体系。
- 账号管理只负责账号数据，自动签到只负责任务执行和结果查看。
- 后台调度、签到 provider、页面渲染三者解耦。
- 先覆盖 new-api 与 AnyRouter，后续再扩展 Veloera、OneHub 等站点。
- 兼容旧版 `newApiCheckinConfig` 配置，升级后不要求用户重新填写。
- 如使用 subagent，最多只使用 1 个，且只用于参考项目对照或验收检查。

## 3. 页面结构

### 3.1 页面拆分方式

Chrome 扩展只能配置一个 `options_page`，因此保留 `options.html` 作为入口，用 hash route 做两个独立页面：

- `options.html#accounts`：账号管理
- `options.html#auto-checkin`：自动签到

页面顶部或左侧提供导航：

- 账号管理
- 自动签到
- 基础设置

基础设置保留现有“自动打开 Linux.do”等能力，不再和账号签到配置混在一起。

### 3.2 账号管理页

账号管理页包含：

- 账号列表
- 添加账号
- 编辑账号
- 删除账号
- 启用/停用账号
- 启用/停用单账号自动签到
- 搜索账号
- 按站点类型筛选
- 按账号状态筛选
- 最近签到状态展示

账号卡片字段：

- 账号名称
- 站点地址
- 站点类型
- 认证方式
- 是否启用
- 是否参与自动签到
- 最近签到状态
- 最近签到时间

添加/编辑账号表单字段：

- 站点名称
- 站点地址
- 站点类型下拉选择：`new-api`、`anyrouter`
- 认证方式：`access-token`、`cookie`
- 用户名
- 用户 ID
- Access Token
- Cookie
- Turnstile Token
- 备注
- 是否启用账号
- 是否启用自动签到

站点类型默认规则：

- URL 包含 `anyrouter.top` 时默认 `siteType = anyrouter`。
- `anyrouter` 默认 `authType = cookie`。
- 其他站点默认 `siteType = new-api`，`authType = access-token`。

站点类型联动效果按参考插件实现，不自行设计新规则：

- 新增/编辑账号弹窗中提供“站点类型”选择控件，行为参考
  `all-api-hub-main/src/features/AccountManagement/components/AccountDialog/AccountForm.tsx`：
  - 使用下拉选择站点类型。
  - 选项来自站点类型常量列表，第一版至少落地 `New API` 和 `AnyRouter`。
- 认证方式选择参考同一表单：
  - 认证方式也是下拉选择。
  - `authType === AccessToken` 时显示 Access Token 字段。
  - `authType === Cookie` 时显示 Cookie 认证字段。
  - 因此 AnyRouter 的 Access Token 字段不是另行“弱化”，而是按参考表单由认证方式自然控制显示与必填。
- AnyRouter 默认认证方式参考
  `all-api-hub-main/src/features/AccountManagement/utils/accountAuthType.ts`：
  - URL 命中 `anyrouter.top` 时默认 `AuthTypeEnum.Cookie`。
  - 其他站点默认 `AuthTypeEnum.AccessToken`。
- 自动识别后的账号草稿合并参考
  `all-api-hub-main/src/features/AccountManagement/components/AccountDialog/hooks/useAccountDialog.ts`：
  - 自动识别结果可以回填 `siteType`。
  - 自动识别结果可以回填 `authType`。
  - 表单根据回填后的 `siteType` 和 `authType` 展示对应字段。
- AnyRouter 自动签到参考
  `all-api-hub-main/src/services/checkin/autoCheckin/providers/anyrouter.ts`：
  - 使用 `AuthTypeEnum.Cookie`。
  - 请求 `POST /api/user/sign_in`。
  - 请求体为 `{}`。
  - 请求头包含 `X-Requested-With: XMLHttpRequest`。
  - `success` 或 `签到成功` 视为成功。
  - 空 message 或已签到文案按参考逻辑视为已签到。
- 账号列表和自动签到结果中显示站点类型，便于确认账号实际使用哪个 provider。

### 3.3 自动签到页

自动签到页包含：

- 全局自动签到开关
- 每日签到时间窗口
- 失败重试开关
- 最大重试次数
- 重试间隔
- 立即签到全部
- 只重试失败账号
- 刷新结果

状态卡片：

- 最近运行时间
- 下次每日运行时间
- 下次重试时间
- 总账号数
- 已执行数
- 成功数
- 失败数
- 跳过数

结果表格：

- 账号名称
- 站点类型
- 状态
- 消息
- 奖励额度
- 当前额度
- 运行时间
- 操作

单行操作：

- 重试此账号
- 打开站点
- 编辑账号
- 停用账号

## 4. 数据模型

### 4.1 accounts

存储区域：`chrome.storage.local`

Key：`accounts`

```json
[
  {
    "id": "account-uuid",
    "enabled": true,
    "name": "主站",
    "siteType": "new-api",
    "baseUrl": "https://example.com",
    "authType": "access-token",
    "username": "alice",
    "userId": "123",
    "accessToken": "token",
    "cookie": "",
    "turnstileToken": "",
    "autoCheckinEnabled": true,
    "notes": "",
    "createdAt": "2026-06-05T00:00:00.000Z",
    "updatedAt": "2026-06-05T00:00:00.000Z"
  }
]
```

### 4.2 autoCheckinSettings

存储区域：`chrome.storage.sync`

Key：`autoCheckinSettings`

```json
{
  "enabled": true,
  "windowStart": "09:00",
  "windowEnd": "09:30",
  "retryEnabled": true,
  "maxRetryPerDay": 2,
  "retryIntervalMinutes": 60
}
```

### 4.3 autoCheckinStatus

存储区域：`chrome.storage.local`

Key：`autoCheckinStatus`

```json
{
  "lastRunAt": "2026-06-05T01:00:00.000Z",
  "nextDailyRunAt": "2026-06-06T01:12:00.000Z",
  "nextRetryRunAt": null,
  "lastRunResult": "partial",
  "summary": {
    "totalEligible": 2,
    "executed": 2,
    "successCount": 1,
    "failedCount": 1,
    "skippedCount": 0,
    "needsRetry": true
  },
  "perAccount": {
    "account-uuid": {
      "accountId": "account-uuid",
      "accountName": "主站",
      "siteType": "new-api",
      "status": "success",
      "message": "签到成功",
      "rawMessage": "",
      "rewardToday": "$0.010000",
      "currentQuota": "$1.230000",
      "timestamp": 1780592400000
    }
  },
  "retryState": {
    "day": "2026-06-05",
    "pendingAccountIds": ["account-uuid"],
    "attemptsByAccount": {
      "account-uuid": 1
    }
  }
}
```

### 4.4 旧数据迁移

从旧配置迁移：

- 读取 `newApiCheckinConfig.sites`。
- 每个 site 生成一个账号。
- `siteType = new-api`。
- `authType = access-token`。
- `autoCheckinEnabled = site.enabled !== false`。
- 保留 `baseUrl`、`accessToken`、`userId`、`cookie`、`turnstileToken`、`name`。

迁移完成后写入：

- `accounts`
- `autoCheckinSettings.enabled = oldConfig.enabled`

保留旧 key 一段时间，不主动删除，降低回滚风险。

## 5. 自动识别账号设计

### 5.1 用户流程

用户在目标站点新增账号：

1. 先在浏览器中打开目标站点并登录。
2. 打开扩展设置页。
3. 进入“账号管理”。
4. 点击“添加账号”。
5. 输入或自动带入当前标签页 URL。
6. 点击“自动识别”。
7. 扩展从目标站点读取账号信息。
8. 自动填充用户名、用户 ID、Access Token、Cookie 等字段。
9. 用户确认后保存账号。

### 5.2 自动识别来源优先级

参考 `all-api-hub-main` 的设计，使用以下顺序：

1. 当前标签页 content script 读取 localStorage。
2. 当前标签页 content script 使用同源登录态请求接口。
3. 后台直接请求站点 API。
4. 必要时打开临时标签页/窗口读取登录态。

第一版优先实现 1、2、3；临时窗口可作为第二阶段增强。

### 5.3 content script 能力

新增 content script，用于目标站点内执行：

- 读取 localStorage 中的 `user`。
- 读取可能存在的 token 字段。
- 在同源上下文调用接口。

建议支持的读取候选：

- localStorage `user`
- localStorage `access_token`
- localStorage `token`
- localStorage `user_token`
- sessionStorage 中同名字段

候选接口：

- `GET /api/user/self`
- `GET /api/status`

自动识别输出：

```json
{
  "success": true,
  "data": {
    "siteType": "new-api",
    "authType": "access-token",
    "username": "alice",
    "userId": "123",
    "accessToken": "token",
    "cookie": ""
  }
}
```

### 5.4 new-api 自动识别

识别策略：

- 从 localStorage 解析用户对象。
- 从 localStorage/sessionStorage 提取 access token。
- 使用 token 请求 `/api/user/self` 验证。
- 如果 token 缺失但浏览器已登录，尝试使用 Cookie 请求 `/api/user/self`。
- 自动填充 username、userId、accessToken。

保存规则：

- 有 accessToken 时默认 `authType = access-token`。
- 无 accessToken 但 Cookie 可用时默认 `authType = cookie`。

### 5.5 AnyRouter 自动识别

参考项目结论：

- AnyRouter 必须使用 Cookie 认证。
- AnyRouter 不支持标准 Access Token 签到。
- Cookie 必须来自当前已登录账号。

识别策略：

- URL 命中 `anyrouter.top` 时设置 `siteType = anyrouter`。
- 默认 `authType = cookie`。
- 从 localStorage 或接口读取 userId、username。
- 从 `chrome.cookies.getAll` 导入该站点 Cookie，拼接成 Cookie header 值。
- 不要求 Access Token。

自动识别输出：

```json
{
  "success": true,
  "data": {
    "siteType": "anyrouter",
    "authType": "cookie",
    "username": "alice",
    "userId": "123",
    "accessToken": "",
    "cookie": "session=..."
  }
}
```

### 5.6 自动识别错误处理

页面需要展示明确错误：

- 未登录或 401：提示先打开目标站点登录。
- 403：提示可能被 Cloudflare/WAF 拦截。
- content script 不可用：提示刷新目标页面后重试。
- 无法读取 userId：提示切换手动添加。
- AnyRouter 未导入 Cookie：提示检查登录状态和 Cookie 权限。

## 6. 签到 provider 设计

### 6.1 统一 provider 返回值

```json
{
  "status": "success",
  "message": "签到成功",
  "rawMessage": "",
  "data": {},
  "rewardToday": "",
  "currentQuota": ""
}
```

状态枚举：

- `success`
- `already_checked`
- `failed`
- `skipped`
- `config_error`
- `turnstile_required`

### 6.2 new-api provider

保留现有逻辑并封装：

- `GET /api/status`
- `GET /api/user/self`
- `GET /api/user/checkin`
- `POST /api/user/checkin`

认证：

- Access Token：`Authorization: Bearer xxx`
- 用户 ID：`New-Api-User`
- Cookie：写入 `chrome.cookies` 后使用 `credentials: include`

保留能力：

- Turnstile Token。
- 额度格式化。
- Cloudflare/WAF 非 JSON 错误识别。
- Origin/Referer 动态请求头规则。

### 6.3 AnyRouter provider

参考实现：

- 请求地址：`POST {baseUrl}/api/user/sign_in`
- 请求头：`X-Requested-With: XMLHttpRequest`
- 请求体：`{}`
- 认证方式：Cookie
- userId 用于标识账号和兼容请求头。

成功判断：

- `response.success === true`
- message 包含 `success`
- message 包含 `签到成功`

已签到判断：

- message 为空时视为已签到。
- message 命中“已签到/今日已签到/already checked”等文案。

失败判断：

- `response.success === false`
- HTTP 请求失败。
- 返回非 JSON。

AnyRouter provider 不再通过打开 `https://anyrouter.top/console` 代替签到。

## 7. 后台调度设计

### 7.1 alarm 设计

新增两个 alarm：

- `auto-checkin-daily`
- `auto-checkin-retry`

保留现有自动打开 alarm，但建议更名或隔离：

- `open-target-pages-daily`

### 7.2 每日签到流程

1. 读取 `autoCheckinSettings`。
2. 如果全局未启用，停止。
3. 读取 `accounts`。
4. 过滤账号：
   - `enabled === true`
   - `autoCheckinEnabled !== false`
   - provider 可用
5. 逐账号执行 provider。
6. 聚合结果。
7. 保存 `autoCheckinStatus`。
8. 如果有失败账号且重试启用，安排 retry alarm。
9. 安排下一次 daily alarm。

### 7.3 时间窗口

第一版可以兼容旧设置：

- 旧 `scheduleTime = 09:00`
- 自动迁移成：
  - `windowStart = 09:00`
  - `windowEnd = 09:30`

新逻辑：

- 在每日窗口内随机选择执行时间。
- 支持跨午夜窗口可以作为第二阶段增强。

### 7.4 启动补执行

保留现有补执行策略：

- 浏览器启动时检查今天是否已经运行。
- 如果当前时间已超过窗口开始且今天未运行，则补执行一次。
- 补执行只运行自动签到，不重复打开已存在目标页。

### 7.5 失败重试

重试只处理失败账号：

- 不处理成功账号。
- 不处理已签到账号。
- 不处理配置错误账号，除非用户修改配置后手动重试。
- 每个账号每天最多 `maxRetryPerDay` 次。

## 8. 自动打开功能调整

现有自动打开功能保留，但从自动签到中拆出：

- Linux.do 自动打开继续保留。
- AnyRouter 控制台自动打开改为可配置辅助动作。
- AnyRouter 签到必须走 provider。

基础设置页保留：

- 最近自动打开反馈。
- 每日自动打开时间。
- 待补增强：是否启用每日自动打开。
- 待补增强：可编辑自动打开 URL 列表。

## 9. 文件改造计划

### 9.1 新增文件

- `DEVELOPMENT_PLAN.md`：本开发计划。
- `shared.js`：常量、状态枚举、账号归一化、时间工具。
- `content.js`：目标站点自动识别所需的 content script。

### 9.2 修改文件

- `manifest.json`
  - 增加 content script。
  - 确认 `cookies`、`tabs`、`storage`、`alarms`、`declarativeNetRequest` 权限。
  - 保留 `<all_urls>` host 权限。
- `options.html`
  - 改成路由壳子。
  - 增加账号管理页面结构。
  - 增加自动签到页面结构。
  - 增加基础设置页面结构。
- `options.css`
  - 重做页面布局、列表、表格、表单、状态徽标。
- `options.js`
  - 实现 hash route。
  - 实现账号 CRUD。
  - 实现自动识别按钮。
  - 实现自动签到设置和结果表格。
- `background.js`
  - 拆出账号迁移。
  - 拆出 provider 执行。
  - 增加 AnyRouter provider。
  - 重构每日签到和失败重试调度。
  - 增加运行状态保存。

## 10. 分阶段任务清单

### 阶段 1：数据模型与旧配置迁移

- [x] 定义账号模型、设置模型、状态模型。
- [x] 新增账号读取、保存、归一化工具。
- [x] 将旧 `newApiCheckinConfig.sites` 迁移为 `accounts`。
- [x] 将旧 `scheduleTime` 迁移为自动签到时间窗口。
- [ ] 验证旧配置升级后 new-api 账号仍可显示。

验收：

- 旧配置不丢失。
- 新账号列表能从旧配置生成。
- 页面刷新后账号数据稳定。

### 阶段 2：账号管理页面

- [x] 实现 `#accounts` 页面。
- [x] 实现账号列表。
- [x] 实现添加账号表单。
- [x] 实现编辑账号表单。
- [x] 实现删除账号。
- [x] 实现启用/停用账号。
- [x] 实现搜索和类型筛选。
- [x] 实现 AnyRouter 默认 Cookie 认证规则。

验收：

- 可以手动添加 new-api 账号。
- 可以手动添加 AnyRouter 账号。
- 可以编辑、删除、停用账号。
- AnyRouter 账号默认不要求 Access Token。

### 阶段 3：新增账号自动识别

- [x] 新增 `content.js`。
- [x] manifest 注册 content script。
- [x] 实现当前标签页匹配目标站点。
- [x] 实现读取 localStorage/sessionStorage 用户信息。
- [x] 实现同源请求 `/api/user/self`。
- [x] 实现通过 `chrome.cookies.getAll` 导入 Cookie。
- [x] 实现 new-api 自动识别。
- [x] 实现 AnyRouter 自动识别。
- [x] 实现自动识别错误提示。

验收：

- 在已登录 new-api 站点点击自动识别可填充 userId、username、accessToken。
- 在已登录 AnyRouter 站点点击自动识别可填充 userId、username、Cookie。
- 未登录时提示用户先登录。
- content script 未注入时提示刷新目标页面。

### 阶段 4：provider 化签到

- [x] 将现有 new-api 签到封装为 provider。
- [x] 新增 AnyRouter provider。
- [x] 实现 provider resolver。
- [x] 统一 provider 返回值。
- [x] 按账号执行单个 provider。
- [x] 保存逐账号结果。

验收：

- new-api 账号可以继续签到。
- AnyRouter 账号通过 `/api/user/sign_in` 签到。
- AnyRouter 不再只依赖打开控制台页面。
- 每个账号有独立状态和消息。

### 阶段 5：自动签到页面

- [x] 实现 `#auto-checkin` 页面。
- [x] 实现全局开关和时间窗口。
- [x] 实现立即签到全部。
- [x] 实现重试失败账号。
- [x] 实现状态卡片。
- [x] 实现结果表格。
- [x] 实现单账号重试、打开站点、编辑账号入口。

验收：

- 用户可以从自动签到页运行全部账号。
- 运行完成后能看到成功、失败、跳过统计。
- 结果表格显示逐账号结果。

### 阶段 6：后台调度与失败重试

- [x] 新增 daily alarm。
- [x] 新增 retry alarm。
- [x] 实现每日随机窗口调度。
- [x] 实现启动补执行。
- [x] 实现失败账号重试队列。
- [x] 实现每日只执行一次保护。
- [x] 实现手动运行不破坏定时计划。

验收：

- 自动签到每天最多正常执行一次。
- 失败账号可以自动重试。
- 重试不影响下一次每日计划。
- 浏览器关闭后当天启动能补执行。

### 阶段 7：自动打开功能整理

- [x] 将自动打开设置从自动签到页中拆出。
- [x] 保留 Linux.do 自动打开。
- [x] 将 AnyRouter 控制台打开作为辅助动作。
- [x] 自动打开结果与签到结果分开展示。
- [ ] 增加“是否启用每日自动打开”开关。
- [ ] 增加可编辑自动打开 URL 列表。

验收：

- Linux.do 自动打开仍可用。
- AnyRouter 真实签到不依赖自动打开页面。
- 自动打开反馈和签到反馈互不混淆。

## 11. 测试与验证清单

### 手动验证

- [ ] 安装旧版本配置后升级，确认配置迁移。
- [ ] 添加 new-api 账号并手动签到。
- [ ] 添加 AnyRouter 账号并手动签到。
- [ ] 在目标站点已登录时执行自动识别。
- [ ] 在目标站点未登录时执行自动识别。
- [ ] 停用账号后确认不会参与自动签到。
- [ ] 关闭全局自动签到后确认不创建 daily alarm。
- [ ] 手动运行后确认页面结果刷新。
- [ ] 失败后确认重试队列生成。
- [ ] Chrome 和 Edge 均能加载扩展。

### 浏览器权限验证

- [ ] `cookies` 可读取目标站点 Cookie。
- [ ] `tabs` 可定位当前活动标签页。
- [ ] `alarms` 可创建 daily/retry alarm。
- [ ] `declarativeNetRequest` 可设置 new-api Origin/Referer。
- [ ] content script 能在目标站点执行。

### 回归验证

- [ ] 原有 `run-new-api-checkin` 手动消息能力迁移后仍可通过新入口运行。
- [ ] 原有 new-api 多站点配置均迁移成独立账号。
- [ ] 自动打开不会重复打开已有 Linux.do / AnyRouter 标签页。
- [ ] new-api 签到不会向 Linux.do / AnyRouter 写入错误 Cookie。

## 12. 第一版交付范围

第一版必须包含：

- 账号管理页面。
- 自动签到页面。
- 旧配置迁移。
- 手动添加账号。
- new-api provider。
- AnyRouter provider。
- 新增账号自动识别。
- 立即签到全部。
- 逐账号结果展示。

第一版可暂缓：

- 跨午夜时间窗口。
- 临时窗口自动识别。
- 批量导入/导出。
- 标签系统。
- 账号拖拽排序。
- 更复杂的统计图表。

## 13. 关键风险

- 自动识别依赖站点前端存储和接口，不同 new-api 魔改站可能字段不一致。
- AnyRouter Cookie 认证不适合同站多账号同时存在，第一版按当前登录 Cookie 处理。
- Cloudflare/WAF 可能阻止后台直接请求，需优先使用当前标签页同源请求。
- MV3 service worker 会休眠，调度状态必须持久化到 storage。
- `<all_urls>` 权限较大，需要页面文案说明用途。

## 14. 推荐开发顺序

1. 数据模型与旧配置迁移。
2. 账号管理页面。
3. 自动识别 content script 与消息链路。
4. new-api provider 封装。
5. AnyRouter provider 集成。
6. 自动签到页面。
7. daily/retry 调度。
8. 自动打开功能整理。
9. 全量手动验证。

## 15. 本轮实现与验证记录

更新时间：2026-06-05

已实现：

- 新增 `shared.js`，集中维护站点类型、认证方式、状态枚举、账号归一化和时间工具。
- 新增 `content.js`，支持目标站点内读取 localStorage/sessionStorage，并同源请求 `/api/user/self`。
- 更新 `manifest.json`，注册 content script，保留 `cookies`、`tabs`、`storage`、`alarms`、`declarativeNetRequest`、`<all_urls>`。
- 重构 `background.js`：
  - 旧 `newApiCheckinConfig.sites` 自动迁移为 `accounts`。
  - 旧 `scheduleTime` 自动迁移为自动签到时间窗口。
  - new-api 签到封装为账号 provider。
  - AnyRouter provider 按参考实现使用 Cookie 认证，请求 `POST /api/user/sign_in`，请求体 `{}`，请求头包含 `X-Requested-With: XMLHttpRequest` 和兼容 userId headers。
  - 新增 daily alarm 与 retry alarm。
  - 新增逐账号执行结果和 `autoCheckinStatus`。
- 重做 `options.html`、`options.css`、`options.js`：
  - `#accounts` 账号管理页。
  - `#auto-checkin` 自动签到页。
  - `#basic` 基础设置页。
  - 新增/编辑账号时使用站点类型下拉和认证方式下拉。
  - AnyRouter URL 会默认选择 `AnyRouter` 与 `Cookie`，字段显示由 `authType` 控制，行为对齐参考插件表单。
  - 自动识别结果可回填 `siteType`、`authType`、`username`、`userId`、`accessToken`、`cookie`。

已验证：

- `node --check shared.js`
- `node --check background.js`
- `node --check content.js`
- `node --check options.js`
- `manifest.json` JSON 解析
- 使用 Puppeteer 下载的 Chrome for Testing 加载 unpacked extension：
  - MV3 service worker 成功加载。
  - `options.html#accounts` 成功打开。
  - 新增账号输入 `https://anyrouter.top/console` 后自动联动为 `AnyRouter` + `Cookie`。
  - AnyRouter 表单中 Access Token 字段按认证方式隐藏，Cookie 字段显示。
  - 保存 AnyRouter 测试账号后账号卡显示 `AnyRouter` 和 `Cookie`。
  - `options.html#auto-checkin` 成功打开。

未完成或待真实站点验证：

- 在真实已登录 new-api 站点执行自动识别并完成签到。
- 在真实已登录 AnyRouter 站点执行自动识别并完成 `/api/user/sign_in` 签到。
- Edge 本机加载验证；当前环境未找到 Edge 可执行文件，本轮使用 Chrome for Testing 完成浏览器扩展加载测试。
- 基础设置页的“启用自动打开”开关和可编辑 URL 列表。
