import { config } from 'dotenv';

// AI Studio/Cloud Run inject process.env directly. Local development follows the
// README convention and loads .env.local without overriding injected values.
config({ path: '.env.local', quiet: true });
config({ quiet: true });
