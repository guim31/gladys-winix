# Winix

## Présentation

Pilotez vos **purificateurs d'air Winix connectés** (C545, C610, AM90, T810,
5500-2 Wi-Fi, Tower…) depuis Gladys : marche et arrêt, mode, vitesse du
ventilateur, Plasmawave, et suivez la qualité de l'air, les particules PM2.5
quand le modèle les mesure, la luminosité ambiante et l'usure du filtre.

L'intégration passe par le **cloud Winix**, celui de l'appli Winix Smart :
il faut une connexion Internet et un compte Winix.

> Développée **sans le matériel** : les échanges avec le cloud Winix suivent
> les projets libres qui les ont décrits et leurs réponses réelles, mais
> l'intégration n'a pas encore été essayée sur un vrai purificateur. Vos
> retours sont les bienvenus, sur le forum de Gladys ou dans les issues du
> dépôt GitHub.
>
> Cette intégration n'a **aucun lien avec Winix** : c'est un projet
> communautaire, ni approuvé ni soutenu par Winix.

## Prérequis

- Gladys **5.1.0** ou plus récent.
- Un purificateur Winix Wi-Fi déjà installé dans l'appli **Winix Smart**
  (c'est l'appli qui le relie au Wi-Fi ; l'intégration ne le fait pas).
- L'adresse e-mail et le mot de passe avec lesquels vous vous connectez à
  l'appli Winix Smart.
- Les déshumidificateurs et climatiseurs Winix ne sont pas pris en charge :
  ils sont ignorés.

## Configuration

1. Installez l'intégration : **Intégrations → Installer depuis GitHub**, ou
   depuis le catalogue.
2. Dans l'onglet **Configuration**, saisissez l'**adresse e-mail** et le
   **mot de passe** du compte Winix.
3. Choisissez l'**intervalle de rafraîchissement** (2 minutes par défaut, de
   1 à 5) et la **langue des noms de fonctionnalités** (français par défaut).
4. Enregistrez : l'état de la connexion s'affiche en haut de la page. Vos
   purificateurs apparaissent dans l'onglet **Découverte** ; ajoutez-les.

**Important — l'appli du téléphone.** Winix n'accepte qu'une session mobile
par compte. La première connexion de Gladys peut déconnecter l'appli Winix de
votre téléphone : reconnectez-vous simplement dans l'appli. L'intégration ne
rouvre une session que pour lister vos purificateurs (premier démarrage,
nouvelle recherche dans **Découverte**) ; la lecture et les commandes n'en
ont pas besoin, elle continue donc de fonctionner quand le téléphone reprend
la main.

## Les appareils

Un appareil par purificateur, nommé comme dans l'appli Winix :

| Fonctionnalité             | Type                    | Ce qu'elle fait                                                               |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| Marche                     | interrupteur, pilotable | allume ou éteint le purificateur                                              |
| Mode                       | liste, pilotable        | Auto, Manuel ou Sommeil                                                       |
| Vitesse du ventilateur     | niveau 0 à 4, pilotable | 0 sommeil, 1 basse, 2 moyenne, 3 haute, 4 turbo (5 Super Clean : Tower Prime) |
| Plasmawave                 | interrupteur, pilotable | active ou coupe le Plasmawave                                                 |
| Pollution de l'air         | niveau de risque 0 à 3  | l'anneau de couleur Winix : 0 bonne, 1 moyenne, 2 mauvaise, 3 très mauvaise   |
| PM2.5                      | µg/m³                   | seulement sur les modèles qui ont ce capteur                                  |
| Luminosité ambiante        | valeur brute            | la lecture du capteur de lumière (sans unité, Winix n'en donne pas)           |
| Durée de vie du filtre     | %                       | ce qui reste du filtre, 0 % quand il est à changer                            |
| Heures de filtre restantes | heures                  | heures d'usage restantes avant le changement                                  |
| En ligne                   | oui / non               | le cloud Winix a des nouvelles du purificateur                                |

- Choisir une vitesse fait passer le purificateur en mode manuel, comme
  dans l'appli. En mode Auto, la vitesse affichée est celle que l'appareil a
  choisie.
- Choisir un mode ou une vitesse allume le purificateur s'il était éteint.
- La durée de vie du filtre vient du compteur d'heures du purificateur et de
  la durée prévue pour le modèle (6 480 h, soit 9 mois, pour la plupart).
  Elle devrait repartir de 100 % quand le compteur du filtre est remis à zéro
  sur l'appareil après un changement (à confirmer sur du matériel réel).
- Les capteurs (PM2.5, luminosité) sont détectés à la première lecture. Si
  un capteur apparaît plus tard, l'onglet Découverte propose **Mettre à
  jour**.

## Widget

Le widget **Purificateur Winix** du tableau de bord affiche un purificateur
choisi dans ses réglages : PM2.5 et filtre en direct, mode, qualité de l'air
et heures de filtre, et quatre boutons **Auto**, **Manuel**, **Sommeil** et
**Éteindre** (un bouton **Allumer** quand il est éteint). Le mode en cours
porte une coche.

## Déclencheurs et actions de scène

L'intégration n'ajoute ni déclencheur ni action de scène : tout passe par les
fonctionnalités de l'appareil, que les scènes de Gladys savent déjà lire et
piloter. Un « filtre à changer » est le seuil **Durée de vie du filtre ≤ 5 %**
d'une scène, déclenché une seule fois au passage du seuil ; un déclencheur à
part le répéterait.

## Exemples de scènes

- **Nuit calme** : à 22 h 30, mettre le **Mode** du purificateur de la
  chambre sur **Sommeil** ; à 7 h, le remettre sur **Auto**.
- **Air pollué** : quand la **Pollution de l'air** du salon passe à 2 ou plus
  (ou les **PM2.5** au-dessus de 25 µg/m³), mettre la **Vitesse du
  ventilateur** à 4 et envoyer un message ; revenir en **Auto** quand elle
  redescend à 0.
- **Filtre** : quand la **Durée de vie du filtre** passe sous 5 %, envoyer
  « Filtre du purificateur à commander ».
- **Maison vide** : quand tout le monde est parti, éteindre les
  purificateurs ; les rallumer en **Auto** au retour du premier.

## Rafraîchissement et conditions du cloud Winix

- Chaque purificateur ajouté à Gladys est lu toutes les **2 minutes** par
  défaut (de 1 à 5 selon la configuration), l'un après l'autre. Seules les
  valeurs qui changent sont envoyées à Gladys, avec un rappel toutes les 6 h
  pour celles qui ne bougent pas.
- Winix ne publie ni API ni quota. Le cloud refuse une rafale de requêtes
  pendant environ une minute : l'intégration attend alors une minute avant
  de reprendre. Évitez l'intervalle d'une minute si vous avez beaucoup de
  purificateurs.
- Après une commande, le purificateur est relu 5 secondes plus tard pour
  afficher ce qu'il a vraiment fait.
- Le compte n'est sollicité qu'au premier démarrage et à chaque recherche
  dans **Découverte** ; la session (jeton de rafraîchissement, identifiant)
  et la liste des purificateurs sont gardées dans `/data`.

## Données et confidentialité

- Le mot de passe reste dans la configuration de Gladys ; il n'est envoyé
  qu'au service de connexion de Winix (AWS Cognito), et jamais en clair :
  la connexion utilise le protocole SRP.
- `/data/winix-session.json` garde le jeton de rafraîchissement, l'identifiant
  du compte et la liste des purificateurs, lisibles par le seul conteneur.
- Aucun jeton, mot de passe ni identifiant n'apparaît dans les journaux.

## Dépannage

- **« Winix a refusé l'adresse e-mail ou le mot de passe »** : vérifiez-les en
  vous connectant à l'appli Winix, puis enregistrez-les à nouveau.
  L'intégration ne réessaie pas seule avec les mêmes identifiants, pour ne pas
  bloquer le compte.
- **L'appli du téléphone me déconnecte** : c'est la session unique de Winix
  (voir Configuration). Reconnectez-vous dans l'appli ; Gladys continue de
  lire et piloter les purificateurs.
- **« Le cloud Winix ne répond pas »** : panne Internet ou du cloud Winix.
  L'intégration réessaie à chaque cycle et le signale une seule fois dans les
  journaux.
- **Un purificateur est « hors ligne »** : il est débranché ou n'a plus de
  Wi-Fi. Vérifiez-le dans l'appli Winix.
- **Un nouveau purificateur n'apparaît pas** : lancez une recherche dans
  l'onglet **Découverte**.
- **Plus de détails** : passez `LOG_LEVEL=debug` dans les journaux de
  l'intégration.

## Limites

- Dépend du cloud Winix et d'Internet : pas de pilotage local.
- Pas encore essayée sur du matériel réel ; les codes et réponses viennent
  des projets libres cités dans le README.
- Une seule session mobile par compte Winix (voir Configuration).
- Seuls les purificateurs d'air sont pris en charge : ni déshumidificateurs ni
  climatiseurs Winix.
- Ni sécurité enfant, ni luminosité de l'écran, ni minuterie : les commandes
  sont marche/arrêt, mode, vitesse et Plasmawave.
- La qualité de l'air est l'indicateur Winix à 3 ou 4 niveaux, pas un indice
  IQA ; la luminosité ambiante est une valeur brute.
- Les noms des fonctionnalités sont fixés à l'ajout de l'appareil : changer la
  langue ensuite ne les renomme pas.
