@echo off
chcp 936 >nul
title AI 图片审核系统 - 安装

:: [!] 关键：切到项目根目录（install.bat 在 deploy/ 里，.. 就是项目根）
cd /d "%~dp0.."

echo ============================================
echo   AI 图片审核系统 - Windows 一键安装
echo ============================================
echo.

:: 1. 检查 Node.js
echo [1/6] 检查 Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未找到 Node.js，请先安装：https://nodejs.org/
    echo  推荐下载 LTS 版本（v18 或 v20），安装后重新运行本脚本。
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   [OK] Node.js 已安装: %NODE_VER%

:: 2. 配置环境变量
echo [2/6] 配置环境变量...
if not exist ".env" (
    copy deploy\.env.win .env >nul
    echo   [OK] 已创建 .env（使用默认配置）
) else (
    echo   [OK] .env 已存在，跳过
)

:: 3. 检查 Git（可选，用于后续更新）
echo [3/6] 检查 Git...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   [!] Git 未安装（不影响使用，但后续无法 git pull 更新代码）
    echo   如需自动更新，请安装：https://git-scm.com/
) else (
    for /f "tokens=*" %%i in ('git --version') do set GIT_VER=%%i
    echo   [OK] Git 已安装: %GIT_VER%
)

:: 4. 安装依赖
echo [4/6] 安装项目依赖（可能需要几分钟）...
call npm install
if %errorlevel% neq 0 (
    echo   [错误] npm install 失败，请检查网络连接。
    pause
    exit /b 1
)
echo   [OK] 依赖安装完成

:: 5. 生成 Prisma Client + 数据库迁移
echo [5/6] 初始化数据库...
call npx prisma generate
if %errorlevel% neq 0 (
    echo   [错误] prisma generate 失败
    pause
    exit /b 1
)
:: 优先用 migrate deploy（已有迁移文件）
call npx prisma migrate deploy 2>nul
if %errorlevel% neq 0 (
    :: deploy 失败则用 db push 兜底（直接从 schema 建表）
    echo   migrate deploy 失败，改用 db push...
    call npx prisma db push
    if %errorlevel% neq 0 (
        echo   [错误] 数据库初始化失败
        pause
        exit /b 1
    )
)
echo   [OK] 数据库初始化完成

:: 6. 构建生产版本（这步是关键，失败则无法启动）
echo [6/7] 构建生产版本（约 1-3 分钟，请耐心等待）...
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo   [错误] 构建失败！ 截图上面的错误信息发给鱼王。
    echo   常见原因：内存不足 / node_modules 损坏 / 磁盘空间不够
    pause
    exit /b 1
)
echo   [OK] 构建完成

:: 7. 创建初始用户（何扬帆 + 管理员）
echo [7/7] 创建用户账号...
node prisma/seed-windows.js
echo   [OK] 用户创建完成

echo.
echo ============================================
echo   安装完成！
echo.
echo   接下来请执行:
echo     1. 双击 start.bat 启动服务
echo     2. 浏览器打开 http://localhost:3002
echo.
echo   默认账号:
echo     审核员: 何扬帆 / reviewer123
echo     管理员: 管理员 / admin123
echo.
echo   如果启动后打不开，运行 diagnose.bat 截图。
echo ============================================
pause
