const bcrypt = require('./node_modules/bcryptjs');
const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({ where: { name: '管理员' } });
  console.log('User found:', !!user);
  if (user) {
    console.log('name:', user.name);
    console.log('password hash:', user.password.substring(0, 10) + '...');
    const valid = await bcrypt.compare('admin123', user.password);
    console.log('bcrypt valid:', valid);
  }
  await prisma.$disconnect();
})();
