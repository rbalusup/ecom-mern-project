import DataLoader from 'dataloader';

import { ProductModel, type IProductDocument } from '@ecom/db';

export function createProductLoader(): DataLoader<string, IProductDocument | null> {
  return new DataLoader<string, IProductDocument | null>(
    async (ids) => {
      const products = await ProductModel.find({ _id: { $in: ids }, isDeleted: false })
        .lean<IProductDocument[]>()
        .exec();
      const map = new Map(products.map((p) => [p._id.toString(), p]));
      return ids.map((id) => map.get(id) ?? null);
    },
    { cache: true, maxBatchSize: 100 },
  );
}
