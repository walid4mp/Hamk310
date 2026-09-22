import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class Api {
  Api._();
  static final instance = Api._();
  static const String base = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:4000/api');

  Future<Map<String, String>> _headers() async {
    final p = await SharedPreferences.getInstance();
    final token = p.getString('token');
    return {'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'};
  }

  Future<dynamic> get(String path) async {
    final r = await http.get(Uri.parse('$base$path'), headers: await _headers());
    return _decode(r);
  }
  Future<dynamic> post(String path, Map<String,dynamic> body) async {
    final r = await http.post(Uri.parse('$base$path'), headers: await _headers(), body: jsonEncode(body));
    return _decode(r);
  }
  Future<dynamic> put(String path, Map<String,dynamic> body) async {
    final r = await http.put(Uri.parse('$base$path'), headers: await _headers(), body: jsonEncode(body));
    return _decode(r);
  }
  dynamic _decode(http.Response r) {
    dynamic data;
    try { data = jsonDecode(r.body); } catch (_) { data = r.body; }
    if (r.statusCode >= 400) throw Exception(data is Map ? (data['error'] ?? 'حدث خطأ') : 'حدث خطأ');
    return data;
  }
  Future<void> saveToken(String token) async => (await SharedPreferences.getInstance()).setString('token', token);
  Future<bool> hasToken() async => (await SharedPreferences.getInstance()).getString('token') != null;
  Future<void> logout() async => (await SharedPreferences.getInstance()).remove('token');
  Future<String?> token() async => (await SharedPreferences.getInstance()).getString('token');
  Future<String> exportUrl(String path) async { final t=await token(); return '$base$path?token=${Uri.encodeQueryComponent(t ?? '')}'; }
}
