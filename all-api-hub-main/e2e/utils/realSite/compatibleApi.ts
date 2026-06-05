import type { Page } from "@playwright/test"

import { generateNewApiTotpCode } from "~/services/managedSites/providers/newApiTotp"

import {
  createLocatorFactory,
  ensureRealSiteOriginPage,
  findVisibleLocator,
  maybeCheckAgreement,
  maybeRevealUsernamePasswordLogin,
  normalizeBaseUrl,
  readEnv,
  requireVisibleLocator,
  resolveRealSiteUrl,
  safeParseJson,
  seedLocalStorageValues,
  type LocatorCandidate,
} from "./shared"

const DEFAULT_LOGIN_PATH = "/login"
const DEFAULT_LOGIN_API_PATH = "/api/user/login"
const DEFAULT_LOGIN_2FA_API_PATH = "/api/user/login/2fa"

type RequiredRealSiteEnvKey<TPrefix extends string> =
  | `AAH_E2E_${TPrefix}_BASE_URL`
  | `AAH_E2E_${TPrefix}_USERNAME`
  | `AAH_E2E_${TPrefix}_PASSWORD`

type CompatibleApiRealSiteResolution<TPrefix extends string> = {
  config: CompatibleApiRealSiteConfig | null
  missingEnvKeys: Array<RequiredRealSiteEnvKey<TPrefix>>
}

export interface CompatibleApiRealSiteConfig {
  baseUrl: string
  loginUrl: string
  loginApiUrl: string
  login2faApiUrl: string
  username: string
  password: string
  usernameSelector?: string
  passwordSelector?: string
  submitSelector?: string
  agreeSelector?: string
  totpSecret?: string
}

export interface CompatibleApiRealSiteLoginResult {
  reusedSession: boolean
  user: Record<string, unknown>
}

type CompatibleApiLoginApiPayload = {
  require_2fa?: boolean
}

type CompatibleApiResolverOptions<TPrefix extends string> = {
  envPrefix: TPrefix
}

type CompatibleApiLoginOptions = {
  label: string
  envPrefix: string
}

export function resolveCompatibleApiRealSiteConfig<TPrefix extends string>({
  envPrefix,
}: CompatibleApiResolverOptions<TPrefix>): CompatibleApiRealSiteResolution<TPrefix> {
  const envName = <TSuffix extends string>(suffix: TSuffix) =>
    `AAH_E2E_${envPrefix}_${suffix}` as const
  const requiredEnvKeys = [
    envName("BASE_URL"),
    envName("USERNAME"),
    envName("PASSWORD"),
  ] satisfies Array<RequiredRealSiteEnvKey<TPrefix>>

  const values = Object.fromEntries(
    requiredEnvKeys.map((key) => [key, readEnv(key)]),
  ) as Record<RequiredRealSiteEnvKey<TPrefix>, string | undefined>

  const missingEnvKeys = requiredEnvKeys.filter((key) => !values[key])

  if (missingEnvKeys.length > 0) {
    return {
      config: null,
      missingEnvKeys,
    }
  }

  const baseUrl = normalizeBaseUrl(values[envName("BASE_URL")]!)
  const loginPath = readEnv(envName("LOGIN_PATH")) ?? DEFAULT_LOGIN_PATH
  const loginApiPath =
    readEnv(envName("LOGIN_API_PATH")) ?? DEFAULT_LOGIN_API_PATH
  const login2faApiPath =
    readEnv(envName("LOGIN_2FA_API_PATH")) ?? DEFAULT_LOGIN_2FA_API_PATH

  return {
    config: {
      baseUrl,
      loginUrl: resolveRealSiteUrl(baseUrl, loginPath),
      loginApiUrl: resolveRealSiteUrl(baseUrl, loginApiPath),
      login2faApiUrl: resolveRealSiteUrl(baseUrl, login2faApiPath),
      username: values[envName("USERNAME")]!,
      password: values[envName("PASSWORD")]!,
      usernameSelector: readEnv(envName("USERNAME_SELECTOR")),
      passwordSelector: readEnv(envName("PASSWORD_SELECTOR")),
      submitSelector: readEnv(envName("SUBMIT_SELECTOR")),
      agreeSelector: readEnv(envName("AGREE_SELECTOR")),
      totpSecret: readEnv(envName("TOTP_SECRET")),
    },
    missingEnvKeys: [],
  }
}

export function getCompatibleApiRealSiteSkipReason(params: {
  label: string
  missingEnvKeys: string[]
}) {
  if (params.missingEnvKeys.length === 0) {
    return ""
  }

  return `Missing real-site ${params.label} E2E env: ${params.missingEnvKeys.join(", ")}`
}

export async function loginToCompatibleApiRealSite(
  page: Page,
  config: CompatibleApiRealSiteConfig,
  options: CompatibleApiLoginOptions,
): Promise<CompatibleApiRealSiteLoginResult> {
  await ensureRealSiteOriginPage(page, config.loginUrl)

  const existingUser = await waitForStoredUser(page, 2_500)
  if (existingUser) {
    return {
      reusedSession: true,
      user: existingUser,
    }
  }

  const apiUser = await tryLoginToCompatibleApiRealSiteViaApi(
    page,
    config,
    options,
  )
  if (apiUser) {
    return {
      reusedSession: false,
      user: apiUser,
    }
  }

  const locatorFactory = createLocatorFactory(`AAH_E2E_${options.envPrefix}`)
  const emptySelectors: Pick<
    CompatibleApiRealSiteConfig,
    "usernameSelector" | "passwordSelector" | "submitSelector"
  > = {}

  await maybeRevealUsernamePasswordLogin(
    page,
    () => locatorFactory.getUsernameCandidates(emptySelectors),
    () => locatorFactory.getPasswordCandidates(emptySelectors),
  )

  const usernameInput = await requireVisibleLocator(
    page,
    locatorFactory.getUsernameCandidates(config),
    10_000,
  )
  const passwordInput = await requireVisibleLocator(
    page,
    locatorFactory.getPasswordCandidates(config),
    10_000,
  )

  await usernameInput.fill(config.username)
  await passwordInput.fill(config.password)
  await maybeCheckAgreement(page, config.agreeSelector)

  const submitButton = await requireVisibleLocator(
    page,
    locatorFactory.getSubmitCandidates(config),
    10_000,
  )
  await submitButton.click()

  await maybeSubmitTotp(page, config, options)

  const user = await waitForStoredUser(page, 30_000)
  if (!user) {
    throw new Error(
      `Real ${options.label} login did not produce localStorage.user at ${config.baseUrl}.`,
    )
  }

  return {
    reusedSession: false,
    user,
  }
}

async function tryLoginToCompatibleApiRealSiteViaApi(
  page: Page,
  config: CompatibleApiRealSiteConfig,
  options: CompatibleApiLoginOptions,
): Promise<Record<string, unknown> | null> {
  const loginApiUrls = Array.from(
    new Set([
      config.loginApiUrl,
      resolveRealSiteUrl(config.baseUrl, DEFAULT_LOGIN_API_PATH),
    ]),
  )

  let lastErrorMessage = ""

  for (const loginApiUrl of loginApiUrls) {
    try {
      const response = await page.request.post(loginApiUrl, {
        data: {
          username: config.username,
          password: config.password,
        },
        failOnStatusCode: false,
      })
      const responseText = await response.text()
      const payload = extractCompatibleApiPayload(
        safeParseJson(responseText),
      ) as CompatibleApiLoginApiPayload | null

      if (payload?.require_2fa) {
        await completeCompatibleApiLogin2fa(page, config, options)
      } else if (!response.ok()) {
        lastErrorMessage = buildCompatibleApiLoginApiErrorMessage(
          response.status(),
          responseText,
          loginApiUrl,
          options,
        )
        continue
      }

      const user = await fetchCompatibleApiUser(page, config)
      if (!user) {
        lastErrorMessage = buildCompatibleApiLoginApiErrorMessage(
          response.status(),
          responseText,
          loginApiUrl,
          options,
        )
        continue
      }

      await ensureRealSiteOriginPage(page, config.loginUrl)
      await seedLocalStorageValues(page, {
        user: JSON.stringify(user),
      })

      return user
    } catch (error) {
      lastErrorMessage = `${options.label} login API request failed at ${loginApiUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }

  if (await looksLikeSecurityVerificationPage(page)) {
    throw new Error(
      lastErrorMessage
        ? `${lastErrorMessage} The real site is currently blocked by a security verification page, so API login cannot proceed.`
        : "The real site is currently blocked by a security verification page, so API login cannot proceed.",
    )
  }

  return null
}

async function completeCompatibleApiLogin2fa(
  page: Page,
  config: Pick<CompatibleApiRealSiteConfig, "login2faApiUrl" | "totpSecret">,
  options: CompatibleApiLoginOptions,
) {
  if (!config.totpSecret) {
    throw new Error(
      `Real ${options.label} login requires 2FA, but AAH_E2E_${options.envPrefix}_TOTP_SECRET is not set.`,
    )
  }

  const response = await page.request.post(config.login2faApiUrl, {
    data: {
      code: generateNewApiTotpCode(config.totpSecret),
    },
    failOnStatusCode: false,
  })

  if (!response.ok()) {
    const responseText = await response.text()
    throw new Error(
      buildCompatibleApiLoginApiErrorMessage(
        response.status(),
        responseText,
        config.login2faApiUrl,
        options,
      ),
    )
  }
}

async function fetchCompatibleApiUser(
  page: Page,
  config: Pick<CompatibleApiRealSiteConfig, "baseUrl">,
) {
  const response = await page.request.get(
    resolveRealSiteUrl(config.baseUrl, "/api/user/self"),
    {
      failOnStatusCode: false,
    },
  )

  if (!response.ok()) {
    return null
  }

  const payload = extractCompatibleApiPayload(
    safeParseJson(await response.text()),
  )
  if (!payload || typeof payload !== "object") {
    return null
  }

  const user = payload as Record<string, unknown>

  if (
    !("id" in user || "username" in user) ||
    (user.id == null && !user.username)
  ) {
    return null
  }

  return user
}

function extractCompatibleApiPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const record = payload as {
    success?: unknown
    message?: unknown
    data?: unknown
  }

  if (record.success === false) {
    return null
  }

  return "data" in record ? record.data ?? null : payload
}

async function maybeSubmitTotp(
  page: Page,
  config: CompatibleApiRealSiteConfig,
  options: CompatibleApiLoginOptions,
) {
  const codeInput = await findVisibleLocator(page, getTotpCandidates(), 5_000)
  if (!codeInput) {
    return
  }

  if (!config.totpSecret) {
    throw new Error(
      `Real ${options.label} login requested TOTP, but AAH_E2E_${options.envPrefix}_TOTP_SECRET is not set.`,
    )
  }

  const code = generateNewApiTotpCode(config.totpSecret)
  await fillVerificationCode(page, codeInput, code)

  const locatorFactory = createLocatorFactory(`AAH_E2E_${options.envPrefix}`)
  const submitButton = await requireVisibleLocator(
    page,
    [
      ...locatorFactory.getSubmitCandidates(config),
      {
        description: "verification button text",
        getLocator: (currentPage: Page) =>
          currentPage.getByRole("button", {
            name: /verify|confirm|continue|确认|验证|继续/i,
          }),
      },
    ],
    10_000,
  )
  await submitButton.click()
}

async function fillVerificationCode(
  page: Page,
  codeInput: ReturnType<Page["locator"]>,
  code: string,
) {
  const singleDigitInputs = page.locator(
    [
      'input[inputmode="numeric"][maxlength="1"]',
      'input[autocomplete="one-time-code"][maxlength="1"]',
      'input[maxlength="1"][pattern*="\\d"]',
    ].join(", "),
  )

  if ((await singleDigitInputs.count()) >= code.length) {
    for (const [index, digit] of [...code].entries()) {
      await singleDigitInputs.nth(index).fill(digit)
    }
    return
  }

  await codeInput.fill(code)
}

async function waitForStoredUser(
  page: Page,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await page.waitForFunction(
      () => {
        try {
          const raw = window.localStorage.getItem("user")
          if (!raw) {
            return null
          }

          const parsed = JSON.parse(raw)
          if (!parsed || (parsed.id == null && !parsed.username)) {
            return null
          }

          return parsed
        } catch {
          return null
        }
      },
      null,
      { timeout: timeoutMs },
    )

    return (await result.jsonValue()) as Record<string, unknown> | null
  } catch {
    return null
  }
}

function getTotpCandidates(): LocatorCandidate[] {
  return [
    {
      description: "one-time-code input",
      getLocator: (page: Page) =>
        page.locator(
          [
            'input[autocomplete="one-time-code"]',
            'input[inputmode="numeric"]',
            'input[name="code"]',
            'input[placeholder*="code" i]',
            'input[placeholder*="验证码" i]',
          ].join(", "),
        ),
    },
  ]
}

function buildCompatibleApiLoginApiErrorMessage(
  status: number,
  responseText: string,
  loginApiUrl: string,
  options: CompatibleApiLoginOptions,
) {
  const normalizedText = responseText.trim()

  if (
    /verify you are human|performing security verification|cloudflare/iu.test(
      normalizedText,
    )
  ) {
    return `${options.label} login API at ${loginApiUrl} is blocked by a security verification page (HTTP ${status}).`
  }

  if (/requires_2fa|2fa|totp/iu.test(normalizedText)) {
    return `${options.label} real-site login requires 2FA. Set AAH_E2E_${options.envPrefix}_TOTP_SECRET for this E2E.`
  }

  if (!normalizedText) {
    return `${options.label} login API at ${loginApiUrl} returned HTTP ${status}.`
  }

  return `${options.label} login API at ${loginApiUrl} returned HTTP ${status}: ${normalizedText.slice(0, 280)}`
}

async function looksLikeSecurityVerificationPage(page: Page) {
  const url = page.url()
  if (/cdn-cgi|challenge|cloudflare/iu.test(url)) {
    return true
  }

  const bodyText = await page
    .locator("body")
    .textContent()
    .catch(() => "")
  return /verify you are human|performing security verification|cloudflare/iu.test(
    bodyText ?? "",
  )
}
