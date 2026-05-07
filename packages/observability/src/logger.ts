import pino, { type Logger, type LoggerOptions } from 'pino';

export interface LogContext {
  service?: string;
  version?: string;
  env?: string;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
  userId?: string;
  operationName?: string;
  durationMs?: number;
  httpStatus?: number;
  [key: string]: unknown;
}

interface LoggerConfig {
  service: string;
  version?: string;
  env?: string;
  level?: string;
}

export function createLogger(config: LoggerConfig): Logger {
  const isDev = (config.env ?? process.env['NODE_ENV']) === 'development';

  const options: LoggerOptions = {
    level: config.level ?? process.env['LOG_LEVEL'] ?? 'info',
    base: {
      service: config.service,
      version: config.version ?? process.env['npm_package_version'] ?? '0.0.0',
      env: config.env ?? process.env['NODE_ENV'] ?? 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret'],
      censor: '[REDACTED]',
    },
  };

  if (isDev) {
    return pino(
      options,
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }),
    );
  }

  return pino(options);
}

// Root logger — apps configure their own via createLogger()
export const rootLogger = createLogger({ service: 'ecom-genai' });
export type { Logger };
