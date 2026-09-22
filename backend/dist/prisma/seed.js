import { PrismaClient, AccountType, Role, SubscriptionPlan, PeriodStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
const accounts = [
    ['1000', 'الصندوق الرئيسي', AccountType.ASSET], ['1010', 'البنك الرئيسي', AccountType.ASSET], ['1100', 'العملاء', AccountType.ASSET], ['1200', 'المخزون', AccountType.ASSET], ['1210', 'ضريبة مشتريات قابلة للخصم', AccountType.ASSET],
    ['2000', 'الموردون', AccountType.LIABILITY], ['2100', 'مصروفات مستحقة', AccountType.LIABILITY], ['2200', 'ضريبة مبيعات مستحقة', AccountType.LIABILITY], ['3000', 'رأس المال', AccountType.EQUITY], ['3100', 'أرباح محتجزة', AccountType.EQUITY],
    ['4000', 'المبيعات', AccountType.REVENUE], ['4010', 'مرتجعات المبيعات', AccountType.REVENUE], ['5000', 'تكلفة المبيعات', AccountType.EXPENSE], ['6000', 'المصروفات التشغيلية', AccountType.EXPENSE],
];
async function main() {
    const email = 'admin@mizanpro.local';
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user)
        user = await prisma.user.create({ data: { name: 'مدير النظام', email, passwordHash: await bcrypt.hash('MizanPro@123', 12) } });
    let org = await prisma.organization.findFirst({ where: { name: 'شركة ميزان التجريبية' } });
    if (!org)
        org = await prisma.organization.create({ data: { name: 'شركة ميزان التجريبية', currency: 'DZD' } });
    let branch = await prisma.branch.findFirst({ where: { orgId: org.id, code: 'HQ' } });
    if (!branch)
        branch = await prisma.branch.create({ data: { orgId: org.id, code: 'HQ', name: 'المقر الرئيسي' } });
    await prisma.membership.upsert({ where: { userId_orgId: { userId: user.id, orgId: org.id } }, update: { role: Role.OWNER, branchId: branch.id, active: true }, create: { userId: user.id, orgId: org.id, branchId: branch.id, role: Role.OWNER } });
    for (const [code, name, type] of accounts)
        await prisma.account.upsert({ where: { orgId_code: { orgId: org.id, code } }, update: {}, create: { orgId: org.id, code, name, type, isSystem: true } });
    await prisma.unit.upsert({ where: { orgId_symbol: { orgId: org.id, symbol: 'وحدة' } }, update: { name: 'وحدة' }, create: { orgId: org.id, name: 'وحدة', symbol: 'وحدة' } });
    await prisma.warehouse.upsert({ where: { orgId_code: { orgId: org.id, code: 'MAIN' } }, update: { branchId: branch.id, name: 'المستودع الرئيسي' }, create: { orgId: org.id, branchId: branch.id, code: 'MAIN', name: 'المستودع الرئيسي' } });
    const cashAcc = await prisma.account.findUnique({ where: { orgId_code: { orgId: org.id, code: '1000' } } });
    if (cashAcc && !(await prisma.cashBox.findFirst({ where: { orgId: org.id, name: 'الصندوق الرئيسي' } })))
        await prisma.cashBox.create({ data: { orgId: org.id, branchId: branch.id, accountId: cashAcc.id, name: 'الصندوق الرئيسي' } });
    const year = new Date().getFullYear(), start = new Date(year, 0, 1), end = new Date(year, 11, 31, 23, 59, 59);
    if (!(await prisma.fiscalPeriod.findFirst({ where: { orgId: org.id, startDate: start, endDate: end } })))
        await prisma.fiscalPeriod.create({ data: { orgId: org.id, name: `السنة المالية ${year}`, startDate: start, endDate: end, status: PeriodStatus.OPEN } });
    const sub = await prisma.subscription.findFirst({ where: { orgId: org.id, active: true } });
    if (!sub) {
        const startsAt = new Date(), endsAt = new Date(startsAt);
        endsAt.setMonth(endsAt.getMonth() + 1);
        await prisma.subscription.create({ data: { orgId: org.id, plan: SubscriptionPlan.MONTHLY, startsAt, endsAt, active: true } });
    }
    await prisma.dashboardSetting.upsert({ where: { orgId: org.id }, update: { widgets: ['sales', 'purchases', 'expenses', 'profit', 'receivables', 'payables', 'inventory', 'cash', 'banks'] }, create: { orgId: org.id, widgets: ['sales', 'purchases', 'expenses', 'profit', 'receivables', 'payables', 'inventory', 'cash', 'banks'] } });
    console.log('Seeded MizanPro V2:', email, 'password: MizanPro@123');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
