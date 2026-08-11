import './env.js';
import { loadAllSheets } from './sheetsService.js';

async function run() {
  console.log('Forcing full sheets load and sync to Cloud SQL...');
  try {
    await loadAllSheets();
    console.log('Force sync successfully triggered.');
  } catch (err) {
    console.error('Failed to force sync:', err);
  }
}

run();
