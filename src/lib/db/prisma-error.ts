export function isMissingDbObjectError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "P2021" ||
      (error as { code?: unknown }).code === "P2022")
  )
}

export function isSchemaCompatibilityError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : null
  if (code === "P2022") return true

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message)
        : ""

  const ncwatchTagColumns = [
    "is_enabled",
    "is_visible",
    "is_primary",
    "display_order",
    "source",
    "isEnabled",
    "isVisible",
    "isPrimary",
    "displayOrder",
  ]

  return (
    message.includes("Value 'NCWATCH_AGENT' not found in enum") ||
    (message.includes("does not exist") &&
      ncwatchTagColumns.some((column) => message.includes(column)))
  )
}
