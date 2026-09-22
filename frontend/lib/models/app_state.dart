import 'package:flutter/material.dart';

class AppState extends ChangeNotifier {
  Map<String,dynamic>? me;
  void setMe(Map<String,dynamic> value){me=value;notifyListeners();}
}
final appState = AppState();
