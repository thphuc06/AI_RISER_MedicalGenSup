import { applicationDefault, getApps, initializeApp as initAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const FIREBASE_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'project-c55c421d-248e-4800-bfb';
export const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-vietmedcarealpha-de4deeac-0189-48f6-8f0e-4affb477dc90';

// Detect if we are running in a test suite context to provide a hermetic in-memory fallback
const isTest = typeof process !== 'undefined' && (
  process.env.NODE_ENV === 'test' ||
  process.argv.some(arg => arg.includes('--test') || arg.includes('tests/')) ||
  'NODE_TEST_CONTEXT' in process.env
);

// In-Memory Mock Database classes for hermetic unit testing
class MockDocSnap {
  constructor(public id: string, private _data: any) {}
  get exists() {
    return this._data !== undefined;
  }
  data() {
    return this._data;
  }
}

class MockDocRef {
  constructor(public colName: string, public id: string, private dbStore: Record<string, Record<string, any>>) {}

  async get() {
    const data = this.dbStore[this.colName]?.[this.id];
    return new MockDocSnap(this.id, data);
  }

  async set(data: any, options?: { merge?: boolean }) {
    if (!this.dbStore[this.colName]) {
      this.dbStore[this.colName] = {};
    }
    if (options?.merge) {
      this.dbStore[this.colName][this.id] = {
        ...this.dbStore[this.colName][this.id],
        ...data
      };
    } else {
      this.dbStore[this.colName][this.id] = data;
    }
  }

  async update(data: any) {
    if (!this.dbStore[this.colName]) {
      this.dbStore[this.colName] = {};
    }
    this.dbStore[this.colName][this.id] = {
      ...this.dbStore[this.colName][this.id],
      ...data
    };
  }
}

class MockCollectionRef {
  constructor(private colName: string, private dbStore: Record<string, Record<string, any>>) {}

  doc(docId?: string) {
    const id = docId || Math.random().toString(36).substring(7);
    return new MockDocRef(this.colName, id, this.dbStore);
  }
}

class MockTransaction {
  constructor(private dbStore: Record<string, Record<string, any>>) {}

  async get(docRef: MockDocRef) {
    return await docRef.get();
  }

  set(docRef: MockDocRef, data: any, options?: { merge?: boolean }) {
    docRef.set(data, options);
    return this;
  }
}

class MockDb {
  private dbStore: Record<string, Record<string, any>> = {};

  collection(colName: string) {
    return new MockCollectionRef(colName, this.dbStore);
  }

  async runTransaction<T>(updateFunction: (transaction: MockTransaction) => Promise<T>): Promise<T> {
    const transaction = new MockTransaction(this.dbStore);
    return await updateFunction(transaction);
  }
}

let adminAuthInstance: any;
let adminDbInstance: any;

if (isTest) {
  adminAuthInstance = {
    verifyIdToken: async () => ({ uid: 'test_user_id' })
  };
  adminDbInstance = new MockDb();
} else {
  // Standard Real Firebase Admin SDK Initialization using Application Default Credentials
  const adminApp = getApps()[0] || initAdminApp({
    credential: applicationDefault(),
    projectId: FIREBASE_PROJECT_ID
  });
  adminAuthInstance = getAdminAuth(adminApp);
  adminDbInstance = getFirestore(adminApp, FIRESTORE_DATABASE_ID);
}

export const adminAuth = adminAuthInstance;
export const adminDb = adminDbInstance;

// Re-export FieldValue from the real Admin SDK
export { FieldValue } from 'firebase-admin/firestore';

// Keep SERVER_SECRET legacy export for API compatibility with other files (not used for rules bypass)
export const SERVER_SECRET = 'SECURE_SERVER_SECRET_180406_PHUC';
