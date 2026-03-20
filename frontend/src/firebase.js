import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

// Values are injected at build time from frontend/.env
// All keys must be prefixed with VITE_ for Vite to expose them to the browser
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

// Firestore instance shared across the whole frontend
export const db = getFirestore(app)
