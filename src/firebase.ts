import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, linkWithPopup, signInAnonymously, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const signInWithGoogle = async () => {
  try {
    if (auth.currentUser?.isAnonymous) {
      try {
        const result = await linkWithPopup(auth.currentUser, googleProvider);
        return result.user;
      } catch (linkError: any) {
        console.warn('Linking failed, falling back to direct sign-in:', linkError);
        if (
          linkError.code === 'auth/credential-already-in-use' ||
          linkError.code === 'auth/email-already-in-use' ||
          linkError.code === 'auth/provider-already-linked'
        ) {
          const result = await signInWithPopup(auth, googleProvider);
          return result.user;
        }
        throw linkError;
      }
    } else {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    }
  } catch (error) {
    console.error('Google Auth Error:', error);
    throw error;
  }
};

export const logoutUser = () => signOut(auth);

const makeMockIdToken = (uid: string) => {
  try {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const payload = btoa(JSON.stringify({ sub: uid, email: 'demo@example.com', name: 'Khách hàng Demo' }))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${header}.${payload}.signature`;
  } catch (err) {
    return 'mock.token.sig';
  }
};

export const ensureAuthenticatedUser = async (): Promise<any> => {
  if (auth.currentUser) return auth.currentUser;
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (err) {
    console.warn('Anonymous Auth is disabled/restricted. Falling back to Mock Demo Session:', err);
    return {
      uid: 'demo_local_user',
      isAnonymous: true,
      displayName: 'Khách hàng Demo',
      email: null,
      getIdToken: async () => makeMockIdToken('demo_local_user'),
    };
  }
};

export default app;
