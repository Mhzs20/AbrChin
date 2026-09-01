# ParsPack history — audit, archive, drop gate

## Repository evidence (not production DB evidence)

Migration `prisma/migrations/20260822090000_drop_parspack_provider` is on
`origin/main` since commit `99200286d53196a35940158d2cc98b91a450e221`
(PR #17, 2026-08-23). Later migrations exist after it. Current Prisma schema
has `InfrastructureProvider = ARVAN` only.

Launch documents still record **PRODUCTION = DENIED** and no Founder-authorized
production migrate. PR #17 *claims* `prisma migrate deploy` against a real
database that already had ParsPack rows. That is **not** sufficient to know
whether the Founder's production database applied the drop.

This work package **does not rewrite** `20260822090000_drop_parspack_provider`.
Rewriting it would change the checksum for any database that already recorded
the migration.

## Safe path (works for both apply-states)

1. `scripts/parspack-history-audit.mts` counts every affected table.
2. If the drop is **pending** and commercial/financial ParsPack rows exist,
   `scripts/migrate-deploy.sh` **fails** until `scripts/parspack-archive.mts`
   writes a PASS receipt whose checksum matches live counts.
3. Archive copies original identifiers, relationships, timestamps, and monetary
   fields into `ParsPackArchivedRow` / `ParsPackArchiveReceipt`.
4. Only then may `prisma migrate deploy` apply the existing destructive drop.
5. If the drop is **already applied**, the gate passes and cannot reconstruct
   deleted infra rows. Restore from a backup taken before the drop if needed.
   Never restore into production automatically.

## Owner read-only commands (do not guess)

Run against the production database with a read-only role:

```sql
SELECT migration_name, finished_at, rolled_back_at, checksum
FROM "_prisma_migrations"
WHERE migration_name = '20260822090000_drop_parspack_provider';

SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'InfrastructureProvider'
ORDER BY enumsortorder;
```

If `PARSPACK` is still in the enum, also count live rows before any deploy:

```bash
DATABASE_URL='…' node --experimental-strip-types scripts/parspack-history-audit.mts
```

## Commands

```bash
DATABASE_URL='…' node --experimental-strip-types scripts/parspack-history-audit.mts
DATABASE_URL='…' node --experimental-strip-types scripts/parspack-archive.mts
./scripts/migrate-deploy.sh
```
