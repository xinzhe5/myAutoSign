importScripts("shared.js");

const {
  SITE_TYPES,
  AUTH_TYPES,
  CHECKIN_STATUS,
  STORAGE_KEYS,
  DEFAULTS,
  normalizeBaseUrl,
  detectSiteType,
  getDefaultAuthType,
  isKnownSiteType,
  isKnownAuthType,
  normalizeAccount,
  normalizeAccounts,
  normalizeSettings,
  parseTimeMinutes,
  getTodayKey,
  statusIsSuccess,
  getRunResult,
  summarizeResults,
  createId
} = globalThis.MyAutoSignShared;

const OPEN_ALARM_NAME = "open-target-pages-daily";
const LEGACY_OPEN_ALARM_NAME = "open-linuxdo-daily";
const AUTO_DAILY_ALARM_NAME = "auto-checkin-daily";
const AUTO_RETRY_ALARM_NAME = "auto-checkin-retry";
const NEW_API_HEADER_RULE_ID = 100;
const STARTUP_CATCH_UP_DELAY_MS = 3000;
const DEFAULT_QUOTA_PER_UNIT = 500000;
const DEFAULT_QUOTA_DISPLAY_TYPE = "USD";
const DEFAULT_USD_EXCHANGE_RATE = 1;
const DEFAULT_CUSTOM_CURRENCY_SYMBOL = "¤";
const DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE = 1;
const AUTO_DETECT_MESSAGE_TYPE = "myautosign-detect-site";

const TARGET_URLS = [
  "https://linux.do/?tl=en",
  "https://anyrouter.top/console"
];

const PROTECTED_TARGET_HOSTS = new Set(TARGET_URLS.map((url) => new URL(url).hostname));

function getDisplayType(statusData) {
  return String(statusData?.quota_display_type || DEFAULT_QUOTA_DISPLAY_TYPE).toUpperCase();
}

function formatDisplayQuota(quota, statusData, digits = 6) {
  const quotaPerUnit = Number(statusData?.quota_per_unit || DEFAULT_QUOTA_PER_UNIT);
  const displayType = getDisplayType(statusData);
  const usdAmount = Number(quota || 0) / quotaPerUnit;

  if (displayType === "TOKENS") {
    return String(Math.trunc(Number(quota || 0)));
  }

  if (displayType === "CNY") {
    const rate = Number(statusData?.usd_exchange_rate || DEFAULT_USD_EXCHANGE_RATE);
    return `¥${(usdAmount * rate).toFixed(digits)}`;
  }

  if (displayType === "CUSTOM") {
    const symbol = String(statusData?.custom_currency_symbol || DEFAULT_CUSTOM_CURRENCY_SYMBOL);
    const rate = Number(statusData?.custom_currency_exchange_rate || DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE);
    return `${symbol}${(usdAmount * rate).toFixed(digits)}`;
  }

  return `$${usdAmount.toFixed(digits)}`;
}

function parseCookiePairs(cookie) {
  return String(cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) return null;
      return {
        name: part.slice(0, separatorIndex).trim(),
        value: part.slice(separatorIndex + 1).trim()
      };
    })
    .filter((item) => item?.name);
}

async function applyConfiguredCookies(baseUrl, cookie) {
  const pairs = parseCookiePairs(cookie);
  if (!pairs.length || !chrome.cookies?.set) {
    return;
  }

  await Promise.allSettled(
    pairs.map((pair) => chrome.cookies.set({
      url: baseUrl,
      name: pair.name,
      value: pair.value,
      path: "/"
    }))
  );
}

async function getCookieHeader(baseUrl) {
  if (!chrome.cookies?.getAll) {
    return "";
  }

  try {
    const cookies = await chrome.cookies.getAll({ url: baseUrl });
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  } catch (error) {
    return "";
  }
}

function formatNonJsonError(body) {
  const text = String(body || "");
  const snippet = text.trim().replace(/\s+/g, " ").slice(0, 300);
  const lowered = text.toLowerCase();

  if (lowered.includes("error code: 1010") || lowered.includes("cloudflare")) {
    return `请求被站点前面的 Cloudflare/WAF 拦截，请求尚未到达接口。片段: ${snippet}`;
  }

  return `接口返回的不是合法 JSON: ${snippet}`;
}

async function requestJson(method, url, headers = {}, body) {
  let response;
  let text;

  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      credentials: "include"
    });
    text = await response.text();
  } catch (error) {
    throw new Error(`请求失败: ${error?.message || String(error)}`);
  }

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(formatNonJsonError(text));
  }

  return {
    statusCode: response.status,
    data
  };
}

function buildAccountResult(account, status, message, extra = {}) {
  return {
    accountId: account.id,
    accountName: account.name || account.username || account.baseUrl || "未命名账号",
    siteType: account.siteType,
    baseUrl: account.baseUrl,
    status,
    message,
    timestamp: Date.now(),
    ...extra
  };
}

function isProtectedTargetHost(baseUrl) {
  try {
    return PROTECTED_TARGET_HOSTS.has(new URL(baseUrl).hostname);
  } catch (error) {
    return false;
  }
}

async function configureNewApiHeaderRule(baseUrl) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  const parsed = new URL(baseUrl);
  const origin = parsed.origin;
  const host = parsed.host;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [NEW_API_HEADER_RULE_ID],
    addRules: [{
      id: NEW_API_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Origin", operation: "set", value: origin },
          { header: "Referer", operation: "set", value: `${origin}/` }
        ]
      },
      condition: {
        urlFilter: `${host}/api/user/`,
        resourceTypes: ["xmlhttprequest"]
      }
    }]
  });
}

async function clearNewApiHeaderRule() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [NEW_API_HEADER_RULE_ID]
  });
}

function buildNewApiHeaders(account) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (account.authType === AUTH_TYPES.ACCESS_TOKEN && account.accessToken) {
    headers.Authorization = `Bearer ${account.accessToken}`;
  }

  if (account.userId) {
    headers["New-Api-User"] = account.userId;
  }

  return headers;
}

function buildCompatUserIdHeaders(userId) {
  if (!userId) {
    return {};
  }

  const value = String(userId);
  return {
    "New-API-User": value,
    "Veloera-User": value,
    "X-Api-User": value,
    "voapi-user": value,
    "User-id": value,
    "Rix-Api-User": value,
    "neo-api-user": value
  };
}

async function tryGetNewApiStatus(baseUrl, headers) {
  try {
    const { statusCode, data } = await requestJson("GET", `${baseUrl}/api/status`, headers);
    return statusCode === 200 ? data.data || data : {};
  } catch (error) {
    return {};
  }
}

async function getNewApiSelf(baseUrl, headers) {
  const { statusCode, data } = await requestJson("GET", `${baseUrl}/api/user/self`, headers);
  if (statusCode !== 200) {
    throw new Error(`查询用户信息失败，HTTP ${statusCode}: ${JSON.stringify(data)}`);
  }
  if (!data.success) {
    throw new Error(`查询用户信息失败: ${data.message || JSON.stringify(data)}`);
  }
  return data.data || {};
}

async function getNewApiCheckinStatus(baseUrl, headers) {
  const { statusCode, data } = await requestJson("GET", `${baseUrl}/api/user/checkin`, headers);
  if (statusCode !== 200) {
    throw new Error(`查询签到状态失败，HTTP ${statusCode}: ${JSON.stringify(data)}`);
  }
  if (!data.success) {
    throw new Error(`查询签到状态失败: ${data.message || JSON.stringify(data)}`);
  }
  return data.data || {};
}

async function doNewApiCheckin(baseUrl, headers, turnstileToken) {
  let url = `${baseUrl}/api/user/checkin`;
  if (turnstileToken) {
    url = `${url}?${new URLSearchParams({ turnstile: turnstileToken })}`;
  }

  const { statusCode, data } = await requestJson("POST", url, headers);
  if (statusCode !== 200) {
    throw new Error(`执行签到失败，HTTP ${statusCode}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function runNewApiProvider(account) {
  if (!account.baseUrl) {
    return buildAccountResult(account, CHECKIN_STATUS.CONFIG_ERROR, "缺少站点地址");
  }

  if (!account.userId) {
    return buildAccountResult(account, CHECKIN_STATUS.CONFIG_ERROR, "缺少用户 ID");
  }

  if (account.authType === AUTH_TYPES.ACCESS_TOKEN && !account.accessToken) {
    return buildAccountResult(account, CHECKIN_STATUS.CONFIG_ERROR, "缺少 Access Token");
  }

  if (isProtectedTargetHost(account.baseUrl)) {
    return buildAccountResult(
      account,
      CHECKIN_STATUS.CONFIG_ERROR,
      "该地址是自动打开目标，不应作为 new-api 签到站点；为避免覆盖站点登录 Cookie 已跳过"
    );
  }

  const headers = buildNewApiHeaders(account);

  try {
    await configureNewApiHeaderRule(account.baseUrl);
    await applyConfiguredCookies(account.baseUrl, account.cookie);

    const statusData = await tryGetNewApiStatus(account.baseUrl, headers);
    const displayType = getDisplayType(statusData);
    const selfData = await getNewApiSelf(account.baseUrl, headers);
    const current = await getNewApiCheckinStatus(account.baseUrl, headers);
    const stats = current.stats || {};
    const currentQuota = formatDisplayQuota(selfData.quota, statusData, 6);
    const rewardTotal = formatDisplayQuota(stats.total_quota, statusData, 6);
    const totalCheckins = stats.total_checkins || "";

    if (stats.checked_in_today) {
      return buildAccountResult(account, CHECKIN_STATUS.ALREADY_CHECKED, "今天已经签到过了", {
        totalCheckins,
        rewardTotal,
        currentQuota,
        displayType
      });
    }

    const checkinResult = await doNewApiCheckin(account.baseUrl, headers, account.turnstileToken);
    if (!checkinResult.success) {
      const apiMessage = checkinResult.message || JSON.stringify(checkinResult);
      const turnstileRequired = apiMessage.includes("Turnstile token 为空");
      return buildAccountResult(
        account,
        turnstileRequired ? CHECKIN_STATUS.TURNSTILE_REQUIRED : CHECKIN_STATUS.FAILED,
        turnstileRequired ? "站点开启了 Turnstile，需要提供 turnstile token" : `签到失败: ${apiMessage}`,
        { totalCheckins, rewardTotal, currentQuota, displayType }
      );
    }

    const data = checkinResult.data || {};
    const selfAfter = await getNewApiSelf(account.baseUrl, headers);
    const quotaAwarded = Number(data.quota_awarded || 0);

    return buildAccountResult(account, CHECKIN_STATUS.SUCCESS, checkinResult.message || "签到成功", {
      checkinDate: String(data.checkin_date || ""),
      totalCheckins: String(Number(stats.total_checkins || 0) + 1),
      rewardToday: formatDisplayQuota(quotaAwarded, statusData, 6),
      rewardTotal: formatDisplayQuota(Number(stats.total_quota || 0) + quotaAwarded, statusData, 6),
      currentQuota: formatDisplayQuota(selfAfter.quota, statusData, 6),
      displayType
    });
  } catch (error) {
    let message = error?.message || String(error);
    let status = CHECKIN_STATUS.FAILED;

    if (message.includes("Turnstile token 为空")) {
      status = CHECKIN_STATUS.TURNSTILE_REQUIRED;
      message = "站点开启了 Turnstile，需要提供 turnstile token";
    }

    return buildAccountResult(account, status, message);
  } finally {
    await clearNewApiHeaderRule();
  }
}

function normalizeCheckinMessage(message) {
  return String(message || "").trim();
}

function isAlreadyCheckedMessage(message) {
  const normalized = normalizeCheckinMessage(message).toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    normalized.includes("already") ||
    normalized.includes("checked") ||
    normalized.includes("今日已") ||
    normalized.includes("今天已") ||
    normalized.includes("已签到")
  );
}

async function runAnyRouterProvider(account) {
  if (!account.baseUrl) {
    return buildAccountResult(account, CHECKIN_STATUS.CONFIG_ERROR, "缺少站点地址");
  }

  if (!account.userId) {
    return buildAccountResult(account, CHECKIN_STATUS.CONFIG_ERROR, "缺少用户 ID");
  }

  try {
    await applyConfiguredCookies(account.baseUrl, account.cookie);

    const { statusCode, data } = await requestJson(
      "POST",
      `${account.baseUrl}/api/user/sign_in`,
      {
        Accept: "application/json",
        "Content-Type": "application/json",
        Pragma: "no-cache",
        "X-Requested-With": "XMLHttpRequest",
        ...buildCompatUserIdHeaders(account.userId)
      },
      "{}"
    );

    if (statusCode < 200 || statusCode >= 300) {
      return buildAccountResult(account, CHECKIN_STATUS.FAILED, `签到失败，HTTP ${statusCode}: ${JSON.stringify(data)}`);
    }

    const rawMessage = normalizeCheckinMessage(data.message);
    const lowered = rawMessage.toLowerCase();

    if (!data.success) {
      return buildAccountResult(
        account,
        isAlreadyCheckedMessage(rawMessage) ? CHECKIN_STATUS.ALREADY_CHECKED : CHECKIN_STATUS.FAILED,
        rawMessage || "签到失败",
        { rawMessage, data }
      );
    }

    if (lowered.includes("success") || rawMessage.includes("签到成功")) {
      return buildAccountResult(account, CHECKIN_STATUS.SUCCESS, rawMessage || "签到成功", {
        rawMessage,
        data
      });
    }

    if (isAlreadyCheckedMessage(rawMessage)) {
      return buildAccountResult(account, CHECKIN_STATUS.ALREADY_CHECKED, rawMessage || "今天已经签到过了", {
        rawMessage,
        data
      });
    }

    return buildAccountResult(account, CHECKIN_STATUS.FAILED, rawMessage || "签到失败", {
      rawMessage,
      data
    });
  } catch (error) {
    const message = error?.message || String(error);
    return buildAccountResult(
      account,
      isAlreadyCheckedMessage(message) ? CHECKIN_STATUS.ALREADY_CHECKED : CHECKIN_STATUS.FAILED,
      message
    );
  }
}

function resolveProvider(account) {
  if (account.siteType === SITE_TYPES.ANYROUTER) {
    return runAnyRouterProvider;
  }
  if (account.siteType === SITE_TYPES.NEW_API) {
    return runNewApiProvider;
  }
  return null;
}

async function runAccountCheckin(account) {
  if (!account.enabled) {
    return buildAccountResult(account, CHECKIN_STATUS.SKIPPED, "账号已停用");
  }

  if (account.autoCheckinEnabled === false) {
    return buildAccountResult(account, CHECKIN_STATUS.SKIPPED, "账号未启用自动签到");
  }

  const provider = resolveProvider(account);
  if (!provider) {
    return buildAccountResult(account, CHECKIN_STATUS.SKIPPED, "当前站点类型暂不支持自动签到");
  }

  return provider(account);
}

async function migrateLegacyData() {
  const local = await chrome.storage.local.get([
    STORAGE_KEYS.ACCOUNTS,
    STORAGE_KEYS.MIGRATION_STATE
  ]);
  const sync = await chrome.storage.sync.get([
    STORAGE_KEYS.LEGACY_NEW_API_CONFIG,
    STORAGE_KEYS.LEGACY_SCHEDULE_TIME,
    STORAGE_KEYS.AUTO_CHECKIN_SETTINGS
  ]);

  let accounts = normalizeAccounts(local[STORAGE_KEYS.ACCOUNTS]);

  if (!accounts.length) {
    const legacyConfig = sync[STORAGE_KEYS.LEGACY_NEW_API_CONFIG] || {};
    const legacySites = Array.isArray(legacyConfig.sites)
      ? legacyConfig.sites
      : legacyConfig.baseUrl
        ? [legacyConfig]
        : [];

    accounts = legacySites
      .map((site, index) => normalizeAccount({
        id: site.id ? `account-${site.id}` : createId("account"),
        enabled: site.enabled !== false,
        name: site.name || "",
        siteType: SITE_TYPES.NEW_API,
        baseUrl: site.baseUrl,
        authType: AUTH_TYPES.ACCESS_TOKEN,
        userId: site.userId,
        accessToken: site.accessToken,
        cookie: site.cookie,
        turnstileToken: site.turnstileToken,
        autoCheckinEnabled: site.enabled !== false
      }, index))
      .filter((account) => account.baseUrl);

    if (accounts.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.ACCOUNTS]: accounts });
    }
  }

  if (!sync[STORAGE_KEYS.AUTO_CHECKIN_SETTINGS]) {
    const legacyConfig = sync[STORAGE_KEYS.LEGACY_NEW_API_CONFIG] || {};
    const settings = normalizeSettings({
      enabled: Boolean(legacyConfig.enabled)
    }, sync[STORAGE_KEYS.LEGACY_SCHEDULE_TIME] || DEFAULTS.scheduleTime);
    await chrome.storage.sync.set({ [STORAGE_KEYS.AUTO_CHECKIN_SETTINGS]: settings });
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.MIGRATION_STATE]: {
      ...local[STORAGE_KEYS.MIGRATION_STATE],
      accountsV2: true,
      updatedAt: new Date().toISOString()
    }
  });
}

async function getAccounts() {
  await migrateLegacyData();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.ACCOUNTS);
  const accounts = normalizeAccounts(stored[STORAGE_KEYS.ACCOUNTS]);
  if (accounts.length !== (stored[STORAGE_KEYS.ACCOUNTS] || []).length) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ACCOUNTS]: accounts });
  }
  return accounts;
}

async function saveAccounts(accounts) {
  const normalized = normalizeAccounts(accounts);
  await chrome.storage.local.set({ [STORAGE_KEYS.ACCOUNTS]: normalized });
  return normalized;
}

async function upsertAccount(input) {
  const accounts = await getAccounts();
  const nowIso = new Date().toISOString();
  const normalized = normalizeAccount({
    ...input,
    id: input.id || createId("account"),
    createdAt: input.createdAt || nowIso,
    updatedAt: nowIso
  });
  const existingIndex = accounts.findIndex((account) => account.id === normalized.id);

  if (existingIndex >= 0) {
    accounts.splice(existingIndex, 1, {
      ...accounts[existingIndex],
      ...normalized,
      createdAt: accounts[existingIndex].createdAt || normalized.createdAt,
      updatedAt: nowIso
    });
  } else {
    accounts.push(normalized);
  }

  await saveAccounts(accounts);
  return normalized;
}

async function deleteAccount(accountId) {
  const accounts = await getAccounts();
  await saveAccounts(accounts.filter((account) => account.id !== accountId));

  const status = await getAutoCheckinStatus();
  if (status?.perAccount?.[accountId]) {
    const nextPerAccount = { ...status.perAccount };
    delete nextPerAccount[accountId];
    await saveAutoCheckinStatus({
      ...status,
      perAccount: nextPerAccount,
      summary: summarizeResults(Object.values(nextPerAccount))
    });
  }
}

async function getAutoCheckinSettings() {
  const sync = await chrome.storage.sync.get([
    STORAGE_KEYS.AUTO_CHECKIN_SETTINGS,
    STORAGE_KEYS.LEGACY_SCHEDULE_TIME
  ]);
  return normalizeSettings(
    sync[STORAGE_KEYS.AUTO_CHECKIN_SETTINGS],
    sync[STORAGE_KEYS.LEGACY_SCHEDULE_TIME] || DEFAULTS.scheduleTime
  );
}

async function saveAutoCheckinSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.sync.set({ [STORAGE_KEYS.AUTO_CHECKIN_SETTINGS]: normalized });
  await scheduleAutoCheckinDaily();
  return normalized;
}

async function getAutoCheckinStatus() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.AUTO_CHECKIN_STATUS);
  return stored[STORAGE_KEYS.AUTO_CHECKIN_STATUS] || null;
}

async function saveAutoCheckinStatus(status) {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_CHECKIN_STATUS]: status });
  await recordLegacyCheckinResult(status);
}

async function patchAutoCheckinStatus(patch) {
  const current = await getAutoCheckinStatus();
  await saveAutoCheckinStatus({
    ...(current || {}),
    ...patch
  });
}

async function recordLegacyCheckinResult(status) {
  if (!status?.summary) {
    return;
  }

  const legacyStatus = status.lastRunResult === "success"
    ? "CHECKED_IN"
    : status.lastRunResult === "partial"
      ? "PARTIAL_SUCCESS"
      : status.lastRunResult === "skipped"
        ? "DISABLED"
        : "API_ERROR";

  await chrome.storage.local.set({
    [STORAGE_KEYS.LEGACY_LAST_CHECKIN_RESULT]: {
      status: legacyStatus,
      message: `${status.summary.successCount}/${status.summary.totalEligible} 个账号签到成功`,
      checkedAt: status.lastRunAt,
      trigger: status.trigger,
      successCount: status.summary.successCount,
      targetCount: status.summary.totalEligible,
      results: Object.values(status.perAccount || {})
    }
  });
}

function getFailedAccountIds(status) {
  return Object.values(status?.perAccount || {})
    .filter((result) => result.status === CHECKIN_STATUS.FAILED)
    .map((result) => result.accountId);
}

async function runAutoCheckin(options = {}) {
  await migrateLegacyData();

  const trigger = options.trigger || "manual";
  const settings = await getAutoCheckinSettings();
  const accounts = await getAccounts();
  const previousStatus = await getAutoCheckinStatus();
  const today = getTodayKey();
  let targetIds = Array.isArray(options.accountIds) ? options.accountIds : null;

  if (options.retryOnly) {
    const retryState = previousStatus?.retryState?.day === today
      ? previousStatus.retryState
      : { day: today, pendingAccountIds: getFailedAccountIds(previousStatus), attemptsByAccount: {} };

    targetIds = (retryState.pendingAccountIds || []).filter((accountId) => {
      const attempts = Number(retryState.attemptsByAccount?.[accountId] || 0);
      return attempts < settings.maxRetryPerDay;
    });
  }

  const targetAccounts = targetIds
    ? accounts.filter((account) => targetIds.includes(account.id))
    : accounts;

  const results = [];
  for (const account of targetAccounts) {
    results.push(await runAccountCheckin(account));
  }

  const perAccount = (options.retryOnly || targetIds)
    ? { ...(previousStatus?.perAccount || {}) }
    : {};
  for (const result of results) {
    perAccount[result.accountId] = result;
  }

  const summary = summarizeResults(Object.values(perAccount));
  const failedAccountIds = getFailedAccountIds({ perAccount });
  const previousRetryState = previousStatus?.retryState?.day === today
    ? previousStatus.retryState
    : { day: today, pendingAccountIds: [], attemptsByAccount: {} };
  const attemptsByAccount = { ...(previousRetryState.attemptsByAccount || {}) };

  if (options.retryOnly) {
    for (const result of results) {
      if (result.status === CHECKIN_STATUS.FAILED) {
        attemptsByAccount[result.accountId] = Number(attemptsByAccount[result.accountId] || 0) + 1;
      }
    }
  }

  const pendingAccountIds = failedAccountIds.filter((accountId) => (
    Number(attemptsByAccount[accountId] || 0) < settings.maxRetryPerDay
  ));

  const nextStatus = {
    lastRunAt: new Date().toISOString(),
    trigger,
    lastRunResult: getRunResult(summary),
    summary,
    perAccount,
    accountsSnapshot: accounts.map((account) => ({
      accountId: account.id,
      accountName: account.name || account.baseUrl,
      siteType: account.siteType,
      enabled: account.enabled,
      autoCheckinEnabled: account.autoCheckinEnabled !== false,
      lastResult: perAccount[account.id] || null
    })),
    retryState: {
      day: today,
      pendingAccountIds,
      attemptsByAccount
    },
    nextDailyRunAt: previousStatus?.nextDailyRunAt || null,
    nextRetryRunAt: previousStatus?.nextRetryRunAt || null
  };

  await saveAutoCheckinStatus(nextStatus);

  if (options.markDailyRun) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_AUTO_CHECKIN_DAILY_RUN_DAY]: today });
  }

  if (settings.retryEnabled && pendingAccountIds.length) {
    await scheduleRetryAlarm(settings.retryIntervalMinutes);
  } else {
    await clearRetryAlarm();
  }

  return nextStatus;
}

function makeDateForMinutes(minutes, dayOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

async function getNextAutoCheckinDate(settings) {
  const startMinutes = parseTimeMinutes(settings.windowStart) ?? parseTimeMinutes(DEFAULTS.windowStart);
  let endMinutes = parseTimeMinutes(settings.windowEnd) ?? parseTimeMinutes(DEFAULTS.windowEnd);
  if (endMinutes <= startMinutes) {
    endMinutes = startMinutes + 30;
  }

  const now = new Date();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_AUTO_CHECKIN_DAILY_RUN_DAY);
  const ranToday = stored[STORAGE_KEYS.LAST_AUTO_CHECKIN_DAILY_RUN_DAY] === getTodayKey();
  const todayEnd = makeDateForMinutes(Math.min(endMinutes, 1439));
  const runToday = !ranToday && now < todayEnd;
  const baseStart = makeDateForMinutes(startMinutes, runToday ? 0 : 1);
  const baseEnd = makeDateForMinutes(Math.min(endMinutes, 1439), runToday ? 0 : 1);
  const minTime = Math.max(baseStart.getTime(), now.getTime() + 60 * 1000);
  const maxTime = Math.max(baseEnd.getTime(), minTime + 60 * 1000);

  return new Date(minTime + Math.floor(Math.random() * (maxTime - minTime)));
}

async function scheduleAutoCheckinDaily() {
  const settings = await getAutoCheckinSettings();
  await chrome.alarms.clear(AUTO_DAILY_ALARM_NAME);

  if (!settings.enabled) {
    await patchAutoCheckinStatus({ nextDailyRunAt: null });
    return null;
  }

  const nextDate = await getNextAutoCheckinDate(settings);
  await chrome.alarms.create(AUTO_DAILY_ALARM_NAME, { when: nextDate.getTime() });
  await patchAutoCheckinStatus({ nextDailyRunAt: nextDate.toISOString() });
  return nextDate;
}

async function scheduleRetryAlarm(delayMinutes) {
  await chrome.alarms.clear(AUTO_RETRY_ALARM_NAME);
  await chrome.alarms.create(AUTO_RETRY_ALARM_NAME, { delayInMinutes: delayMinutes });
  const nextRetryRunAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
  await patchAutoCheckinStatus({ nextRetryRunAt });
}

async function clearRetryAlarm() {
  await chrome.alarms.clear(AUTO_RETRY_ALARM_NAME);
  await patchAutoCheckinStatus({ nextRetryRunAt: null });
}

async function maybeCatchUpAutoCheckin() {
  const settings = await getAutoCheckinSettings();
  if (!settings.enabled) {
    return;
  }

  const startMinutes = parseTimeMinutes(settings.windowStart);
  let endMinutes = parseTimeMinutes(settings.windowEnd);
  if (startMinutes === null) {
    return;
  }
  if (endMinutes === null || endMinutes <= startMinutes) {
    endMinutes = startMinutes + 30;
  }

  const now = new Date();
  const todayEnd = makeDateForMinutes(Math.min(endMinutes, 1439));
  const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_AUTO_CHECKIN_DAILY_RUN_DAY);
  const ranToday = stored[STORAGE_KEYS.LAST_AUTO_CHECKIN_DAILY_RUN_DAY] === getTodayKey();

  if (!ranToday && now > todayEnd) {
    await runAutoCheckin({ trigger: "catch-up", markDailyRun: true });
    await scheduleAutoCheckinDaily();
  }
}

async function getScheduledOpenTime() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.LEGACY_SCHEDULE_TIME);
  return stored[STORAGE_KEYS.LEGACY_SCHEDULE_TIME] || DEFAULTS.scheduleTime;
}

function getNextOpenTriggerDate(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const randomDelayMs = Math.floor(Math.random() * 30 * 60 * 1000);
  return new Date(next.getTime() + randomDelayMs);
}

async function scheduleOpenAlarm() {
  const timeString = await getScheduledOpenTime();
  const nextTrigger = getNextOpenTriggerDate(timeString);
  await chrome.alarms.clear(LEGACY_OPEN_ALARM_NAME);
  await chrome.alarms.clear(OPEN_ALARM_NAME);
  await chrome.alarms.create(OPEN_ALARM_NAME, { when: nextTrigger.getTime() });
}

function hasScheduledOpenTimePassed(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  return now >= scheduled;
}

function isTodayDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && getTodayKey(date) === getTodayKey();
}

function normalizePathname(pathname) {
  const normalized = pathname || "/";
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function isMatchingTargetUrl(existingUrl, targetUrl) {
  if (!existingUrl) return false;

  let existing;
  let target;
  try {
    existing = new URL(existingUrl);
    target = new URL(targetUrl);
  } catch (error) {
    return false;
  }

  if (existing.origin !== target.origin) {
    return false;
  }

  const existingPathname = normalizePathname(existing.pathname);
  const targetPathname = normalizePathname(target.pathname);

  if (target.hostname === "linux.do") {
    return true;
  }

  if (target.hostname === "anyrouter.top") {
    return existingPathname === targetPathname || existingPathname.startsWith(`${targetPathname}/`);
  }

  if (existingPathname !== targetPathname) {
    return false;
  }

  for (const [name, value] of target.searchParams.entries()) {
    if (existing.searchParams.get(name) !== value) {
      return false;
    }
  }

  return true;
}

async function getExistingTargetTabs() {
  const tabs = await chrome.tabs.query({});
  return TARGET_URLS.map((targetUrl) => (
    tabs.find((tab) => isMatchingTargetUrl(tab.url, targetUrl)) || null
  ));
}

async function getExistingNormalWindowId() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const focusedWindow = windows.find((item) => item.focused);
  const targetWindow = focusedWindow || windows[0];
  return targetWindow?.id;
}

async function openTargetUrls() {
  const failures = [];
  let successCount = 0;
  let existingCount = 0;
  let windowId;
  let startIndex = 0;
  const existingTargetTabs = await getExistingTargetTabs();

  try {
    windowId = await getExistingNormalWindowId();

    if (!windowId) {
      if (existingTargetTabs[0]) {
        windowId = existingTargetTabs[0].windowId;
        existingCount += 1;
      } else {
        const createdWindow = await chrome.windows.create({ url: TARGET_URLS[0], focused: true });
        windowId = createdWindow.id;
        successCount += 1;
      }
      startIndex = 1;
    }
  } catch (error) {
    failures.push({ url: TARGET_URLS[0], message: error?.message || String(error) });
    startIndex = 1;
  }

  for (let index = startIndex; index < TARGET_URLS.length; index += 1) {
    if (existingTargetTabs[index]) {
      existingCount += 1;
      continue;
    }

    try {
      const createProperties = { url: TARGET_URLS[index], active: index === 0 };
      if (typeof windowId === "number") {
        createProperties.windowId = windowId;
      }
      await chrome.tabs.create(createProperties);
      successCount += 1;
    } catch (error) {
      failures.push({ url: TARGET_URLS[index], message: error?.message || String(error) });
    }
  }

  return {
    targetCount: TARGET_URLS.length,
    successCount,
    existingCount,
    failureCount: failures.length,
    failures
  };
}

async function recordOpenResult(trigger, result) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.LAST_OPEN_RESULT]: {
      ...result,
      trigger,
      openedAt: new Date().toISOString()
    }
  });
}

async function markOpenedToday() {
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_OPENED_DATE]: getTodayKey() });
}

async function hasOpenedToday() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.LAST_OPENED_DATE,
    STORAGE_KEYS.LAST_OPEN_RESULT
  ]);

  return stored[STORAGE_KEYS.LAST_OPENED_DATE] === getTodayKey() ||
    isTodayDate(stored[STORAGE_KEYS.LAST_OPEN_RESULT]?.openedAt);
}

async function maybeCatchUpOpen() {
  const timeString = await getScheduledOpenTime();
  const openedToday = await hasOpenedToday();
  if (openedToday || !hasScheduledOpenTimePassed(timeString)) {
    return;
  }

  const result = await openTargetUrls();
  await recordOpenResult("catch-up", result);

  if (result.successCount > 0 || result.existingCount > 0) {
    await markOpenedToday();
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractUser(data) {
  const value = data?.data && typeof data.data === "object" ? data.data : data;
  const user = value?.user && typeof value.user === "object" ? value.user : value;
  if (!user || typeof user !== "object") {
    return {};
  }
  return {
    userId: user.id ?? user.user_id ?? user.userId ?? user.uid ?? value.userId ?? "",
    username: user.username || user.name || user.display_name || user.email || value.username || "",
    accessToken: user.auth_token || user.access_token || user.accessToken || user.token || value.auth_token || value.access_token || value.accessToken || ""
  };
}

function extractAccessToken(data) {
  if (typeof data === "string") {
    return data.trim();
  }
  const value = data?.data !== undefined ? data.data : data;
  if (typeof value === "string") {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return String(
    value.auth_token ||
    value.access_token ||
    value.accessToken ||
    value.token ||
    value.key ||
    ""
  ).trim();
}

async function fetchNewApiAccessToken(baseUrl, accessToken) {
  const headers = { Accept: "application/json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const { statusCode, data } = await requestJson("GET", `${baseUrl}/api/user/token`, headers);
    if (statusCode >= 200 && statusCode < 300) {
      return extractAccessToken(data);
    }
  } catch (error) {
    return "";
  }

  return "";
}

async function detectViaDirectApi(baseUrl, accessToken, siteType) {
  const headers = { Accept: "application/json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const { statusCode, data } = await requestJson("GET", `${baseUrl}/api/user/self`, headers);
    if (statusCode >= 200 && statusCode < 300) {
      const user = extractUser(data);
      if (!user.accessToken && siteType === SITE_TYPES.NEW_API) {
        user.accessToken = await fetchNewApiAccessToken(baseUrl, accessToken);
      }
      return user;
    }
  } catch (error) {
    return {};
  }

  return {};
}

async function getActiveTabForUrl(baseUrl) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab?.id || !activeTab.url) {
    return null;
  }

  try {
    const activeOrigin = new URL(activeTab.url).origin;
    const targetOrigin = new URL(baseUrl).origin;
    return activeOrigin === targetOrigin ? activeTab : null;
  } catch (error) {
    return null;
  }
}

async function detectFromContentScript(baseUrl) {
  const tab = await getActiveTabForUrl(baseUrl);
  if (!tab?.id) {
    return { data: {}, unavailable: false };
  }

  const request = {
    type: AUTO_DETECT_MESSAGE_TYPE,
    baseUrl
  };

  try {
    const response = await chrome.tabs.sendMessage(tab.id, request);
    return {
      data: response?.data || {},
      unavailable: false,
      apiStatus: response?.apiStatus
    };
  } catch (error) {
    const initialError = error;
    if (chrome.scripting?.executeScript) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        const response = await chrome.tabs.sendMessage(tab.id, request);
        return {
          data: response?.data || {},
          unavailable: false,
          apiStatus: response?.apiStatus
        };
      } catch (retryError) {
        return {
          data: {},
          unavailable: true,
          error: retryError?.message || initialError?.message || String(retryError || initialError)
        };
      }
    }

    return {
      data: {},
      unavailable: true,
      error: initialError?.message || String(initialError)
    };
  }
}

async function detectAccount(input = {}) {
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeUrl = activeTabs[0]?.url || "";
  const baseUrl = normalizeBaseUrl(input.baseUrl || activeUrl);
  if (!baseUrl) {
    throw new Error("请先填写站点地址，或打开目标站点后再自动识别。");
  }

  const siteType = isKnownSiteType(input.siteType)
    ? input.siteType
    : detectSiteType(baseUrl, SITE_TYPES.NEW_API);
  const contentResult = await detectFromContentScript(baseUrl);
  const directUser = await detectViaDirectApi(baseUrl, contentResult.data.accessToken, siteType);
  const cookie = await getCookieHeader(baseUrl);
  const merged = {
    userId: directUser.userId !== undefined && directUser.userId !== null && String(directUser.userId) !== ""
      ? directUser.userId
      : contentResult.data.userId,
    username: directUser.username || contentResult.data.username || "",
    accessToken: directUser.accessToken || contentResult.data.accessToken || ""
  };
  const accessToken = String(merged.accessToken || "");
  const resolvedAuthType = isKnownAuthType(input.authType)
    ? accessToken
      ? AUTH_TYPES.ACCESS_TOKEN
      : input.authType
    : siteType === SITE_TYPES.ANYROUTER
      ? accessToken
        ? AUTH_TYPES.ACCESS_TOKEN
        : AUTH_TYPES.COOKIE
      : merged.accessToken
        ? AUTH_TYPES.ACCESS_TOKEN
        : getDefaultAuthType(siteType, baseUrl);

  if (!merged.userId && !merged.username && !merged.accessToken && !cookie) {
    if (contentResult.unavailable) {
      throw new Error("当前目标页面还不能响应自动识别，请刷新目标站点页面后重试。");
    }
    throw new Error("未识别到账号信息，请确认已在目标站点登录。");
  }

  return {
    siteType,
    authType: resolvedAuthType,
    baseUrl,
    name: input.name || new URL(baseUrl).hostname,
    username: String(merged.username || ""),
    userId: merged.userId === undefined || merged.userId === null ? "" : String(merged.userId),
    accessToken,
    cookie
  };
}

async function getState() {
  await migrateLegacyData();
  const [accounts, settings, status, local, sync] = await Promise.all([
    getAccounts(),
    getAutoCheckinSettings(),
    getAutoCheckinStatus(),
    chrome.storage.local.get(STORAGE_KEYS.LAST_OPEN_RESULT),
    chrome.storage.sync.get(STORAGE_KEYS.LEGACY_SCHEDULE_TIME)
  ]);

  return {
    accounts,
    autoCheckinSettings: settings,
    autoCheckinStatus: status,
    lastOpenResult: local[STORAGE_KEYS.LAST_OPEN_RESULT] || null,
    scheduleTime: sync[STORAGE_KEYS.LEGACY_SCHEDULE_TIME] || DEFAULTS.scheduleTime
  };
}

async function ensureDefaults() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.LEGACY_SCHEDULE_TIME);
  if (!stored[STORAGE_KEYS.LEGACY_SCHEDULE_TIME]) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.LEGACY_SCHEDULE_TIME]: DEFAULTS.scheduleTime });
  }
  await migrateLegacyData();
}

async function initialize() {
  await ensureDefaults();
  await clearNewApiHeaderRule();
  await scheduleOpenAlarm();
  await scheduleAutoCheckinDaily();
}

chrome.runtime.onInstalled.addListener(async () => {
  await initialize();
  await maybeCatchUpOpen();
  await maybeCatchUpAutoCheckin();
});

chrome.runtime.onStartup.addListener(async () => {
  await initialize();
  await delay(STARTUP_CATCH_UP_DELAY_MS);
  await maybeCatchUpOpen();
  await maybeCatchUpAutoCheckin();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === OPEN_ALARM_NAME || alarm.name === LEGACY_OPEN_ALARM_NAME) {
    const result = await openTargetUrls();
    await recordOpenResult("alarm", result);
    if (result.successCount > 0 || result.existingCount > 0) {
      await markOpenedToday();
    }
    await scheduleOpenAlarm();
    return;
  }

  if (alarm.name === AUTO_DAILY_ALARM_NAME) {
    await runAutoCheckin({ trigger: "alarm", markDailyRun: true });
    await scheduleAutoCheckinDaily();
    return;
  }

  if (alarm.name === AUTO_RETRY_ALARM_NAME) {
    await runAutoCheckin({ trigger: "retry", retryOnly: true });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const knownTypes = new Set([
    "get-state",
    "save-account",
    "delete-account",
    "save-auto-checkin-settings",
    "save-open-settings",
    "run-auto-checkin",
    "detect-account",
    "open-account-site",
    "run-new-api-checkin"
  ]);

  if (!knownTypes.has(message?.type)) {
    return false;
  }

  (async () => {
    switch (message?.type) {
      case "get-state":
        return { ok: true, state: await getState() };
      case "save-account":
        return { ok: true, account: await upsertAccount(message.account || {}) };
      case "delete-account":
        await deleteAccount(message.accountId);
        return { ok: true };
      case "save-auto-checkin-settings":
        return { ok: true, settings: await saveAutoCheckinSettings(message.settings || {}) };
      case "save-open-settings":
        await chrome.storage.sync.set({ [STORAGE_KEYS.LEGACY_SCHEDULE_TIME]: message.scheduleTime || DEFAULTS.scheduleTime });
        await scheduleOpenAlarm();
        await maybeCatchUpOpen();
        return { ok: true };
      case "run-auto-checkin":
        return { ok: true, status: await runAutoCheckin(message.options || { trigger: "manual" }) };
      case "detect-account":
        return { ok: true, data: await detectAccount(message.input || {}) };
      case "open-account-site":
        await chrome.tabs.create({ url: message.url, active: true });
        return { ok: true };
      case "run-new-api-checkin":
        return { ok: true, result: await runAutoCheckin({ trigger: "manual" }) };
    }
  })()
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || String(error)
      });
    });

  return true;
});

async function openSidePanelFromAction(tab) {
  if (!chrome.sidePanel?.open) {
    return false;
  }

  const options = tab?.windowId ? { windowId: tab.windowId } : {};
  await chrome.sidePanel.open(options);
  return true;
}

chrome.action.onClicked.addListener((tab) => {
  (async () => {
    try {
      if (await openSidePanelFromAction(tab)) {
        return;
      }
    } catch (error) {
      console.warn("Failed to open side panel, falling back to options page.", error);
    }

    await chrome.runtime.openOptionsPage();
  })();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "sync") {
    if (changes[STORAGE_KEYS.LEGACY_SCHEDULE_TIME]) {
      await scheduleOpenAlarm();
    }
    if (changes[STORAGE_KEYS.AUTO_CHECKIN_SETTINGS]) {
      await scheduleAutoCheckinDaily();
    }
  }
});
