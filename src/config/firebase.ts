import * as admin from 'firebase-admin';
import * as path from 'path';

try {
  let credential;

  // En producción, usamos una variable de entorno con el JSON stringificado
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = admin.credential.cert(serviceAccount);
  } else {
    // Fallback local para desarrollo (asegúrate de que esté en .gitignore)
    const serviceAccountPath = path.resolve(__dirname, '../../serviceAccountKey.json');
    credential = admin.credential.cert(require(serviceAccountPath));
  }

  admin.initializeApp({ credential });
  console.log('Firebase Admin inicializado correctamente.');
} catch (error) {
  console.error('\n⚠️ ATENCIÓN: Error al inicializar Firebase Admin.');
  console.error('Verifica la variable de entorno FIREBASE_SERVICE_ACCOUNT o el archivo "serviceAccountKey.json".\n');
}

const db = admin.firestore();
const auth = admin.auth();

export { admin, db, auth };
