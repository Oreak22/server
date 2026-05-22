const admin = require("firebase-admin");

function getFirebaseApp() {
  if (admin.apps.length) return admin.app();

  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString(
        "utf8",
      ),
    );
    credential = admin.credential.cert(serviceAccount);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    credential = admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    );
  } else {
    credential = admin.credential.applicationDefault();
  }

  return admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

async function verifyGoogleIdToken(idToken) {
  if (!idToken) {
    throw new Error("Firebase ID token is required");
  }

  const decodedToken = await getFirebaseApp().auth().verifyIdToken(idToken);

  if (!decodedToken.email) {
    throw new Error("Google account email is required");
  }

  return decodedToken;
}

module.exports = {
  verifyGoogleIdToken,
};
