import { act, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider, useTheme } from "~/contexts/ThemeContext"

const { updateThemeModeMock } = vi.hoisted(() => ({
  updateThemeModeMock: vi.fn(),
}))

const mockPreferencesContext = vi.hoisted(() => ({
  current: {
    themeMode: "system" as "system" | "light" | "dark",
    updateThemeMode: updateThemeModeMock,
  },
}))

vi.mock("~/contexts/UserPreferencesContext", () => ({
  useUserPreferencesContext: () => mockPreferencesContext.current,
}))

const TEST_IDS = {
  themeMode: "theme-mode",
  resolvedTheme: "resolved-theme",
} as const

type MatchMediaListener = (event: MediaQueryListEvent) => void

function createMatchMediaController(initialMatches = false) {
  let matches = initialMatches
  const listeners = new Set<MatchMediaListener>()

  return {
    queryList: {
      get matches() {
        return matches
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(
        (_event: string, listener: MatchMediaListener) => {
          listeners.add(listener)
        },
      ),
      removeEventListener: vi.fn(
        (_event: string, listener: MatchMediaListener) => {
          listeners.delete(listener)
        },
      ),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    },
    emit(nextMatches: boolean) {
      matches = nextMatches
      const event = { matches: nextMatches } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    },
  }
}

const Probe = ({ children }: { children?: ReactNode }) => {
  const context = useTheme()

  return (
    <div>
      <div data-testid={TEST_IDS.themeMode}>{context.themeMode}</div>
      <div data-testid={TEST_IDS.resolvedTheme}>{context.resolvedTheme}</div>
      <button onClick={() => context.setThemeMode("dark")}>set-dark</button>
      {children}
    </div>
  )
}

describe("ThemeContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.classList.remove("dark")
    mockPreferencesContext.current = {
      themeMode: "system",
      updateThemeMode: updateThemeModeMock,
    }
  })

  it("throws when useTheme is used outside the provider", () => {
    const BrokenConsumer = () => {
      useTheme()
      return null
    }

    expect(() => render(<BrokenConsumer />)).toThrow(
      "useTheme must be used within a ThemeProvider",
    )
  })

  it("uses the system dark preference, reacts to media-query changes, and cleans up listeners", () => {
    const media = createMatchMediaController(true)
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media.queryList),
    )

    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    expect(screen.getByTestId(TEST_IDS.themeMode)).toHaveTextContent("system")
    expect(screen.getByTestId(TEST_IDS.resolvedTheme)).toHaveTextContent("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)

    act(() => {
      media.emit(false)
    })

    expect(screen.getByTestId(TEST_IDS.resolvedTheme)).toHaveTextContent(
      "light",
    )
    expect(document.documentElement.classList.contains("dark")).toBe(false)

    unmount()

    expect(media.queryList.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    )
  })

  it("uses the system light preference initially and switches to dark when the media query changes", () => {
    const media = createMatchMediaController(false)
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media.queryList),
    )

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    expect(screen.getByTestId(TEST_IDS.resolvedTheme)).toHaveTextContent(
      "light",
    )
    expect(document.documentElement.classList.contains("dark")).toBe(false)

    act(() => {
      media.emit(true)
    })

    expect(screen.getByTestId(TEST_IDS.resolvedTheme)).toHaveTextContent("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("uses explicit theme modes and delegates updates through the preferences context", async () => {
    const media = createMatchMediaController(false)
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media.queryList),
    )
    mockPreferencesContext.current.themeMode = "light"
    updateThemeModeMock.mockResolvedValue(undefined)

    const { rerender } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    expect(screen.getByTestId(TEST_IDS.resolvedTheme)).toHaveTextContent(
      "light",
    )
    expect(document.documentElement.classList.contains("dark")).toBe(false)

    await act(async () => {
      screen.getByRole("button", { name: "set-dark" }).click()
    })

    expect(updateThemeModeMock).toHaveBeenCalledWith("dark")

    mockPreferencesContext.current.themeMode = "dark"
    rerender(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    expect(screen.getByTestId(TEST_IDS.resolvedTheme)).toHaveTextContent("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("ignores system color-scheme change events when the user selected an explicit theme", () => {
    const media = createMatchMediaController(true)
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media.queryList),
    )
    mockPreferencesContext.current.themeMode = "dark"

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    expect(screen.getByTestId(TEST_IDS.resolvedTheme)).toHaveTextContent("dark")

    act(() => {
      media.emit(false)
    })

    expect(screen.getByTestId(TEST_IDS.resolvedTheme)).toHaveTextContent("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })
})
