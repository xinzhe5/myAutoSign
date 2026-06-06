const {
  SITE_TYPES,
  SITE_TYPE_LABELS,
  AUTH_TYPES,
  CHECKIN_STATUS,
  STORAGE_KEYS,
  DEFAULTS,
  normalizeBaseUrl,
  detectSiteType,
  getDefaultAuthType,
  normalizeAccount,
  normalizeSettings,
  statusIsSuccess
} = globalThis.MyAutoSignShared;

const TRIGGER_TEXT_MAP = {
  alarm: "定时触发",
  "catch-up": "补执行",
  manual: "手动触发",
  retry: "失败重试"
};

let appState = {
  accounts: [],
  autoCheckinSettings: normalizeSettings(),
  autoCheckinStatus: null,
  lastOpenResult: null,
  scheduleTime: DEFAULTS.scheduleTime
};
let editingAccountId = null;
let siteTypeTouched = false;
let authTypeTouched = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  navLinks: $$(".nav-tabs a"),
  pages: $$(".page"),
  newAccountButton: $("#new-account-button"),
  accountEditor: $("#account-editor"),
  accountEditorTitle: $("#account-editor-title"),
  accountForm: $("#account-form"),
  accountId: $("#account-id"),
  accountBaseUrl: $("#account-base-url"),
  accountSiteType: $("#account-site-type"),
  accountAuthType: $("#account-auth-type"),
  accountName: $("#account-name"),
  accountUsername: $("#account-username"),
  accountUserId: $("#account-user-id"),
  accountAccessToken: $("#account-access-token"),
  accountCookie: $("#account-cookie"),
  accountTurnstileToken: $("#account-turnstile-token"),
  accountNotes: $("#account-notes"),
  accountEnabled: $("#account-enabled"),
  accountAutoCheckinEnabled: $("#account-auto-checkin-enabled"),
  accountAccessTokenField: $("#account-access-token-field"),
  accountCookieField: $("#account-cookie-field"),
  accountTurnstileField: $("#account-turnstile-field"),
  accountFormStatus: $("#account-form-status"),
  detectAccountButton: $("#detect-account-button"),
  cancelAccountEdit: $("#cancel-account-edit"),
  accountList: $("#account-list"),
  accountEmpty: $("#account-empty"),
  accountSearch: $("#account-search"),
  accountTypeFilter: $("#account-type-filter"),
  accountEnabledFilter: $("#account-enabled-filter"),
  autoForm: $("#auto-checkin-settings-form"),
  autoEnabled: $("#auto-checkin-enabled"),
  autoWindowStart: $("#auto-window-start"),
  autoWindowEnd: $("#auto-window-end"),
  autoRetryEnabled: $("#auto-retry-enabled"),
  autoMaxRetry: $("#auto-max-retry"),
  autoRetryInterval: $("#auto-retry-interval"),
  autoSettingsStatus: $("#auto-settings-status"),
  runAutoCheckinButton: $("#run-auto-checkin-button"),
  retryFailedButton: $("#retry-failed-button"),
  metricLastRun: $("#metric-last-run"),
  metricNextDaily: $("#metric-next-daily"),
  metricNextRetry: $("#metric-next-retry"),
  metricSummary: $("#metric-summary"),
  resultsBody: $("#checkin-results-body"),
  checkinEmpty: $("#checkin-empty"),
  openForm: $("#open-settings-form"),
  scheduleTime: $("#schedule-time"),
  openSettingsStatus: $("#open-settings-status"),
  lastOpenTime: $("#last-open-time"),
  lastOpenStatus: $("#last-open-status"),
  lastOpenDetail: $("#last-open-detail")
};

function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload }).then((response) => {
    if (!response?.ok) {
      const error = new Error(response?.error || "后台未返回成功结果");
      if (response?.code) {
        error.code = response.code;
      }
      if (response?.duplicate) {
        error.duplicate = response.duplicate;
      }
      throw error;
    }
    return response;
  });
}

function setSecretInputVisibility(input, button, isVisible) {
  input.type = isVisible ? "text" : "password";
  button.setAttribute("aria-pressed", String(isVisible));

  const label = button.dataset.secretLabel || "令牌";
  const action = isVisible ? "隐藏" : "显示";
  button.setAttribute("aria-label", `${action} ${label}`);
  button.title = `${action} ${label}`;
}

function bindSecretVisibilityToggles() {
  document.querySelectorAll("[data-secret-toggle]").forEach((button) => {
    const selector = button.dataset.secretToggle;
    if (!selector) {
      return;
    }

    const input = document.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    setSecretInputVisibility(input, button, input.type === "text");
    button.addEventListener("click", () => {
      setSecretInputVisibility(input, button, input.type !== "text");
      input.focus();
    });
  });
}

async function saveAccountWithDuplicateConfirmation(account) {
  try {
    return await sendMessage("save-account", { account });
  } catch (error) {
    if (error.code !== "duplicate-account") {
      throw error;
    }

    if (!confirm(error.message)) {
      return null;
    }

    return sendMessage("save-account", { account, allowDuplicate: true });
  }
}

function formatDateTime(value) {
  if (!value) {
    return "暂无";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间异常";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatTimestamp(value) {
  return value ? formatDateTime(value) : "暂无";
}

function getStatusClass(status) {
  if (statusIsSuccess(status)) {
    return "success";
  }
  if (status === CHECKIN_STATUS.SKIPPED || status === CHECKIN_STATUS.CONFIG_ERROR || status === CHECKIN_STATUS.TURNSTILE_REQUIRED) {
    return "warning";
  }
  return "error";
}

function getStatusLabel(status) {
  switch (status) {
    case CHECKIN_STATUS.SUCCESS:
      return "成功";
    case CHECKIN_STATUS.ALREADY_CHECKED:
      return "已签到";
    case CHECKIN_STATUS.FAILED:
      return "失败";
    case CHECKIN_STATUS.SKIPPED:
      return "跳过";
    case CHECKIN_STATUS.CONFIG_ERROR:
      return "配置错误";
    case CHECKIN_STATUS.TURNSTILE_REQUIRED:
      return "需要验证";
    default:
      return status || "未知";
  }
}

function routeTo(hash) {
  const route = (hash || location.hash || "#accounts").replace("#", "") || "accounts";
  elements.pages.forEach((page) => {
    page.hidden = page.dataset.page !== route;
  });
  elements.navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
}

async function loadState() {
  const response = await sendMessage("get-state");
  appState = response.state;
  renderAll();
}

function renderAll() {
  renderAccountFormAuthFields();
  renderAccounts();
  renderAutoCheckinSettings();
  renderAutoCheckinStatus();
  renderOpenSettings();
}

function renderAccountFormAuthFields() {
  const siteType = elements.accountSiteType.value;
  const authType = elements.accountAuthType.value;
  const isAccessToken = authType === AUTH_TYPES.ACCESS_TOKEN;
  const isCookie = authType === AUTH_TYPES.COOKIE;

  elements.accountAccessTokenField.hidden = !isAccessToken;
  elements.accountCookieField.hidden = !isCookie;
  elements.accountTurnstileField.hidden = siteType !== SITE_TYPES.NEW_API;
  elements.accountAccessToken.required = isAccessToken;
  elements.accountCookie.required = isCookie;
}

function getAccountLastResult(accountId) {
  return appState.autoCheckinStatus?.perAccount?.[accountId] || null;
}

function accountMatchesFilters(account) {
  const keyword = elements.accountSearch.value.trim().toLowerCase();
  const typeFilter = elements.accountTypeFilter.value;
  const enabledFilter = elements.accountEnabledFilter.value;

  if (typeFilter !== "all" && account.siteType !== typeFilter) {
    return false;
  }

  if (enabledFilter === "enabled" && !account.enabled) {
    return false;
  }

  if (enabledFilter === "disabled" && account.enabled) {
    return false;
  }

  if (!keyword) {
    return true;
  }

  return [
    account.name,
    account.baseUrl,
    account.username,
    account.userId,
    SITE_TYPE_LABELS[account.siteType]
  ].some((value) => String(value || "").toLowerCase().includes(keyword));
}

function renderAccounts() {
  const accounts = appState.accounts.filter(accountMatchesFilters);
  elements.accountList.replaceChildren();
  elements.accountEmpty.hidden = appState.accounts.length > 0;

  for (const account of accounts) {
    const result = getAccountLastResult(account.id);
    const item = document.createElement("article");
    item.className = "account-card";
    item.dataset.accountId = account.id;

    const statusHtml = result
      ? `<span class="badge ${getStatusClass(result.status)}">${getStatusLabel(result.status)}</span>`
      : `<span class="badge neutral">暂无记录</span>`;

    item.innerHTML = `
      <div class="account-main">
        <div>
          <h3>${escapeHtml(account.name || account.username || account.baseUrl)}</h3>
          <p>${escapeHtml(account.baseUrl)}</p>
        </div>
        <div class="badge-row">
          <span class="badge">${escapeHtml(SITE_TYPE_LABELS[account.siteType] || account.siteType)}</span>
          <span class="badge">${account.authType === AUTH_TYPES.COOKIE ? "Cookie" : "Access Token"}</span>
          <span class="badge ${account.enabled ? "success" : "neutral"}">${account.enabled ? "已启用" : "已停用"}</span>
          <span class="badge ${account.autoCheckinEnabled !== false ? "success" : "neutral"}">${account.autoCheckinEnabled !== false ? "自动签到" : "不签到"}</span>
          ${statusHtml}
        </div>
      </div>
      <div class="account-meta">
        <span>用户：${escapeHtml(account.username || "-")}</span>
        <span>ID：${escapeHtml(account.userId || "-")}</span>
        <span>最近：${escapeHtml(result ? formatTimestamp(result.timestamp) : "暂无")}</span>
      </div>
      <div class="account-actions">
        <button type="button" class="secondary-button" data-action="run">签到</button>
        <button type="button" class="secondary-button" data-action="open">打开</button>
        <button type="button" class="secondary-button" data-action="edit">编辑</button>
        <button type="button" class="danger-button" data-action="delete">删除</button>
      </div>
    `;

    elements.accountList.appendChild(item);
  }
}

function renderAutoCheckinSettings() {
  const settings = appState.autoCheckinSettings || normalizeSettings();
  elements.autoEnabled.checked = settings.enabled;
  elements.autoWindowStart.value = settings.windowStart || DEFAULTS.windowStart;
  elements.autoWindowEnd.value = settings.windowEnd || DEFAULTS.windowEnd;
  elements.autoRetryEnabled.checked = settings.retryEnabled;
  elements.autoMaxRetry.value = settings.maxRetryPerDay;
  elements.autoRetryInterval.value = settings.retryIntervalMinutes;
}

function renderAutoCheckinStatus() {
  const status = appState.autoCheckinStatus;
  const summary = status?.summary || {
    successCount: 0,
    failedCount: 0,
    skippedCount: 0
  };

  elements.metricLastRun.textContent = formatDateTime(status?.lastRunAt);
  elements.metricNextDaily.textContent = formatDateTime(status?.nextDailyRunAt);
  elements.metricNextRetry.textContent = formatDateTime(status?.nextRetryRunAt);
  elements.metricSummary.textContent = `${summary.successCount || 0} / ${summary.failedCount || 0} / ${summary.skippedCount || 0}`;
  elements.resultsBody.replaceChildren();

  const results = Object.values(status?.perAccount || {})
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  elements.checkinEmpty.hidden = results.length > 0;

  for (const result of results) {
    const row = document.createElement("tr");
    row.dataset.accountId = result.accountId;
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(result.accountName || "-")}</strong>
        <small>${escapeHtml(result.baseUrl || "")}</small>
      </td>
      <td>${escapeHtml(SITE_TYPE_LABELS[result.siteType] || result.siteType || "-")}</td>
      <td><span class="badge ${getStatusClass(result.status)}">${getStatusLabel(result.status)}</span></td>
      <td>${escapeHtml(formatResultMessage(result))}</td>
      <td>${escapeHtml(formatTimestamp(result.timestamp))}</td>
      <td>
        <button type="button" class="secondary-button table-button" data-result-action="retry">重试</button>
        <button type="button" class="secondary-button table-button" data-result-action="edit">编辑</button>
      </td>
    `;
    elements.resultsBody.appendChild(row);
  }
}

function formatResultMessage(result) {
  const parts = [result.message || "-"];
  if (result.rewardToday) {
    parts.push(`本次奖励 ${result.rewardToday}`);
  }
  if (result.currentQuota) {
    parts.push(`当前额度 ${result.currentQuota}`);
  }
  return parts.join("；");
}

function renderOpenSettings() {
  elements.scheduleTime.value = appState.scheduleTime || DEFAULTS.scheduleTime;
  renderLastOpenResult(appState.lastOpenResult);
}

function renderLastOpenResult(result) {
  if (!result) {
    elements.lastOpenTime.textContent = "暂无记录";
    elements.lastOpenStatus.textContent = "暂无记录";
    elements.lastOpenStatus.className = "feedback-status";
    elements.lastOpenDetail.textContent = "扩展执行过自动打开后会显示结果。";
    return;
  }

  const statusType = result.failureCount === 0
    ? "success"
    : result.successCount === 0
      ? "error"
      : "warning";
  const statusText = statusType === "success" ? "成功" : statusType === "warning" ? "部分成功" : "失败";
  const triggerText = TRIGGER_TEXT_MAP[result.trigger] || "未知触发";
  const failedUrls = (result.failures || [])
    .map((item) => item.message ? `${item.url}：${item.message}` : item.url)
    .join("；");

  elements.lastOpenTime.textContent = formatDateTime(result.openedAt);
  elements.lastOpenStatus.textContent = `${statusText}（${result.successCount}/${result.targetCount}）`;
  elements.lastOpenStatus.className = `feedback-status ${statusType}`;
  elements.lastOpenDetail.textContent = failedUrls
    ? `${triggerText}：${result.failureCount} 个页面打开失败（${failedUrls}）。`
    : `${triggerText}：全部页面打开成功。`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getEmptyAccount() {
  return normalizeAccount({
    enabled: true,
    autoCheckinEnabled: true,
    siteType: SITE_TYPES.NEW_API,
    authType: AUTH_TYPES.ACCESS_TOKEN
  });
}

function fillAccountForm(account) {
  editingAccountId = account?.id || null;
  const draft = account || getEmptyAccount();
  elements.accountEditorTitle.textContent = editingAccountId ? "编辑账号" : "添加账号";
  elements.accountId.value = draft.id || "";
  elements.accountBaseUrl.value = draft.baseUrl || "";
  elements.accountSiteType.value = draft.siteType || SITE_TYPES.NEW_API;
  elements.accountAuthType.value = draft.authType || getDefaultAuthType(draft.siteType, draft.baseUrl);
  elements.accountName.value = draft.name || "";
  elements.accountUsername.value = draft.username || "";
  elements.accountUserId.value = draft.userId || "";
  elements.accountAccessToken.value = draft.accessToken || "";
  elements.accountCookie.value = draft.cookie || "";
  elements.accountTurnstileToken.value = draft.turnstileToken || "";
  elements.accountNotes.value = draft.notes || "";
  elements.accountEnabled.checked = draft.enabled !== false;
  elements.accountAutoCheckinEnabled.checked = draft.autoCheckinEnabled !== false;
  elements.accountFormStatus.textContent = "";
  siteTypeTouched = Boolean(editingAccountId);
  authTypeTouched = Boolean(editingAccountId);
  renderAccountFormAuthFields();
  elements.accountEditor.hidden = false;
  elements.accountBaseUrl.focus();
}

function readAccountForm() {
  const baseUrl = normalizeBaseUrl(elements.accountBaseUrl.value);
  const siteType = elements.accountSiteType.value;
  const authType = elements.accountAuthType.value;

  return normalizeAccount({
    id: elements.accountId.value || undefined,
    baseUrl,
    siteType,
    authType,
    name: elements.accountName.value,
    username: elements.accountUsername.value,
    userId: elements.accountUserId.value,
    accessToken: elements.accountAccessToken.value,
    cookie: elements.accountCookie.value,
    turnstileToken: elements.accountTurnstileToken.value,
    notes: elements.accountNotes.value,
    enabled: elements.accountEnabled.checked,
    autoCheckinEnabled: elements.accountAutoCheckinEnabled.checked,
    createdAt: appState.accounts.find((account) => account.id === elements.accountId.value)?.createdAt
  });
}

function validateAccount(account) {
  if (!account.baseUrl) {
    return "请填写站点地址。";
  }
  if (!account.userId) {
    return "请填写用户 ID，或先使用自动识别。";
  }
  if (account.authType === AUTH_TYPES.ACCESS_TOKEN && !account.accessToken) {
    return "Access Token 认证需要填写 Access Token。";
  }
  if (account.authType === AUTH_TYPES.COOKIE && !account.cookie) {
    return "Cookie 认证需要填写或自动识别导入 Cookie。";
  }
  return "";
}

function applyUrlDefaults() {
  const baseUrl = normalizeBaseUrl(elements.accountBaseUrl.value);
  if (!baseUrl) {
    return;
  }

  const detectedType = detectSiteType(baseUrl, elements.accountSiteType.value);
  if (!siteTypeTouched) {
    elements.accountSiteType.value = detectedType;
  }
  if (!authTypeTouched) {
    elements.accountAuthType.value = getDefaultAuthType(elements.accountSiteType.value, baseUrl);
  }
  if (!elements.accountName.value.trim()) {
    try {
      elements.accountName.value = new URL(baseUrl).hostname;
    } catch (error) {
      // Keep the user's current input.
    }
  }
  renderAccountFormAuthFields();
}

async function saveAccountFromForm(event) {
  event.preventDefault();
  const account = readAccountForm();
  const validationError = validateAccount(account);
  if (validationError) {
    elements.accountFormStatus.textContent = validationError;
    elements.accountFormStatus.className = "status error";
    return;
  }

  elements.accountFormStatus.textContent = "正在保存账号...";
  elements.accountFormStatus.className = "status";

  try {
    const response = await saveAccountWithDuplicateConfirmation(account);
    if (!response) {
      elements.accountFormStatus.textContent = "已取消保存，未添加重复账号。";
      elements.accountFormStatus.className = "status";
      return;
    }
    elements.accountFormStatus.textContent = "账号已保存。";
    elements.accountFormStatus.className = "status success";
    elements.accountEditor.hidden = true;
    editingAccountId = null;
    await loadState();
  } catch (error) {
    elements.accountFormStatus.textContent = `保存失败：${error.message}`;
    elements.accountFormStatus.className = "status error";
  }
}

async function autoDetectAccount() {
  applyUrlDefaults();
  const input = readAccountForm();
  elements.detectAccountButton.disabled = true;
  elements.accountFormStatus.textContent = "正在从目标站点自动识别账号...";
  elements.accountFormStatus.className = "status";

  try {
    const response = await sendMessage("detect-account", { input });
    const detected = response.data;
    elements.accountBaseUrl.value = detected.baseUrl || input.baseUrl;
    elements.accountSiteType.value = detected.siteType || input.siteType;
    elements.accountAuthType.value = detected.authType || input.authType;
    elements.accountName.value = elements.accountName.value || detected.name || "";
    elements.accountUsername.value = detected.username || elements.accountUsername.value;
    elements.accountUserId.value = detected.userId || elements.accountUserId.value;
    elements.accountAccessToken.value = detected.accessToken || elements.accountAccessToken.value;
    elements.accountCookie.value = detected.cookie || elements.accountCookie.value;
    siteTypeTouched = true;
    authTypeTouched = true;
    renderAccountFormAuthFields();
    elements.accountFormStatus.textContent = "自动识别完成，请确认后保存账号。";
    elements.accountFormStatus.className = "status success";
  } catch (error) {
    elements.accountFormStatus.textContent = `自动识别失败：${error.message}`;
    elements.accountFormStatus.className = "status error";
  } finally {
    elements.detectAccountButton.disabled = false;
  }
}

async function runAutoCheckin(options, button, messageTarget) {
  if (button) {
    button.disabled = true;
  }
  if (messageTarget) {
    messageTarget.textContent = "正在执行签到...";
    messageTarget.className = "status";
  }

  try {
    await sendMessage("run-auto-checkin", { options });
    await loadState();
    if (messageTarget) {
      messageTarget.textContent = "签到执行完成。";
      messageTarget.className = "status success";
    }
  } catch (error) {
    if (messageTarget) {
      messageTarget.textContent = `签到失败：${error.message}`;
      messageTarget.className = "status error";
    }
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function bindEvents() {
  window.addEventListener("hashchange", () => routeTo(location.hash));

  elements.newAccountButton.addEventListener("click", () => fillAccountForm(null));
  elements.cancelAccountEdit.addEventListener("click", () => {
    elements.accountEditor.hidden = true;
    editingAccountId = null;
  });
  elements.accountForm.addEventListener("submit", saveAccountFromForm);
  elements.detectAccountButton.addEventListener("click", () => void autoDetectAccount());
  elements.accountBaseUrl.addEventListener("blur", applyUrlDefaults);
  elements.accountBaseUrl.addEventListener("input", () => {
    if (!siteTypeTouched || !authTypeTouched) {
      applyUrlDefaults();
    }
  });
  elements.accountSiteType.addEventListener("change", () => {
    siteTypeTouched = true;
    if (!authTypeTouched || elements.accountSiteType.value === SITE_TYPES.ANYROUTER) {
      elements.accountAuthType.value = getDefaultAuthType(elements.accountSiteType.value, elements.accountBaseUrl.value);
    }
    renderAccountFormAuthFields();
  });
  elements.accountAuthType.addEventListener("change", () => {
    authTypeTouched = true;
    renderAccountFormAuthFields();
  });
  elements.accountSearch.addEventListener("input", renderAccounts);
  elements.accountTypeFilter.addEventListener("change", renderAccounts);
  elements.accountEnabledFilter.addEventListener("change", renderAccounts);

  elements.accountList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest(".account-card");
    const account = appState.accounts.find((item) => item.id === card?.dataset.accountId);
    if (!account) return;

    if (button.dataset.action === "edit") {
      fillAccountForm(account);
      return;
    }
    if (button.dataset.action === "open") {
      await sendMessage("open-account-site", { url: account.baseUrl });
      return;
    }
    if (button.dataset.action === "run") {
      await runAutoCheckin({ trigger: "manual", accountIds: [account.id] }, button, elements.autoSettingsStatus);
      return;
    }
    if (button.dataset.action === "delete") {
      if (confirm(`确定删除账号「${account.name || account.baseUrl}」吗？`)) {
        await sendMessage("delete-account", { accountId: account.id });
        await loadState();
      }
    }
  });

  elements.autoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = {
      enabled: elements.autoEnabled.checked,
      windowStart: elements.autoWindowStart.value,
      windowEnd: elements.autoWindowEnd.value,
      retryEnabled: elements.autoRetryEnabled.checked,
      maxRetryPerDay: elements.autoMaxRetry.value,
      retryIntervalMinutes: elements.autoRetryInterval.value
    };

    try {
      await sendMessage("save-auto-checkin-settings", { settings });
      elements.autoSettingsStatus.textContent = "自动签到设置已保存。";
      elements.autoSettingsStatus.className = "status success";
      await loadState();
    } catch (error) {
      elements.autoSettingsStatus.textContent = `保存失败：${error.message}`;
      elements.autoSettingsStatus.className = "status error";
    }
  });

  elements.runAutoCheckinButton.addEventListener("click", () => (
    runAutoCheckin({ trigger: "manual" }, elements.runAutoCheckinButton, elements.autoSettingsStatus)
  ));
  elements.retryFailedButton.addEventListener("click", () => (
    runAutoCheckin({ trigger: "manual", retryOnly: true }, elements.retryFailedButton, elements.autoSettingsStatus)
  ));

  elements.resultsBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-result-action]");
    if (!button) return;
    const row = button.closest("tr");
    const account = appState.accounts.find((item) => item.id === row?.dataset.accountId);
    if (!account) return;

    if (button.dataset.resultAction === "edit") {
      location.hash = "#accounts";
      fillAccountForm(account);
      return;
    }

    if (button.dataset.resultAction === "retry") {
      await runAutoCheckin({ trigger: "manual", accountIds: [account.id] }, button, elements.autoSettingsStatus);
    }
  });

  elements.openForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await sendMessage("save-open-settings", { scheduleTime: elements.scheduleTime.value });
      elements.openSettingsStatus.textContent = "自动打开设置已保存。";
      elements.openSettingsStatus.className = "status success";
      await loadState();
    } catch (error) {
      elements.openSettingsStatus.textContent = `保存失败：${error.message}`;
      elements.openSettingsStatus.className = "status error";
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      (areaName === "local" && (
        changes[STORAGE_KEYS.ACCOUNTS] ||
        changes[STORAGE_KEYS.AUTO_CHECKIN_STATUS] ||
        changes[STORAGE_KEYS.LAST_OPEN_RESULT]
      )) ||
      (areaName === "sync" && (
        changes[STORAGE_KEYS.AUTO_CHECKIN_SETTINGS] ||
        changes[STORAGE_KEYS.LEGACY_SCHEDULE_TIME]
      ))
    ) {
      void loadState();
    }
  });
}

async function init() {
  if (!location.hash) {
    location.hash = "#accounts";
  }
  routeTo(location.hash);
  bindSecretVisibilityToggles();
  bindEvents();
  await loadState();
}

init().catch((error) => {
  console.error(error);
});
