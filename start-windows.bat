@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Нужен Node.js 22 или новее: https://nodejs.org/ru/download
  pause
  exit /b 1
)
if not exist node_modules (
  echo Первый запуск: устанавливаем зависимости...
  call npm ci
  if errorlevel 1 ( pause & exit /b 1 )
)
echo Открываем CRM на http://127.0.0.1:4173 . Чтобы остановить, закройте это окно.
call npm run local
pause
