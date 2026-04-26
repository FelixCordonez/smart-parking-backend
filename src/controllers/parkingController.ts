import { Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import admin from 'firebase-admin';

export const analyzeImage = async (req: Request, res: Response): Promise<any> => {
  try {
    // 1. Obtener la imagen subida por multer (ESP32-CAM)
    const imageFile = req.file;
    if (!imageFile) {
      return res.status(400).json({ error: 'No se subio ninguna imagen' });
    }

    const imagePath = path.resolve(imageFile.path);
    const scriptPath = path.resolve(__dirname, '../../scripts/predict.py');

    // 2. Ejecutar el script de Python asincronamente usando Child Process
    // Esto asegura que el Event Loop de Node.js no se bloquee mientras YOLO procesa
    const pythonProcess = spawn('python', [scriptPath, imagePath]);

    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    pythonProcess.on('close', async (code) => {
      // Eliminar imagen temporal para ahorrar disco
      fs.unlink(imagePath, (err) => {
        if (err) console.error('Error al eliminar imagen temporal:', err);
      });

      if (code !== 0) {
        console.error('Error en script de ML:', errorData);
        return res.status(500).json({ error: 'Error procesando la imagen con IA' });
      }

      try {
        // 3. Parsear respuesta del modelo YOLO
        const mlResult = JSON.parse(outputData.trim());
        
        if (mlResult.error) {
          return res.status(500).json({ error: mlResult.error });
        }

        // 4. Actualizacion Silenciosa en Firestore
        const db = admin.firestore();
        const spaceRef = db.collection('estacionamiento').doc(`espacio_${mlResult.espacio_id}`);
        
        await spaceRef.set({
          ocupado: mlResult.ocupado,
          confianza: mlResult.confianza,
          ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // 5. Responder a la camara
        return res.status(200).json({
          success: true,
          mensaje: mlResult.mensaje,
          espacio: mlResult.espacio_id,
          ocupado: mlResult.ocupado
        });

      } catch (parseError) {
        console.error('Error parseando JSON de Python:', parseError);
        return res.status(500).json({ error: 'Respuesta invalida del modelo' });
      }
    });

  } catch (error: any) {
    console.error('Error en controlador de ML:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
