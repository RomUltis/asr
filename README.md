# 🪐 Orbit — cartes mentales collaboratives

Orbit sert à **répartir les tâches d'un projet de groupe** sur une carte mentale.

- On crée un compte avec juste un **pseudo** et un **mot de passe** (pas d'email).
- On crée une **carte** (un projet). Au centre, le nom du projet ; autour, les **membres en orbite**.
- On y ajoute des **dossiers** (cartes blanches reliées au centre), qu'on déplace librement.
- Un clic sur un dossier le **retourne en 3D** et l'ouvre en plein écran : c'est un **tableau façon Trello**
  avec une colonne par personne (+ « À répartir »). On coche les tâches terminées, on les glisse d'une
  personne à l'autre.
- On **invite** des gens par leur **pseudo** : ils reçoivent une notification sur la **cloche 🔔** en haut à
  droite et peuvent **accepter ou refuser**.
- Onglet **Besoins** : une **toile 3D** façon constellation. Le projet au centre, ses **besoins** autour
  comme des étoiles, et pour chacun ce qu'il faut **mettre en place** et ses **contraintes**. Un clic sur
  une étoile fait **plonger** la caméra dedans : sa propre toile se déploie, et ainsi de suite.
- Tous les membres peuvent modifier la carte, et tout se met à jour **en direct** chez tout le monde.

---

## ✨ Fonctionnalités

| | |
|---|---|
| **Comptes** | Inscription pseudo + mot de passe (avec confirmation), vérification du pseudo en direct, profil (pseudo, couleur, mot de passe). Pas d'email, donc pas de récupération de mot de passe |
| **Cartes** | Création, renommage, suppression (créateur), quitter une carte (membres) |
| **Carte mentale** | Pan (glisser), zoom (molette / pincement / boutons), double-clic pour créer un dossier, dossiers déplaçables, liens animés |
| **Membres** | Avatars en orbite autour du projet, point vert = en ligne. Survoler/cliquer un membre surligne ses dossiers et trace des liens vers eux |
| **Dossiers** | Couleur, progression, avatars des personnes impliquées, menu (renommer, couleur, supprimer) |
| **Tableau** | Colonnes par personne, ajout rapide (Entrée), glisser-déposer (souris et tactile), coche animée, échéances (en rouge si dépassées), description, masquer les terminées, confettis quand un dossier est fini 🎉 |
| **Toile des besoins (3D)** | Moteur 3D maison sur canvas, organisé en **roues par niveau** : le projet au centre, roue 1 = ce qui dépend directement du projet, roue 2 = ce qui dépend de la roue 1, etc. Chaque branche garde sa part de roue. À la création on choisit **« Dépend de »** : l'élément se place tout seul sur la bonne roue, au bon niveau, et on peut le **relier à d'autres branches** à n'importe quel niveau (arcs pointillés). Survoler une étoile éclaire toute sa branche. Clic = plongée dans l'élément (ses roues se déploient, les éléments liés d'autres branches sont sur une roue « Relié depuis ailleurs »). 3 types : **besoin**, **à mettre en place**, **contrainte** ; validation, responsable, description, fil d'Ariane avec les niveaux, `Échap` pour remonter, compteur « x/y besoins validés » |
| **Invitations** | Recherche par pseudo avec suggestions, invitations en attente annulables, cloche avec badge |
| **Temps réel** | Server-Sent Events : modifications, déplacements, présence en ligne, invitations |
| **Raccourcis** | `N` nouveau dossier / nouvel élément · `F` tout afficher · `+`/`-` zoom · `Échap` fermer / remonter |
| **Responsive** | Utilisable sur mobile (colonnes en défilement horizontal, appui long pour déplacer une tâche) |

## 🏗️ Architecture

Même principe que le projet d'exemple : **un seul serveur Node.js, zéro framework**, qui sert l'API et le front.

```
orbit/
├── server.js              # serveur HTTP : API + fichiers statiques + fallback SPA
├── schema.sql             # schéma MySQL/MariaDB (à importer dans phpMyAdmin)
├── .env.example           # configuration à copier en .env
├── lib/
│   ├── config.js          # lecture du .env
│   ├── db.js              # double moteur : SQLite (local) / MySQL (VPS)
│   ├── security.js        # scrypt, sessions, cookies signés, en-têtes, limitation de débit
│   ├── http.js / router.js / helpers.js
│   ├── realtime.js        # temps réel (SSE)
│   └── routes/            # auth, maps, invitations, board (dossiers + tâches), needs (toile), events
├── public/                # front HTML / CSS / JS (modules ES, sans dépendance)
│   ├── index.html
│   ├── css/ (style.css, web.css)
│   └── js/ (app, api, ui, realtime, components/, views/ dont web.js = moteur 3D)
└── deploy/                # exemples Nginx, Apache, systemd
```

## 🔒 Sécurité

- Mots de passe hachés avec **scrypt** + sel, comparaison en temps constant.
- Sessions en base, cookie **HttpOnly**, **signé** (HMAC), `SameSite=Lax`, `Secure` en HTTPS.
- Protection **CSRF** (en-tête personnalisé obligatoire sur toute requête qui modifie).
- **Limitation de débit** sur connexion / inscription / invitations.
- En-têtes de sécurité (CSP stricte, `X-Frame-Options`, `nosniff`…).
- Chaque requête vérifie que l'utilisateur est bien **membre** de la carte concernée.
- Requêtes SQL **paramétrées** partout ; tout le texte est inséré via `textContent` (pas d'injection HTML).

---

## 🚀 Lancer en local

Node.js **22.5 ou plus** (pour SQLite intégré) :

```bash
cp .env.example .env      # puis mettez un SESSION_SECRET
node server.js
```

Ouvrez http://localhost:56200 — la base est un fichier `data/orbit.db` créé automatiquement.

---

## 🌍 Déploiement sur le VPS (MySQL + phpMyAdmin + reverse proxy)

### 1. Base de données (phpMyAdmin)

Dans l'onglet **SQL** de phpMyAdmin :

```sql
CREATE DATABASE orbit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'orbit_user'@'localhost' IDENTIFIED BY 'un_mot_de_passe_solide';
GRANT ALL PRIVILEGES ON orbit.* TO 'orbit_user'@'localhost';
FLUSH PRIVILEGES;
```

Puis sélectionnez la base `orbit` → onglet **Importer** → `schema.sql`.
(Facultatif : si l'utilisateur a le droit `CREATE`, le serveur crée les tables tout seul au 1er démarrage.)

### 2. Copier le projet et installer

```bash
# sur le VPS, par exemple dans /var/www/orbit
cd /var/www/orbit
npm install            # installe mysql2 (seule dépendance, pour MySQL)
cp .env.example .env
nano .env
```

Dans `.env` :

```env
PORT=56200
HOST=127.0.0.1                 # accessible uniquement via le reverse proxy
SESSION_SECRET=...             # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
SECURE_COOKIES=true            # si le site est en HTTPS
DB_DRIVER=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=orbit_user
DB_PASSWORD=un_mot_de_passe_solide
DB_NAME=orbit
```

Test rapide : `node server.js` → vous devez voir `✓ MySQL/MariaDB` puis `Orbit pret : http://127.0.0.1:56200`.

### 3. Lancer en service (redémarrage automatique)

**Avec systemd** (fichier fourni) :

```bash
sudo cp deploy/orbit.service /etc/systemd/system/   # adaptez User / WorkingDirectory
sudo systemctl daemon-reload
sudo systemctl enable --now orbit
journalctl -u orbit -f                               # logs
```

**Ou avec pm2** : `pm2 start server.js --name orbit && pm2 save`

### 4. Reverse proxy

Exemples prêts à l'emploi dans `deploy/` :

- **Nginx** : `deploy/nginx-orbit.conf`
- **Apache** : `deploy/apache-orbit.conf`

⚠️ Point important : la route **`/api/events`** est un flux temps réel (SSE). Elle doit avoir le
**buffering désactivé** et un **délai long**, sinon les mises à jour en direct arrivent en retard ou pas du
tout. Les exemples fournis le font déjà (le serveur envoie aussi `X-Accel-Buffering: no` pour Nginx).

HTTPS avec Let's Encrypt : `sudo certbot --nginx -d orbit.mondomaine.fr` (ou `--apache`), puis
`SECURE_COOKIES=true` dans `.env` et redémarrez le service.

### 5. Mise à jour

```bash
cd /var/www/orbit && git pull   # ou recopiez les fichiers
sudo systemctl restart orbit
```

---

## 🗄️ Tables

| Table | Rôle |
|---|---|
| `users` | comptes (pseudo, couleur, mot de passe haché) |
| `sessions` | sessions de connexion |
| `maps` | cartes mentales (projets) |
| `map_members` | qui fait partie de quelle carte (`owner` / `member`) |
| `invitations` | invitations (`pending`, `accepted`, `declined`, `cancelled`) |
| `folders` | dossiers d'une carte (titre, couleur, position x/y) |
| `tasks` | tâches d'un dossier (responsable, terminée, ordre, échéance, description) |
| `nodes` | éléments de la toile des besoins (type `besoin` / `solution` / `contrainte`, parent, validé, responsable) |
| `node_links` | liens transverses entre deux éléments de la toile |

> **Mise à jour d'une base existante** : au démarrage, le serveur crée les tables manquantes et retire
> automatiquement l'ancienne colonne `email` des comptes. Rien à faire à la main (si l'utilisateur MySQL
> a les droits `CREATE` et `ALTER` ; sinon, réimportez `schema.sql` sur une base vide).
