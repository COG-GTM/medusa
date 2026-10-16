import { preparePromotionUsageComputedActions } from "../prepare-promotion-usage"

describe("preparePromotionUsageComputedActions", () => {
  it("should return an empty list when the cart has no adjustments", () => {
    expect(
      preparePromotionUsageComputedActions({
        items: [{ adjustments: [] }, {}],
        shipping_methods: undefined,
      } as any)
    ).toEqual([])
  })

  it("should skip adjustments without a promotion code", () => {
    const result = preparePromotionUsageComputedActions({
      items: [
        {
          adjustments: [
            { code: null, amount: 10 },
            { code: undefined, amount: 20 },
            { code: "", amount: 30 },
            { amount: 40 },
            { code: "PROMO", amount: 50 },
          ],
        },
      ],
      shipping_methods: [{ adjustments: [{ code: null, amount: 5 }] }],
    } as any)

    expect(result).toEqual([{ code: "PROMO", amount: 50 }])
    expect(result.every((action) => typeof action.code === "string")).toBe(
      true
    )
  })

  it("should merge adjustments with the same code across items and shipping methods, summing amounts", () => {
    const result = preparePromotionUsageComputedActions({
      items: [
        {
          adjustments: [
            { code: "PROMO", amount: 100 },
            { code: "OTHER", amount: 7 },
          ],
        },
        { adjustments: [{ code: "PROMO", amount: 50 }] },
      ],
      shipping_methods: [
        { adjustments: [{ code: "PROMO", amount: 12.5 }] },
        { adjustments: [{ code: "SHIP", amount: 3 }] },
      ],
    } as any)

    expect(result).toEqual([
      { code: "PROMO", amount: 162.5 },
      { code: "OTHER", amount: 7 },
      { code: "SHIP", amount: 3 },
    ])
  })

  it("should keep a single adjustment amount untouched", () => {
    const amount = { value: "10", precision: 20 }

    const result = preparePromotionUsageComputedActions({
      items: [{ adjustments: [{ code: "PROMO", amount }] }],
    } as any)

    expect(result).toEqual([{ code: "PROMO", amount }])
  })
})
