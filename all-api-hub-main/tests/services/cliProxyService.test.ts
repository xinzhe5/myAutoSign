import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CLI_PROXY_PROVIDER_TYPES } from "~/services/integrations/cliProxyProviderTypes"
import {
  importToCliProxy,
  verifyCliProxyManagementConnection,
  type ImportToCliProxyOptions,
} from "~/services/integrations/cliProxyService"
import { userPreferences } from "~/services/preferences/userPreferences"
import { server } from "~~/tests/msw/server"
import {
  buildApiToken,
  buildDisplaySiteData,
} from "~~/tests/test-utils/factories"

/**
 * Stub `userPreferences.getPreferences` with a CLI Proxy config for tests.
 */
function mockCliProxyPreferences() {
  vi.spyOn(userPreferences, "getPreferences").mockResolvedValue({
    cliProxy: {
      baseUrl: "http://localhost:8317/v0/management",
      managementKey: "k",
    },
  } as any)
}

/**
 * Create default `ImportToCliProxyOptions` for tests with optional overrides.
 */
function createBaseOptions(
  overrides: Partial<ImportToCliProxyOptions> = {},
): ImportToCliProxyOptions {
  return {
    account: buildDisplaySiteData({
      id: "acc",
      name: "example",
      baseUrl: "https://example.com/api",
    }),
    token: buildApiToken({ key: "sk-test" }),
    providerType: CLI_PROXY_PROVIDER_TYPES.OPENAI_COMPATIBILITY,
    providerName: "example",
    providerBaseUrl: "https://example.com/api/v1",
    proxyUrl: "",
    ...overrides,
  }
}

describe("cliProxyService.importToCliProxy", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("includes models in the OpenAI-compatible PUT payload when provided", async () => {
    mockCliProxyPreferences()

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/openai-compatibility") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/openai-compatibility") && method === "PUT") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        models: [{ name: "m", alias: "a" }],
      }),
    )

    expect(result.success).toBe(true)

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    )
    expect(putCall).toBeTruthy()

    const payload = JSON.parse(putCall?.[1].body) as any[]

    expect(payload[0]).toMatchObject({
      name: "example",
      "base-url": "https://example.com/api/v1",
      "api-key-entries": [{ "api-key": "sk-test", "proxy-url": "" }],
      models: [{ name: "m", alias: "a" }],
      headers: {},
    })
  })

  it("omits OpenAI-compatible models in the PUT payload when models are omitted", async () => {
    mockCliProxyPreferences()

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/openai-compatibility") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/openai-compatibility") && method === "PUT") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(createBaseOptions())

    expect(result.success).toBe(true)

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    )
    expect(putCall).toBeTruthy()

    const payload = JSON.parse(putCall?.[1].body) as any[]
    expect(payload[0]).not.toHaveProperty("models")
  })

  it("keeps existing OpenAI-compatible provider models when models are omitted", async () => {
    mockCliProxyPreferences()

    const existingProvider = {
      name: "example",
      "base-url": "https://example.com/api/v1",
      "api-key-entries": [{ "api-key": "sk-old", "proxy-url": "" }],
      models: [{ name: "existing", alias: "kept" }],
      headers: { "X-Provider": "example" },
    }

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/openai-compatibility") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([existingProvider]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/openai-compatibility") && method === "PATCH") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(createBaseOptions())

    expect(result.success).toBe(true)

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )
    expect(patchCall).toBeTruthy()

    const payload = JSON.parse(patchCall?.[1].body) as any
    expect(payload.value.models).toEqual([{ name: "existing", alias: "kept" }])
  })

  it("clears existing OpenAI-compatible provider models when models is explicitly empty", async () => {
    mockCliProxyPreferences()

    const existingProvider = {
      name: "example",
      "base-url": "https://example.com/api/v1",
      "api-key-entries": [{ "api-key": "sk-old", "proxy-url": "" }],
      models: [{ name: "existing", alias: "kept" }],
      headers: { "X-Provider": "example" },
    }

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/openai-compatibility") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([existingProvider]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/openai-compatibility") && method === "PATCH") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        models: [],
      }),
    )

    expect(result.success).toBe(true)

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )
    expect(patchCall).toBeTruthy()

    const payload = JSON.parse(patchCall?.[1].body) as any
    expect(payload.value.models).toEqual([])
  })

  it("updates matching Codex entries on the Codex management endpoint without PUT duplicates", async () => {
    mockCliProxyPreferences()

    const existingProvider = {
      "api-key": "sk-codex",
      "base-url": "https://example.com/router",
      "proxy-url": "",
      models: [{ name: "gpt-5-codex", alias: "codex" }],
      headers: { "X-Provider": "codex" },
    }

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/codex-api-key") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([existingProvider]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/codex-api-key") && method === "PATCH") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        account: {
          id: "acc",
          name: "OpenAI",
          baseUrl: "https://example.com/router",
        } as any,
        token: { id: "tok", key: "sk-codex" } as any,
        providerType: CLI_PROXY_PROVIDER_TYPES.CODEX_API_KEY,
        providerBaseUrl:
          "https://example.com/router/backend-api/codex/v1/chat/completions",
      }),
    )

    expect(result.success).toBe(true)

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/codex-api-key") && init?.method === "PATCH",
      ),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/codex-api-key") && init?.method === "PUT",
      ),
    ).toBe(false)

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/codex-api-key") && init?.method === "PATCH",
    )
    const payload = JSON.parse(patchCall?.[1].body) as any

    expect(payload.value).toMatchObject({
      "api-key": "sk-codex",
      "base-url": "https://example.com/router",
      models: [{ name: "gpt-5-codex", alias: "codex" }],
      headers: { "X-Provider": "codex" },
    })
  })

  it("writes Gemini imports to the selected Gemini provider list", async () => {
    mockCliProxyPreferences()

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/gemini-api-key") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/gemini-api-key") && method === "PUT") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        providerType: CLI_PROXY_PROVIDER_TYPES.GEMINI_API_KEY,
        providerBaseUrl:
          "https://example.com/genai/v1beta/models/gemini-2.5-pro:generateContent",
        token: { id: "tok", key: "gk" } as any,
        models: [{ name: "gemini-2.5-pro", alias: "gemini" }],
      }),
    )

    expect(result.success).toBe(true)

    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/gemini-api-key") && init?.method === "PUT",
    )
    expect(putCall).toBeTruthy()

    const payload = JSON.parse(putCall?.[1].body) as any[]
    expect(payload[0]).toMatchObject({
      "api-key": "gk",
      "base-url": "https://example.com/genai",
      models: [{ name: "gemini-2.5-pro", alias: "gemini" }],
    })
  })

  it("does not merge Gemini providers that share an API key but have distinct base URLs", async () => {
    mockCliProxyPreferences()

    const existingProvider = {
      "api-key": "gk",
      "base-url": "https://example.com/genai-a",
      "proxy-url": "",
      headers: { "X-Provider": "gemini-a" },
    }

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/gemini-api-key") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([existingProvider]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/gemini-api-key") && method === "PUT") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        providerType: CLI_PROXY_PROVIDER_TYPES.GEMINI_API_KEY,
        providerBaseUrl: "https://example.com/genai-b/v1beta/models",
        token: buildApiToken({ key: "gk" }),
      }),
    )

    expect(result.success).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/gemini-api-key") && init?.method === "PATCH",
      ),
    ).toBe(false)

    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/gemini-api-key") && init?.method === "PUT",
    )
    expect(putCall).toBeTruthy()

    const payload = JSON.parse(putCall?.[1].body) as any[]
    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject(existingProvider)
    expect(payload[1]).toMatchObject({
      "api-key": "gk",
      "base-url": "https://example.com/genai-b",
    })
  })

  it("preserves an explicit empty Gemini model list for matched providers", async () => {
    mockCliProxyPreferences()

    const existingProvider = {
      "api-key": "gk",
      "base-url": "https://example.com/genai",
      "proxy-url": "",
      models: [{ name: "gemini-2.5-pro", alias: "gemini" }],
      headers: { "X-Provider": "gemini" },
    }

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/gemini-api-key") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([existingProvider]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/gemini-api-key") && method === "PUT") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        providerType: CLI_PROXY_PROVIDER_TYPES.GEMINI_API_KEY,
        providerBaseUrl: "https://example.com/genai/v1beta/models",
        token: { id: "tok", key: "gk" } as any,
        models: [],
      }),
    )

    expect(result.success).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/gemini-api-key") && init?.method === "PATCH",
      ),
    ).toBe(false)

    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/gemini-api-key") && init?.method === "PUT",
    )
    expect(putCall).toBeTruthy()

    const payload = JSON.parse(putCall?.[1].body) as any[]
    expect(payload[0]).toMatchObject({
      "api-key": "gk",
      "base-url": "https://example.com/genai",
      models: [],
    })
  })

  it("maps remote-management access errors to a specific hint", async () => {
    mockCliProxyPreferences()

    server.use(
      http.get(
        "http://localhost:8317/v0/management/openai-compatibility",
        () =>
          new HttpResponse("allow-remote-management must be enabled", {
            status: 403,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    )

    const result = await importToCliProxy(createBaseOptions())

    expect(result.success).toBe(false)
    expect(result.message).toContain(
      "messages:cliproxy.managementApiRemoteAccessDisabled",
    )
  })

  it("can verify the management API connection with explicit settings", async () => {
    server.use(
      http.get("http://localhost:8317/v0/management/openai-compatibility", () =>
        HttpResponse.json([]),
      ),
    )

    const result = await verifyCliProxyManagementConnection({
      baseUrl: "http://localhost:8317/v0/management",
      managementKey: "k",
    })

    expect(result.success).toBe(true)
    expect(result.message).toContain(
      "messages:cliproxy.managementApiConnectionSuccess",
    )
  })

  it("uses a generic fallback message for unknown connection-check failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("")) as any)

    const result = await verifyCliProxyManagementConnection({
      baseUrl: "http://localhost:8317/v0/management",
      managementKey: "k",
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain(
      "messages:toast.error.operationFailedGeneric",
    )
  })

  it("returns config-missing when stored CLI Proxy settings are incomplete", async () => {
    vi.spyOn(userPreferences, "getPreferences").mockResolvedValue({
      cliProxy: {
        baseUrl: "http://localhost:8317/v0/management",
        managementKey: "",
      },
    } as any)

    await expect(verifyCliProxyManagementConnection()).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining("messages:cliproxy.configMissing"),
    })

    await expect(importToCliProxy(createBaseOptions())).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining("messages:cliproxy.configMissing"),
    })
  })

  it("maps network failures to an unreachable management API hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as any,
    )

    const result = await verifyCliProxyManagementConnection({
      baseUrl: "http://localhost:8317/v0/management",
      managementKey: "k",
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain(
      "messages:cliproxy.managementApiUnreachable",
    )
  })

  it("maps 401 management API failures to the invalid-key message", async () => {
    server.use(
      http.get(
        "http://localhost:8317/v0/management/openai-compatibility",
        () => new HttpResponse("nope", { status: 401 }),
      ),
    )

    const result = await verifyCliProxyManagementConnection({
      baseUrl: "http://localhost:8317/v0/management",
      managementKey: "bad-key",
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain(
      "messages:cliproxy.managementApiInvalidKey",
    )
  })

  it("maps 404 and 5xx management API failures to their specific connection-check messages", async () => {
    server.use(
      http.get(
        "http://localhost:8317/v0/management/openai-compatibility",
        () => new HttpResponse("missing", { status: 404 }),
      ),
    )

    await expect(
      verifyCliProxyManagementConnection({
        baseUrl: "http://localhost:8317/v0/management",
        managementKey: "k",
      }),
    ).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining(
        "messages:cliproxy.managementApiNotFound",
      ),
    })

    server.use(
      http.get(
        "http://localhost:8317/v0/management/openai-compatibility",
        () => new HttpResponse("server exploded", { status: 503 }),
      ),
    )

    await expect(
      verifyCliProxyManagementConnection({
        baseUrl: "http://localhost:8317/v0/management",
        managementKey: "k",
      }),
    ).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining(
        "messages:cliproxy.managementApiServerError",
      ),
    })
  })

  it("maps other HTTP management API failures to the generic http-error message", async () => {
    server.use(
      http.get(
        "http://localhost:8317/v0/management/openai-compatibility",
        () => new HttpResponse("teapot", { status: 418 }),
      ),
    )

    await expect(
      verifyCliProxyManagementConnection({
        baseUrl: "http://localhost:8317/v0/management",
        managementKey: "k",
      }),
    ).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining(
        "messages:cliproxy.managementApiHttpError",
      ),
    })
  })

  it("updates an OpenAI-compatible provider when the existing provider matches by normalized name", async () => {
    mockCliProxyPreferences()

    const existingProvider = {
      name: "  Example  ",
      "base-url": "https://other.example.com/v1",
      "api-key-entries": [{ "api-key": "sk-old", "proxy-url": "" }],
      headers: { "X-Provider": "example" },
    }

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/openai-compatibility") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([existingProvider]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/openai-compatibility") && method === "PATCH") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        providerName: " example ",
        providerBaseUrl: "https://new.example.com/v1",
      }),
    )

    expect(result.success).toBe(true)
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false)

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )
    const payload = JSON.parse(patchCall?.[1].body) as any
    expect(payload.value).toMatchObject({
      name: "example",
      "base-url": "https://new.example.com/v1",
    })
    expect(payload.value["api-key-entries"]).toEqual([
      { "api-key": "sk-old", "proxy-url": "" },
      { "api-key": "sk-test", "proxy-url": "" },
    ])
  })

  it("derives the provider type from apiTypeHint when providerType is omitted", async () => {
    mockCliProxyPreferences()

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/claude-api-key") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify({ "claude-api-key": [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/claude-api-key") && method === "PUT") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        providerType: undefined,
        apiTypeHint: "anthropic",
        providerBaseUrl: " https://api.anthropic.com/v1/messages ",
        token: buildApiToken({ key: "anthropic-key" }),
      }),
    )

    expect(result.success).toBe(true)

    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/claude-api-key") && init?.method === "PUT",
    )
    expect(putCall).toBeTruthy()

    const payload = JSON.parse(putCall?.[1].body) as any[]
    expect(payload[0]).toMatchObject({
      "api-key": "anthropic-key",
      "base-url": "https://api.anthropic.com",
    })
  })

  it("falls back to account-derived names and default base URLs when OpenAI-compatible overrides are blank", async () => {
    mockCliProxyPreferences()

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/openai-compatibility") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/openai-compatibility") && method === "PUT") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        account: buildDisplaySiteData({
          id: "acc",
          name: "",
          baseUrl: "https://fallback.example.com",
        }),
        providerName: "   ",
        providerBaseUrl: "   ",
      }),
    )

    expect(result.success).toBe(true)

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    )
    const payload = JSON.parse(putCall?.[1].body) as any[]
    expect(payload[0]).toMatchObject({
      name: "https://fallback.example.com",
      "base-url": "https://fallback.example.com/v1",
    })
  })

  it("keeps the provider base URL empty for Claude imports when no normalized URL can be derived", async () => {
    mockCliProxyPreferences()

    const fetchMock = vi.fn().mockImplementation((input: any, init?: any) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/claude-api-key") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify({ "claude-api-key": [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/claude-api-key") && method === "PUT") {
        return Promise.resolve(new Response("", { status: 200 }))
      }

      return Promise.resolve(new Response("", { status: 500 }))
    })

    vi.stubGlobal("fetch", fetchMock as any)

    const result = await importToCliProxy(
      createBaseOptions({
        providerType: CLI_PROXY_PROVIDER_TYPES.CLAUDE_API_KEY,
        providerBaseUrl: "   ",
        token: buildApiToken({ key: "claude-key" }),
      }),
    )

    expect(result.success).toBe(true)

    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/claude-api-key") && init?.method === "PUT",
    )
    const payload = JSON.parse(putCall?.[1].body) as any[]
    expect(payload[0]).toMatchObject({
      "api-key": "claude-key",
      "base-url": "",
    })
  })
})
