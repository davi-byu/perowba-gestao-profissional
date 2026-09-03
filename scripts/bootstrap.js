import { firebaseSettings } from "./firebase-config.js";

if (firebaseSettings.enabled) {
  const { FirebaseService } = await import("./firebase-service.js");
  window.firebaseService = new FirebaseService(firebaseSettings);
} else {
  window.firebaseService = { enabled: false };
}

await import("./app.js");
