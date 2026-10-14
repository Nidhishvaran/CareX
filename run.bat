@echo off
echo Starting MediGuard AI Full Stack...
python scripts/sqlite_db.py --sync
node scripts/serve.mjs
pause
