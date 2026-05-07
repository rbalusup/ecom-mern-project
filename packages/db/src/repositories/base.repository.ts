import type { Document, FilterQuery, Model, Types, UpdateQuery } from 'mongoose';

import { encodeCursor, decodeCursor } from '@ecom/shared';
import type { IConnection, IPaginationArgs } from '@ecom/shared';

import { NotFoundError } from '@ecom/shared';

export interface ISortOptions {
  field: string;
  order: 'asc' | 'desc';
}

export abstract class BaseRepository<T extends Document> {
  constructor(protected readonly model: Model<T>) {}

  async findById(id: string, projection?: Record<string, 0 | 1>): Promise<T | null> {
    return this.model.findById(id, projection).lean<T>().exec();
  }

  async findByIdOrThrow(id: string, resourceName: string): Promise<T> {
    const doc = await this.findById(id);
    if (!doc) throw new NotFoundError(resourceName, id);
    return doc;
  }

  async findOne(filter: FilterQuery<T>): Promise<T | null> {
    return this.model.findOne(filter).lean<T>().exec();
  }

  async create(data: Partial<T>): Promise<T> {
    const doc = new this.model(data);
    return (await doc.save()) as T;
  }

  async updateById(id: string | Types.ObjectId, update: UpdateQuery<T>): Promise<T | null> {
    return this.model
      .findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .lean<T>()
      .exec();
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: id } as FilterQuery<T>);
    return result.deletedCount > 0;
  }

  async softDeleteById(id: string): Promise<T | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { isDeleted: true, deletedAt: new Date() } as UpdateQuery<T>,
        { new: true },
      )
      .lean<T>()
      .exec();
  }

  async count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments(filter);
  }

  async findWithCursorPagination(
    filter: FilterQuery<T>,
    args: IPaginationArgs,
    sort: ISortOptions = { field: '_id', order: 'asc' },
  ): Promise<IConnection<T>> {
    const limit = Math.min(args.first ?? 20, 100);

    const cursorFilter: FilterQuery<T> = { ...filter };
    if (args.after) {
      const cursorValue = decodeCursor(args.after);
      const sortOp = sort.order === 'asc' ? '$gt' : '$lt';
      (cursorFilter as Record<string, unknown>)[sort.field] = { [sortOp]: cursorValue };
    }

    const sortDir = sort.order === 'asc' ? 1 : -1;

    const [docs, totalCount] = await Promise.all([
      this.model
        .find(cursorFilter)
        .sort({ [sort.field]: sortDir })
        .limit(limit + 1) // fetch one extra to check hasNextPage
        .lean<T[]>()
        .exec(),
      this.model.countDocuments(filter),
    ]);

    const hasNextPage = docs.length > limit;
    const nodes = hasNextPage ? docs.slice(0, limit) : docs;

    const edges = nodes.map((node) => ({
      node,
      cursor: encodeCursor(String((node as Record<string, unknown>)[sort.field])),
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!args.after,
        ...(edges[0] && { startCursor: edges[0].cursor }),
        ...(edges[edges.length - 1] && { endCursor: edges[edges.length - 1]!.cursor }),
      },
      totalCount,
    };
  }
}
