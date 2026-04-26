import { Request, Response, NextFunction } from 'express';
import { auth, admin } from '../config/firebase';

export interface AuthRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

export const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autorizado. Se requiere un token Bearer.' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verificando token:', error);
    res.status(401).json({ error: 'No autorizado. Token inválido o expirado.' });
  }
};
