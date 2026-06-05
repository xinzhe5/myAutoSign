import { describe, expect, it, vi } from "vitest"

import UsageHistorySyncSettingsSection from "~/features/BasicSettings/components/tabs/UsageHistorySync/UsageHistorySyncSettingsSection"
import { USAGE_HISTORY_SCHEDULE_MODE } from "~/types/usageHistory"
import { render } from "~~/tests/test-utils/render"

const noop = vi.fn()

describe("UsageHistorySyncSettingsSection", () => {
  it("attaches the sync interval search target to the sync interval field", () => {
    const { container } = render(
      <UsageHistorySyncSettingsSection
        enabled={true}
        onEnabledChange={noop}
        retentionDays={30}
        onRetentionDaysChange={noop}
        scheduleMode={USAGE_HISTORY_SCHEDULE_MODE.MANUAL}
        onScheduleModeChange={noop}
        syncIntervalMinutes={360}
        onSyncIntervalMinutesChange={noop}
        alarmsSupported={true}
        isLoading={false}
        isSyncingAll={false}
        onApplySettings={noop}
        onSyncNow={noop}
        onRefreshStatus={noop}
      />,
      {
        withUserPreferencesProvider: false,
        withThemeProvider: false,
      },
    )

    const intervalTarget = container.querySelector(
      "#usage-history-sync-interval-hours",
    )

    expect(intervalTarget).not.toBeNull()
    expect(intervalTarget).toHaveTextContent(
      "usageAnalytics:settings.syncIntervalHours",
    )
    expect(intervalTarget).not.toHaveTextContent(
      "usageAnalytics:settings.scheduleMode",
    )
  })
})
