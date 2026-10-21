#!/usr/bin/env bash
# havsAI VPS deploy script (Ubuntu, systemd/pm2).
#
# One command on the VPS:
#   sudo bash /opt/havs-ai/deploy/deploy.sh
#
# One command from your machine:
#   ssh root@103.20.102.229 'bash /opt/havs-ai/deploy/deploy.sh'
#
# Env overrides:
#   APP_DIR=/opt/havs-ai
#   RUN_USER=<owner of APP_DIR>
#   SERVICE=<auto-detected havs* systemd unit>
#   PM2_APP=havsai            fallback when there is no systemd unit
#   PORT=3000                 Node port for the local health/theme checks
#   BACKUP_DIR=/var/backups/havs-ai
#   KEEP_BACKUPS=15
#   RUN_TESTS=0               skip `npm test`
#   FORCE_RESET=1             discard server-side commits/changes
#
# The script never touches fullstack/.env or fullstack/data (both gitignored).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/havs-ai}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
PM2_APP="${PM2_APP:-havsai}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/havs-ai}"
KEEP_BACKUPS="${KEEP_BACKUPS:-15}"
RUN_TESTS="${RUN_TESTS:-1}"
FORCE_RESET="${FORCE_RESET:-0}"

log() { printf '>> [%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '!! %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run as root: sudo bash $0"
command -v git >/dev/null 2>&1 || fail "git is not installed"
command -v npm >/dev/null 2>&1 || fail "npm is not installed"
command -v curl >/dev/null 2>&1 || fail "curl is not installed"
[ -d "$APP_DIR/.git" ] || fail "$APP_DIR is not a git repository (set APP_DIR=/path/to/havs-ai)"

if [ -z "${SERVICE:-}" ]; then
  SERVICE="$(systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -Ei 'havs' | head -n1 || true)"
  SERVICE="${SERVICE%.service}"
  SERVICE="${SERVICE:-havsai}"
fi

if [ -z "${RUN_USER:-}" ]; then
  RUN_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
fi
RUN_USER="${RUN_USER:-$(stat -c '%U' "$APP_DIR" 2>/dev/null || echo root)}"
id "$RUN_USER" >/dev/null 2>&1 || fail "Linux user '$RUN_USER' does not exist"

run_app() {
  if [ "$RUN_USER" = "root" ]; then "$@"; else sudo -u "$RUN_USER" "$@"; fi
}

DB_PATH="$APP_DIR/fullstack/data/havs.db"
BACKUP_FILE=""

log "[1/6] Backing up SQLite database"
if [ -f "$DB_PATH" ]; then
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/havs-$(date +%F-%H%M%S).db"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
  else
    cp "$DB_PATH" "$BACKUP_FILE"
    if [ -f "$DB_PATH-wal" ]; then cp "$DB_PATH-wal" "$BACKUP_FILE-wal"; fi
    if [ -f "$DB_PATH-shm" ]; then cp "$DB_PATH-shm" "$BACKUP_FILE-shm"; fi
  fi
  chmod 600 "$BACKUP_FILE" 2>/dev/null || true
  ls -1t "$BACKUP_DIR"/havs-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f || true
  log "    -> $BACKUP_FILE"
else
  log "    -> no database yet, skipping"
fi

log "[2/6] Pulling origin/$BRANCH"
cd "$APP_DIR"
if [ -n "$(run_app git status --porcelain --untracked-files=no)" ]; then
  log "    tracked files have local changes on the server:"
  run_app git status --short
  [ "$FORCE_RESET" = "1" ] || fail "Refusing to overwrite local changes; set FORCE_RESET=1 to discard them."
fi

run_app git fetch --prune origin "$BRANCH"
if [ "$FORCE_RESET" = "1" ]; then
  run_app git reset --hard "origin/$BRANCH"
elif run_app git symbolic-ref -q HEAD >/dev/null; then
  run_app git merge --ff-only "origin/$BRANCH" || fail "Fast-forward failed; set FORCE_RESET=1 to discard server changes."
else
  run_app git reset --hard "origin/$BRANCH"
fi
log "    -> $(run_app git rev-parse --short HEAD) $(run_app git log -1 --pretty=%s)"

log "[3/6] Installing production dependencies"
run_app bash -c "cd '$APP_DIR/fullstack' && npm ci --omit=dev"

log "[4/6] Running tests"
if [ "$RUN_TESTS" = "1" ]; then
  run_app bash -c "cd '$APP_DIR/fullstack' && npm test"
else
  log "    -> skipped (RUN_TESTS=0)"
fi

log "[5/6] Restarting service"
if systemctl cat "$SERVICE" >/dev/null 2>&1; then
  systemctl restart "$SERVICE"
  log "    -> systemd: $SERVICE"
elif command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
  pm2 save
  log "    -> pm2: $PM2_APP"
else
  fail "No systemd unit '$SERVICE' and no pm2 app '$PM2_APP'. Set SERVICE or PM2_APP."
fi

log "[6/6] Health and theme checks"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:$PORT/api/health}"
ready=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" != "1" ]; then
  printf '!! Health check failed: %s\n' "$HEALTH_URL" >&2
  if systemctl cat "$SERVICE" >/dev/null 2>&1; then
    journalctl -u "$SERVICE" -n 80 --no-pager || true
  elif command -v pm2 >/dev/null 2>&1; then
    pm2 logs "$PM2_APP" --lines 80 --nostream || true
  fi
  if [ -n "$BACKUP_FILE" ]; then
    printf '!! Database backup: %s\n' "$BACKUP_FILE" >&2
  fi
  exit 1
fi

log "    health: $(curl -fsS --max-time 3 "$HEALTH_URL")"
if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/styles.css" | grep -q '#ea580c'; then
  log "    theme: #ea580c is live"
else
  log "    WARNING: #ea580c not found in styles.css (check static root/cache)"
fi

log "DONE. Commit $(run_app git -C "$APP_DIR" rev-parse --short HEAD) is live."
