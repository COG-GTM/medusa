import crypto from "crypto"

/**
 * Compares two hex encoded hashes without leaking their contents through the
 * comparison duration.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8")
  const bufferB = Buffer.from(b, "utf8")

  if (bufferA.length !== bufferB.length) {
    return false
  }

  return crypto.timingSafeEqual(bufferA, bufferB)
}
