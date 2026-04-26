import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { db } from '../config/firebase';

export const verifyUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const decodedToken = req.user;
    
    if (!decodedToken) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }

    const { uid, email } = decodedToken;
    
    if (!email) {
      res.status(400).json({ error: 'El token no contiene un correo válido' });
      return;
    }

    const userRef = db.collection('usuarios').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      // Si el usuario no existe en la base de datos, lo creamos
      const newUser = {
        uid,
        email,
        rol: 'usuario', // Rol por defecto, asegurando compatibilidad y escalabilidad
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await userRef.set(newUser);
      
      res.status(201).json({
        message: 'Usuario verificado y registrado exitosamente',
        user: newUser
      });
      return;
    }

    // Si ya existe, lo devolvemos
    const existingUser = userDoc.data();
    
    res.status(200).json({
      message: 'Usuario verificado',
      user: existingUser
    });

  } catch (error) {
    console.error('Error en verifyUser:', error);
    res.status(500).json({ error: 'Error interno del servidor al verificar usuario' });
  }
};
