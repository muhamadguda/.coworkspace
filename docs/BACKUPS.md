# Nightly backups

`.github/workflows/backup.yml` runs every night at 03:23 Cairo time. It runs `pg_dump` on the **dot** and **HorusRepair** databases, encrypts each dump, and keeps it for 30 days as a GitHub Actions artifact.

## One-time setup: add 3 secrets in GitHub

Go to the repo → **Settings → Secrets and variables → Actions → New repository secret**, then add:

| Secret | Value |
|---|---|
| `DOT_DB_URL` | dot's connection string (see below) |
| `HORUS_DB_URL` | HorusRepair's connection string |
| `BACKUP_PASSPHRASE` | A long random password. Keep a copy somewhere safe: without it, the backups can't be opened. |

**To get a connection string:**
1. Open the Supabase project.
2. Click **Connect** (top bar) → **Session pooler** and copy the URI. It looks like `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
3. Replace `[YOUR-PASSWORD]` with the database password. If you don't know it, reset it in **Project Settings → Database**.

Use the session pooler, not the direct connection, because GitHub's machines can't reach the direct address.

To test it: open the **Actions** tab → **Nightly database backup** → **Run workflow**.

## What's included

- `public`: all app data (bills, sessions, orders, customers, menu, settings, and so on).
- `auth`: staff logins.
- `storage`: file metadata only. Uploaded files themselves (menu photos) are not in the dump.

## Restore

1. Download the artifact from the run, then unzip it to get `dot-<date>.dump.enc`.
2. Decrypt it:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:'<BACKUP_PASSPHRASE>' \
     -in dot-<date>.dump.enc -out dot.dump
   ```
3. Restore it. Restore into a new or empty project first and check it there:
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists -d "<target connection string>" dot.dump
   ```
