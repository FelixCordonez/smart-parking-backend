import { Router, Request, Response, NextFunction } from 'express';
import multer            from 'multer';
import path              from 'path';
import fs                from 'fs';
import { analyzeImage, uploadAndAnalyze } from '../controllers/parkingController';
import { validateApiKey } from '../middlewares/apiKeyMiddleware';

const router = Router();

// ─── Multer: almacenamiento temporal (endpoint /analyze legado) ───────────────
const tempStorage = multer({ dest: 'uploads/' });

// ─── Multer: escritura atómica para vista en vivo ─────────────────────────────
// Paso 1: Multer escribe la imagen en un archivo TEMPORAL (latest_temp.jpg).
// Paso 2: Un middleware posterior lo renombra a latest.jpg con fs.renameSync,
//          que es una operación atómica en el mismo filesystem. Esto evita que
//          la app móvil lea una imagen a medio escribir (fotos "cortadas").
const UPLOAD_DIR = path.resolve('uploads');
const TEMP_NAME  = 'latest_raw_temp.jpg';
const FINAL_NAME = 'latest_raw.jpg';

const liveStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, _file, cb) => {
    // Escribir primero a un archivo temporal
    cb(null, TEMP_NAME);
  },
});

const liveUpload = multer({
  storage: liveStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB máximo por imagen
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen.'));
    }
  },
});

/**
 * Middleware de renombrado atómico:
 * Mueve latest_temp.jpg → latest.jpg de forma atómica.
 * fs.renameSync en Linux (VPS) es atómico si ambos archivos están en el
 * mismo filesystem, lo que garantiza que cualquier lector obtiene la imagen
 * anterior completa O la nueva completa, pero nunca una a medias.
 */
const atomicRename = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.file) return next();

  const tempPath  = path.join(UPLOAD_DIR, TEMP_NAME);
  const finalPath = path.join(UPLOAD_DIR, FINAL_NAME);

  try {
    fs.renameSync(tempPath, finalPath);
    // Actualizar la info del archivo en req.file para que el controller
    // use la ruta final correcta
    req.file.filename = FINAL_NAME;
    req.file.path     = finalPath;
  } catch (err) {
    console.error('[upload] Error en renombrado atómico:', err);
    // Si falla el rename, intentar copiar + borrar como fallback
    try {
      fs.copyFileSync(tempPath, finalPath);
      fs.unlinkSync(tempPath);
      req.file.filename = FINAL_NAME;
      req.file.path     = finalPath;
    } catch (copyErr) {
      console.error('[upload] Fallback de copia también falló:', copyErr);
    }
  }

  next();
};

// ─── Endpoint ESP32-CAM: POST /parking/upload ─────────────────────────────────
//
// Flujo:
//   1. validateApiKey  → verifica X-API-KEY (401/403 si falla)
//   2. liveUpload      → guarda la imagen como uploads/latest_temp.jpg
//   3. atomicRename    → renombra atómicamente a uploads/latest.jpg
//   4. uploadAndAnalyze → ejecuta predict.py y responde con el JSON
//
router.post(
  '/upload',
  validateApiKey,
  liveUpload.single('imagen'),
  atomicRename,
  uploadAndAnalyze
);

// ─── Endpoint legado: POST /parking/analyze (sin API key, para compatibilidad) ─
router.post('/analyze', tempStorage.single('imagen'), analyzeImage);

export default router;

