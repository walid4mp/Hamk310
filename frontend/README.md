# MizanPro Flutter

Set the API URL at build time:

```bash
flutter pub get
flutter run --dart-define=API_URL=https://YOUR-RENDER-SERVICE.onrender.com/api
```

For Android AAB, use the included GitHub Actions workflow and create repository secret `API_URL`.
