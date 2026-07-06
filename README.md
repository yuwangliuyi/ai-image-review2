# AI 图片审核系统

多人协同的 AI 图片审核流程闭环工具，适用于公司内网。

## 功能模块

| 模块 | 说明 |
|------|------|
| 账号管理 | 注册/登录，三种角色：管理员、审核员、上传者 |
| 图片上传 | 拖拽批量上传，自动生成缩略图 |
| 审批流程 | 审核员通过/驳回，带备注，状态实时流转 |
| 自动归档 | 审核通过自动移至归档区，支持下载 |
| 数据统计 | 仪表盘含柱状图、饼图、审核员排行 |

## 技术栈

- **前端**：Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **后端**：Next.js API Routes + NextAuth.js v4 (凭证认证)
- **数据库**：Prisma v5 + SQLite
- **图表**：Recharts
- **图标**：Lucide React
- **上传**：React Dropzone + Sharp (缩略图)

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env

# 3. 初始化数据库 + 种子数据
npx prisma migrate dev --name init
npx prisma db seed

# 4. 启动开发服务器
npm run dev
```

访问 http://localhost:3002

## 测试账号

| 角色 | 邮箱 | 密码 |
|------|------|------|
| 管理员 | admin@example.com | admin123 |
| 审核员 | reviewer@example.com | reviewer123 |
| 上传者 | uploader@example.com | uploader123 |

## 权限矩阵

| 功能 | 管理员 | 审核员 | 上传者 |
|------|--------|--------|--------|
| 仪表盘 | ✅ | ✅ | ✅ |
| 上传图片 | ✅ | ✅ | ✅ |
| 查看自己的图片 | ✅ | ✅ | ✅ |
| 查看所有图片 | ✅ | ✅ | ❌ |
| 审核图片 | ✅ | ✅ | ❌ |
| 归档管理 | ✅ | ✅ | ❌ |
| 用户管理 | ✅ | ❌ | ❌ |

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── auth/              # 认证 API
│   │   ├── images/[id]/review # 图片审核
│   │   ├── spus/              # SPU CRUD + 上传
│   │   ├── stats/             # 仪表盘统计数据
│   │   ├── archives/          # 归档管理 + 下载
│   │   └── data-center/       # 数据中心
│   ├── dashboard/             # 仪表盘页
│   ├── upload/                # 图片上传页
│   ├── review/                # 审核中心
│   ├── archive/               # 归档页
│   ├── data-center/           # 数据中心页
│   ├── login/                 # 登录页
│   ├── register/              # 注册页
│   └── admin/users/           # 用户管理页
├── components/                # 共享组件
├── lib/
│   ├── prisma.ts              # 数据库客户端
│   ├── auth.ts                # NextAuth 配置
│   └── categories.ts          # 品类/风格/国家常量
└── middleware.ts              # 路由守卫
```
