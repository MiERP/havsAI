#!/usr/bin/env bash
# havsAI VPS deploy script (Ubuntu, systemd/pm2).
#
# One command on the VPS:
#   sudo bash /opt/havs-ai/deploy/deploy.sh
#
# First run (private repo): upload this file once, then run it:
#   scp deploy/deploy.sh root@103.20.102.229:/tmp/havs-deploy.sh
#   ssh root@103.20.102.229 'APP_DIR=/opt/havs-ai SERVICE=havs-ai bash /tmp/havs-deploy.sh'
#
# One command from your machine after the first run:
#   ssh root@103.20.102.229 'bash /opt/havs-ai/deploy/deploy.sh'
#
# If APP_DIR has no .git, the script backs up fullstack/.env + fullstack/data,
# clones REPO_URL to a temp directory, swaps it into APP_DIR, restores the two
# paths and fixes ownership. The old directory is kept as APP_DIR.old-*.
#
# Env overrides:
#   APP_DIR=/opt/havs-ai
#   REPO_URL=git@github.com:MiERP/havsAI.git  (uses the VPS GitHub SSH key)
#   BRANCH=main
#   RUN_USER=<systemd User= or owner of APP_DIR>
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
REPO_URL="${REPO_URL:-git@github.com:MiERP/havsAI.git}"
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

# Git runs as root so it can use the VPS's GitHub SSH key. The worktree is
# chowned to RUN_USER before npm/test so the service user can write node_modules.
run_git() {
  git -c safe.directory="$APP_DIR" "$@"
}

OLD_ENV=""
if [ -f "$APP_DIR/.env" ]; then
  OLD_ENV="$APP_DIR/.env"
elif [ -f "$APP_DIR/fullstack/.env" ]; then
  OLD_ENV="$APP_DIR/fullstack/.env"
fi

OLD_DATA=""
if [ -d "$APP_DIR/data" ]; then
  OLD_DATA="$APP_DIR/data"
elif [ -d "$APP_DIR/fullstack/data" ]; then
  OLD_DATA="$APP_DIR/fullstack/data"
fi

DB_PATH="${OLD_DATA:-$APP_DIR/fullstack/data}/havs.db"
KEY_PATH="${OLD_DATA:-$APP_DIR/fullstack/data}/settings.key"
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

if [ -f "$KEY_PATH" ]; then
  mkdir -p "$BACKUP_DIR"
  KEY_BACKUP="$BACKUP_DIR/havs-settings-$(date +%F-%H%M%S).key"
  cp "$KEY_PATH" "$KEY_BACKUP"
  chmod 600 "$KEY_BACKUP" 2>/dev/null || true
  ls -1t "$BACKUP_DIR"/havs-settings-*.key 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f || true
  log "    -> encryption key: $KEY_BACKUP"
fi

if [ ! -d "$APP_DIR/.git" ]; then
  log "[2/6] Bootstrapping git repository (existing app has no .git)"
  TMP_DIR="${APP_DIR}.new-$$"
  rm -rf "$TMP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$TMP_DIR" || fail "git clone failed; check REPO_URL and GitHub access."
  SAVED_ENV=""
  SAVED_DATA=""
  if [ -d "$APP_DIR" ]; then
    if [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
      SAVE_DIR="$BACKUP_DIR/pre-git-$(date +%Y%m%d-%H%M%S)"
      mkdir -p "$SAVE_DIR"
      if [ -n "$OLD_ENV" ]; then
        cp -a "$OLD_ENV" "$SAVE_DIR/env"
        SAVED_ENV="$SAVE_DIR/env"
      fi
      if [ -n "$OLD_DATA" ]; then
        cp -a "$OLD_DATA" "$SAVE_DIR/data"
        SAVED_DATA="$SAVE_DIR/data"
      fi
    fi
    OLD_DIR="${APP_DIR}.old-$(date +%Y%m%d-%H%M%S)"
    mv "$APP_DIR" "$OLD_DIR"
    log "    -> old app moved to $OLD_DIR"
  fi
  mv "$TMP_DIR" "$APP_DIR"
  if [ -n "$SAVED_ENV" ]; then
    mkdir -p "$APP_DIR/fullstack"
    cp -a "$SAVED_ENV" "$APP_DIR/fullstack/.env"
  fi
  if [ -n "$SAVED_DATA" ]; then
    mkdir -p "$APP_DIR/fullstack"
    cp -a "$SAVED_DATA" "$APP_DIR/fullstack/data"
  fi
  chown -R "$RUN_USER" "$APP_DIR"
  log "    -> cloned $REPO_URL ($BRANCH)"
fi

UNIT_PATH="$(systemctl show -p FragmentPath --value "$SERVICE" 2>/dev/null || true)"
CURRENT_WD="$(systemctl show -p WorkingDirectory --value "$SERVICE" 2>/dev/null || true)"
if [ -f "$APP_DIR/fullstack/server.js" ]; then
  if [ -n "$UNIT_PATH" ] && [ -f "$UNIT_PATH" ] && [ "$CURRENT_WD" = "$APP_DIR" ]; then
    sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$APP_DIR/fullstack|" "$UNIT_PATH"
    systemctl daemon-reload
    log "    -> service WorkingDirectory updated to $APP_DIR/fullstack"
  elif [ -n "$CURRENT_WD" ] && [ "$CURRENT_WD" != "$APP_DIR/fullstack" ]; then
    log "    WARNING: $SERVICE WorkingDirectory is '$CURRENT_WD' (expected '$APP_DIR/fullstack')"
  fi
fi

log "[2/6] Pulling origin/$BRANCH"
cd "$APP_DIR"
if [ -n "$(run_git status --porcelain --untracked-files=no)" ]; then
  log "    tracked files have local changes on the server:"
  run_git status --short
  [ "$FORCE_RESET" = "1" ] || fail "Refusing to overwrite local changes; set FORCE_RESET=1 to discard them."
fi

run_git fetch --prune origin "$BRANCH"
if [ "$FORCE_RESET" = "1" ]; then
  run_git reset --hard "origin/$BRANCH"
elif run_git symbolic-ref -q HEAD >/dev/null; then
  run_git merge --ff-only "origin/$BRANCH" || fail "Fast-forward failed; set FORCE_RESET=1 to discard server changes."
else
  run_git reset --hard "origin/$BRANCH"
fi
log "    -> $(run_git rev-parse --short HEAD) $(run_git log -1 --pretty=%s)"

chown -R "$RUN_USER" "$APP_DIR"

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
theme_ok=0
for _ in 1 2 3 4 5; do
  if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/styles.css" | grep '#ea580c' >/dev/null; then
    theme_ok=1
    break
  fi
  sleep 1
done
if [ "$theme_ok" = "1" ]; then
  log "    theme: #ea580c is live"
else
  log "    WARNING: #ea580c not found in styles.css (check static root/cache)"
fi

log "DONE. Commit $(run_git -C "$APP_DIR" rev-parse --short HEAD) is live."
