import 'package:flutter/material.dart';
import '../services/api.dart';
import 'home.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController(text: 'admin@mizanpro.local');
  final pass = TextEditingController(text: 'MizanPro@123');
  final name = TextEditingController(text: 'مدير الحسابات');
  final org = TextEditingController(text: 'شركتي');
  bool loading = false;
  bool register = false;

  Future<void> submit() async {
    setState(() => loading = true);
    try {
      final data = register
          ? await Api.instance.post('/auth/register', {'name': name.text, 'email': email.text, 'password': pass.text, 'organization': org.text})
          : await Api.instance.post('/auth/login', {'email': email.text, 'password': pass.text});
      await Api.instance.saveToken(data['token']);
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const HomeScreen()));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Card(
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Center(child: Container(width: 68, height: 68, decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary, borderRadius: BorderRadius.circular(22)), child: const Icon(Icons.account_balance_wallet_rounded, color: Colors.white, size: 34))),
                    const SizedBox(height: 18),
                    const Center(child: Text('ميزان برو', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 28))),
                    const SizedBox(height: 6),
                    const Center(child: Text('نظام محاسبة وإدارة أعمال سحابي', style: TextStyle(color: Colors.black54))),
                    const SizedBox(height: 28),
                    if (register) ...[
                      TextField(controller: name, textDirection: TextDirection.rtl, decoration: const InputDecoration(labelText: 'الاسم', border: OutlineInputBorder())),
                      const SizedBox(height: 12),
                      TextField(controller: org, textDirection: TextDirection.rtl, decoration: const InputDecoration(labelText: 'اسم الشركة', border: OutlineInputBorder())),
                      const SizedBox(height: 12),
                    ],
                    TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'البريد الإلكتروني', border: OutlineInputBorder())),
                    const SizedBox(height: 12),
                    TextField(controller: pass, obscureText: true, decoration: const InputDecoration(labelText: 'كلمة المرور', border: OutlineInputBorder())),
                    const SizedBox(height: 20),
                    SizedBox(width: double.infinity, height: 52, child: FilledButton(onPressed: loading ? null : submit, child: loading ? const CircularProgressIndicator() : Text(register ? 'إنشاء الحساب' : 'دخول'))),
                    const SizedBox(height: 12),
                    Center(child: TextButton(onPressed: () => setState(() => register = !register), child: Text(register ? 'لدي حساب بالفعل' : 'إنشاء حساب جديد'))),
                    if (!register) const Center(child: Text('تجريبي: admin@mizanpro.local / MizanPro@123', style: TextStyle(fontSize: 11, color: Colors.black45))),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
