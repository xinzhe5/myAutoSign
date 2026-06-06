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
  normalizeBookmark,
  normalizeSettings,
  statusIsSuccess,
  createId
} = globalThis.MyAutoSignShared;

const TRIGGER_TEXT_MAP = {
  alarm: "定时触发",
  "catch-up": "补执行",
  manual: "手动触发",
  retry: "失败重试"
};

let appState = {
  accounts: [],
  bookmarks: [],
  modelCache: {},
  autoCheckinSettings: normalizeSettings(),
  autoCheckinStatus: null,
  lastOpenResult: null,
  scheduleTime: DEFAULTS.scheduleTime
};
let editingAccountId = null;
let editingBookmarkId = null;
let modelRefreshInFlight = false;
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
  modelAccountFilter: $("#model-account-filter"),
  modelSearch: $("#model-search"),
  modelProviderFilter: $("#model-provider-filter"),
  modelSort: $("#model-sort"),
  refreshSelectedModelsButton: $("#refresh-selected-models"),
  refreshAllModelsButton: $("#refresh-all-models"),
  copyVisibleModelsButton: $("#copy-visible-models"),
  modelStatus: $("#model-status"),
  modelMetricAccounts: $("#model-metric-accounts"),
  modelMetricCached: $("#model-metric-cached"),
  modelMetricCount: $("#model-metric-count"),
  modelMetricUpdated: $("#model-metric-updated"),
  modelList: $("#model-list"),
  modelEmpty: $("#model-empty"),
  newBookmarkButton: $("#new-bookmark-button"),
  bookmarkEditor: $("#bookmark-editor"),
  bookmarkEditorTitle: $("#bookmark-editor-title"),
  bookmarkForm: $("#bookmark-form"),
  bookmarkId: $("#bookmark-id"),
  bookmarkName: $("#bookmark-name"),
  bookmarkUrl: $("#bookmark-url"),
  bookmarkTags: $("#bookmark-tags"),
  bookmarkTagOptions: $("#bookmark-tag-options"),
  bookmarkPinned: $("#bookmark-pinned"),
  bookmarkCurrentTab: $("#bookmark-current-tab"),
  bookmarkFormStatus: $("#bookmark-form-status"),
  cancelBookmarkEdit: $("#cancel-bookmark-edit"),
  bookmarkSearch: $("#bookmark-search"),
  bookmarkTagFilter: $("#bookmark-tag-filter"),
  bookmarkStatus: $("#bookmark-status"),
  bookmarkList: $("#bookmark-list"),
  bookmarkContextMenu: $("#bookmark-context-menu"),
  bookmarkEmpty: $("#bookmark-empty"),
  exportAllDataButton: $("#export-all-data"),
  exportAccountsDataButton: $("#export-accounts-data"),
  exportBookmarksDataButton: $("#export-bookmarks-data"),
  importBackupFile: $("#import-backup-file"),
  importDataPreview: $("#import-data-preview"),
  importValidation: $("#import-validation"),
  importDataButton: $("#import-data-button"),
  clearImportDataButton: $("#clear-import-data"),
  importExportStatus: $("#import-export-status"),
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
  renderModels();
  renderBookmarks();
  renderBookmarkFormTagOptions();
  renderImportValidation();
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

function getAccountLabel(account) {
  return account?.name || account?.username || account?.baseUrl || "未命名账号";
}

function renderModelAccountOptions() {
  const currentValue = elements.modelAccountFilter.value || "all";
  elements.modelAccountFilter.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "全部账号";
  elements.modelAccountFilter.appendChild(allOption);

  for (const account of appState.accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = getAccountLabel(account);
    elements.modelAccountFilter.appendChild(option);
  }

  const hasCurrentValue = currentValue === "all" || appState.accounts.some((account) => account.id === currentValue);
  elements.modelAccountFilter.value = hasCurrentValue ? currentValue : "all";
}

function getModelCacheEntries() {
  const accountIds = new Set(appState.accounts.map((account) => account.id));
  return Object.values(appState.modelCache || {})
    .filter((entry) => entry && accountIds.has(entry.accountId));
}

function inferModelProvider(modelName) {
  const name = String(modelName || "").toLowerCase();
  if (name.includes("claude")) return "anthropic";
  if (name.includes("gemini") || name.includes("palm")) return "google";
  if (name.includes("deepseek")) return "deepseek";
  if (name.includes("qwen") || name.includes("qwq")) return "qwen";
  if (name.includes("llama") || name.includes("meta-")) return "meta";
  if (name.includes("gpt") || name.includes("o1") || name.includes("o3") || name.includes("o4")) return "openai";
  return "other";
}

function getProviderLabel(provider) {
  const labels = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    deepseek: "DeepSeek",
    qwen: "Qwen",
    meta: "Meta",
    other: "其他"
  };
  return labels[provider] || provider || "其他";
}

function getModelSourceLabel(source) {
  if (source === "pricing") {
    return "定价接口";
  }
  if (source === "openai-compatible") {
    return "模型接口";
  }
  return "缓存";
}

function getFilteredModelRows() {
  const selectedAccountId = elements.modelAccountFilter.value;
  const keyword = elements.modelSearch.value.trim().toLowerCase();
  const providerFilter = elements.modelProviderFilter.value;
  const rows = [];

  for (const entry of getModelCacheEntries()) {
    if (selectedAccountId !== "all" && entry.accountId !== selectedAccountId) {
      continue;
    }

    const account = appState.accounts.find((item) => item.id === entry.accountId);
    for (const model of entry.models || []) {
      const provider = inferModelProvider(model.name);
      if (providerFilter !== "all" && provider !== providerFilter) {
        continue;
      }

      const searchText = [
        model.name,
        model.description,
        entry.accountName,
        entry.baseUrl,
        provider,
        ...(model.enableGroups || []),
        ...(model.endpointTypes || [])
      ].join(" ").toLowerCase();

      if (keyword && !searchText.includes(keyword)) {
        continue;
      }

      rows.push({ entry, account, model, provider });
    }
  }

  const sortMode = elements.modelSort.value;
  rows.sort((a, b) => {
    if (sortMode === "account") {
      return String(a.entry.accountName || "").localeCompare(String(b.entry.accountName || ""), "zh-CN");
    }
    if (sortMode === "provider") {
      const providerCompare = getProviderLabel(a.provider).localeCompare(getProviderLabel(b.provider), "zh-CN");
      if (providerCompare !== 0) return providerCompare;
    }
    return String(a.model.name || "").localeCompare(String(b.model.name || ""), "zh-CN");
  });

  return rows;
}

function renderModels() {
  renderModelAccountOptions();

  const entries = getModelCacheEntries();
  const rows = getFilteredModelRows();
  const canRefreshSelected = appState.accounts.length > 0 && elements.modelAccountFilter.value !== "all";
  const latestFetchedAt = entries
    .map((entry) => entry.fetchedAt)
    .filter(Boolean)
    .sort()
    .pop();

  elements.refreshSelectedModelsButton.disabled = modelRefreshInFlight || !canRefreshSelected;
  elements.refreshAllModelsButton.disabled = modelRefreshInFlight || appState.accounts.length === 0;
  elements.modelMetricAccounts.textContent = String(appState.accounts.length);
  elements.modelMetricCached.textContent = String(entries.filter((entry) => (entry.models || []).length > 0).length);
  elements.modelMetricCount.textContent = String(rows.length);
  elements.modelMetricUpdated.textContent = latestFetchedAt ? formatDateTime(latestFetchedAt) : "暂无";

  const errors = entries.filter((entry) => entry.error);
  if (errors.length && !elements.modelStatus.textContent) {
    elements.modelStatus.textContent = `${errors.length} 个账号最近刷新失败，可重新刷新查看详情。`;
    elements.modelStatus.className = "status error";
  }

  elements.modelList.replaceChildren();
  elements.modelEmpty.hidden = rows.length > 0;
  elements.modelEmpty.textContent = appState.accounts.length
    ? "还没有模型数据。请点击“刷新当前账号”或“刷新全部账号”。"
    : "还没有账号。请先在账号管理页添加账号。";

  for (const row of rows) {
    const card = document.createElement("article");
    card.className = "model-card";
    card.dataset.modelName = row.model.name;
    card.dataset.accountId = row.entry.accountId;
    const groups = (row.model.enableGroups || []).length ? row.model.enableGroups.join(", ") : "-";
    const endpoints = (row.model.endpointTypes || []).length ? row.model.endpointTypes.join(", ") : "-";
    const ratio = row.model.modelRatio === "" ? "-" : `${row.model.modelRatio}x`;
    const completionRatio = row.model.completionRatio === "" ? "-" : `${row.model.completionRatio}x`;
    const price = row.model.modelPrice || "-";

    card.innerHTML = `
      <div class="model-main">
        <div>
          <h3 title="${escapeHtml(row.model.name)}">${escapeHtml(row.model.name)}</h3>
          <p>${escapeHtml(row.entry.accountName || getAccountLabel(row.account))} · ${escapeHtml(row.entry.baseUrl || "")}</p>
        </div>
        <div class="badge-row">
          <span class="badge">${escapeHtml(getProviderLabel(row.provider))}</span>
          <span class="badge">${escapeHtml(row.model.quotaType || "按量")}</span>
          <span class="badge neutral">${escapeHtml(getModelSourceLabel(row.entry.source))}</span>
        </div>
      </div>
      <div class="model-detail-grid">
        <div class="model-detail"><span>倍率</span><strong title="${escapeHtml(ratio)}">${escapeHtml(ratio)}</strong></div>
        <div class="model-detail"><span>补全倍率</span><strong title="${escapeHtml(completionRatio)}">${escapeHtml(completionRatio)}</strong></div>
        <div class="model-detail"><span>价格</span><strong title="${escapeHtml(price)}">${escapeHtml(price)}</strong></div>
        <div class="model-detail"><span>分组</span><strong title="${escapeHtml(groups)}">${escapeHtml(groups)}</strong></div>
      </div>
      <div class="model-meta">
        <span>端点：${escapeHtml(endpoints)}</span>
        <span>刷新：${escapeHtml(formatDateTime(row.entry.fetchedAt))}</span>
      </div>
      <div class="model-actions">
        <button type="button" class="secondary-button" data-model-action="copy">复制模型名</button>
        <button type="button" class="secondary-button" data-model-action="open">打开站点</button>
      </div>
    `;

    elements.modelList.appendChild(card);
  }
}

function splitTags(value) {
  return Array.from(new Set(String(value || "")
    .split(/[,\n，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)));
}

function bookmarkMatchesFilters(bookmark) {
  const keyword = elements.bookmarkSearch.value.trim().toLowerCase();
  const tagFilter = getSelectedBookmarkTag();

  if (tagFilter !== "all" && !(bookmark.tags || []).includes(tagFilter)) {
    return false;
  }

  if (!keyword) {
    return true;
  }

  return [
    bookmark.name,
    bookmark.url,
    ...(bookmark.tags || [])
  ].some((value) => String(value || "").toLowerCase().includes(keyword));
}

function getSelectedBookmarkTag() {
  return elements.bookmarkTagFilter.dataset.value || "all";
}

function renderBookmarkTagOptions() {
  const currentValue = getSelectedBookmarkTag();
  const tags = getAllBookmarkTags();
  const tagCounts = new Map();
  const tagColors = getBookmarkTagColorMap();
  const selectedValue = currentValue === "all" || tags.includes(currentValue) ? currentValue : "all";

  elements.bookmarkTagFilter.replaceChildren();
  elements.bookmarkTagFilter.dataset.value = selectedValue;

  (appState.bookmarks || []).forEach((bookmark) => {
    (bookmark.tags || []).forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  const allButton = createBookmarkTagFilterButton({
    value: "all",
    label: "全部",
    count: appState.bookmarks.length,
    selected: selectedValue === "all"
  });
  elements.bookmarkTagFilter.appendChild(allButton);

  for (const tag of tags) {
    const button = createBookmarkTagFilterButton({
      value: tag,
      label: tag,
      count: tagCounts.get(tag) || 0,
      selected: selectedValue === tag,
      color: tagColors.get(tag)
    });
    elements.bookmarkTagFilter.appendChild(button);
  }
}

function createBookmarkTagFilterButton({ value, label, count, selected, color }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bookmark-tag-filter-button";
  button.dataset.bookmarkTag = value;
  button.setAttribute("aria-pressed", String(selected));

  if (selected) {
    button.classList.add("active");
  }
  if (color) {
    button.style.setProperty("--tag-bg", color.bg);
    button.style.setProperty("--tag-fg", color.fg);
    button.style.setProperty("--tag-border", color.border);
  }

  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const countElement = document.createElement("strong");
  countElement.textContent = String(count);
  button.append(labelElement, countElement);

  return button;
}

function getSortedBookmarks() {
  return [...(appState.bookmarks || [])].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

function getAllBookmarkTags() {
  return Array.from(new Set((appState.bookmarks || []).flatMap((bookmark) => bookmark.tags || [])))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function getBookmarkTagColorMap() {
  const tags = getAllBookmarkTags();
  const colors = new Map();
  const usedColorKeys = new Set();

  tags.forEach((tag, index) => {
    let attempt = 0;
    let candidateIndex = index;
    let hueKey = "";
    let bgSaturation = 82;
    let bgLightness = 94;
    let colorKey = "";

    do {
      candidateIndex = index + attempt * tags.length;
      hueKey = ((candidateIndex * 137.508) % 360).toFixed(1);
      bgSaturation = 82 - (Math.floor(candidateIndex / 3600) % 4) * 5;
      bgLightness = 94 - (Math.floor(candidateIndex / 14400) % 4) * 3;
      colorKey = `${hueKey}|${bgSaturation}|${bgLightness}`;
      attempt += 1;
    } while (usedColorKeys.has(colorKey));

    usedColorKeys.add(colorKey);
    colors.set(tag, {
      bg: `hsl(${hueKey} ${bgSaturation}% ${bgLightness}%)`,
      fg: `hsl(${hueKey} 58% 31%)`,
      border: `hsl(${hueKey} 62% 80%)`,
      cardBg: `linear-gradient(135deg, hsl(${hueKey} 76% 89%), hsl(${hueKey} 72% 95%))`,
      cardHoverBg: `linear-gradient(135deg, hsl(${hueKey} 78% 86%), hsl(${hueKey} 74% 93%))`,
      cardFg: `hsl(${hueKey} 58% 24%)`,
      cardMuted: `hsl(${hueKey} 46% 34%)`,
      cardBorder: `hsl(${hueKey} 62% 70%)`
    });
  });

  return colors;
}

function getBookmarkTagStyle(color) {
  return [
    `--tag-bg: ${color.bg}`,
    `--tag-fg: ${color.fg}`,
    `--tag-border: ${color.border}`
  ].join("; ");
}

function getBookmarkFormTags() {
  return splitTags(elements.bookmarkTags.value);
}

function setBookmarkFormTags(tags) {
  elements.bookmarkTags.value = Array.from(new Set(tags)).join(", ");
  renderBookmarkFormTagOptions();
}

function renderBookmarkFormTagOptions() {
  const tags = getAllBookmarkTags();
  const selectedTags = new Set(getBookmarkFormTags());
  const tagColors = getBookmarkTagColorMap();
  elements.bookmarkTagOptions.replaceChildren();
  elements.bookmarkTagOptions.hidden = tags.length === 0;

  for (const tag of tags) {
    const color = tagColors.get(tag);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bookmark-tag-option";
    button.dataset.bookmarkFormTag = tag;
    button.textContent = tag;
    button.setAttribute("aria-pressed", String(selectedTags.has(tag)));
    button.classList.toggle("active", selectedTags.has(tag));
    if (color) {
      button.style.setProperty("--tag-bg", color.bg);
      button.style.setProperty("--tag-fg", color.fg);
      button.style.setProperty("--tag-border", color.border);
    }
    elements.bookmarkTagOptions.appendChild(button);
  }
}

function toggleBookmarkFormTag(tag) {
  const tags = getBookmarkFormTags();
  const nextTags = tags.includes(tag)
    ? tags.filter((item) => item !== tag)
    : [...tags, tag];
  setBookmarkFormTags(nextTags);
}

function renderBookmarks() {
  renderBookmarkTagOptions();

  const bookmarks = getSortedBookmarks().filter(bookmarkMatchesFilters);
  const tagColors = getBookmarkTagColorMap();
  elements.bookmarkList.replaceChildren();
  elements.bookmarkEmpty.hidden = bookmarks.length > 0;
  elements.bookmarkEmpty.textContent = appState.bookmarks.length
    ? "没有匹配的书签。"
    : "还没有书签。添加书签后可在这里快速打开常用入口。";

  for (const bookmark of bookmarks) {
    const card = document.createElement("article");
    card.className = "bookmark-card";
    card.dataset.bookmarkId = bookmark.id;
    const primaryTag = (bookmark.tags || [])[0] || "";
    const primaryColor = primaryTag ? tagColors.get(primaryTag) : null;
    if (primaryColor) {
      card.style.setProperty("--bookmark-bg", primaryColor.cardBg);
      card.style.setProperty("--bookmark-bg-hover", primaryColor.cardHoverBg);
      card.style.setProperty("--bookmark-fg", primaryColor.cardFg);
      card.style.setProperty("--bookmark-muted", primaryColor.cardMuted);
      card.style.setProperty("--bookmark-border", primaryColor.cardBorder);
    }
    const tagsHtml = (bookmark.tags || [])
      .map((tag) => {
        const color = tagColors.get(tag);
        const style = color ? ` style="${escapeHtml(getBookmarkTagStyle(color))}"` : "";
        return `<span class="bookmark-tag"${style}>${escapeHtml(tag)}</span>`;
      })
      .join("");

    card.innerHTML = `
      <div class="bookmark-main">
        <div class="bookmark-info">
          <div class="bookmark-title-row">
            ${tagsHtml ? `<div class="bookmark-tags">${tagsHtml}</div>` : ""}
            <h3 title="${escapeHtml(bookmark.name)}">${escapeHtml(bookmark.name)}</h3>
            ${bookmark.pinned ? '<span class="bookmark-pin-indicator" title="已置顶" aria-label="已置顶"></span>' : ""}
          </div>
          <p title="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.url)}</p>
        </div>
      </div>
    `;

    elements.bookmarkList.appendChild(card);
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

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function getBackupDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildExportPayload(scope) {
  const includeAccounts = scope !== "bookmarks";
  const includeBookmarks = scope !== "accounts";
  const version = chrome.runtime.getManifest?.().version || "";

  return {
    version,
    source: "my-autosign",
    type: scope,
    timestamp: Date.now(),
    accounts: includeAccounts ? appState.accounts : [],
    bookmarks: includeBookmarks ? appState.bookmarks : []
  };
}

function exportBackup(scope) {
  const filenames = {
    all: `my-autosign-backup-${getBackupDateStamp()}.json`,
    accounts: `my-autosign-accounts-${getBackupDateStamp()}.json`,
    bookmarks: `my-autosign-bookmarks-${getBackupDateStamp()}.json`
  };
  const payload = buildExportPayload(scope);
  downloadJson(payload, filenames[scope] || filenames.all);

  const exportedAccounts = payload.accounts.length;
  const exportedBookmarks = payload.bookmarks.length;
  elements.importExportStatus.textContent = `已导出 ${exportedAccounts} 个账号、${exportedBookmarks} 个书签。`;
  elements.importExportStatus.className = "status success";
}

function firstArray(...values) {
  const arrays = values.filter((value) => Array.isArray(value));
  return arrays.find((value) => value.length > 0) || arrays[0] || [];
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isAccountLike(item) {
  return isPlainObject(item) && Boolean(
    item.baseUrl ||
    item.site_url ||
    item.account_info ||
    item.accessToken ||
    item.access_token ||
    item.userId ||
    item.user_id
  );
}

function isBookmarkLike(item) {
  return isPlainObject(item) && Boolean(item.url || item.href) && !isAccountLike(item);
}

function extractItabBookmarks(data) {
  const groups = Array.isArray(data?.navConfig) ? data.navConfig : [];
  const bookmarks = [];

  groups.forEach((group) => {
    const groupName = String(group?.name || "").trim();
    const children = Array.isArray(group?.children) ? group.children : [];

    children.forEach((item) => {
      const rawUrl = String(item?.url || "").trim();
      let parsedUrl;
      try {
        parsedUrl = new URL(rawUrl);
      } catch (error) {
        return;
      }

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return;
      }

      bookmarks.push({
        id: item?.id ? `itab-${item.id}` : undefined,
        name: String(item?.name || item?.title || parsedUrl.hostname).trim(),
        url: parsedUrl.toString(),
        tags: groupName ? [groupName] : ["iTab"]
      });
    });
  });

  return bookmarks;
}

function extractImportSections(data) {
  if (Array.isArray(data)) {
    return {
      accounts: data.filter(isAccountLike),
      bookmarks: data.filter(isBookmarkLike)
    };
  }

  const accountsContainer = data?.accounts;
  const legacyAccountsContainer = data?.data?.accounts;
  const accounts = firstArray(
    Array.isArray(accountsContainer) ? accountsContainer : accountsContainer?.accounts,
    Array.isArray(legacyAccountsContainer) ? legacyAccountsContainer : legacyAccountsContainer?.accounts,
    data?.accountData,
    data?.accountsData
  );
  const bookmarks = firstArray(
    data?.bookmarks,
    accountsContainer?.bookmarks,
    legacyAccountsContainer?.bookmarks,
    data?.data?.bookmarks,
    data?.siteBookmarks,
    extractItabBookmarks(data)
  );

  return { accounts, bookmarks };
}

function getTagNameMap(data) {
  const tagStore = data?.tagStore || data?.data?.tagStore;
  const tagsById = tagStore?.tagsById;
  const map = new Map();
  if (!tagsById || typeof tagsById !== "object") {
    return map;
  }

  Object.entries(tagsById).forEach(([id, tag]) => {
    const name = String(tag?.name || "").trim();
    if (id && name) {
      map.set(id, name);
    }
  });
  return map;
}

function withResolvedBookmarkTags(bookmark, tagNameMap) {
  if (!isPlainObject(bookmark)) {
    return bookmark || {};
  }

  if ((bookmark.tags || bookmark.tagNames)?.length || !Array.isArray(bookmark.tagIds)) {
    return bookmark;
  }

  return {
    ...bookmark,
    tags: bookmark.tagIds.map((tagId) => tagNameMap.get(tagId) || tagId)
  };
}

function accountImportKey(account) {
  const identity = String(account.userId || account.username || "").trim().toLowerCase();
  return [
    account.siteType || SITE_TYPES.NEW_API,
    normalizeBaseUrl(account.baseUrl),
    identity || "unknown-user"
  ].join("|");
}

function bookmarkImportKey(bookmark) {
  try {
    return new URL(bookmark.url).toString().toLowerCase();
  } catch (error) {
    return String(bookmark.url || "").trim().toLowerCase();
  }
}

function cloneWithUniqueId(item, prefix, usedIds) {
  if (!usedIds.has(item.id)) {
    usedIds.add(item.id);
    return item;
  }

  let id = createId(prefix);
  while (usedIds.has(id)) {
    id = createId(prefix);
  }
  usedIds.add(id);
  return { ...item, id };
}

function isValidImportedBookmark(bookmark) {
  try {
    const parsed = new URL(bookmark.url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch (error) {
    return false;
  }
}

function parseImportPreview() {
  const rawText = elements.importDataPreview.value.trim();
  if (!rawText) {
    return {
      valid: false,
      empty: true,
      message: "请选择备份文件或粘贴 JSON 数据。"
    };
  }

  try {
    const data = JSON.parse(rawText);
    const sections = extractImportSections(data);
    const normalizedAccounts = sections.accounts
      .map((account, index) => normalizeAccount(account, index))
      .filter((account) => account.baseUrl && (account.userId || account.username));
    const tagNameMap = getTagNameMap(data);
    const normalizedBookmarks = sections.bookmarks
      .map((bookmark, index) => normalizeBookmark(withResolvedBookmarkTags(bookmark, tagNameMap), index))
      .filter((bookmark) => bookmark.name && isValidImportedBookmark(bookmark));

    if (!normalizedAccounts.length && !normalizedBookmarks.length) {
      return {
        valid: false,
        message: "没有找到可导入的账号或书签数据。"
      };
    }

    return {
      valid: true,
      data,
      accountCount: normalizedAccounts.length,
      bookmarkCount: normalizedBookmarks.length,
      message: `格式正确：包含 ${normalizedAccounts.length} 个账号、${normalizedBookmarks.length} 个书签。`
    };
  } catch (error) {
    return {
      valid: false,
      message: "JSON 格式不正确，请检查备份内容。"
    };
  }
}

function renderImportValidation() {
  const preview = parseImportPreview();
  elements.importDataButton.disabled = !preview.valid;
  elements.importValidation.hidden = preview.empty;
  elements.importValidation.textContent = preview.message;
  elements.importValidation.className = `validation-box ${preview.valid ? "success" : "error"}`;
  return preview;
}

async function importBackupData() {
  const preview = renderImportValidation();
  if (!preview.valid) {
    elements.importExportStatus.textContent = preview.message;
    elements.importExportStatus.className = "status error";
    return;
  }

  const sections = extractImportSections(preview.data);
  const tagNameMap = getTagNameMap(preview.data);
  const existingAccountKeys = new Set(appState.accounts.map(accountImportKey));
  const existingBookmarkKeys = new Set(appState.bookmarks.map(bookmarkImportKey));
  const usedAccountIds = new Set(appState.accounts.map((account) => account.id));
  const usedBookmarkIds = new Set(appState.bookmarks.map((bookmark) => bookmark.id));
  const nextAccounts = [...appState.accounts];
  const nextBookmarks = [...appState.bookmarks];
  const result = {
    accountsAdded: 0,
    accountsSkipped: 0,
    accountsInvalid: 0,
    bookmarksAdded: 0,
    bookmarksSkipped: 0,
    bookmarksInvalid: 0
  };

  sections.accounts.forEach((rawAccount, index) => {
    const normalized = normalizeAccount(rawAccount, index);
    if (!normalized.baseUrl || (!normalized.userId && !normalized.username)) {
      result.accountsInvalid += 1;
      return;
    }

    const key = accountImportKey(normalized);
    if (existingAccountKeys.has(key)) {
      result.accountsSkipped += 1;
      return;
    }

    const account = cloneWithUniqueId(normalized, "account", usedAccountIds);
    nextAccounts.push(account);
    existingAccountKeys.add(key);
    result.accountsAdded += 1;
  });

  sections.bookmarks.forEach((rawBookmark, index) => {
    const normalized = normalizeBookmark(withResolvedBookmarkTags(rawBookmark, tagNameMap), index);
    if (!normalized.name || !isValidImportedBookmark(normalized)) {
      result.bookmarksInvalid += 1;
      return;
    }

    const key = bookmarkImportKey(normalized);
    if (existingBookmarkKeys.has(key)) {
      result.bookmarksSkipped += 1;
      return;
    }

    const bookmark = cloneWithUniqueId(normalized, "bookmark", usedBookmarkIds);
    nextBookmarks.push(bookmark);
    existingBookmarkKeys.add(key);
    result.bookmarksAdded += 1;
  });

  if (!result.accountsAdded && !result.bookmarksAdded) {
    elements.importExportStatus.textContent = "没有新增数据：导入内容都已存在，或字段不完整。";
    elements.importExportStatus.className = "status error";
    return;
  }

  elements.importDataButton.disabled = true;
  elements.importExportStatus.textContent = "正在导入数据...";
  elements.importExportStatus.className = "status";

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCOUNTS]: nextAccounts,
      [STORAGE_KEYS.BOOKMARKS]: nextBookmarks
    });
    await loadState();
    renderImportValidation();

    elements.importExportStatus.textContent = [
      `导入完成：新增 ${result.accountsAdded} 个账号、${result.bookmarksAdded} 个书签`,
      `跳过 ${result.accountsSkipped} 个重复账号、${result.bookmarksSkipped} 个重复书签`,
      `忽略 ${result.accountsInvalid} 个无效账号、${result.bookmarksInvalid} 个无效书签`
    ].join("；");
    elements.importExportStatus.className = "status success";
  } catch (error) {
    elements.importExportStatus.textContent = `导入失败：${error.message}`;
    elements.importExportStatus.className = "status error";
  } finally {
    elements.importDataButton.disabled = false;
  }
}

async function readImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    elements.importDataPreview.value = await file.text();
    elements.importExportStatus.textContent = `已读取文件：${file.name}`;
    elements.importExportStatus.className = "status";
  } catch (error) {
    elements.importExportStatus.textContent = `读取文件失败：${error.message}`;
    elements.importExportStatus.className = "status error";
  }
  renderImportValidation();
}

function getSelectedModelAccountId() {
  const selected = elements.modelAccountFilter.value;
  if (selected !== "all") {
    return selected;
  }
  return "";
}

async function refreshModels(scope) {
  const isAll = scope === "all";
  const button = isAll ? elements.refreshAllModelsButton : elements.refreshSelectedModelsButton;
  const accountId = getSelectedModelAccountId();

  if (!isAll && !accountId) {
    elements.modelStatus.textContent = appState.accounts.length ? "请先在数据源中选择一个具体账号，或刷新全部账号。" : "请先添加账号。";
    elements.modelStatus.className = "status error";
    return;
  }

  modelRefreshInFlight = true;
  renderModels();
  button.disabled = true;
  elements.modelStatus.textContent = isAll ? "正在刷新全部账号模型..." : "正在刷新当前账号模型...";
  elements.modelStatus.className = "status";

  try {
    if (isAll) {
      const response = await sendMessage("refresh-all-models");
      const failed = (response.data?.results || []).filter((item) => !item.ok);
      await loadState();
      elements.modelStatus.textContent = failed.length
        ? `模型刷新完成，${failed.length} 个账号失败。`
        : "模型刷新完成。";
      elements.modelStatus.className = failed.length ? "status error" : "status success";
      return;
    }

    await sendMessage("refresh-account-models", { accountId });
    await loadState();
    elements.modelStatus.textContent = "当前账号模型已刷新。";
    elements.modelStatus.className = "status success";
  } catch (error) {
    elements.modelStatus.textContent = `模型刷新失败：${error.message}`;
    elements.modelStatus.className = "status error";
    await loadState();
  } finally {
    modelRefreshInFlight = false;
    renderModels();
  }
}

async function copyVisibleModelNames() {
  const names = Array.from(new Set(getFilteredModelRows().map((row) => row.model.name)));
  if (!names.length) {
    elements.modelStatus.textContent = "当前没有可复制的模型。";
    elements.modelStatus.className = "status error";
    return;
  }

  await copyText(names.join("\n"));
  elements.modelStatus.textContent = `已复制 ${names.length} 个模型名。`;
  elements.modelStatus.className = "status success";
}

function getEmptyBookmark() {
  return normalizeBookmark({
    name: "",
    url: "",
    tags: [],
    notes: "",
    pinned: false
  });
}

function fillBookmarkForm(bookmark) {
  editingBookmarkId = bookmark?.id || null;
  const draft = bookmark || getEmptyBookmark();
  elements.bookmarkEditorTitle.textContent = editingBookmarkId ? "编辑书签" : "添加书签";
  elements.bookmarkId.value = draft.id || "";
  elements.bookmarkName.value = draft.name || "";
  elements.bookmarkUrl.value = draft.url || "";
  elements.bookmarkTags.value = (draft.tags || []).join(", ");
  renderBookmarkFormTagOptions();
  elements.bookmarkPinned.checked = draft.pinned === true;
  elements.bookmarkFormStatus.textContent = "";
  elements.bookmarkEditor.hidden = false;
  elements.bookmarkName.focus();
}

function readBookmarkForm() {
  return normalizeBookmark({
    id: elements.bookmarkId.value || undefined,
    name: elements.bookmarkName.value,
    url: elements.bookmarkUrl.value,
    tags: splitTags(elements.bookmarkTags.value),
    notes: "",
    pinned: elements.bookmarkPinned.checked,
    createdAt: appState.bookmarks.find((bookmark) => bookmark.id === elements.bookmarkId.value)?.createdAt
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

function getBookmarkByCard(card) {
  return appState.bookmarks.find((item) => item.id === card?.dataset.bookmarkId) || null;
}

function hideBookmarkContextMenu() {
  elements.bookmarkContextMenu.hidden = true;
  elements.bookmarkContextMenu.dataset.bookmarkId = "";
}

function showBookmarkContextMenu(event, bookmark) {
  event.preventDefault();
  elements.bookmarkContextMenu.dataset.bookmarkId = bookmark.id;
  elements.bookmarkContextMenu.innerHTML = `
    <button type="button" data-bookmark-action="open" role="menuitem">打开</button>
    <button type="button" data-bookmark-action="copy" role="menuitem">复制链接</button>
    <button type="button" data-bookmark-action="pin" role="menuitem">${bookmark.pinned ? "取消置顶" : "置顶"}</button>
    <button type="button" data-bookmark-action="edit" role="menuitem">编辑</button>
    <button type="button" data-bookmark-action="delete" role="menuitem" class="danger">删除</button>
  `;
  elements.bookmarkContextMenu.hidden = false;

  const rect = elements.bookmarkContextMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8));
  elements.bookmarkContextMenu.style.left = `${left}px`;
  elements.bookmarkContextMenu.style.top = `${top}px`;
}

async function handleBookmarkAction(bookmark, action) {
  if (action === "open") {
    await sendMessage("open-account-site", { url: bookmark.url });
    return;
  }
  if (action === "copy") {
    await copyText(bookmark.url);
    elements.bookmarkStatus.textContent = `已复制书签链接：${bookmark.name}`;
    elements.bookmarkStatus.className = "status success";
    return;
  }
  if (action === "pin") {
    await sendMessage("save-bookmark", { bookmark: { ...bookmark, pinned: !bookmark.pinned } });
    await loadState();
    elements.bookmarkStatus.textContent = bookmark.pinned ? "已取消置顶。" : "书签已置顶。";
    elements.bookmarkStatus.className = "status success";
    return;
  }
  if (action === "edit") {
    fillBookmarkForm(bookmark);
    return;
  }
  if (action === "delete" && confirm(`确定删除书签「${bookmark.name}」吗？`)) {
    await sendMessage("delete-bookmark", { bookmarkId: bookmark.id });
    await loadState();
    elements.bookmarkStatus.textContent = "书签已删除。";
    elements.bookmarkStatus.className = "status success";
  }
}

async function saveBookmarkFromForm(event) {
  event.preventDefault();
  const bookmark = readBookmarkForm();
  const validationError = validateBookmark(bookmark);
  if (validationError) {
    elements.bookmarkFormStatus.textContent = validationError;
    elements.bookmarkFormStatus.className = "status error";
    return;
  }

  elements.bookmarkFormStatus.textContent = "正在保存书签...";
  elements.bookmarkFormStatus.className = "status";

  try {
    await sendMessage("save-bookmark", { bookmark });
    elements.bookmarkFormStatus.textContent = "书签已保存。";
    elements.bookmarkFormStatus.className = "status success";
    elements.bookmarkEditor.hidden = true;
    editingBookmarkId = null;
    await loadState();
  } catch (error) {
    elements.bookmarkFormStatus.textContent = `保存失败：${error.message}`;
    elements.bookmarkFormStatus.className = "status error";
  }
}

async function fillBookmarkFromCurrentTab() {
  elements.bookmarkCurrentTab.disabled = true;
  elements.bookmarkFormStatus.textContent = "正在读取当前标签页...";
  elements.bookmarkFormStatus.className = "status";

  try {
    const response = await sendMessage("get-active-tab-info");
    const tab = response.tab || {};
    const parsed = new URL(tab.url || "");
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("当前标签页不是 http 或 https 页面。");
    }

    elements.bookmarkUrl.value = parsed.toString();
    if (!elements.bookmarkName.value.trim()) {
      elements.bookmarkName.value = tab.title || parsed.hostname;
    }
    elements.bookmarkFormStatus.textContent = "已填入当前标签页。";
    elements.bookmarkFormStatus.className = "status success";
  } catch (error) {
    elements.bookmarkFormStatus.textContent = `读取失败：${error.message}`;
    elements.bookmarkFormStatus.className = "status error";
  } finally {
    elements.bookmarkCurrentTab.disabled = false;
  }
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
  elements.modelAccountFilter.addEventListener("change", renderModels);
  elements.modelSearch.addEventListener("input", renderModels);
  elements.modelProviderFilter.addEventListener("change", renderModels);
  elements.modelSort.addEventListener("change", renderModels);
  elements.refreshSelectedModelsButton.addEventListener("click", () => void refreshModels("selected"));
  elements.refreshAllModelsButton.addEventListener("click", () => void refreshModels("all"));
  elements.copyVisibleModelsButton.addEventListener("click", () => void copyVisibleModelNames());
  elements.modelList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-model-action]");
    if (!button) return;
    const card = button.closest(".model-card");
    const modelName = card?.dataset.modelName || "";
    const account = appState.accounts.find((item) => item.id === card?.dataset.accountId);

    if (button.dataset.modelAction === "copy") {
      await copyText(modelName);
      elements.modelStatus.textContent = `已复制模型名：${modelName}`;
      elements.modelStatus.className = "status success";
      return;
    }

    if (button.dataset.modelAction === "open" && account) {
      await sendMessage("open-account-site", { url: account.baseUrl });
    }
  });

  elements.newBookmarkButton.addEventListener("click", () => fillBookmarkForm(null));
  elements.cancelBookmarkEdit.addEventListener("click", () => {
    elements.bookmarkEditor.hidden = true;
    editingBookmarkId = null;
  });
  elements.bookmarkForm.addEventListener("submit", saveBookmarkFromForm);
  elements.bookmarkCurrentTab.addEventListener("click", () => void fillBookmarkFromCurrentTab());
  elements.bookmarkTags.addEventListener("input", renderBookmarkFormTagOptions);
  elements.bookmarkTagOptions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-bookmark-form-tag]");
    if (!button) return;
    toggleBookmarkFormTag(button.dataset.bookmarkFormTag || "");
  });
  elements.bookmarkSearch.addEventListener("input", renderBookmarks);
  elements.bookmarkTagFilter.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-bookmark-tag]");
    if (!button) return;

    elements.bookmarkTagFilter.dataset.value = button.dataset.bookmarkTag || "all";
    hideBookmarkContextMenu();
    renderBookmarks();
  });
  elements.bookmarkList.addEventListener("click", async (event) => {
    const card = event.target.closest(".bookmark-card");
    const bookmark = getBookmarkByCard(card);
    if (!bookmark) return;

    hideBookmarkContextMenu();
    await handleBookmarkAction(bookmark, "open");
  });
  elements.bookmarkList.addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".bookmark-card");
    const bookmark = getBookmarkByCard(card);
    if (!bookmark) return;

    showBookmarkContextMenu(event, bookmark);
  });
  elements.bookmarkContextMenu.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-bookmark-action]");
    const bookmark = appState.bookmarks.find((item) => item.id === elements.bookmarkContextMenu.dataset.bookmarkId);
    if (!button || !bookmark) return;

    const action = button.dataset.bookmarkAction;
    hideBookmarkContextMenu();
    await handleBookmarkAction(bookmark, action);
  });
  document.addEventListener("click", (event) => {
    if (!elements.bookmarkContextMenu.hidden && !elements.bookmarkContextMenu.contains(event.target)) {
      hideBookmarkContextMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideBookmarkContextMenu();
    }
  });

  elements.exportAllDataButton.addEventListener("click", () => exportBackup("all"));
  elements.exportAccountsDataButton.addEventListener("click", () => exportBackup("accounts"));
  elements.exportBookmarksDataButton.addEventListener("click", () => exportBackup("bookmarks"));
  elements.importBackupFile.addEventListener("change", (event) => void readImportFile(event));
  elements.importDataPreview.addEventListener("input", renderImportValidation);
  elements.importDataButton.addEventListener("click", () => void importBackupData());
  elements.clearImportDataButton.addEventListener("click", () => {
    elements.importBackupFile.value = "";
    elements.importDataPreview.value = "";
    elements.importExportStatus.textContent = "";
    renderImportValidation();
  });

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
        changes[STORAGE_KEYS.BOOKMARKS] ||
        changes[STORAGE_KEYS.MODEL_CACHE] ||
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
