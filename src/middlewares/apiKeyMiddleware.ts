import { NextFunction, Request, Response } from 'express';

/**
 * Middleware de seguridad para el endpoint /upload del ESP32-CAM.
 *
 * Valida que la petición incluya el header `X-API-KEY` con el valor
 * correcto definido en la variable de entorno ESP32_API_KEY.
 *
 * Uso:
 *   router.post('/upload', validateApiKey, upload.single('imagen'), handler);
 *
 * Respuestas de error:
 *   401 → Header X-API-KEY ausente.
 *   403 → Header presente pero la clave no coincide.
 */
export const validateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const receivedKey = req.headers['x-api-key'] as string | undefined;

  // 1. Header no enviado
  if (!receivedKey) {
    res.status(401).json({
      error: 'Autenticación requerida.',
      detalle: 'El header X-API-KEY es obligatorio.',
    });
    return;
  }

  // 2. Clave incorrecta — timing-safe compare no es necesario para IoT
  //    de baja frecuencia, pero se deja la comparación estricta.
  const expectedKey = process.env.ESP32_API_KEY ?? '4002CorF';

  if (receivedKey !== expectedKey) {
    console.warn(
      `[apiKey] Acceso denegado desde ${req.ip} — clave incorrecta recibida.`
    );
    res.status(403).json({
      error: 'Acceso denegado.',
      detalle: 'La clave API proporcionada no es válida.',
    });
    return;
  }

  // 3. Clave válida → continuar al siguiente middleware
  next();
};
