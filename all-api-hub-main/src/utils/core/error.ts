/**
 * Normalize unknown error inputs into a human-readable string.
 * @param error Any thrown value, including primitives or Error-like objects.
 * @param fallback Optional fallback used when the input carries no usable message.
 * @returns String representation safe for logging or user display.
 */
export function getErrorMessage(error: unknown, fallback = ""): string {
  if (error == null) {
    return fallback
  }

  if (error instanceof Error) {
    return error.message || fallback
  }

  if (typeof error === "string") {
    return error
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    return message == null ? fallback : String(message)
  }

  try {
    const serialized = JSON.stringify(error)
    if (typeof serialized === "string") {
      return serialized
    }

    return String(error)
  } catch {
    return String(error)
  }
}
