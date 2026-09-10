import { constantTimeEqual } from "../constant-time-equal"

describe("constantTimeEqual", () => {
  it("should match identical hashes", () => {
    const hash = "a".repeat(128)

    expect(constantTimeEqual(hash, hash)).toBe(true)
  })

  it("should not match different hashes of the same length", () => {
    expect(constantTimeEqual("a".repeat(128), "b".repeat(128))).toBe(false)
  })

  it("should not match hashes that differ only in the last character", () => {
    expect(constantTimeEqual("a".repeat(127) + "b", "a".repeat(128))).toBe(
      false
    )
  })

  it("should not throw for hashes of different length", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false)
  })
})
