import 'package:flutter/material.dart';
import 'screens/login.dart';
import 'screens/home.dart';
import 'services/api.dart';

void main() => runApp(const MizanProApp());

class MizanProApp extends StatelessWidget {
  const MizanProApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MizanPro', debugShowCheckedModeBanner: false, locale: const Locale('ar'),
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF146EF5), scaffoldBackgroundColor: const Color(0xFFF5F7FB), inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder(), filled: true, fillColor: Colors.white)),
      builder: (context, child) => Directionality(textDirection: TextDirection.rtl, child: child ?? const SizedBox()),
      home: FutureBuilder<bool>(future: Api.instance.hasToken(), builder: (context, s) => s.data == true ? const HomeScreen() : const LoginScreen()),
    );
  }
}
