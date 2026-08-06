# RouteMaster

PWA-приложение курьера: сканирование накладных, проверка/коррекция адресов, ручная нумерация точек на карте, навигация и отслеживание прогресса тура.

Стек: чистый HTML/CSS/JS (без сборки), [Leaflet.js](https://leafletjs.com/) + OpenStreetMap, [Tesseract.js](https://tesseract.projectnaptha.com/) для OCR, [Nominatim](https://nominatim.org/) для геокодинга, localStorage для автосохранения, Service Worker + manifest.json для установки как PWA.

## Локальный запуск

Нужен любой статический HTTP-сервер (не `file://`, иначе не сработают fetch/service worker):

```bash
npx serve .
# или
python -m http.server 8080
```

Откройте `http://localhost:8080` в браузере (лучше на телефоне — приложение mobile-first).

## Ветки и деплой

- `main` — продакшн. Пуш в `main` автоматически запускает `.github/workflows/deploy.yml` и деплоит статику на **GitHub Pages**.
- `dev` — ветка для разработки. Все изменения сначала сюда, затем через Pull Request в `main`, когда готовы к публикации.

### Настройка после создания репозитория на GitHub

1. Создайте пустой репозиторий на GitHub (без README/gitignore — они уже есть локально).
2. Подключите remote и запушьте обе ветки:
   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   git push -u origin dev
   ```
3. В настройках репозитория: **Settings → Pages → Source → GitHub Actions**. Дальше каждый пуш в `main` будет автоматически деплоить сайт.
4. Установите `dev` как ветку по умолчанию для повседневной работы (**Settings → Branches**), если хотите, чтобы `main` трогался только осознанно через PR.

## Структура

```
index.html          — единственная точка входа, все экраны — <template>
css/styles.css       — вся стилизация (dark mode, mobile-first)
js/
  utils.js           — общие хелперы (toast, haversine, long-press)
  storage.js         — localStorage персистентность тура
  geocode.js         — геокодинг через Nominatim
  ocr.js             — Tesseract.js + разбор строк адресов
  testdata.js        — генератор 30 тестовых точек
  ui-home.js          — экран 1: главный
  ui-scan.js          — экран 2: сканирование и авто-проверка
  ui-validate.js       — экран 3: валидация и ручная коррекция
  ui-build.js          — экран 4: сборка тура (нумерация на карте)
  ui-active.js         — экран 5: активный тур (карта/список, bottom sheet, статусы)
  router.js / app.js   — роутинг экранов и общий стейт
manifest.json / sw.js — PWA манифест и офлайн-кэш
icons/               — иконки приложения
```
