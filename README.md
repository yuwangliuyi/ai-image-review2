# AI 图片审核

基于 Next.js、Prisma、SQLite 和佳选 SSO 的图片审核应用。用户管理从 SSO 获取当前应用的授权名单和部门。既有本地角色、上传任务和审核记录保存在应用数据库中。

## 本地开发

复制 `.env.example` 为 `.env`，填写 SSO 地址和应用标识、独立的 Cookie 前缀、至少 32 字符的 `NEXTAUTH_SECRET`，以及 SQLite 文件的绝对路径。Node.js 需要支持当前 Next.js 版本。

```bash
npm ci --legacy-peer-deps
npx prisma generate
npm run db:migrate -- --database /absolute/path/to/validation.db
npm run dev
```

迁移默认预览。对现有业务数据迁移前，先创建独立数据库副本，然后使用 `--apply --backup-directory /absolute/path/to/backup` 应用迁移。服务启动只检查结构。

## Docker 验证实例

配置 `deploy/docker-compose.parallel.yml` 的独立数据库、上传、归档和日志目录，并在 `.env` 中填写预期入口、端口及镜像标签。启动前检查解析后的配置。

```bash
docker compose --env-file .env -f deploy/docker-compose.parallel.yml config --quiet
docker compose --env-file .env -f deploy/docker-compose.parallel.yml up -d --build
```

## 测试

```bash
npm run sso:check-guard
npm run sso:typecheck
npm run sso:test-logic
npm run sso:test-ui
npm run test:maintenance
NEXT_TEST_BUILD=1 npm run build
npm run sso:test-api
```

接口测试使用模拟 SSO 和隔离的 SQLite 文件。
