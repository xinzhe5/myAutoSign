import { OPTIONS_PAGE_PATH } from "~/constants/extensionPages"
import { expect, test } from "~~/e2e/fixtures/extensionTest"
import {
  createStoredAccount,
  forceExtensionLanguage,
  installExtensionPageGuards,
  seedStoredAccounts,
  stubLlmMetadataIndex,
  stubNewApiSiteRoutes,
} from "~~/e2e/utils/commonUserFlows"
import {
  expectPermissionOnboardingHidden,
  getServiceWorker,
} from "~~/e2e/utils/extensionState"
import { waitForExtensionRoot } from "~~/e2e/utils/lazyLoading"

test.beforeEach(async ({ context, page }) => {
  installExtensionPageGuards(page)
  await forceExtensionLanguage(page, "zh-CN")
  await stubLlmMetadataIndex(context)
  await stubNewApiSiteRoutes(context, {
    models: ["gpt-4", "gpt-3.5"],
    groups: {
      default: { desc: "默认分组", ratio: 1 },
      vip: { desc: "VIP", ratio: 1.5 },
    },
  })
})

test("modal-hosted group selector stays visible and clickable above the add-token dialog", async ({
  context,
  extensionId,
  page,
}) => {
  const serviceWorker = await getServiceWorker(context)
  await seedStoredAccounts(serviceWorker, [createStoredAccount()])

  await page.goto(
    `chrome-extension://${extensionId}/${OPTIONS_PAGE_PATH}#keys?accountId=e2e-account-1`,
  )
  await waitForExtensionRoot(page)
  await expectPermissionOnboardingHidden(page)

  await expect(
    page.getByRole("button", { name: "添加 API 密钥" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "添加 API 密钥" }).click()

  const nameInput = page.locator("#tokenName")
  await expect(nameInput).toBeVisible()
  await nameInput.fill("e2e layered token")

  const groupTrigger = page.getByRole("combobox").last()
  await expect(groupTrigger).toBeVisible()
  await groupTrigger.click()

  const groupOption = page.getByRole("option", {
    name: /vip - VIP \(倍率： 1\.5\)/,
  })
  await expect(groupOption).toBeVisible()
  await groupOption.click()

  await expect(groupTrigger).toContainText("vip - VIP")
})
