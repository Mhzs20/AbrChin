# AbrChin encrypted backup and isolated restore

Create a file-backed key. Never commit it.

```bash
install -d -m 0700 /srv/abrchin/secrets/backup
umask 077
dd if=/dev/urandom bs=32 count=1 of=/srv/abrchin/secrets/backup/backup.key
chmod 0600 /srv/abrchin/secrets/backup/backup.key
```

```bash
export APP_DIR=/opt/abrchin
export BACKUP_KEY_FILE=/srv/abrchin/secrets/backup/backup.key
export DATA_ROOT=/var/lib/docker/volumes/abrchin_pg_data/_data
export BACKUP_DIR=/var/backups/abrchin-postgres
./ops/backup-postgres.sh
./ops/restore-verify.sh /var/backups/abrchin-postgres/abrchin-<stamp>-<sha>.tar.enc
```

systemd units live in `ops/systemd/`. Do not add GitHub Actions.

App secrets in production are files under `/run/secrets/abrchin-service`
owned by uid `1001`. `ABRCHIN_REQUIRE_FILE_SECRETS=true` rejects those
values in the container environment.
