# AI 图片审核系统 — Windows 部署指南

## 前置准备

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10/11 64 位 |
| 内存 | ≥ 4GB 可用 |
| 磁盘 | ≥ 10GB 可用空间 |
| 网络 | 与公司内网互通，能 ping 通你的 Mac |
| 防火墙 | 允许 3002 端口入站（或部署时选择其他端口） |

---

## 第一步：安装基础软件

### 1. Node.js
- 下载地址：https://nodejs.org/zh-cn/download/
- 选 **LTS 版本（64 位 .msi）**
- 安装时全部默认选项，「Automatically install necessary tools」勾上

### 2. Git
- 下载地址：https://git-scm.com/download/win
- 安装时全部默认选项即可

---

## 第二步：准备代码仓库

你需要先把代码推送到一个 Win 电脑能访问的 Git 仓库。两种方式：

### 方式 A：用 GitHub/Gitee（推荐）
```bash
# 在你 Mac 上（项目目录里）
git remote add origin <你的仓库地址>
git push -u origin main
```

### 方式 B：用你 Mac 当 Git 服务器
```bash
# 在你 Mac 上
cd ~/clacky_workspace
git clone --bare ai-image-review ai-image-review.git
# Win 上 clone 地址就是：http://你的Mac IP:端口/... 或直接共享文件夹
```

> 最简单：把整个项目文件夹复制到 U 盘/共享文件夹，Win 上直接 copy 过去也完全可以。

---

## 第三步：一键部署

1. 把 `deploy/` 文件夹里的三个 `.bat` 文件拷贝到 Win 桌面
2. **双击 `setup-win.bat`**，按提示操作
3. 脚本会自动：
   - 检查 Node.js / Git
   - 克隆 / 复制项目到 `D:\ai-image-review`
   - 配置 `.env`（自动获取本机 IP）
   - 安装依赖 → 数据库迁移 → 构建
   - 用 PM2 启动服务并注册开机自启

部署完成后，用公司其他电脑浏览器访问 `http://这台Win的IP:3002` 验证。

---

## 日常运维

| 场景 | 操作 |
|------|------|
| **更新系统** | 你 Mac 改完代码 push → Win 上双击 `update.bat` |
| **备份数据** | 双击 `backup.bat`（建议配 Windows 任务计划每天凌晨自动跑） |
| **看服务状态** | 打开 CMD，输入 `pm2 status` |
| **看报错日志** | `pm2 logs ai-review --err` |
| **重启服务** | `pm2 restart ai-review` |
| **停止服务** | `pm2 stop ai-review` |

---

## 配置自动备份（Windows 任务计划）

1. 按 `Win+R`，输入 `taskschd.msc`，回车
2. 右侧「创建基本任务」
3. 名称：`AI审核备份`，触发器：`每天`，时间选凌晨 3:00
4. 操作：`启动程序` → 浏览选择桌面的 `backup.bat`
5. 完成

---

## 目录结构（Win 上）

```
D:\
├── ai-image-review/          ← 项目代码
│   ├── prisma/
│   │   └── dev.db            ← SQLite 数据库（核心文件）
│   ├── public/
│   │   └── uploads/          ← 上传的图片
│   └── .next/                ← 构建产物
│
└── ai-image-review-backups/  ← 自动备份目录
    ├── dev_20260622.db
    └── ...
```

---

## 常见问题

### Q: 部署完访问不了？
- 检查 Win 防火墙：`控制面板 → Windows Defender 防火墙 → 允许应用通过防火墙`，把 Node.js 加进去
- 检查服务是否在跑：`pm2 status`

### Q: update.bat 报错？
- 可能是 git pull 失败，检查网络和仓库地址
- 也可以直接把代码复制到 Win 上，跳过 git pull，手动跑 `npm install && npm run build && pm2 restart ai-review`

### Q: 怎么改端口？
- 修改 `.env` 里的 `NEXTAUTH_URL` 端口
- 修改 `package.json` 里 `scripts.start`：`next start -p 新端口`
- 重新构建：双击 `update.bat`
