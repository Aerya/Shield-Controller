# Shield Controller

Gérez votre **NVIDIA Shield / Android TV** depuis un navigateur. Auto-hébergé avec Docker.

[English](README.md) · [Projet d’origine](https://github.com/bilbospocketses/ws-scrcpy-web)

## Fonctions

- Écran en direct et télécommande : pavé directionnel, clavier et souris.
- Informations détaillées : Android, matériel, RAM, stockage, réseau et affichage.
- Installation d’APK par glisser-déposer, progression du transfert et erreurs Android.
- Liste des applications avec recherche, filtres utilisateur/système/désactivées et confirmation de désinstallation.
- Explorateur de fichiers, transferts et terminal ADB hérités de ws-scrcpy-web.

## Docker

Sur **Linux amd64**, ajoutez cette stack dans Dockge ou lancez `docker compose up -d` :

```yaml
services:
  shield-controller:
    image: ghcr.io/aerya/shield-controller:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8123:8000"
    environment:
      WS_SCRCPY_ALLOW_REMOTE_ADMIN: "1"
    volumes:
      - ./data:/data
```

Ouvrez **http://localhost:8123** sur la machine Docker. Depuis un autre appareil, configurez un reverse proxy HTTPS et une authentification. La variable ci-dessus donne les droits d’administration à toute personne pouvant accéder au service.

Compilation locale : `docker build -t shield-controller:local .`

## Connecter la Shield

1. Activez les options développeur : **Paramètres → Préférences de l’appareil → À propos → appuyez 7 fois sur Build**.
2. Activez le **débogage réseau** et relevez l’adresse IP de la Shield.
3. Ajoutez `IP_SHIELD:5555` dans la WebUI et acceptez l’autorisation sur la télévision.
4. Ouvrez **device info** ou **applications / APK** sur la carte de l’appareil.

Ethernet et Wi-Fi fonctionnent. Aucune redirection de port sur la box n’est nécessaire.

## À savoir

Fichiers `.apk` simples uniquement, **512 Mio maximum chacun** ; les bundles (`.apks`, `.xapk`) ne sont pas pris en charge. L’installation met à jour les applications existantes si Android l’autorise. La désinstallation concerne **l’utilisateur Android 0** ; retirer une application système peut perturber la TV. Les applications sont affichées par leur identifiant de paquet. Certaines informations nécessitent le root. Les vidéos protégées peuvent rester noires dans le miroir d’écran.

## Crédits et licence

Basé sur **[bilbospocketses/ws-scrcpy-web](https://github.com/bilbospocketses/ws-scrcpy-web)**, avec des ajouts de gestion des appareils par Aerya. Le miroir d’écran utilise **[Genymobile/scrcpy](https://github.com/Genymobile/scrcpy)**.

**GPL-3.0-only** — voir [LICENSE](LICENSE). Les mentions de copyright d’origine sont conservées.
