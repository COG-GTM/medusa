import { Context, OrderTypes } from "@medusajs/framework/types"
import {
  ChangeActionType,
  MathBN,
  OrderChangeType,
  ReturnStatus,
  promiseAll,
} from "@medusajs/framework/utils"

type ReceiveReturnData = OrderTypes.ReceiveOrderReturnDTO & Record<string, any>
type ReturnItemAction = ReturnType<typeof createReturnItems>[number]

function createReturnItems(data: ReceiveReturnData) {
  return data.items.map((item: Record<string, any>) => ({
    action: ChangeActionType.RECEIVE_RETURN_ITEM,
    internal_note: item.internal_note,
    reference: data.reference,
    reference_id: data.reference_id,
    details: {
      reference_id: item.id,
      quantity: item.quantity,
    },
  }))
}

async function createOrderChange(
  service: { createOrderChange_: (...args: any[]) => Promise<any> },
  data: ReceiveReturnData,
  returnEntry: Record<string, any>,
  items: ReturnItemAction[],
  sharedContext?: Context
) {
  return await service.createOrderChange_(
    {
      order_id: returnEntry.order_id,
      return_id: returnEntry.id,
      reference: "return",
      reference_id: returnEntry.id,
      change_type: OrderChangeType.RETURN_RECEIVE,
      description: data.description,
      internal_note: data.internal_note,
      created_by: data.created_by,
      metadata: data.metadata,
      actions: items,
    },
    sharedContext
  )
}

function updateReturnItems(
  returnEntry: Record<string, any>,
  items: ReturnItemAction[]
) {
  return returnEntry.items
    .map((item: Record<string, any>) => {
      const data = items.find(
        (i: ReturnItemAction) => i.details.reference_id === item.item_id
      )
      if (!data) return

      const receivedQuantity = MathBN.add(
        item.received_quantity || 0,
        data.details.quantity
      )
      item.received_quantity = receivedQuantity

      return {
        id: item.id,
        received_quantity: receivedQuantity,
      }
    })
    .filter(Boolean)
}

function checkAllItemsReceived(returnEntry: Record<string, any>) {
  return returnEntry.items.every((item: Record<string, any>) =>
    MathBN.eq(item.received_quantity, item.quantity)
  )
}

function getReturnUpdateData(hasReceivedAllItems: boolean) {
  return hasReceivedAllItems
    ? { status: ReturnStatus.RECEIVED, received_at: new Date() }
    : { status: ReturnStatus.PARTIALLY_RECEIVED }
}

export async function receiveReturn(
  this: any,
  data: OrderTypes.ReceiveOrderReturnDTO,
  sharedContext?: Context
) {
  const returnEntry = await this.retrieveReturn(
    data.return_id,
    {
      select: ["id", "order_id"],
      relations: ["items", "items.item"],
    },
    sharedContext
  )

  const items = createReturnItems(data)
  const change = await createOrderChange(
    this,
    data,
    returnEntry,
    items,
    sharedContext
  )

  await this.confirmOrderChange(change[0].id, sharedContext)

  const retItemsToUpdate = updateReturnItems(returnEntry, items)
  const hasReceivedAllItems = checkAllItemsReceived(returnEntry)
  const retData = getReturnUpdateData(hasReceivedAllItems)

  const [returnRef] = await promiseAll([
    this.updateReturns(
      { selector: { id: returnEntry.id }, data: retData },
      sharedContext
    ),
    this.updateReturnItems(retItemsToUpdate, sharedContext),
  ])

  return returnRef
}
