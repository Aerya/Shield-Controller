# Shield Controller

<p align="center">
  <img src="assets/branding/shield-controller-logo.png" alt="Shield Controller" width="180">
</p>

Gérez votre **NVIDIA Shield / Android TV** depuis un navigateur. Auto-hébergé avec Docker.

[English](README.md) · [Projet d’origine](https://github.com/bilbospocketses/ws-scrcpy-web)

## Fonctions

- Aperçu de l’écran et télécommande : pavé directionnel, clavier et saisie de texte
- Informations détaillées : Android, matériel, RAM, stockage, réseau et affichage
- Installation d’APK par glisser-déposer, progression du transfert et erreurs Android
- Liste des applications avec recherche, filtres utilisateur/système/désactivées et confirmation de désinstallation
- Reconnexion automatique des appareils mémorisés au démarrage
- Explorateur de fichiers, transferts et terminal ADB
- Interface FR/EN, panneaux d’outils à droite de l’appareil
- Captures d’écran PNG avec aperçu et téléchargement, y compris en HTTP sur le LAN
- Détection automatique des IP publiques et DNS IPv4/IPv6 avec nom du fournisseur, test d’un domaine et DNS privé Android
- Suivi CPU, RAM, stockage, températures disponibles, accueil déclaré par Android et application au premier plan (actualisation facultative toutes les 5 secondes).

## Captures d’écran

| | |
| --- | --- |
| **Télécommande et collage de texte**<br>[![Télécommande et collage de texte](assets/screenshots/remote-control.png)](assets/screenshots/remote-control.png) | **Accueil et découverte réseau**<br>[![Accueil et découverte réseau](assets/screenshots/overview.png)](assets/screenshots/overview.png) |
| **Terminal ADB**<br>[![Terminal ADB](assets/screenshots/terminal.png)](assets/screenshots/terminal.png) | **Explorateur de fichiers**<br>[![Explorateur de fichiers](assets/screenshots/files.png)](assets/screenshots/files.png) |
| **IP publiques et DNS IPv4/IPv6**<br>[![IP publiques et DNS IPv4/IPv6](assets/screenshots/dns.png)](assets/screenshots/dns.png) | **Applications et installation d’APK**<br>[![Applications et installation d’APK](assets/screenshots/applications.png)](assets/screenshots/applications.png) |
| **Configuration du flux**<br>[![Configuration du flux](assets/screenshots/stream-settings.png)](assets/screenshots/stream-settings.png) | **Capture d’écran avec aperçu**<br>[![Capture d’écran avec aperçu](assets/screenshots/screenshot.png)](assets/screenshots/screenshot.png) |

## Docker

Sur **Linux amd64**, ajoutez cette stack dans Dockge ou lancez `docker compose up -d` :

```yaml
services:
  shield-controller:
    image: ghcr.io/aerya/shield-controller:latest
    restart: unless-stopped
    ports:
      - "8123:8000"
    environment:
      WS_SCRCPY_ALLOW_REMOTE_ADMIN: "1"
    volumes:
      - ./data:/data
```

Ouvrez **http://IP_DU_SERVEUR:8123** sur votre LAN. **Voir / Piloter** fonctionne en HTTP : aperçu par images actualisées, télécommande, collage et saisie de texte. Le flux vidéo continu hérité nécessite un contexte sécurisé du navigateur. La variable ci-dessus donne les droits d’administration à toute personne pouvant accéder au service ; l’authentification se configure dans Paramètres → Utilisateurs.

Compilation locale : `docker build -t shield-controller:local .`

## Connecter la Shield

1. Activez les options développeur : **Paramètres → Préférences de l’appareil → À propos → appuyez 7 fois sur Build**.
2. Activez le **débogage réseau** et relevez l’adresse IP de la Shield.
3. Ajoutez `IP_SHIELD:5555` dans la WebUI et acceptez l’autorisation sur la télévision.
4. Ouvrez **Informations** ou **Applications / APK** sur la carte de l’appareil.

Ethernet et Wi-Fi fonctionnent. Aucune redirection de port sur la box n’est nécessaire.

## Piloter et coller du texte

Ouvrez **Voir / Piloter**, sélectionnez le champ sur la TV avec la télécommande, collez votre URL/identifiant dans la zone de texte, puis cliquez sur **Coller sur la Shield**. Si l’application refuse, essayez **Saisir directement** (300 octets maximum, caractères non latins limités). Le texte n’est pas conservé par Shield Controller ; le collage utilise le presse-papiers Android. L’aperçu est actualisé environ toutes les 1,5 secondes plus le temps de capture, sans audio.

## À savoir

Fichiers `.apk` simples uniquement, **512 Mio maximum chacun** ; les bundles (`.apks`, `.xapk`) ne sont pas pris en charge. L’installation met à jour les applications existantes si Android l’autorise. La désinstallation concerne **l’utilisateur Android 0** ; retirer une application système peut perturber la TV. Les applications sont affichées par leur identifiant de paquet. Certaines informations nécessitent le root. Les vidéos protégées peuvent rester noires dans le miroir d’écran.

## DNS

Le nom du service DNS connu ou de l’opérateur réseau (RIPEstat) accompagne chaque IP ; une identification indisponible ne bloque pas le résultat.

Sans serveur personnalisé, le test s’exécute sur la Shield. Avec une IP DNS IPv4/IPv6, il s’exécute depuis le serveur Shield Controller. Le DNS privé utilise un **nom d’hôte de fournisseur** (DNS-over-TLS). Sur la Shield Android 11 sans root, les DNS Ethernet se changent dans les paramètres réseau de la TV ou du DHCP, pas par ADB.

À l’ouverture du panneau DNS, la détection automatique des IP publiques et résolveurs interroge [IPleak.net](https://ipleak.net/) depuis la Shield. Elle affiche les résolveurs récursifs observés, sans lire AdGuard Home ni lister les serveurs racine. Un VPN par application peut emprunter un autre chemin.

## Crédits et licence

Basé sur **[bilbospocketses/ws-scrcpy-web](https://github.com/bilbospocketses/ws-scrcpy-web)**, avec des ajouts de gestion des appareils par Aerya. Le miroir d’écran utilise **[Genymobile/scrcpy](https://github.com/Genymobile/scrcpy)**.

**GPL-3.0-only** — voir [LICENSE](LICENSE). Les mentions de copyright d’origine sont conservées.
