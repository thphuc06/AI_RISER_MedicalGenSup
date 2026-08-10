import { applicationDefault, getApps, initializeApp as initAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp as initClientApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  collection, 
  getDoc, 
  getDocs,
  setDoc, 
  updateDoc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

export const FIREBASE_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'project-c55c421d-248e-4800-bfb';
export const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-vietmedcareaipha-de4deeac-0189-48f6-8f0e-4affb477dc90';

// Initialize Admin App (needed for Admin Auth)
const adminApp = getApps()[0] || initAdminApp({ credential: applicationDefault(), projectId: FIREBASE_PROJECT_ID });
export const adminAuth = getAdminAuth(adminApp);

// Initialize Client App for Firestore Database operations (with custom DB ID)
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8')
);

const clientApp = initClientApp(firebaseConfig, 'server_client_app');
const dbInstance = getFirestore(clientApp, FIRESTORE_DATABASE_ID);

export const SERVER_SECRET = 'SECURE_SERVER_SECRET_180406_PHUC';

export const FieldValue = {
  serverTimestamp: () => serverTimestamp()
};

class CustomDocSnap {
  public exists: boolean;
  public id: string;
  constructor(private _realSnap: DocumentSnapshot) {
    this.exists = _realSnap.exists();
    this.id = _realSnap.id;
  }
  data(): any {
    return this._realSnap.data();
  }
}

class CustomDocRef {
  public id: string;
  public _realRef: DocumentReference;

  constructor(colName: string, docId?: string) {
    const colRef = collection(dbInstance, colName);
    this._realRef = docId ? doc(dbInstance, colName, docId) : doc(colRef);
    this.id = this._realRef.id;
  }

  async get(): Promise<CustomDocSnap> {
    const snap = await getDoc(this._realRef);
    return new CustomDocSnap(snap);
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    await setDoc(this._realRef, data, options);
  }

  async update(data: any): Promise<void> {
    await updateDoc(this._realRef, data);
  }
}

class CustomCollectionSnap {
  public docs: CustomDocSnap[];
  constructor(realSnap: any) {
    this.docs = realSnap.docs.map((d: any) => new CustomDocSnap(d));
  }
}

class CustomCollectionRef {
  constructor(private colName: string) {}

  doc(docId?: string) {
    return new CustomDocRef(this.colName, docId);
  }

  async get(): Promise<CustomCollectionSnap> {
    const colRef = collection(dbInstance, this.colName);
    const snap = await getDocs(colRef);
    return new CustomCollectionSnap(snap);
  }
}

class CustomTransaction {
  constructor(private _realTx: Transaction) {}

  async get(docRef: CustomDocRef): Promise<CustomDocSnap> {
    const snap = await this._realTx.get(docRef._realRef);
    return new CustomDocSnap(snap);
  }

  set(docRef: CustomDocRef, data: any, options?: { merge?: boolean }): CustomTransaction {
    this._realTx.set(docRef._realRef, data, options);
    return this;
  }
}

class CustomDb {
  collection(colName: string) {
    return new CustomCollectionRef(colName);
  }

  async runTransaction<T>(updateFunction: (transaction: CustomTransaction) => Promise<T>): Promise<T> {
    return await runTransaction(dbInstance, async (realTx) => {
      const customTx = new CustomTransaction(realTx);
      return await updateFunction(customTx);
    });
  }
}

export const adminDb = new CustomDb();
