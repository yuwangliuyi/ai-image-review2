@echo off
chcp 936 >nul
title AI 图片审核系统

:: [!] 关键：切到项目根目录（start.bat 在 deploy/ 里，.. 就是项目根）
cd /d "%~dp0.."

echo ============================================
echo   AI 图片审核系统 - 启动中...
echo   访问地址: http://localhost:3002
echo   关闭此窗口将停止服务
echo ============================================
echo.

:: 检查 .env
if not exist ".env" (
    echo   [错误] .env 文件不存在！请先运行 install.bat
    pause
    exit /b 1
)

:: 检查 node_modules
if not exist "node_modules" (
    echo   [错误] node_modules 不存在！请先运行 install.bat
    pause
    exit /b 1
)

:: 构建生产版本（检查 standalone 入口完整性，而不只是目录）
if not exist ".next\standalone\server.js" (
    echo .next 不完整或不存在，正在构建生产版本（约 1-2 分钟）...
    call npm run build
    if %errorlevel% neq 0 (
        echo   [错误] 构建失败！请运行 diagnose.bat 截图。
        pause
        exit /b 1
    )
    echo   [OK] 构建完成
) else (
    echo   [OK] .next 完整，跳过构建
)

:: 检查端口是否被占用
echo 检查端口 3002...
netstat -ano | findstr ":3002 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo   [!] 端口 3002 已被占用！可能上次没关干净。
    echo   请关闭其他占用的程序或重启电脑后重试。
    pause
    exit /b 1
)
echo   [OK] 端口正常

echo.
echo 启动服务...
call npm run start
pause
