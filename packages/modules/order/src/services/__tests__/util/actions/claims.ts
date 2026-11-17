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

  const writeOff = (order, quantity) =>
    calculateOrderChange({
      order,
      actions: [
        {
          action: ChangeActionType.WRITE_OFF_ITEM,
          details: {
            reference_id: "1",
            quantity,
          },
        },
      ],
    })

  it("should not allow claiming items that were already written off", function () {
    const order = JSON.parse(JSON.stringify(originalOrder))

    expect(() => writeOff(order, 3)).toThrow(
      "Cannot claim more items than what was ordered."
    )

    const changes = writeOff(order, 2)
    const item = JSON.parse(JSON.stringify(changes.order.items[0]))
    expect(item.detail.written_off_quantity).toEqual("2")

    expect(() =>
      writeOff({ ...order, items: [...changes.order.items] }, 1)
    ).toThrow("Cannot claim more items than what was ordered.")
  })

  it("should allow claiming the units that were not written off yet", function () {
    const order = JSON.parse(JSON.stringify(originalOrder))
    order.items[0].detail.written_off_quantity = 1

    expect(() => writeOff(order, 2)).toThrow(
      "Cannot claim more items than what was ordered."
    )

    const changes = writeOff(order, 1)
    const item = JSON.parse(JSON.stringify(changes.order.items[0]))
    expect(item.detail.written_off_quantity).toEqual("2")
  })
})
