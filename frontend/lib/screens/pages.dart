import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api.dart';
import '../widgets/metric_card.dart';
import '../widgets/section_card.dart';

String money(dynamic n) => '${(double.tryParse(n.toString()) ?? 0).toStringAsFixed(2)} دج';
double d(dynamic n) => double.tryParse(n.toString()) ?? 0;

class Busy extends StatelessWidget { final bool value; const Busy(this.value, {super.key}); @override Widget build(BuildContext context) => value ? const LinearProgressIndicator(minHeight: 2) : const SizedBox(height: 2); }

class PageShell extends StatelessWidget {
  final String title, subtitle; final Widget child; final Widget? action;
  const PageShell({super.key, required this.title, required this.subtitle, required this.child, this.action});
  @override Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(22), children: [
    Row(children: [Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)), const SizedBox(height: 4), Text(subtitle, style: const TextStyle(color: Colors.black54))])), if (action != null) action!]),
    const SizedBox(height: 18), child,
  ]);
}

Future<void> showForm(BuildContext context, {required String title, required List<Widget> fields, required VoidCallback onSave}) async {
  await showDialog(context: context, builder: (_) => AlertDialog(title: Text(title), content: SizedBox(width: 520, child: SingleChildScrollView(child: Column(children: fields))), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('إلغاء')), FilledButton(onPressed: onSave, child: const Text('حفظ'))]));
}

class DashboardPage extends StatefulWidget { const DashboardPage({super.key}); @override State<DashboardPage> createState() => _DashboardState(); }
class _DashboardState extends State<DashboardPage> {
  Map<String,dynamic> data = {}; bool loading = true; String range = 'ALL';
  @override void initState() { super.initState(); load(); }
  Future<void> load() async { try { final now=DateTime.now(); var q=''; if(range=='MONTH') q='?from=${DateTime(now.year,now.month,1).toIso8601String()}'; if(range=='YEAR') q='?from=${DateTime(now.year,1,1).toIso8601String()}'; data=Map<String,dynamic>.from(await Api.instance.get('/dashboard$q')); } catch(e) { _snack(e); } if(mounted) setState(()=>loading=false); }
  void _snack(Object e)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ',''))));
  @override Widget build(BuildContext context) { final m=data; final cards=[['المبيعات',m['sales'],Icons.trending_up],['المشتريات',m['purchases'],Icons.shopping_cart],['المصروفات',m['expenses'],Icons.receipt_long],['صافي الربح',m['profit'],Icons.show_chart],['العملاء المدينون',m['receivables'],Icons.people],['الموردون الدائنون',m['payables'],Icons.local_shipping],['قيمة المخزون',m['inventoryValue'],Icons.inventory_2],['الصندوق',m['cash'],Icons.account_balance_wallet],['البنوك',m['banks'],Icons.account_balance]]; return PageShell(title:'لوحة التحكم',subtitle:'نظرة موحدة على الأداء المالي والتشغيلي',action:IconButton(onPressed:load,icon:const Icon(Icons.refresh)),child: Column(children:[Busy(loading), Wrap(spacing:14,runSpacing:14,children:[for(final x in cards) SizedBox(width:245,child:MetricCard(title:x[0] as String,value:money(x[1]),icon:x[2] as IconData))]), const SizedBox(height:18), SectionCard(title:'الفترة',child:DropdownButton<String>(value:range,items:const [DropdownMenuItem(value:'ALL',child:Text('كل الفترة')),DropdownMenuItem(value:'MONTH',child:Text('هذا الشهر')),DropdownMenuItem(value:'YEAR',child:Text('هذه السنة'))],onChanged:(v){if(v!=null){setState(()=>range=v);load();}})), SectionCard(title:'سلامة القيود',child:ListTile(leading:Icon(d(m['balanceCheck']).abs()<.01?Icons.verified:Icons.warning,color:d(m['balanceCheck']).abs()<.01?Colors.green:Colors.orange),title:Text(d(m['balanceCheck']).abs()<.01?'القيود متوازنة':'يوجد فرق يحتاج مراجعة'),trailing:Text('فترات مقفلة: ${m['periodClosed']??0}')))])); }
}

abstract class InvoicePageBase extends StatefulWidget {
  const InvoicePageBase({super.key});
  String get type;
}

class SalesPage extends InvoicePageBase {
  const SalesPage({super.key});
  @override String get type => 'SALE';
  @override State<SalesPage> createState() => _SalesState();
}

class PurchasesPage extends InvoicePageBase {
  const PurchasesPage({super.key});
  @override String get type => 'PURCHASE';
  @override State<PurchasesPage> createState() => _PurchasesState();
}

mixin InvoiceStateMixin<T extends InvoicePageBase> on State<T> {
  List invoices = [], products = [], partners = [];
  bool loading = true;

  Future<void> loadInvoices() async {
    try {
      final a = await Future.wait([
        Api.instance.get('/invoices?type=${widget.type}'),
        Api.instance.get('/products'),
        widget.type == 'SALE' ? Api.instance.get('/customers') : Api.instance.get('/suppliers'),
      ]);
      if (mounted) setState(() { invoices = a[0]; products = a[1]; partners = a[2]; loading = false; });
    } catch (e) { if (mounted) { setState(() => loading = false); _snack(e); } }
  }

  void _snack(Object e) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));

  Future<void> addInvoice() async {
    if (products.isEmpty || partners.isEmpty) { _snack('أضف المنتجات والعملاء أو الموردين أولاً'); return; }
    final amount = TextEditingController();
    final qty = TextEditingController(text: '1');
    final partner = partners.first['id'];
    final product = products.first['id'];
    String payment = 'CASH';
    await showForm(
      context,
      title: widget.type == 'SALE' ? 'فاتورة بيع' : 'فاتورة شراء',
      fields: [
        TextField(controller: qty, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'الكمية')),
        TextField(controller: amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'السعر')),
        DropdownButtonFormField<String>(value: payment, items: const [
          DropdownMenuItem(value: 'CASH', child: Text('نقدي')),
          DropdownMenuItem(value: 'CREDIT', child: Text('آجل')),
        ], onChanged: (v) { payment = v ?? 'CASH'; }),
      ],
      onSave: () async {
        Navigator.pop(context);
        try {
          await Api.instance.post('/invoices', {
            'type': widget.type,
            'partnerId': partner,
            'paymentMethod': payment,
            'items': [{'productId': product, 'quantity': d(qty.text), 'unitPrice': d(amount.text)}],
          });
          await loadInvoices();
        } catch (e) { _snack(e); }
      },
    );
  }

  Widget invoiceView() => PageShell(
    title: widget.type == 'SALE' ? 'المبيعات' : 'المشتريات',
    subtitle: 'فواتير، مرتجعات، دفعات وذمم',
    action: FilledButton.icon(onPressed: addInvoice, icon: const Icon(Icons.add), label: Text(widget.type == 'SALE' ? 'فاتورة بيع' : 'فاتورة شراء')),
    child: SectionCard(title: 'الفواتير', child: Column(children: [
      Busy(loading),
      for (final x in invoices) ListTile(title: Text('${x['number'] ?? '-'} • ${widget.type == 'SALE' ? 'بيع' : 'شراء'}'), subtitle: Text('${x['issuedAt'] ?? ''}'), trailing: Text(money(x['total']))),
    ])),
  );
}

class _SalesState extends State<SalesPage> with InvoiceStateMixin<SalesPage> {
  @override void initState() { super.initState(); loadInvoices(); }
  @override Widget build(BuildContext context) => invoiceView();
}

class _PurchasesState extends State<PurchasesPage> with InvoiceStateMixin<PurchasesPage> {
  @override void initState() { super.initState(); loadInvoices(); }
  @override Widget build(BuildContext context) => invoiceView();
}

class InventoryPage extends StatefulWidget { const InventoryPage({super.key}); @override State<InventoryPage> createState()=>_InventoryState(); }
class _InventoryState extends State<InventoryPage>{List products=[],warehouses=[];bool loading=true;@override void initState(){super.initState();load();}Future<void> load()async{try{final a=await Future.wait([Api.instance.get('/products'),Api.instance.get('/warehouses')]);setState((){products=a[0];warehouses=a[1];loading=false;});}catch(e){_snack(e);}}void _snack(Object e)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));Future<void> addProduct()async{final n=TextEditingController(),sku=TextEditingController(),price=TextEditingController();await showForm(context,title:'منتج جديد',fields:[TextField(controller:n,decoration:const InputDecoration(labelText:'اسم المنتج')),TextField(controller:sku,decoration:const InputDecoration(labelText:'SKU')),TextField(controller:price,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'سعر البيع'))],onSave:()async{Navigator.pop(context);try{await Api.instance.post('/products',{'name':n.text,'sku':sku.text,'salePrice':d(price.text),'purchasePrice':0,'minStock':0,'unitId':null,'categoryId':null});load();}catch(e){_snack(e);}});} @override Widget build(BuildContext c)=>PageShell(title:'المخزون',subtitle:'المنتجات، المستودعات، الباركود، الجرد والتحويلات',action:FilledButton.icon(onPressed:addProduct,icon:const Icon(Icons.add),label:const Text('منتج')),child:SectionCard(title:'المخزون الحالي',child:Column(children:[Busy(loading),for(final p in products)ListTile(title:Text(p['name']??'-',style:const TextStyle(fontWeight:FontWeight.w800)),subtitle:Text('${p['sku']??''} • ${p['barcode']??'بدون باركود'}'),trailing:Text('${(p['stocks'] as List? ?? []).fold<double>(0,(s,x)=>s+d(x['qty']))}'))])));}

class AccountingPage extends StatefulWidget { const AccountingPage({super.key}); @override State<AccountingPage> createState()=>_AccountingState(); }
class _AccountingState extends State<AccountingPage>{List accounts=[],periods=[],journals=[];bool loading=true;@override void initState(){super.initState();load();}Future<void> load()async{try{final a=await Future.wait([Api.instance.get('/accounts'),Api.instance.get('/fiscal-periods'),Api.instance.get('/journals')]);setState((){accounts=a[0];periods=a[1];journals=a[2];loading=false;});}catch(e){_snack(e);}}void _snack(Object e)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));@override Widget build(BuildContext c)=>PageShell(title:'المحاسبة',subtitle:'شجرة الحسابات، القيود، الأستاذ والفترات',child:Column(children:[Busy(loading),SectionCard(title:'شجرة الحسابات',child:Column(children:[for(final a in accounts)ListTile(title:Text('${a['code']} • ${a['name']}'),subtitle:Text(a['type']??''))])),SectionCard(title:'آخر القيود',child:Column(children:[for(final j in journals.take(50))ListTile(title:Text('${j['reference']??''} • ${j['description']??''}'),subtitle:Text('${j['entryDate']??''}'))])),SectionCard(title:'الفترات المحاسبية',child:Column(children:[for(final p in periods)ListTile(title:Text(p['name']??''),subtitle:Text('${p['startDate']??''} → ${p['endDate']??''}'),trailing:Text(p['status']??''))]))]));}

class _PartnerPage extends StatefulWidget{final bool customers;const _PartnerPage({super.key,required this.customers});@override State<_PartnerPage> createState()=>_PartnerState();}
class _PartnerState extends State<_PartnerPage>{List list=[];@override void initState(){super.initState();load();}Future<void> load()async{list=await Api.instance.get(widget.customers?'/customers':'/suppliers');if(mounted)setState((){});}Future<void> add()async{final n=TextEditingController();await showForm(context,title:widget.customers?'عميل جديد':'مورد جديد',fields:[TextField(controller:n,decoration:const InputDecoration(labelText:'الاسم'))],onSave:()async{Navigator.pop(context);await Api.instance.post(widget.customers?'/customers':'/suppliers',{'name':n.text});load();});}@override Widget build(BuildContext c)=>PageShell(title:widget.customers?'العملاء':'الموردون',subtitle:'إدارة الذمم والبيانات الأساسية',action:FilledButton.icon(onPressed:add,icon:const Icon(Icons.add),label:Text(widget.customers?'عميل':'مورد')),child:SectionCard(title:widget.customers?'العملاء':'الموردون',child:Column(children:[for(final x in list)ListTile(title:Text(x['name']??'-'),subtitle:Text(x['phone']??'بدون هاتف'))])));}
class CustomersPage extends StatelessWidget{const CustomersPage({super.key});@override Widget build(BuildContext c)=>const _PartnerPage(customers:true);}
class SuppliersPage extends StatelessWidget{const SuppliersPage({super.key});@override Widget build(BuildContext c)=>const _PartnerPage(customers:false);}

class CashBankPage extends StatefulWidget{const CashBankPage({super.key});@override State<CashBankPage> createState()=>_CashBankState();}
class _CashBankState extends State<CashBankPage>{List cash=[],banks=[];@override void initState(){super.initState();load();}Future<void> load()async{final a=await Future.wait([Api.instance.get('/cash-boxes'),Api.instance.get('/banks')]);setState((){cash=a[0];banks=a[1];});}@override Widget build(BuildContext c)=>PageShell(title:'الصندوق والبنوك',subtitle:'صناديق متعددة، حسابات بنكية، إيداع وسحب وتحويل ومطابقة',child:Column(children:[SectionCard(title:'الصناديق',child:Column(children:[for(final x in cash)ListTile(title:Text(x['name']??'-'),trailing:Text(money(x['openingBalance'])))])),SectionCard(title:'البنوك',child:Column(children:[for(final x in banks)ListTile(title:Text(x['name']??'-'),subtitle:Text(x['bankName']??''),trailing:Text(x['iban']??''))]))]));}

class ExpensesPage extends StatefulWidget{const ExpensesPage({super.key});@override State<ExpensesPage> createState()=>_ExpensesState();}
class _ExpensesState extends State<ExpensesPage>{List expenses=[];@override void initState(){super.initState();load();}Future<void> load()async{expenses=await Api.instance.get('/expenses');setState((){});}Future<void> add()async{final desc=TextEditingController(),amount=TextEditingController();await showForm(context,title:'مصروف جديد',fields:[TextField(controller:desc,decoration:const InputDecoration(labelText:'البيان')),TextField(controller:amount,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'المبلغ'))],onSave:()async{Navigator.pop(context);await Api.instance.post('/expenses',{'description':desc.text,'amount':d(amount.text),'paymentMethod':'CASH'});load();});}@override Widget build(BuildContext c)=>PageShell(title:'المصروفات',subtitle:'تسجيل ومتابعة المصروفات',action:FilledButton.icon(onPressed:add,icon:const Icon(Icons.add),label:const Text('مصروف')),child:SectionCard(title:'المصروفات',child:Column(children:[for(final x in expenses)ListTile(title:Text(x['description']??''),trailing:Text(money(x['amount'])))])));}

class ReportsPage extends StatefulWidget {
  const ReportsPage({super.key});
  @override State<ReportsPage> createState() => _ReportsState();
}

class _ReportsState extends State<ReportsPage> {
  String report = 'income';
  dynamic data;
  bool loading = false;
  final options = const {
    'income': 'قائمة الدخل', 'balance-sheet': 'الميزانية العمومية',
    'trial-balance': 'ميزان المراجعة', 'general-ledger': 'دفتر الأستاذ',
    'sales': 'المبيعات', 'purchases': 'المشتريات', 'inventory': 'المخزون',
    'customers': 'العملاء', 'suppliers': 'الموردون', 'cash-flow': 'التدفقات النقدية',
  };

  Future<void> run() async {
    setState(() => loading = true);
    try { data = await Api.instance.get('/reports/$report'); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    if (mounted) setState(() => loading = false);
  }

  @override Widget build(BuildContext c) => PageShell(
    title: 'التقارير', subtitle: 'تقارير مالية وتشغيلية شاملة',
    action: FilledButton.icon(onPressed: run, icon: const Icon(Icons.play_arrow), label: const Text('تشغيل')),
    child: Column(children: [
      SectionCard(title: 'نوع التقرير', child: DropdownButton<String>(
        value: report, isExpanded: true,
        items: [for (final e in options.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
        onChanged: (v) { if (v != null) setState(() { report = v; data = null; }); },
      )),
      Busy(loading),
      if (data != null) _body() else const SectionCard(title: 'التقارير', child: Text('اختر التقرير ثم اضغط تشغيل')),
    ]),
  );

  Widget _body() {
    final x = data;
    if (report == 'income' && x is Map) return SectionCard(title: 'قائمة الدخل', child: Text('الإيرادات ${money(x['revenueTotal'])} • المصروفات ${money(x['expenseTotal'])} • صافي الربح ${money(x['netProfit'])}'));
    if (report == 'balance-sheet' && x is Map) return SectionCard(title: 'الميزانية العمومية', child: Column(children: [
      Text('الأصول: ${money((x['assets'] as List?)?.fold<double>(0, (s, r) => s + d(r['balance'])) ?? 0)}'),
      Text('الخصوم: ${money((x['liabilities'] as List?)?.fold<double>(0, (s, r) => s + d(r['balance'])) ?? 0)}'),
      Text('حقوق الملكية: ${money((x['equity'] as List?)?.fold<double>(0, (s, r) => s + d(r['balance'])) ?? 0)}'),
    ]));
    if (x is List) return SectionCard(title: options[report] ?? report, child: Column(children: [for (final r in x.take(100)) ListTile(title: Text(r['name']?.toString() ?? r['reference']?.toString() ?? '-'), trailing: Text(money(r['balance'] ?? r['total'] ?? 0)))]));
    if (x is Map && x['items'] is List) return SectionCard(title: options[report] ?? report, child: Column(children: [for (final r in (x['items'] as List).take(100)) ListTile(title: Text(r['number']?.toString() ?? '-'), trailing: Text(money(r['total'])))]));
    return SectionCard(title: options[report] ?? report, child: Text(x.toString()));
  }
}

class OrganizationPage extends StatefulWidget{const OrganizationPage({super.key});@override State<OrganizationPage> createState()=>_OrgState();}
class _OrgState extends State<OrganizationPage>{Map<String,dynamic> org={};List branches=[],members=[],logs=[];@override void initState(){super.initState();load();}Future<void> load()async{final a=await Future.wait([Api.instance.get('/organization'),Api.instance.get('/branches'),Api.instance.get('/members'),Api.instance.get('/audit-logs')]);setState((){org=Map<String,dynamic>.from(a[0]);branches=a[1];members=a[2];logs=a[3];});}Future<void> edit()async{final n=TextEditingController(text:org['name']??''),p=TextEditingController(text:org['phone']??''),t=TextEditingController(text:org['taxNumber']??'');await showForm(context,title:'بيانات الشركة',fields:[TextField(controller:n,decoration:const InputDecoration(labelText:'اسم الشركة')),TextField(controller:p,decoration:const InputDecoration(labelText:'الهاتف')),TextField(controller:t,decoration:const InputDecoration(labelText:'الرقم الجبائي'))],onSave:()async{Navigator.pop(context);await Api.instance.put('/organization',{'name':n.text,'phone':p.text,'taxNumber':t.text});load();});}@override Widget build(BuildContext c)=>PageShell(title:'المؤسسة والحساب',subtitle:'الشركة، الفروع، المستخدمون، الصلاحيات وسجل العمليات',action:OutlinedButton.icon(onPressed:edit,icon:const Icon(Icons.edit),label:const Text('تعديل')),child:Column(children:[SectionCard(title:'بيانات الشركة',child:ListTile(title:Text(org['name']??'-',style:const TextStyle(fontWeight:FontWeight.w900,fontSize:22)),subtitle:Text('هاتف: ${org['phone']??'-'} • ضريبة: ${org['taxNumber']??'-'}'))),SectionCard(title:'الفروع',child:Column(children:[for(final b in branches)ListTile(title:Text('${b['code']??''} • ${b['name']??''}'),trailing:Text(b['active']==true?'نشط':'متوقف'))])),SectionCard(title:'المستخدمون والصلاحيات',child:Column(children:[for(final m in members)ListTile(title:Text(m['user']?['name']?.toString()??'-'),subtitle:Text(m['user']?['email']?.toString()??''),trailing:Text(m['role']??''))])),SectionCard(title:'سجل العمليات',child:Column(children:[for(final l in logs.take(50))ListTile(title:Text('${l['action']??''} • ${l['entity']??''}'),subtitle:Text(l['createdAt']?.toString()??''))]))]));}

class SubscriptionPage extends StatefulWidget{const SubscriptionPage({super.key});@override State<SubscriptionPage> createState()=>_SubscriptionState();}
class _SubscriptionState extends State<SubscriptionPage>{Map<String,dynamic>? sub;@override void initState(){super.initState();load();}Future<void> load()async{try{sub=Map<String,dynamic>.from(await Api.instance.get('/subscription'));}catch(_){sub=null;}setState((){});}Future<void> choose(String plan)async{await Api.instance.post('/subscription',{'plan':plan});load();}@override Widget build(BuildContext c)=>PageShell(title:'الاشتراك',subtitle:'شهري، 6 أشهر، سنوي',child:Column(children:[SectionCard(title:'الحالة',child:Text(sub==null?'لا يوجد اشتراك':sub.toString())),Wrap(spacing:12,children:[for(final p in ['MONTHLY','SIX_MONTHS','ANNUAL'])FilledButton(onPressed:()=>choose(p),child:Text(p=='MONTHLY'?'شهري':p=='SIX_MONTHS'?'6 أشهر':'سنوي'))]) ]));}
