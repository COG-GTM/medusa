import {
  Context,
  CreateOrderChangeActionDTO,
  OrderTypes,
} from "@medusajs/framework/types"
import {
  ChangeActionType,
  OrderChangeType,
  ReturnStatus,
  getShippingMethodsTotals,
  isString,
  promiseAll,
  toMikroORMEntity,
} from "@medusajs/framework/utils"
import { OrderExchange, OrderExchangeItem, Return, ReturnItem } from "@models"

type EntityManagerLike = { create: (entity: any, data: any) => any }
type CreateExchangeData = OrderTypes.CreateOrderExchangeDTO & {
  refund_amount?: unknown
  return_items?: Record<string, any>[]
}
type ExchangeService = {
  orderLineItemService_: { create: (...args: any[]) => Promise<any[]> }
  createOrderShippingMethods: (...args: any[]) => Promise<any[]>
  retrieveOrderShippingMethod: (...args: any[]) => Promise<any>
}

function createExchangeAndReturnEntities(
  em: EntityManagerLike,
  data: CreateExchangeData,
  order: Record<string, any>
) {
  const exchangeReference = em.create(toMikroORMEntity(OrderExchange), {
    order_id: data.order_id,
    order_version: order.version,
    no_notification: data.no_notification,
    allow_backorder: data.allow_backorder,
    difference_due: data.difference_due,
  })

  const returnReference = em.create(toMikroORMEntity(Return), {
    order_id: data.order_id,
    order_version: order.version,
    status: ReturnStatus.REQUESTED,
    exchange_id: exchangeReference.id,
    refund_amount: data.refund_amount ?? null,
  })

  exchangeReference.return = returnReference

  return { exchangeReference, returnReference }
}

function createReturnItems(
  em: EntityManagerLike,
  data: CreateExchangeData,
  exchangeReference: Record<string, any>,
  returnReference: Record<string, any>,
  actions: CreateOrderChangeActionDTO[]
) {
  return data.return_items?.map((item: Record<string, any>) => {
    actions.push({
      action: ChangeActionType.RETURN_ITEM,
      reference: "return",
      reference_id: returnReference.id,
      details: {
        reference_id: item.id,
        quantity: item.quantity,
        metadata: item.metadata,
      },
    })

    return em.create(toMikroORMEntity(ReturnItem), {
      item_id: item.id,
      return_id: returnReference.id,
      reason: item.reason,
      quantity: item.quantity,
      note: item.note,
      metadata: item.metadata,
    })
  })
}

async function processAdditionalItems(
  em: EntityManagerLike,
  service: ExchangeService,
  data: OrderTypes.CreateOrderExchangeDTO,
  order: Record<string, any>,
  exchangeReference: Record<string, any>,
  actions: CreateOrderChangeActionDTO[],
  sharedContext?: Context
) {
  const itemsToAdd: any[] = []
  const additionalNewItems: any[] = []
  const additionalItems: any[] = []
  data.additional_items?.forEach((item: Record<string, any>) => {
    const hasItem = item.id
      ? order.items.find((o: Record<string, any>) => o.item.id === item.id)
      : false

    if (hasItem) {
      actions.push({
        action: ChangeActionType.ITEM_ADD,
        exchange_id: exchangeReference.id,
        internal_note: item.internal_note,
        reference: "exchange",
        reference_id: exchangeReference.id,
        details: {
          reference_id: item.id,
          quantity: item.quantity,
          unit_price: item.unit_price ?? hasItem.item.unit_price,
          metadata: item.metadata,
        },
      })

      additionalItems.push(
        em.create(toMikroORMEntity(OrderExchangeItem), {
          item_id: item.id,
          quantity: item.quantity,
          note: item.note,
          metadata: item.metadata,
          is_additional_item: true,
        })
      )
    } else {
      itemsToAdd.push(item)

      additionalNewItems.push(
        em.create(toMikroORMEntity(OrderExchangeItem), {
          quantity: item.quantity,
          unit_price: item.unit_price,
          note: item.note,
          metadata: item.metadata,
          is_additional_item: true,
        })
      )
    }
  })

  const createItems = await service.orderLineItemService_.create(
    itemsToAdd,
    sharedContext
  )

  createItems.forEach((item: Record<string, any>, index: number) => {
    const addedItem = itemsToAdd[index]

    additionalNewItems[index].item_id = item.id

    actions.push({
      action: ChangeActionType.ITEM_ADD,
      exchange_id: exchangeReference.id,
      internal_note: addedItem.internal_note,
      reference: "exchange",
      reference_id: exchangeReference.id,
      details: {
        reference_id: item.id,
        exchange_id: exchangeReference.id,
        quantity: addedItem.quantity,
        unit_price: item.unit_price,
        metadata: addedItem.metadata,
      },
    })
  })

  return additionalNewItems.concat(additionalItems)
}

async function processShippingMethods(
  service: ExchangeService,
  data: OrderTypes.CreateOrderExchangeDTO,
  exchangeReference: Record<string, any>,
  actions: CreateOrderChangeActionDTO[],
  sharedContext?: Context
) {
  for (const shippingMethod of data.shipping_methods ?? []) {
    let shippingMethodId

    if (!isString(shippingMethod)) {
      const methods = await service.createOrderShippingMethods(
        [
          {
            ...shippingMethod,
            order_id: data.order_id,
            exchange_id: exchangeReference.id,
          },
        ],
        sharedContext
      )
      shippingMethodId = methods[0].id
    } else {
      shippingMethodId = shippingMethod
    }

    const method = await service.retrieveOrderShippingMethod(
      shippingMethodId,
      { relations: ["tax_lines", "adjustments"] },
      sharedContext
    )

    const calculatedAmount = getShippingMethodsTotals([method as any], {})[
      method.id
    ]

    actions.push({
      action: ChangeActionType.SHIPPING_ADD,
      reference: "order_shipping_method",
      reference_id: shippingMethodId,
      exchange_id: exchangeReference.id,
      amount: calculatedAmount.total,
    })
  }
}

async function processReturnShipping(
  service: ExchangeService,
  data: OrderTypes.CreateOrderExchangeDTO,
  exchangeReference: Record<string, any>,
  returnReference: Record<string, any>,
  actions: CreateOrderChangeActionDTO[],
  sharedContext?: Context
) {
  let returnShippingMethodId

  if (!isString(data.return_shipping)) {
    const methods = await service.createOrderShippingMethods(
      [
        {
          ...data.return_shipping,
          order_id: data.order_id,
          exchange_id: exchangeReference.id,
          return_id: returnReference.id,
        },
      ],
      sharedContext
    )
    returnShippingMethodId = methods[0].id
  } else {
    returnShippingMethodId = data.return_shipping
  }

  const method = await service.retrieveOrderShippingMethod(
    returnShippingMethodId,
    { relations: ["tax_lines", "adjustments"] },
    sharedContext
  )

  const calculatedAmount = getShippingMethodsTotals([method as any], {})[
    method.id
  ]

  actions.push({
    action: ChangeActionType.SHIPPING_ADD,
    reference: "order_shipping_method",
    reference_id: returnShippingMethodId,
    return_id: returnReference.id,
    exchange_id: exchangeReference.id,
    amount: calculatedAmount.total,
  })
}

export async function createExchange(
  this: any,
  data: OrderTypes.CreateOrderExchangeDTO,
  sharedContext?: Context
) {
  const order = await this.orderService_.retrieve(
    data.order_id,
    { relations: ["items"] },
    sharedContext
  )
  const actions: CreateOrderChangeActionDTO[] = []
  const em = sharedContext!.transactionManager as any
  const { exchangeReference, returnReference } =
    createExchangeAndReturnEntities(em, data, order)

  returnReference.items = createReturnItems(
    em,
    data,
    exchangeReference,
    returnReference,
    actions
  )

  exchangeReference.additional_items = await processAdditionalItems(
    em,
    this,
    data,
    order,
    exchangeReference,
    actions,
    sharedContext
  )
  await processShippingMethods(
    this,
    data,
    exchangeReference,
    actions,
    sharedContext
  )
  await processReturnShipping(
    this,
    data,
    exchangeReference,
    returnReference,
    actions,
    sharedContext
  )

  const change = await this.createOrderChange_(
    {
      order_id: data.order_id,
      exchange_id: exchangeReference.id,
      return_id: returnReference.id,
      change_type: OrderChangeType.EXCHANGE,
      reference: "exchange",
      reference_id: exchangeReference.id,
      description: data.description,
      internal_note: data.internal_note,
      created_by: data.created_by,
      metadata: data.metadata,
      actions,
    },
    sharedContext
  )

  await promiseAll([
    this.createReturns([returnReference], sharedContext),
    this.createOrderExchanges([exchangeReference], sharedContext),
    this.confirmOrderChange(change[0].id, sharedContext),
  ])
  return exchangeReference
}
