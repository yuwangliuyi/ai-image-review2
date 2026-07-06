@echo off
chcp 936 >nul
title AI 图片审核系统 - 更新

cd /d "%~dp0.."

echo ============================================
echo   AI 图片审核系统 - 代码更新
echo ============================================
echo.

echo [1/3] 拉取最新代码...
git pull origin main
if %errorlevel% neq 0 (
    echo   [错误] git pull 失败，请检查网络或 Git 配置
    pause
    exit /b 1
)
echo   [OK] 代码已更新

echo [2/3] 安装依赖（如有新增）...
call npm install
echo   [OK] 依赖已检查

echo [3/3] 重新构建...
call npm run build
if %errorlevel% neq 0 (
    echo   [错误] 构建失败，可能是代码有问题
    pause
    exit /b 1
)
echo   [OK] 构建完成

echo.
echo ============================================
echo   更新完成！请重新运行 start.bat 启动服务
echo ============================================
pause
