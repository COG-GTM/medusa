import { ChangeActionType } from "@medusajs/framework/utils"
import { calculateOrderChange } from "../../../../utils"

describe("Order Claim - Actions", function () {
  const originalOrder = {
    id: "1",
    items: [
      {
        id: "1",
        quantity: 2,
        unit_price: 10,
        order_id: "1",
        detail: {
          order_id: "1",
          quantity: 2,
          delivered_quantity: 2,
          shipped_quantity: 2,
          fulfilled_quantity: 2,
          return_requested_quantity: 0,
          return_received_quantity: 0,
          return_dismissed_quantity: 0,
          written_off_quantity: 0,
        },
      },
    ],
    shipping_methods: [],
    total: 20,
  }

  const overClaimError =
    "Cannot claim more items than what was fulfilled for item 1."
  const overReturnError =
    "Cannot request to return more items than what was fulfilled for item 1."

  const writeOffAction = (quantity, claimId = "claim_1") => ({
    action: ChangeActionType.WRITE_OFF_ITEM,
    claim_id: claimId,
    details: { reference_id: "1", quantity },
  })

  const returnAction = (quantity, claimId?: string) => ({
    action: ChangeActionType.RETURN_ITEM,
    claim_id: claimId,
    details: { reference_id: "1", quantity },
  })

  const apply = (order, actions, claimReturnedQuantities?) =>
    calculateOrderChange({
      order,
      actions,
      options: { claimReturnedQuantities },
    })

  const withDetail = (detail) => {
    const order = JSON.parse(JSON.stringify(originalOrder))
    Object.assign(order.items[0].detail, detail)
    return order
  }

  it("should not allow claiming items that were already written off", function () {
    const order = JSON.parse(JSON.stringify(originalOrder))

    expect(() => apply(order, [writeOffAction(3)])).toThrow(overClaimError)

    const changes = apply(order, [writeOffAction(2)])
    const item = JSON.parse(JSON.stringify(changes.order.items[0]))
    expect(item.detail.written_off_quantity).toEqual("2")

    expect(() =>
      apply({ ...order, items: [...changes.order.items] }, [
        writeOffAction(1, "claim_2"),
      ])
    ).toThrow(overClaimError)
  })

  it("should allow claiming the units that were not written off yet", function () {
    const order = withDetail({ written_off_quantity: 1 })

    expect(() => apply(order, [writeOffAction(2)])).toThrow(overClaimError)

    const changes = apply(order, [writeOffAction(1)])
    const item = JSON.parse(JSON.stringify(changes.order.items[0]))
    expect(item.detail.written_off_quantity).toEqual("2")
  })

  it("should limit claims to the fulfilled quantity", function () {
    const order = withDetail({ fulfilled_quantity: 1 })

    expect(() => apply(order, [writeOffAction(2)])).toThrow(overClaimError)
    expect(() => apply(order, [writeOffAction(1)])).not.toThrow()
  })

  it("should not allow claiming units that were returned", function () {
    const order = withDetail({ return_received_quantity: 1 })
    expect(() => apply(order, [writeOffAction(2)])).toThrow(overClaimError)
    expect(() => apply(order, [writeOffAction(1)])).not.toThrow()

    const requested = withDetail({ return_requested_quantity: 2 })
    expect(() => apply(requested, [writeOffAction(1)])).toThrow(overClaimError)

    const dismissed = withDetail({
      return_dismissed_quantity: 1,
      written_off_quantity: 1,
    })
    expect(() => apply(dismissed, [writeOffAction(2)])).toThrow(overClaimError)
    expect(() => apply(dismissed, [writeOffAction(1)])).not.toThrow()
  })

  it("should not allow returning units that were claimed", function () {
    const order = withDetail({ written_off_quantity: 1 })

    expect(() => apply(order, [returnAction(2)])).toThrow(overReturnError)
    expect(() => apply(order, [returnAction(1)])).not.toThrow()
  })

  it("should allow a claim to write off and return the same units", function () {
    const order = JSON.parse(JSON.stringify(originalOrder))

    const changes = apply(order, [
      writeOffAction(2, "claim_1"),
      returnAction(2, "claim_1"),
    ])
    const item = JSON.parse(JSON.stringify(changes.order.items[0]))
    expect(item.detail.written_off_quantity).toEqual("2")
    expect(item.detail.return_requested_quantity).toEqual("2")

    expect(() =>
      apply(order, [returnAction(2, "claim_1"), writeOffAction(2, "claim_1")])
    ).not.toThrow()

    expect(() =>
      apply(order, [writeOffAction(1, "claim_1"), returnAction(2, "claim_1")])
    ).not.toThrow()

    expect(() =>
      apply(order, [writeOffAction(2, "claim_1"), returnAction(3, "claim_1")])
    ).toThrow(overReturnError)

    expect(() =>
      apply(withDetail({ written_off_quantity: 1 }), [
        writeOffAction(1, "claim_2"),
        returnAction(2, "claim_2"),
      ])
    ).toThrow(overReturnError)
  })

  it("should count a confirmed claim's written off and returned units once", function () {
    const afterClaim = withDetail({
      written_off_quantity: 1,
      return_received_quantity: 1,
    })

    expect(() => apply(afterClaim, [returnAction(1)])).toThrow(overReturnError)
    expect(() => apply(afterClaim, [returnAction(1)], { 1: 1 })).not.toThrow()
    expect(() => apply(afterClaim, [returnAction(2)], { 1: 1 })).toThrow(
      overReturnError
    )
    expect(() =>
      apply(afterClaim, [writeOffAction(1, "claim_2")], { 1: 1 })
    ).not.toThrow()

    const afterDamagedClaim = withDetail({
      written_off_quantity: 2,
      return_dismissed_quantity: 1,
    })
    expect(() =>
      apply(afterDamagedClaim, [returnAction(1)], { 1: 1 })
    ).not.toThrow()
    expect(() => apply(afterDamagedClaim, [returnAction(2)], { 1: 1 })).toThrow(
      overReturnError
    )
  })

  it("should not count more overlap than the units still returned and claimed", function () {
    const afterReducedClaimReturn = withDetail({
      written_off_quantity: 2,
      return_requested_quantity: 1,
    })

    expect(() =>
      apply(afterReducedClaimReturn, [returnAction(1)], { 1: 2 })
    ).toThrow(overReturnError)
  })
})
