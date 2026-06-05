(function initMyAutoSignContent() {
  const MESSAGE_TYPE = "myautosign-detect-site";

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

  function readLocalIdentity() {
    const storages = [localStorage, sessionStorage];
    const userKeys = ["user", "user_info", "userInfo", "account", "auth_user"];
    const tokenKeys = ["access_token", "accessToken", "token", "user_token", "api_token"];
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) {
      return false;
    }

    (async () => {
      const baseUrl = String(message.baseUrl || location.origin).replace(/\/+$/, "");
      const localIdentity = readLocalIdentity();
      let apiIdentity = {};
      let apiStatus = null;

      try {
        const self = await fetchSelf(baseUrl, localIdentity.accessToken);
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
        accessToken: String(apiIdentity.accessToken || localIdentity.accessToken || "")
      };

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
