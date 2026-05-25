import type { Response } from 'express';

export function toJsonSuccess(res: Response, data: unknown, status: number = 200) {
  res.status(status).json({ success: true, data });
}

export function toJsonError(res: Response, error: string, code: string, status: number) {
  res.status(status).json({ success: false, error, code });
}
