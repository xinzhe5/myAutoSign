import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  refreshSub2ApiTokens,
  SUB2API_TOKEN_REFRESH_BUFFER_MS,
} from "~/services/apiService/sub2api/tokenRefresh"

const { mockGetSafeErrorMessage } = vi.hoisted(() => ({
  mockGetSafeErrorMessage: vi.fn(),
}))

vi.mock("~/services/apiService/sub2api/redaction", () => ({
  getSafeErrorMessage: mockGetSafeErrorMessage,
}))

describe("Sub2API token refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("exports the upstream refresh buffer constant", () => {
    expect(SUB2API_TOKEN_REFRESH_BUFFER_MS).toBe(120 * 1000)
  })

  it("rejects when the refresh token is blank after normalization", async () => {
    await expect(
      refreshSub2ApiTokens({
        baseUrl: "https://sub2.example.com",
        refreshToken: "   ",
      }),
    ).rejects.toThrow("Sub2API refresh token missing")
  })

  it("refreshes tokens, trims credentials, and carries the access token header when present", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000)
    const fetchMock = vi.fn().mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          access_token: " next-access ",
          refresh_token: " next-refresh ",
          expires_in: 1800,
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await refreshSub2ApiTokens({
      baseUrl: "https://sub2.example.com/base",
      accessToken: " current-access ",
      refreshToken: " current-refresh ",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sub2.example.com/api/v1/auth/refresh",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer current-access",
        },
        body: JSON.stringify({ refresh_token: "current-refresh" }),
      },
    )
    expect(result).toEqual({
      accessToken: "next-access",
      refreshToken: "next-refresh",
      tokenExpiresAt: 1_700_001_800_000,
    })

    nowSpy.mockRestore()
  })

  it("omits the authorization header when the current access token is blank", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 60,
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await refreshSub2ApiTokens({
      baseUrl: "https://sub2.example.com",
      accessToken: "  ",
      refreshToken: " refresh-token ",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sub2.example.com/api/v1/auth/refresh",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: "refresh-token" }),
      }),
    )
  })

  it("sanitizes network failures through getSafeErrorMessage", async () => {
    mockGetSafeErrorMessage.mockReturnValueOnce("redacted network error")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("raw upstream failure")),
    )

    await expect(
      refreshSub2ApiTokens({
        baseUrl: "https://sub2.example.com",
        refreshToken: "refresh-token",
      }),
    ).rejects.toThrow("redacted network error")

    expect(mockGetSafeErrorMessage).toHaveBeenCalled()
  })

  it("rejects envelopes whose code is not successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          code: 401,
          message: "expired",
        }),
      }),
    )

    await expect(
      refreshSub2ApiTokens({
        baseUrl: "https://sub2.example.com",
        refreshToken: "refresh-token",
      }),
    ).rejects.toThrow("Sub2API token refresh failed")
  })

  it("falls back to a generic refresh failure when the response body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        json: vi.fn().mockRejectedValueOnce(new Error("invalid json")),
      }),
    )

    await expect(
      refreshSub2ApiTokens({
        baseUrl: "https://sub2.example.com",
        refreshToken: "refresh-token",
      }),
    ).rejects.toThrow("Sub2API token refresh failed")
  })

  it("rejects payloads with missing token fields or non-positive expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          json: vi.fn().mockResolvedValue({
            code: 0,
            data: null,
          }),
        })
        .mockResolvedValueOnce({
          json: vi.fn().mockResolvedValue({
            code: 0,
            data: {
              access_token: "next-access",
              refresh_token: "next-refresh",
              expires_in: 0,
            },
          }),
        }),
    )

    await expect(
      refreshSub2ApiTokens({
        baseUrl: "https://sub2.example.com",
        refreshToken: "refresh-token",
      }),
    ).rejects.toThrow("Sub2API token refresh failed")

    await expect(
      refreshSub2ApiTokens({
        baseUrl: "https://sub2.example.com",
        refreshToken: "refresh-token",
      }),
    ).rejects.toThrow("Sub2API token refresh failed")
  })
})
