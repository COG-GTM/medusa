import crypto from "crypto"

/**
 * Compares two hex encoded hashes without leaking their contents or their
 * lengths through the comparison duration. Both values are reduced to a
 * fixed size digest first, so the comparison always runs over 32 bytes.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash("sha256").update(a, "utf8").digest()
  const digestB = crypto.createHash("sha256").update(b, "utf8").digest()

  return crypto.timingSafeEqual(digestA, digestB)
}
