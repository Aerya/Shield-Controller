# Shield Controller

<p align="center">
  <img src="assets/branding/shield-controller-logo.png" alt="Shield Controller" width="180">
</p>

Gérez votre **NVIDIA Shield / Android TV** depuis un navigateur. Auto-hébergé avec Docker.

[English](README.md) · [Projet d’origine](https://github.com/bilbospocketses/ws-scrcpy-web)

### Sécurité TLS — octobre 2026

Mise à jour des certificats et des composants TLS des images après l’incident eMudhra. Les contrôles couvrent les chaînes compromises, dont les deux cas « No CT », et une connexion HTTPS valide. Une image déjà en cours d’exécution reste inchangée : son remplacement doit être planifié après validation.

[Détails de l’incident](https://emudhra.we-have-a-problem.com/) · [TLS checks](security/emudhra/README.md)

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
- Réglages HDMI-CEC, fréquence d’images, appui long, animations, son surround, densité d’affichage et launcher par défaut, avec restauration de l’origine
- Nettoyage recommandé à valider, réactivation groupée et instantanés pour revenir en arrière ou copier une configuration
- Suivi CPU, RAM, stockage, températures disponibles, accueil déclaré par Android et application au premier plan (actualisation facultative toutes les 5 secondes).

## Captures d’écran

| | |
| --- | --- |
| **Télécommande et collage de texte**<br>[![Télécommande et collage de texte](assets/screenshots/remote-control.png)](assets/screenshots/remote-control.png) | **Accueil et découverte réseau**<br>[![Accueil et découverte réseau](assets/screenshots/overview.png)](assets/screenshots/overview.png) |
| **Terminal ADB**<br>[![Terminal ADB](assets/screenshots/terminal.png)](assets/screenshots/terminal.png) | **Explorateur de fichiers**<br>[![Explorateur de fichiers](assets/screenshots/files.png)](assets/screenshots/files.png) |
| **IP publiques et DNS IPv4/IPv6**<br>[![IP publiques et DNS IPv4/IPv6](assets/screenshots/dns.png)](assets/screenshots/dns.png) | **Applications et installation d’APK**<br>[![Applications et installation d’APK](assets/screenshots/applications.png)](assets/screenshots/applications.png) |
| **Configuration du flux**<br>[![Configuration du flux](assets/screenshots/stream-settings.png)](assets/screenshots/stream-settings.png) | **Capture d’écran avec aperçu**<br>[![Capture d’écran avec aperçu](assets/screenshots/screenshot.png)](assets/screenshots/screenshot.png) |

## Optimisation

Le panneau s’ouvre sur **Optimisation courante** : télémétrie, diagnostic, Plex, applications utilisateur et applications désactivées ou protégées. **Avancé — toutes les applications** donne accès à l’inventaire complet, sans retirer aucune option. Des filtres dédiés affichent aussi les composants système, les applications utilisateur et les protections. Si le statut système est inconnu, l’application reste visible dans la vue courante.

Les applications connues présentent un nom lisible et une explication de leur rôle et des conséquences d’une désactivation. Ces informations viennent d’un catalogue, pas de l’extraction des libellés des APK. Les paquets inconnus sont explicitement signalés ; leur identifiant technique reste affiché et recherchable. La recherche porte sur le nom traduit, l’identifiant et l’explication, dans la vue sélectionnée. La liste est paginée par 12 applications, avec compteur ; les boutons restent regroupés et le diagnostic ainsi que les protections apparaissent avant la liste, sur ordinateur comme sur mobile.

Le panneau **Optimisation** affiche les applications de l’utilisateur Android actif, un relevé CPU des processus, la mémoire et le stockage. Un relevé ponctuel ne prouve pas qu’une application ralentit le démarrage.

Les actions individuelles sont : **Désactiver**, **Réactiver**, **Protéger** et **Retirer la protection manuelle**. La désactivation conserve les données ; les fonctions et services de l’application cessent jusqu’à sa réactivation. Les filtres distinguent télémétrie/rapports NVIDIA et Google, diagnostic NVIDIA, serveur Plex local (`com.plexapp.mediaserver.smb`) et lecteur Plex (`com.plexapp.android`). Aucune optimisation de base Plex ou Scrob.

Le launcher résolu par Android, l’application au premier plan et les paquets ayant une session multimédia publiée (y compris en pause) sont protégés côté serveur avant chaque désactivation, ainsi que dans l’API de désinstallation existante. Utilisez **Protéger** sur votre lecteur habituel pour conserver sa protection lorsqu’il est fermé ou ne publie pas de session. Rien n’est désactivé sans votre validation. Si Android ne permet pas de vérifier les protections, la désactivation attend un diagnostic valide ; la réactivation reste disponible.

L’historique persistant conserve les 200 dernières tentatives par appareil et utilisateur dans le répertoire de données du serveur (`optimization/`), avec date, action et résultat. Une tentative « En attente » peut avoir été interrompue : actualisez l’état réel avant de réessayer. La réactivation est accessible dans le filtre des applications désactivées. La détection n’est pas une garantie contre un changement d’application simultané sur la TV.

**Nettoyage recommandé** propose une courte liste propre à Shield Controller. La télémétrie et les rapports NVIDIA/Google sont présélectionnés. Les éléments facultatifs (diagnostic NVIDIA, recommandations de l’accueil, serveur Plex local, applications préinstallées) sont décochés. Les applications déjà désactivées ou protégées n’apparaissent pas. Après confirmation, chaque application passe par les mêmes protections et vérifications qu’une désactivation individuelle. Seuls les paquets de cette liste peuvent être désactivés en lot.

**Réactiver les applications désactivées ici** annule en une fois les désactivations faites par Shield Controller, d’après l’historique. Les applications désactivées d’origine par le firmware ne sont pas touchées ; le résultat indique les réactivations refusées par Android.

## Réglages

Le panneau **Réglages** modifie des paramètres Android documentés, chacun limité à une liste de valeurs autorisées et vérifié après écriture :

- HDMI-CEC, allumage et mise en veille de la TV avec la Shield
- Adaptation de la fréquence d’images au contenu (Android 12 et plus ; sur la Shield, réglage NVIDIA dans le menu de la TV)
- Délai d’appui long de la télécommande
- Échelles d’animation (fenêtres, transitions, durée)
- Sortie son surround (automatique, jamais, toujours, manuel)
- Mise à l’échelle de l’affichage (densité de 160 à 640 dpi, réinitialisable)
- Launcher par défaut parmi les écrans d’accueil installés

La valeur relevée avant la première modification est conservée sur le serveur (`tweaks/`) : **Restaurer l’origine** la remet en place. Les réglages indisponibles sur la version d’Android de l’appareil sont grisés. Le DNS privé reste dans le panneau DNS.

### Instantanés

**Enregistrer un instantané** télécharge un fichier JSON contenant l’état activé/désactivé de chaque application, les réglages ci-dessus, la densité et le launcher. **Charger un instantané** affiche d’abord les différences avec l’appareil, puis **Appliquer l’instantané** les applique. Sur le même appareil, cela permet de revenir en arrière ; sur un autre, de copier la configuration.

Le launcher est changé en premier, puis viennent les réactivations, les réglages, la densité et enfin les désactivations. Les protections restent actives. Les applications absentes, les réglages indisponibles et les valeurs « Android par défaut » sont ignorés et listés. Le résultat de chaque étape est affiché ; une étape refusée n’arrête pas les suivantes.

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

Réglages, nettoyage recommandé, réactivation groupée et instantanés inspirés de **[bryanroscoe/shield_optimizer](https://github.com/bryanroscoe/shield_optimizer)** (ATV Optimizer), puisqu’il interdit qu’on utilise son code : aucune ligne de code ni aucune liste n’en est reprise, les fonctions ont été réécrites à partir des commandes Android publiques.

**GPL-3.0-only** — voir [LICENSE](LICENSE). Les mentions de copyright d’origine sont conservées.
