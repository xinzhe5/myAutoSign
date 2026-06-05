import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const storageMap = new Map<string, unknown>()
  const get = vi.fn(async (key: string) => storageMap.get(key))
  const set = vi.fn(async (key: string, value: unknown) => {
    storageMap.set(key, value)
  })
  const logger = {
    error: vi.fn(),
  }

  class StorageMock {
    get = get
    set = set
  }

  return {
    storageMap,
    get,
    set,
    logger,
    StorageMock,
  }
})

vi.mock("@plasmohq/storage", () => ({
  Storage: mocks.StorageMock,
}))

vi.mock("~/utils/core/logger", () => ({
  createLogger: () => mocks.logger,
}))

describe("modelPricingCache", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.clearAllMocks()
    mocks.storageMap.clear()
  })

  it("stores pricing entries by account id and returns them while they are fresh", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000)

    const { modelPricingCache } = await import(
      "~/services/models/modelPricingCache"
    )

    const pricing = {
      success: true,
      data: [{ model_name: "gpt-4.1", model_ratio: 1 }],
    } as any

    await modelPricingCache.set("account-1", pricing)

    expect(mocks.set).toHaveBeenCalledWith(
      "modelPricing_cache_v1",
      expect.objectContaining({
        "account-1": {
          pricing,
          lastUpdated: 1_000,
        },
      }),
    )

    await expect(modelPricingCache.get("account-1")).resolves.toEqual(pricing)
  })

  it("returns null for missing or expired cache entries", async () => {
    mocks.storageMap.set("modelPricing_cache_v1", {
      missing: {
        pricing: { success: true, data: [] },
        lastUpdated: 1_000,
      },
      stale: {
        pricing: { success: true, data: [{ model_name: "stale-model" }] },
        lastUpdated: 1_000,
      },
    })

    vi.spyOn(Date, "now").mockReturnValue(1_000)

    const { MODEL_PRICING_CACHE_TTL_MS, modelPricingCache } = await import(
      "~/services/models/modelPricingCache"
    )

    await expect(modelPricingCache.get("absent")).resolves.toBeNull()

    vi.spyOn(Date, "now").mockReturnValue(
      1_000 + MODEL_PRICING_CACHE_TTL_MS + 1,
    )
    await expect(modelPricingCache.get("stale")).resolves.toBeNull()
  })

  it("invalidates only the requested account entry", async () => {
    mocks.storageMap.set("modelPricing_cache_v1", {
      "account-1": {
        pricing: { success: true, data: [{ model_name: "gpt-4.1" }] },
        lastUpdated: 100,
      },
      "account-2": {
        pricing: { success: true, data: [{ model_name: "claude-3-7-sonnet" }] },
        lastUpdated: 200,
      },
    })

    const { modelPricingCache } = await import(
      "~/services/models/modelPricingCache"
    )

    await modelPricingCache.invalidate("account-1")

    expect(mocks.storageMap.get("modelPricing_cache_v1")).toEqual({
      "account-2": {
        pricing: { success: true, data: [{ model_name: "claude-3-7-sonnet" }] },
        lastUpdated: 200,
      },
    })
  })

  it("swallows storage read failures and returns null", async () => {
    mocks.get.mockRejectedValueOnce(new Error("storage read failed"))

    const { modelPricingCache } = await import(
      "~/services/models/modelPricingCache"
    )

    await expect(modelPricingCache.get("account-1")).resolves.toBeNull()
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to get cache",
      expect.any(Error),
    )
  })

  it("swallows storage write failures for set and invalidate operations", async () => {
    mocks.storageMap.set("modelPricing_cache_v1", {
      "account-1": {
        pricing: { success: true, data: [] },
        lastUpdated: 100,
      },
    })
    mocks.set
      .mockRejectedValueOnce(new Error("storage write failed"))
      .mockRejectedValueOnce(new Error("storage delete failed"))

    const { modelPricingCache } = await import(
      "~/services/models/modelPricingCache"
    )

    await expect(
      modelPricingCache.set("account-2", {
        success: true,
        data: [{ model_name: "gpt-4.1" }],
      } as any),
    ).resolves.toBeUndefined()
    await expect(
      modelPricingCache.invalidate("account-1"),
    ).resolves.toBeUndefined()

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to set cache",
      expect.any(Error),
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to invalidate cache",
      expect.any(Error),
    )
  })
})
