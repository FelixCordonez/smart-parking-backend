import { Request, Response } from 'express';
import { spawn, exec }       from 'child_process';
import path                  from 'path';
import fs                    from 'fs';
import { db, admin }         from '../config/firebase';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Estructura que retorna predict.py para cada espacio analizado.
 */
interface SpaceResult {
  id:     string;            // e.g. "Derecha_1", "Izquierda_3"
  estado: 'ocupado' | 'disponible';
}

/**
 * Payload completo que el script Python imprime por stdout.
 */
interface PythonOutput {
  espacios?: SpaceResult[];
  error?:    string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Colección Firestore única para los espacios de parqueo. */
const PARKING_COLLECTION = 'espacios' as const;

/** Ruta al script Python de inferencia. */
const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/predict.py');

/**
 * Ruta al modelo PyTorch (.pth).
 * Se puede sobreescribir con la variable de entorno ML_MODEL_PATH.
 * Por convención, el archivo vive junto al script de predicción.
 */
const MODEL_PATH = process.env.ML_MODEL_PATH
  ?? path.resolve(__dirname, '../../scripts/faster_rcnn_estacionamiento_real_10epochs.pth');

/**
 * Ruta fija de la imagen de vista en vivo.
 * Multer (diskStorage con filename='latest.jpg') la escribe aquí.
 * La próxima imagen del ESP32 la sobrescribirá automáticamente.
 */
const LIVE_IMAGE_PATH = path.resolve('uploads', 'latest.jpg');

// ─── Helper: actualizar Firestore ─────────────────────────────────────────────

/**
 * Persiste el resultado del análisis en Firestore usando un WriteBatch
 * atómico. Si Firestore falla, la función lanza la excepción para que
 * el caller decida si cortocircuitar la respuesta o no.
 */
async function persistToFirestore(espacios: SpaceResult[]): Promise<void> {
  const batch = db.batch();
  const now   = admin.firestore.FieldValue.serverTimestamp();

  for (const space of espacios) {
    if (!space.id || !space.estado) {
      console.warn('[parking] Espacio con datos incompletos, omitido:', space);
      continue;
    }
    const spaceRef = db.collection(PARKING_COLLECTION).doc(space.id);
    batch.set(
      spaceRef,
      { estado: space.estado, updatedAt: now },
      { merge: true }   // Preserva campos no incluidos (zona, reservadoPor, etc.)
    );
  }

  await batch.commit();
}

// ─── Controlador legado: POST /parking/analyze ────────────────────────────────

/**
 * POST /parking/analyze
 *
 * Recibe una imagen del ESP32-CAM via FormData (campo "imagen"),
 * la procesa con YOLO en un proceso hijo de Python y actualiza
 * el estado de cada espacio en Firestore.
 *
 * La imagen temporal es ELIMINADA del disco tras el análisis.
 * Para un flujo de "vista en vivo" usar POST /parking/upload.
 */
export const analyzeImage = async (req: Request, res: Response): Promise<any> => {

  // 1. Validar archivo ──────────────────────────────────────────────────────────
  const imageFile = req.file;
  if (!imageFile) {
    return res.status(400).json({
      error: 'No se adjuntó ninguna imagen (campo "imagen" requerido).',
    });
  }

  const imagePath = path.resolve(imageFile.path);

  // 2. Spawn del proceso Python ─────────────────────────────────────────────────
  const pythonCmd = process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python' : 'python3');
  const pythonProcess = spawn(pythonCmd, [SCRIPT_PATH, imagePath, MODEL_PATH]);

  let stdoutBuffer = '';
  let stderrBuffer = '';

  pythonProcess.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
  });

  pythonProcess.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  pythonProcess.on('close', async (exitCode: number | null) => {

    // 3. Limpiar imagen temporal (siempre, sin importar el resultado) ────────────
    fs.unlink(imagePath, (unlinkErr) => {
      if (unlinkErr) {
        console.warn('[parking] No se pudo eliminar imagen temporal:', unlinkErr.message);
      }
    });

    // 4. Verificar exit code ──────────────────────────────────────────────────────
    if (exitCode !== 0) {
      console.error('[parking] Python finalizó con error (exit', exitCode, '):', stderrBuffer);
      return res.status(500).json({
        error:   'El script de IA finalizó con un error.',
        detalle: stderrBuffer.trim() || 'Sin detalle disponible.',
      });
    }

    // 5. Parsear JSON de Python ────────────────────────────────────────────────────
    let pythonOutput: PythonOutput;
    try {
      pythonOutput = JSON.parse(stdoutBuffer.trim()) as PythonOutput;
    } catch {
      console.error('[parking] Stdout no es JSON válido:', stdoutBuffer);
      return res.status(500).json({ error: 'La respuesta del modelo no es JSON válido.' });
    }

    if (pythonOutput.error) {
      console.error('[parking] Error reportado por Python:', pythonOutput.error);
      return res.status(500).json({ error: pythonOutput.error });
    }

    if (!Array.isArray(pythonOutput.espacios) || pythonOutput.espacios.length === 0) {
      return res.status(500).json({ error: 'El modelo no retornó datos de espacios.' });
    }

    // 6. Persistir en Firestore ────────────────────────────────────────────────────
    try {
      await persistToFirestore(pythonOutput.espacios);
    } catch (firestoreError: any) {
      console.error('[parking] Error al escribir en Firestore:', firestoreError);
      return res.status(500).json({
        error:   'Error al persistir los resultados en la base de datos.',
        detalle: firestoreError?.message ?? 'Sin detalle.',
      });
    }

    // 7. Responder al ESP32 ───────────────────────────────────────────────────────
    const ocupados    = pythonOutput.espacios.filter(s => s.estado === 'ocupado').length;
    const disponibles = pythonOutput.espacios.filter(s => s.estado === 'disponible').length;

    return res.status(200).json({
      success:    true,
      mensaje:    `Análisis completo. ${disponibles} espacio(s) libre(s), ${ocupados} ocupado(s).`,
      total:      pythonOutput.espacios.length,
      disponibles,
      ocupados,
      espacios:   pythonOutput.espacios,
    });
  });

  // Capturar error de proceso (p.ej. Python no instalado en el servidor)
  pythonProcess.on('error', (processError: NodeJS.ErrnoException) => {
    console.error('[parking] No se pudo iniciar el proceso Python:', processError);
    fs.unlink(imagePath, () => {});
    return res.status(500).json({
      error:   'No se pudo ejecutar el intérprete de Python.',
      detalle: processError.message,
    });
  });
};

// ─── Controlador nuevo: POST /parking/upload (ESP32-CAM con API Key) ──────────

/**
 * POST /parking/upload
 *
 * Endpoint optimizado para el ESP32-CAM con autenticación por API Key.
 * La imagen ya fue guardada como `uploads/latest.jpg` por el diskStorage
 * de multer (nombre fijo → sobrescritura automática → vista en vivo).
 *
 * Diferencias vs /analyze:
 *   - Seguridad: requiere header X-API-KEY (validado en apiKeyMiddleware).
 *   - Almacenamiento: la imagen NO se elimina; siempre es uploads/latest.jpg.
 *   - Ejecución de Python: usa exec() en lugar de spawn() para capturar
 *     el stdout completo de una sola vez (más simple para procesos cortos).
 *   - Firestore: si falla, igual responde al ESP32 con los datos de la IA
 *     (el hardware no debe reenviar por un error de base de datos).
 */
export const uploadAndAnalyze = async (req: Request, res: Response): Promise<any> => {

  // 1. Validar que multer guardó el archivo ────────────────────────────────────
  if (!req.file) {
    return res.status(400).json({
      error:   'No se adjuntó ninguna imagen.',
      detalle: 'El campo de formulario debe llamarse "imagen".',
    });
  }

  console.log(`[upload] ✅ Imagen recibida → ${LIVE_IMAGE_PATH} (${req.file.size} bytes)`);

  // 2. Ejecutar predict.py con child_process.exec ───────────────────────────────
  // exec() es ideal aquí porque:
  //   a) predict.py es de corta duración (< 60s).
  //   b) Necesitamos el stdout COMPLETO de una vez (Node lo parsea como JSON).
  //   c) No hay streaming de datos a Python desde Node.
  const pythonCmd = process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python' : 'python3');
  const command = `${pythonCmd} "${SCRIPT_PATH}" "${LIVE_IMAGE_PATH}" "${MODEL_PATH}"`;

  exec(command, { timeout: 60_000 }, async (execError, stdout, stderr) => {

    // 3. Manejar error de ejecución ───────────────────────────────────────────────
    if (execError) {
      const isTimeout = execError.killed === true;

      console.error(
        isTimeout
          ? '[upload] ⏱ predict.py superó el timeout de 60s'
          : '[upload] ❌ Error al ejecutar predict.py:',
        execError.message
      );
      if (stdout) console.error('[upload] Python STDOUT:', stdout.trim());
      if (stderr) console.error('[upload] Python STDERR:', stderr.trim());

      return res.status(500).json({
        error:   isTimeout
          ? 'El análisis de IA excedió el tiempo límite de 60 segundos.'
          : 'No se pudo ejecutar el script de análisis.',
        detalle: stderr.trim() || execError.message,
      });
    }

    // 4. Parsear JSON retornado por Python ────────────────────────────────────────
    // ⚠️ CRÍTICO: predict.py debe imprimir SÓLO JSON válido en stdout.
    //             Cualquier print() extra rompería el parseo.
    let pythonOutput: PythonOutput;
    try {
      pythonOutput = JSON.parse(stdout.trim()) as PythonOutput;
    } catch {
      console.error('[upload] Stdout de Python no es JSON válido:\n', stdout);
      return res.status(500).json({
        error:   'La respuesta del modelo de IA no es JSON válido.',
        detalle: stdout.slice(0, 300),   // primeros 300 chars para debug
      });
    }

    // Propagar errores que Python reportó en su propio JSON {"error": "..."}
    if (pythonOutput.error) {
      console.error('[upload] Error reportado por predict.py:', pythonOutput.error);
      return res.status(500).json({ error: pythonOutput.error });
    }

    if (!Array.isArray(pythonOutput.espacios) || pythonOutput.espacios.length === 0) {
      return res.status(500).json({ error: 'El modelo no retornó datos de espacios.' });
    }

    // 5. Persistir en Firestore (no-bloqueante para el ESP32) ─────────────────────
    try {
      await persistToFirestore(pythonOutput.espacios);
      console.log('[upload] 🔥 Firestore actualizado correctamente.');
    } catch (firestoreError: any) {
      // Error de Firestore: registramos pero NO cortocircuitamos la respuesta.
      // El ESP32 no debe reenviar por un fallo de BD; la imagen ya fue analizada.
      console.error('[upload] ⚠️ Error al escribir en Firestore:', firestoreError?.message);
    }

    // 6. Responder al ESP32 con el JSON completo ──────────────────────────────────
    const ocupados    = pythonOutput.espacios.filter(s => s.estado === 'ocupado').length;
    const disponibles = pythonOutput.espacios.filter(s => s.estado === 'disponible').length;

    console.log(`[upload] 📊 Resultado: ${disponibles} libre(s), ${ocupados} ocupado(s).`);

    return res.status(200).json({
      success:    true,
      mensaje:    `Análisis completo. ${disponibles} libre(s), ${ocupados} ocupado(s).`,
      total:      pythonOutput.espacios.length,
      disponibles,
      ocupados,
      espacios:   pythonOutput.espacios,
    });
  });
};
