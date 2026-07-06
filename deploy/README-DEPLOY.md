# AI 图片审核系统 — Windows 部署指南

## 一、何扬帆电脑部署（一次性操作）

### 前置条件
- Windows 10/11 64位
- 安装 [Node.js](https://nodejs.org/)（LTS 版本，v18 或 v20）
- 建议安装 [Git](https://git-scm.com/)（后续更新用）

### 方式 A：从 GitHub 克隆（推荐）

```batch
git clone https://github.com/yuwangliuyi/ai-image-review.git
cd ai-image-review
```

### 方式 B：U盘拷贝整个项目文件夹

把鱼王电脑上的 `ai-image-review` 整个文件夹拷到何扬帆电脑上。

### 一键安装

进入项目目录，双击 `deploy\install.bat`，脚本会自动：
1. 检查 Node.js
2. 安装项目依赖
3. 初始化数据库
4. 创建默认用户（何扬帆 + 管理员）

### 首次启动前配置

将 `deploy\.env.win` **复制到项目根目录**，重命名为 `.env`：

```batch
copy deploy\.env.win .env
```

> ⚠️ 如果何扬帆需要通过局域网内其他电脑访问，把 `.env` 里的 `NEXTAUTH_URL` 改成她的 IP 地址，例如 `http://192.168.1.100:3002`

### 启动服务

双击 `deploy\start.bat`，看到以下输出表示成功：

```
▲ Next.js ... (Turbopack)
- Local: http://localhost:3002
```

浏览器打开 **http://localhost:3002** 即可使用。

| 账号 | 密码 | 角色 |
|------|------|------|
| 何扬帆 | reviewer123 | 审核员 |
| 管理员 | admin123 | 管理员（鱼王用） |

---

## 二、开机自启（让何扬帆不用每次手动启动）

### 方法：Windows 任务计划程序

1. 按 `Win+R`，输入 `taskschd.msc`，回车
2. 右侧点击「创建基本任务」
3. 名称：`AI图片审核系统`
4. 触发器：选择「计算机启动时」
5. 操作：选择「启动程序」
   - 程序：浏览选择 `start.bat`
   - 起始于：填写项目目录路径（如 `C:\Users\何扬帆\ai-image-review\deploy`）
6. 完成

或者更简单——把 `start.bat` 的快捷方式放到 `shell:startup` 文件夹：
1. 按 `Win+R`，输入 `shell:startup`，回车
2. 把 `start.bat` 的快捷方式拖进去

---

## 三、鱼王调试 + 代码同步

### 工作流

```
鱼王电脑（macOS）                    何扬帆电脑（Windows）
├── npm run dev 开发模式             ├── npm start 生产模式
├── 修改代码                          ├── 实际审核数据
├── git add + git commit              │
├── git push → GitHub                 │
│                                    ├── git pull（获取最新代码）
│                                    ├── npm run build（重新构建）
│                                    └── 重启 start.bat
```

### 鱼王操作

```bash
cd ~/clacky_workspace/ai-image-review
# ... 改代码，调试 ...
npm run dev  # 本地调试

# 确认没问题后推送
git add -A
git commit -m "fix: 描述改动内容"
git push origin main
```

### 何扬帆更新（鱼王远程指导或她自己操作）

```batch
cd ai-image-review
git pull origin main
npm install        :: 如果有新依赖
npm run build      :: 重新构建
:: 然后重启 start.bat（关掉窗口重新双击）
```

### 简化更新：一键更新脚本

在何扬帆电脑上创建 `deploy\update.bat`：

```batch
@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 正在更新...
git pull origin main
call npm install
call npm run build
echo 更新完成！请重新运行 start.bat
pause
```

---

## 四、文件归档说明

### 存储位置

| 内容 | 路径 | 说明 |
|------|------|------|
| 数据库 | `prisma/dev.db` | SQLite 文件，所有数据都在这里 |
| 上传图片 | `public/uploads/` | 原始上传的图片文件 |
| 归档下载 | 动态生成 ZIP | 从 `public/uploads/` 读取，按 `品类/国家款式/SPU名称/店铺` 打包 |

### 备份建议

**定期备份数据库 + 图片到 NAS：**

在何扬帆电脑上创建一个备份脚本 `deploy\backup.bat`：

```batch
@echo off
set NAS_PATH=\\192.168.x.x\backup\ai-image-review
set DATE=%date:~0,4%%date:~5,2%%date:~8,2%
mkdir "%NAS_PATH%\%DATE%"
copy prisma\dev.db "%NAS_PATH%\%DATE%\"
xcopy public\uploads "%NAS_PATH%\%DATE%\uploads\" /E /I /Y
echo 备份完成: %NAS_PATH%\%DATE%
```

然后用 Windows 任务计划程序设置每天自动运行。

---

## 五、常见问题

### Q: 启动报错 "port 3002 already in use"
```batch
netstat -ano | findstr :3002
taskkill /PID <PID号> /F
```

### Q: 数据库损坏或需要重置
```batch
del prisma\dev.db
npx prisma migrate deploy
node prisma/seed-windows.js
```

### Q: 何扬帆忘记密码
鱼王用管理员账号登录 → 数据中心 → 用户管理（如有），或直接操作数据库。

### Q: 如何添加新的上传者账号
鱼王用管理员账号登录系统添加，或运行：
```batch
node -e "const{PrismaClient}=require('@prisma/client');const b=require('bcryptjs');const p=new PrismaClient();b.hash('密码123',12).then(pw=>p.user.create({data:{name:'新用户',email:'xx@xx.com',department:'设计部',password:pw,role:'UPLOADER'}})).then(()=>{console.log('OK');process.exit()})"
```
