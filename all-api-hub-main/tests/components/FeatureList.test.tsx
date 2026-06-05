import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import FeatureList from "~/components/FeatureList"

describe("FeatureList", () => {
  it("renders nothing when no items are provided", () => {
    const { container } = render(
      <FeatureList title="Highlights" items={[]} color="green" />,
    )

    expect(container.firstChild).toBeNull()
  })

  it("renders the green palette when requested", () => {
    const { container } = render(
      <FeatureList title="Highlights" items={["Fast", "Safe"]} color="green" />,
    )

    const heading = screen.getByRole("heading", { name: "Highlights" })
    const panel = heading.parentElement?.querySelector("div.rounded-lg")
    const items = screen.getAllByRole("listitem")

    expect(heading.querySelector("div")).toHaveClass("bg-green-500")
    expect(panel).toHaveClass("bg-green-50", "border-green-200")
    expect(items).toHaveLength(2)
    items.forEach((item) => {
      expect(item).toHaveClass("text-green-800")
      expect(item.querySelector("div")).toHaveClass("bg-green-500")
    })
    expect(container).toHaveTextContent("Fast")
    expect(container).toHaveTextContent("Safe")
  })

  it("renders the blue palette when requested", () => {
    render(
      <FeatureList title="Roadmap" items={["Sync", "Export"]} color="blue" />,
    )

    const heading = screen.getByRole("heading", { name: "Roadmap" })
    const panel = heading.parentElement?.querySelector("div.rounded-lg")
    const items = screen.getAllByRole("listitem")

    expect(heading.querySelector("div")).toHaveClass("bg-blue-500")
    expect(panel).toHaveClass("bg-blue-50", "border-blue-200")
    items.forEach((item) => {
      expect(item).toHaveClass("text-blue-800")
      expect(item.querySelector("div")).toHaveClass("bg-blue-500")
    })
  })
})
