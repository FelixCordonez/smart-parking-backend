import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import parkingRoutes from './routes/parkingRoutes';

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globales
app.use(cors());
app.use(express.json()); // Necesario para interpretar respuestas JSON desde Axios

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
  console.log(`- POST http://localhost:${PORT}/parking/analyze\n`);
});
