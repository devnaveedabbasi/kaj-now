import fs from 'fs';
import admin from 'firebase-admin';

const serviceAccount = JSON.parse(
  fs.readFileSync(new URL('../firebase/firebase-service-account.json', import.meta.url))
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;