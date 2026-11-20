# Hublot

Transformez un téléphone en caméra en direct et en passerelle de fichiers vers un ordinateur, avec un code à 6 chiffres et sans rien installer.

- **Caméra** : le téléphone filme, l'ordinateur affiche en plein écran (idéal pour projeter au tableau).
- **Fichiers** : envoi de photos et documents du téléphone vers l'ordinateur.
- **Technique** : un serveur Node.js (WebSocket) assure l'appairage. La vidéo et les fichiers passent en pair à pair avec WebRTC.

## Démarrer dans GitHub Codespaces

1. Dans le terminal du Codespace :
   ```bash
   npm install
   npm start
   ```
2. Rendez le port public, sinon le téléphone sera redirigé vers la page de connexion GitHub :
   ```bash
   gh codespace ports visibility 3000:public -c $CODESPACE_NAME
   ```
   Vous pouvez aussi faire un clic droit sur le port 3000 dans l'onglet **Ports**, puis **Visibilité du port** > **Public**.
3. Ouvrez l'adresse HTTPS du port 3000 (`https://…-3000.app.github.dev`) sur l'ordinateur.
4. Sur le téléphone, scannez le QR code ou ouvrez la même adresse suivie de `/p`, puis saisissez le code.

Codespaces fournit déjà le HTTPS : aucun tunnel supplémentaire n'est nécessaire.

## Démarrer en local

```bash
npm install
npm start
```

Le navigateur du téléphone exige HTTPS pour la caméra. En local, utilisez un tunnel, par exemple :

```bash
cloudflared tunnel --url http://localhost:3000
```

## Réseaux difficiles (4G, Wi-Fi d'école)

Le STUN public suffit sur un même réseau. Entre deux réseaux différents, ajoutez un serveur TURN avant de lancer :

```bash
TURN_URL=turn:exemple.org:3478 TURN_USER=utilisateur TURN_PASS=secret npm start
```

`TURN_URL` accepte plusieurs adresses séparées par des virgules.

## Fonctionnement

| Élément | Rôle |
| --- | --- |
| `server.js` | Appairage par code (usage unique, 5 minutes, 8 essais ratés par minute et par IP) et relais de la signalisation |
| `public/index.html` | Écran de l'ordinateur : code, QR code, vidéo, commandes, fichiers reçus |
| `public/phone.html` | Page du téléphone : saisie du code, caméra, envoi de fichiers |
| `public/hublot.css` | Styles communs |

## Pistes

- Son du téléphone (micro)
- Zoom et mise au point depuis l'ordinateur
- Plusieurs téléphones pour un même écran
- Envoi de fichiers de l'ordinateur vers le téléphone

## Licence

MIT, voir [LICENSE](LICENSE).
