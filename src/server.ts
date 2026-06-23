import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import parkingRoutes from './routes/parkingRoutes';

import path from 'path';

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globales
app.use(cors());
app.use(express.json()); // Necesario para interpretar respuestas JSON desde Axios

// ─── Servir carpeta pública para ver la imagen en el navegador ────────────
// Permite acceder a http://<ip>:<port>/uploads/latest.jpg
// Se desactiva ETag y se pone maxAge=0 para que cada request obtenga
// la imagen más reciente (evitar imágenes viejas cacheadas).
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), {
  etag: false,
  lastModified: true,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

// Montar Rutas
app.use('/auth', authRoutes);
app.use('/parking', parkingRoutes);

// Ruta de estado
app.get('/', (req, res) => {
  res.json({ status: 'API del Backend funcionando correctamente' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor Backend ejecutándose en http://localhost:${PORT}`);
  console.log(`Puntos de acceso disponibles:`);
  console.log(`- POST http://localhost:${PORT}/auth/verify`);
  console.log(`- POST http://localhost:${PORT}/parking/analyze`);
  console.log(`- POST http://localhost:${PORT}/parking/upload  ← ESP32-CAM (requiere X-API-KEY)\n`);

  if (!process.env.ESP32_API_KEY) {
    console.warn('⚠️  ADVERTENCIA: La variable ESP32_API_KEY no está definida en .env');
    console.warn('   Se usará el valor por defecto "MI_CLAVE_SUPER_SECRETA_123".');
    console.warn('   Define ESP32_API_KEY=<tu_clave> en el archivo .env antes de producción.\n');
  }
});

