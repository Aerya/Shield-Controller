# Historique de Shield Controller

### Sécurité TLS — octobre 2026

Mise à jour des certificats et des composants TLS des images après l’incident eMudhra. Les contrôles couvrent les chaînes compromises, dont les deux cas « No CT », et une connexion HTTPS valide. Une image déjà en cours d’exécution reste inchangée : son remplacement doit être planifié après validation.

[Détails de l’incident](https://emudhra.we-have-a-problem.com/) · [TLS checks](security/emudhra/README.md)


## 2026-10-27

- Ajoute Maintenance TV : référence persistante avec restauration sélective des écarts, test réel du bouton Home, diagnostic de compatibilité et protections des composants TV essentiels/persistants, bilan avant/après contextualisé et installation/configuration facultative de TV Detox 1.5.6 vérifiée par SHA-256. Fonctions natives, sans exécuter les scripts du projet source.

## 2026-10-25

- Ajoute le panneau Réglages (HDMI-CEC, fréquence d’images, appui long, animations, son surround, densité, launcher par défaut) avec restauration de l’origine, le nettoyage recommandé à valider, la réactivation groupée des applications désactivées par Shield Controller et les instantanés (enregistrement, aperçu des différences, application). Inspiré de bryanroscoe/shield_optimizer, sans reprise de code.

## 2026-10-18

- Retire les commandes langue/thème des popups et la croix redondante de la confirmation de fermeture du terminal ; Annuler, Fermer et Échap restent disponibles.

- Détection IP/DNS automatique à l’ouverture, actions regroupées, panneaux sans commandes FR/EN/thème ni onglets redondants, informations sans diagnostic Projectivy et traduction de la recherche réseau.

- Affiche le fournisseur des résolveurs DNS connus et identifie les autres opérateurs via RIPEstat (IPv4/IPv6), avec conservation des IP si la recherche échoue.

- Corrige les panneaux invisibles : chaque encart occupe toute la grille du tracker. Régression couverte dans Chromium et Firefox, sur ordinateur et mobile.

- Panneaux latéraux, drapeaux FR/EN, stockage en Gio et noms de launchers lisibles.
- Aperçu HTTP avant capture, télécommande et saisie/collage Unicode via scrcpy.
- IP publiques IPv4/IPv6 et résolveurs DNS observés : tests IPleak exécutés sur la Shield.
- Retrait des onglets inutiles dans Docker et clarification du message vidéo HTTP.

- Suivi CPU/RAM/stockage, sondes thermiques Android et launcher par défaut/application au premier plan.

- Boutons d’action uniformisés et choix FR/EN mémorisé.
- Captures PNG avec aperçu et téléchargement.
- Diagnostic DNS IPv4/IPv6, domaine au choix et configuration du DNS privé avec relecture et restauration en cas d’échec.
- Logo utilisé en favicon et footer avec les liens GitHub, UpAndClear, Ko-fi et le crédit du projet d’origine.

- Restaure les connexions ADB mémorisées après redémarrage.
- Corrige la sonde Docker lorsque l’authentification est activée.

- Ajout des informations détaillées sur l’appareil.
- Installation d’APK par glisser-déposer avec suivi du transfert.
- Gestion des applications : recherche, filtres et désinstallation avec confirmation.
- README courts en français et en anglais.

Basé sur ws-scrcpy-web 0.5.10, commit `b32d7693f7d42b0febf2399397fcfd5fb09af161`.
