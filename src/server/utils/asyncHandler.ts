import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req: Request, res: Response) {
  if (req.accepts('html')) {
    res.status(404).send('Not Found');
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
}

export function errorMiddleware(err: any, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req as Request & { id?: string }).id || randomUUID();
  const status = err instanceof HttpError ? err.status : 500;
  const isServerError = status >= 500;

  if (isServerError) {
    console.error(`[API Error ${requestId}] ${req.method} ${req.originalUrl}`, err);
  }

  if (res.headersSent) return;

  if (isServerError && process.env.NODE_ENV === 'production') {
    res.status(status).json({ error: '服务器内部错误', requestId });
  } else if (isServerError) {
    res.status(status).json({ error: err instanceof Error ? err.message : String(err), requestId });
  } else {
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  (req as Request & { id?: string }).id = req.headers['x-request-id'] as string || randomUUID();
  next();
}
