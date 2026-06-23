import * as admin from 'firebase-admin';
import * as path   from 'path';
import * as fs     from 'fs';

// ─── Singleton: evita "app/no-app" y doble inicialización ────────────────────
//
// Node.js cachea los módulos: este archivo se ejecuta UNA sola vez aunque
// sea importado desde múltiples controladores. Aun así, el guard con
// getApps().length protege contra reinicios en caliente (ts-node-dev, jest).
//
// Diagrama de flujo:
//
//   ┌─────────────────────┐
//   │  ¿App ya existe?    │──YES──► usar admin.app() existente
//   └──────────┬──────────┘
//              │ NO
//              ▼
//   ┌─────────────────────────────────────┐
//   │  ¿FIREBASE_SERVICE_ACCOUNT en env?  │──YES──► parsear JSON del env
//   └──────────────┬──────────────────────┘
//                  │ NO
//                  ▼
//   Leer serviceAccountKey.json desde raíz del proyecto
//   (ruta anclada a __dirname → independiente del cwd de PM2)

let _app: admin.app.App;

if (admin.apps.length === 0) {
  // ── Resolver credenciales ──────────────────────────────────────────────────
  let credential: admin.credential.Credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // ── Opción A: variable de entorno (recomendada para producción segura) ──
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = admin.credential.cert(serviceAccount);
    } catch {
      throw new Error(
        '[Firebase] La variable FIREBASE_SERVICE_ACCOUNT no es un JSON válido. ' +
        'Asegúrate de que no tenga saltos de línea ni comillas escapadas incorrectamente.'
      );
    }
  } else {
    // ── Opción B: archivo .json en la raíz del proyecto (desarrollo / VPS) ──
    //
    // Árbol de directorios en producción (dist/):
    //   /var/www/html/smartparkingespoch/
    //   ├── dist/
    //   │   └── config/
    //   │       └── firebase.js   ← __dirname apunta aquí
    //   └── serviceAccountKey.json
    //
    // Por eso subimos 3 niveles: config → dist → raíz del proyecto.
    // En desarrollo (src/), __dirname = src/config/ → también 2 niveles arriba.
    //
    // La función resolveServiceAccountPath() elige la ruta correcta
    // según si estamos ejecutando el .ts compilado o el .ts original.
    const resolveServiceAccountPath = (): string => {
      // __dirname en producción:  …/dist/config
      // __dirname en desarrollo:  …/src/config
      // En ambos casos, dos niveles arriba llega a la raíz del proyecto.
      const candidate = path.resolve(__dirname, '..', '..', 'serviceAccountKey.json');

      if (!fs.existsSync(candidate)) {
        throw new Error(
          `[Firebase] No se encontró serviceAccountKey.json en: ${candidate}\n` +
          'Opciones:\n' +
          '  1. Copia el archivo a la raíz del proyecto.\n' +
          '  2. Define la variable de entorno FIREBASE_SERVICE_ACCOUNT con el JSON.\n'
        );
      }

      return candidate;
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    credential = admin.credential.cert(require(resolveServiceAccountPath()));
  }

  // ── Inicializar la app de Firebase Admin ──────────────────────────────────
  _app = admin.initializeApp({ credential });
  console.log('✅ Firebase Admin inicializado correctamente.');

} else {
  // La app ya existe (hot-reload en desarrollo o módulo cacheado)
  _app = admin.app();
  console.log('♻️  Firebase Admin: usando instancia existente.');
}

// ─── Exportar instancias listas para usar ─────────────────────────────────────
// Se instancian DESPUÉS de initializeApp() para garantizar que la app existe.
// Si initializeApp() lanzó una excepción, este código nunca se alcanza
// y el error se propaga naturalmente → sin "app/no-app" silencioso.
const db   = admin.firestore();
const auth = admin.auth();

export { admin, db, auth };

