import { unflattenObjectKeys } from "../unflatten-object-keys"

describe("unflattenWhereClauses", () => {
  it("should unflatten where clauses", () => {
    const where = {
      "variants.sku": { $like: "%-1" },
      "variants.prices.amount": { $gt: 30 },
      "variants.prices.currency_code": "USD",
      variants: {
        prices: {
          something: "else",
        },
      },
    }

    const result = unflattenObjectKeys(where)

    expect(result).toEqual({
      variants: {
        prices: {
          something: "else",
          amount: {
            $gt: 30,
          },
          currency_code: "USD",
        },
        sku: {
          $like: "%-1",
        },
      },
    })
  })

  it("should unflatten obj", () => {
    const where = {
      created_at: "ASC",
    }

    const result = unflattenObjectKeys(where)

    expect(result).toEqual({
      created_at: "ASC",
    })
  })

  it("should not pollute the object prototype through unsafe path segments", () => {
    const where = JSON.parse(
      `{"__proto__.polluted": "yes", "constructor.prototype.polluted": "yes", "a.__proto__.polluted": "yes"}`
    )

    const result = unflattenObjectKeys(where)

    expect(result).toEqual({})
    expect(({} as any).polluted).toBeUndefined()
    expect((Object.prototype as any).polluted).toBeUndefined()
  })

  it("should drop unsafe top level keys", () => {
    const where = JSON.parse(`{"__proto__": {"polluted": "yes"}}`)

    const result = unflattenObjectKeys(where)

    expect(result).toEqual({})
    expect(({} as any).polluted).toBeUndefined()
  })
})
