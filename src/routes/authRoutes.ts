import { Router } from 'express';
import { verifyUser } from '../controllers/authController';
import { verifyToken } from '../middlewares/authMiddleware';

const router = Router();

// Ruta protegida que ejecuta primero el middleware de seguridad (verifyToken)
router.post('/verify', verifyToken, verifyUser);

export default router;
