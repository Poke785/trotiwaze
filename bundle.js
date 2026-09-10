/**
 * TrottiWaze - Bundle Complet v3.0
 * Toutes fonctionnalités intégrées : navigation, communauté, alertes, batterie
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Battery Engine
  // =========================================================================
  class BatteryEngine {
    constructor() {
      this.config = {
        batteryCapacityWh: 474,
        currentPercentage: 80,
        riderWeightKg: 75,
        scooterWeightKg: 18,
        speedPrefKmh: 22,
        baseEfficiencyWhPerKm: 16.5
      };
      this.loadSettings();
    }

    loadSettings() {
      try {
        const saved = localStorage.getItem('trottiwaze_battery_cfg');
        if (saved) this.config = { ...this.config, ...JSON.parse(saved) };
      } catch (e) {}
    }

    saveSettings(newCfg) {
      this.config = { ...this.config, ...newCfg };
      try {
        localStorage.setItem('trottiwaze_battery_cfg', JSON.stringify(this.config));
      } catch (e) {}
    }

    estimateTrip(distanceKm, elevationGainM = 5) {
      const totalMassKg = this.config.riderWeightKg + this.config.scooterWeightKg;
      const weightFactor = totalMassKg / 90;
      const speedFactor = Math.pow(this.config.speedPrefKmh / 20, 1.8);
      const flatEnergyWh = distanceKm * this.config.baseEfficiencyWhPerKm * weightFactor * speedFactor;
      const climbEnergyWh = (totalMassKg * 9.81 * Math.max(0, elevationGainM)) / (3600 * 0.70);
      const totalWhUsed = flatEnergyWh + climbEnergyWh;
      const currentWh = (this.config.currentPercentage / 100) * this.config.batteryCapacityWh;
      const remainingWh = Math.max(0, currentWh - totalWhUsed);
      const remainingPct = Math.round((remainingWh / this.config.batteryCapacityWh) * 100);
      const avgConsumptionPerKm = totalWhUsed / (distanceKm || 1);
      const remainingRangeKm = (remainingWh / (avgConsumptionPerKm || 17)).toFixed(1);
      return {
        whUsed: Math.round(totalWhUsed),
        currentPct: this.config.currentPercentage,
        arrivalPct: remainingPct,
        remainingRangeKm: parseFloat(remainingRangeKm),
        isCritical: remainingPct < 15,
        elevationGainM: Math.round(elevationGainM)
      };
    }
  }

  // =========================================================================
  // 2. Hazards System
  // =========================================================================
  const HAZARD_TYPES = {
    pothole: { id: 'pothole', label: 'Nid-de-poule / Pavés', icon: '🕳️', color: '#f59e0b', warning: 'Risque de chute pour roues de trottinette', audioText: 'Attention : nid de poule devant vous.' },
    blocked: { id: 'blocked', label: 'Piste fermée / Travaux', icon: '🚧', color: '#ef4444', warning: 'Passage impossible ou déviation obligatoire', audioText: 'Attention : piste cyclable fermée.' },
    police: { id: 'police', label: 'Contrôle de police', icon: '👮', color: '#3b82f6', warning: 'Vérification 25 km/h, assurance, éclairage', audioText: 'Attention : contrôle des forces de l\'ordre.' },
    car: { id: 'car', label: 'Voiture sur la piste', icon: '🚗', color: '#f97316', warning: 'Véhicule gênant, dépassement prudent', audioText: 'Véhicule encombrant signalé sur la piste.' },
    charge: { id: 'charge', label: 'Borne de recharge', icon: '⚡', color: '#06b6d4', warning: 'Point de recharge trottinettes & vélos', audioText: 'Borne de recharge disponible à proximité.' },
    repair: { id: 'repair', label: 'Station gonflage / Réparation', icon: '🧰', color: '#10b981', warning: 'Pompe en libre-service et outillage', audioText: 'Station gonflage et réparation proche.' }
  };

  class HazardManager {
    constructor(map) {
      this.map = map;
      this.hazards = [];
      this.markersMap = new Map();
      this.alertHistory = new Set();
      this.audioCtx = null;
      this.initStorage();
    }

    initStorage() {
      const saved = localStorage.getItem('trottiwaze_hazards_v1');
      if (saved) {
        try { this.hazards = JSON.parse(saved); } catch (e) { this.hazards = this.getDefaultHazards(); }
      } else {
        this.hazards = this.getDefaultHazards();
        this.save();
      }
    }

    getDefaultHazards() {
      return [
        { id: 'hz-1', type: 'pothole', lat: 48.8558, lng: 2.3705, title: 'Nid-de-poule profond', desc: 'Fente dangereuse entre deux pavés près de l\'intersection', author: 'Marc (Xiaomi Pro)', timestamp: Date.now() - 1000*60*25, upvotes: 7 },
        { id: 'hz-2', type: 'police', lat: 48.8582, lng: 2.3551, title: 'Contrôle Police trottinettes', desc: 'Contrôle vitesse radar 25 km/h et gilet réfléchissant', author: 'Julie_75', timestamp: Date.now() - 1000*60*10, upvotes: 14 },
        { id: 'hz-3', type: 'blocked', lat: 48.8596, lng: 2.3642, title: 'Travaux piste cyclable', desc: 'Barrières de chantier coupant la piste, déviation temporaire', author: 'Alex_Rider', timestamp: Date.now() - 1000*60*45, upvotes: 9 },
        { id: 'hz-4', type: 'car', lat: 48.8533, lng: 2.3688, title: 'Camionnette de livraison', desc: 'Garée en plein milieu de la double voie cyclable', author: 'Thomas_B', timestamp: Date.now() - 1000*60*5, upvotes: 4 },
        { id: 'hz-5', type: 'charge', lat: 48.8530, lng: 2.3690, title: 'Borne de recharge Trottinette', desc: 'Prises 220V sécurisées gratuites café partenaire', author: 'EcoTrott', timestamp: Date.now() - 1000*60*120, upvotes: 12 },
        { id: 'hz-6', type: 'repair', lat: 48.8565, lng: 2.3520, title: 'Totem de gonflage public', desc: 'Pompe à pied fonctionnelle avec manomètre et embout Presta/Schrader', author: 'ParisEnTrott', timestamp: Date.now() - 1000*60*300, upvotes: 21 }
      ];
    }

    save() {
      try { localStorage.setItem('trottiwaze_hazards_v1', JSON.stringify(this.hazards)); } catch (e) {}
    }

    renderMarkers() {
      this.markersMap.forEach(marker => this.map.removeLayer(marker));
      this.markersMap.clear();
      this.hazards.forEach(hz => {
        const config = HAZARD_TYPES[hz.type] || HAZARD_TYPES.pothole;
        const customIcon = L.divIcon({
          className: 'hazard-custom-marker',
          html: `<div class="hazard-marker-bubble ${hz.type}"><span>${config.icon}</span></div>`,
          iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -20]
        });
        const timeAgoMin = Math.round((Date.now() - hz.timestamp) / 60000);
        const timeStr = timeAgoMin < 1 ? 'À l\'instant' : `Il y a ${timeAgoMin} min`;
        const marker = L.marker([hz.lat, hz.lng], { icon: customIcon }).addTo(this.map);
        marker.bindPopup(`
          <div style="min-width:180px;padding:4px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-size:22px;">${config.icon}</span>
              <div>
                <strong style="font-size:13px;color:${config.color};">${config.label}</strong>
                <div style="font-size:10.5px;opacity:0.7;">Signalé ${timeStr}</div>
              </div>
            </div>
            <div style="font-size:12px;margin-bottom:8px;line-height:1.3;">${hz.desc || hz.title}</div>
            <div style="font-size:11px;opacity:0.8;margin-bottom:8px;">🛡️ ${config.warning}</div>
            <div style="display:flex;gap:6px;">
              <button onclick="window.trottiApp.confirmHazard('${hz.id}')" style="flex:1;background:#10b981;border:none;color:#fff;border-radius:6px;padding:4px;font-weight:bold;cursor:pointer;font-size:11px;">👍 Toujours là (${hz.upvotes})</button>
              <button onclick="window.trottiApp.dismissHazard('${hz.id}')" style="background:rgba(255,255,255,0.1);border:none;color:#ccc;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;">Résolu ✕</button>
            </div>
          </div>
        `);
        this.markersMap.set(hz.id, marker);
      });
    }

    addHazard(hazardData) {
      const newHz = { id: 'hz-' + Date.now(), timestamp: Date.now(), upvotes: 1, ...hazardData };
      this.hazards.unshift(newHz);
      this.save();
      this.renderMarkers();
      return newHz;
    }

    upvote(id) {
      const target = this.hazards.find(h => h.id === id);
      if (target) { target.upvotes = (target.upvotes || 0) + 1; this.save(); this.renderMarkers(); }
    }

    remove(id) {
      this.hazards = this.hazards.filter(h => h.id !== id);
      this.save();
      this.renderMarkers();
    }

    getDistanceMeters(lat1, lon1, lat2, lon2) {
      const R = 6371e3;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
      return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
    }

    checkProximity(currentLat, currentLng) {
      for (const hz of this.hazards) {
        const dist = this.getDistanceMeters(currentLat, currentLng, hz.lat, hz.lng);
        if (dist <= 180) {
          const alertKey = `${hz.id}_${Math.floor(Date.now() / 120000)}`;
          const isFresh = !this.alertHistory.has(alertKey);
          if (isFresh) { this.alertHistory.add(alertKey); this.playAlertSound(hz.type); }
          return { hazard: hz, distanceMeters: dist, isFresh, config: HAZARD_TYPES[hz.type] || HAZARD_TYPES.pothole };
        }
      }
      return null;
    }

    playAlertSound(type = 'pothole') {
      try {
        if (!this.audioCtx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          this.audioCtx = new AC();
        }
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const now = this.audioCtx.currentTime;
        if (type === 'police') {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(880, now);
          osc.frequency.setValueAtTime(660, now + 0.15);
          osc.frequency.setValueAtTime(880, now + 0.30);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
          osc.connect(gain); gain.connect(this.audioCtx.destination);
          osc.start(now); osc.stop(now + 0.5);
        } else {
          const osc1 = this.audioCtx.createOscillator();
          const osc2 = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc1.type = 'sine'; osc2.type = 'triangle';
          osc1.frequency.setValueAtTime(523.25, now);
          osc1.frequency.exponentialRampToValueAtTime(1046.50, now + 0.12);
          osc2.frequency.setValueAtTime(659.25, now);
          osc2.frequency.exponentialRampToValueAtTime(1318.51, now + 0.12);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
          osc1.connect(gain); osc2.connect(gain); gain.connect(this.audioCtx.destination);
          osc1.start(now); osc2.start(now); osc1.stop(now + 0.45); osc2.stop(now + 0.45);
        }
      } catch (e) {}
    }

    playCockpitBell() {
      try {
        if (!this.audioCtx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          this.audioCtx = new AC();
        }
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const now = this.audioCtx.currentTime;
        const freqs = [1318, 1568, 1318];
        freqs.forEach((freq, i) => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.13);
          gain.gain.setValueAtTime(0, now + i * 0.13);
          gain.gain.linearRampToValueAtTime(0.22, now + i * 0.13 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.13 + 0.35);
          osc.connect(gain); gain.connect(this.audioCtx.destination);
          osc.start(now + i * 0.13); osc.stop(now + i * 0.13 + 0.4);
        });
      } catch (e) {}
    }
  }

  // =========================================================================
  // 3. UserManager - TrottiWazers dans le secteur
  // =========================================================================
  class UserManager {
    constructor(map, onUserClick) {
      this.map = map;
      this.onUserClick = onUserClick;
      this.users = [];
      this.markers = new Map();
      this.moveInterval = null;
      this.incomingInterval = null;
    }

    initNearbyUsers(centerLat, centerLng) {
      const PROFILES = [
        { pseudo: 'Max_Ninebot', avatar: '🦊', scooter: 'Ninebot Max G30', color: '#10b981', status: 'En route pour le boulot 💼', speed: 21, battery: 84, trip: 'Bastille → Châtelet' },
        { pseudo: 'Julie_Xiaomi', avatar: '🐱', scooter: 'Xiaomi Pro 2', color: '#f59e0b', status: 'Balade matinale 🌅', speed: 17, battery: 62, trip: 'Nation → Opéra' },
        { pseudo: 'Romain_Dualtron', avatar: '🦅', scooter: 'Dualtron Thunder', color: '#3b82f6', status: 'Livraison express 📦', speed: 24, battery: 91, trip: 'République → Pigalle' },
        { pseudo: 'Sara_Lime', avatar: '🌸', scooter: 'Lime Gen4', color: '#ec4899', status: 'Touriste curieuse 🗺️', speed: 14, battery: 47, trip: 'Tour Eiffel → Louvre' },
        { pseudo: 'Kevin_Trott', avatar: '🏄', scooter: 'Segway F40', color: '#8b5cf6', status: 'Course chrono ⏱️', speed: 23, battery: 78, trip: 'Gare de Lyon → Bastille' },
        { pseudo: 'Ines_Verte', avatar: '🦋', scooter: 'Ninebot E45', color: '#06b6d4', status: 'Sur les berges 🌿', speed: 16, battery: 55, trip: 'Berges Seine → Châtelet' }
      ];

      this.users = PROFILES.map((p, i) => {
        const angle = (i / PROFILES.length) * Math.PI * 2;
        const r = 0.004 + Math.random() * 0.006;
        return {
          ...p,
          id: `user-${i}`,
          lat: centerLat + Math.sin(angle) * r,
          lng: centerLng + Math.cos(angle) * r,
          heading: Math.random() * 360,
          lastInteraction: null
        };
      });

      this.renderAllMarkers();
      this.startMovement();
      this.scheduleIncomingEvents();
    }

    renderAllMarkers() {
      this.markers.forEach(m => this.map.removeLayer(m));
      this.markers.clear();
      this.users.forEach(user => this.renderUserMarker(user));
    }

    renderUserMarker(user) {
      if (this.markers.has(user.id)) {
        this.map.removeLayer(this.markers.get(user.id));
      }
      const icon = L.divIcon({
        className: '',
        html: `
          <div class="trottier-marker" style="border-color:${user.color};" title="Cliquer pour interagir avec ${user.pseudo}">
            <div class="trottier-avatar">${user.avatar}</div>
            <div class="trottier-tag" style="background:${user.color};">${user.pseudo.split('_')[0]}</div>
            <div class="trottier-speed">${user.speed} km/h</div>
          </div>
        `,
        iconSize: [52, 52],
        iconAnchor: [26, 26]
      });
      const marker = L.marker([user.lat, user.lng], { icon, zIndexOffset: 500 }).addTo(this.map);
      marker.on('click', () => {
        if (this.onUserClick) this.onUserClick(user);
      });
      this.markers.set(user.id, marker);
    }

    startMovement() {
      if (this.moveInterval) clearInterval(this.moveInterval);
      this.moveInterval = setInterval(() => {
        this.users.forEach(user => {
          const rad = user.heading * Math.PI / 180;
          const dist = (user.speed / 3600) * 3 * 0.00001;
          user.lat += Math.cos(rad) * dist;
          user.lng += Math.sin(rad) * dist;
          // petite déviation aléatoire
          user.heading += (Math.random() - 0.5) * 15;
          // vitesse fluctuante
          user.speed = Math.max(10, Math.min(25, user.speed + (Math.random() - 0.5) * 2));
          this.renderUserMarker(user);
        });
      }, 3000);
    }

    stopMovement() {
      if (this.moveInterval) clearInterval(this.moveInterval);
      if (this.incomingInterval) clearInterval(this.incomingInterval);
    }

    scheduleIncomingEvents() {
      const socialEvents = [
        { type: 'wave', text: 'vous fait un grand coucou ! 👋', icon: '👋' },
        { type: 'bell', text: 'Dring Dring ! 🔔', icon: '🔔' },
        { type: 'warn', text: 'signale un obstacle devant vous ! ⚠️', icon: '🚨' },
        { type: 'help', text: 'demande de l\'aide ⚡ (batterie faible ?)', icon: '⚡' }
      ];
      if (this.incomingInterval) clearInterval(this.incomingInterval);
      this.incomingInterval = setInterval(() => {
        if (this.users.length === 0) return;
        const user = this.users[Math.floor(Math.random() * this.users.length)];
        const ev = socialEvents[Math.floor(Math.random() * socialEvents.length)];
        if (window.trottiApp) {
          window.trottiApp.handleIncomingSocialEvent(user, ev.type, ev.text, ev.icon);
        }
      }, 20000 + Math.random() * 15000);
    }

    sendSocialEvent(targetUser, type) {
      const msgs = {
        wave: '👋 Coucou envoyé !',
        bell: '🔔 Dring Dring ! Sonnette envoyée !',
        help: '⚡ Demande d\'aide envoyée !',
        warn: '🚨 Alerte danger envoyée !'
      };
      return msgs[type] || 'Message envoyé !';
    }

    getUserCount() {
      return this.users.length;
    }
  }

  // =========================================================================
  // 4. Routing Engine
  // =========================================================================
  class RoutingEngine {
    async searchAddress(query) {
      if (!query || query.trim().length < 2) return null;
      const presets = {
        'châtelet': { lat: 48.8584, lng: 2.3470, label: 'Châtelet - Les Halles, Paris' },
        'chatelet': { lat: 48.8584, lng: 2.3470, label: 'Châtelet - Les Halles, Paris' },
        'bastille': { lat: 48.8531, lng: 2.3698, label: 'Place de la Bastille, Paris' },
        'république': { lat: 48.8675, lng: 2.3638, label: 'Place de la République, Paris' },
        'republique': { lat: 48.8675, lng: 2.3638, label: 'Place de la République, Paris' },
        'gare de lyon': { lat: 48.8448, lng: 2.3735, label: 'Gare de Lyon, Paris' },
        'tour eiffel': { lat: 48.8584, lng: 2.2945, label: 'Tour Eiffel, Paris' },
        'nation': { lat: 48.8482, lng: 2.3959, label: 'Place de la Nation, Paris' },
        'opéra': { lat: 48.8724, lng: 2.3316, label: 'Opéra Garnier, Paris' },
        'opera': { lat: 48.8724, lng: 2.3316, label: 'Opéra Garnier, Paris' },
        'montmartre': { lat: 48.8867, lng: 2.3431, label: 'Montmartre, Paris' },
        'louvre': { lat: 48.8606, lng: 2.3376, label: 'Musée du Louvre, Paris' }
      };
      const clean = query.toLowerCase().trim();
      for (const [key, val] of Object.entries(presets)) {
        if (clean.includes(key)) return val;
      }
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=fr`;
        const res = await fetch(url, { headers: { 'User-Agent': 'TrottiWaze-ScooterApp/1.0' } });
        const data = await res.json();
        if (data && data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
      } catch (e) {}
      return null;
    }

    async getAddressSuggestions(query) {
      if (!query || query.trim().length < 2) return [];
      const clean = query.trim().toLowerCase();
      const results = [];
      const seen = new Set();

      const localPresets = [
        { name: 'Rue de Rivoli', city: 'Paris (75004)', full: 'Rue de Rivoli, 75004 Paris', lat: 48.8575, lng: 2.3518, type: 'cycleway', tag: 'Piste bidirectionnelle' },
        { name: 'Boulevard Voltaire', city: 'Paris (75011)', full: 'Boulevard Voltaire, 75011 Paris', lat: 48.8568, lng: 2.3789, type: 'cycleway', tag: 'Piste protégée' },
        { name: 'Boulevard de Sébastopol', city: 'Paris (75003)', full: 'Boulevard de Sébastopol, 75003 Paris', lat: 48.8631, lng: 2.3533, type: 'cycleway', tag: 'Axe express vélo' },
        { name: 'Canal Saint-Martin', city: 'Paris (75010)', full: 'Canal Saint-Martin, 75010 Paris', lat: 48.8715, lng: 2.3665, type: 'cycleway', tag: 'Voie verte apaisée' },
        { name: 'Place de la Bastille', city: 'Paris (75004/75011)', full: 'Place de la Bastille, Paris', lat: 48.8531, lng: 2.3698, type: 'poi', tag: 'Hub cyclable' },
        { name: 'Châtelet - Les Halles', city: 'Paris (75001)', full: 'Châtelet - Les Halles, Paris', lat: 48.8584, lng: 2.3470, type: 'poi', tag: 'Centre Paris' },
        { name: 'Place de la République', city: 'Paris (75011)', full: 'Place de la République, Paris', lat: 48.8675, lng: 2.3638, type: 'poi', tag: 'Grand carrefour vélo' },
        { name: 'Place de la Nation', city: 'Paris (75012)', full: 'Place de la Nation, Paris', lat: 48.8482, lng: 2.3959, type: 'poi', tag: 'Anneau cyclable' },
        { name: 'Gare de Lyon', city: 'Paris (75012)', full: 'Gare de Lyon, Paris', lat: 48.8448, lng: 2.3735, type: 'poi', tag: 'Gare & Station trottinette' },
        { name: 'Tour Eiffel', city: 'Paris (75007)', full: 'Tour Eiffel (Champ de Mars), Paris', lat: 48.8584, lng: 2.2945, type: 'poi', tag: 'Quais de Seine' },
        { name: 'Berges du Rhône', city: 'Lyon (69007)', full: 'Berges du Rhône, 69007 Lyon', lat: 45.7538, lng: 4.8423, type: 'cycleway', tag: 'Voie lyonnaise 1' },
        { name: 'Place Bellecour', city: 'Lyon (69002)', full: 'Place Bellecour, 69002 Lyon', lat: 45.7578, lng: 4.8320, type: 'city', tag: 'Centre Lyon' },
        { name: 'Vieux Port', city: 'Marseille (13001)', full: 'Vieux-Port de Marseille, 13001 Marseille', lat: 43.2951, lng: 5.3744, type: 'poi', tag: 'Zone piétonne' },
        { name: 'Quais de Garonne', city: 'Bordeaux (33000)', full: 'Quais de Garonne, 33000 Bordeaux', lat: 44.8412, lng: -0.5694, type: 'cycleway', tag: 'Piste cyclable fluviale' },
        { name: 'Place du Capitole', city: 'Toulouse (31000)', full: 'Place du Capitole, 31000 Toulouse', lat: 43.6045, lng: 1.4442, type: 'city', tag: 'Centre Toulouse' },
        { name: 'Promenade des Anglais', city: 'Nice (06000)', full: 'Promenade des Anglais, 06000 Nice', lat: 43.6953, lng: 7.2562, type: 'cycleway', tag: 'Piste maritime' },
        { name: 'Grand Place', city: 'Lille (59800)', full: 'Grand Place, 59800 Lille', lat: 50.6370, lng: 3.0634, type: 'city', tag: 'Centre Lille' },
        { name: 'Place Kléber', city: 'Strasbourg (67000)', full: 'Place Kléber, 67000 Strasbourg', lat: 48.5834, lng: 7.7455, type: 'city', tag: 'Capitale du vélo' },
        { name: 'Place Royale', city: 'Nantes (44000)', full: 'Place Royale, 44000 Nantes', lat: 47.2144, lng: -1.5583, type: 'city', tag: 'Centre Nantes' }
      ];

      for (const p of localPresets) {
        if (p.name.toLowerCase().includes(clean) || p.city.toLowerCase().includes(clean) || p.full.toLowerCase().includes(clean)) {
          seen.add(p.full.toLowerCase());
          results.push({ mainText: p.name, subText: p.city, fullLabel: p.full, lat: p.lat, lng: p.lng, type: p.type, tag: p.tag });
        }
      }

      try {
        const banUrl = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=6&autocomplete=1`;
        const res = await fetch(banUrl);
        if (res.ok) {
          const data = await res.json();
          if (data && data.features) {
            data.features.forEach(f => {
              const props = f.properties;
              const full = props.label;
              if (!seen.has(full.toLowerCase())) {
                seen.add(full.toLowerCase());
                let iconType = props.type === 'municipality' ? 'city' : props.type === 'housenumber' ? 'address' : /piste|voie|boulevard|quai|cours/i.test(props.name) ? 'cycleway' : 'street';
                let tag = props.type === 'municipality' ? 'Ville' : props.type === 'housenumber' ? 'Adresse' : null;
                results.push({ mainText: props.name || props.label, subText: props.context || `${props.postcode || ''} ${props.city || ''}`, fullLabel: props.label, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], type: iconType, tag });
              }
            });
          }
        }
      } catch (e) {}

      if (results.length < 3) {
        try {
          const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=4&countrycodes=fr`;
          const res = await fetch(nomUrl, { headers: { 'User-Agent': 'TrottiWaze-ScooterApp/1.0' } });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              data.forEach(item => {
                if (!seen.has(item.display_name.toLowerCase())) {
                  seen.add(item.display_name.toLowerCase());
                  const parts = item.display_name.split(',');
                  results.push({ mainText: parts[0], subText: parts.slice(1, 3).join(',').trim() || item.display_name, fullLabel: item.display_name, lat: parseFloat(item.lat), lng: parseFloat(item.lon), type: 'poi', tag: 'Point d\'intérêt' });
                }
              });
            }
          }
        } catch (e) {}
      }

      return results.slice(0, 7);
    }

    async calculateRoutes(startCoords, endCoords) {
      let liveRoute = null;
      try {
        const osrmUrl = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}?overview=full&geometries=geojson&steps=true`;
        const res = await fetch(osrmUrl);
        if (res.ok) {
          const json = await res.json();
          if (json.routes && json.routes.length > 0) liveRoute = json.routes[0];
        }
      } catch (e) {}
      return this.buildTrottiRoutes(startCoords, endCoords, liveRoute);
    }

    buildTrottiRoutes(start, end, osrmBase = null) {
      let baseCoordinates = [];
      let baseDistanceKm = 0;
      let baseSteps = [];

      if (osrmBase && osrmBase.geometry && osrmBase.geometry.coordinates) {
        baseCoordinates = osrmBase.geometry.coordinates.map(c => [c[1], c[0]]);
        baseDistanceKm = osrmBase.distance / 1000;
        if (osrmBase.legs && osrmBase.legs[0] && osrmBase.legs[0].steps) {
          baseSteps = osrmBase.legs[0].steps.map(s => ({
            instruction: s.maneuver.type === 'arrive' ? 'Vous êtes arrivé à destination' : (s.name ? `Prenez ${s.name}` : 'Continuez tout droit'),
            distanceMeters: Math.round(s.distance),
            street: s.name || 'Piste cyclable sécurisée',
            modifier: s.maneuver.modifier || 'straight',
            type: s.maneuver.type || 'continue',
            safety: '🛡️ Piste cyclable protégée'
          }));
        }
      }

      if (baseCoordinates.length === 0) {
        const generated = this.interpolateRealisticCycleRoute(start, end);
        baseCoordinates = generated.coords;
        baseDistanceKm = generated.distanceKm;
        baseSteps = generated.steps;
      }

      const safeDist = parseFloat((baseDistanceKm * 1.05).toFixed(1));
      const fastDist = parseFloat((baseDistanceKm * 0.92).toFixed(1));
      const ecoDist = parseFloat((baseDistanceKm * 1.12).toFixed(1));
      const natureDist = parseFloat((baseDistanceKm * 1.22).toFixed(1));

      return {
        safe: {
          mode: 'safe', title: '🟢 Sécurisé', subtitle: 'Pistes protégées & Voies vertes',
          coordinates: baseCoordinates,
          distanceKm: safeDist, durationMin: Math.round(safeDist / 20 * 60) + 1,
          cyclewayPercent: 92, protectedPct: 92, lanePct: 6, sharedPct: 2,
          cobblestonesAvoided: 4, elevationGainM: 12, elevationLossM: 8, maxSlopePct: 3.2,
          elevationProfile: this.generateElevationProfile(safeDist, 35, 12, 'safe'),
          safetyBadge: '92% Séparateur physique béton/bordure', badgeClass: 'green', steps: baseSteps
        },
        fast: {
          mode: 'fast', title: '⚡ Rapide', subtitle: 'Le plus court à 25 km/h',
          coordinates: this.slightlyDirectRoute(baseCoordinates),
          distanceKm: fastDist, durationMin: Math.round(fastDist / 24 * 60) + 1,
          cyclewayPercent: 58, protectedPct: 58, lanePct: 27, sharedPct: 15,
          cobblestonesAvoided: 1, elevationGainM: 19, elevationLossM: 15, maxSlopePct: 5.6,
          elevationProfile: this.generateElevationProfile(fastDist, 35, 19, 'fast'),
          safetyBadge: 'Couloirs bus/vélo & Bandes cyclables', badgeClass: 'neutral', steps: baseSteps
        },
        eco: {
          mode: 'eco', title: '🔋 Éco & Plat', subtitle: 'Dénivelé minimal, préserve la batterie',
          coordinates: this.flatRoute(baseCoordinates),
          distanceKm: ecoDist, durationMin: Math.round(ecoDist / 19 * 60) + 2,
          cyclewayPercent: 86, protectedPct: 86, lanePct: 11, sharedPct: 3,
          cobblestonesAvoided: 5, elevationGainM: 3, elevationLossM: 2, maxSlopePct: 1.6,
          elevationProfile: this.generateElevationProfile(ecoDist, 32, 3, 'eco'),
          safetyBadge: 'Pente < 2% • Zéro effort moteur', badgeClass: 'cyan', steps: baseSteps
        },
        nature: {
          mode: 'nature', title: '🌳 Voies Vertes', subtitle: 'Le long de l\'eau, détente et grand air',
          coordinates: this.scenicRoute(baseCoordinates),
          distanceKm: natureDist, durationMin: Math.round(natureDist / 18 * 60) + 3,
          cyclewayPercent: 96, protectedPct: 96, lanePct: 4, sharedPct: 0,
          cobblestonesAvoided: 6, elevationGainM: 5, elevationLossM: 4, maxSlopePct: 2.1,
          elevationProfile: this.generateElevationProfile(natureDist, 30, 5, 'nature'),
          safetyBadge: '100% Hors circulation automobile', badgeClass: 'emerald', steps: baseSteps
        }
      };
    }

    generateElevationProfile(totalKm, startAlt = 35, gainM = 10, type = 'safe') {
      const points = [];
      const count = 12;
      for (let i = 0; i <= count; i++) {
        const dist = parseFloat(((i / count) * totalKm).toFixed(2));
        let alt = startAlt;
        if (type === 'fast') alt += Math.sin((i / count) * Math.PI) * gainM + Math.sin(i * 1.2) * 2;
        else if (type === 'eco') alt += (i / count) * gainM * 0.4;
        else alt += Math.sin((i / count) * Math.PI) * (gainM * 0.85);
        const slope = i === 0 ? 0 : parseFloat((((alt - points[i-1].altM) / (totalKm / count * 1000)) * 100).toFixed(1));
        points.push({ distKm: dist, altM: Math.round(alt), slopePct: Math.abs(slope) });
      }
      return points;
    }

    slightlyDirectRoute(baseCoords) {
      return baseCoords.filter((_, i) => i % 2 === 0 || i === baseCoords.length - 1);
    }

    flatRoute(baseCoords) {
      return baseCoords.map(([lat, lng], idx) => [lat + Math.sin(idx * 0.3) * 0.0003, lng]);
    }

    scenicRoute(baseCoords) {
      return baseCoords.map(([lat, lng], idx) => [lat - 0.0012 + Math.sin(idx * 0.5) * 0.0004, lng - 0.0008 + Math.cos(idx * 0.5) * 0.0004]);
    }

    interpolateRealisticCycleRoute(start, end) {
      const latDiff = end.lat - start.lat;
      const lngDiff = end.lng - start.lng;
      const numPoints = 28;
      const coords = [];
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const wobble = Math.sin(t * Math.PI) * 0.0035;
        const lat = start.lat + latDiff * t + wobble * (lngDiff > 0 ? 0.3 : -0.3);
        const lng = start.lng + lngDiff * t - wobble * 0.6;
        coords.push([lat, lng]);
      }
      const approxDistKm = parseFloat((Math.sqrt(latDiff**2 + lngDiff**2) * 111 * 1.3).toFixed(1)) || 3.2;
      const steps = [
        { instruction: 'Prenez la piste cyclable protégée tout droit', distanceMeters: 250, street: 'Piste cyclable Bd Voltaire', modifier: 'straight', safety: '🛡️ Piste séparée des voitures' },
        { instruction: 'Au carrefour, tournez à droite sur la voie verte', distanceMeters: 600, street: 'Rue de Rivoli (Coronapiste)', modifier: 'right', safety: '🟢 Voie 100% réservée trottinettes & vélos' },
        { instruction: 'Continuez sur 1.2 km tout droit le long de la piste', distanceMeters: 1200, street: 'Axe Cyclable Majeur', modifier: 'straight', safety: '🛡️ Séparateur béton' },
        { instruction: 'Tournez légèrement à gauche vers votre destination', distanceMeters: 350, street: 'Zone 30 partagée', modifier: 'left', safety: '🟡 Zone apaisée, piétons prioritaires' },
        { instruction: 'Vous êtes arrivé à votre destination !', distanceMeters: 50, street: 'Point d\'arrivée', modifier: 'arrive', safety: '🏁 Arrivée trottinette' }
      ];
      return { coords, distanceKm: approxDistKm, steps };
    }
  }

  // =========================================================================
  // 5. Map Manager
  // =========================================================================
  class MapManager {
    constructor(containerId = 'map') {
      this.containerId = containerId;
      this.map = null;
      this.scooterMarker = null;
      this.routePolylines = [];
      this.startMarker = null;
      this.endMarker = null;
      this.activeLayerIndex = 0;
      this.defaultCenter = [48.8531, 2.3698];
      this.currentLocation = { lat: 48.8531, lng: 2.3698, heading: 90, speed: 0 };
      this.initMap();
    }

    initMap() {
      this.map = L.map(this.containerId, {
        center: this.defaultCenter, zoom: 15, zoomControl: false, attributionControl: false
      });
      L.control.attribution({ position: 'bottomleft' })
        .addAttribution('&copy; <a href="https://www.cyclosm.org" target="_blank">CyclOSM</a> | &copy; OpenStreetMap')
        .addTo(this.map);
      L.control.zoom({ position: 'topleft' }).addTo(this.map);

      this.tileLayers = [
        L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', { maxZoom: 20, subdomains: 'abc' }),
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd' }),
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
      ];
      this.tileLayers[0].addTo(this.map);
      this.createScooterMarker(this.defaultCenter[0], this.defaultCenter[1]);
    }

    cycleTileLayer() {
      this.map.removeLayer(this.tileLayers[this.activeLayerIndex]);
      this.activeLayerIndex = (this.activeLayerIndex + 1) % this.tileLayers.length;
      this.tileLayers[this.activeLayerIndex].addTo(this.map);
      return ['🚲 Pistes CyclOSM', '🌙 Mode Nuit Carto', '🗺️ Standard OSM'][this.activeLayerIndex];
    }

    createScooterMarker(lat, lng) {
      const icon = L.divIcon({
        className: 'scooter-leaflet-div',
        html: `<div id="trotti-scooter-pin" class="scooter-marker-container"><div class="scooter-beam"></div><div class="scooter-icon-pin">🛴</div></div>`,
        iconSize: [44, 44], iconAnchor: [22, 22]
      });
      this.scooterMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(this.map);
    }

    updateScooterPosition(lat, lng, heading = 0, speedKmh = 0) {
      this.currentLocation = { lat, lng, heading, speed: speedKmh };
      if (this.scooterMarker) {
        this.scooterMarker.setLatLng([lat, lng]);
        const pinEl = document.getElementById('trotti-scooter-pin');
        if (pinEl) pinEl.style.transform = `rotate(${heading}deg)`;
      }
    }

    recenter(zoom = 16) {
      if (this.currentLocation) {
        this.map.setView([this.currentLocation.lat, this.currentLocation.lng], zoom, { animate: true, pan: { duration: 0.5 } });
      }
    }

    drawRoute(coordinates, mode = 'safe') {
      this.clearRoute();
      if (!coordinates || coordinates.length === 0) return;
      const colors = { safe: ['rgba(16,185,129,0.4)', '#10b981'], fast: ['rgba(14,165,233,0.4)', '#0ea5e9'], eco: ['rgba(6,182,212,0.4)', '#06b6d4'], nature: ['rgba(132,204,22,0.4)', '#84cc16'] };
      const [glowColor, mainColor] = colors[mode] || colors.safe;

      const glowPolyline = L.polyline(coordinates, { color: glowColor, weight: 12, opacity: 0.8, lineCap: 'round', lineJoin: 'round' }).addTo(this.map);
      const mainPolyline = L.polyline(coordinates, { color: mainColor, weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round', dashArray: mode === 'fast' ? '8, 8' : null }).addTo(this.map);
      this.routePolylines.push(glowPolyline, mainPolyline);

      const startPoint = coordinates[0];
      const endPoint = coordinates[coordinates.length - 1];
      this.startMarker = L.marker(startPoint, { icon: L.divIcon({ className: 'route-point-marker', html: '<div style="background:#10b981;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>', iconSize: [20,20], iconAnchor: [10,10] }) }).addTo(this.map);
      this.endMarker = L.marker(endPoint, { icon: L.divIcon({ className: 'route-point-marker', html: '<div style="background:#ef4444;width:26px;height:26px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px rgba(239,68,68,0.7);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;">🏁</div>', iconSize: [26,26], iconAnchor: [13,13] }) }).addTo(this.map);
      this.map.fitBounds(mainPolyline.getBounds(), { padding: [80, 80] });
    }

    clearRoute() {
      this.routePolylines.forEach(l => this.map.removeLayer(l));
      this.routePolylines = [];
      if (this.startMarker) { this.map.removeLayer(this.startMarker); this.startMarker = null; }
      if (this.endMarker) { this.map.removeLayer(this.endMarker); this.endMarker = null; }
    }
  }

  // =========================================================================
  // 6. Navigation & Guidance Engine
  // =========================================================================
  class NavigationEngine {
    constructor(mapManager, hazardManager, batteryEngine, callbacks = {}) {
      this.mapManager = mapManager;
      this.hazardManager = hazardManager;
      this.batteryEngine = batteryEngine;
      this.callbacks = callbacks;
      this.isNavigating = false;
      this.isSimulating = false;
      this.simulationSpeedMultiplier = 1;
      this.voiceEnabled = true;
      this.synth = window.speechSynthesis || null;
      this.currentRoute = null;
      this.routePoints = [];
      this.currentPointIndex = 0;
      this.simulationTimer = null;
      this.lastSpokenStepIndex = -1;
      this.currentSpeed = 0;
      this.gpsWatchId = null;
    }

    startNavigation(route, simulate = false) {
      if (!route || !route.coordinates || route.coordinates.length === 0) return;
      this.currentRoute = route;
      this.routePoints = route.coordinates;
      this.currentPointIndex = 0;
      this.isNavigating = true;
      this.lastSpokenStepIndex = -1;
      this.speak(`Itinéraire sélectionné : ${route.title}. ${route.distanceKm} kilomètres, environ ${route.durationMin} minutes. Suivez les pistes cyclables.`);
      if (simulate) this.startSimulation();
      else this.watchRealGPS();
    }

    stopNavigation() {
      this.isNavigating = false;
      this.isSimulating = false;
      if (this.simulationTimer) { clearInterval(this.simulationTimer); this.simulationTimer = null; }
      if (this.gpsWatchId) { navigator.geolocation.clearWatch(this.gpsWatchId); this.gpsWatchId = null; }
      this.currentSpeed = 0;
      if (this.callbacks.onSpeedUpdate) this.callbacks.onSpeedUpdate(0);
      this.speak('Navigation terminée.');
    }

    setVoiceEnabled(enabled) {
      this.voiceEnabled = enabled;
      if (!enabled && this.synth) this.synth.cancel();
    }

    speak(text) {
      if (!this.voiceEnabled || !this.synth) return;
      try {
        this.synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'fr-FR'; utterance.rate = 1.05;
        const voices = this.synth.getVoices();
        const frVoice = voices.find(v => v.lang.startsWith('fr'));
        if (frVoice) utterance.voice = frVoice;
        this.synth.speak(utterance);
      } catch (e) {}
    }

    startSimulation() {
      this.isSimulating = true;
      const totalPoints = this.routePoints.length;
      if (this.simulationTimer) clearInterval(this.simulationTimer);
      const [startLat, startLng] = this.routePoints[0];
      this.mapManager.updateScooterPosition(startLat, startLng, 90, 0);
      this.mapManager.recenter(17);
      let progressFraction = 0;

      this.simulationTimer = setInterval(() => {
        if (!this.isNavigating || !this.isSimulating) return;
        if (this.currentPointIndex >= totalPoints - 1) { this.arrive(); return; }

        const p1 = this.routePoints[this.currentPointIndex];
        const p2 = this.routePoints[this.currentPointIndex + 1];
        const heading = this.calculateBearing(p1[0], p1[1], p2[0], p2[1]);

        progressFraction += 0.08 * this.simulationSpeedMultiplier;
        if (progressFraction >= 1) { progressFraction = 0; this.currentPointIndex++; }

        const currentLat = p1[0] + (p2[0] - p1[0]) * progressFraction;
        const currentLng = p1[1] + (p2[1] - p1[1]) * progressFraction;
        const baseKmh = 22 + Math.sin(Date.now() / 1500) * 2.5;
        this.currentSpeed = Math.min(25, Math.max(12, baseKmh));

        this.mapManager.updateScooterPosition(currentLat, currentLng, heading, Math.round(this.currentSpeed));
        this.mapManager.map.panTo([currentLat, currentLng], { animate: false });

        const remainingFraction = 1 - (this.currentPointIndex / totalPoints);
        const remainingDistKm = (parseFloat(this.currentRoute.distanceKm) * remainingFraction).toFixed(1);
        const remainingMin = Math.max(1, Math.round(parseFloat(this.currentRoute.durationMin) * remainingFraction));

        this.updateStepInstruction(this.currentPointIndex, totalPoints);

        const hazardNear = this.hazardManager.checkProximity(currentLat, currentLng);
        if (hazardNear && hazardNear.isFresh && this.callbacks.onHazardNear) {
          this.callbacks.onHazardNear(hazardNear);
          this.speak(hazardNear.config.audioText);
        }

        const batteryStatus = this.batteryEngine.estimateTrip(parseFloat(remainingDistKm));
        if (this.callbacks.onSpeedUpdate) this.callbacks.onSpeedUpdate(Math.round(this.currentSpeed));
        if (this.callbacks.onTripUpdate) this.callbacks.onTripUpdate({ remainingDistKm, remainingMin, batteryStatus });
      }, 200);
    }

    setSimulationSpeed(multiplier) { this.simulationSpeedMultiplier = multiplier; }

    updateStepInstruction(pointIndex, totalPoints) {
      const steps = this.currentRoute.steps || [];
      if (steps.length === 0) return;
      const stepIdx = Math.min(steps.length - 1, Math.floor((pointIndex / totalPoints) * steps.length));
      const step = steps[stepIdx];
      if (stepIdx !== this.lastSpokenStepIndex) {
        this.lastSpokenStepIndex = stepIdx;
        if (this.callbacks.onStepUpdate) this.callbacks.onStepUpdate(step);
        this.speak(step.instruction);
      }
    }

    arrive() {
      this.isNavigating = false; this.isSimulating = false;
      if (this.simulationTimer) clearInterval(this.simulationTimer);
      this.currentSpeed = 0;
      if (this.callbacks.onSpeedUpdate) this.callbacks.onSpeedUpdate(0);
      this.speak('Vous êtes arrivé à votre destination en trottinette. Pensez à attacher votre engin avec un antivol solide !');
      if (this.callbacks.onArrival) this.callbacks.onArrival();
    }

    watchRealGPS() {
      if (!navigator.geolocation) { alert('La géolocalisation n\'est pas supportée.'); return; }
      this.gpsWatchId = navigator.geolocation.watchPosition(
        pos => {
          const { latitude, longitude, speed, heading } = pos.coords;
          const speedKmh = speed ? Math.round(speed * 3.6) : 0;
          this.currentSpeed = speedKmh;
          this.mapManager.updateScooterPosition(latitude, longitude, heading || 0, speedKmh);
          this.mapManager.recenter();
          if (this.callbacks.onSpeedUpdate) this.callbacks.onSpeedUpdate(speedKmh);
          const hazardNear = this.hazardManager.checkProximity(latitude, longitude);
          if (hazardNear && hazardNear.isFresh && this.callbacks.onHazardNear) {
            this.callbacks.onHazardNear(hazardNear);
            this.speak(hazardNear.config.audioText);
          }
        },
        err => console.warn('GPS error', err),
        { enableHighAccuracy: true, maximumAge: 1000 }
      );
    }

    calculateBearing(lat1, lon1, lat2, lon2) {
      const y = Math.sin((lon2-lon1)*Math.PI/180) * Math.cos(lat2*Math.PI/180);
      const x = Math.cos(lat1*Math.PI/180) * Math.sin(lat2*Math.PI/180) - Math.sin(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.cos((lon2-lon1)*Math.PI/180);
      return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
    }
  }

  // =========================================================================
  // 7. Main Application - TrottiWazeApp
  // =========================================================================
  class TrottiWazeApp {
    constructor() {
      this.mapManager = new MapManager('map');
      this.routingEngine = new RoutingEngine();
      this.hazardManager = new HazardManager(this.mapManager.map);
      this.batteryEngine = new BatteryEngine();
      this.userManager = new UserManager(this.mapManager.map, (user) => this.openUserProfileModal(user));

      this.selectedRouteMode = 'safe';
      this.calculatedRoutes = null;
      this.selectedHazardType = null;
      this.isVoiceMuted = false;
      this.activeModalUser = null;

      this.navigationEngine = new NavigationEngine(
        this.mapManager, this.hazardManager, this.batteryEngine,
        {
          onSpeedUpdate: (speed) => this.handleSpeedUpdate(speed),
          onStepUpdate: (step) => this.handleStepUpdate(step),
          onTripUpdate: (trip) => this.handleTripUpdate(trip),
          onHazardNear: (hzAlert) => this.handleHazardProximity(hzAlert),
          onArrival: () => this.handleArrival()
        }
      );

      window.trottiApp = this;
      this.initDOM();
      this.initEvents();
      this.hazardManager.renderMarkers();
      this.calculateCurrentRoute();
      this.updateBatteryWidget();
      this.initWeatherBar();

      // Init nearby users after map is ready
      setTimeout(() => {
        this.userManager.initNearbyUsers(48.8531, 2.3698);
        document.getElementById('radar-user-count').textContent = this.userManager.getUserCount();
      }, 500);
    }

    initDOM() {
      this.elStartInput = document.getElementById('start-input');
      this.elEndInput = document.getElementById('end-input');
      this.elRoutePanel = document.getElementById('route-panel');
      this.elNavBanner = document.getElementById('nav-banner');
      this.elHazardAlert = document.getElementById('hazard-proximity-alert');
      this.elSimuController = document.getElementById('simu-controller');
      this.elReportFab = document.getElementById('btn-report-hazard');

      this.elSpeedVal = document.getElementById('hud-speed-val');
      this.elSpeedCircle = document.getElementById('speed-circle-bar');
      this.elSpeedBox = document.querySelector('.hud-speedometer-box');
      this.elHudEta = document.getElementById('hud-eta');
      this.elHudTimeRem = document.getElementById('hud-time-rem');
      this.elHudDistRem = document.getElementById('hud-dist-rem');
      this.elBatteryFill = document.getElementById('hud-battery-fill');
      this.elBatteryPercent = document.getElementById('hud-battery-percent');
      this.elBatteryArrival = document.getElementById('hud-battery-arrival');

      this.elNavDistance = document.getElementById('nav-step-distance');
      this.elNavStreet = document.getElementById('nav-step-street');
      this.elNavSafety = document.getElementById('nav-step-type');
      this.elNavIcon = document.getElementById('nav-turn-icon');

      this.elReportModal = document.getElementById('report-modal');
      this.elBatteryModal = document.getElementById('battery-modal');
      this.elUserModal = document.getElementById('user-profile-modal');

      this.elStartSuggestions = document.getElementById('start-suggestions');
      this.elEndSuggestions = document.getElementById('end-suggestions');
    }

    initEvents() {
      // Autocomplete départ & arrivée
      this.setupAutocomplete(this.elStartInput, this.elStartSuggestions, (coords, label) => {
        this.selectedStartCoords = coords;
        this.lastStartLabel = label;
        this.elStartInput.value = label;
        this.calculateCurrentRoute();
      });

      this.setupAutocomplete(this.elEndInput, this.elEndSuggestions, (coords, label) => {
        this.selectedEndCoords = coords;
        this.lastEndLabel = label;
        this.elEndInput.value = label;
        this.calculateCurrentRoute();
      });

      // Thème
      document.getElementById('btn-toggle-theme').addEventListener('click', () => {
        document.body.classList.toggle('theme-light');
        document.body.classList.toggle('theme-dark');
        document.getElementById('btn-toggle-theme').textContent = document.body.classList.contains('theme-light') ? '☀️' : '🌙';
      });

      // Couches de carte
      document.getElementById('btn-layers').addEventListener('click', () => {
        const name = this.mapManager.cycleTileLayer();
        this.showToast(`Fond de carte : ${name}`);
      });

      // Recentrer
      document.getElementById('btn-recenter').addEventListener('click', () => this.mapManager.recenter());

      // Sonnette cockpit
      document.getElementById('btn-cockpit-bell').addEventListener('click', () => {
        this.hazardManager.playCockpitBell();
        const btn = document.getElementById('btn-cockpit-bell');
        btn.classList.add('bell-ringing');
        this.showToast('🔔 Dring Dring !');
        setTimeout(() => btn.classList.remove('bell-ringing'), 600);
      });

      // Chips de destination rapide
      document.querySelectorAll('.quick-chips .chip').forEach(chip => {
        chip.addEventListener('click', () => {
          this.selectedEndCoords = null;
          this.elEndInput.value = chip.getAttribute('data-dest');
          this.calculateCurrentRoute();
        });
      });

      // Cartes de route
      document.querySelectorAll('.route-card').forEach(card => {
        card.addEventListener('click', () => {
          document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          this.selectedRouteMode = card.getAttribute('data-mode');
          this.applySelectedRoute();
        });
      });

      // Inputs de destination
      this.elEndInput.addEventListener('change', () => this.calculateCurrentRoute());
      document.getElementById('btn-clear-dest').addEventListener('click', () => {
        this.elEndInput.value = '';
        this.selectedEndCoords = null;
        this.elEndInput.focus();
      });

      // Inverser start/fin
      document.getElementById('btn-swap-locations').addEventListener('click', () => {
        const temp = this.elStartInput.value;
        this.elStartInput.value = this.elEndInput.value;
        this.elEndInput.value = temp;
        const tempCoords = this.selectedStartCoords;
        this.selectedStartCoords = this.selectedEndCoords;
        this.selectedEndCoords = tempCoords;
        this.calculateCurrentRoute();
      });

      // GPS
      document.getElementById('btn-use-gps').addEventListener('click', () => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              const { latitude, longitude } = pos.coords;
              this.selectedStartCoords = { lat: latitude, lng: longitude };
              this.mapManager.updateScooterPosition(latitude, longitude, 0, 0);
              this.mapManager.recenter();
              this.elStartInput.value = `GPS (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
              this.calculateCurrentRoute();
              this.showToast('📍 Position GPS acquise');
            },
            err => this.showToast('GPS indisponible : ' + err.message)
          );
        }
      });

      // Navigation
      document.getElementById('btn-start-nav').addEventListener('click', () => this.beginTrip(false));
      document.getElementById('btn-start-simu').addEventListener('click', () => this.beginTrip(true));
      document.getElementById('btn-stop-nav').addEventListener('click', () => this.endTrip());

      // Simulateur
      document.getElementById('btn-simu-pause').addEventListener('click', (e) => {
        const isPaused = this.navigationEngine.simulationSpeedMultiplier === 0;
        this.navigationEngine.setSimulationSpeed(isPaused ? 1 : 0);
        e.target.textContent = isPaused ? '⏸ Pause' : '▶ Reprendre';
      });
      document.getElementById('btn-simu-1x').addEventListener('click', (e) => this.setSimSpeed(1, e.target));
      document.getElementById('btn-simu-2x').addEventListener('click', (e) => this.setSimSpeed(2, e.target));
      document.getElementById('btn-simu-4x').addEventListener('click', (e) => this.setSimSpeed(4, e.target));
      document.getElementById('btn-simu-stop').addEventListener('click', () => this.endTrip());

      // Voix
      document.getElementById('btn-toggle-voice').addEventListener('click', () => {
        this.isVoiceMuted = !this.isVoiceMuted;
        this.navigationEngine.setVoiceEnabled(!this.isVoiceMuted);
        document.getElementById('btn-toggle-voice').textContent = this.isVoiceMuted ? '🔇' : '🔊';
      });

      // Signalement
      this.elReportFab.addEventListener('click', () => this.openReportModal());
      document.getElementById('btn-close-report').addEventListener('click', () => this.elReportModal.style.display = 'none');
      document.querySelectorAll('.hazard-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.hazard-choice-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.selectedHazardType = btn.getAttribute('data-type');
          document.getElementById('btn-submit-report').disabled = false;
        });
      });
      document.getElementById('btn-submit-report').addEventListener('click', () => this.submitHazardReport());

      // Batterie
      document.getElementById('btn-battery-settings').addEventListener('click', () => this.elBatteryModal.style.display = 'flex');
      document.getElementById('hud-battery-container').addEventListener('click', () => this.elBatteryModal.style.display = 'flex');
      document.getElementById('btn-close-battery').addEventListener('click', () => this.elBatteryModal.style.display = 'none');

      const elPctRange = document.getElementById('scooter-battery-pct');
      elPctRange.addEventListener('input', (e) => document.getElementById('val-battery-pct').textContent = e.target.value + '%');
      const elWeightRange = document.getElementById('scooter-rider-weight');
      elWeightRange.addEventListener('input', (e) => document.getElementById('val-rider-weight').textContent = e.target.value + ' kg');

      document.getElementById('btn-save-battery').addEventListener('click', () => {
        this.batteryEngine.saveSettings({
          currentPercentage: parseInt(elPctRange.value),
          batteryCapacityWh: parseInt(document.getElementById('scooter-capacity').value),
          riderWeightKg: parseInt(elWeightRange.value),
          speedPrefKmh: parseInt(document.getElementById('scooter-speed-pref').value)
        });
        this.updateBatteryWidget();
        this.elBatteryModal.style.display = 'none';
        this.showToast('✅ Paramètres batterie enregistrés');
      });

      // Alertes danger
      document.getElementById('btn-confirm-hazard').addEventListener('click', () => {
        if (this.currentActiveAlertHazardId) {
          this.hazardManager.upvote(this.currentActiveAlertHazardId);
          this.showToast('Merci ! Signalement confirmé 👍');
          this.elHazardAlert.style.display = 'none';
        }
      });
      document.getElementById('btn-dismiss-hazard').addEventListener('click', () => this.elHazardAlert.style.display = 'none');

      // Modal utilisateur
      document.getElementById('btn-close-user-modal').addEventListener('click', () => this.elUserModal.style.display = 'none');
      document.getElementById('btn-user-wave').addEventListener('click', () => this.sendSocialAction('wave'));
      document.getElementById('btn-user-bell').addEventListener('click', () => { this.hazardManager.playCockpitBell(); this.sendSocialAction('bell'); });
      document.getElementById('btn-user-help').addEventListener('click', () => this.sendSocialAction('help'));
      document.getElementById('btn-user-warn').addEventListener('click', () => this.sendSocialAction('warn'));

      // Fermer modals au click backdrop
      this.elReportModal.addEventListener('click', (e) => { if (e.target === this.elReportModal) this.elReportModal.style.display = 'none'; });
      this.elBatteryModal.addEventListener('click', (e) => { if (e.target === this.elBatteryModal) this.elBatteryModal.style.display = 'none'; });
      this.elUserModal.addEventListener('click', (e) => { if (e.target === this.elUserModal) this.elUserModal.style.display = 'none'; });
    }

    // -----------------------------------------------------------------------
    // Autocomplete addresses
    // -----------------------------------------------------------------------
    setupAutocomplete(inputEl, dropdownEl, onSelect) {
      let debounceTimer = null;
      let selectedIndex = -1;
      let currentSuggestions = [];

      const closeDropdown = () => {
        dropdownEl.style.display = 'none';
        dropdownEl.innerHTML = '';
        selectedIndex = -1;
        currentSuggestions = [];
      };

      const renderSuggestions = (suggestions, query) => {
        currentSuggestions = suggestions;
        selectedIndex = -1;
        dropdownEl.innerHTML = '';

        if (suggestions.length === 0) {
          dropdownEl.innerHTML = `<div class="suggestion-loading"><span>Aucune piste, rue ou ville trouvée</span></div>`;
          dropdownEl.style.display = 'block';
          return;
        }

        suggestions.forEach((item, idx) => {
          const itemEl = document.createElement('div');
          itemEl.className = 'suggestion-item';
          itemEl.setAttribute('data-index', idx);

          let iconEmoji = '📍';
          if (item.type === 'city') iconEmoji = '🏙️';
          else if (item.type === 'cycleway') iconEmoji = '🚲';
          else if (item.type === 'street') iconEmoji = '🛣️';
          else if (item.type === 'poi') iconEmoji = '🏛️';
          else if (item.type === 'address') iconEmoji = '🏠';

          const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          const highlightedMain = item.mainText.replace(regex, '<span class="highlight">$1</span>');

          itemEl.innerHTML = `
            <div class="suggestion-icon">${iconEmoji}</div>
            <div class="suggestion-content">
              <div class="suggestion-main">${highlightedMain}</div>
              <div class="suggestion-sub">${item.subText || ''}</div>
            </div>
            ${item.tag ? `<div class="suggestion-tag">${item.tag}</div>` : ''}
          `;

          itemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            closeDropdown();
            onSelect({ lat: item.lat, lng: item.lng }, item.fullLabel);
          });

          dropdownEl.appendChild(itemEl);
        });
        dropdownEl.style.display = 'block';
      };

      inputEl.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        clearTimeout(debounceTimer);
        if (val.length < 2) { closeDropdown(); return; }

        dropdownEl.innerHTML = `<div class="suggestion-loading"><span>🔍 Recherche en direct des pistes, rues & villes...</span></div>`;
        dropdownEl.style.display = 'block';

        debounceTimer = setTimeout(async () => {
          const suggestions = await this.routingEngine.getAddressSuggestions(val);
          if (inputEl.value.trim().length >= 2) renderSuggestions(suggestions, val);
        }, 160);
      });

      inputEl.addEventListener('keydown', (e) => {
        if (dropdownEl.style.display !== 'block' || currentSuggestions.length === 0) return;
        const items = dropdownEl.querySelectorAll('.suggestion-item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedIndex = (selectedIndex + 1) % items.length;
          items.forEach((it, i) => it.classList.toggle('active', i === selectedIndex));
          items[selectedIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIndex = (selectedIndex - 1 + items.length) % items.length;
          items.forEach((it, i) => it.classList.toggle('active', i === selectedIndex));
          items[selectedIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          if (selectedIndex >= 0 && selectedIndex < currentSuggestions.length) {
            e.preventDefault();
            const chosen = currentSuggestions[selectedIndex];
            closeDropdown();
            onSelect({ lat: chosen.lat, lng: chosen.lng }, chosen.fullLabel);
          }
        } else if (e.key === 'Escape') {
          closeDropdown();
        }
      });

      document.addEventListener('click', (e) => {
        if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) closeDropdown();
      });
    }

    // -----------------------------------------------------------------------
    // Route calculation & UI update
    // -----------------------------------------------------------------------
    async calculateCurrentRoute() {
      const startStr = this.elStartInput.value;
      const endStr = this.elEndInput.value;

      let startCoords = this.selectedStartCoords;
      if (!startCoords || this.lastStartLabel !== startStr) {
        startCoords = await this.routingEngine.searchAddress(startStr) || { lat: 48.8531, lng: 2.3698 };
      }

      let endCoords = this.selectedEndCoords;
      if (!endCoords || this.lastEndLabel !== endStr) {
        endCoords = await this.routingEngine.searchAddress(endStr) || { lat: 48.8584, lng: 2.3470 };
      }

      this.lastStartLabel = startStr;
      this.lastEndLabel = endStr;

      this.calculatedRoutes = await this.routingEngine.calculateRoutes(startCoords, endCoords);
      this.updateRouteCards();
      this.applySelectedRoute();
    }

    updateRouteCards() {
      if (!this.calculatedRoutes) return;
      const routes = [this.calculatedRoutes.safe, this.calculatedRoutes.fast, this.calculatedRoutes.eco, this.calculatedRoutes.nature];
      const cards = document.querySelectorAll('.route-card');

      routes.forEach((route, i) => {
        const card = cards[i];
        if (!card) return;
        const timeEl = card.querySelector('.route-stat-time');
        const metaEl = card.querySelector('.route-stat-meta');
        const topBadge = card.querySelector('.route-badge-piste, .route-badge-neutral, .route-badge-battery, .route-badge-emerald');
        const climbTag = card.querySelector('.route-climb-tag');
        const surfaceGreen = card.querySelector('.surface-seg.green');
        const surfaceBlue = card.querySelector('.surface-seg.blue');
        const surfaceYellow = card.querySelector('.surface-seg.yellow');

        if (timeEl) timeEl.textContent = `${route.durationMin} min`;

        if (metaEl) {
          const metaTexts = {
            safe: `${route.distanceKm} km • ${route.cobblestonesAvoided} pavés évités`,
            fast: `${route.distanceKm} km • Direct`,
            eco: `${route.distanceKm} km • +${route.elevationGainM}m`,
            nature: `${route.distanceKm} km • Berges`
          };
          metaEl.textContent = metaTexts[route.mode] || `${route.distanceKm} km`;
        }

        if (topBadge) {
          const badges = { safe: `${route.cyclewayPercent}% Pistes`, fast: `${route.cyclewayPercent}% Pistes`, eco: 'Ultra-Plat', nature: '100% Apaisé' };
          topBadge.textContent = badges[route.mode] || `${route.cyclewayPercent}%`;
        }

        if (climbTag) climbTag.textContent = `↗ +${route.elevationGainM}m`;

        if (surfaceGreen) surfaceGreen.style.width = `${route.protectedPct}%`;
        if (surfaceBlue) surfaceBlue.style.width = `${route.lanePct}%`;
        if (surfaceYellow) surfaceYellow.style.width = `${route.sharedPct}%`;
      });
    }

    applySelectedRoute() {
      if (!this.calculatedRoutes) return;
      const activeRoute = this.calculatedRoutes[this.selectedRouteMode] || this.calculatedRoutes.safe;
      this.mapManager.drawRoute(activeRoute.coordinates, this.selectedRouteMode);

      const now = new Date();
      now.setMinutes(now.getMinutes() + activeRoute.durationMin);
      const etaStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      this.elHudEta.textContent = etaStr;
      this.elHudTimeRem.textContent = `${activeRoute.durationMin} min`;
      this.elHudDistRem.textContent = `${activeRoute.distanceKm} km`;

      const battEst = this.batteryEngine.estimateTrip(parseFloat(activeRoute.distanceKm), activeRoute.elevationGainM);
      this.elBatteryArrival.textContent = `Fin: ~${battEst.arrivalPct}%`;

      this.renderElevationProfile(activeRoute);
    }

    // -----------------------------------------------------------------------
    // Elevation SVG profile
    // -----------------------------------------------------------------------
    renderElevationProfile(route) {
      const profile = route.elevationProfile;
      if (!profile || profile.length === 0) return;

      const svgEl = document.getElementById('elevation-svg');
      const svgW = 380; const svgH = 65;
      const padding = { left: 5, right: 5, top: 5, bottom: 10 };
      const drawW = svgW - padding.left - padding.right;
      const drawH = svgH - padding.top - padding.bottom;

      const alts = profile.map(p => p.altM);
      const minAlt = Math.min(...alts);
      const maxAlt = Math.max(...alts);
      const altRange = Math.max(maxAlt - minAlt, 1);

      const points = profile.map((p, i) => {
        const x = padding.left + (i / (profile.length - 1)) * drawW;
        const y = padding.top + drawH - ((p.altM - minAlt) / altRange) * drawH;
        return `${x},${y}`;
      });

      const lineD = `M ${points.join(' L ')}`;
      const areaD = `M ${points[0]} L ${points.join(' L ')} L ${padding.left + drawW},${padding.top + drawH} L ${padding.left},${padding.top + drawH} Z`;

      // Determine slope difficulty color
      const maxSlope = route.maxSlopePct || 0;
      let gradColor = '#10b981';
      let diffLabel = 'Pente Douce';
      let diffClass = 'easy';
      if (maxSlope > 8) { gradColor = '#ef4444'; diffLabel = 'Pente Difficile'; diffClass = 'hard'; }
      else if (maxSlope > 5) { gradColor = '#f59e0b'; diffLabel = 'Pente Modérée'; diffClass = 'medium'; }

      // Update gradient color dynamically
      const stopEl = svgEl.querySelector('#elevGradient stop:first-child');
      if (stopEl) stopEl.setAttribute('stop-color', gradColor);

      const linePath = svgEl.getElementById ? svgEl.querySelector('#elev-line-path') : null;
      const areaPath = svgEl.querySelector ? svgEl.querySelector('#elev-area-path') : null;

      if (linePath) { linePath.setAttribute('d', lineD); linePath.style.stroke = gradColor; }
      if (areaPath) { areaPath.setAttribute('d', areaD); }

      // Labels
      const gainSummary = document.getElementById('elev-gain-summary');
      if (gainSummary) gainSummary.textContent = `+${route.elevationGainM}m / -${route.elevationLossM}m • Max ${route.maxSlopePct}%`;

      const diffBadge = document.getElementById('slope-diff-badge');
      if (diffBadge) { diffBadge.textContent = diffLabel; diffBadge.className = `slope-difficulty-pill ${diffClass}`; }

      const midDistEl = document.getElementById('elev-mid-dist');
      if (midDistEl) midDistEl.textContent = `${(route.distanceKm / 2).toFixed(1)} km`;
      const endDistEl = document.getElementById('elev-end-dist');
      if (endDistEl) endDistEl.textContent = `${route.distanceKm} km (Arrivée)`;

      // Infrastructure summary
      const infraEl = document.getElementById('infrastructure-summary');
      if (infraEl) {
        const protectedKm = ((route.protectedPct / 100) * route.distanceKm).toFixed(1);
        const laneKm = ((route.lanePct / 100) * route.distanceKm).toFixed(1);
        infraEl.innerHTML = `
          <span class="infra-pill green">🛡️ ${protectedKm} km Piste protégée</span>
          <span class="infra-pill blue">🚲 ${laneKm} km Bande cyclable</span>
          <span class="infra-pill gold">✨ ${route.cobblestonesAvoided} pavés contournés</span>
        `;
      }
    }

    // -----------------------------------------------------------------------
    // Road adhesion / weather barometer
    // -----------------------------------------------------------------------
    initWeatherBar() {
      const conditions = [
        { icon: '☀️', text: 'Sol sec • Adhérence optimale', grip: 100, tip: 'Pression pneus recommandée : 3.5 bar' },
        { icon: '🌤️', text: 'Légère brise • Adhérence très bonne', grip: 95, tip: 'Conditions idéales pour rouler vite' },
        { icon: '🌦️', text: 'Risque de pluie • Adhérence réduite', grip: 65, tip: 'Ralentissez dans les virages : 3.0 bar' },
        { icon: '🌧️', text: 'Pluie • Adhérence faible', grip: 40, tip: '⚠️ Freinage à 2× la distance normale !' },
        { icon: '🌩️', text: 'Orage • Adhérence critique', grip: 20, tip: '🚨 Évitez la trottinette — danger électrique !' }
      ];

      const picked = conditions[Math.floor(Math.random() * 2)]; // Mostly good weather for demo
      const bar = document.getElementById('road-adhesion-bar');
      if (!bar) return;
      bar.querySelector('.adhesion-icon').textContent = picked.icon;
      bar.querySelector('.adhesion-text').innerHTML = `${picked.text} <strong>(${picked.grip}%)</strong>`;
      bar.querySelector('.adhesion-tip').textContent = picked.tip;

      if (picked.grip < 50) bar.classList.add('adhesion-danger');
      else if (picked.grip < 75) bar.classList.add('adhesion-warning');
    }

    // -----------------------------------------------------------------------
    // Social interactions
    // -----------------------------------------------------------------------
    openUserProfileModal(user) {
      this.activeModalUser = user;
      document.getElementById('modal-user-avatar').textContent = user.avatar;
      document.getElementById('modal-user-pseudo').textContent = user.pseudo;
      document.getElementById('modal-user-status').textContent = `En ligne • ${Math.round(user.speed)} km/h`;
      document.getElementById('modal-user-scooter').textContent = user.scooter;
      document.getElementById('modal-user-speed').textContent = `${Math.round(user.speed)} km/h`;
      document.getElementById('modal-user-battery').textContent = `${user.battery}%`;
      document.getElementById('modal-user-trip').textContent = user.trip;
      document.getElementById('modal-user-mood').textContent = `"${user.status}"`;
      this.elUserModal.style.display = 'flex';
    }

    sendSocialAction(type) {
      if (!this.activeModalUser) return;
      const msg = this.userManager.sendSocialEvent(this.activeModalUser, type);
      this.elUserModal.style.display = 'none';
      this.showToast(msg);
    }

    handleIncomingSocialEvent(user, type, text, icon) {
      const notif = document.createElement('div');
      notif.className = 'glass-panel incoming-social-notif';
      notif.style.cssText = `
        position: absolute; bottom: 160px; left: 50%; transform: translateX(-50%);
        z-index: 2100; padding: 10px 16px; display: flex; align-items: center; gap: 10px;
        border-radius: 40px; cursor: pointer; white-space: nowrap;
        border: 1px solid ${user.color}; animation: fadeIn 0.3s ease;
        font-size: 13px; font-weight: 600;
      `;
      notif.innerHTML = `
        <span style="font-size:20px;">${user.avatar}</span>
        <span><strong style="color:${user.color};">${user.pseudo}</strong> ${text}</span>
        <span style="font-size:16px;">${icon}</span>
      `;
      notif.addEventListener('click', () => { this.openUserProfileModal(user); notif.remove(); });
      document.getElementById('app-container').appendChild(notif);
      setTimeout(() => {
        notif.style.opacity = '0'; notif.style.transition = 'opacity 0.4s';
        setTimeout(() => notif.remove(), 400);
      }, 6000);
    }

    // -----------------------------------------------------------------------
    // Trip control
    // -----------------------------------------------------------------------
    beginTrip(isSimulated = false) {
      if (!this.calculatedRoutes) return;
      const activeRoute = this.calculatedRoutes[this.selectedRouteMode];
      this.elRoutePanel.style.display = 'none';
      this.elNavBanner.style.display = 'flex';
      this.elReportFab.style.display = 'block';
      if (isSimulated) this.elSimuController.style.display = 'flex';
      this.navigationEngine.startNavigation(activeRoute, isSimulated);
    }

    endTrip() {
      this.navigationEngine.stopNavigation();
      this.elRoutePanel.style.display = 'block';
      this.elNavBanner.style.display = 'none';
      this.elSimuController.style.display = 'none';
      this.elHazardAlert.style.display = 'none';
      this.handleSpeedUpdate(0);
      this.calculateCurrentRoute();
    }

    handleArrival() {
      this.showToast('🎉 Arrivée à destination !');
      setTimeout(() => this.endTrip(), 4000);
    }

    setSimSpeed(mult, btnTarget) {
      this.navigationEngine.setSimulationSpeed(mult);
      document.querySelectorAll('#simu-controller .btn-micro').forEach(b => {
        if (b.id !== 'btn-simu-pause' && b.id !== 'btn-simu-stop') b.classList.remove('active');
      });
      btnTarget.classList.add('active');
    }

    // -----------------------------------------------------------------------
    // HUD updates
    // -----------------------------------------------------------------------
    handleSpeedUpdate(speedKmh) {
      this.elSpeedVal.textContent = speedKmh;
      this.elSpeedBox.classList.toggle('speed-overspeed', speedKmh > 25);
      const fraction = Math.min(1, speedKmh / 30);
      this.elSpeedCircle.style.strokeDashoffset = 264 - (fraction * 264);
    }

    handleStepUpdate(step) {
      this.elNavDistance.textContent = `Dans ${step.distanceMeters} m`;
      this.elNavStreet.textContent = step.street || step.instruction;
      this.elNavSafety.textContent = step.safety || 'Piste cyclable sécurisée';

      const icons = {
        right: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M5 19V9a4 4 0 0 1 4-4h10"/><polyline points="15 9 19 5 15 1"/></svg>',
        left: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M19 19V9a4 4 0 0 0-4-4H5"/><polyline points="9 9 5 5 9 1"/></svg>',
        arrive: '<span style="font-size:28px;">🏁</span>',
        straight: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
      };
      this.elNavIcon.innerHTML = icons[step.modifier] || icons.straight;
    }

    handleTripUpdate(trip) {
      this.elHudTimeRem.textContent = `${trip.remainingMin} min`;
      this.elHudDistRem.textContent = `${trip.remainingDistKm} km`;
      if (trip.batteryStatus) this.elBatteryArrival.textContent = `Fin: ~${trip.batteryStatus.arrivalPct}%`;
    }

    handleHazardProximity(alertData) {
      const { hazard, distanceMeters, config } = alertData;
      this.currentActiveAlertHazardId = hazard.id;
      document.getElementById('hazard-alert-icon').textContent = config.icon;
      document.getElementById('hazard-alert-title').textContent = `${hazard.title} à ${distanceMeters} m`;
      document.getElementById('hazard-alert-sub').textContent = config.warning;
      this.elHazardAlert.classList.toggle('police-theme', hazard.type === 'police');
      this.elHazardAlert.style.display = 'flex';
      setTimeout(() => { if (this.elHazardAlert.style.display === 'flex') this.elHazardAlert.style.display = 'none'; }, 8000);
    }

    // -----------------------------------------------------------------------
    // Report modal
    // -----------------------------------------------------------------------
    openReportModal() {
      this.selectedHazardType = null;
      document.querySelectorAll('.hazard-choice-btn').forEach(b => b.classList.remove('selected'));
      document.getElementById('btn-submit-report').disabled = true;
      document.getElementById('report-comment').value = '';
      this.elReportModal.style.display = 'flex';
    }

    submitHazardReport() {
      if (!this.selectedHazardType) return;
      const comment = document.getElementById('report-comment').value;
      const config = HAZARD_TYPES[this.selectedHazardType];
      const currentLoc = this.mapManager.currentLocation;
      const headingRad = (currentLoc.heading || 90) * Math.PI / 180;

      this.hazardManager.addHazard({
        type: this.selectedHazardType,
        lat: currentLoc.lat + Math.cos(headingRad) * 0.0006,
        lng: currentLoc.lng + Math.sin(headingRad) * 0.0008,
        title: config.label,
        desc: comment || config.warning,
        author: 'Moi (Trottinette)',
        upvotes: 1
      });

      this.elReportModal.style.display = 'none';
      this.showToast(`✅ Signalé : ${config.label} transmis !`);
      this.hazardManager.playAlertSound(this.selectedHazardType);
    }

    confirmHazard(id) { this.hazardManager.upvote(id); this.showToast('Signalement confirmé 👍'); }
    dismissHazard(id) { this.hazardManager.remove(id); this.showToast('Signalement marqué résolu ✕'); }

    // -----------------------------------------------------------------------
    // Battery widget
    // -----------------------------------------------------------------------
    updateBatteryWidget() {
      const cfg = this.batteryEngine.config;
      this.elBatteryPercent.textContent = `${cfg.currentPercentage}%`;
      this.elBatteryFill.style.width = `${cfg.currentPercentage}%`;
      this.elBatteryFill.style.background = cfg.currentPercentage < 20 ? 'var(--danger)' : cfg.currentPercentage < 40 ? 'var(--warning)' : 'var(--primary)';
      document.getElementById('scooter-battery-pct').value = cfg.currentPercentage;
      document.getElementById('val-battery-pct').textContent = `${cfg.currentPercentage}%`;
      document.getElementById('scooter-rider-weight').value = cfg.riderWeightKg;
      document.getElementById('val-rider-weight').textContent = `${cfg.riderWeightKg} kg`;
      document.getElementById('scooter-capacity').value = cfg.batteryCapacityWh;
      document.getElementById('scooter-speed-pref').value = cfg.speedPrefKmh;
    }

    // -----------------------------------------------------------------------
    // Toast notification
    // -----------------------------------------------------------------------
    showToast(msg) {
      const existing = document.getElementById('trotti-toast');
      if (existing) existing.remove();
      const toast = document.createElement('div');
      toast.id = 'trotti-toast';
      toast.className = 'glass-panel';
      toast.style.cssText = `
        position: absolute; bottom: 95px; left: 50%; transform: translateX(-50%);
        z-index: 2000; padding: 10px 18px; font-size: 13px; font-weight: 700;
        border-radius: 30px; border: 1px solid var(--primary);
        box-shadow: 0 4px 20px rgba(0,0,0,0.4); animation: fadeIn 0.2s ease; white-space: nowrap;
      `;
      toast.textContent = msg;
      document.getElementById('app-container').appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 2800);
    }
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new TrottiWazeApp());
  } else {
    new TrottiWazeApp();
  }
})();
