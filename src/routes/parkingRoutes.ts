import { Router } from 'express';
import multer from 'multer';
import { analyzeImage } from '../controllers/parkingController';

const router = Router();

// Configuracion de multer para almacenar temporalmente la imagen subida en la carpeta 'uploads/'
const upload = multer({ dest: 'uploads/' });

// Endpoint POST /parking/analyze
// Espera un FormData con un campo llamado 'imagen' que contiene el archivo de la ESP32-CAM
router.post('/analyze', upload.single('imagen'), analyzeImage);

export default router;
