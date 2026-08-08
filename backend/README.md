# RouteMaster API

Node + Express + SQLite backend: профили, туры, база клиентов.

## Запуск
Нужны env: `PORT`, `DB_PATH`, `JWT_SECRET` (см. `.env`, не в git).
```
npm install
node server.js
```
Docker: см. `Dockerfile`. На сервере — сервис `routemaster-api` в docker-compose, nginx проксирует `/api/`.
