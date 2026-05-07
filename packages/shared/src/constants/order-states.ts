export { ORDER_TRANSITIONS, TERMINAL_ORDER_STATES } from '../types/order.types.js';

import { ORDER_TRANSITIONS } from '../types/order.types.js';
import type { OrderStatus } from '../types/order.types.js';

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
