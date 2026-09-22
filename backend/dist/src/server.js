import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaClient, Role, AccountType, InvoiceType, InvoiceStatus, PaymentMethod, SubscriptionPlan, PeriodStatus, InventoryMovementType, CashTransactionType, ReconciliationStatus } from '@prisma/client';
import { z } from 'zod';
const prisma = new PrismaClient();
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '4mb' }));
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const num = (v) => Number(v ?? 0);
const money = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const PERMISSIONS = {
    OWNER: ['*'],
    ADMIN: ['org.read', 'org.write', 'members.read', 'members.write', 'audit.read', 'accounting.read', 'accounting.write', 'sales.read', 'sales.write', 'purchases.read', 'purchases.write', 'inventory.read', 'inventory.write', 'cash.read', 'cash.write', 'bank.read', 'bank.write', 'reports.read', 'subscription.read', 'subscription.write'],
    ACCOUNTANT: ['accounting.read', 'accounting.write', 'sales.read', 'purchases.read', 'inventory.read', 'cash.read', 'bank.read', 'bank.write', 'reports.read', 'audit.read'],
    SALES: ['sales.read', 'sales.write', 'inventory.read', 'customers.write', 'reports.read'],
    PURCHASING: ['purchases.read', 'purchases.write', 'inventory.read', 'suppliers.write', 'reports.read'],
    INVENTORY: ['inventory.read', 'inventory.write', 'products.write', 'reports.read'],
    CASHIER: ['sales.read', 'sales.write', 'customers.write', 'cash.read', 'cash.write', 'reports.read'],
    VIEWER: ['org.read', 'accounting.read', 'sales.read', 'purchases.read', 'inventory.read', 'cash.read', 'bank.read', 'reports.read'],
};
function sign(user) {
    return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}
const auth = (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || (typeof String(req.query.token) === 'string' ? String(req.query.token) : undefined);
    if (!token)
        return res.status(401).json({ error: 'غير مصرح' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    }
    catch {
        return res.status(401).json({ error: 'رمز الدخول غير صالح' });
    }
};
const allow = (...permissions) => (req, res, next) => {
    if (!req.user)
        return res.status(401).json({ error: 'غير مصرح' });
    const granted = PERMISSIONS[req.user.role] || [];
    if (granted.includes('*') || permissions.some(p => granted.includes(p)))
        return next();
    return res.status(403).json({ error: 'لا تملك الصلاحية لهذه العملية' });
};
async function audit(orgId, userId, action, entity, entityId, metadata) {
    await prisma.auditLog.create({ data: { orgId, userId, action, entity, entityId, metadata } });
}
const accountDefaults = [
    ['1000', 'الصندوق الرئيسي', AccountType.ASSET],
    ['1010', 'البنك الرئيسي', AccountType.ASSET],
    ['1100', 'العملاء', AccountType.ASSET],
    ['1200', 'المخزون', AccountType.ASSET],
    ['1210', 'ضريبة مشتريات قابلة للخصم', AccountType.ASSET],
    ['2000', 'الموردون', AccountType.LIABILITY],
    ['2100', 'مصروفات مستحقة', AccountType.LIABILITY],
    ['2200', 'ضريبة مبيعات مستحقة', AccountType.LIABILITY],
    ['3000', 'رأس المال', AccountType.EQUITY],
    ['3100', 'أرباح محتجزة', AccountType.EQUITY],
    ['4000', 'المبيعات', AccountType.REVENUE],
    ['4010', 'مرتجعات المبيعات', AccountType.REVENUE],
    ['5000', 'تكلفة المبيعات', AccountType.EXPENSE],
    ['6000', 'المصروفات التشغيلية', AccountType.EXPENSE],
];
async function seedOrg(orgId, branchId) {
    for (const [code, name, type] of accountDefaults)
        await prisma.account.upsert({ where: { orgId_code: { orgId, code } }, update: {}, create: { orgId, code, name, type, isSystem: true } });
    await prisma.unit.upsert({ where: { orgId_symbol: { orgId, symbol: 'وحدة' } }, update: { name: 'وحدة' }, create: { orgId, name: 'وحدة', symbol: 'وحدة' } });
    const wh = await prisma.warehouse.upsert({ where: { orgId_code: { orgId, code: 'MAIN' } }, update: { branchId, name: 'المستودع الرئيسي' }, create: { orgId, branchId, code: 'MAIN', name: 'المستودع الرئيسي' } });
    const cbAcc = await prisma.account.findUnique({ where: { orgId_code: { orgId, code: '1000' } } });
    if (cbAcc)
        await prisma.cashBox.create({ data: { orgId, branchId, accountId: cbAcc.id, name: 'الصندوق الرئيسي' } }).catch(() => { });
    const year = new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59);
    await prisma.fiscalPeriod.create({ data: { orgId, name: `السنة المالية ${year}`, startDate: start, endDate: end } }).catch(() => { });
    await prisma.dashboardSetting.upsert({ where: { orgId }, update: { widgets: ['sales', 'purchases', 'profit', 'receivables', 'payables', 'inventory', 'cash', 'banks'] }, create: { orgId, widgets: ['sales', 'purchases', 'profit', 'receivables', 'payables', 'inventory', 'cash', 'banks'] } });
    return wh;
}
async function currentPeriod(orgId, date = new Date(), tx = prisma) {
    let period = await tx.fiscalPeriod.findFirst({ where: { orgId, startDate: { lte: date }, endDate: { gte: date }, status: PeriodStatus.OPEN } });
    if (!period)
        throw new Error('لا توجد فترة محاسبية مفتوحة لهذا التاريخ');
    return period;
}
async function balancedJournal(tx, data) {
    const lines = data.lines.map(l => ({ ...l, debit: money(l.debit || 0), credit: money(l.credit || 0) }));
    if (lines.length < 2)
        throw new Error('القيد يحتاج سطرين على الأقل');
    for (const l of lines)
        if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0))
            throw new Error('كل سطر يجب أن يكون مديناً أو دائناً فقط');
    const debit = money(lines.reduce((s, l) => s + l.debit, 0));
    const credit = money(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(debit - credit) > 0.009)
        throw new Error('القيد غير متوازن');
    const period = await currentPeriod(data.orgId, data.date, tx);
    return tx.journalEntry.create({ data: { orgId: data.orgId, branchId: data.branchId ?? null, periodId: period.id, reference: data.reference, description: data.description, entryDate: data.date, totalDebit: debit, totalCredit: credit, sourceType: data.sourceType, sourceId: data.sourceId, lines: { create: lines } } });
}
async function account(orgId, code, tx = prisma) {
    const a = await tx.account.findUnique({ where: { orgId_code: { orgId, code } } });
    if (!a)
        throw new Error(`الحساب ${code} غير موجود`);
    return a;
}
async function paymentAccount(orgId, method, cashBoxId, bankAccountId, tx = prisma) {
    if (method === PaymentMethod.CASH) {
        const box = cashBoxId ? await tx.cashBox.findFirst({ where: { id: cashBoxId, orgId } }) : await tx.cashBox.findFirst({ where: { orgId, active: true }, orderBy: { name: 'asc' } });
        if (!box)
            throw new Error('لا يوجد صندوق');
        return { accountId: box.accountId, cashBoxId: box.id };
    }
    if (method === PaymentMethod.BANK || method === PaymentMethod.TRANSFER || method === PaymentMethod.CARD) {
        const bank = bankAccountId ? await tx.bankAccount.findFirst({ where: { id: bankAccountId, orgId } }) : await tx.bankAccount.findFirst({ where: { orgId, active: true }, orderBy: { name: 'asc' } });
        if (!bank)
            throw new Error('لا يوجد حساب بنكي');
        return { accountId: bank.accountId, bankAccountId: bank.id };
    }
    return { accountId: (await account(orgId, '1000', tx)).id };
}
async function updateStock(tx, orgId, warehouseId, productId, delta, unitCost, type, reference) {
    const wh = await tx.warehouse.findFirst({ where: { id: warehouseId, orgId } });
    if (!wh)
        throw new Error('المستودع غير موجود');
    await tx.warehouseStock.upsert({ where: { warehouseId_productId: { warehouseId, productId } }, update: { qty: { increment: delta } }, create: { warehouseId, productId, qty: delta } });
    const stock = await tx.warehouseStock.findUnique({ where: { warehouseId_productId: { warehouseId, productId } } });
    if (num(stock?.qty) < -0.0001)
        throw new Error('الكمية في المستودع لا تكفي');
    await tx.inventoryMovement.create({ data: { orgId, warehouseId, productId, qty: delta, unitCost, type, reference } });
}
app.get('/health', async (_req, res) => res.json({ ok: true, service: 'mizanpro-api', version: '2.0.0' }));
app.post('/api/auth/register', async (req, res) => {
    try {
        const b = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), organization: z.string().min(2) }).parse(req.body);
        if (await prisma.user.findUnique({ where: { email: b.email } }))
            return res.status(409).json({ error: 'البريد مستخدم' });
        const out = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({ data: { name: b.name, email: b.email, passwordHash: await bcrypt.hash(b.password, 12) } });
            const org = await tx.organization.create({ data: { name: b.organization } });
            const branch = await tx.branch.create({ data: { orgId: org.id, code: 'HQ', name: 'المقر الرئيسي' } });
            await tx.membership.create({ data: { userId: user.id, orgId: org.id, branchId: branch.id, role: Role.OWNER } });
            return { user, org, branch };
        });
        await seedOrg(out.org.id, out.branch.id);
        await audit(out.org.id, out.user.id, 'CREATE', 'Organization', out.org.id);
        res.json({ token: sign({ id: out.user.id, orgId: out.org.id, role: Role.OWNER, branchId: out.branch.id }), user: { id: out.user.id, name: out.user.name, email: out.user.email }, organization: out.org });
    }
    catch (e) {
        res.status(400).json({ error: e.message || 'خطأ في التسجيل' });
    }
});
app.post('/api/auth/login', async (req, res) => {
    try {
        const b = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
        const user = await prisma.user.findUnique({ where: { email: b.email }, include: { memberships: { where: { active: true }, include: { organization: true, branch: true } } } });
        if (!user || !(await bcrypt.compare(b.password, user.passwordHash)))
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        const m = user.memberships[0];
        if (!m)
            return res.status(403).json({ error: 'لا توجد مؤسسة مرتبطة بالحساب' });
        res.json({ token: sign({ id: user.id, orgId: m.orgId, role: m.role, branchId: m.branchId }), user: { id: user.id, name: user.name, email: user.email }, organization: m.organization, branch: m.branch });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.get('/api/me', auth, async (req, res) => res.json(await prisma.user.findUnique({ where: { id: req.user.id }, include: { memberships: { include: { organization: true, branch: true } } } })));
app.get('/api/roles', auth, async (_req, res) => res.json(Object.entries(PERMISSIONS).map(([role, permissions]) => ({ role, permissions }))));
app.get('/api/organization', auth, allow('org.read'), async (req, res) => res.json(await prisma.organization.findUnique({ where: { id: req.user.orgId }, include: { branches: true, subscriptions: { where: { active: true }, orderBy: { endsAt: 'desc' }, take: 1 } } })));
app.put('/api/organization', auth, allow('org.write'), async (req, res) => { try {
    const b = z.object({ name: z.string().min(2), legalName: z.string().optional(), taxNumber: z.string().optional(), commercialReg: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional().or(z.literal('')), address: z.string().optional(), logoUrl: z.string().optional(), currency: z.string().min(2).max(5), fiscalYearStart: z.number().int().min(1).max(12) }).parse(req.body);
    const out = await prisma.organization.update({ where: { id: req.user.orgId }, data: b });
    await audit(req.user.orgId, req.user.id, 'UPDATE', 'Organization', out.id, b);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/branches', auth, allow('org.read'), async (req, res) => res.json(await prisma.branch.findMany({ where: { orgId: req.user.orgId }, orderBy: { name: 'asc' } })));
app.post('/api/branches', auth, allow('org.write'), async (req, res) => { try {
    const b = z.object({ code: z.string().min(1), name: z.string().min(2), phone: z.string().optional(), address: z.string().optional() }).parse(req.body);
    const out = await prisma.branch.create({ data: { ...b, orgId: req.user.orgId } });
    await audit(req.user.orgId, req.user.id, 'CREATE', 'Branch', out.id, b);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/members', auth, allow('members.read'), async (req, res) => res.json(await prisma.membership.findMany({ where: { orgId: req.user.orgId }, include: { user: true, branch: true }, orderBy: { createdAt: 'desc' } })));
app.post('/api/members', auth, allow('members.write'), async (req, res) => { try {
    const b = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), role: z.nativeEnum(Role), branchId: z.string().optional() }).parse(req.body);
    let user = await prisma.user.findUnique({ where: { email: b.email } });
    if (!user)
        user = await prisma.user.create({ data: { name: b.name, email: b.email, passwordHash: await bcrypt.hash(b.password, 12) } });
    const m = await prisma.membership.upsert({ where: { userId_orgId: { userId: user.id, orgId: req.user.orgId } }, update: { role: b.role, branchId: b.branchId, active: true }, create: { userId: user.id, orgId: req.user.orgId, branchId: b.branchId, role: b.role } });
    await audit(req.user.orgId, req.user.id, 'UPSERT', 'Membership', m.id, { email: b.email, role: b.role });
    res.json(m);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/audit-logs', auth, allow('audit.read'), async (req, res) => { const take = Math.min(200, Math.max(1, Number(String(req.query.take)) || 100)); res.json(await prisma.auditLog.findMany({ where: { orgId: req.user.orgId }, include: { user: true }, orderBy: { createdAt: 'desc' }, take })); });
app.get('/api/accounts', auth, allow('accounting.read'), async (req, res) => res.json(await prisma.account.findMany({ where: { orgId: req.user.orgId }, include: { children: true, parent: true }, orderBy: { code: 'asc' } })));
app.post('/api/accounts', auth, allow('accounting.write'), async (req, res) => { try {
    const b = z.object({ code: z.string().min(1), name: z.string().min(2), type: z.nativeEnum(AccountType), parentId: z.string().nullable().optional(), openingBalance: z.number().optional() }).parse(req.body);
    const out = await prisma.account.create({ data: { ...b, orgId: req.user.orgId, openingBalance: b.openingBalance || 0 } });
    await audit(req.user.orgId, req.user.id, 'CREATE', 'Account', out.id, b);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/fiscal-periods', auth, allow('accounting.read'), async (req, res) => res.json(await prisma.fiscalPeriod.findMany({ where: { orgId: req.user.orgId }, orderBy: { startDate: 'desc' } })));
app.post('/api/fiscal-periods/:id/close', auth, allow('accounting.write'), async (req, res) => { try {
    const out = await prisma.fiscalPeriod.update({ where: { id: String(req.params.id) }, data: { status: PeriodStatus.CLOSED, closedAt: new Date(), closedBy: req.user.id } });
    await audit(req.user.orgId, req.user.id, 'CLOSE', 'FiscalPeriod', out.id);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/fiscal-periods', auth, allow('accounting.write'), async (req, res) => { try {
    const b = z.object({ name: z.string().min(2), startDate: z.string(), endDate: z.string() }).parse(req.body);
    const out = await prisma.fiscalPeriod.create({ data: { orgId: req.user.orgId, name: b.name, startDate: new Date(b.startDate), endDate: new Date(b.endDate), status: PeriodStatus.OPEN } });
    await audit(req.user.orgId, req.user.id, 'CREATE', 'FiscalPeriod', out.id);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/journals', auth, allow('accounting.write'), async (req, res) => { try {
    const b = z.object({ reference: z.string().min(1), description: z.string().min(2), entryDate: z.string(), branchId: z.string().nullable().optional(), lines: z.array(z.object({ accountId: z.string(), debit: z.number().nonnegative().optional(), credit: z.number().nonnegative().optional(), memo: z.string().optional() })).min(2) }).parse(req.body);
    const out = await prisma.$transaction(tx => balancedJournal(tx, { orgId: req.user.orgId, reference: b.reference, description: b.description, branchId: b.branchId ?? null, lines: b.lines, date: new Date(b.entryDate) }));
    await audit(req.user.orgId, req.user.id, 'CREATE', 'JournalEntry', out.id, { reference: b.reference });
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/journals', auth, allow('accounting.read'), async (req, res) => { const where = { orgId: req.user.orgId }; if (String(req.query.from))
    where.entryDate = { ...where.entryDate, gte: new Date(String(req.query.from)) }; if (String(req.query.to))
    where.entryDate = { ...where.entryDate, lte: new Date(String(req.query.to)) }; res.json(await prisma.journalEntry.findMany({ where, include: { lines: { include: { account: true } }, period: true }, orderBy: { entryDate: 'desc' }, take: 200 })); });
app.get('/api/categories', auth, allow('inventory.read'), async (req, res) => res.json(await prisma.category.findMany({ where: { orgId: req.user.orgId }, include: { children: true }, orderBy: { name: 'asc' } })));
app.post('/api/categories', auth, allow('products.write', 'inventory.write'), async (req, res) => { try {
    const b = z.object({ name: z.string().min(2), parentId: z.string().optional() }).parse(req.body);
    res.json(await prisma.category.create({ data: { ...b, orgId: req.user.orgId } }));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/units', auth, allow('inventory.read'), async (req, res) => res.json(await prisma.unit.findMany({ where: { orgId: req.user.orgId }, orderBy: { name: 'asc' } })));
app.post('/api/units', auth, allow('products.write', 'inventory.write'), async (req, res) => { try {
    const b = z.object({ name: z.string().min(1), symbol: z.string().min(1) }).parse(req.body);
    res.json(await prisma.unit.create({ data: { ...b, orgId: req.user.orgId } }));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/products', auth, allow('inventory.read'), async (req, res) => res.json(await prisma.product.findMany({ where: { orgId: req.user.orgId }, include: { category: true, unit: true, stocks: { include: { warehouse: true } } }, orderBy: { name: 'asc' }, take: 500 })));
app.post('/api/products', auth, allow('products.write', 'inventory.write'), async (req, res) => { try {
    const b = z.object({ sku: z.string().min(1), barcode: z.string().optional(), name: z.string().min(2), categoryId: z.string().optional(), unitId: z.string().optional(), description: z.string().optional(), salePrice: z.number().nonnegative(), costPrice: z.number().nonnegative(), taxRate: z.number().nonnegative().optional(), minStock: z.number().nonnegative().optional() }).parse(req.body);
    const out = await prisma.product.create({ data: { ...b, orgId: req.user.orgId, taxRate: b.taxRate || 0, minStock: b.minStock || 0 } });
    await audit(req.user.orgId, req.user.id, 'CREATE', 'Product', out.id, b);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/warehouses', auth, allow('inventory.read'), async (req, res) => res.json(await prisma.warehouse.findMany({ where: { orgId: req.user.orgId }, include: { branch: true, stocks: { include: { product: true } } }, orderBy: { name: 'asc' } })));
app.post('/api/warehouses', auth, allow('inventory.write'), async (req, res) => { try {
    const b = z.object({ code: z.string().min(1), name: z.string().min(2), branchId: z.string().optional(), address: z.string().optional() }).parse(req.body);
    res.json(await prisma.warehouse.create({ data: { ...b, orgId: req.user.orgId } }));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/inventory/move', auth, allow('inventory.write'), async (req, res) => { try {
    const b = z.object({ warehouseId: z.string(), productId: z.string(), qty: z.number(), unitCost: z.number().nonnegative(), type: z.nativeEnum(InventoryMovementType), reference: z.string().optional(), notes: z.string().optional() }).parse(req.body);
    if (b.qty === 0)
        throw new Error('الكمية لا يمكن أن تكون صفراً');
    const out = await prisma.$transaction(async (tx) => { await updateStock(tx, req.user.orgId, b.warehouseId, b.productId, b.qty, b.unitCost, b.type, b.reference); return tx.warehouseStock.findUnique({ where: { warehouseId_productId: { warehouseId: b.warehouseId, productId: b.productId } } }); });
    await audit(req.user.orgId, req.user.id, 'CREATE', 'InventoryMovement', undefined, b);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/inventory/transfer', auth, allow('inventory.write'), async (req, res) => { try {
    const b = z.object({ fromWarehouseId: z.string(), toWarehouseId: z.string(), productId: z.string(), qty: z.number().positive(), unitCost: z.number().nonnegative(), reference: z.string().optional() }).parse(req.body);
    if (b.fromWarehouseId === b.toWarehouseId)
        throw new Error('لا يمكن التحويل لنفس المستودع');
    const out = await prisma.$transaction(async (tx) => { await updateStock(tx, req.user.orgId, b.fromWarehouseId, b.productId, -b.qty, b.unitCost, InventoryMovementType.TRANSFER_OUT, b.reference); await updateStock(tx, req.user.orgId, b.toWarehouseId, b.productId, b.qty, b.unitCost, InventoryMovementType.TRANSFER_IN, b.reference); return { ok: true }; });
    await audit(req.user.orgId, req.user.id, 'TRANSFER', 'InventoryMovement', undefined, b);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/inventory/stock-counts', auth, allow('inventory.write'), async (req, res) => { try {
    const b = z.object({ warehouseId: z.string(), notes: z.string().optional(), lines: z.array(z.object({ productId: z.string(), actualQty: z.number().nonnegative() })).min(1) }).parse(req.body);
    const out = await prisma.$transaction(async (tx) => { const count = await tx.stockCount.create({ data: { orgId: req.user.orgId, warehouseId: b.warehouseId, notes: b.notes, lines: { create: [] } } }); for (const l of b.lines) {
        const current = await tx.warehouseStock.findUnique({ where: { warehouseId_productId: { warehouseId: b.warehouseId, productId: l.productId } } });
        const expected = num(current?.qty);
        await tx.stockCountLine.create({ data: { stockCountId: count.id, productId: l.productId, expectedQty: expected, actualQty: l.actualQty } });
        const delta = money(l.actualQty - expected);
        if (Math.abs(delta) > 0.0001)
            await updateStock(tx, req.user.orgId, b.warehouseId, l.productId, delta, 0, delta > 0 ? InventoryMovementType.ADJUSTMENT_IN : InventoryMovementType.ADJUSTMENT_OUT, `COUNT-${count.id}`);
    } return tx.stockCount.update({ where: { id: count.id }, data: { status: 'POSTED' }, include: { lines: true } }); });
    await audit(req.user.orgId, req.user.id, 'CREATE', 'StockCount', out.id);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
async function createInvoice(req, b, returnMode = false) {
    const orgId = req.user.orgId;
    return prisma.$transaction(async (tx) => {
        if (!b.warehouseId) {
            const wh = await tx.warehouse.findFirst({ where: { orgId, active: true }, orderBy: { name: 'asc' } });
            if (!wh)
                throw new Error('أنشئ مستودعاً أولاً');
            b.warehouseId = wh.id;
        }
        const itemsInput = [];
        let subtotal = 0, costTotal = 0;
        for (const x of b.items) {
            const p = await tx.product.findFirst({ where: { id: x.productId, orgId } });
            if (!p)
                throw new Error('منتج غير موجود');
            const lineBase = money(num(x.qty) * num(x.unitPrice));
            const lineDiscount = money(x.discount || 0);
            const lineTax = money((lineBase - lineDiscount) * (num(x.taxRate ?? p.taxRate) / 100));
            const total = money(lineBase - lineDiscount + lineTax);
            subtotal += money(lineBase - lineDiscount);
            costTotal += money(num(x.qty) * num(p.costPrice));
            itemsInput.push({ productId: p.id, qty: num(x.qty), unitPrice: num(x.unitPrice), discount: lineDiscount, tax: lineTax, costPrice: num(p.costPrice), total });
        }
        const discount = money(b.discount || 0), tax = money(Math.max(0, (subtotal - discount) * (num(b.taxRate || 0) / 100)));
        const total = money(subtotal - discount + tax);
        const paid = money(Math.min(num(b.paidAmount || 0), total));
        const remaining = money(total - paid);
        const type = b.type;
        if (!returnMode && remaining > 0 && type === InvoiceType.SALE && !b.customerId)
            throw new Error('الفاتورة الآجلة تحتاج اختيار عميل');
        if (!returnMode && remaining > 0 && type === InvoiceType.PURCHASE && !b.supplierId)
            throw new Error('الفاتورة الآجلة تحتاج اختيار مورد');
        const prefix = returnMode ? (type === InvoiceType.SALE ? 'SR' : 'PR') : (type === InvoiceType.SALE ? 'SI' : 'PI');
        const number = b.number || `${prefix}-${Date.now()}`;
        const inv = await tx.invoice.create({ data: { orgId, branchId: b.branchId || req.user.branchId || null, warehouseId: b.warehouseId, number, type, status: remaining <= 0 ? InvoiceStatus.PAID : paid > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.POSTED, customerId: b.customerId || null, supplierId: b.supplierId || null, subtotal, discount, tax, total, paidAmount: paid, paymentMethod: b.paymentMethod || null, notes: b.notes || null, items: { create: itemsInput } } });
        const payRef = paid > 0 ? await paymentAccount(orgId, b.paymentMethod || PaymentMethod.CASH, b.cashBoxId, b.bankAccountId, tx) : null;
        const revenue = await account(orgId, returnMode ? '4010' : '4000', tx), outputTax = await account(orgId, '2200', tx), purchaseTax = await account(orgId, '1210', tx), inventory = await account(orgId, '1200', tx), cogs = await account(orgId, '5000', tx), ar = await account(orgId, '1100', tx), ap = await account(orgId, '2000', tx);
        const lines = [];
        if (type === InvoiceType.SALE) {
            const grossNet = money(subtotal - discount);
            if (returnMode) {
                const creditAccount = payRef?.accountId || ar.id;
                lines.push({ accountId: revenue.id, debit: grossNet }, { accountId: outputTax.id, debit: tax }, { accountId: creditAccount, credit: total });
                lines.push({ accountId: inventory.id, debit: costTotal }, { accountId: cogs.id, credit: costTotal });
            }
            else {
                if (paid > 0)
                    lines.push({ accountId: payRef.accountId, debit: paid });
                if (remaining > 0)
                    lines.push({ accountId: ar.id, debit: remaining });
                lines.push({ accountId: revenue.id, credit: grossNet }, { accountId: outputTax.id, credit: tax });
                lines.push({ accountId: cogs.id, debit: costTotal }, { accountId: inventory.id, credit: costTotal });
            }
        }
        else {
            const grossNet = money(subtotal - discount);
            if (returnMode) {
                const debitAccount = payRef?.accountId || ap.id;
                lines.push({ accountId: debitAccount, debit: total }, { accountId: inventory.id, credit: grossNet }, { accountId: purchaseTax.id, credit: tax });
            }
            else {
                lines.push({ accountId: inventory.id, debit: grossNet }, { accountId: purchaseTax.id, debit: tax });
                if (paid > 0)
                    lines.push({ accountId: payRef.accountId, credit: paid });
                if (remaining > 0)
                    lines.push({ accountId: ap.id, credit: remaining });
            }
        }
        await balancedJournal(tx, { orgId, branchId: inv.branchId, date: inv.issuedAt, reference: number, description: returnMode ? (type === InvoiceType.SALE ? 'مرتجع مبيعات' : 'مرتجع مشتريات') : (type === InvoiceType.SALE ? 'فاتورة مبيعات' : 'فاتورة مشتريات'), sourceType: 'INVOICE', sourceId: inv.id, lines });
        for (const it of itemsInput) {
            const delta = type === InvoiceType.SALE ? (returnMode ? it.qty : -it.qty) : (returnMode ? -it.qty : it.qty);
            const movement = returnMode ? (type === InvoiceType.SALE ? InventoryMovementType.SALE_RETURN : InventoryMovementType.PURCHASE_RETURN) : (type === InvoiceType.SALE ? InventoryMovementType.SALE : InventoryMovementType.PURCHASE);
            await updateStock(tx, orgId, b.warehouseId, it.productId, delta, it.costPrice, movement, number);
        }
        if (paid > 0 && !returnMode)
            await tx.invoicePayment.create({ data: { invoiceId: inv.id, amount: paid, method: b.paymentMethod || PaymentMethod.CASH, reference: b.paymentReference, notes: b.paymentNotes } });
        return inv;
    });
}
app.get('/api/customers', auth, allow('sales.read'), async (req, res) => res.json(await prisma.customer.findMany({ where: { orgId: req.user.orgId }, orderBy: { name: 'asc' }, take: 500 })));
app.post('/api/customers', auth, allow('customers.write', 'sales.write'), async (req, res) => { try {
    const b = z.object({ code: z.string().optional(), name: z.string().min(2), phone: z.string().optional(), email: z.string().email().optional().or(z.literal('')), address: z.string().optional(), taxNumber: z.string().optional(), creditLimit: z.number().nonnegative().optional() }).parse(req.body);
    const out = await prisma.customer.create({ data: { ...b, orgId: req.user.orgId, creditLimit: b.creditLimit || 0 } });
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/suppliers', auth, allow('purchases.read'), async (req, res) => res.json(await prisma.supplier.findMany({ where: { orgId: req.user.orgId }, orderBy: { name: 'asc' }, take: 500 })));
app.post('/api/suppliers', auth, allow('suppliers.write', 'purchases.write'), async (req, res) => { try {
    const b = z.object({ code: z.string().optional(), name: z.string().min(2), phone: z.string().optional(), email: z.string().email().optional().or(z.literal('')), address: z.string().optional(), taxNumber: z.string().optional() }).parse(req.body);
    res.json(await prisma.supplier.create({ data: { ...b, orgId: req.user.orgId } }));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/invoices', auth, async (req, res) => { const where = { orgId: req.user.orgId }; if (req.query.type)
    where.type = String(req.query.type); if (req.query.status)
    where.status = String(req.query.status); res.json(await prisma.invoice.findMany({ where, include: { customer: true, supplier: true, items: { include: { product: true } }, payments: true, warehouse: true }, orderBy: { issuedAt: 'desc' }, take: 500 })); });
app.post('/api/invoices', auth, allow('sales.write', 'purchases.write'), async (req, res) => { try {
    const b = z.object({ type: z.nativeEnum(InvoiceType), number: z.string().optional(), branchId: z.string().optional(), warehouseId: z.string().optional(), customerId: z.string().optional(), supplierId: z.string().optional(), taxRate: z.number().nonnegative().optional(), discount: z.number().nonnegative().optional(), paidAmount: z.number().nonnegative().optional(), paymentMethod: z.nativeEnum(PaymentMethod).optional(), cashBoxId: z.string().optional(), bankAccountId: z.string().optional(), notes: z.string().optional(), items: z.array(z.object({ productId: z.string(), qty: z.number().positive(), unitPrice: z.number().nonnegative(), discount: z.number().nonnegative().optional(), taxRate: z.number().nonnegative().optional() })).min(1) }).parse(req.body);
    const out = await createInvoice(req, b, false);
    await audit(req.user.orgId, req.user.id, 'CREATE', 'Invoice', out.id, { number: out.number, type: out.type, total: num(out.total) });
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/invoices/:id/returns', auth, allow('sales.write', 'purchases.write'), async (req, res) => { try {
    const original = await prisma.invoice.findFirst({ where: { id: String(req.params.id), orgId: req.user.orgId }, include: { items: true } });
    if (!original)
        throw new Error('الفاتورة غير موجودة');
    const b = { ...req.body, type: original.type, customerId: original.customerId || undefined, supplierId: original.supplierId || undefined, warehouseId: original.warehouseId || undefined, branchId: original.branchId || undefined, items: req.body.items || original.items.map(x => ({ productId: x.productId, qty: num(x.qty), unitPrice: num(x.unitPrice), discount: num(x.discount), taxRate: 0 })) };
    const out = await createInvoice(req, b, true);
    await audit(req.user.orgId, req.user.id, 'RETURN', 'Invoice', out.id, { originalId: original.id });
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/customers/:id/payments', auth, allow('cash.write', 'sales.write'), async (req, res) => { try {
    const b = z.object({ amount: z.number().positive(), method: z.nativeEnum(PaymentMethod), accountId: z.string().optional(), reference: z.string().optional(), notes: z.string().optional() }).parse(req.body);
    const out = await prisma.$transaction(async (tx) => { const c = await tx.customer.findFirst({ where: { id: String(req.params.id), orgId: req.user.orgId } }); if (!c)
        throw new Error('العميل غير موجود'); const pa = await paymentAccount(req.user.orgId, b.method, undefined, undefined, tx); await tx.customerPayment.create({ data: { orgId: req.user.orgId, customerId: c.id, amount: b.amount, method: b.method, accountId: pa.accountId, reference: b.reference, notes: b.notes } }); await balancedJournal(tx, { orgId: req.user.orgId, date: new Date(), reference: `CUST-${Date.now()}`, description: 'دفعة من العميل', lines: [{ accountId: pa.accountId, debit: b.amount }, { accountId: (await account(req.user.orgId, '1100', tx)).id, credit: b.amount }] }); return c; });
    await audit(req.user.orgId, req.user.id, 'PAYMENT', 'Customer', String(req.params.id), { amount: b.amount });
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/suppliers/:id/payments', auth, allow('cash.write', 'purchases.write'), async (req, res) => { try {
    const b = z.object({ amount: z.number().positive(), method: z.nativeEnum(PaymentMethod), reference: z.string().optional(), notes: z.string().optional() }).parse(req.body);
    const out = await prisma.$transaction(async (tx) => { const s = await tx.supplier.findFirst({ where: { id: String(req.params.id), orgId: req.user.orgId } }); if (!s)
        throw new Error('المورد غير موجود'); const pa = await paymentAccount(req.user.orgId, b.method, undefined, undefined, tx); await tx.supplierPayment.create({ data: { orgId: req.user.orgId, supplierId: s.id, amount: b.amount, method: b.method, accountId: pa.accountId, reference: b.reference, notes: b.notes } }); await balancedJournal(tx, { orgId: req.user.orgId, date: new Date(), reference: `SUP-${Date.now()}`, description: 'دفعة للمورد', lines: [{ accountId: (await account(req.user.orgId, '2000', tx)).id, debit: b.amount }, { accountId: pa.accountId, credit: b.amount }] }); return s; });
    await audit(req.user.orgId, req.user.id, 'PAYMENT', 'Supplier', String(req.params.id), { amount: b.amount });
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/cash-boxes', auth, allow('cash.read'), async (req, res) => res.json(await prisma.cashBox.findMany({ where: { orgId: req.user.orgId }, include: { branch: true, account: true, transactions: { orderBy: { date: 'desc' }, take: 50 } } })));
app.post('/api/cash-boxes', auth, allow('cash.write'), async (req, res) => { try {
    const b = z.object({ name: z.string().min(2), branchId: z.string().optional(), accountId: z.string(), openingBalance: z.number().optional() }).parse(req.body);
    res.json(await prisma.cashBox.create({ data: { ...b, orgId: req.user.orgId, openingBalance: b.openingBalance || 0 } }));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/cash-boxes/:id/transaction', auth, allow('cash.write'), async (req, res) => { try {
    const b = z.object({ type: z.nativeEnum(CashTransactionType), amount: z.number().positive(), reference: z.string().optional(), notes: z.string().optional() }).parse(req.body);
    const out = await prisma.$transaction(async (tx) => { const cb = await tx.cashBox.findFirst({ where: { id: String(req.params.id), orgId: req.user.orgId } }); if (!cb)
        throw new Error('الصندوق غير موجود'); const debitTypes = [CashTransactionType.DEPOSIT, CashTransactionType.TRANSFER_IN, CashTransactionType.RECEIPT].includes(b.type); const cashAccount = cb.accountId; const contra = (await account(req.user.orgId, '6000', tx)).id; if (debitTypes)
        await balancedJournal(tx, { orgId: req.user.orgId, date: new Date(), reference: b.reference || `CASH-${Date.now()}`, description: b.notes || 'إيداع/قبض نقدي', lines: [{ accountId: cashAccount, debit: b.amount }, { accountId: contra, credit: b.amount }] });
    else
        await balancedJournal(tx, { orgId: req.user.orgId, date: new Date(), reference: b.reference || `CASH-${Date.now()}`, description: b.notes || 'سحب/صرف نقدي', lines: [{ accountId: contra, debit: b.amount }, { accountId: cashAccount, credit: b.amount }] }); return tx.cashTransaction.create({ data: { cashBoxId: cb.id, type: b.type, amount: b.amount, reference: b.reference, notes: b.notes } }); });
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/cash-boxes/transfer', auth, allow('cash.write'), async (req, res) => { try {
    const b = z.object({ fromCashBoxId: z.string(), toCashBoxId: z.string(), amount: z.number().positive(), reference: z.string().optional() }).parse(req.body);
    if (b.fromCashBoxId === b.toCashBoxId)
        throw new Error('الصندوق المصدر والوجهة متطابقان');
    const out = await prisma.$transaction(async (tx) => { const from = await tx.cashBox.findFirst({ where: { id: b.fromCashBoxId, orgId: req.user.orgId } }), to = await tx.cashBox.findFirst({ where: { id: b.toCashBoxId, orgId: req.user.orgId } }); if (!from || !to)
        throw new Error('الصندوق غير موجود'); await balancedJournal(tx, { orgId: req.user.orgId, date: new Date(), reference: b.reference || `TRF-${Date.now()}`, description: 'تحويل بين الصناديق', lines: [{ accountId: to.accountId, debit: b.amount }, { accountId: from.accountId, credit: b.amount }] }); await tx.cashTransaction.create({ data: { cashBoxId: from.id, type: CashTransactionType.TRANSFER_OUT, amount: b.amount, reference: b.reference } }); await tx.cashTransaction.create({ data: { cashBoxId: to.id, type: CashTransactionType.TRANSFER_IN, amount: b.amount, reference: b.reference } }); return { ok: true }; });
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/banks', auth, allow('bank.read'), async (req, res) => res.json(await prisma.bankAccount.findMany({ where: { orgId: req.user.orgId }, include: { account: true, transactions: { orderBy: { date: 'desc' }, take: 100 } } })));
app.post('/api/banks', auth, allow('bank.write'), async (req, res) => { try {
    const b = z.object({ name: z.string().min(2), bankName: z.string().optional(), iban: z.string().optional(), accountId: z.string(), openingBalance: z.number().optional() }).parse(req.body);
    res.json(await prisma.bankAccount.create({ data: { ...b, orgId: req.user.orgId, openingBalance: b.openingBalance || 0 } }));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/banks/:id/import', auth, allow('bank.write'), async (req, res) => { try {
    const b = z.array(z.object({ externalId: z.string().optional(), date: z.string(), description: z.string(), amount: z.number(), direction: z.string() })).parse(req.body.rows);
    const out = await prisma.$transaction(b.map(r => prisma.bankTransaction.create({ data: { bankAccountId: String(req.params.id), externalId: r.externalId, date: new Date(r.date), description: r.description, amount: r.amount, direction: r.direction } })));
    res.json({ imported: out.length });
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/banks/:id/transaction', auth, allow('bank.write'), async (req, res) => { try {
    const b = z.object({ amount: z.number().positive(), direction: z.enum(['IN', 'OUT']), description: z.string().min(2), reference: z.string().optional() }).parse(req.body);
    const bank = await prisma.bankAccount.findFirst({ where: { id: String(req.params.id), orgId: req.user.orgId } });
    if (!bank)
        throw new Error('الحساب البنكي غير موجود');
    const contra = await account(req.user.orgId, '6000');
    await balancedJournal(prisma, { orgId: req.user.orgId, date: new Date(), reference: b.reference || `BANK-${Date.now()}`, description: b.description, lines: b.direction === 'IN' ? [{ accountId: bank.accountId, debit: b.amount }, { accountId: contra.id, credit: b.amount }] : [{ accountId: contra.id, debit: b.amount }, { accountId: bank.accountId, credit: b.amount }] });
    res.json(await prisma.bankTransaction.create({ data: { bankAccountId: bank.id, date: new Date(), description: b.description, amount: b.amount, direction: b.direction, externalId: b.reference, status: ReconciliationStatus.MATCHED, matchedAt: new Date() } }));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/banks/transactions/:id/reconcile', auth, allow('bank.write'), async (req, res) => { try {
    res.json(await prisma.bankTransaction.update({ where: { id: String(req.params.id) }, data: { status: ReconciliationStatus.MATCHED, matchedAt: new Date() } }));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.post('/api/expenses', auth, allow('accounting.write', 'cash.write'), async (req, res) => { try {
    const b = z.object({ description: z.string().min(2), amount: z.number().positive(), tax: z.number().nonnegative().optional(), accountId: z.string(), paymentMethod: z.nativeEnum(PaymentMethod) }).parse(req.body);
    const out = await prisma.$transaction(async (tx) => { const pay = await paymentAccount(req.user.orgId, b.paymentMethod, undefined, undefined, tx); const e = await tx.expense.create({ data: { orgId: req.user.orgId, description: b.description, amount: b.amount, tax: b.tax || 0, accountId: b.accountId, paymentMethod: b.paymentMethod } }); await balancedJournal(tx, { orgId: req.user.orgId, date: e.date, reference: `EXP-${e.id.slice(-8)}`, description: e.description, lines: [{ accountId: b.accountId, debit: b.amount }, { accountId: pay.accountId, credit: b.amount }] }); return e; });
    await audit(req.user.orgId, req.user.id, 'CREATE', 'Expense', out.id);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/expenses', auth, allow('accounting.read'), async (req, res) => res.json(await prisma.expense.findMany({ where: { orgId: req.user.orgId }, orderBy: { date: 'desc' }, take: 500 })));
async function trialBalance(orgId, from, to) {
    const accounts = await prisma.account.findMany({ where: { orgId }, orderBy: { code: 'asc' } });
    const journalWhere = { orgId };
    if (from || to)
        journalWhere.entryDate = {};
    if (from)
        journalWhere.entryDate.gte = from;
    if (to)
        journalWhere.entryDate.lte = to;
    const lines = await prisma.journalLine.findMany({ where: { entry: journalWhere } });
    const rows = accounts.map(a => { const debit = money(lines.filter(x => x.accountId === a.id).reduce((s, x) => s + num(x.debit), 0) + num(num(a.openingBalance) > 0 && [AccountType.ASSET, AccountType.EXPENSE].includes(a.type) ? num(a.openingBalance) : 0)); const credit = money(lines.filter(x => x.accountId === a.id).reduce((s, x) => s + num(x.credit), 0) + num(num(a.openingBalance) > 0 && [AccountType.LIABILITY, AccountType.EQUITY, AccountType.REVENUE].includes(a.type) ? num(a.openingBalance) : 0)); return { id: a.id, code: a.code, name: a.name, type: a.type, debit, credit, balance: money(debit - credit) }; });
    return { rows, totalDebit: money(rows.reduce((s, x) => s + x.debit, 0)), totalCredit: money(rows.reduce((s, x) => s + x.credit, 0)) };
}
app.get('/api/reports/trial-balance', auth, allow('reports.read'), async (req, res) => { const t = await trialBalance(req.user.orgId, req.query.from ? new Date(String(req.query.from)) : undefined, req.query.to ? new Date(String(req.query.to)) : undefined); res.json(t); });
app.get('/api/reports/general-ledger', auth, allow('reports.read'), async (req, res) => { const where = { orgId: req.user.orgId }; if (String(req.query.from) || String(req.query.to))
    where.entryDate = {}; if (req.query.from)
    where.entryDate.gte = new Date(String(req.query.from)); if (req.query.to)
    where.entryDate.lte = new Date(String(req.query.to)); if (req.query.accountId)
    where.lines = { some: { accountId: String(req.query.accountId) } }; res.json(await prisma.journalEntry.findMany({ where, include: { lines: { include: { account: true } }, period: true }, orderBy: { entryDate: 'asc' }, take: 1000 })); });
app.get('/api/reports/income', auth, allow('reports.read'), async (req, res) => { const t = await trialBalance(req.user.orgId); const revenue = t.rows.filter(x => x.type === AccountType.REVENUE); const expenses = t.rows.filter(x => x.type === AccountType.EXPENSE); res.json({ revenue, expenses, revenueTotal: money(revenue.reduce((s, x) => s - x.balance, 0)), expenseTotal: money(expenses.reduce((s, x) => s + x.balance, 0)), netProfit: money(revenue.reduce((s, x) => s - x.balance, 0) - expenses.reduce((s, x) => s + x.balance, 0)) }); });
app.get('/api/reports/balance-sheet', auth, allow('reports.read'), async (req, res) => { const t = await trialBalance(req.user.orgId); res.json({ assets: t.rows.filter(x => x.type === AccountType.ASSET), liabilities: t.rows.filter(x => x.type === AccountType.LIABILITY), equity: t.rows.filter(x => x.type === AccountType.EQUITY) }); });
app.get('/api/reports/cash-flow', auth, allow('reports.read'), async (req, res) => { const t = await trialBalance(req.user.orgId); res.json({ cash: t.rows.filter(x => ['1000', '1010'].includes(x.code)), net: money(t.rows.filter(x => ['1000', '1010'].includes(x.code)).reduce((s, x) => s + x.balance, 0)) }); });
app.get('/api/reports/sales', auth, allow('reports.read'), async (req, res) => { const items = await prisma.invoice.findMany({ where: { orgId: req.user.orgId, type: InvoiceType.SALE, status: { not: InvoiceStatus.CANCELLED } }, include: { customer: true, supplier: true, items: { include: { product: true } } }, orderBy: { issuedAt: 'desc' }, take: 1000 }); res.json({ count: items.length, total: money(items.reduce((s, x) => s + num(x.total), 0)), paid: money(items.reduce((s, x) => s + num(x.paidAmount), 0)), remaining: money(items.reduce((s, x) => s + num(x.total) - num(x.paidAmount), 0)), items }); });
app.get('/api/reports/purchases', auth, allow('reports.read'), async (req, res) => { const items = await prisma.invoice.findMany({ where: { orgId: req.user.orgId, type: InvoiceType.PURCHASE, status: { not: InvoiceStatus.CANCELLED } }, include: { customer: true, supplier: true, items: { include: { product: true } } }, orderBy: { issuedAt: 'desc' }, take: 1000 }); res.json({ count: items.length, total: money(items.reduce((s, x) => s + num(x.total), 0)), paid: money(items.reduce((s, x) => s + num(x.paidAmount), 0)), remaining: money(items.reduce((s, x) => s + num(x.total) - num(x.paidAmount), 0)), items }); });
app.get('/api/reports/inventory', auth, allow('reports.read', 'inventory.read'), async (req, res) => { const products = await prisma.product.findMany({ where: { orgId: req.user.orgId }, include: { stocks: { include: { warehouse: true } } }, orderBy: { name: 'asc' } }); res.json(products.map(p => ({ id: p.id, name: p.name, sku: p.sku, minStock: num(p.minStock), totalQty: money(p.stocks.reduce((s, x) => s + num(x.qty), 0)), value: money(p.stocks.reduce((s, x) => s + num(x.qty), 0) * num(p.costPrice)), low: p.stocks.reduce((s, x) => s + num(x.qty), 0) <= num(p.minStock), stocks: p.stocks }))); });
app.get('/api/reports/customers', auth, allow('reports.read'), async (req, res) => { const c = await prisma.customer.findMany({ where: { orgId: req.user.orgId }, include: { invoices: true, payments: true } }); res.json(c.map(x => ({ id: x.id, name: x.name, invoiced: money(x.invoices.reduce((s, i) => s + num(i.total), 0)), paid: money(x.payments.reduce((s, p) => s + num(p.amount), 0)), balance: money(x.invoices.reduce((s, i) => s + num(i.total), 0) - x.payments.reduce((s, p) => s + num(p.amount), 0)) }))); });
app.get('/api/reports/suppliers', auth, allow('reports.read'), async (req, res) => { const c = await prisma.supplier.findMany({ where: { orgId: req.user.orgId }, include: { invoices: true, payments: true } }); res.json(c.map(x => ({ id: x.id, name: x.name, invoiced: money(x.invoices.reduce((s, i) => s + num(i.total), 0)), paid: money(x.payments.reduce((s, p) => s + num(p.amount), 0)), balance: money(x.invoices.reduce((s, i) => s + num(i.total), 0) - x.payments.reduce((s, p) => s + num(p.amount), 0)) }))); });
app.get('/api/dashboard', auth, allow('reports.read'), async (req, res) => { const orgId = req.user.orgId; const from = req.query.from ? new Date(String(req.query.from)) : undefined; const to = req.query.to ? new Date(String(req.query.to)) : undefined; const issuedAt = {}; if (from)
    issuedAt.gte = from; if (to)
    issuedAt.lte = to; const dateFilter = Object.keys(issuedAt).length ? { issuedAt } : {}; const expenseDate = {}; if (from)
    expenseDate.gte = from; if (to)
    expenseDate.lte = to; const cashDate = {}; if (from)
    cashDate.gte = from; if (to)
    cashDate.lte = to; const [sales, purchases, expenses, inv] = await Promise.all([prisma.invoice.aggregate({ where: { orgId, type: InvoiceType.SALE, status: { not: InvoiceStatus.CANCELLED }, ...dateFilter }, _sum: { total: true, paidAmount: true }, _count: true }), prisma.invoice.aggregate({ where: { orgId, type: InvoiceType.PURCHASE, status: { not: InvoiceStatus.CANCELLED }, ...dateFilter }, _sum: { total: true, paidAmount: true }, _count: true }), prisma.expense.aggregate({ where: { orgId, ...(Object.keys(expenseDate).length ? { date: expenseDate } : {}) }, _sum: { amount: true } }), prisma.product.findMany({ where: { orgId }, include: { stocks: true } })]); const cash = await prisma.cashTransaction.findMany({ where: { cashBox: { orgId }, ...(Object.keys(cashDate).length ? { date: cashDate } : {}) } }); const bankRows = await prisma.bankAccount.findMany({ where: { orgId }, include: { transactions: true } }); const bankTotal = money(bankRows.reduce((sum, b) => sum + num(b.openingBalance) + b.transactions.reduce((ss, t) => ss + (t.direction === 'IN' ? num(t.amount) : -num(t.amount)), 0), 0)); const cashTotal = money(cash.reduce((s, x) => s + ([CashTransactionType.DEPOSIT, CashTransactionType.TRANSFER_IN, CashTransactionType.RECEIPT].includes(x.type) ? num(x.amount) : -num(x.amount)), 0)); const t = await trialBalance(orgId, from, to); const revenue = money(t.rows.filter(x => x.type === AccountType.REVENUE).reduce((s, x) => s - x.balance, 0)); const expense = money(t.rows.filter(x => x.type === AccountType.EXPENSE).reduce((s, x) => s + x.balance, 0)); res.json({ sales: money(num(sales._sum.total)), salesCount: sales._count, purchases: money(num(purchases._sum.total)), purchasesCount: purchases._count, expenses: money(num(expenses._sum.amount)), profit: money(revenue - expense), receivables: money(num(sales._sum.total) - num(sales._sum.paidAmount)), payables: money(num(purchases._sum.total) - num(purchases._sum.paidAmount)), inventoryValue: money(inv.reduce((s, p) => s + num(p.costPrice) * p.stocks.reduce((ss, x) => ss + num(x.qty), 0), 0)), cash: cashTotal, banks: bankTotal, balanceCheck: money(t.totalDebit - t.totalCredit), periodClosed: (await prisma.fiscalPeriod.count({ where: { orgId, status: PeriodStatus.CLOSED } })) }); });
app.get('/api/subscription', auth, allow('subscription.read', 'org.read'), async (req, res) => res.json(await prisma.subscription.findFirst({ where: { orgId: req.user.orgId }, orderBy: { endsAt: 'desc' } })));
app.post('/api/subscription', auth, allow('subscription.write'), async (req, res) => { try {
    const b = z.object({ plan: z.nativeEnum(SubscriptionPlan) }).parse(req.body);
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setMonth(endsAt.getMonth() + (b.plan === SubscriptionPlan.MONTHLY ? 1 : b.plan === SubscriptionPlan.SIX_MONTHS ? 6 : 12));
    const out = await prisma.subscription.create({ data: { orgId: req.user.orgId, plan: b.plan, startsAt, endsAt, active: true } });
    await audit(req.user.orgId, req.user.id, 'CREATE', 'Subscription', out.id, b);
    res.json(out);
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/backup/json', auth, allow('org.write'), async (req, res) => { try {
    const orgId = req.user.orgId;
    const snapshot = { version: '2.0.0', createdAt: new Date().toISOString(), organization: await prisma.organization.findUnique({ where: { id: orgId } }), branches: await prisma.branch.findMany({ where: { orgId } }), accounts: await prisma.account.findMany({ where: { orgId } }), customers: await prisma.customer.findMany({ where: { orgId } }), suppliers: await prisma.supplier.findMany({ where: { orgId } }), categories: await prisma.category.findMany({ where: { orgId } }), units: await prisma.unit.findMany({ where: { orgId } }), products: await prisma.product.findMany({ where: { orgId } }), warehouses: await prisma.warehouse.findMany({ where: { orgId } }), stocks: await prisma.warehouseStock.findMany({ where: { warehouse: { orgId } } }), movements: await prisma.inventoryMovement.findMany({ where: { orgId } }), invoices: await prisma.invoice.findMany({ where: { orgId }, include: { items: true, payments: true } }), journals: await prisma.journalEntry.findMany({ where: { orgId }, include: { lines: true } }), expenses: await prisma.expense.findMany({ where: { orgId } }), cashBoxes: await prisma.cashBox.findMany({ where: { orgId } }), cashTransactions: await prisma.cashTransaction.findMany({ where: { cashBox: { orgId } } }), bankAccounts: await prisma.bankAccount.findMany({ where: { orgId } }), bankTransactions: await prisma.bankTransaction.findMany({ where: { bankAccount: { orgId } } }), periods: await prisma.fiscalPeriod.findMany({ where: { orgId } }), auditLogs: await prisma.auditLog.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 1000 }) };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=mizanpro-backup.json');
    res.send(JSON.stringify(snapshot));
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/export/trial-balance.xlsx', auth, allow('reports.read'), async (req, res) => { const t = await trialBalance(req.user.orgId); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('ميزان المراجعة'); ws.views = [{ rightToLeft: true }]; ws.addRows([['رمز الحساب', 'الحساب', 'النوع', 'مدين', 'دائن', 'الرصيد'], ...t.rows.map(x => [x.code, x.name, x.type, x.debit, x.credit, x.balance])]); ws.getRow(1).font = { bold: true }; res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename=mizanpro-trial-balance.xlsx'); await wb.xlsx.write(res); res.end(); });
app.get('/api/export/trial-balance.pdf', auth, allow('reports.read'), async (req, res) => { const t = await trialBalance(req.user.orgId); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename=mizanpro-trial-balance.pdf'); const doc = new PDFDocument({ margin: 40 }); doc.pipe(res); doc.fontSize(20).text('MizanPro - Trial Balance'); doc.moveDown(); t.rows.forEach(x => doc.fontSize(9).text(`${x.code} | ${x.name} | ${x.debit.toFixed(2)} | ${x.credit.toFixed(2)} | ${x.balance.toFixed(2)}`)); doc.fontSize(11).text(`Total Debit: ${t.totalDebit.toFixed(2)}   Total Credit: ${t.totalCredit.toFixed(2)}`); doc.end(); });
app.get('/api/export/:kind.xlsx', auth, allow('reports.read'), async (req, res) => { try {
    const kind = String(req.params.kind);
    if (!['sales', 'purchases'].includes(kind))
        return res.status(400).json({ error: 'تقرير تصدير غير معروف' });
    const type = kind === 'sales' ? InvoiceType.SALE : InvoiceType.PURCHASE;
    const rows = await prisma.invoice.findMany({ where: { orgId: req.user.orgId, type }, orderBy: { issuedAt: 'desc' }, take: 2000 });
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(kind === 'sales' ? 'المبيعات' : 'المشتريات');
    ws.views = [{ rightToLeft: true }];
    ws.addRows([['الفاتورة', 'التاريخ', 'الإجمالي', 'المدفوع', 'المتبقي'], ...rows.map(r => [r.number, r.issuedAt.toISOString().slice(0, 10), num(r.total), num(r.paidAmount), num(r.total) - num(r.paidAmount)])]);
    ws.getRow(1).font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=mizanpro-${kind}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.get('/api/export/invoice/:id.pdf', auth, allow('sales.read', 'purchases.read'), async (req, res) => { try {
    const x = await prisma.invoice.findFirst({ where: { id: String(req.params.id), orgId: req.user.orgId }, include: { customer: true, supplier: true, items: { include: { product: true } } } });
    if (!x)
        return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${x.number}.pdf`);
    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);
    doc.fontSize(22).text('MizanPro');
    doc.fontSize(12).text(`${x.type === 'SALE' ? 'Sales Invoice' : 'Purchase Invoice'}: ${x.number}`);
    doc.text(`Date: ${x.issuedAt.toISOString().slice(0, 10)}`);
    doc.text(`Party: ${x.customer?.name || x.supplier?.name || '-'}`);
    doc.moveDown();
    for (const i of x.items)
        doc.fontSize(10).text(`${i.product.name} | Qty ${num(i.qty)} | Unit ${num(i.unitPrice).toFixed(2)} | Total ${num(i.total).toFixed(2)}`);
    doc.moveDown();
    doc.fontSize(13).text(`Subtotal: ${num(x.subtotal).toFixed(2)} | Tax: ${num(x.tax).toFixed(2)} | Total: ${num(x.total).toFixed(2)}`);
    doc.end();
}
catch (e) {
    res.status(400).json({ error: e.message });
} });
app.use((err, _req, res, _next) => res.status(400).json({ error: err?.issues?.[0]?.message || err?.message || 'خطأ غير متوقع' }));
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`MizanPro V2 API listening on ${port}`));
