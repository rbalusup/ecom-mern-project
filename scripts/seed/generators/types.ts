import type { Types } from 'mongoose';

export interface SeededCategory {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  level: number;
}
