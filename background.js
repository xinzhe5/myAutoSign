const STORAGE_KEY = "scheduleTime";
const LAST_OPENED_KEY = "lastOpenedDate";
const LAST_OPEN_RESULT_KEY = "lastOpenResult";
const NEW_API_CONFIG_KEY = "newApiCheckinConfig";
const LAST_CHECKIN_DATE_KEY = "lastNewApiCheckinDate";
const LAST_CHECKIN_RESULT_KEY = "lastNewApiCheckinResult";
const ALARM_NAME = "open-linuxdo-daily";
const NEW_API_HEADER_RULE_ID = 100;
const TARGET_URLS = [
  "https://linux.do/?tl=en",
  "https://anyrouter.top/console"
];
const PROTECTED_TARGET_HOSTS = new Set(
  TARGET_URLS.map((url) => new URL(url).hostname)
);
const DEFAULT_TIME = "09:00";
const RANDOM_WINDOW_MINUTES = 30;
const STARTUP_CATCH_UP_DELAY_MS = 3000;
const DEFAULT_QUOTA_PER_UNIT = 500000;
const DEFAULT_QUOTA_DISPLAY_TYPE = "USD";
const DEFAULT_USD_EXCHANGE_RATE = 1;
const DEFAULT_CUSTOM_CURRENCY_SYMBOL = "¤";
const DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE = 1;

async function getScheduledTime() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || DEFAULT_TIME;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

async function getNewApiConfig() {
  const stored = await chrome.storage.sync.get(NEW_API_CONFIG_KEY);
  const config = stored[NEW_API_CONFIG_KEY] || {};
  const rawSites = Array.isArray(config.sites)
    ? config.sites
    : config.baseUrl
      ? [config]
      : [];
  const sites = rawSites
    .map((site, index) => ({
      id: String(site.id || `site-${index + 1}`),
      enabled: site.enabled !== false,
      name: String(site.name || "").trim(),
      baseUrl: normalizeBaseUrl(site.baseUrl),
      accessToken: String(site.accessToken || "").trim(),
      userId: String(site.userId || "").trim(),
      turnstileToken: String(site.turnstileToken || "").trim(),
      cookie: String(site.cookie || "").trim()
    }))
    .filter((site) => site.baseUrl);

  return {
    enabled: Boolean(config.enabled),
    sites
  };
}

function getNextTriggerDate(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);

  next.setHours(hours, minutes, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function getRandomDelayMs() {
  return Math.floor(Math.random() * RANDOM_WINDOW_MINUTES * 60 * 1000);
}

async function scheduleAlarm() {
  const timeString = await getScheduledTime();
  const baseTrigger = getNextTriggerDate(timeString);
  const nextTrigger = new Date(baseTrigger.getTime() + getRandomDelayMs());

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    when: nextTrigger.getTime()
  });
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildJsonResult(status, message, extra = {}) {
  return {
    status,
    message,
    checkedAt: new Date().toISOString(),
    ...extra
  };
}

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
    const rate = Number(
      statusData?.custom_currency_exchange_rate || DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE
    );
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

      if (separatorIndex <= 0) {
        return null;
      }

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

function buildNewApiHeaders(config) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (config.accessToken) {
    headers.Authorization = `Bearer ${config.accessToken}`;
  }

  if (config.userId) {
    headers["New-Api-User"] = config.userId;
  }

  return headers;
}

async function configureNewApiHeaderRule(baseUrl) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  const origin = new URL(baseUrl).origin;
  const host = new URL(baseUrl).host;

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

function isProtectedTargetHost(baseUrl) {
  try {
    return PROTECTED_TARGET_HOSTS.has(new URL(baseUrl).hostname);
  } catch (error) {
    return false;
  }
}

function formatNonJsonError(body) {
  const snippet = body.trim().replace(/\s+/g, " ").slice(0, 300);
  const lowered = body.toLowerCase();

  if (lowered.includes("error code: 1010") || lowered.includes("cloudflare")) {
    return `请求被站点前面的 Cloudflare/WAF 拦截，请求尚未到达 new-api。片段: ${snippet}`;
  }

  return `接口返回的不是合法 JSON: ${snippet}`;
}

async function requestNewApiJson(method, url, headers) {
  let response;
  let body;

  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "include"
    });
    body = await response.text();
  } catch (error) {
    throw new Error(`请求失败: ${error?.message || String(error)}`);
  }

  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch (error) {
    throw new Error(formatNonJsonError(body));
  }

  return {
    statusCode: response.status,
    data
  };
}

async function tryGetStatus(baseUrl, headers) {
  try {
    const { statusCode, data } = await requestNewApiJson("GET", `${baseUrl}/api/status`, headers);

    if (statusCode !== 200) {
      return {};
    }

    return data.data || data;
  } catch (error) {
    return {};
  }
}

async function getSelf(baseUrl, headers) {
  const { statusCode, data } = await requestNewApiJson("GET", `${baseUrl}/api/user/self`, headers);

  if (statusCode !== 200) {
    throw new Error(`查询用户信息失败，HTTP ${statusCode}: ${JSON.stringify(data)}`);
  }

  if (!data.success) {
    throw new Error(`查询用户信息失败: ${data.message || JSON.stringify(data)}`);
  }

  return data.data || {};
}

async function getCheckinStatus(baseUrl, headers) {
  const { statusCode, data } = await requestNewApiJson("GET", `${baseUrl}/api/user/checkin`, headers);

  if (statusCode !== 200) {
    throw new Error(`查询签到状态失败，HTTP ${statusCode}: ${JSON.stringify(data)}`);
  }

  if (!data.success) {
    throw new Error(`查询签到状态失败: ${data.message || JSON.stringify(data)}`);
  }

  return data.data || {};
}

async function doCheckin(baseUrl, headers, turnstileToken) {
  let url = `${baseUrl}/api/user/checkin`;

  if (turnstileToken) {
    url = `${url}?${new URLSearchParams({ turnstile: turnstileToken })}`;
  }

  const { statusCode, data } = await requestNewApiJson("POST", url, headers);

  if (statusCode !== 200) {
    throw new Error(`执行签到失败，HTTP ${statusCode}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function recordNewApiCheckinResult(result) {
  const values = {
    [LAST_CHECKIN_RESULT_KEY]: result
  };

  if (result.status === "CHECKED_IN" || result.status === "ALREADY_CHECKED_IN") {
    values[LAST_CHECKIN_DATE_KEY] = getTodayKey();
  }

  await chrome.storage.local.set(values);
}

async function runSingleNewApiCheckin(site, trigger) {
  const missing = [];
  if (!site.baseUrl) missing.push("BASE_URL");

  if (missing.length) {
    return buildJsonResult("CONFIG_ERROR", `缺少配置: ${missing.join(", ")}`, {
      trigger,
      siteName: site.name,
      baseUrl: site.baseUrl
    });
  }

  if (isProtectedTargetHost(site.baseUrl)) {
    return buildJsonResult(
      "CONFIG_ERROR",
      "该地址是自动打开目标，不应作为 new-api 签到站点；为避免覆盖站点登录 Cookie 已跳过",
      {
        trigger,
        siteName: site.name,
        baseUrl: site.baseUrl
      }
    );
  }

  const headers = buildNewApiHeaders(site);

  try {
    await configureNewApiHeaderRule(site.baseUrl);
    await applyConfiguredCookies(site.baseUrl, site.cookie);

    const statusData = await tryGetStatus(site.baseUrl, headers);
    const displayType = getDisplayType(statusData);
    const selfData = await getSelf(site.baseUrl, headers);
    const current = await getCheckinStatus(site.baseUrl, headers);
    const stats = current.stats || {};
    const currentQuota = formatDisplayQuota(selfData.quota, statusData, 6);
    const rewardTotal = formatDisplayQuota(stats.total_quota, statusData, 6);
    const totalCheckins = stats.total_checkins || "";

    if (stats.checked_in_today) {
      const result = buildJsonResult("ALREADY_CHECKED_IN", "今天已经签到过了", {
        trigger,
        siteName: site.name,
        baseUrl: site.baseUrl,
        totalCheckins,
        rewardTotal,
        currentQuota,
        displayType
      });
      return result;
    }

    const checkinResult = await doCheckin(site.baseUrl, headers, site.turnstileToken);

    if (!checkinResult.success) {
      const apiMessage = checkinResult.message || JSON.stringify(checkinResult);
      const result = buildJsonResult(
        apiMessage.includes("Turnstile token 为空") ? "TURNSTILE_REQUIRED" : "API_ERROR",
        apiMessage.includes("Turnstile token 为空")
          ? "站点开启了 Turnstile，需要提供 turnstile token"
          : `签到失败: ${apiMessage}`,
        {
          trigger,
          siteName: site.name,
          baseUrl: site.baseUrl,
          totalCheckins,
          rewardTotal,
          currentQuota,
          displayType
        }
      );
      return result;
    }

    const data = checkinResult.data || {};
    const selfAfter = await getSelf(site.baseUrl, headers);
    const quotaAwarded = Number(data.quota_awarded || 0);
    const result = buildJsonResult("CHECKED_IN", checkinResult.message || "签到成功", {
      trigger,
      siteName: site.name,
      baseUrl: site.baseUrl,
      checkinDate: String(data.checkin_date || ""),
      totalCheckins: String(Number(stats.total_checkins || 0) + 1),
      rewardToday: formatDisplayQuota(quotaAwarded, statusData, 6),
      rewardTotal: formatDisplayQuota(Number(stats.total_quota || 0) + quotaAwarded, statusData, 6),
      currentQuota: formatDisplayQuota(selfAfter.quota, statusData, 6),
      displayType
    });
    return result;
  } catch (error) {
    let message = error?.message || String(error);
    let status = "ERROR";

    if (message.includes("签到功能未启用")) {
      status = "CHECKIN_DISABLED";
    } else if (message.includes("Turnstile token 为空")) {
      status = "TURNSTILE_REQUIRED";
      message = "站点开启了 Turnstile，需要提供 turnstile token";
    } else if (message.includes("签到失败") || message.includes("查询") || message.includes("请求失败")) {
      status = "API_ERROR";
    }

    return buildJsonResult(status, message, {
      trigger,
      siteName: site.name,
      baseUrl: site.baseUrl
    });
  } finally {
    await clearNewApiHeaderRule();
  }
}

function getAggregateCheckinStatus(results) {
  const successStatuses = new Set(["CHECKED_IN", "ALREADY_CHECKED_IN"]);

  if (results.every((result) => successStatuses.has(result.status))) {
    return results.some((result) => result.status === "CHECKED_IN")
      ? "CHECKED_IN"
      : "ALREADY_CHECKED_IN";
  }

  if (results.some((result) => successStatuses.has(result.status))) {
    return "PARTIAL_SUCCESS";
  }

  return "API_ERROR";
}

async function runNewApiCheckin(trigger = "schedule") {
  await clearNewApiHeaderRule();

  const config = await getNewApiConfig();

  if (!config.enabled) {
    return buildJsonResult("DISABLED", "new-api 签到未启用", { trigger, results: [] });
  }

  const enabledSites = config.sites.filter((site) => site.enabled);

  if (!enabledSites.length) {
    const result = buildJsonResult("CONFIG_ERROR", "没有启用的 new-api 站点配置", {
      trigger,
      results: []
    });
    await recordNewApiCheckinResult(result);
    return result;
  }

  const results = [];

  for (const site of enabledSites) {
    results.push(await runSingleNewApiCheckin(site, trigger));
  }

  const successCount = results.filter((result) => (
    result.status === "CHECKED_IN" || result.status === "ALREADY_CHECKED_IN"
  )).length;
  const status = getAggregateCheckinStatus(results);
  const result = buildJsonResult(status, `${successCount}/${results.length} 个 new-api 站点签到成功`, {
    trigger,
    successCount,
    targetCount: results.length,
    results
  });

  await recordNewApiCheckinResult(result);
  return result;
}

async function runNewApiCheckinSafely(trigger) {
  try {
    return await runNewApiCheckin(trigger);
  } catch (error) {
    const result = buildJsonResult("ERROR", error?.message || String(error), { trigger });
    await recordNewApiCheckinResult(result);
    return result;
  }
}

function hasScheduledTimePassed(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  const now = new Date();
  const scheduled = new Date(now);

  scheduled.setHours(hours, minutes, 0, 0);
  return now >= scheduled;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTodayDate(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-") === getTodayKey();
}

function normalizePathname(pathname) {
  const normalized = pathname || "/";
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function isMatchingTargetUrl(existingUrl, targetUrl) {
  if (!existingUrl) {
    return false;
  }

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
  const windows = await chrome.windows.getAll({
    windowTypes: ["normal"]
  });
  const focusedWindow = windows.find((item) => item.focused);
  const targetWindow = focusedWindow || windows[0];

  return targetWindow?.id;
}

async function openTargetUrl() {
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
        const createdWindow = await chrome.windows.create({
          url: TARGET_URLS[0],
          focused: true
        });

        windowId = createdWindow.id;
        successCount += 1;
      }
      startIndex = 1;
    }
  } catch (error) {
    failures.push({
      url: TARGET_URLS[0],
      message: error?.message || String(error)
    });
    startIndex = 1;
  }

  for (let index = startIndex; index < TARGET_URLS.length; index += 1) {
    if (existingTargetTabs[index]) {
      existingCount += 1;
      continue;
    }

    try {
      const createProperties = {
        url: TARGET_URLS[index],
        active: index === 0
      };

      if (typeof windowId === "number") {
        createProperties.windowId = windowId;
      }

      await chrome.tabs.create(createProperties);
      successCount += 1;
    } catch (error) {
      failures.push({
        url: TARGET_URLS[index],
        message: error?.message || String(error)
      });
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
    [LAST_OPEN_RESULT_KEY]: {
      ...result,
      trigger,
      openedAt: new Date().toISOString()
    }
  });
}

async function markOpenedToday() {
  await chrome.storage.local.set({
    [LAST_OPENED_KEY]: getTodayKey()
  });
}

async function hasOpenedToday() {
  const stored = await chrome.storage.local.get([
    LAST_OPENED_KEY,
    LAST_OPEN_RESULT_KEY
  ]);

  return stored[LAST_OPENED_KEY] === getTodayKey()
    || isTodayDate(stored[LAST_OPEN_RESULT_KEY]?.openedAt);
}

async function maybeCatchUpOpen() {
  const timeString = await getScheduledTime();
  const openedToday = await hasOpenedToday();

  if (openedToday || !hasScheduledTimePassed(timeString)) {
    return;
  }

  const result = await openTargetUrl();
  await recordOpenResult("catch-up", result);

  if (result.successCount > 0 || result.existingCount > 0) {
    await markOpenedToday();
  }

  await runNewApiCheckinSafely("catch-up");
}

async function ensureDefaults() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_TIME });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await clearNewApiHeaderRule();

  await scheduleAlarm();
  await maybeCatchUpOpen();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await clearNewApiHeaderRule();
  await scheduleAlarm();
  await delay(STARTUP_CATCH_UP_DELAY_MS);
  await maybeCatchUpOpen();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) {
    return;
  }

  const result = await openTargetUrl();
  await recordOpenResult("alarm", result);

  if (result.successCount > 0 || result.existingCount > 0) {
    await markOpenedToday();
  }

  await runNewApiCheckinSafely("alarm");
  await scheduleAlarm();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "run-new-api-checkin") {
    return false;
  }

  runNewApiCheckin("manual")
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({
      ok: false,
      error: error?.message || String(error)
    }));

  return true;
});

chrome.action.onClicked.addListener(async () => {
  await chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync" || !changes[STORAGE_KEY]) {
    return;
  }

  await scheduleAlarm();
  await maybeCatchUpOpen();
});
