const {
  SITE_TYPES,
  AUTH_TYPES,
  normalizeBaseUrl,
  detectSiteType,
  getDefaultAuthType,
  normalizeAccount
} = globalThis.MyAutoSignShared;

const $ = (selector) => document.querySelector(selector);

const elements = {
  currentSiteUrl: $("#current-site-url"),
  form: $("#sidepanel-form"),
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
  openOptionsButton: $("#open-options"),
  status: $("#status")
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
  elements.form.querySelector("button[type='submit']").disabled = isBusy;
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
    setStatus("账号已保存。", "success");
  } catch (error) {
    setStatus(`保存失败：${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
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

  chrome.tabs.onActivated.addListener(() => {
    void refreshCurrentSite();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      void refreshCurrentSite();
    }
  });
}

async function init() {
  renderAuthFields();
  bindSecretVisibilityToggles();
  bindEvents();
  await refreshCurrentSite({ force: true });
}

void init().catch((error) => {
  setStatus(`侧边栏初始化失败：${error.message || String(error)}`, "error");
});
