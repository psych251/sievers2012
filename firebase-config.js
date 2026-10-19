// Firebase configuration for THIS experiment's project.
//
// Replace the placeholder object below with the one from your Firebase project:
//   Firebase console -> Project settings (gear icon) -> General -> Your apps -> Web app -> "Config"
// It looks exactly like this object. Paste it over the placeholder and commit the file.
//
// Yes, this file is meant to be public. The apiKey is an identifier for your project,
// not a password: anyone loading your experiment page downloads it anyway. What keeps your
// data safe is firebase/firestore.rules, which only lets participants append their own data.
//
// While the values still say PASTE_ME, the experiment runs in "offline" mode: it works, shows
// a banner, and offers a JSON download at the end instead of saving to Firestore. That is
// fine for building and piloting on your own machine.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyB-3vWcq8tavg34hL41guTnyr4WFf6-jhU",
  authDomain: "replication-5c9a0.firebaseapp.com",
  projectId: "replication-5c9a0",
  storageBucket: "replication-5c9a0.firebasestorage.app",
  messagingSenderId: "268292165905",
  appId: "1:268292165905:web:634d4da2f1a7aa4cc7bcb0"
};