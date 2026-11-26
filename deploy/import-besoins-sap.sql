-- ===========================================================================
--  Orbit : import des besoins du projet SAP dans la toile 3D
--  18 besoins, 8 sous-points, 8 contraintes + liens
--
--  1. Dans phpMyAdmin, base "orbit", onglet SQL, regarde tes cartes :
--       SELECT id, name FROM maps;
--  2. Remplace NOM_DE_TA_CARTE ci-dessous par le nom exact de la carte.
--  3. Colle tout ce fichier dans l'onglet SQL et clique sur Executer.
--  Si le nom est faux, rien n'est insere (map_id NULL = erreur, transaction annulee).
-- ===========================================================================

SET @map_id = (SELECT id FROM maps WHERE name = 'NOM_DE_TA_CARTE' LIMIT 1);
SET @now = UTC_TIMESTAMP();

-- Optionnel : vider la toile de cette carte avant l'import (decommenter)
-- DELETE FROM nodes WHERE map_id = @map_id;

START TRANSACTION;

-- Besoins : Changement matériel
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Changement matériel', 'Existant :
SI issu d''une architecture de 2015. Parc vieillissant, non compatible avec les dernières versions des logiciels métiers (rapport IT Conseils).
Inventaire 2015 : 450 portables HP ProBook 450 G2, 450 souris, 450 licences Office 2013, 15 switches HP 5120, 5 routeurs Cisco ASR 900, 5 firewalls Checkpoint 3200, 16 serveurs HP G7. Tout le réseau est noté « matériel vieillissant ».

Questions :
Neuf ou reconditionné ? Quel ordre de remplacement ?

Pistes / réponses :
Dimensionner pour l''année 5 (×1,28), pas pour aujourd''hui.
Remplacer le réseau et les firewalls avant les postes.
Repartir d''une feuille blanche, sauf serveurs SQL, ERP et administratif à garder avec montée de version (prof, jour 2).
Livrable attendu : récapitulatif des équipements à renouveler / améliorer / recycler + schéma logique et physique.
Prévoir du spare (matériel de secours en carton sur site).', NULL, 0, NULL, @now, @now);
SET @n_materiel = LAST_INSERT_ID();

-- Besoins : Solution de travail collaboratif moderne
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Solution de travail collaboratif moderne', 'Existant :
Absence de solutions de travail collaboratif modernes (rapport IT Conseils).

Questions :
Où sont hébergées les données de santé ?

Pistes / réponses :
Imposé : Microsoft 365 (Teams, SharePoint, Outlook, MS Project pour les chefs de service). Objectifs IT Conseils : agenda partagé, GED, visioconférence.

Critères d''acceptation :
FC9 · Collaboratif : SharePoint, Teams', NULL, 0, NULL, @now, @now);
SET @n_collab = LAST_INSERT_ID();

-- Besoins : Solution de stockage en local
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Solution de stockage en local', 'Existant :
Hébergement de données en local sans redondance (rapport IT Conseils).
Hôtes actuels : 4 × 300 Go par serveur.

Questions :
Capacité de la baie (X Go) ? Espace personnel (X Go) ?

Pistes / réponses :
RAID 5 = minimum exigé (critère flexible) → proposer RAID 6 ou 10, ou hyperconvergé.

Critères d''acceptation :
FT3 · La baie de stockage a une capacité de X Go
FT3 · Le niveau de RAID 5 est le minimum exigé
FC1 · Stockage à haut niveau de disponibilité
FC7 · Espace personnel de X Go par utilisateur
FC7 · Lecteur réseau correspondant au domaine d''activité du service', NULL, 0, NULL, @now, @now);
SET @n_stockage = LAST_INSERT_ID();

-- Besoins : Redondance
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Redondance', 'Critères d''acceptation :
FC1 · Redondance DNS, AD, DHCP
FC1 · Redondance des services
FC1 · Redondance des commutateurs cœur de réseau
FC1 · Redondance des lignes Internet
FC1 · Redondance des moyens d''interconnexion
FC1 · Stockage à haut niveau de disponibilité', NULL, 0, NULL, @now, @now);
SET @n_redondance = LAST_INSERT_ID();

-- Besoins : PRA – PCA
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'PRA – PCA', 'Existant :
Aucun plan de reprise d''activité (rapport IT Conseils).

Questions :
Quel site de secours ? Quels délais de reprise (RTO/RPO) ?', NULL, 0, NULL, @now, @now);
SET @n_pra = LAST_INSERT_ID();

-- Besoins : Green IT
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Green IT', 'Existant :
Démarche RSE et écoresponsable de la SAP (Contexte SAP §9).

Questions :
Quelle filière de recyclage pour le matériel retiré ?

Pistes / réponses :
Label environnemental exigé pour le datacenter (site internet, sauvegardes).
Recyclage du matériel renouvelé : noté dans la grille (1 pt) et attendu dans les livrables.
Reconditionné, moins de boîtiers, PoE seulement où il sert.', NULL, 0, NULL, @now, @now);
SET @n_greenit = LAST_INSERT_ID();

-- Besoins : Sauvegarde
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Sauvegarde', 'Existant :
Par site : un serveur HP ML110 G7 (Windows 2012 R2) avec lecteur de bandes LTO 6, et une VM Backup.

Pistes / réponses :
Sauvegarde externalisée (objectif IT Conseils), règle 3-2-1, datacenter labellisé.
Remplacer les bandes LTO 6 par une sauvegarde disque + copie externalisée.
Sauvegarder aussi Microsoft 365.

Critères d''acceptation :
FC4 · Un système physique de sauvegarde doit être présent', NULL, 0, NULL, @now, @now);
SET @n_sauvegarde = LAST_INSERT_ID();

-- Besoins : Service de messagerie
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Service de messagerie', 'Existant :
Exchange 2010 sur Windows 2012 R2 au siège, accès OWA via le MPLS.

Pistes / réponses :
Exchange 2010 n''a plus de support : passer à Exchange Online (Microsoft 365), cohérent avec FC9 (Outlook).
Le prof signale une incohérence dans le schéma actuel : MPLS + Exchange en local.

Critères d''acceptation :
FC8 · Accès disponible au sein du SI mais également en dehors
FC8 · Horaires d''accès conformes au tableau communiqué
FC9 · Messagerie : Outlook', NULL, 0, NULL, @now, @now);
SET @n_messagerie = LAST_INSERT_ID();

-- Besoins : Accès à distance à l'environnement
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Accès à distance à l''environnement', 'Existant :
Éducateurs, mandataires, chefs de service et direction souvent en mobilité (rapport IT Conseils).
Schéma actuel : aucun VPN autorisé.

Pistes / réponses :
Profils les plus mobiles : éducateurs et mandataires (≈330, visites à domicile, tribunaux).
VPN ou accès zero trust depuis le firewall, avec double authentification (MFA).
Microsoft 365 accessible partout.

Critères d''acceptation :
FT1 · L''accès à distance doit être possible pour l''ensemble des utilisateurs
FT2 · Connexion internet sur site et en déplacement
FC7 · Accès aux données depuis le SI, les autres sites et le cloud', NULL, 0, NULL, @now, @now);
SET @n_acces = LAST_INSERT_ID();

-- Besoins : Sécurisation des données
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Sécurisation des données', 'Existant :
Sécurité insuffisante face aux ransomwares et fuites de données (rapport IT Conseils).

Pistes / réponses :
Objectifs IT Conseils : chiffrement, sauvegarde externalisée, PRA.
Serveur antivirus dépassé en 2026 : passer à un EDR (prof).
Pas de données en local sur les portables en cas de vol (prof) : BitLocker + OneDrive / SharePoint.
GPO par profil utilisateur (notes jour 1).', NULL, 0, NULL, @now, @now);
SET @n_secu = LAST_INSERT_ID();

-- Sous-points de « Changement matériel » : PC, dock, souris, clavier
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, @n_materiel, 'solution', 'PC, dock, souris, clavier', 'État : en cours

Existant :
450 portables HP ProBook 450 G2, achetés en 2015, garantie finie en 2018
↳ 146 défectueux
↳ 154 à remplacer
↳ 150 en service
Souris Logitech M185 : 160 perdues, 148 à remplacer, 142 fonctionnelles
Licences Office 2013 ×450 (ancienne version)

Questions :
Reconditionné ?
154 à remplacer → support 2018 → garantie (FC6)
150 OK → support 2018 + sécurité
Quelle config par profil ? Portable ou fixe ?
Direction : Apple ? (selon les besoins)

Pistes / réponses :
Les 150 « en service » ne sont pas récupérables : le ProBook 450 G2 (Intel 5e génération) n''est pas compatible Windows 11, et Windows 10 n''a plus de support depuis oct. 2025 → remplacer les 450 + ~126 postes de croissance sur 5 ans.
Config par profil : éducateurs et mandataires (≈330, mobilité +++) en portable léger ; administratifs (faible mobilité) possible en fixe.
Pas de données en local en cas de vol (prof) : chiffrement BitLocker + fichiers dans OneDrive / SharePoint.
Souris, clavier, dock : validés par le prof.
Reconditionné pro grade A, garantie 3 ans : Green IT + budget.
Spare sur chaque site.', NULL, 0, NULL, @now, @now);
SET @i_pc = LAST_INSERT_ID();

-- Besoins : Supervision
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Supervision', 'Critères d''acceptation :
FT5 · Console disponible en place des postes de contrôle
FT5 · Accessible depuis les desktops des techniciens ou administrateurs
FT5 · Droits d''accès soumis à l''accord de la direction
FC2 · Intégrée au serveur central, historique hébergé sur le serveur
FC3 · Paramétrer le réseau, surveiller charges et serveurs, déployer les stations à distance
FC5 · Sondes et capteurs connectables en WiFi (IoT)', NULL, 0, NULL, @now, @now);
SET @n_supervision = LAST_INSERT_ID();

-- Besoins : Conformité RGPD – HDS – ITIL
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Conformité RGPD – HDS – ITIL', 'Existant :
Mesures judiciaires, protection des majeurs, suivi par des psychologues : données sensibles.
Psychologues : données de santé (HDS). Mandataires : données financières, juridiques et médicales des majeurs.

Pistes / réponses :
Social / santé → HDS.
RGPD : à aborder explicitement dans le dossier (notes jour 1).', NULL, 0, NULL, @now, @now);
SET @n_conformite = LAST_INSERT_ID();

-- Sous-points de « Changement matériel » : Switches
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, @n_materiel, 'solution', 'Switches', 'État : en cours

Existant :
15 switches HP 5120 48 ports, soit 3 par site
↳ installés en 2015, « matériel vieillissant »

Questions :
Combien de prises : 1 user = 1 prise + 5 %/an + bornes WiFi
PoE → bornes WiFi
Non PoE → users
VLAN

Pistes / réponses :
Ports = utilisateurs année 5 + imprimantes + ~20 % de marge, divisé par 48 → 3 à 4 switches users par site (ex. Lyon 132 × 1,2 ≈ 158 → 4).
+1 switch PoE+ par site pour les bornes → ~22 switches d''accès.
Empilables.
VLAN : Utilisateurs / WiFi interne / WiFi invités / Serveurs / DMZ / Imprimantes / Management.
Câblage hors chiffrage (prof) : indiquer seulement où il faut des prises (ex. 600 prises × 180 € HT, hors périmètre).

Critères d''acceptation :
FC1 · Redondance des commutateurs cœur de réseau', NULL, 0, NULL, @now, @now);
SET @i_switch = LAST_INSERT_ID();

-- Besoins : ISO 27001
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'ISO 27001', NULL, NULL, 0, NULL, @now, @now);
SET @n_iso27001 = LAST_INSERT_ID();

-- Sous-points de « Changement matériel » : Routeurs / cœur de réseau
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, @n_materiel, 'solution', 'Routeurs / cœur de réseau', 'État : en cours

Existant :
5 routeurs Cisco ASR 900, 1 par site
↳ installés en 2015
Interconnexion MPLS opérateur, gestion via l''opérateur (schéma logique)

Questions :
Non délégué au FAI car environnement social / santé
Cœur de réseau
Switch L3 ou routeurs ? Conso (éco)
×2 redondance

Pistes / réponses :
Switch L3 : routage inter-VLAN sur 2 switches L3 empilés par site ; le WAN passe par le firewall.
Plus de routeur dédié : moins de boîtiers, moins de consommation.

Critères d''acceptation :
FC1 · Redondance des commutateurs cœur de réseau', NULL, 0, NULL, @now, @now);
SET @i_routeur = LAST_INSERT_ID();

-- Sous-points de « Changement matériel » : Firewalls
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, @n_materiel, 'solution', 'Firewalls', 'État : en cours

Existant :
5 firewalls Checkpoint 3200 Appliance, 1 par site
↳ installés en 2015
Schéma actuel : aucun VPN autorisé, navigation web et accès OWA via le MPLS

Questions :
×2 redondance + DMZ, pratique ?
Règles → social / santé ?
Penser à ce qu''il faudra faire

Pistes / réponses :
2 par site en actif/passif (10) : indispensable pour 99,9 %.
DMZ : VPN, passerelle mail, reverse proxy.
Règles : tout refusé par défaut, flux santé isolés et journalisés.
À prévoir : VPN inter-sites ou SD-WAN, accès distant, filtrage web, mises à jour, sauvegarde des configs.', NULL, 0, NULL, @now, @now);
SET @i_firewall = LAST_INSERT_ID();

-- Besoins : ISO 22301
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'ISO 22301', NULL, NULL, 0, NULL, @now, @now);
SET @n_iso22301 = LAST_INSERT_ID();

-- Sous-points de « Changement matériel » : Bornes WiFi
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, @n_materiel, 'solution', 'Bornes WiFi', 'État : en cours

Existant :
24 bornes D-Link DAP-2660 par site (schéma logique), à changer
120 au total · PoE

Questions :
WiFi Guest / Interne
Combien ? Bande passante du réseau
Management

Pistes / réponses :
24 par site, cohérent (~1 borne pour 20 à 25 users). WiFi 6 minimum, uplink 1 Gb/s.
Pas de TP-Link (prof) : du matériel pro avec gestion centralisée des bornes, même marque que le reste.
Interne en 802.1X, invités avec portail captif sur VLAN isolé.
Avec 100 % de portables, le WiFi devient critique : à justifier dans le dossier.

Critères d''acceptation :
FT1 · Un accès WiFi doit être disponible dans l''ensemble des sites
FC5 · Les sondes et capteurs de supervision doivent être connectables par wifi (IoT)', NULL, 0, NULL, @now, @now);
SET @i_wifi = LAST_INSERT_ID();

-- Besoins : Sensibilisation des utilisateurs
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Sensibilisation des utilisateurs', 'Existant :
Profils non technophiles (éducateurs, assistants sociaux).', NULL, 0, NULL, @now, @now);
SET @n_sensib = LAST_INSERT_ID();

-- Besoins : Profils utilisateurs et postes
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Profils utilisateurs et postes', 'État : en cours

Existant :
Direction (DG + 5 directeurs de site) : 6 · mobilité forte
Responsables projet et développement : 2 · moyenne à forte
Chefs de service (7 par site) : 35 · forte · MS Project
Psychologues (hyp. 7 par site) : 35 · moyenne · données de santé (HDS)
Éducateurs + mandataires judiciaires : ≈ 330 · très forte
Administratifs de site (hyp. 4 par site) : 20 · faible · poste fixe
Services centraux RH et finances : 12 · faible · données RH et bancaires
Services centraux administration et pilotage : 4 · faible
Pôle informatique : 4 · moyenne · accès à privilèges

Questions :
Quelle config pour chaque profil ? Portable ou fixe ?
Direction : Apple ?

Pistes / réponses :
Config par profil : Bureautique (direction, chefs de service, psys), Projet (responsables projet), Éduc (éducateurs, mandataires : itinérance +++).
GPO par profil.
Se mettre à la place des utilisateurs : partir des tâches de chaque profil (annexes).', NULL, 0, NULL, @now, @now);
SET @n_profils = LAST_INSERT_ID();

-- Sous-points de « Changement matériel » : Serveurs
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, @n_materiel, 'solution', 'Serveurs', 'État : en cours

Existant :
16 serveurs HP G7 (2015)
Lille : 3 × DL380 G7 + 1 × ML110 G7
Autres sites : 2 × DL360 G7 + 1 × ML110 G7
Hôtes ESXi 5.5 : Xeon E5640, 48 Go RAM, 4 × 300 Go
ML110 : Windows 2012 R2 + lecteur LTO 6 (sauvegarde)
VM siège : Administratif, AD, AD SAP, ERP, Impression + AV, Exchange 2010, Backup (W2012 R2), SQL ERP (Debian 7, PostgreSQL)
VM sites : Administratif, AD, Impression + AV, Backup
Une salle serveurs par site (plans)

Questions :
DMZ
VM × ?
Qu''est-ce qui est en local et/ou dans le cloud ?
Consolidation serveur ?

Pistes / réponses :
ESXi 5.5, Windows 2012 R2 et Debian 7 : plus aucun support → migration obligatoire.
Garder les rôles SQL, ERP et administratif, avec montée de version (prof).
Serveur antivirus inutile en 2026 : passer à un EDR (prof).
Consolider : cluster de 2-3 hôtes à Lille, répliqué sur un 2ᵉ site pour le PRA ; 0 ou 1 petit serveur sur les autres sites.
Maquette : 2 AD, DNS, DHCP redondés.
Si une salle serveurs doit bouger : le signaler, la mise aux normes est hors périmètre.
Données de santé dans le cloud → hébergeur certifié HDS.

Critères d''acceptation :
FC1 · Redondance DNS, AD, DHCP
FC1 · Redondance des services', NULL, 0, NULL, @now, @now);
SET @i_serveur = LAST_INSERT_ID();

-- Sous-points de « Changement matériel » : FAI / liens internet
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, @n_materiel, 'solution', 'FAI / liens internet', 'Existant :
Interconnexion MPLS opérateur entre les 5 sites, gérée par l''opérateur

Questions :
Combien de liens par site ? Quels débits ?

Pistes / réponses :
2 liens par site, chez 2 opérateurs différents (fibre + 4G/5G de secours au minimum).
MPLS ou SD-WAN sur internet : à comparer (coût mensuel, OPEX).
Le prof signale une incohérence dans le schéma actuel : MPLS + serveur Exchange en local.

Critères d''acceptation :
FT2 · Les utilisateurs doivent être connectés à internet quel que soit le site ainsi que dans leurs déplacements
FC1 · Redondance des lignes Internet
FC1 · Redondance des moyens d''interconnexion', NULL, 0, NULL, @now, @now);
SET @i_fai = LAST_INSERT_ID();

-- Besoins : Migration et bascule
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Migration et bascule', 'Questions :
Mode hybride, dégradé, cloud ?
Consolidation serveur ?

Pistes / réponses :
Prévoir un retour arrière le jour de la bascule si ça se passe mal (prof).
Migrer la nuit ou le week-end, quand personne ne travaille.
Garder SQL, ERP et administratif avec montée de version ; le reste repart d''une feuille blanche.', NULL, 0, NULL, @now, @now);
SET @n_migration = LAST_INSERT_ID();

-- Besoins : Cadrage et pilotage du projet
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'besoin', 'Cadrage et pilotage du projet', 'Existant :
Livrables du lot 1 : note de cadrage de 10 à 20 pages, schéma logique et physique, récapitulatif à renouveler / améliorer / recycler, maquette.

Questions :
Qui met en place, qui contrôle, qui décide ?

Pistes / réponses :
Note de cadrage : reformulation du besoin, résultats souhaités, exclusions, portée, contraintes et hypothèses, limites et tolérances, équipe et rôles, planification en 3 missions, risques, indicateurs, financement.
Acteurs : CODIR / COPIL (arbitre), MOA (pense et contrôle), MOE (fait) → faire un schéma « qui fait quoi ».
Triangle coût / qualité / délai : Gantt et outil de gestion de projet (Jira, Trello…).
Coûts humains en jours-homme (projet, formation, intervenants).
Besoin → réponse → qui ? quand ? comment ?

Critères d''acceptation :
Grille : note de cadrage pertinente et complète (3 pts) + conforme et sans fautes (2 pts)
Grille : gestion de projet, planning, budget, ressources, indicateurs (2 pts)', NULL, 0, NULL, @now, @now);
SET @n_cadrage = LAST_INSERT_ID();

-- Sous-points de « Changement matériel » : Imprimantes
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, @n_materiel, 'solution', 'Imprimantes', 'Questions :
Combien par site ? Achat ou location ?
À inclure ou pas ? (prof : pas d''imprimante, ou à proposer si besoin)

Pistes / réponses :
Optionnel selon le prof. Si proposé : location chez un fournisseur (OPEX), copieurs multifonctions par service, noir et blanc par défaut (Green IT).

Critères d''acceptation :
FT4 · Chaque utilisateur doit pouvoir imprimer en couleur ou N&B selon la politique d''impression des services
FT4 · Prioriser l''impression noir et blanc', NULL, 0, NULL, @now, @now);
SET @i_imprimantes = LAST_INSERT_ID();

-- Contraintes : Budget 800 K€
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'contrainte', 'Budget 800 K€', 'Existant :
800 000 € pour les 3 lots, pas seulement le lot 1 (notes jour 1).
Trésorerie 700 K€, endettement sur 13 mois : vigilance sur les charges d''exploitation.
Résultat 2,9 M€ : entreprise en bonne santé.

Questions :
Quelle part pour le lot 1 ? Combien de jours-homme ?

Pistes / réponses :
Le budget doit inclure : investissement, 1 an de charges, coûts humains internes et externes (en jours-homme), réserves de contingence et de management (sujet §10.2).
Noter OPEX ou CAPEX pour chaque poste dans le bilan financier (prof).
Raisonner sur 5 ans.
Éviter les solutions à gros abonnement annuel.
Le rapport IT Conseils dit « aucune contrainte de budget » : c''est la Direction (800 K€) qui fait foi.', NULL, 0, NULL, @now, @now);
SET @c_budget = LAST_INSERT_ID();

-- Contraintes : 99,9 % de disponibilité · 8 h 45 de panne / an
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'contrainte', '99,9 % de disponibilité · 8 h 45 de panne / an', 'Existant :
Disponibilité exigée pour le milieu médico-social (Contexte SAP §10.1).

Pistes / réponses :
8 h 45 / an = 99,9 %. Une seule panne matérielle sans redondance peut consommer tout le budget de l''année → doubler les éléments critiques (cœur, firewalls, liens, stockage).

Critères d''acceptation :
FC1 · Le système doit assurer la continuité de service', NULL, 0, NULL, @now, @now);
SET @c_dispo = LAST_INSERT_ID();

-- Contraintes : Délai : démarrage + 8 mois
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'contrainte', 'Délai : démarrage + 8 mois', 'Existant :
Date de fin de réalisation : démarrage + 8 mois (sujet §10.2).

Pistes / réponses :
Réseau (cœur, firewalls) en premier, puis serveurs, puis postes site par site.', NULL, 0, NULL, @now, @now);
SET @c_delai = LAST_INSERT_ID();

-- Contraintes : Max d'équipements réseau de même marque
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'contrainte', 'Max d''équipements réseau de même marque', 'Existant :
Équipe informatique de 4 personnes pour 5 sites.

Questions :
Quel constructeur ?

Pistes / réponses :
Une seule console de gestion. Piste : Fortinet (FortiGate, FortiSwitch, FortiAP, SD-WAN inclus). Alternatives : Aruba, Cisco Meraki (abonnement annuel obligatoire). Stormshield (français, certifié ANSSI) mais firewall uniquement.', NULL, 0, NULL, @now, @now);
SET @c_marque = LAST_INSERT_ID();

-- Contraintes : +5 % d'utilisateurs / an sur 5 ans
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'contrainte', '+5 % d''utilisateurs / an sur 5 ans', 'Existant :
Lille 94 · Paris 70 · Toulouse 101 · Lyon 103 · Marseille 82 = 450

Pistes / réponses :
Croissance composée : ×1,05⁵ ≈ ×1,28.
Année 5 : Lille 120 · Paris 90 · Toulouse 129 · Lyon 132 · Marseille 105 ≈ 576 utilisateurs.', NULL, 0, NULL, @now, @now);
SET @c_croissance = LAST_INSERT_ID();

-- Contraintes : Garantie H24 des éléments vitaux
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'contrainte', 'Garantie H24 des éléments vitaux', 'Pistes / réponses :
Contrats constructeur avec remplacement H24 à chiffrer sur 5 ans.

Critères d''acceptation :
FC6 · Serveurs, routeurs, commutateurs, firewall, stockages de données sous garantie de remplacement H24', NULL, 0, NULL, @now, @now);
SET @c_garantie = LAST_INSERT_ID();

-- Contraintes : Suite Microsoft imposée
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'contrainte', 'Suite Microsoft imposée', 'Critères d''acceptation :
FC9 · Suite bureautique Microsoft
FC9 · Messagerie Outlook
FC9 · Collaboratif SharePoint, Teams
FC9 · MS Project pour les chefs de service', NULL, 0, NULL, @now, @now);
SET @c_m365 = LAST_INSERT_ID();

-- Contraintes : Hors périmètre du lot 1
INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at) VALUES (@map_id, NULL, 'contrainte', 'Hors périmètre du lot 1', 'Existant :
Précisions du prof (jour 2).

Pistes / réponses :
Câblage : pas chiffré, on indique seulement les prises nécessaires (ex. 600 × 180 € HT).
Téléphones : hors projet (inventaire : 135 Samsung Galaxy A5 de 2015).
Imprimantes : pas obligatoire, à proposer si besoin.
Salle serveurs : signaler si elle doit bouger, la mise aux normes est hors périmètre.
Réseau : à penser surtout pour le budget (notes jour 1).', NULL, 0, NULL, @now, @now);
SET @c_perimetre = LAST_INSERT_ID();

-- Liens transverses (49)
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_budget, @n_cadrage), GREATEST(@c_budget, @n_cadrage), @now);  -- Budget 800 K€ <-> Cadrage et pilotage du projet
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_budget, @n_materiel), GREATEST(@c_budget, @n_materiel), @now);  -- Budget 800 K€ <-> Changement matériel
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_croissance, @i_pc), GREATEST(@c_croissance, @i_pc), @now);  -- +5 % d'utilisateurs / an sur 5 ans <-> PC, dock, souris, clavier
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_croissance, @i_switch), GREATEST(@c_croissance, @i_switch), @now);  -- +5 % d'utilisateurs / an sur 5 ans <-> Switches
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_croissance, @n_materiel), GREATEST(@c_croissance, @n_materiel), @now);  -- +5 % d'utilisateurs / an sur 5 ans <-> Changement matériel
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_delai, @n_cadrage), GREATEST(@c_delai, @n_cadrage), @now);  -- Délai : démarrage + 8 mois <-> Cadrage et pilotage du projet
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_dispo, @i_firewall), GREATEST(@c_dispo, @i_firewall), @now);  -- 99,9 % de disponibilité · 8 h 45 de panne / an <-> Firewalls
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_dispo, @n_pra), GREATEST(@c_dispo, @n_pra), @now);  -- 99,9 % de disponibilité · 8 h 45 de panne / an <-> PRA – PCA
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_dispo, @n_redondance), GREATEST(@c_dispo, @n_redondance), @now);  -- 99,9 % de disponibilité · 8 h 45 de panne / an <-> Redondance
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_garantie, @i_firewall), GREATEST(@c_garantie, @i_firewall), @now);  -- Garantie H24 des éléments vitaux <-> Firewalls
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_garantie, @i_routeur), GREATEST(@c_garantie, @i_routeur), @now);  -- Garantie H24 des éléments vitaux <-> Routeurs / cœur de réseau
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_garantie, @i_serveur), GREATEST(@c_garantie, @i_serveur), @now);  -- Garantie H24 des éléments vitaux <-> Serveurs
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_garantie, @i_switch), GREATEST(@c_garantie, @i_switch), @now);  -- Garantie H24 des éléments vitaux <-> Switches
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_garantie, @n_stockage), GREATEST(@c_garantie, @n_stockage), @now);  -- Garantie H24 des éléments vitaux <-> Solution de stockage en local
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_m365, @n_collab), GREATEST(@c_m365, @n_collab), @now);  -- Suite Microsoft imposée <-> Solution de travail collaboratif moderne
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_m365, @n_messagerie), GREATEST(@c_m365, @n_messagerie), @now);  -- Suite Microsoft imposée <-> Service de messagerie
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_marque, @i_firewall), GREATEST(@c_marque, @i_firewall), @now);  -- Max d'équipements réseau de même marque <-> Firewalls
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_marque, @i_routeur), GREATEST(@c_marque, @i_routeur), @now);  -- Max d'équipements réseau de même marque <-> Routeurs / cœur de réseau
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_marque, @i_switch), GREATEST(@c_marque, @i_switch), @now);  -- Max d'équipements réseau de même marque <-> Switches
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_marque, @i_wifi), GREATEST(@c_marque, @i_wifi), @now);  -- Max d'équipements réseau de même marque <-> Bornes WiFi
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_perimetre, @i_imprimantes), GREATEST(@c_perimetre, @i_imprimantes), @now);  -- Hors périmètre du lot 1 <-> Imprimantes
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_perimetre, @i_serveur), GREATEST(@c_perimetre, @i_serveur), @now);  -- Hors périmètre du lot 1 <-> Serveurs
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@c_perimetre, @i_switch), GREATEST(@c_perimetre, @i_switch), @now);  -- Hors périmètre du lot 1 <-> Switches
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_fai, @n_redondance), GREATEST(@i_fai, @n_redondance), @now);  -- FAI / liens internet <-> Redondance
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_firewall, @n_acces), GREATEST(@i_firewall, @n_acces), @now);  -- Firewalls <-> Accès à distance à l'environnement
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_firewall, @n_secu), GREATEST(@i_firewall, @n_secu), @now);  -- Firewalls <-> Sécurisation des données
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_imprimantes, @n_greenit), GREATEST(@i_imprimantes, @n_greenit), @now);  -- Imprimantes <-> Green IT
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_pc, @n_acces), GREATEST(@i_pc, @n_acces), @now);  -- PC, dock, souris, clavier <-> Accès à distance à l'environnement
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_pc, @n_profils), GREATEST(@i_pc, @n_profils), @now);  -- PC, dock, souris, clavier <-> Profils utilisateurs et postes
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_routeur, @n_redondance), GREATEST(@i_routeur, @n_redondance), @now);  -- Routeurs / cœur de réseau <-> Redondance
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_serveur, @n_migration), GREATEST(@i_serveur, @n_migration), @now);  -- Serveurs <-> Migration et bascule
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_serveur, @n_pra), GREATEST(@i_serveur, @n_pra), @now);  -- Serveurs <-> PRA – PCA
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_serveur, @n_stockage), GREATEST(@i_serveur, @n_stockage), @now);  -- Serveurs <-> Solution de stockage en local
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_wifi, @n_acces), GREATEST(@i_wifi, @n_acces), @now);  -- Bornes WiFi <-> Accès à distance à l'environnement
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@i_wifi, @n_supervision), GREATEST(@i_wifi, @n_supervision), @now);  -- Bornes WiFi <-> Supervision
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_acces, @n_profils), GREATEST(@n_acces, @n_profils), @now);  -- Accès à distance à l'environnement <-> Profils utilisateurs et postes
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_acces, @n_secu), GREATEST(@n_acces, @n_secu), @now);  -- Accès à distance à l'environnement <-> Sécurisation des données
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_collab, @n_conformite), GREATEST(@n_collab, @n_conformite), @now);  -- Solution de travail collaboratif moderne <-> Conformité RGPD – HDS – ITIL
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_conformite, @n_secu), GREATEST(@n_conformite, @n_secu), @now);  -- Conformité RGPD – HDS – ITIL <-> Sécurisation des données
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_greenit, @n_materiel), GREATEST(@n_greenit, @n_materiel), @now);  -- Green IT <-> Changement matériel
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_iso22301, @n_pra), GREATEST(@n_iso22301, @n_pra), @now);  -- ISO 22301 <-> PRA – PCA
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_iso27001, @n_secu), GREATEST(@n_iso27001, @n_secu), @now);  -- ISO 27001 <-> Sécurisation des données
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_migration, @n_pra), GREATEST(@n_migration, @n_pra), @now);  -- Migration et bascule <-> PRA – PCA
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_pra, @n_redondance), GREATEST(@n_pra, @n_redondance), @now);  -- PRA – PCA <-> Redondance
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_pra, @n_sauvegarde), GREATEST(@n_pra, @n_sauvegarde), @now);  -- PRA – PCA <-> Sauvegarde
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_profils, @n_secu), GREATEST(@n_profils, @n_secu), @now);  -- Profils utilisateurs et postes <-> Sécurisation des données
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_sauvegarde, @n_secu), GREATEST(@n_sauvegarde, @n_secu), @now);  -- Sauvegarde <-> Sécurisation des données
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_sauvegarde, @n_stockage), GREATEST(@n_sauvegarde, @n_stockage), @now);  -- Sauvegarde <-> Solution de stockage en local
INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (@map_id, LEAST(@n_secu, @n_sensib), GREATEST(@n_secu, @n_sensib), @now);  -- Sécurisation des données <-> Sensibilisation des utilisateurs

COMMIT;

-- Verification : doit afficher le nombre d'elements par type
SELECT kind, COUNT(*) AS nb FROM nodes WHERE map_id = @map_id GROUP BY kind;
