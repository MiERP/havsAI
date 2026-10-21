# Deploy havsAI lên VPS

Script `deploy/deploy.sh` chạy trên VPS: backup SQLite, pull `origin/main`,
`npm ci --omit=dev`, chạy test, restart systemd/pm2, health-check và kiểm tra
theme `#ea580c`. Script không đụng `fullstack/.env` và `fullstack/data`.

## Một lệnh

Trên VPS (sau lần đầu):

```bash
sudo bash /opt/havs-ai/deploy/deploy.sh
```

Từ máy local (SSH thẳng vào VPS):

```bash
ssh root@103.20.102.229 'bash /opt/havs-ai/deploy/deploy.sh'
```

## Lần đầu khi VPS chưa có `.git`

Nếu VPS chỉ có file copy (lỗi `fatal: not a git repository`), chạy một lệnh này
để tải script mới nhất từ GitHub và để script tự bootstrap repo:

```bash
ssh root@103.20.102.229 \
  'curl -fsSL https://raw.githubusercontent.com/MiERP/havsAI/main/deploy/deploy.sh -o /tmp/havs-deploy.sh && bash /tmp/havs-deploy.sh'
```

Nếu repo private, copy script từ máy local rồi chạy:

```bash
scp deploy/deploy.sh root@103.20.102.229:/tmp/havs-deploy.sh
ssh root@103.20.102.229 'bash /tmp/havs-deploy.sh'
```

Script sẽ:

1. Backup `fullstack/.env` và `fullstack/data` vào `/var/backups/havs-ai/pre-git-*`
2. Clone `REPO_URL` vào thư mục tạm
3. Đổi thư mục app cũ thành `APP_DIR.old-*`
4. Đưa bản clone vào `APP_DIR`, khôi phục `.env`/data và `chown` cho service user
5. Pull, `npm ci --omit=dev`, test, restart, health-check

> Yêu cầu: `APP_DIR` phải là thư mục app hiện tại (mặc định `/opt/havs-ai`) và
> systemd service phải có `WorkingDirectory` trỏ tới `APP_DIR/fullstack`. Nếu
> đường dẫn khác, đặt `APP_DIR=...` khi chạy.

## Đường dẫn/service khác mặc định

```bash
ssh root@103.20.102.229 \
  'APP_DIR=/opt/havs-ai RUN_USER=havsai SERVICE=havsai PORT=3000 \
   bash /opt/havs-ai/deploy/deploy.sh'
```

Biến hỗ trợ:

| Biến | Mặc định | Ý nghĩa |
| :--- | :--- | :--- |
| `APP_DIR` | `/opt/havs-ai` | Thư mục repo trên VPS |
| `RUN_USER` | owner của `APP_DIR` | User chạy git/npm |
| `SERVICE` | tự tìm unit `havs*` | Systemd service |
| `PM2_APP` | `havsai` | Fallback nếu không có systemd |
| `PORT` | `3000` | Port Node để health-check |
| `BACKUP_DIR` | `/var/backups/havs-ai` | Nơi lưu backup DB |
| `KEEP_BACKUPS` | `15` | Số backup giữ lại |
| `RUN_TESTS` | `1` | Đặt `0` để bỏ test |
| `FORCE_RESET` | `0` | Đặt `1` để bỏ thay đổi local trên server |

## Nếu health-check lỗi

Script in 80 dòng log gần nhất và đường dẫn backup DB:

```bash
journalctl -u havsai -n 100 --no-pager
```

Khôi phục DB (khi cần):

```bash
sudo systemctl stop havsai
sudo cp /var/backups/havs-ai/havs-YYYY-MM-DD-HHMMSS.db /opt/havs-ai/fullstack/data/havs.db
sudo systemctl start havsai
```
