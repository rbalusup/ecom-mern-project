import { createHash, createHmac, randomUUID } from 'crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

export function hmacSha256(key: string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf-8').digest('hex');
}

export function generateId(): string {
  return randomUUID();
}

export function generateIdempotencyKey(scope: string, ...parts: string[]): string {
  return sha256([scope, ...parts].join(':'));
}

export function generateOrderNumber(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const seq = String(sequence).padStart(5, '0');
  return `ORD-${year}-${seq}`;
}
