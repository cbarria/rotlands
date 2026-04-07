# Rotlands — MVP 2D multiplayer RPG (Phaser + Socket.IO)

## Run (Docker)

```bash
docker compose up --build
```

Open **http://localhost:3000** in two browser tabs to see multiple players.

### Maps

- **Town** (safe): no combat; pickup **bread**; use the **glowing portal** tile on the east side to enter the dungeon.
- **Dungeon**: combat vs **rat**; **coin** pickup; **portal** in the north-west returns to town.

### Controls

- **Arrow keys**: move (server-validated tiles)
- **Space**: attack adjacent enemy (only in the dungeon)
- **E**: pick up adjacent item (persists to PostgreSQL inventory)

## Stack

- Client: Phaser 3 (Vite build, served as static files from Node)
- Server: Node.js + Express + Socket.IO (authoritative tick + combat)
- PostgreSQL: characters + inventory
- Redis: connected health check (ready for Socket.IO adapter later)

## Optional art swap-ins (CC0)

Placeholder rectangles are used by default. Replace with **Kenney** 16×16 packs: [ASSETS.md](ASSETS.md).

## Deploy (Railway)

Railpack no detecta bien este monorepo. El build real es el **Dockerfile** en la raíz (`railway.toml` / `railway.json` lo fijan).

En Railway: **Root directory** = vacío (no `server` ni `client`). Si igual ves **Railpack** en los logs, en **Settings → Build** cambiá el builder a **Dockerfile** manualmente. Variables típicas: `DATABASE_URL`, `REDIS_URL`, `PORT`.

## Local dev (without Docker)

Terminal 1: `cd server && npm install && set DATABASE_URL=postgres://... && node src/index.js`  
Terminal 2: `cd client && npm install && npm run dev` (proxy targets port 3000 for API)
