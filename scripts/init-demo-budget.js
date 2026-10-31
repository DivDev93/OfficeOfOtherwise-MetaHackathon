import { fileLedger } from '../src/lib/spendLedger.js';

const ledger = fileLedger('out/spend.json');
if (ledger.reserved() !== 0) throw new Error('Resolve outstanding Meta reservations before initializing the spend ledger');
ledger.initialize();
console.log('Spend ledger initialized.');
