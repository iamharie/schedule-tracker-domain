import { Request, Response } from 'express';

export interface AppContext {
  req: Request;
  res: Response;
  // userId added in Phase 2 after auth middleware reads the session cookie
  userId?: string;
}
