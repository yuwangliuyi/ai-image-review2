@echo off
chcp 936 >nul
title AI审核系统 — 数据库备份

set PROJECT_DIR=D:\ai-image-review
set BACKUP_DIR=D:\ai-image-review-backups
set DB_FILE=%PROJECT_DIR%\prisma\dev.db
set UPLOADS_DIR=%PROJECT_DIR%\public\uploads

:: 创建备份目录
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

:: 日期格式 yyyymmdd
set DATE=%date:~0,4%%date:~5,2%%date:~8,2%

echo ============================================
echo   数据库备份 %DATE%
echo ============================================

:: ────────────────────────
:: 1. 备份数据库
:: ────────────────────────
if exist "%DB_FILE%" (
    copy "%DB_FILE%" "%BACKUP_DIR%\dev_%DATE%.db" >nul
    echo   [OK] 数据库已备份：dev_%DATE%.db
) else (
    echo   [FAIL] 未找到数据库文件！
)

:: ────────────────────────
:: 2. 备份上传图片（如果存在）
:: ────────────────────────
if exist "%UPLOADS_DIR%" (
    set IMG_BACKUP=%BACKUP_DIR%\uploads_%DATE%
    if not exist "!IMG_BACKUP!" mkdir "!IMG_BACKUP!"
    xcopy "%UPLOADS_DIR%" "!IMG_BACKUP!" /E /I /Q /Y >nul 2>&1
    echo   [OK] 上传文件已备份：uploads_%DATE%
)

:: ────────────────────────
:: 3. 清理 7 天前的备份
:: ────────────────────────
echo   清理旧备份（保留最近 7 天）...
forfiles /p "%BACKUP_DIR%" /m "dev_*.db" /d -7 /c "cmd /c del @file" 2>nul
forfiles /p "%BACKUP_DIR%" /m "uploads_*" /d -7 /c "cmd /c rmdir /s /q @file" 2>nul
echo   [OK] 清理完成

echo.
echo ============================================
echo   [OK] 备份完成
echo   备份目录：%BACKUP_DIR%
echo ============================================
