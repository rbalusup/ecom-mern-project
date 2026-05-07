import type { FilterQuery } from 'mongoose';

import type { IConnection, IPaginationArgs, IOrderFilter, OrderStatus } from '@ecom/shared';
import { InvalidOrderTransitionError, ORDER_TRANSITIONS, generateIdempotencyKey } from '@ecom/shared';

import { OrderModel, OrderEventModel, type IOrderDocument, type IOrderEventDocument } from '../models/Order.model.js';
import { BaseRepository } from './base.repository.js';

export class OrderRepository extends BaseRepository<IOrderDocument> {
  constructor() {
    super(OrderModel);
  }

  async findByOrderNumber(orderNumber: string): Promise<IOrderDocument | null> {
    return this.model.findOne({ orderNumber }).lean<IOrderDocument>().exec();
  }

  async findWithFilters(
    filter: IOrderFilter,
    args: IPaginationArgs,
  ): Promise<IConnection<IOrderDocument>> {
    const query: FilterQuery<IOrderDocument> = {};

    if (filter.customerId) query['customerId'] = filter.customerId;
    if (filter.status) query['status'] = filter.status;
    if (filter.fromDate || filter.toDate) {
      query['createdAt'] = {
        ...(filter.fromDate && { $gte: filter.fromDate }),
        ...(filter.toDate && { $lte: filter.toDate }),
      };
    }

    return this.findWithCursorPagination(query, args, { field: 'createdAt', order: 'desc' });
  }

  async transitionStatus(
    orderId: string,
    toStatus: OrderStatus,
    actorId: string,
    payload: Record<string, unknown> = {},
  ): Promise<IOrderDocument> {
    const order = await this.model.findById(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);

    const validTransitions = ORDER_TRANSITIONS[order.status];
    if (!validTransitions?.includes(toStatus)) {
      throw new InvalidOrderTransitionError(order.status, toStatus);
    }

    const idempotencyKey = generateIdempotencyKey('order-transition', orderId, order.status, toStatus);

    // Use a session for atomicity: update order + insert event
    const session = await OrderModel.startSession();
    let updatedOrder: IOrderDocument | null = null;

    try {
      await session.withTransaction(async () => {
        updatedOrder = await this.model
          .findByIdAndUpdate(
            orderId,
            { status: toStatus },
            { new: true, session },
          )
          .lean<IOrderDocument>();

        await OrderEventModel.create(
          [
            {
              orderId,
              eventType: `order.${toStatus.replace(/_/g, '.')}`,
              fromStatus: order.status,
              toStatus,
              actorId,
              payload,
              idempotencyKey,
              timestamp: new Date(),
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    if (!updatedOrder) throw new Error('Order transition failed');
    return updatedOrder;
  }

  async getOrderEvents(orderId: string): Promise<IOrderEventDocument[]> {
    return OrderEventModel.find({ orderId }).sort({ timestamp: 1 }).lean<IOrderEventDocument[]>().exec();
  }
}
