import type { IConnection, IPageInfo, IPaginationArgs } from '../types/index.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function normalizePaginationArgs(args: IPaginationArgs): {
  limit: number;
  cursor: string | undefined;
} {
  const limit = Math.min(args.first ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { limit, cursor: args.after };
}

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf-8');
}

export function buildConnection<T>(
  nodes: T[],
  totalCount: number,
  getCursorValue: (node: T) => string,
  hasNextPage: boolean,
  hasPreviousPage = false,
): IConnection<T> {
  const edges = nodes.map((node) => ({
    node,
    cursor: encodeCursor(getCursorValue(node)),
  }));

  const pageInfo: IPageInfo = {
    hasNextPage,
    hasPreviousPage,
    ...(edges[0] && { startCursor: edges[0].cursor }),
    ...(edges[edges.length - 1] && { endCursor: edges[edges.length - 1]!.cursor }),
  };

  return { edges, pageInfo, totalCount };
}
