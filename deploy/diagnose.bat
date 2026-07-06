@echo off
chcp 936 >nul
title AI 图片审核系统 - 诊断工具

cd /d "%~dp0.."

echo ============================================
echo   AI 图片审核系统 - 诊断报告
echo   %date% %time%
echo ============================================
echo.

:: 1. Node.js
echo [1] Node.js 环境
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] Node.js 未安装
) else (
    for /f "tokens=*" %%i in ('node -v') do echo   [OK] Node.js: %%i
)

:: 2. 项目文件
echo.
echo [2] 项目文件
echo   当前目录: %cd%
if exist "package.json" (echo   [OK] package.json 存在) else (echo   [FAIL] package.json 不存在 - 你是不是没在项目根目录运行？)
if exist ".env" (echo   [OK] .env 存在) else (echo   [FAIL] .env 不存在 - 运行 install.bat)
if exist "node_modules" (echo   [OK] node_modules 存在) else (echo   [FAIL] node_modules 不存在 - 运行 install.bat)
if exist "prisma\schema.prisma" (echo   [OK] prisma\schema.prisma 存在) else (echo   [FAIL] prisma 目录异常)

:: 3. .env 内容
echo.
echo [3] .env 内容
if exist ".env" (
    for /f "tokens=*" %%i in (.env) do echo   %%i
) else (
    echo   .env 不存在，无法检查
)

:: 4. 构建产物
echo.
echo [4] 构建产物 (.next)
if exist ".next" (
    echo   [OK] .next 目录存在
    if exist ".next\standalone\server.js" (
        echo   [OK] .next\standalone\server.js 存在 (standalone 入口正常)
    ) else (
        echo   [WARN] .next\standalone\server.js 不存在 - 构建不完整！
    )
    if exist ".next\BUILD_ID" (
        for /f "tokens=*" %%i in (.next\BUILD_ID) do echo   BUILD_ID: %%i
    )
) else (
    echo   [FAIL] .next 目录不存在 - 还没有构建过！
)

:: 5. 端口占用
echo.
echo [5] 端口 3002 占用情况
netstat -ano | findstr ":3002" >nul
if %errorlevel% equ 0 (
    echo   [WARN] 端口 3002 有活动连接:
    netstat -ano | findstr ":3002"
) else (
    echo   [OK] 端口 3002 没有被占用
)

:: 6. Node 进程
echo.
echo [6] Node.js 进程
tasklist /fi "imagename eq node.exe" 2>nul | findstr "node.exe" >nul
if %errorlevel% equ 0 (
    echo   [INFO] 当前运行的 Node 进程:
    tasklist /fi "imagename eq node.exe" 2>nul
) else (
    echo   [OK] 没有 Node 进程在运行
)

:: 7. 尝试构建
echo.
echo [7] 尝试构建...
echo   正在运行 npm run build (这需要 1-2 分钟)...
call npm run build
if %errorlevel% equ 0 (
    echo   [OK] 构建成功！
) else (
    echo   [FAIL] 构建失败！请看上面的错误信息。
)

:: 8. 尝试启动 (如果构建成功)
if %errorlevel% equ 0 (
    echo.
    echo [8] 启动服务测试...
    echo   正在启动，看到 "Ready" 就说明成功了...
    echo   请在浏览器打开 http://localhost:3002 试试
    echo   ----------------------------------------
    call npm run start
)

echo.
echo ============================================
echo   诊断完成。请把上面的信息截图发给鱼王。
echo ============================================
pause
