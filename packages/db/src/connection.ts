import mongoose from 'mongoose';

interface ConnectionOptions {
  uri: string;
  dbName?: string;
  maxPoolSize?: number;
}

let isConnected = false;

export async function connectDB(options: ConnectionOptions): Promise<void> {
  if (isConnected) return;

  mongoose.set('strictQuery', true);

  await mongoose.connect(options.uri, {
    ...(options.dbName !== undefined && { dbName: options.dbName }),
    maxPoolSize: options.maxPoolSize ?? 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  } as mongoose.ConnectOptions);

  isConnected = true;

  const conn = mongoose.connection as unknown as NodeJS.EventEmitter;
  conn.on('disconnected', () => {
    isConnected = false;
  });
  conn.on('error', () => {
    isConnected = false;
  });
}

export async function disconnectDB(): Promise<void> {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
}

export function getConnection(): mongoose.Connection {
  return mongoose.connection;
}

export function isDBConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}
