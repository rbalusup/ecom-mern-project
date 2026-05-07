export * from './user.types.js';
export * from './product.types.js';
export * from './order.types.js';
export * from './ai.types.js';
export * from './events.types.js';

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface IPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface IConnection<T> {
  edges: Array<{ node: T; cursor: string }>;
  pageInfo: IPageInfo;
  totalCount: number;
}

export interface IPaginationArgs {
  first?: number | undefined;
  after?: string | undefined;
  last?: number | undefined;
  before?: string | undefined;
}

// ─── API Context ─────────────────────────────────────────────────────────────

export interface IRequestContext {
  userId?: string;
  userRole?: import('./user.types.js').UserRole;
  correlationId: string;
  traceId?: string;
  ip?: string;
}
