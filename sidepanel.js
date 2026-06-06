const {
  SITE_TYPES,
  AUTH_TYPES,
  STORAGE_KEYS,
  normalizeBaseUrl,
  detectSiteType,
  getDefaultAuthType,
  normalizeAccount,
  normalizeBookmark
} = globalThis.MyAutoSignShared;

const $ = (selector) => document.querySelector(selector);

const elements = {
  currentSiteUrl: $("#current-site-url"),
  home: $("#sidepanel-home"),
  addModePanel: $("#add-mode-panel"),
  accountList: $("#sidepanel-account-list"),
  accountEmpty: $("#sidepanel-account-empty"),
  addAccountButton: $("#add-account-button"),
  addBookmarkButton: $("#add-bookmark-button"),
  autoAddButton: $("#auto-add-button"),
  manualAddButton: $("#manual-add-button"),
  cancelAddMode: $("#cancel-add-mode"),
  form: $("#sidepanel-form"),
  formTitle: $("#form-title"),
  backToHomeButton: $("#back-to-home"),
  baseUrl: $("#base-url"),
  siteType: $("#site-type"),
  authType: $("#auth-type"),
  name: $("#name"),
  username: $("#username"),
  userId: $("#user-id"),
  accessToken: $("#access-token"),
  cookie: $("#cookie"),
  turnstileToken: $("#turnstile-token"),
  enabled: $("#enabled"),
  autoCheckinEnabled: $("#auto-checkin-enabled"),
  accessTokenField: $("#access-token-field"),
  cookieField: $("#cookie-field"),
  turnstileField: $("#turnstile-field"),
  detectButton: $("#detect-button"),
  bookmarkForm: $("#sidepanel-bookmark-form"),
  bookmarkBackToHome: $("#bookmark-back-to-home"),
  bookmarkName: $("#bookmark-name"),
  bookmarkUrl: $("#bookmark-url"),
  bookmarkTags: $("#bookmark-tags"),
  bookmarkTagOptions: $("#bookmark-tag-options"),
  bookmarkCurrentTab: $("#bookmark-current-tab"),
  openOptionsButton: $("#open-options"),
  status: $("#status")
};

let appState = {
  accounts: [],
  bookmarks: []
};
let currentAccountId = "";
let lastActiveBaseUrl = "";
let siteTypeTouched = false;
let authTypeTouched = false;

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

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = type ? `status ${type}` : "status";
}

function setBusy(isBusy) {
  elements.detectButton.disabled = isBusy;
  elements.autoAddButton.disabled = isBusy;
  elements.manualAddButton.disabled = isBusy;
  elements.form.querySelector("button[type='submit']").disabled = isBusy;
}

function setView(view) {
  elements.home.hidden = view !== "home";
  elements.addModePanel.hidden = view !== "add-mode";
  elements.form.hidden = view !== "form";
  elements.bookmarkForm.hidden = view !== "bookmark-form";
}

async function loadState() {
  const response = await sendMessage("get-state");
  appState = response.state || { accounts: [], bookmarks: [] };
  renderAccountList();
  renderBookmarkTagOptions();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitTags(value) {
  return Array.from(new Set(String(value || "")
    .split(/[,\n，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)));
}

function getAllBookmarkTags() {
  return Array.from(new Set((appState.bookmarks || []).flatMap((bookmark) => bookmark.tags || [])))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function getBookmarkFormTags() {
  return splitTags(elements.bookmarkTags.value);
}

function setBookmarkFormTags(tags) {
  elements.bookmarkTags.value = Array.from(new Set(tags)).join(", ");
  renderBookmarkTagOptions();
}

function renderBookmarkTagOptions() {
  const tags = getAllBookmarkTags();
  const selectedTags = new Set(getBookmarkFormTags());
  elements.bookmarkTagOptions.replaceChildren();
  elements.bookmarkTagOptions.hidden = tags.length === 0;

  for (const tag of tags) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bookmark-tag-option";
    button.dataset.bookmarkTag = tag;
    button.textContent = tag;
    button.setAttribute("aria-pressed", String(selectedTags.has(tag)));
    button.classList.toggle("active", selectedTags.has(tag));
    elements.bookmarkTagOptions.appendChild(button);
  }
}

function toggleBookmarkTag(tag) {
  const tags = getBookmarkFormTags();
  const nextTags = tags.includes(tag)
    ? tags.filter((item) => item !== tag)
    : [...tags, tag];
  setBookmarkFormTags(nextTags);
}

function getCurrentBaseUrl() {
  const value = lastActiveBaseUrl || elements.currentSiteUrl.title || elements.currentSiteUrl.textContent;
  return isHttpUrl(value) ? normalizeBaseUrl(value) : "";
}

function accountMatchesCurrentSite(account) {
  const currentBaseUrl = getCurrentBaseUrl();
  return Boolean(currentBaseUrl && normalizeBaseUrl(account.baseUrl) === currentBaseUrl);
}

function getAccountLastResult(account) {
  return appState.autoCheckinStatus?.perAccount?.[account.id] || {};
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function formatStatValue(value, prefix = "") {
  const text = String(value ?? "").trim();
  if (!text) {
    return "-";
  }
  if (!prefix || /^[+\-~]/.test(text)) {
    return text;
  }
  return `${prefix}${text}`;
}

function getAccountStats(account) {
  const result = getAccountLastResult(account);
  return {
    balance: formatStatValue(firstPresent(
      account.balance,
      account.quota,
      account.currentQuota,
      result.currentQuota
    )),
    todayConsumption: formatStatValue(firstPresent(
      account.todayConsumption,
      account.todayQuotaConsumption,
      account.today_quota_consumption,
      result.todayConsumption
    ), "-"),
    todayIncome: formatStatValue(firstPresent(
      account.todayIncome,
      account.today_income,
      result.todayIncome,
      result.rewardToday
    ), "+")
  };
}

function getHostLabel(value) {
  try {
    return new URL(normalizeBaseUrl(value)).hostname;
  } catch (error) {
    return value || "-";
  }
}

function renderAccountList() {
  const accounts = [...(appState.accounts || [])].sort((a, b) => {
    const aMatches = accountMatchesCurrentSite(a);
    const bMatches = accountMatchesCurrentSite(b);
    if (aMatches !== bMatches) {
      return aMatches ? -1 : 1;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  elements.accountList.replaceChildren();
  elements.accountEmpty.hidden = accounts.length > 0;

  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account-card";
    card.dataset.accountId = account.id;

    const stats = getAccountStats(account);
    const currentBadge = accountMatchesCurrentSite(account)
      ? `<span class="badge success">当前站点</span>`
      : "";
    const userLine = account.username || "-";

    card.innerHTML = `
      <div class="account-card-body">
        <div class="account-info">
          <h3 title="${escapeHtml(account.baseUrl || "")}">${escapeHtml(account.name || getHostLabel(account.baseUrl))}</h3>
          <p>${escapeHtml(userLine)}</p>
          <div class="badge-row">
            ${currentBadge}
          </div>
        </div>
        <div class="account-controls">
          <span class="badge ${account.enabled ? "success" : "neutral"}">${account.enabled ? "启用" : "停用"}</span>
          <span class="account-actions">
            <button type="button" class="secondary-button icon-action" data-action="edit" aria-label="编辑账号" title="编辑账号"></button>
            <button type="button" class="secondary-button icon-action" data-action="open" aria-label="打开站点" title="打开站点"></button>
          </span>
        </div>
        <div class="account-stats" aria-label="账号统计">
          <strong class="stat-balance" title="余额" aria-label="余额 ${escapeHtml(stats.balance)}">${escapeHtml(stats.balance)}</strong>
          <div class="stat-cashflow" aria-label="今日消费和今日收入">
            <span class="stat-consumption" title="今日消费" aria-label="今日消费 ${escapeHtml(stats.todayConsumption)}">${escapeHtml(stats.todayConsumption)}</span>
            <span class="stat-income" title="今日收入" aria-label="今日收入 ${escapeHtml(stats.todayIncome)}">${escapeHtml(stats.todayIncome)}</span>
          </div>
        </div>
      </div>
    `;

    elements.accountList.appendChild(card);
  }
}

function resetAccountForm() {
  const baseUrl = getCurrentBaseUrl();
  currentAccountId = "";
  siteTypeTouched = false;
  authTypeTouched = false;

  elements.baseUrl.value = baseUrl;
  elements.siteType.value = detectSiteType(baseUrl, SITE_TYPES.NEW_API);
  elements.authType.value = getDefaultAuthType(elements.siteType.value, baseUrl);
  elements.name.value = "";
  elements.username.value = "";
  elements.userId.value = "";
  elements.accessToken.value = "";
  elements.cookie.value = "";
  elements.turnstileToken.value = "";
  elements.enabled.checked = true;
  elements.autoCheckinEnabled.checked = true;
  applyUrlDefaults();
}

function fillAccountForm(account) {
  currentAccountId = account.id || "";
  siteTypeTouched = true;
  authTypeTouched = true;

  elements.formTitle.textContent = "编辑账号";
  elements.baseUrl.value = account.baseUrl || "";
  elements.siteType.value = account.siteType || SITE_TYPES.NEW_API;
  elements.authType.value = account.authType || getDefaultAuthType(account.siteType, account.baseUrl);
  elements.name.value = account.name || "";
  elements.username.value = account.username || "";
  elements.userId.value = account.userId || "";
  elements.accessToken.value = account.accessToken || "";
  elements.cookie.value = account.cookie || "";
  elements.turnstileToken.value = account.turnstileToken || "";
  elements.enabled.checked = account.enabled !== false;
  elements.autoCheckinEnabled.checked = account.autoCheckinEnabled !== false;
  renderAuthFields();
  setView("form");
  elements.baseUrl.focus();
}

function startManualAdd() {
  resetAccountForm();
  elements.formTitle.textContent = "手动添加";
  setView("form");
  setStatus("");
  elements.baseUrl.focus();
}

function startAutoAdd() {
  resetAccountForm();
  elements.formTitle.textContent = "自动添加";
  const currentBaseUrl = getCurrentBaseUrl();
  if (currentBaseUrl) {
    elements.baseUrl.value = currentBaseUrl;
    applyUrlDefaults();
    setStatus("请点击“自动识别当前站点”开始获取账号信息。");
  } else {
    setStatus("请先打开目标站点，或填写站点地址后点击“自动识别当前站点”。");
  }
  setView("form");
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function hasAccountDetails() {
  return Boolean(
    elements.username.value.trim() ||
    elements.userId.value.trim() ||
    elements.accessToken.value.trim() ||
    elements.cookie.value.trim()
  );
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function refreshCurrentSite({ force = false } = {}) {
  const tab = await getActiveTab();
  const tabUrl = tab?.url || "";

  if (!isHttpUrl(tabUrl)) {
    elements.currentSiteUrl.textContent = tabUrl ? "当前页面不支持自动识别" : "未找到当前活动标签页";
    elements.currentSiteUrl.title = tabUrl;
    lastActiveBaseUrl = "";
    renderAccountList();
    return;
  }

  const baseUrl = normalizeBaseUrl(tabUrl);
  const formBaseUrl = normalizeBaseUrl(elements.baseUrl.value);
  elements.currentSiteUrl.textContent = baseUrl || tabUrl;
  elements.currentSiteUrl.title = tabUrl;

  if (force || !formBaseUrl || (formBaseUrl === lastActiveBaseUrl && !hasAccountDetails())) {
    elements.baseUrl.value = baseUrl;
    applyUrlDefaults();
  }

  lastActiveBaseUrl = baseUrl;
  renderAccountList();
}

function renderAuthFields() {
  const siteType = elements.siteType.value;
  const authType = elements.authType.value;
  const isAccessToken = authType === AUTH_TYPES.ACCESS_TOKEN;
  const isCookie = authType === AUTH_TYPES.COOKIE;

  elements.accessTokenField.hidden = !isAccessToken;
  elements.cookieField.hidden = !isCookie;
  elements.turnstileField.hidden = siteType !== SITE_TYPES.NEW_API;
  elements.accessToken.required = isAccessToken;
  elements.cookie.required = isCookie;
}

function applyUrlDefaults() {
  const baseUrl = normalizeBaseUrl(elements.baseUrl.value);
  if (!baseUrl) {
    renderAuthFields();
    return;
  }

  const detectedType = detectSiteType(baseUrl, elements.siteType.value);
  if (!siteTypeTouched) {
    elements.siteType.value = detectedType;
  }
  if (!authTypeTouched) {
    elements.authType.value = getDefaultAuthType(elements.siteType.value, baseUrl);
  }
  if (!elements.name.value.trim()) {
    try {
      elements.name.value = new URL(baseUrl).hostname;
    } catch (error) {
      // Keep the user's current input.
    }
  }

  renderAuthFields();
}

function readAccountForm() {
  return normalizeAccount({
    id: currentAccountId || undefined,
    baseUrl: normalizeBaseUrl(elements.baseUrl.value),
    siteType: elements.siteType.value,
    authType: elements.authType.value,
    name: elements.name.value,
    username: elements.username.value,
    userId: elements.userId.value,
    accessToken: elements.accessToken.value,
    cookie: elements.cookie.value,
    turnstileToken: elements.turnstileToken.value,
    enabled: elements.enabled.checked,
    autoCheckinEnabled: elements.autoCheckinEnabled.checked
  });
}

function validateAccount(account) {
  if (!account.baseUrl) {
    return "请填写站点地址，或先打开目标站点。";
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

function fillDetectedAccount(detected, input) {
  elements.baseUrl.value = detected.baseUrl || input.baseUrl || elements.baseUrl.value;
  elements.siteType.value = detected.siteType || input.siteType || elements.siteType.value;
  elements.authType.value = detected.authType || input.authType || elements.authType.value;
  elements.name.value = elements.name.value || detected.name || "";
  elements.username.value = detected.username || elements.username.value;
  elements.userId.value = detected.userId || elements.userId.value;
  elements.accessToken.value = detected.accessToken || elements.accessToken.value;
  elements.cookie.value = detected.cookie || elements.cookie.value;
  siteTypeTouched = true;
  authTypeTouched = true;
  renderAuthFields();
}

async function autoDetectCurrentSite() {
  if (!normalizeBaseUrl(elements.baseUrl.value)) {
    await refreshCurrentSite({ force: true });
  }

  applyUrlDefaults();
  const input = readAccountForm();
  setBusy(true);
  setStatus("正在从当前目标站点自动识别账号...");

  try {
    const response = await sendMessage("detect-account", { input });
    fillDetectedAccount(response.data || {}, input);
    setStatus("自动识别完成，请确认后保存账号。", "success");
  } catch (error) {
    setStatus(`自动识别失败：${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function saveAccount(event) {
  event.preventDefault();
  applyUrlDefaults();

  const account = readAccountForm();
  const validationError = validateAccount(account);
  if (validationError) {
    setStatus(validationError, "error");
    return;
  }

  setBusy(true);
  setStatus("正在保存账号...");

  try {
    const response = await saveAccountWithDuplicateConfirmation(account);
    if (!response) {
      setStatus("已取消保存，未添加重复账号。");
      return;
    }
    currentAccountId = response.account?.id || account.id || currentAccountId;
    await loadState();
    setView("home");
    setStatus("账号已保存。", "success");
  } catch (error) {
    setStatus(`保存失败：${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function resetBookmarkForm() {
  elements.bookmarkName.value = "";
  elements.bookmarkUrl.value = "";
  elements.bookmarkTags.value = "";
  renderBookmarkTagOptions();
}

async function fillBookmarkFromCurrentTab() {
  elements.bookmarkCurrentTab.disabled = true;
  setStatus("正在读取当前标签页...");

  try {
    const tab = await getActiveTab();
    const tabUrl = tab?.url || "";
    if (!isHttpUrl(tabUrl)) {
      throw new Error("当前页面不支持保存为书签。");
    }

    const parsed = new URL(tabUrl);
    elements.bookmarkUrl.value = parsed.toString();
    if (!elements.bookmarkName.value.trim()) {
      elements.bookmarkName.value = tab.title || parsed.hostname;
    }
    setStatus("已填入当前标签页。", "success");
  } catch (error) {
    setStatus(`读取失败：${error.message}`, "error");
  } finally {
    elements.bookmarkCurrentTab.disabled = false;
  }
}

async function startBookmarkAdd() {
  resetBookmarkForm();
  setView("bookmark-form");
  await fillBookmarkFromCurrentTab();
  elements.bookmarkName.focus();
}

function readBookmarkForm() {
  return normalizeBookmark({
    name: elements.bookmarkName.value,
    url: elements.bookmarkUrl.value,
    tags: splitTags(elements.bookmarkTags.value),
    notes: "",
    pinned: false
  });
}

function validateBookmark(bookmark) {
  if (!bookmark.name.trim()) {
    return "请填写书签名称。";
  }
  if (!bookmark.url.trim()) {
    return "请填写书签链接。";
  }

  try {
    const parsed = new URL(bookmark.url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "书签链接只支持 http 或 https 地址。";
    }
  } catch (error) {
    return "请填写有效的书签链接。";
  }

  return "";
}

async function saveBookmark(event) {
  event.preventDefault();

  const bookmark = readBookmarkForm();
  const validationError = validateBookmark(bookmark);
  if (validationError) {
    setStatus(validationError, "error");
    return;
  }

  const submitButton = elements.bookmarkForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setStatus("正在保存书签...");

  try {
    await sendMessage("save-bookmark", { bookmark });
    await loadState();
    setView("home");
    setStatus("书签已保存。", "success");
  } catch (error) {
    setStatus(`保存失败：${error.message}`, "error");
  } finally {
    submitButton.disabled = false;
  }
}

function bindEvents() {
  elements.addAccountButton.addEventListener("click", () => {
    setStatus("");
    setView("add-mode");
  });
  elements.addBookmarkButton.addEventListener("click", () => {
    void startBookmarkAdd();
  });

  elements.cancelAddMode.addEventListener("click", () => {
    setView("home");
  });

  elements.backToHomeButton.addEventListener("click", () => {
    setView("home");
  });
  elements.bookmarkBackToHome.addEventListener("click", () => {
    setView("home");
  });

  elements.manualAddButton.addEventListener("click", startManualAdd);
  elements.autoAddButton.addEventListener("click", startAutoAdd);

  elements.accountList.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("button[data-action]");
    if (!button) return;

    const card = button.closest(".account-card");
    const account = appState.accounts.find((item) => item.id === card?.dataset.accountId);
    if (!account) return;

    if (button.dataset.action === "edit") {
      setStatus("");
      fillAccountForm(account);
      return;
    }

    if (button.dataset.action === "open") {
      await sendMessage("open-account-site", { url: account.baseUrl });
    }
  });

  elements.baseUrl.addEventListener("input", () => {
    applyUrlDefaults();
  });

  elements.baseUrl.addEventListener("blur", () => {
    const baseUrl = normalizeBaseUrl(elements.baseUrl.value);
    if (baseUrl) {
      elements.baseUrl.value = baseUrl;
      applyUrlDefaults();
    }
  });

  elements.siteType.addEventListener("change", () => {
    siteTypeTouched = true;
    if (!authTypeTouched) {
      elements.authType.value = getDefaultAuthType(elements.siteType.value, elements.baseUrl.value);
    }
    renderAuthFields();
  });

  elements.authType.addEventListener("change", () => {
    authTypeTouched = true;
    renderAuthFields();
  });

  elements.detectButton.addEventListener("click", () => {
    void autoDetectCurrentSite();
  });

  elements.openOptionsButton.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  elements.form.addEventListener("submit", (event) => {
    void saveAccount(event);
  });
  elements.bookmarkForm.addEventListener("submit", (event) => {
    void saveBookmark(event);
  });
  elements.bookmarkCurrentTab.addEventListener("click", () => {
    void fillBookmarkFromCurrentTab();
  });
  elements.bookmarkTags.addEventListener("input", renderBookmarkTagOptions);
  elements.bookmarkTagOptions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-bookmark-tag]");
    if (!button) return;
    toggleBookmarkTag(button.dataset.bookmarkTag || "");
  });

  chrome.tabs.onActivated.addListener(() => {
    void refreshCurrentSite();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      void refreshCurrentSite();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (
      changes[STORAGE_KEYS.ACCOUNTS] ||
      changes[STORAGE_KEYS.BOOKMARKS] ||
      changes[STORAGE_KEYS.AUTO_CHECKIN_STATUS]
    )) {
      void loadState();
    }
  });
}

async function init() {
  renderAuthFields();
  bindSecretVisibilityToggles();
  bindEvents();
  await refreshCurrentSite({ force: true });
  await loadState();
  setView("home");
}

void init().catch((error) => {
  setStatus(`侧边栏初始化失败：${error.message || String(error)}`, "error");
});
