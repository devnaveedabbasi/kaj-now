import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const rawKey = process.env.FIREBASE_PRIVATE_KEY;

const privateKey = rawKey
  ?.replace(/^"+|"+$/g, "") // remove starting/ending quotes
  .replace(/\\n/g, "\n");   // convert \n into real new lines

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey,
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("Firebase Admin SDK initialized successfully.");
} else {
  console.log("Firebase Admin SDK already initialized.");
}

export default admin;