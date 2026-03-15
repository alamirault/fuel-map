# ⛽ Fuel Map — Prix Carburant France

Carte interactive des prix de carburant en France en temps réel.

🔗 **[alamirault.github.io/fuel-map](https://alamirault.github.io/fuel-map/)**

---

> [!CAUTION]
> **Projet 100% vibe coded.**
> Aucun fichier de ce projet n'a été relu par un humain.
> Le code est généré intégralement par IA (Claude) sans revue manuelle.
> Utiliser à vos risques et périls.

---

## Fonctionnalités

- Carte des ~9 800 stations-service en France avec prix en temps réel
- Coloration vert → rouge selon le prix relatif (min/max visible)
- Filtrage par type de carburant (Gazole, SP95, SP98, E10, E85, GPLc)
- Statistiques dynamiques sur les stations visibles (min, moy, max)
- Logos des enseignes (TotalEnergies, BP, Shell, Leclerc…)
- Géolocalisation
- Itinéraire avec les stations les moins chères à moins de 5 km du trajet
- Autocomplétion des adresses
- Sauvegarde de la vue, du carburant et de l'itinéraire entre les sessions
- Interface bilingue 🇫🇷 / 🇬🇧
- Support mobile (bottom sheet)

## Sources

- Prix : [data.economie.gouv.fr](https://data.economie.gouv.fr)
- Enseignes : [OpenStreetMap](https://www.openstreetmap.org) via Overpass API
- Carte : [Leaflet](https://leafletjs.com) + [CARTO](https://carto.com)
- Itinéraire : [Valhalla](https://valhalla1.openstreetmap.de) (distance minimale)
- Géocodage : [Photon](https://photon.komoot.io) / [Nominatim](https://nominatim.openstreetmap.org)
