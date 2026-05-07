import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { connectDB, disconnectDB } from '@ecom/db';

export const mongodbPlugin = fp(async (app: FastifyInstance) => {
  const uri = process.env['MONGODB_URI'];
  if (!uri) throw new Error('MONGODB_URI env var not set');

  const dbName = process.env['MONGODB_DB_NAME'];
  await connectDB({ uri, ...(dbName !== undefined && { dbName }) });
  app.log.info('MongoDB connected');

  app.addHook('onClose', async () => {
    await disconnectDB();
    app.log.info('MongoDB disconnected');
  });
}, { name: 'mongodb' });
