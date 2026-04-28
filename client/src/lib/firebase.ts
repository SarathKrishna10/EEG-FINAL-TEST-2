import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBXyR1cehTLGWlHy8xuPDXbqGvHM54qBKU",
  authDomain: "eeg-c0f64.firebaseapp.com",
  projectId: "eeg-c0f64",
  storageBucket: "eeg-c0f64.firebasestorage.app",
  messagingSenderId: "511757032224",
  appId: "1:511757032224:web:d5602c040e8bd899ed9545",
  measurementId: "G-RL1FYJDLC9"
};

// Prevent duplicate app initialization during HMR
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);