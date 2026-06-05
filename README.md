# 每日自动签到与账号管理

这个文件夹里是一个 Chrome / Edge 扩展，可以管理 new-api 和 AnyRouter 账号，支持新增账号时自动识别目标站点登录信息，并在每日时间窗口内自动执行签到。

扩展也保留了原来的每日自动打开能力，可以按照你设置的本地时间，每天在该时间后的 30 分钟内随机打开以下页面：

- `https://linux.do/?tl=en`
- `https://anyrouter.top/console`

如果设定时间已经过去，而当时浏览器没有打开，扩展会在你当天稍后启动浏览器时自动补开一次。自动签到现在由独立的“自动签到”页面和账号 provider 执行。

## 版本更新

- 当前版本：`2.0.0`
- `2.0.0`（2026-06-05）：
  - 新增账号管理页面，与自动签到页面分离
  - 新增站点类型下拉选择，第一版支持 New API 和 AnyRouter
  - 新增账号自动识别能力，可从目标站点读取用户 ID、用户名、访问令牌和 Cookie
  - new-api 签到改为账号 provider 执行，并保存逐账号结果
  - 新增 AnyRouter 真实签到 provider，按参考实现使用 Cookie 认证请求 `/api/user/sign_in`
  - 新增自动签到状态卡片、结果表格、单账号重试和失败重试队列
  - 保留 Linux.do / AnyRouter 控制台自动打开，并与自动签到结果分开展示
- `1.3.2`（2026-05-14）：
  - 修复 Chrome 中误把 Linux.do 配置为 new-api 签到站点时可能覆盖登录 Cookie，导致经常退出登录的问题
  - new-api 签到会跳过 Linux.do、AnyRouter 等自动打开目标，避免写入这些站点的 Cookie
  - 签到前后会清理临时动态请求头规则，避免旧规则残留影响后续页面请求
- `1.3.1`（2026-05-09）：
  - 修复 Edge 重启时可能重复补开 Linux.do 和 AnyRouter 页面的情况
  - 自动打开前会检查目标标签页是否已经存在，已存在时不再重复创建
  - 补开成功后会先记录当天已打开，再执行 new-api 签到，避免签到异常导致下次启动再次补开
  - 最近 new-api 签到反馈改为每个站点单独一行显示，便于查看多个站点结果
- `1.3.0`（2026-05-05）：
  - 暂时关闭 new-api 凭据自动获取功能
  - new-api 签到配置支持多个站点，可逐个填写站点地址、Access Token、用户 ID、Turnstile Token 和 Cookie
  - 定时任务和“立即签到”都会按配置列表顺序逐个执行签到，并汇总每个站点结果
- `1.2.1`（2026-05-05）：
  - new-api 配置支持只填写站点地址后自动获取凭据
  - 自动获取会复用当前浏览器登录态，从站点页面存储和 Cookie 中提取候选凭据并用 `/api/user/self` 验证
  - 参考 GLaDOS_AutoCheckin 的做法，为 API 请求补充同站 `Origin`/`Referer`
- `1.2.0`（2026-05-05）：
  - 集成 new-api 签到流程，支持配置站点地址、Access Token、用户 ID、Turnstile Token 和 Cookie
  - 设置页新增“最近 new-api 签到反馈”和“立即签到”按钮
  - 每日定时任务触发时会自动打开网页并尝试执行 new-api 签到
- `1.1.1`（2026-05-05）：
  - 修复 Chrome 启动补开时没有可用普通窗口导致两个页面都打开失败的问题
  - 设置页的失败反馈增加 Chrome 返回的具体错误信息，便于后续排查
- `1.1.0`（2026-04-22）：
  - 设置页新增“最近自动打开反馈”，显示最近打开时间与执行状态
  - 后台记录每次自动打开的结果（成功、部分成功、失败）
- `1.0.0`（2026-04-22）：
  - 支持每天定时随机打开 `https://linux.do/?tl=en` 和 `https://anyrouter.top/console`
  - 支持点击扩展图标直接进入设置页面
  - 更新扩展名称为“每日自动打开网页”并替换图标

## 文件说明

- `manifest.json`：Chrome Manifest V3 配置文件
- `background.js`：负责定时调度、补开逻辑和 new-api 签到请求
- `options.html`、`options.css`、`options.js`：设置页面，用来选择每天打开时间并配置签到参数

## 加载扩展

1. 打开 Chrome 或 Edge，访问 `chrome://extensions/` 或 `edge://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择这个文件夹：`D:\ProgramAdd\Extensions\LinuxDo`

## 设置时间与签到

1. 加载完成后，在扩展列表里点“详细信息”
2. 打开“扩展程序选项”
3. 选择每天打开的时间并点击“保存”
4. 也可以直接点击扩展图标，自动跳转到这个设置页面
5. 如需启用 new-api 签到，勾选“启用每日 new-api 签到”，按需添加一个或多个站点并填写凭据后保存
6. 设置页会显示最近一次自动打开和最近一次 new-api 签到的执行状态

默认时间是 `09:00`。

new-api 签到配置对应原 Python 脚本里的环境变量：

- `NEW_API_CHECKIN_BASE_URL` -> 每个站点的站点地址，例如 `https://网站域名`
- `NEW_API_CHECKIN_ACCESS_TOKEN` -> 每个站点的 Access Token
- `NEW_API_CHECKIN_USER_ID` -> 每个站点的用户 ID
- `NEW_API_CHECKIN_TURNSTILE_TOKEN` -> Turnstile Token（可选）
- `NEW_API_CHECKIN_COOKIE` -> Cookie（可选）

每个站点的配置会保存在本地浏览器扩展存储中。当前版本已关闭自动获取凭据，需要手动填写 Access Token 和用户 ID。

## 补开逻辑

- 如果浏览器在设定时间处于运行状态，扩展会在该时间后的 30 分钟内随机打开网页，并尝试执行 new-api 签到。
- 如果设定时间到达时浏览器完全关闭，扩展会在当天下一次启动浏览器时补开并补执行签到一次，但前提是当天还没有打开过。
- 扩展同一天只会自动打开一次；new-api 接口会判断当天是否已经签到，避免重复领取。
- 补开前会检查当前浏览器中是否已经存在 Linux.do 或 AnyRouter 控制台标签页，避免 Edge 会话恢复时重复打开。

## 注意事项

- 扩展需要 `<all_urls>` 主机权限，才能请求你在设置页填写的任意 new-api 站点。
- 浏览器不允许扩展手动设置 `Cookie` 请求头；这里会把设置页填写的 Cookie 尽量写入 Chrome Cookie 存储，再由请求自动携带。
- 如果站点启用了实时 Cloudflare、WAF 或 Turnstile 校验，Cookie 或 Turnstile Token 过期后需要重新填写。
