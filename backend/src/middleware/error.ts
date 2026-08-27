import type { Request, Response, NextFunction } from "express";

/**
 * Middleware global de gestion d'erreurs.
 * Retourne JSON { success: false, error: message }
 */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[backend] erreur non gérée:", err?.stack || err?.message || err);

  const status = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : 500;
  const message = err?.message || "Erreur interne du serveur";

  res.status(status).json({
    success: false,
    data: null,
    error: message,
  });
}

/**
 * Helper pour wrapper async routes si besoin (optionnel, mais routes utilisent try/catch direct)
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
