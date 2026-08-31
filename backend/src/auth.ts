import type { NextFunction, Request, Response } from "express";
import { getAuth } from "./firebase";

export type AuthUser = {
  uid: string;
  email: string | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({
        error: "Missing Authorization Bearer token.",
      });
      return;
    }

    const idToken = header.slice("Bearer ".length).trim();
    if (!idToken) {
      res.status(401).json({ error: "Empty Authorization token." });
      return;
    }

    const decoded = await getAuth().verifyIdToken(idToken);
    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
    };
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(401).json({
      error: "Invalid or expired Firebase ID token.",
      detail: message,
    });
  }
}
