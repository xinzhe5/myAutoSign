(function initMyAutoSignContent() {
  if (globalThis.__MY_AUTOSIGN_CONTENT_READY__) {
    return;
  }
  globalThis.__MY_AUTOSIGN_CONTENT_READY__ = true;

  const MESSAGE_TYPE = "myautosign-detect-site";
  const SUB2API_AUTH_STORAGE_KEYS = {
    accessToken: "auth_token",
    refreshToken: "refresh_token",
    tokenExpiresAt: "token_expires_at",
    authUser: "auth_user"
  };
  const SUB2API_TOKEN_REFRESH_BUFFER_MS = 120 * 1000;

  function safeJsonParse(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  function readStorageValue(storage, key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function pickTokenFromText(value) {
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    const parsed = safeJsonParse(trimmed);
    if (parsed) {
      return pickToken(parsed);
    }
    return trimmed;
  }

  function pickToken(value) {
    if (!value || typeof value !== "object") {
      return "";
    }
    return String(
      value.access_token ||
      value.accessToken ||
      value.token ||
      value.user_token ||
      value.api_token ||
      ""
    ).trim();
  }

  function tryParseTimestamp(value) {
    if (!value) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getEmailLocalPart(value) {
    const email = String(value || "").trim();
    const atIndex = email.indexOf("@");
    return atIndex > 0 ? email.slice(0, atIndex) : email;
  }

  async function refreshSub2ApiTokensIfNeeded(baseUrl, accessToken) {
    const refreshToken = String(readStorageValue(localStorage, SUB2API_AUTH_STORAGE_KEYS.refreshToken) || "").trim();
    const tokenExpiresAt = tryParseTimestamp(readStorageValue(localStorage, SUB2API_AUTH_STORAGE_KEYS.tokenExpiresAt));
    if (!refreshToken || tokenExpiresAt === null) {
      return null;
    }

    const now = Date.now();
    const msUntilExpiry = tokenExpiresAt - now;
    if (msUntilExpiry > SUB2API_TOKEN_REFRESH_BUFFER_MS) {
      return null;
    }
    const isExpired = msUntilExpiry <= 0;

    let payload = null;
    try {
      const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      if (isExpired) {
        throw error;
      }
      return null;
    }

    if (!payload || typeof payload !== "object" || payload.code !== 0 || !payload.data) {
      if (isExpired) {
        throw new Error("Sub2API token refresh failed");
      }
      return null;
    }

    const nextAccessToken = typeof payload.data.access_token === "string"
      ? payload.data.access_token.trim()
      : "";
    const nextRefreshToken = typeof payload.data.refresh_token === "string"
      ? payload.data.refresh_token.trim()
      : "";
    const expiresInSeconds = typeof payload.data.expires_in === "number"
      ? payload.data.expires_in
      : 0;

    if (!nextAccessToken || !nextRefreshToken || expiresInSeconds <= 0) {
      if (isExpired) {
        throw new Error("Sub2API token refresh failed");
      }
      return null;
    }

    const nextExpiresAt = now + expiresInSeconds * 1000;
    localStorage.setItem(SUB2API_AUTH_STORAGE_KEYS.accessToken, nextAccessToken);
    localStorage.setItem(SUB2API_AUTH_STORAGE_KEYS.refreshToken, nextRefreshToken);
    localStorage.setItem(SUB2API_AUTH_STORAGE_KEYS.tokenExpiresAt, String(nextExpiresAt));

    return {
      accessToken: nextAccessToken
    };
  }

  async function readSub2ApiIdentity(baseUrl) {
    const authTokenRaw = readStorageValue(localStorage, SUB2API_AUTH_STORAGE_KEYS.accessToken);
    const authUserRaw = readStorageValue(localStorage, SUB2API_AUTH_STORAGE_KEYS.authUser);
    if (authTokenRaw === null || authUserRaw === null) {
      return {};
    }

    let accessToken = String(authTokenRaw || "").trim();
    if (!accessToken) {
      return {};
    }

    try {
      const refreshed = await refreshSub2ApiTokensIfNeeded(baseUrl, accessToken);
      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken;
      }
    } catch (error) {
      return {};
    }

    const authUser = safeJsonParse(authUserRaw);
    if (!authUser || typeof authUser !== "object") {
      return {};
    }

    const userId = authUser.id ?? authUser.user_id ?? authUser.userId ?? authUser.uid;
    const username = authUser.username ||
      authUser.name ||
      authUser.display_name ||
      getEmailLocalPart(authUser.email);

    return {
      userId: userId === undefined || userId === null ? "" : String(userId),
      username: String(username || ""),
      accessToken
    };
  }

  function pickUser(value) {
    if (!value || typeof value !== "object") {
      return {};
    }
    const user = value.user && typeof value.user === "object" ? value.user : value;
    return {
      id: user.id ?? user.user_id ?? user.userId ?? user.uid ?? value.userId ?? value.id,
      username: user.username || user.name || user.display_name || user.email || value.username || "",
      accessToken: pickToken(user) || pickToken(value)
    };
  }

  async function readLocalIdentity(baseUrl) {
    const sub2ApiIdentity = await readSub2ApiIdentity(baseUrl);
    if (sub2ApiIdentity.userId || sub2ApiIdentity.username || sub2ApiIdentity.accessToken) {
      return sub2ApiIdentity;
    }

    const storages = [localStorage, sessionStorage];
    const userKeys = ["user", "user_info", "userInfo", "account", "auth_user"];
    const tokenKeys = ["auth_token", "authToken", "access_token", "accessToken", "token", "jwt", "jwt_token", "user_token", "api_token"];
    let bestUser = {};
    let bestToken = "";

    for (const storage of storages) {
      for (const key of userKeys) {
        const parsed = safeJsonParse(readStorageValue(storage, key));
        const user = pickUser(parsed);
        if (user.id || user.username || user.accessToken) {
          bestUser = { ...bestUser, ...user };
        }
      }

      for (const key of tokenKeys) {
        const token = pickTokenFromText(readStorageValue(storage, key));
        if (token) {
          bestToken = token;
          break;
        }
      }
    }

    return {
      userId: bestUser.id === undefined || bestUser.id === null ? "" : String(bestUser.id),
      username: String(bestUser.username || ""),
      accessToken: String(bestUser.accessToken || bestToken || "")
    };
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

  function shouldFetchSystemAccessToken(siteType) {
    return siteType === "new-api";
  }

  async function fetchSelf(baseUrl, accessToken) {
    const headers = {
      Accept: "application/json"
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${baseUrl}/api/user/self`, {
      method: "GET",
      headers,
      credentials: "include"
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    return {
      ok: response.ok,
      status: response.status,
      data
    };
  }

  async function fetchSystemAccessToken(baseUrl, accessToken, userId) {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Pragma: "no-cache",
      ...buildCompatUserIdHeaders(userId)
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${baseUrl}/api/user/token`, {
      method: "GET",
      headers,
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) {
      return "";
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    const value = data?.data !== undefined ? data.data : data;
    return typeof value === "string" ? value.trim() : pickToken(value);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) {
      return false;
    }

    (async () => {
      const baseUrl = String(message.baseUrl || location.origin).replace(/\/+$/, "");
      const useSystemAccessTokenFlow = shouldFetchSystemAccessToken(message.siteType);
      const localIdentity = await readLocalIdentity(baseUrl);
      let apiIdentity = {};
      let apiStatus = null;

      try {
        const self = await fetchSelf(
          baseUrl,
          useSystemAccessTokenFlow ? "" : localIdentity.accessToken
        );
        apiStatus = self.status;
        if (self.ok && self.data) {
          apiIdentity = pickUser(self.data.data || self.data);
        }
      } catch (error) {
        apiStatus = "error";
      }

      const merged = {
        userId: String(apiIdentity.id ?? localIdentity.userId ?? ""),
        username: String(apiIdentity.username || localIdentity.username || ""),
        accessToken: String(
          apiIdentity.accessToken ||
          (useSystemAccessTokenFlow ? "" : localIdentity.accessToken) ||
          ""
        )
      };

      if (!merged.accessToken && useSystemAccessTokenFlow) {
        try {
          merged.accessToken = await fetchSystemAccessToken(
            baseUrl,
            "",
            merged.userId
          );
        } catch (error) {
          // Keep the user identity result even if the optional token endpoint fails.
        }
      }

      sendResponse({
        ok: Boolean(merged.userId || merged.username || merged.accessToken),
        data: merged,
        apiStatus
      });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || String(error)
      });
    });

    return true;
  });
})();
