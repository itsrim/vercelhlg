# Nel — Backend chat API

Serveur **Node.js + TypeScript** : **Fastify** (HTTP) + **Socket.IO** (temps réel).  
Auth JWT, messages en mémoire, notifications **Web Push**.

Le frontend React est à la racine du repo : [`../README.md`](../README.md).

---

## Stack

| Package | Rôle |
|---------|------|
| **Fastify 5** | Routes REST |
| **@fastify/cors** | CORS pour le frontend (gh-pages, localhost) |
| **Socket.IO 4** | Chat live |
| **jose** | JWT (login / socket) |
| **web-push** | Notifications hors ligne |

Stockage : **mémoire uniquement** (pas de Redis). Les messages sont perdus au redémarrage du process.

---

## Prérequis

- Node.js 18+

---

## Démarrage

```bash
cd backend
npm install
npm run dev
```

API par défaut : **http://localhost:3000**

Production :

```bash
npm run build
npm start
```

Vérification :

```bash
curl http://localhost:3000/api/health
```

Réponse attendue :

```json
{
  "ok": true,
  "service": "hlg-chat-api",
  "storage": "memory",
  "realtime": "socket.io",
  "push": false,
  "timestamp": 1710000000000
}
```

---

## Structure

```
backend/
├── src/
│   ├── server.ts           # Point d’entrée Fastify + Socket.IO
│   ├── routes/
│   │   ├── auth.ts         # login, signup, me
│   │   ├── chat.ts         # REST messages
│   │   └── push.ts         # abonnements Web Push
│   ├── socket/
│   │   └── chatSocket.ts   # Événements temps réel
│   └── lib/
│       ├── authStore.ts    # Utilisateurs + JWT
│       ├── chatStore.ts    # Messages en RAM
│       ├── memberStore.ts  # Membres par conversation (push/sync)
│       ├── pushStore.ts    # Subscriptions push
│       ├── pushService.ts  # Envoi web-push
│       ├── config.ts       # Port, CORS
│       └── types.ts
├── scripts/
│   └── generate-vapid.ts   # Génère les clés VAPID
└── package.json
```

---

## Variables d’environnement

Créer un fichier `.env` à la racine de `backend/` (non versionné) ou les définir sur l’hébergeur.

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port d’écoute |
| `JWT_SECRET` | `hlg-dev-secret-…` | **À changer en production** |
| `ALLOWED_ORIGINS` | — | Origines CORS supplémentaires, séparées par des virgules |
| `VAPID_PUBLIC_KEY` | — | Web Push (public) |
| `VAPID_PRIVATE_KEY` | — | Web Push (privé) |
| `VAPID_SUBJECT` | `mailto:hello@hlg.app` | Contact VAPID |
| `MAILJET_API_KEY` | — | Clé API [Mailjet](https://www.mailjet.com) |
| `MAILJET_API_SECRET` | — | Secret API Mailjet |
| `EMAIL_FROM` | `Happy Let's GO <noreply@happyletsgo.fr>` | Expéditeur (domaine validé dans Mailjet) |
| `APP_PUBLIC_URL` | `https://happyletsgo.fr` (prod) / `http://localhost:5173` (dev) | URL frontend pour le lien « Vérifier mon email » |

Origines CORS autorisées par défaut :

- `http://localhost:5173`
- `http://localhost:3000`
- `https://happyletsgo.fr`
- `https://www.happyletsgo.fr`

Générer les clés VAPID :

```bash
npm run vapid
```

Recopier `VITE_VAPID_PUBLIC_KEY` côté frontend (fichier `.env` à la racine du repo).

---

## Authentification

### Comptes démo (pré-créés)

| Email | Mot de passe | ID |
|-------|--------------|-----|
| `demo@hlg.com` | `password` | `user_demo_001` |
| `rim` | `1234` | `user_admin_001` |

### REST

#### `POST /api/auth/login`

```json
{ "email": "demo@hlg.com", "password": "password" }
```

Réponse `200` :

```json
{
  "user": { "id": "user_demo_001", "email": "demo@hlg.com", "displayName": "Utilisateur Demo" },
  "token": "<JWT>"
}
```

#### `POST /api/auth/signup`

```json
{ "email": "nouveau@exemple.com", "password": "secret12", "displayName": "Marie" }
```

Réponse `201` (vérification email requise) :

```json
{
  "pendingVerification": true,
  "email": "nouveau@exemple.com",
  "message": "Un email de vérification a été envoyé…"
}
```

Aucun JWT tant que l’email n’est pas confirmé.

#### `GET /api/auth/verify-email?token=<token>`

Réponse `200` après clic sur le lien reçu par email :

```json
{
  "ok": true,
  "user": { "id": "…", "email": "…", "displayName": "…", "emailVerified": true },
  "token": "<JWT>"
}
```

#### `POST /api/auth/resend-verification`

```json
{ "email": "nouveau@exemple.com" }
```

Renvoie l’email si le compte existe et n’est pas encore vérifié.

#### `POST /api/auth/login`

Refuse (`403`) si l’email n’a pas été vérifié.

#### `GET /api/auth/me`

Header : `Authorization: Bearer <JWT>`

Réponse : `{ "user": { … } }`

### Socket.IO

À la connexion, le client doit envoyer :

```js
io(API_URL, { auth: { token: "<JWT>" } });
```

Sans token valide → connexion refusée (`Unauthorized`).

L’**auteur** des messages est toujours dérivé du JWT (pas de spoofing via `authorName` côté client).

---

## API REST — Chat

Toutes les routes chat exigent `Authorization: Bearer <JWT>`.

### `GET /api/chat/:conversationId`

Liste les messages d’un fil.

| Query | Description |
|-------|-------------|
| `since` | Timestamp (ms) — ne renvoie que les messages plus récents |

Exemple :

```http
GET /api/chat/conv_sortie_01?since=1710000000000
Authorization: Bearer <token>
```

Réponse :

```json
{
  "conversationId": "conv_sortie_01",
  "messages": [
    {
      "id": "m_abc",
      "conversationId": "conv_sortie_01",
      "authorId": "user_demo_001",
      "authorName": "Utilisateur Demo",
      "text": "Salut",
      "sentAt": 1710000001000
    }
  ]
}
```

### `POST /api/chat/:conversationId`

Corps :

```json
{
  "text": "Mon message",
  "id": "optionhlg",
  "sentAt": 1710000000000
}
```

Réponse `201` : `{ "message": { … } }`

Envoie aussi une **Web Push** aux autres membres de la conversation (si VAPID configuré).

---

## Socket.IO

Connexion : même host que `VITE_CHAT_API_URL`.

### Client → serveur

| Événement | Payload | Description |
|-----------|---------|-------------|
| `user:sync` | `{ conversationIds: string[] }` | Enregistre l’utilisateur dans toutes ses conversations + rejoint les rooms |
| `conversation:join` | `{ conversationId }` | Rejoint une room + reçoit `message:history` |
| `conversation:leave` | `{ conversationId }` | Quitte la room |
| `message:send` | `{ conversationId, text, id?, sentAt? }` | Envoie un message |

### Serveur → client

| Événement | Payload |
|-----------|---------|
| `message:history` | `{ conversationId, messages[] }` |
| `message:new` | `{ message }` |
| `chat:error` | `{ error: string }` |

Room Socket : `conversation:<conversationId>`

---

## Web Push

### `POST /api/push/subscribe`

Header : `Authorization: Bearer <JWT>`

Corps (format standard Push API) :

```json
{
  "endpoint": "https://…",
  "expirationTime": null,
  "keys": { "p256dh": "…", "auth": "…" }
}
```

### `DELETE /api/push/unsubscribe`

Même auth. Corps optionhlg : `{ "endpoint": "…" }`

À chaque nouveau message, le serveur notifie les **membres** de la conversation (sauf l’auteur) ayant une subscription enregistrée.

---

## Rétention des messages

**7 jours** (aligné avec le frontend `chatPersistence.ts`). Les messages plus anciens sont ignorés à l’écriture et au filtrage.

---

## Déploiement sur Render (recommandé)

Voir **`backend/render.yaml`** et les étapes détaillées ci-dessous.

### Créer le Web Service

1. [render.com](https://render.com) → **New** → **Web Service** → repo Git
2. **Root Directory** : `backend`
3. **Build** : `npm install && npm run build`
4. **Start** : `npm start`
5. **Health Check** : `/api/health`

### Variables Render (Environment)

`JWT_SECRET`, `APP_PUBLIC_URL=https://happyletsgo.fr`, `ALLOWED_ORIGINS`, `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `EMAIL_FROM`

### Frontend

```env
VITE_CHAT_API_URL=https://hlg-api.onrender.com
```

`yarn build` → upload `dist/` sur OVH (pas de proxy API dans `.htaccess`).

---

## Déploiement (autres hébergeurs)

Hébergeurs adaptés : **Fly.io**, **Railway**, VPS, etc.

| Étape | Commande / config |
|-------|-------------------|
| Build | `npm install && npm run build` |
| Start | `npm start` |
| Port | Variable `PORT` fournie par l’hébergeur |
| Secrets | `JWT_SECRET`, `VAPID_*`, `ALLOWED_ORIGINS` |
---

## Configuration frontend

Dans le `.env` à la **racine** du monorepo :

```env
VITE_CHAT_API_URL=http://localhost:3000
VITE_VAPID_PUBLIC_KEY=<clé publique générée par npm run vapid>
```

Fichiers frontend liés :

| Fichier | Rôle |
|---------|------|
| `src/lib/authApi.ts` | Login / signup / token |
| `src/lib/chatSocket.ts` | Connexion Socket.IO |
| `src/lib/chatSync.ts` | Sync globale + unread |
| `src/App.tsx` | Init sync au login |

---

## Scripts npm

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev avec rechargement (`tsx watch`) |
| `npm run build` | Compile → `dist/` |
| `npm start` | Lance `dist/server.js` |
| `npm run typecheck` | Vérification TypeScript |
| `npm run vapid` | Génère paire de clés VAPID |

---

## Limitations connues

| Sujet | Détail |
|-------|--------|
| Persistance | Mémoire RAM — redémarrage = perte des messages serveur |
| Multi-instance | Pas de partage entre plusieurs pods sans store externe |
| Auth | Utilisateurs en mémoire (hors compte démo, créés au signup jusqu’au restart) |
| Membres conversation | Enregistrés via `user:sync` / `join` — nécessaire pour cibler les push |

---

## Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| `401` sur chat | JWT absent ou expiré |
| Socket `Unauthorized` | Token non passé dans `auth.token` |
| `push: false` dans health | Clés VAPID non définies |
| CORS | Ajouter l’origine frontend dans `ALLOWED_ORIGINS` |
| Messages vides après reboot | Normal — stockage mémoire |

---

## Licence

Projet privé Nel.
