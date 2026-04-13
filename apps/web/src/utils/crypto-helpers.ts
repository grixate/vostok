export function shouldQueueOutboxSendFailure(message: string): boolean {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('required') ||
    normalized.includes('must ') ||
    normalized.includes('must be') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('not found') ||
    normalized.includes('sender key') ||
    normalized.includes('session transport') ||
    normalized.includes('already been taken')
  ) {
    return false
  }

  return true
}

export function isOutboxDuplicateClientIdError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('client') && normalized.includes('already been taken')
}
