const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('创建初始账号...\n');

  // ── 管理员：赵于淋 ──
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { name: '赵于淋' },
    update: {
      email: 'zhaoyulin@example.com',
      department: '视觉部',
      password: adminPassword,
      role: 'ADMIN',
    },
    create: {
      name: '赵于淋',
      email: 'zhaoyulin@example.com',
      department: '视觉部',
      password: adminPassword,
      role: 'ADMIN',
    },
  });
  console.log(`  ✓ ${admin.name} / admin123 (ADMIN)`);

  // ── 审核员：何扬帆 ──
  const reviewerPassword = await bcrypt.hash('reviewer123', 12);
  const reviewer = await prisma.user.upsert({
    where: { name: '何扬帆' },
    update: {
      email: 'heyangfan@example.com',
      department: '视觉部',
      password: reviewerPassword,
      role: 'REVIEWER',
    },
    create: {
      name: '何扬帆',
      email: 'heyangfan@example.com',
      department: '视觉部',
      password: reviewerPassword,
      role: 'REVIEWER',
    },
  });
  console.log(`  ✓ ${reviewer.name} / reviewer123 (REVIEWER)`);

  console.log('\n初始账号创建完成！');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
