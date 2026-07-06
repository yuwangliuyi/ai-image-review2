@echo off
chcp 936 >nul
title AI 图片审核系统 — 一键部署
echo ============================================
echo   AI 图片审核系统 — Windows 环境部署
echo ============================================
echo.
echo 本脚本将自动完成以下操作：
echo   1. 检查/安装 Node.js
echo   2. 检查/安装 Git
echo   3. 克隆项目代码
echo   4. 安装 PM2 进程管理
echo   5. 构建并启动服务
echo.
echo ============================================

setlocal enabledelayedexpansion

:: ──────────────────────────────────────
:: 1. 检查 Node.js
:: ──────────────────────────────────────
echo [1/6] 检查 Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] 未检测到 Node.js，请手动安装
    echo   下载地址：https://nodejs.org/zh-cn/download/
    echo   请安装 LTS 版本（64 位 .msi），安装完毕后重新运行本脚本。
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo   [OK] Node.js 已安装：%%i

:: ──────────────────────────────────────
:: 2. 检查 Git
:: ──────────────────────────────────────
echo [2/6] 检查 Git...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] 未检测到 Git，请手动安装
    echo   下载地址：https://git-scm.com/download/win
    echo   安装完毕后重新运行本脚本。
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('git --version') do echo   [OK] Git 已安装：%%i

:: ──────────────────────────────────────
:: 3. 克隆项目
:: ──────────────────────────────────────
echo [3/6] 克隆项目代码...
set PROJECT_DIR=D:\ai-image-review

if exist "%PROJECT_DIR%" (
    echo   [!] 目录 %PROJECT_DIR% 已存在，跳过克隆（如需重新拉取，请先删除该目录）
) else (
    echo   请输入项目仓库地址（如 http://192.168.x.x:port/user/repo.git）：
    set /p REPO_URL=
    git clone !REPO_URL! %PROJECT_DIR%
    if !errorlevel! neq 0 (
        echo   [FAIL] 克隆失败，请检查仓库地址和网络。
        pause
        exit /b 1
    )
    echo   [OK] 克隆完成
)

cd /d %PROJECT_DIR%

:: ──────────────────────────────────────
:: 4. 配置环境变量
:: ──────────────────────────────────────
echo [4/6] 配置环境变量...
set ENV_FILE=%PROJECT_DIR%\.env

:: 获取本机 IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    set LOCAL_IP=!LOCAL_IP: =!
)
if "%LOCAL_IP%"=="" set LOCAL_IP=localhost

(
echo DATABASE_URL="file:./dev.db"
echo NEXTAUTH_SECRET="ai-image-review-prod-secret-change-this-2026"
echo NEXTAUTH_URL="http://!LOCAL_IP!:3002"
) > "%ENV_FILE%"
echo   [OK] 已创建 .env 文件 (IP: !LOCAL_IP!)

:: ──────────────────────────────────────
:: 5. 安装依赖 & 构建
:: ──────────────────────────────────────
echo [5/6] 安装依赖并构建...
call npm install
if %errorlevel% neq 0 (
    echo   [FAIL] npm install 失败
    pause
    exit /b 1
)

:: 运行 Prisma 迁移
echo   运行数据库迁移...
call npx prisma migrate deploy
if %errorlevel% neq 0 (
    echo   [!] 迁移命令失败，尝试初始化数据库...
    call npx prisma db push
)

:: 构建
echo   构建生产版本...
call npm run build
if %errorlevel% neq 0 (
    echo   [FAIL] 构建失败，请检查错误信息
    pause
    exit /b 1
)
echo   [OK] 构建完成

:: ──────────────────────────────────────
:: 6. 安装 PM2 & 启动
:: ──────────────────────────────────────
echo [6/6] 安装 PM2 并启动服务...
call npm install -g pm2
if %errorlevel% neq 0 (
    echo   [FAIL] PM2 安装失败
    pause
    exit /b 1
)

:: 如果已有同名进程，先杀掉
pm2 delete ai-review 2>nul

:: 方式：用 PM2 调用 npm start 脚本
pm2 start npm --name "ai-review" --cwd "%PROJECT_DIR%" -- start
if %errorlevel% neq 0 (
    echo   [FAIL] 服务启动失败
    pause
    exit /b 1
)

:: 保存 PM2 进程列表
pm2 save

:: 注册开机自启
pm2 startup
echo   [!] 如果上面有提示，请复制粘贴提示命令执行一次（以管理员身份运行 CMD）

echo.
echo ============================================
echo   [OK] 部署完成！
echo ============================================
echo.
echo   访问地址：http://!LOCAL_IP!:3002
echo.
echo   常用命令：
echo     pm2 status          查看服务状态
echo     pm2 logs ai-review   查看实时日志
echo     pm2 restart ai-review  重启服务
echo     pm2 stop ai-review     停止服务
echo.
echo   更新命令：双击 update.bat
echo   备份命令：双击 backup.bat
echo.
pause
