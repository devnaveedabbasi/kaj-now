import fs from "fs";
import path from "path";
import admin from "firebase-admin";

const serviceAccount = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "src/config/firebase/firebase-service-account.json"),
    "utf8"
  )
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;