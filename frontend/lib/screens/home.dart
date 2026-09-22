import 'package:flutter/material.dart';
import '../services/api.dart';
import 'login.dart';
import 'pages.dart';

class HomeScreen extends StatefulWidget { const HomeScreen({super.key}); @override State<HomeScreen> createState()=>_HomeScreenState(); }
class _HomeScreenState extends State<HomeScreen> {
  int index=0;
  final pages=<Widget>[
    const DashboardPage(), const SalesPage(), const PurchasesPage(), const InventoryPage(), const AccountingPage(), const CustomersPage(), const SuppliersPage(), const CashBankPage(), const ExpensesPage(), const ReportsPage(), const OrganizationPage(), const SubscriptionPage()
  ];
  final titles=<String>['لوحة التحكم','المبيعات','المشتريات','المخزون','المحاسبة','العملاء','الموردون','الصندوق والبنوك','المصروفات','التقارير','المؤسسة والإعدادات','الاشتراك'];
  @override Widget build(BuildContext context) {
    final wide=MediaQuery.sizeOf(context).width>=900;
    return Scaffold(
      body: Row(children:[
        if(wide) Container(width:240,color:Colors.white,child:_sideBar(context)),
        Expanded(child:Column(children:[
          Container(height:72,color:Colors.white,padding:const EdgeInsets.symmetric(horizontal:22),child:Row(children:[
            if(!wide) Builder(builder:(ctx)=>IconButton(onPressed:()=>Scaffold.of(ctx).openDrawer(),icon:const Icon(Icons.menu))),
            CircleAvatar(radius:18,backgroundColor:Theme.of(context).colorScheme.primary,child:const Icon(Icons.account_balance_wallet_rounded,color:Colors.white,size:20)),const SizedBox(width:10),Text('MizanPro',style:const TextStyle(fontWeight:FontWeight.w900,fontSize:20)),const SizedBox(width:24),Expanded(child:Text(titles[index],style:const TextStyle(fontSize:18,fontWeight:FontWeight.w800))),
            IconButton(tooltip:'تحديث',onPressed:()=>setState((){}),icon:const Icon(Icons.refresh_rounded)),
            IconButton(tooltip:'خروج',onPressed:()async{await Api.instance.logout();if(context.mounted)Navigator.pushReplacement(context,MaterialPageRoute(builder:(_)=>const LoginScreen()));},icon:const Icon(Icons.logout_rounded))
          ])),
          Expanded(child:pages[index]),
        ]))
      ]),
      drawer: wide?null:Drawer(child:_sideBar(context)),
    );
  }
  Widget _sideBar(BuildContext context)=>SafeArea(child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
    Padding(padding:const EdgeInsets.fromLTRB(20,20,20,12),child:Row(children:[CircleAvatar(radius:22,backgroundColor:Theme.of(context).colorScheme.primary,child:const Icon(Icons.account_balance_wallet_rounded,color:Colors.white)),const SizedBox(width:10),const Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('MizanPro',style:TextStyle(fontWeight:FontWeight.w900,fontSize:18)),Text('نظام إدارة ومحاسبة',style:TextStyle(fontSize:11,color:Colors.black54))])] )),
    const Divider(height:1),
    Expanded(child:ListView.builder(itemCount:titles.length,itemBuilder:(c,i)=>ListTile(selected:index==i,shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(14)),leading:Icon(_icons[i]),title:Text(titles[i],style:const TextStyle(fontWeight:FontWeight.w600)),onTap:(){setState(()=>index=i);if(MediaQuery.sizeOf(context).width<900)Navigator.pop(context);},))),
    const Padding(padding:EdgeInsets.all(16),child:Text('V2 • محاسبة • مخزون • فروع • صلاحيات',style:TextStyle(color:Colors.black38,fontSize:11)))
  ]));
  static const _icons=[Icons.dashboard_rounded,Icons.point_of_sale_rounded,Icons.shopping_cart_checkout_rounded,Icons.inventory_2_rounded,Icons.account_tree_rounded,Icons.people_alt_rounded,Icons.local_shipping_rounded,Icons.account_balance_wallet_rounded,Icons.receipt_long_rounded,Icons.analytics_rounded,Icons.business_rounded,Icons.workspace_premium_rounded];
}
