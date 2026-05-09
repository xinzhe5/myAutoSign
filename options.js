const STORAGE_KEY = "scheduleTime";
const LAST_OPEN_RESULT_KEY = "lastOpenResult";
const NEW_API_CONFIG_KEY = "newApiCheckinConfig";
const LAST_CHECKIN_RESULT_KEY = "lastNewApiCheckinResult";
const DEFAULT_TIME = "09:00";
const TRIGGER_TEXT_MAP = {
  alarm: "定时触发",
  "catch-up": "补开触发",
  manual: "手动触发",
  schedule: "计划触发"
};

const form = document.getElementById("settings-form");
const timeInput = document.getElementById("schedule-time");
const status = document.getElementById("status");
const lastOpenTime = document.getElementById("last-open-time");
const lastOpenStatus = document.getElementById("last-open-status");
const lastOpenDetail = document.getElementById("last-open-detail");
const newApiForm = document.getElementById("new-api-form");
const newApiEnabled = document.getElementById("new-api-enabled");
const siteList = document.getElementById("new-api-site-list");
const addSiteButton = document.getElementById("add-new-api-site");
const newApiStatus = document.getElementById("new-api-status");
const runCheckinButton = document.getElementById("run-checkin");
const lastCheckinTime = document.getElementById("last-checkin-time");
const lastCheckinStatus = document.getElementById("last-checkin-status");
const lastCheckinDetail = document.getElementById("last-checkin-detail");

function createEmptySite() {
  return {
    id: `site-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    enabled: true,
    name: "",
    baseUrl: "",
    accessToken: "",
    userId: "",
    turnstileToken: "",
    cookie: ""
  };
}

function normalizeSite(site = {}, index = 0) {
  return {
    id: String(site.id || `site-${index + 1}`),
    enabled: site.enabled !== false,
    name: String(site.name || ""),
    baseUrl: String(site.baseUrl || "").trim().replace(/\/+$/, ""),
    accessToken: String(site.accessToken || "").trim(),
    userId: String(site.userId || "").trim(),
    turnstileToken: String(site.turnstileToken || "").trim(),
    cookie: String(site.cookie || "").trim()
  };
}

function normalizeConfig(config = {}) {
  const rawSites = Array.isArray(config.sites)
    ? config.sites
    : config.baseUrl
      ? [config]
      : [createEmptySite()];

  return {
    enabled: Boolean(config.enabled),
    sites: rawSites.map(normalizeSite)
  };
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  timeInput.value = stored[STORAGE_KEY] || DEFAULT_TIME;
}

function createSiteCard(site, index) {
  const card = document.createElement("section");
  card.className = "site-card";
  card.dataset.siteId = site.id;

  card.innerHTML = `
    <div class="site-card-header">
      <label class="checkbox-row">
        <input class="site-enabled" type="checkbox">
        <span>启用站点 ${index + 1}</span>
      </label>
      <button class="secondary-button remove-site" type="button">删除</button>
    </div>

    <label>备注名称（可选）</label>
    <input class="site-name" type="text" autocomplete="off" placeholder="例如 主站">

    <label>站点地址</label>
    <input class="site-base-url" type="url" placeholder="https://网站域名">

    <label>Access Token</label>
    <input class="site-access-token" type="password" autocomplete="off" placeholder="你的 access_token">

    <label>用户 ID</label>
    <input class="site-user-id" type="text" autocomplete="off" placeholder="你的用户 ID">

    <label>Turnstile Token（可选）</label>
    <input class="site-turnstile-token" type="password" autocomplete="off">

    <label>Cookie（可选，用于 Cloudflare/WAF 场景）</label>
    <textarea class="site-cookie" rows="3" spellcheck="false"></textarea>
  `;

  card.querySelector(".site-enabled").checked = site.enabled;
  card.querySelector(".site-name").value = site.name;
  card.querySelector(".site-base-url").value = site.baseUrl;
  card.querySelector(".site-access-token").value = site.accessToken;
  card.querySelector(".site-user-id").value = site.userId;
  card.querySelector(".site-turnstile-token").value = site.turnstileToken;
  card.querySelector(".site-cookie").value = site.cookie;
  card.querySelector(".remove-site").addEventListener("click", () => {
    card.remove();

    if (!siteList.children.length) {
      addSiteCard(createEmptySite());
    }
  });

  return card;
}

function addSiteCard(site = createEmptySite()) {
  siteList.appendChild(createSiteCard(site, siteList.children.length));
}

async function loadNewApiSettings() {
  const stored = await chrome.storage.sync.get(NEW_API_CONFIG_KEY);
  const config = normalizeConfig(stored[NEW_API_CONFIG_KEY]);

  newApiEnabled.checked = config.enabled;
  siteList.replaceChildren();
  config.sites.forEach((site) => addSiteCard(site));
}

function readSitesFromForm() {
  return [...siteList.querySelectorAll(".site-card")]
    .map((card, index) => normalizeSite({
      id: card.dataset.siteId || `site-${index + 1}`,
      enabled: card.querySelector(".site-enabled").checked,
      name: card.querySelector(".site-name").value,
      baseUrl: card.querySelector(".site-base-url").value,
      accessToken: card.querySelector(".site-access-token").value,
      userId: card.querySelector(".site-user-id").value,
      turnstileToken: card.querySelector(".site-turnstile-token").value,
      cookie: card.querySelector(".site-cookie").value
    }, index))
    .filter((site) => site.baseUrl || site.accessToken || site.userId || site.cookie);
}

function formatDateTime(isoDateTime) {
  if (!isoDateTime) {
    return "暂无记录";
  }

  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) {
    return "时间格式异常";
  }

  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function getStatusType(result) {
  if (result.failureCount === 0) {
    return "success";
  }

  if (result.successCount === 0) {
    return "error";
  }

  return "warning";
}

function renderLastOpenResult(result) {
  if (!result) {
    lastOpenTime.textContent = "暂无记录";
    lastOpenStatus.textContent = "暂无记录";
    lastOpenStatus.className = "feedback-status";
    lastOpenDetail.textContent = "扩展执行过自动打开后会显示结果。";
    return;
  }

  const statusType = getStatusType(result);
  const triggerText = TRIGGER_TEXT_MAP[result.trigger] || "未知触发";
  const statusText = statusType === "success"
    ? "成功"
    : statusType === "warning"
      ? "部分成功"
      : "失败";
  const failedUrls = (result.failures || [])
    .map((item) => item.message ? `${item.url}：${item.message}` : item.url)
    .join("；");

  lastOpenTime.textContent = formatDateTime(result.openedAt);
  lastOpenStatus.textContent = `${statusText}（${result.successCount}/${result.targetCount}）`;
  lastOpenStatus.className = `feedback-status ${statusType}`;
  lastOpenDetail.textContent = failedUrls
    ? `${triggerText}：${result.failureCount} 个页面打开失败（${failedUrls}）。`
    : `${triggerText}：全部页面打开成功。`;
}

function getCheckinStatusType(result) {
  if (result.status === "CHECKED_IN" || result.status === "ALREADY_CHECKED_IN") {
    return "success";
  }

  if (result.status === "PARTIAL_SUCCESS" || result.status === "TURNSTILE_REQUIRED" || result.status === "CONFIG_ERROR") {
    return "warning";
  }

  if (result.status === "DISABLED") {
    return "";
  }

  return "error";
}

function formatSiteResult(result) {
  const name = result.siteName || result.baseUrl || "未命名站点";
  const parts = [`${name}: ${result.status} - ${result.message}`];

  if (result.rewardToday) {
    parts.push(`本次奖励 ${result.rewardToday}`);
  }

  if (result.currentQuota) {
    parts.push(`当前额度 ${result.currentQuota}`);
  }

  return parts.join("；");
}

function renderLastCheckinResult(result) {
  if (!result) {
    lastCheckinTime.textContent = "暂无记录";
    lastCheckinStatus.textContent = "暂无记录";
    lastCheckinStatus.className = "feedback-status";
    lastCheckinDetail.textContent = "扩展执行过 new-api 签到后会显示结果。";
    return;
  }

  const statusType = getCheckinStatusType(result);
  const triggerText = TRIGGER_TEXT_MAP[result.trigger] || "未知触发";
  const siteDetails = Array.isArray(result.results) && result.results.length
    ? result.results.map(formatSiteResult).join("\n")
    : result.message;

  lastCheckinTime.textContent = formatDateTime(result.checkedAt);
  lastCheckinStatus.textContent = result.status || "未知";
  lastCheckinStatus.className = statusType
    ? `feedback-status ${statusType}`
    : "feedback-status";
  lastCheckinDetail.textContent = `${triggerText}：\n${siteDetails}`;
}

async function loadLastOpenResult() {
  const stored = await chrome.storage.local.get(LAST_OPEN_RESULT_KEY);
  renderLastOpenResult(stored[LAST_OPEN_RESULT_KEY]);
}

async function loadLastCheckinResult() {
  const stored = await chrome.storage.local.get(LAST_CHECKIN_RESULT_KEY);
  renderLastCheckinResult(stored[LAST_CHECKIN_RESULT_KEY]);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await chrome.storage.sync.set({ [STORAGE_KEY]: timeInput.value });
  status.textContent = `保存成功。网页会在每天 ${timeInput.value} 后的 30 分钟内随机自动打开 Linux.do 和 AnyRouter 控制台。`;
});

addSiteButton.addEventListener("click", () => {
  addSiteCard(createEmptySite());
});

newApiForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const sites = readSitesFromForm();
  await chrome.storage.sync.set({
    [NEW_API_CONFIG_KEY]: {
      enabled: newApiEnabled.checked,
      sites
    }
  });

  newApiStatus.textContent = newApiEnabled.checked
    ? `签到配置已保存，共 ${sites.length} 个站点。扩展会在每日任务触发时逐个执行 new-api 签到。`
    : "签到配置已保存，当前未启用自动签到。";
});

runCheckinButton.addEventListener("click", async () => {
  runCheckinButton.disabled = true;
  newApiStatus.textContent = "正在执行 new-api 签到...";

  try {
    const response = await chrome.runtime.sendMessage({ type: "run-new-api-checkin" });

    if (!response?.ok) {
      throw new Error(response?.error || "后台未返回签到结果");
    }

    renderLastCheckinResult(response.result);
    newApiStatus.textContent = response.result.message || "签到执行完成。";
  } catch (error) {
    newApiStatus.textContent = `签到执行失败：${error?.message || String(error)}`;
  } finally {
    runCheckinButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[LAST_OPEN_RESULT_KEY]) {
    renderLastOpenResult(changes[LAST_OPEN_RESULT_KEY].newValue);
  }

  if (areaName === "local" && changes[LAST_CHECKIN_RESULT_KEY]) {
    renderLastCheckinResult(changes[LAST_CHECKIN_RESULT_KEY].newValue);
  }
});

async function init() {
  await loadSettings();
  await loadNewApiSettings();
  await loadLastOpenResult();
  await loadLastCheckinResult();
}

init();
