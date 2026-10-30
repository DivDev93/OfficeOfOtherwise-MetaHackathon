import { createDemoServer } from './index.js';

// This entry point intentionally never loads .env or enables a provider.
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
createDemoServer({ env: { DEMO_REPLAY_ONLY: 'true', DEMO_3D_ENABLED: 'false' } })
  .listen(port, '127.0.0.1', () => console.log(`Saved-story demo: http://127.0.0.1:${port}`));
