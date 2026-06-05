(function initMyAutoSignShared(global) {
  const SITE_TYPES = {
    NEW_API: "new-api",
    ANYROUTER: "anyrouter"
  };

  const SITE_TYPE_LABELS = {
    [SITE_TYPES.NEW_API]: "New API",
    [SITE_TYPES.ANYROUTER]: "AnyRouter"
  };

  const AUTH_TYPES = {
    ACCESS_TOKEN: "access-token",
    COOKIE: "cookie"
  };

  const CHECKIN_STATUS = {
    SUCCESS: "success",
    ALREADY_CHECKED: "already_checked",
    FAILED: "failed",
    SKIPPED: "skipped",
    CONFIG_ERROR: "config_error",
    TURNSTILE_REQUIRED: "turnstile_required"
  };

  const RUN_RESULT = {
    SUCCESS: "success",
    PARTIAL: "partial",
    FAILED: "failed",
    SKIPPED: "skipped"
  };

  const STORAGE_KEYS = {
    LEGACY_SCHEDULE_TIME: "scheduleTime",
    LEGACY_NEW_API_CONFIG: "newApiCheckinConfig",
    LEGACY_LAST_CHECKIN_RESULT: "lastNewApiCheckinResult",
    LEGACY_LAST_CHECKIN_DATE: "lastNewApiCheckinDate",
    LAST_OPENED_DATE: "lastOpenedDate",
    LAST_OPEN_RESULT: "lastOpenResult",
    ACCOUNTS: "accounts",
    AUTO_CHECKIN_SETTINGS: "autoCheckinSettings",
    AUTO_CHECKIN_STATUS: "autoCheckinStatus",
    LAST_AUTO_CHECKIN_DAILY_RUN_DAY: "lastAutoCheckinDailyRunDay",
    MIGRATION_STATE: "migrationState"
  };

  const DEFAULTS = {
    scheduleTime: "09:00",
    windowStart: "09:00",
    windowEnd: "09:30",
    retryEnabled: false,
    maxRetryPerDay: 2,
    retryIntervalMinutes: 60
  };

  function toStringValue(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function normalizeBaseUrl(baseUrl) {
    const value = toStringValue(baseUrl).trim();
    if (!value) {
      return "";
    }

    try {
      const parsed = new URL(value.includes("://") ? value : `https://${value}`);
      return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
    } catch (error) {
      return value.replace(/\/+$/, "");
    }
  }

  function getHostname(value) {
    try {
      return new URL(normalizeBaseUrl(value)).hostname.toLowerCase();
    } catch (error) {
      return "";
    }
  }

  function detectSiteType(baseUrl, fallback = SITE_TYPES.NEW_API) {
    const hostname = getHostname(baseUrl);
    if (hostname === "anyrouter.top" || hostname.endsWith(".anyrouter.top")) {
      return SITE_TYPES.ANYROUTER;
    }
    return isKnownSiteType(fallback) ? fallback : SITE_TYPES.NEW_API;
  }

  function getDefaultAuthType(siteType, baseUrl) {
    const resolvedSiteType = detectSiteType(baseUrl, siteType);
    return resolvedSiteType === SITE_TYPES.ANYROUTER
      ? AUTH_TYPES.COOKIE
      : AUTH_TYPES.ACCESS_TOKEN;
  }

  function isKnownSiteType(value) {
    return Object.values(SITE_TYPES).includes(value);
  }

  function isKnownAuthType(value) {
    return Object.values(AUTH_TYPES).includes(value);
  }

  function createId(prefix) {
    if (global.crypto?.randomUUID) {
      return `${prefix}-${global.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeAccount(account = {}, index = 0) {
    const baseUrl = normalizeBaseUrl(account.baseUrl || account.site_url || account.url);
    const siteType = isKnownSiteType(account.siteType)
      ? account.siteType
      : detectSiteType(baseUrl, SITE_TYPES.NEW_API);
    const authType = isKnownAuthType(account.authType)
      ? account.authType
      : getDefaultAuthType(siteType, baseUrl);
    const nowIso = new Date().toISOString();

    return {
      id: toStringValue(account.id || createId(`account-${index + 1}`)),
      enabled: account.enabled !== false,
      name: toStringValue(account.name || account.siteName || ""),
      siteType,
      baseUrl,
      authType,
      username: toStringValue(account.username || ""),
      userId: toStringValue(account.userId || account.user_id || ""),
      accessToken: toStringValue(account.accessToken || account.access_token || "").trim(),
      cookie: toStringValue(account.cookie || account.cookieAuthSessionCookie || "").trim(),
      turnstileToken: toStringValue(account.turnstileToken || "").trim(),
      autoCheckinEnabled: account.autoCheckinEnabled !== false,
      notes: toStringValue(account.notes || ""),
      createdAt: toStringValue(account.createdAt || nowIso),
      updatedAt: toStringValue(account.updatedAt || nowIso)
    };
  }

  function normalizeAccounts(accounts) {
    if (!Array.isArray(accounts)) {
      return [];
    }
    return accounts
      .map((account, index) => normalizeAccount(account, index))
      .filter((account) => account.baseUrl);
  }

  function normalizeSettings(settings = {}, legacyScheduleTime) {
    const fallbackTime = legacyScheduleTime || DEFAULTS.scheduleTime;
    return {
      enabled: Boolean(settings.enabled),
      windowStart: toStringValue(settings.windowStart || fallbackTime || DEFAULTS.windowStart),
      windowEnd: toStringValue(settings.windowEnd || addMinutesToTime(fallbackTime, 30)),
      retryEnabled: settings.retryEnabled === true,
      maxRetryPerDay: Math.max(0, Number(settings.maxRetryPerDay || DEFAULTS.maxRetryPerDay)),
      retryIntervalMinutes: Math.max(1, Number(settings.retryIntervalMinutes || DEFAULTS.retryIntervalMinutes))
    };
  }

  function parseTimeMinutes(timeString) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(toStringValue(timeString));
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  }

  function formatMinutesAsTime(minutes) {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const mins = normalized % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  }

  function addMinutesToTime(timeString, amount) {
    const minutes = parseTimeMinutes(timeString);
    if (minutes === null) {
      return DEFAULTS.windowEnd;
    }
    return formatMinutesAsTime(minutes + amount);
  }

  function getTodayKey(date = new Date()) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function statusIsSuccess(status) {
    return status === CHECKIN_STATUS.SUCCESS || status === CHECKIN_STATUS.ALREADY_CHECKED;
  }

  function getRunResult(summary) {
    if (!summary || summary.executed === 0) {
      return RUN_RESULT.SKIPPED;
    }
    if (summary.failedCount > 0 && summary.successCount > 0) {
      return RUN_RESULT.PARTIAL;
    }
    if (summary.failedCount > 0) {
      return RUN_RESULT.FAILED;
    }
    return RUN_RESULT.SUCCESS;
  }

  function summarizeResults(results) {
    const values = Array.isArray(results) ? results : [];
    const successCount = values.filter((result) => statusIsSuccess(result.status)).length;
    const failedCount = values.filter((result) => result.status === CHECKIN_STATUS.FAILED).length;
    const skippedCount = values.filter((result) => (
      result.status === CHECKIN_STATUS.SKIPPED ||
      result.status === CHECKIN_STATUS.CONFIG_ERROR ||
      result.status === CHECKIN_STATUS.TURNSTILE_REQUIRED
    )).length;

    return {
      totalEligible: values.length,
      executed: successCount + failedCount,
      successCount,
      failedCount,
      skippedCount,
      needsRetry: failedCount > 0
    };
  }

  global.MyAutoSignShared = {
    SITE_TYPES,
    SITE_TYPE_LABELS,
    AUTH_TYPES,
    CHECKIN_STATUS,
    RUN_RESULT,
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
    formatMinutesAsTime,
    addMinutesToTime,
    getTodayKey,
    statusIsSuccess,
    getRunResult,
    summarizeResults,
    createId,
    toStringValue
  };
})(globalThis);
