import DataLoader from 'dataloader';

import { UserModel, type IUserDocument } from '@ecom/db';

export function createUserLoader(): DataLoader<string, IUserDocument | null> {
  return new DataLoader<string, IUserDocument | null>(
    async (ids) => {
      const users = await UserModel.find({ _id: { $in: ids } }).lean<IUserDocument[]>().exec();
      const map = new Map(users.map((u) => [u._id.toString(), u]));
      return ids.map((id) => map.get(id) ?? null);
    },
    { cache: true, maxBatchSize: 100 },
  );
}
