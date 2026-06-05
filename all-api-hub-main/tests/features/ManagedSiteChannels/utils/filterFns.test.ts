import { describe, expect, it, vi } from "vitest"

import {
  channelIdFilterFn,
  multiColumnFilterFn,
  statusFilterFn,
} from "~/features/ManagedSiteChannels/utils/filterFns"

const buildRow = (
  overrides: Partial<{
    original: {
      id: number
      name: string
      base_url: string
      group: string
    }
    values: Record<string, unknown>
  }> = {},
) => {
  const original = {
    id: 42,
    name: "Alpha Channel",
    base_url: "https://gateway.example.com",
    group: "default, vip",
    ...overrides.original,
  }
  const values: Record<string, unknown> = {
    status: "enabled",
    id: original.id,
    ...overrides.values,
  }

  return {
    original,
    getValue: vi.fn((columnId: string) => values[columnId]),
  } as any
}

describe("filterFns", () => {
  const addMeta = vi.fn()

  it("matches multi-column search terms across id, name, base URL, and groups", () => {
    const row = buildRow()

    expect(multiColumnFilterFn(row, "name", "  ", addMeta)).toBe(true)
    expect(multiColumnFilterFn(row, "name", "alpha", addMeta)).toBe(true)
    expect(
      multiColumnFilterFn(row, "name", "GATEWAY.EXAMPLE.COM", addMeta),
    ).toBe(true)
    expect(multiColumnFilterFn(row, "name", "vip", addMeta)).toBe(true)
    expect(multiColumnFilterFn(row, "name", "42", addMeta)).toBe(true)
    expect(multiColumnFilterFn(row, "name", "beta", addMeta)).toBe(false)
  })

  it("treats status filters as opt-in and compares against the column value", () => {
    const row = buildRow({ values: { status: 1 } })

    expect(statusFilterFn(row, "status", [], addMeta)).toBe(true)
    expect(statusFilterFn(row, "status", ["1", "2"], addMeta)).toBe(true)
    expect(statusFilterFn(row, "status", ["2", "3"], addMeta)).toBe(false)
  })

  it("requires exact trimmed channel id matches when a filter is provided", () => {
    const row = buildRow({ values: { id: "  84  " } })

    expect(channelIdFilterFn(row, "id", "", addMeta)).toBe(true)
    expect(channelIdFilterFn(row, "id", " 84 ", addMeta)).toBe(true)
    expect(channelIdFilterFn(row, "id", "85", addMeta)).toBe(false)
    expect(
      channelIdFilterFn(
        buildRow({ values: { id: null } }),
        "id",
        "84",
        addMeta,
      ),
    ).toBe(false)
  })
})
