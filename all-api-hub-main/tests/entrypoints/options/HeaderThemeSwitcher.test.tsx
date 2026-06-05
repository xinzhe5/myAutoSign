import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import HeaderThemeSwitcher from "~/entrypoints/options/components/HeaderThemeSwitcher"

const { radioGroupState, themeState } = vi.hoisted(() => ({
  radioGroupState: {
    currentHandler: undefined as ((value: string) => void) | undefined,
  },
  themeState: {
    current: {
      resolvedTheme: "light" as "light" | "dark",
      setThemeMode: vi.fn(),
      themeMode: "light" as any,
    },
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}))

vi.mock("~/contexts/ThemeContext", () => ({
  useTheme: () => themeState.current,
}))

vi.mock("~/components/ui", () => ({
  IconButton: ({
    children,
    ...props
  }: {
    children: React.ReactNode
    [key: string]: unknown
  }) => <button {...props}>{children}</button>,
}))

vi.mock("~/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuRadioGroup: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode
    onValueChange: (value: string) => void
    value: string
  }) => {
    radioGroupState.currentHandler = onValueChange

    return (
      <div>
        {children}
        <button
          type="button"
          aria-label="theme-option-invalid"
          onClick={() => onValueChange("invalid")}
        >
          invalid
        </button>
      </div>
    )
  },
  DropdownMenuRadioItem: ({
    children,
    value,
  }: {
    children: React.ReactNode
    value: string
  }) => (
    <button
      type="button"
      aria-label={`theme-option-${value}`}
      onClick={() => radioGroupState.currentHandler?.(value)}
    >
      {children}
    </button>
  ),
}))

describe("HeaderThemeSwitcher", () => {
  beforeEach(() => {
    radioGroupState.currentHandler = undefined
    themeState.current = {
      resolvedTheme: "light",
      setThemeMode: vi.fn(),
      themeMode: "light",
    }
  })

  it("renders the current light theme with a dark resolved label and applies valid selections only", () => {
    themeState.current.resolvedTheme = "dark"

    render(<HeaderThemeSwitcher />)

    const trigger = screen.getByRole("button", {
      name: 'theme.current:{"theme":"settings:theme.light","resolvedTheme":"settings:theme.dark"}',
    })

    expect(trigger).toHaveAttribute(
      "title",
      'theme.current:{"theme":"settings:theme.light","resolvedTheme":"settings:theme.dark"}',
    )
    expect(trigger.querySelector("svg")).toHaveClass("text-amber-500")
    expect(
      screen
        .getByRole("button", { name: "theme-option-light" })
        .querySelector("svg"),
    ).toHaveClass("text-amber-500")
    expect(
      screen
        .getByRole("button", { name: "theme-option-dark" })
        .querySelector("svg"),
    ).toHaveClass("text-blue-500")
    expect(
      screen
        .getByRole("button", { name: "theme-option-system" })
        .querySelector("svg"),
    ).toHaveClass("text-violet-500")

    fireEvent.click(screen.getByRole("button", { name: "theme-option-dark" }))
    fireEvent.click(screen.getByRole("button", { name: "theme-option-system" }))
    fireEvent.click(screen.getByRole("button", { name: "theme-option-light" }))
    fireEvent.click(
      screen.getByRole("button", { name: "theme-option-invalid" }),
    )

    expect(themeState.current.setThemeMode).toHaveBeenNthCalledWith(1, "dark")
    expect(themeState.current.setThemeMode).toHaveBeenNthCalledWith(2, "system")
    expect(themeState.current.setThemeMode).toHaveBeenNthCalledWith(3, "light")
    expect(themeState.current.setThemeMode).toHaveBeenCalledTimes(3)
  })

  it("falls back to the system label when the stored theme mode is invalid", () => {
    themeState.current.themeMode = "legacy-theme"

    render(<HeaderThemeSwitcher />)

    const trigger = screen.getByRole("button", {
      name: 'theme.current:{"theme":"settings:theme.followSystem","resolvedTheme":"settings:theme.light"}',
    })

    expect(trigger).toHaveAttribute(
      "title",
      'theme.current:{"theme":"settings:theme.followSystem","resolvedTheme":"settings:theme.light"}',
    )

    fireEvent.click(
      screen.getByRole("button", { name: "theme-option-invalid" }),
    )

    expect(themeState.current.setThemeMode).not.toHaveBeenCalled()
  })
})
