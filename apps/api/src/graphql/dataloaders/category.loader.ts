import DataLoader from 'dataloader';

import { CategoryModel, type ICategoryDocument } from '@ecom/db';

export function createCategoryLoader(): DataLoader<string, ICategoryDocument | null> {
  return new DataLoader<string, ICategoryDocument | null>(
    async (ids) => {
      const categories = await CategoryModel.find({ _id: { $in: ids } })
        .lean<ICategoryDocument[]>()
        .exec();
      const map = new Map(categories.map((c) => [c._id.toString(), c]));
      return ids.map((id) => map.get(id) ?? null);
    },
    { cache: true, maxBatchSize: 100 },
  );
}

export function createCategoryChildrenLoader(): DataLoader<string, ICategoryDocument[]> {
  return new DataLoader<string, ICategoryDocument[]>(
    async (parentIds) => {
      const children = await CategoryModel.find({
        parentId: { $in: parentIds },
        isActive: true,
      })
        .sort({ sortOrder: 1, name: 1 })
        .lean<ICategoryDocument[]>()
        .exec();

      const map = new Map<string, ICategoryDocument[]>();
      for (const child of children) {
        const pid = child.parentId?.toString() ?? '';
        const existing = map.get(pid) ?? [];
        existing.push(child);
        map.set(pid, existing);
      }
      return parentIds.map((id) => map.get(id) ?? []);
    },
    { cache: true, maxBatchSize: 50 },
  );
}
