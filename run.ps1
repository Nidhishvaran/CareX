Write-Host "Starting MediGuard AI Full Stack..." -ForegroundColor Cyan
python scripts/sqlite_db.py --sync
node scripts/serve.mjs
