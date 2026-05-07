import type { PipelineStage } from 'mongoose';

export function buildOrderAnalyticsPipeline(fromDate: Date, toDate: Date): PipelineStage[] {
  return [
    {
      $match: {
        createdAt: { $gte: fromDate, $lte: toDate },
        status: { $nin: ['cancelled', 'payment_failed'] },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
        },
        orderCount: { $sum: 1 },
        totalRevenue: { $sum: { $toDouble: '$pricing.total' } },
        averageOrderValue: { $avg: { $toDouble: '$pricing.total' } },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
  ];
}

export function buildCustomerOrderHistoryPipeline(customerId: string): PipelineStage[] {
  return [
    { $match: { customerId } },
    { $sort: { createdAt: -1 } },
    { $limit: 50 },
    {
      $lookup: {
        from: 'order_events',
        localField: '_id',
        foreignField: 'orderId',
        as: 'events',
        pipeline: [{ $sort: { timestamp: 1 } }],
      },
    },
  ];
}
