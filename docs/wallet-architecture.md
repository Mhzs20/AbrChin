# Wallet architecture

## Storage
- Balances and ledger amounts are stored as integer **rial** (`BigInt`).
- UI displays **toman** (`rial / 10`).
- Float amounts are forbidden.

## Models
- `Wallet`: one per user, `availableBalance`, status ACTIVE/FROZEN
- `WalletLedgerEntry`: append-only completed financial events
- `WalletTopUp`: payment intents for gateway top-ups
- `ServiceOrder`: purchasable plans paid from wallet

## Invariants
- No direct balance mutation outside ledger services
- Credit/Debit run in Prisma transactions
- Debit uses atomic conditional update (`balance >= amount`)
- Corrections use reverse ledger entries
- Completed ledger rows are not edited/deleted by app services

## First-version limits
- No cash withdrawal
- No peer-to-peer transfer
- No negative balance
- No split tender
- No automatic server provisioning
