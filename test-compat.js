import { applicationDefault, initializeApp as initAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import fs from 'fs';
import path from 'path';

const FIREBASE_PROJECT_ID = 'project-c55c421d-248e-4800-bfb';

console.log('Initializing Admin SDK...');
const adminApp = initAdminApp({
  credential: applicationDefault(),
  projectId: FIREBASE_PROJECT_ID
});
const adminAuth = getAdminAuth(adminApp);

console.log('Reading firebase-applet-config.json...');
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8')
);

async function testCompat() {
  try {
    const userId = 'test_server_user';
    const appName = `user_${userId}`;
    
    console.log('Initializing Client Compat App...');
    const clientApp = firebase.initializeApp(firebaseConfig, appName);
    
    console.log('Generating custom token via Admin SDK...');
    const customToken = await adminAuth.createCustomToken(userId, { isServer: true });
    
    console.log('Signing in on Client Compat Auth...');
    await clientApp.auth().signInWithCustomToken(customToken);
    
    console.log('Getting Firestore instance via Client Compat...');
    const db = clientApp.firestore();
    
    console.log('Attempting to read test document from carts...');
    const docRef = db.collection('carts').doc('test_doc');
    const doc = await docRef.get();
    console.log('Read success! Document exists:', doc.exists);
    
    console.log('Attempting to write test document to carts...');
    await docRef.set({ testValue: 'hello_world', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    console.log('Write success!');
    
    console.log('Reading again to verify write...');
    const updatedDoc = await docRef.get();
    console.log('Updated document data:', updatedDoc.data());
    
    // Clean up
    console.log('Deleting written test document...');
    await docRef.delete();
    console.log('Delete success!');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

await testCompat();
