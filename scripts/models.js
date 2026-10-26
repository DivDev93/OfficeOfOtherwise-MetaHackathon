// List the model ids your key can use: `npm run models`
// Use this to fill in META_*_MODEL in .env (e.g. the exact Muse Wonder / Image / SAM ids).
import { createMetaClient } from '../src/lib/metaClient.js';

const client = createMetaClient();
const { data = [] } = await client.listModels();
for (const m of data) console.log(m.id);
