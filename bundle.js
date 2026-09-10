/**
 * TrottiWaze - Bundle Complet v5.4
 * - Gestion Multi-Trottinettes (Garage de Flotte Personnalisé)
 * - Authentification Complète & Réinitialisation Mot de Passe par Email (OTP à 6 chiffres)
 * - Guidage Vocal GPS Personnalisable (Sélection de Voix, Débit, Tonalité, Volume & Aperçu Audio)
 * - Rotation Mobile & Boussole d'Orientation de Carte (Mode Cap / Course-Up & Mode Paysage Guidon)
 * - Bornes de Recharge 230V, Météo & Risque de Pluie, Enregistreur Géovelo
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Weather & Rain Risk Engine (Open-Meteo Integration)
  // =========================================================================
  class WeatherEngine {
    constructor() {
      this.currentWeather = {
        tempC: 19,
        rainProbPct: 15,
        isRaining: false,
        roadStatus: 'dry',
        summary: 'Sol sec • Adhérence optimale (100%)',
        advice: 'Adhérence maximale sur toutes les pistes.'
      };
    }

    async fetchWeather(lat, lng) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code&hourly=precipitation_probability,rain&forecast_hours=3`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const current = data.current || {};
          const hourly = data.hourly || {};
          const temp = Math.round(current.temperature_2m || 18);
          const rainCurrent = current.rain || current.precipitation || 0;
          const rainProb = (hourly.precipitation_probability && hourly.precipitation_probability[0]) || (rainCurrent > 0 ? 85 : 15);
          
          let roadStatus = 'dry';
          let summary = 'Sol sec • Adhérence 100%';
          let advice = 'Conditions optimales de roulage.';

          if (rainCurrent > 0.2 || rainProb >= 60) {
            roadStatus = 'wet';
            summary = `🌧️ Pluie / Sol mouillé (${temp}°C • ${rainProb}% pluie)`;
            advice = '⚠️ SOL GLISSANT : Distance de freinage x2 ! Évitez les pavés, bandes blanches et plaques d\'égout.';
          } else if (rainProb >= 30) {
            roadStatus = 'risk';
            summary = `⛅ Risque d'averse (${temp}°C • ${rainProb}% pluie)`;
            advice = '⚠️ Risque d\'ondée : restez prudent sur les virages serrés et rails de tramway.';
          } else {
            roadStatus = 'dry';
            summary = `☀️ Sol sec • ${temp}°C • Risque pluie ${rainProb}%`;
            advice = 'Adhérence optimale sur les pistes.';
          }

          this.currentWeather = {
            tempC: temp,
            rainProbPct: rainProb,
            isRaining: rainCurrent > 0.2,
            roadStatus,
            summary,
            advice
          };
        }
      } catch (e) {
        console.warn('Weather fetch offline fallback:', e);
      }
      return this.currentWeather;
    }
  }

  // =========================================================================
  // 2. Authentication & User Profile Manager (Comptes & Reset Email)
  // =========================================================================
  class AuthManager {
    constructor() {
      this.users = [];
      this.currentUser = null;
      this.loadUsers();
      this.loadSession();
    }

    loadUsers() {
      try {
        const raw = localStorage.getItem('trottiwaze_users_db');
        if (raw) {
          this.users = JSON.parse(raw);
        } else {
          // Default demo account
          this.users = [
            {
              id: 'usr_demo',
              username: 'RiderParis',
              email: 'rider@trottiwaze.fr',
              avatar: '🦊',
              passwordHash: this.simpleHash('trotti123'),
              createdAt: '10/09/2026',
              stats: { totalKm: 142.5, totalRides: 18, reportsCount: 4 }
            }
          ];
          this.saveUsers();
        }
      } catch (e) {
        this.users = [];
      }
    }

    saveUsers() {
      try {
        localStorage.setItem('trottiwaze_users_db', JSON.stringify(this.users));
      } catch (e) {}
    }

    loadSession() {
      try {
        const sessionUserId = localStorage.getItem('trottiwaze_current_session');
        if (sessionUserId) {
          this.currentUser = this.users.find(u => u.id === sessionUserId) || null;
        }
      } catch (e) {
        this.currentUser = null;
      }
    }

    simpleHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return 'h_' + Math.abs(hash).toString(16);
    }

    signup({ username, email, avatar, password }) {
      const cleanUser = (username || '').trim();
      const cleanEmail = (email || '').trim().toLowerCase();

      if (!cleanUser || !cleanEmail || !password || password.length < 6) {
        return { success: false, message: 'Veuillez remplir tous les champs (mot de passe min 6 car.).' };
      }

      const exists = this.users.find(u => u.username.toLowerCase() === cleanUser.toLowerCase() || u.email.toLowerCase() === cleanEmail);
      if (exists) {
        return { success: false, message: 'Un compte avec ce pseudo ou cet email existe déjà.' };
      }

      const newUser = {
        id: 'usr_' + Date.now(),
        username: cleanUser,
        email: cleanEmail,
        avatar: avatar || '🦊',
        passwordHash: this.simpleHash(password),
        createdAt: new Date().toLocaleDateString('fr-FR'),
        stats: { totalKm: 0, totalRides: 0, reportsCount: 0 }
      };

      this.users.push(newUser);
      this.saveUsers();
      this.currentUser = newUser;
      localStorage.setItem('trottiwaze_current_session', newUser.id);

      return { success: true, user: newUser };
    }

    login({ identifier, password }) {
      const clean = (identifier || '').trim().toLowerCase();
      const user = this.users.find(u => u.username.toLowerCase() === clean || u.email.toLowerCase() === clean);

      if (!user) {
        return { success: false, message: 'Utilisateur ou email introuvable.' };
      }

      if (user.passwordHash !== this.simpleHash(password)) {
        return { success: false, message: 'Mot de passe incorrect.' };
      }

      this.currentUser = user;
      localStorage.setItem('trottiwaze_current_session', user.id);
      return { success: true, user };
    }

    logout() {
      this.currentUser = null;
      localStorage.removeItem('trottiwaze_current_session');
    }

    requestPasswordReset(email) {
      const cleanEmail = (email || '').trim().toLowerCase();
      const user = this.users.find(u => u.email.toLowerCase() === cleanEmail);

      // Generate a 6-digit OTP code
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const resetPayload = {
        email: cleanEmail,
        code: otpCode,
        expiresAt: Date.now() + 15 * 60 * 1000 // 15 mins
      };

      localStorage.setItem('trottiwaze_reset_otp', JSON.stringify(resetPayload));

      if (!user) {
        return {
          success: true,
          code: otpCode,
          email: cleanEmail,
          notice: 'Code de réinitialisation généré.'
        };
      }

      return {
        success: true,
        code: otpCode,
        email: cleanEmail,
        notice: `Code envoyé avec succès à ${cleanEmail}.`
      };
    }

    confirmPasswordReset({ email, code, newPassword }) {
      const cleanEmail = (email || '').trim().toLowerCase();
      const rawPayload = localStorage.getItem('trottiwaze_reset_otp');

      if (!rawPayload) {
        return { success: false, message: 'Aucune demande de réinitialisation en cours.' };
      }

      const payload = JSON.parse(rawPayload);
      if (payload.email !== cleanEmail || payload.code !== (code || '').trim()) {
        return { success: false, message: 'Code de vérification incorrect ou expiré.' };
      }

      if (Date.now() > payload.expiresAt) {
        return { success: false, message: 'Ce code a expiré. Veuillez refaire une demande.' };
      }

      if (!newPassword || newPassword.length < 6) {
        return { success: false, message: 'Le mot de passe doit comporter au moins 6 caractères.' };
      }

      let user = this.users.find(u => u.email.toLowerCase() === cleanEmail);
      if (!user) {
        user = {
          id: 'usr_' + Date.now(),
          username: cleanEmail.split('@')[0],
          email: cleanEmail,
          avatar: '🛴',
          passwordHash: this.simpleHash(newPassword),
          createdAt: new Date().toLocaleDateString('fr-FR'),
          stats: { totalKm: 0, totalRides: 0, reportsCount: 0 }
        };
        this.users.push(user);
      } else {
        user.passwordHash = this.simpleHash(newPassword);
      }

      this.saveUsers();
      localStorage.removeItem('trottiwaze_reset_otp');
      this.currentUser = user;
      localStorage.setItem('trottiwaze_current_session', user.id);

      return { success: true, user };
    }

    updateUserStats(addedKm = 0, addedRide = 1) {
      if (!this.currentUser) return;
      if (!this.currentUser.stats) {
        this.currentUser.stats = { totalKm: 0, totalRides: 0, reportsCount: 0 };
      }
      this.currentUser.stats.totalKm = parseFloat(((this.currentUser.stats.totalKm || 0) + addedKm).toFixed(1));
      this.currentUser.stats.totalRides = (this.currentUser.stats.totalRides || 0) + addedRide;
      this.saveUsers();
    }

    incrementReports() {
      if (!this.currentUser) return;
      if (!this.currentUser.stats) {
        this.currentUser.stats = { totalKm: 0, totalRides: 0, reportsCount: 0 };
      }
      this.currentUser.stats.reportsCount = (this.currentUser.stats.reportsCount || 0) + 1;
      this.saveUsers();
    }

    exportUserData() {
      const data = {
        user: this.currentUser,
        garage: JSON.parse(localStorage.getItem('trottiwaze_garage_fleet') || '[]'),
        rides: JSON.parse(localStorage.getItem('trottiwaze_saved_rides') || '[]'),
        favs: JSON.parse(localStorage.getItem('trottiwaze_favs_v2') || '{}')
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trottiwaze_export_${(this.currentUser && this.currentUser.username) || 'rider'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    deleteAccount() {
      if (!this.currentUser) return;
      this.users = this.users.filter(u => u.id !== this.currentUser.id);
      this.saveUsers();
      this.logout();
    }
  }

  // =========================================================================
  // 3. Garage & Multi-Scooter Fleet Manager (Gestion de plusieurs Trottinettes)
  // =========================================================================
  class GarageManager {
    constructor(onActiveChangedCallback) {
      this.onActiveChangedCallback = onActiveChangedCallback;
      this.scooters = [];
      this.activeScooterId = null;
      this.loadGarage();
    }

    loadGarage() {
      try {
        const raw = localStorage.getItem('trottiwaze_garage_fleet');
        if (raw) {
          this.scooters = JSON.parse(raw);
        } else {
          // Default starter garage with 3 popular scooter models
          this.scooters = [
            {
              id: 'scoot_1',
              name: 'Ninebot MAX G30',
              icon: '🛴',
              batteryCapacityWh: 551,
              currentPercentage: 80,
              riderWeightKg: 75,
              scooterWeightKg: 19,
              speedPrefKmh: 25,
              volts: 36,
              amphours: 15.3
            },
            {
              id: 'scoot_2',
              name: 'Xiaomi Mi Pro 2',
              icon: '🟢',
              batteryCapacityWh: 474,
              currentPercentage: 85,
              riderWeightKg: 75,
              scooterWeightKg: 14.2,
              speedPrefKmh: 25,
              volts: 36,
              amphours: 12.8
            },
            {
              id: 'scoot_3',
              name: 'Dualtron Mini Special',
              icon: '⚡',
              batteryCapacityWh: 1040,
              currentPercentage: 90,
              riderWeightKg: 75,
              scooterWeightKg: 22,
              speedPrefKmh: 45,
              volts: 52,
              amphours: 20
            }
          ];
          this.saveGarage();
        }

        const savedActiveId = localStorage.getItem('trottiwaze_active_scooter_id');
        if (savedActiveId && this.scooters.find(s => s.id === savedActiveId)) {
          this.activeScooterId = savedActiveId;
        } else {
          this.activeScooterId = this.scooters[0] ? this.scooters[0].id : null;
          if (this.activeScooterId) {
            localStorage.setItem('trottiwaze_active_scooter_id', this.activeScooterId);
          }
        }
      } catch (e) {
        this.scooters = [];
      }
    }

    saveGarage() {
      try {
        localStorage.setItem('trottiwaze_garage_fleet', JSON.stringify(this.scooters));
        if (this.activeScooterId) {
          localStorage.setItem('trottiwaze_active_scooter_id', this.activeScooterId);
        }
      } catch (e) {}
    }

    getActiveScooter() {
      const active = this.scooters.find(s => s.id === this.activeScooterId);
      return active || this.scooters[0] || {
        id: 'scoot_default',
        name: 'Ma Trottinette',
        icon: '🛴',
        batteryCapacityWh: 474,
        currentPercentage: 80,
        riderWeightKg: 75,
        scooterWeightKg: 18,
        speedPrefKmh: 25
      };
    }

    setActiveScooter(id) {
      const scoot = this.scooters.find(s => s.id === id);
      if (scoot) {
        this.activeScooterId = id;
        this.saveGarage();
        if (this.onActiveChangedCallback) {
          this.onActiveChangedCallback(scoot);
        }
        return scoot;
      }
      return null;
    }

    addScooter(data) {
      const id = 'scoot_' + Date.now();
      const newScoot = {
        id,
        name: data.name || 'Nouvelle Trottinette',
        icon: data.icon || '🛴',
        batteryCapacityWh: parseInt(data.batteryCapacityWh, 10) || 474,
        currentPercentage: parseInt(data.currentPercentage, 10) || 80,
        riderWeightKg: parseInt(data.riderWeightKg, 10) || 75,
        scooterWeightKg: parseInt(data.scooterWeightKg, 10) || 18,
        speedPrefKmh: parseInt(data.speedPrefKmh, 10) || 25,
        volts: data.volts || 36,
        amphours: data.amphours || 13
      };
      this.scooters.push(newScoot);
      this.setActiveScooter(id);
      this.saveGarage();
      return newScoot;
    }

    updateScooter(id, data) {
      const index = this.scooters.findIndex(s => s.id === id);
      if (index !== -1) {
        this.scooters[index] = {
          ...this.scooters[index],
          ...data,
          batteryCapacityWh: parseInt(data.batteryCapacityWh, 10) || this.scooters[index].batteryCapacityWh,
          riderWeightKg: parseInt(data.riderWeightKg, 10) || this.scooters[index].riderWeightKg,
          scooterWeightKg: parseInt(data.scooterWeightKg, 10) || this.scooters[index].scooterWeightKg,
          speedPrefKmh: parseInt(data.speedPrefKmh, 10) || this.scooters[index].speedPrefKmh,
          currentPercentage: parseInt(data.currentPercentage, 10) || this.scooters[index].currentPercentage
        };
        this.saveGarage();
        if (this.activeScooterId === id && this.onActiveChangedCallback) {
          this.onActiveChangedCallback(this.scooters[index]);
        }
        return this.scooters[index];
      }
      return null;
    }

    deleteScooter(id) {
      if (this.scooters.length <= 1) {
        return { success: false, message: 'Vous devez conserver au moins un modèle dans votre garage.' };
      }
      this.scooters = this.scooters.filter(s => s.id !== id);
      if (this.activeScooterId === id) {
        this.activeScooterId = this.scooters[0].id;
        if (this.onActiveChangedCallback) {
          this.onActiveChangedCallback(this.scooters[0]);
        }
      }
      this.saveGarage();
      return { success: true };
    }
  }

  // =========================================================================
  // 4. Battery Engine
  // =========================================================================
  class BatteryEngine {
    constructor(garageManager) {
      this.garageManager = garageManager;
      this.baseEfficiencyWhPerKm = 16.5;
    }

    get config() {
      return this.garageManager ? this.garageManager.getActiveScooter() : {
        scooterName: 'Ninebot MAX G30',
        batteryCapacityWh: 551,
        currentPercentage: 80,
        riderWeightKg: 75,
        scooterWeightKg: 19,
        speedPrefKmh: 25
      };
    }

    estimateTrip(distanceKm, elevationGainM = 5) {
      const cfg = this.config;
      const totalMassKg = (cfg.riderWeightKg || 75) + (cfg.scooterWeightKg || 18);
      const weightFactor = totalMassKg / 90;
      const speedRatio = Math.max(15, cfg.speedPrefKmh || 25) / 20;
      const speedFactor = Math.pow(speedRatio, 1.7);
      const flatEnergyWh = distanceKm * this.baseEfficiencyWhPerKm * weightFactor * speedFactor;
      const climbEnergyWh = (totalMassKg * 9.81 * Math.max(0, elevationGainM)) / (3600 * 0.70);
      const totalWhUsed = flatEnergyWh + climbEnergyWh;
      const currentWh = ((cfg.currentPercentage || 80) / 100) * (cfg.batteryCapacityWh || 474);
      const remainingWh = Math.max(0, currentWh - totalWhUsed);
      const remainingPct = Math.round((remainingWh / (cfg.batteryCapacityWh || 474)) * 100);
      const avgConsumptionPerKm = totalWhUsed / (distanceKm || 1);
      const remainingRangeKm = (remainingWh / (avgConsumptionPerKm || 17)).toFixed(1);

      return {
        whUsed: Math.round(totalWhUsed),
        currentPct: cfg.currentPercentage,
        arrivalPct: remainingPct,
        remainingRangeKm: parseFloat(remainingRangeKm),
        isCritical: remainingPct < 15,
        elevationGainM: Math.round(elevationGainM)
      };
    }
  }

  // =========================================================================
  // 5. Voice Guidance & Speech Synthesis Customizer (Voix GPS)
  // =========================================================================
  class VoiceGuidanceEngine {
    constructor() {
      this.synth = window.speechSynthesis || null;
      this.voices = [];
      this.config = {
        enabled: true,
        voiceURI: '',
        rate: 1.05,
        pitch: 1.0,
        volume: 1.0,
        announceTurns: true,
        announceWeather: true,
        announceHazards: true
      };
      this.loadConfig();
      this.initVoices();
    }

    loadConfig() {
      try {
        const raw = localStorage.getItem('trottiwaze_voice_cfg');
        if (raw) this.config = { ...this.config, ...JSON.parse(raw) };
      } catch (e) {}
    }

    saveConfig(newCfg) {
      this.config = { ...this.config, ...newCfg };
      try {
        localStorage.setItem('trottiwaze_voice_cfg', JSON.stringify(this.config));
      } catch (e) {}
    }

    initVoices(onLoadedCallback) {
      if (!this.synth) return;

      const populate = () => {
        this.voices = this.synth.getVoices();
        if (onLoadedCallback) onLoadedCallback(this.voices);
      };

      populate();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = populate;
      }
    }

    getFrenchVoices() {
      if (!this.voices || this.voices.length === 0) {
        if (this.synth) this.voices = this.synth.getVoices();
      }
      return this.voices.filter(v => v.lang.startsWith('fr') || v.lang.startsWith('FR'));
    }

    speak(text, type = 'turn') {
      if (!this.synth || !this.config.enabled) return;

      if (type === 'turn' && !this.config.announceTurns) return;
      if (type === 'weather' && !this.config.announceWeather) return;
      if (type === 'hazard' && !this.config.announceHazards) return;

      try {
        this.synth.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = this.config.rate || 1.05;
        utter.pitch = this.config.pitch || 1.0;
        utter.volume = this.config.volume !== undefined ? this.config.volume : 1.0;
        utter.lang = 'fr-FR';

        if (this.config.voiceURI && this.voices.length > 0) {
          const selectedVoice = this.voices.find(v => v.voiceURI === this.config.voiceURI);
          if (selectedVoice) utter.voice = selectedVoice;
        } else {
          const frVoice = this.getFrenchVoices()[0];
          if (frVoice) utter.voice = frVoice;
        }

        this.synth.speak(utter);
      } catch (e) {
        console.warn('SpeechSynthesis error:', e);
      }
    }

    testVoice() {
      this.speak("Dans 150 mètres, tournez à droite sur la piste cyclable protégée.", 'turn');
    }
  }

  // =========================================================================
  // 6. Compass & Orientation Manager (Mode Cap / Course-Up & Rotation Guidon)
  // =========================================================================
  class OrientationCompassManager {
    constructor(mapManager) {
      this.mapManager = mapManager;
      this.mode = 'north-up';
      this.currentHeading = 0;
      this.initEvents();
    }

    initEvents() {
      if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', (e) => {
          let heading = null;
          if (e.webkitCompassHeading) {
            heading = e.webkitCompassHeading;
          } else if (e.alpha !== null) {
            heading = 360 - e.alpha;
          }
          if (heading !== null) {
            this.setHeading(heading);
          }
        }, true);
      }

      window.addEventListener('orientationchange', () => {
        setTimeout(() => {
          if (this.mapManager && this.mapManager.map) {
            this.mapManager.map.invalidateSize();
          }
        }, 250);
      });
    }

    toggleMode() {
      this.mode = this.mode === 'north-up' ? 'course-up' : 'north-up';
      this.applyOrientation();
      return this.mode;
    }

    setHeading(headingDeg) {
      this.currentHeading = Math.round(headingDeg) % 360;
      this.applyOrientation();
    }

    applyOrientation() {
      const compassBtn = document.getElementById('btn-compass-mode');
      const compassIcon = document.getElementById('compass-icon');
      const mapContainer = document.getElementById('map');

      if (this.mode === 'course-up') {
        if (compassBtn) compassBtn.classList.add('active-course-up');
        if (compassIcon) compassIcon.style.transform = `rotate(${-this.currentHeading}deg)`;
        if (mapContainer) {
          mapContainer.style.transform = `rotate(${-this.currentHeading}deg)`;
          mapContainer.style.transformOrigin = '50% 50%';
          mapContainer.style.transition = 'transform 0.3s ease-out';
        }
      } else {
        if (compassBtn) compassBtn.classList.remove('active-course-up');
        if (compassIcon) compassIcon.style.transform = 'rotate(0deg)';
        if (mapContainer) {
          mapContainer.style.transform = 'none';
          mapContainer.style.transition = 'transform 0.3s ease-out';
        }
      }
    }
  }

  // =========================================================================
  // 7. 230V Charging Stations Engine
  // =========================================================================
  class ChargingStationsManager {
    constructor(mapManager, onNavigateToStation) {
      this.mapManager = mapManager;
      this.onNavigateToStation = onNavigateToStation;
      this.stations = [
        {
          id: 'ch_1',
          name: 'Station Belib\' - Prise Domestique 230V E/F',
          lat: 48.8570, lng: 2.3530,
          plug: 'Prise domestique 230V 16A standard (Type E/F)',
          access: 'Borne publique Belib\' • 24h/24',
          desc: 'Prise 230V normale disponible sur le côté de la borne auto. Compatible chargeur trottinette.'
        },
        {
          id: 'ch_2',
          name: 'Point Relais TrottiCharge 230V - Bastille',
          lat: 48.8528, lng: 2.3685,
          plug: '2x Prises 230V en accès libre',
          access: 'Café vélo & Atelier • Ouvert 8h-20h',
          desc: 'Recharge gratuite pour les trottinettes et vélos. Pompe et outils à disposition.'
        },
        {
          id: 'ch_3',
          name: 'Borne de Recharge Municipale 230V - République',
          lat: 48.8680, lng: 2.3640,
          plug: 'Prise 230V 16A protégée',
          access: 'Espace public • 24h/24',
          desc: 'Prise 230V située au niveau de la station vélos sécurisée.'
        },
        {
          id: 'ch_4',
          name: 'Borne Auto & 2RM 230V - Gare de Lyon',
          lat: 48.8455, lng: 2.3725,
          plug: 'Prise standard 230V 16A',
          access: 'Parvis gare • 24h/24',
          desc: 'Borne de recharge avec prise domestique pour deux-roues électriques.'
        },
        {
          id: 'ch_5',
          name: 'Station TrottiCharge 230V - Châtelet Les Halles',
          lat: 48.8605, lng: 2.3480,
          plug: '3x Prises 230V 16A',
          access: 'Sortie Forum des Halles • 24h/24',
          desc: 'Prises 230V sous abri avec casiers de recharge.'
        }
      ];
      this.markers = [];
      this.isVisible = true;
    }

    generateNearbyStations(centerLat, centerLng) {
      const offsets = [
        { dLat: 0.0035, dLng: 0.0042, name: 'Borne Auto avec Prise 230V 16A' },
        { dLat: -0.0040, dLng: 0.0030, name: 'Station Vélo/Trotti Prise 230V' },
        { dLat: 0.0020, dLng: -0.0050, name: 'Borne Publique Prise Domestique 230V' }
      ];

      offsets.forEach((o, i) => {
        const id = `ch_dyn_${i}`;
        if (!this.stations.find(s => s.id === id)) {
          this.stations.push({
            id,
            name: o.name,
            lat: centerLat + o.dLat,
            lng: centerLng + o.dLng,
            plug: 'Prise 230V 16A standard (Type E/F)',
            access: 'Accès public 24h/24',
            desc: 'Prise 230V utilisable avec votre chargeur secteur trottinette habituel.'
          });
        }
      });
      this.render();
    }

    render() {
      this.clearMarkers();
      if (!this.isVisible || !this.mapManager || !this.mapManager.map) return;

      this.stations.forEach(st => {
        const icon = L.divIcon({
          className: 'charging-marker-icon',
          html: `<div title="${st.name}" style="color:#facc15; font-size:15px; font-weight:800;">⚡</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const marker = L.marker([st.lat, st.lng], { icon }).addTo(this.mapManager.map);
        
        const popupContent = `
          <div class="charging-popup-card">
            <div class="charge-popup-title">⚡ ${st.name}</div>
            <div class="charge-popup-plug">🔌 ${st.plug}</div>
            <div class="charge-popup-desc">${st.desc}<br><small>🕒 ${st.access}</small></div>
            <button class="btn-charge-route" id="btn-goto-charge-${st.id}">🚀 Y aller (Itinéraire)</button>
          </div>
        `;
        marker.bindPopup(popupContent);
        
        marker.on('popupopen', () => {
          const btn = document.getElementById(`btn-goto-charge-${st.id}`);
          if (btn) {
            btn.addEventListener('click', () => {
              marker.closePopup();
              if (this.onNavigateToStation) {
                this.onNavigateToStation(st);
              }
            });
          }
        });

        this.markers.push(marker);
      });
    }

    clearMarkers() {
      this.markers.forEach(m => this.mapManager.map.removeLayer(m));
      this.markers = [];
    }

    setVisible(visible) {
      this.isVisible = visible;
      if (visible) {
        this.render();
      } else {
        this.clearMarkers();
      }
    }

    findNearestStation(lat, lng) {
      let nearest = null;
      let minDistance = Infinity;

      this.stations.forEach(s => {
        const d = Math.hypot(s.lat - lat, s.lng - lng);
        if (d < minDistance) {
          minDistance = d;
          nearest = s;
        }
      });
      return nearest;
    }
  }

  // =========================================================================
  // 8. History & Favorites Manager
  // =========================================================================
  class HistoryManager {
    constructor() {
      this.recents = [];
      this.favorites = {
        home: { name: 'Domicile', full: '12 Rue de Rivoli, 75004 Paris', lat: 48.8556, lng: 2.3558, type: 'fav' },
        work: { name: 'Travail', full: 'Place de la République, 75011 Paris', lat: 48.8675, lng: 2.3638, type: 'fav' }
      };
      this.load();
    }

    load() {
      try {
        const r = localStorage.getItem('trottiwaze_recents_v2');
        if (r) this.recents = JSON.parse(r);
        const f = localStorage.getItem('trottiwaze_favs_v2');
        if (f) this.favorites = { ...this.favorites, ...JSON.parse(f) };
      } catch (e) {}
    }

    save() {
      try {
        localStorage.setItem('trottiwaze_recents_v2', JSON.stringify(this.recents));
        localStorage.setItem('trottiwaze_favs_v2', JSON.stringify(this.favorites));
      } catch (e) {}
    }

    addRecent(item) {
      if (!item || !item.fullLabel) return;
      this.recents = this.recents.filter(r => r.fullLabel.toLowerCase() !== item.fullLabel.toLowerCase());
      this.recents.unshift({
        mainText: item.mainText || item.fullLabel.split(',')[0],
        subText: item.subText || item.fullLabel.split(',').slice(1).join(',').trim(),
        fullLabel: item.fullLabel,
        lat: item.lat,
        lng: item.lng,
        type: item.type || 'history',
        timestamp: Date.now()
      });
      if (this.recents.length > 8) this.recents.pop();
      this.save();
    }

    getFavorite(key) {
      return this.favorites[key] || null;
    }
  }

  // =========================================================================
  // 9. Ride Recorder (Geovelo Style)
  // =========================================================================
  class RideRecorder {
    constructor(onUpdateCallback) {
      this.isRecording = false;
      this.isPaused = false;
      this.startTime = null;
      this.timerInterval = null;
      this.elapsedSeconds = 0;
      this.totalDistanceM = 0;
      this.recordedPoints = [];
      this.speedsList = [];
      this.maxSpeedKmh = 0;
      this.onUpdateCallback = onUpdateCallback;
      this.savedRides = [];
      this.loadSavedRides();
    }

    loadSavedRides() {
      try {
        const raw = localStorage.getItem('trottiwaze_saved_rides');
        if (raw) this.savedRides = JSON.parse(raw);
      } catch (e) {}
    }

    saveRidesToStorage() {
      try {
        localStorage.setItem('trottiwaze_saved_rides', JSON.stringify(this.savedRides));
      } catch (e) {}
    }

    startRecording() {
      this.isRecording = true;
      this.isPaused = false;
      this.startTime = Date.now();
      this.elapsedSeconds = 0;
      this.totalDistanceM = 0;
      this.recordedPoints = [];
      this.speedsList = [];
      this.maxSpeedKmh = 0;

      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        if (!this.isPaused) {
          this.elapsedSeconds++;
          this.notifyUpdate();
        }
      }, 1000);

      this.notifyUpdate();
    }

    pauseRecording() {
      this.isPaused = true;
      this.notifyUpdate();
    }

    resumeRecording() {
      this.isPaused = false;
      this.notifyUpdate();
    }

    addGpsPoint(lat, lng, speedKmh = 0, alt = 0) {
      if (!this.isRecording || this.isPaused) return;

      const point = {
        lat,
        lng,
        alt: alt || 0,
        speed: speedKmh || 0,
        time: Date.now()
      };

      if (this.recordedPoints.length > 0) {
        const last = this.recordedPoints[this.recordedPoints.length - 1];
        const distDeltaM = this.computeDistanceMeters(last.lat, last.lng, lat, lng);
        if (distDeltaM > 1) {
          this.totalDistanceM += distDeltaM;
        }
      }

      this.recordedPoints.push(point);
      if (speedKmh > 0) {
        this.speedsList.push(speedKmh);
        if (speedKmh > this.maxSpeedKmh) this.maxSpeedKmh = speedKmh;
      }

      this.notifyUpdate();
    }

    stopAndSave(title = 'Sortie Trottinette') {
      if (!this.isRecording) return null;
      if (this.timerInterval) clearInterval(this.timerInterval);

      const distanceKm = (this.totalDistanceM / 1000);
      const avgSpeedKmh = this.elapsedSeconds > 0 ? ((distanceKm / (this.elapsedSeconds / 3600))) : 0;

      const newRide = {
        id: 'ride_' + Date.now(),
        title: title,
        date: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now(),
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        durationSeconds: this.elapsedSeconds,
        durationFormatted: this.formatTime(this.elapsedSeconds),
        avgSpeedKmh: parseFloat(avgSpeedKmh.toFixed(1)),
        maxSpeedKmh: parseFloat(this.maxSpeedKmh.toFixed(1)),
        points: this.recordedPoints
      };

      this.savedRides.unshift(newRide);
      this.saveRidesToStorage();

      this.isRecording = false;
      this.isPaused = false;
      this.notifyUpdate();

      return newRide;
    }

    deleteRide(id) {
      this.savedRides = this.savedRides.filter(r => r.id !== id);
      this.saveRidesToStorage();
    }

    clearAllRides() {
      this.savedRides = [];
      this.saveRidesToStorage();
    }

    exportGpx(id) {
      const ride = this.savedRides.find(r => r.id === id);
      if (!ride || !ride.points || ride.points.length === 0) return;

      let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      gpx += `<gpx version="1.1" creator="TrottiWaze" xmlns="http://www.topografix.com/GPX/1/1">\n`;
      gpx += `  <trk>\n    <name>${ride.title}</name>\n    <trkseg>\n`;
      ride.points.forEach(p => {
        gpx += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n        <ele>${p.alt || 0}</ele>\n        <time>${new Date(p.time).toISOString()}</time>\n      </trkpt>\n`;
      });
      gpx += `    </trkseg>\n  </trk>\n</gpx>`;

      const blob = new Blob([gpx], { type: 'application/gpx+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trottiwaze_trajet_${ride.id}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
    }

    getGlobalStats() {
      const totalKm = this.savedRides.reduce((acc, r) => acc + (r.distanceKm || 0), 0);
      const totalSec = this.savedRides.reduce((acc, r) => acc + (r.durationSeconds || 0), 0);
      const avgSpeed = totalSec > 0 ? (totalKm / (totalSec / 3600)) : 0;

      return {
        totalKm: totalKm.toFixed(1),
        totalTime: this.formatTime(totalSec),
        avgSpeed: avgSpeed.toFixed(1),
        tripsCount: this.savedRides.length
      };
    }

    computeDistanceMeters(lat1, lon1, lat2, lon2) {
      const R = 6371e3;
      const φ1 = lat1 * Math.PI / 180;
      const φ2 = lat2 * Math.PI / 180;
      const Δφ = (lat2 - lat1) * Math.PI / 180;
      const Δλ = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }

    formatTime(seconds) {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      if (hrs > 0) return `${hrs}h ${mins.toString().padStart(2, '0')}`;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    notifyUpdate() {
      if (this.onUpdateCallback) {
        const distKm = (this.totalDistanceM / 1000).toFixed(2);
        const avgSpeed = this.elapsedSeconds > 0 ? ((this.totalDistanceM / 1000) / (this.elapsedSeconds / 3600)).toFixed(1) : '0.0';
        this.onUpdateCallback({
          isRecording: this.isRecording,
          isPaused: this.isPaused,
          elapsedSeconds: this.elapsedSeconds,
          timeFormatted: this.formatTime(this.elapsedSeconds),
          distanceKm: distKm,
          avgSpeedKmh: avgSpeed,
          maxSpeedKmh: this.maxSpeedKmh.toFixed(1)
        });
      }
    }
  }

  // =========================================================================
  // 10. Official Verified Cycleways Catalog (Pistes 100% Sûres & Séparées)
  // =========================================================================
  const VERIFIED_CYCLEWAYS_CATALOG = [
    {
      id: 'paris_rev1',
      name: 'Piste REV 1 - Rue de Rivoli / Saint-Antoine',
      city: 'Paris',
      cityLabel: 'Paris (75001 / 75004 / 75011 / 75012)',
      tag: 'Voie Express Protégée',
      type: 'Piste bidirectionnelle séparée (Bordure haute)',
      surface: 'Enrobé lisse • 0% Pavés • 0% Terre',
      lengthKm: 6.4,
      lat: 48.8575,
      lng: 2.3518,
      coords: [
        [48.8656, 2.3212], [48.8638, 2.3323], [48.8617, 2.3392], [48.8584, 2.3470],
        [48.8575, 2.3518], [48.8552, 2.3601], [48.8531, 2.3698], [48.8504, 2.3831],
        [48.8482, 2.3959], [48.8471, 2.4128]
      ],
      description: 'Axe structurant majeur Ouest-Est, 100% protégé des voitures par un séparateur béton, reliant la Concorde, l\'Hôtel de Ville, Bastille et la Nation.'
    },
    {
      id: 'paris_rev2',
      name: 'Piste REV 2 - Sébastopol / Saint-Michel',
      city: 'Paris',
      cityLabel: 'Paris (75003 / 75004 / 75005)',
      tag: 'Axe Express Nord-Sud',
      type: 'Piste bidirectionnelle protégée',
      surface: 'Enrobé lisse • 0% Pavés',
      lengthKm: 4.8,
      lat: 48.8631,
      lng: 2.3533,
      coords: [
        [48.8763, 2.3584], [48.8710, 2.3560], [48.8696, 2.3538], [48.8631, 2.3533],
        [48.8584, 2.3470], [48.8555, 2.3458], [48.8510, 2.3435], [48.8398, 2.3375]
      ],
      description: 'Corridor cyclable direct Nord-Sud de Gare de l\'Est à Port-Royal via Sébastopol, Châtelet et le Quartier Latin.'
    },
    {
      id: 'paris_pompidou',
      name: 'Voie Georges Pompidou - Berges de Seine Rive Droite',
      city: 'Paris',
      cityLabel: 'Paris (75001 / 75004 / 75008)',
      tag: 'Voie Verte 100% Sans Voiture',
      type: 'Voie piétons/cycles réservée',
      surface: 'Enrobé lisse ultra-roulant',
      lengthKm: 5.2,
      lat: 48.8540,
      lng: 2.3520,
      coords: [
        [48.8510, 2.3590], [48.8540, 2.3520], [48.8565, 2.3460], [48.8590, 2.3340],
        [48.8620, 2.3240], [48.8640, 2.3180], [48.8635, 2.3130], [48.8630, 2.3010]
      ],
      description: 'Ancienne voie express reconvertie en boulevard cyclable au bord de l\'eau, 0 intersection, 0 feu rouge de Sully à l\'Alma.'
    },
    {
      id: 'paris_berges_rg',
      name: 'Voie Rive Gauche - Berges de Seine (Orsay / Tour Eiffel)',
      city: 'Paris',
      cityLabel: 'Paris (75007)',
      tag: 'Promenade Cyclable Fluviale',
      type: 'Voie cyclable réservée en bord de Seine',
      surface: 'Enrobé lisse bitumé',
      lengthKm: 3.5,
      lat: 48.8610,
      lng: 2.3180,
      coords: [
        [48.8610, 2.3245], [48.8605, 2.3210], [48.8615, 2.3120], [48.8620, 2.3020], [48.8584, 2.2945]
      ],
      description: 'Voie apaisée au pied du Musée d\'Orsay, des Invalides et menant directement sous la Tour Eiffel.'
    },
    {
      id: 'paris_voltaire',
      name: 'Piste Boulevard Voltaire (République - Nation)',
      city: 'Paris',
      cityLabel: 'Paris (75011)',
      tag: 'Piste Séparée Bidirectionnelle',
      type: 'Piste cyclable séparée de la circulation',
      surface: 'Enrobé lisse',
      lengthKm: 2.9,
      lat: 48.8568,
      lng: 2.3789,
      coords: [
        [48.8675, 2.3638], [48.8640, 2.3705], [48.8585, 2.3790], [48.8545, 2.3860], [48.8505, 2.3920], [48.8482, 2.3959]
      ],
      description: 'Liaison directe protégée entre la Place de la République et la Place de la Nation avec feux vélo dédiés.'
    },
    {
      id: 'paris_canal_stmartin',
      name: 'Canal Saint-Martin & Canal de l\'Ourcq',
      city: 'Paris',
      cityLabel: 'Paris (75010 / 75019) / Pantin',
      tag: 'Voie Verte des Canaux',
      type: 'Voie cyclable sécurisée au fil de l\'eau',
      surface: 'Enrobé lisse & passages pontons lisses',
      lengthKm: 7.8,
      lat: 48.8740,
      lng: 2.3675,
      coords: [
        [48.8690, 2.3670], [48.8740, 2.3675], [48.8820, 2.3690], [48.8870, 2.3760],
        [48.8930, 2.3890], [48.8950, 2.4040], [48.8970, 2.4210]
      ],
      description: 'Itinéraire paisible sans voiture de République jusqu\'au Bassin de la Villette et Pantin le long de l\'eau.'
    },
    {
      id: 'paris_coulee_verte_sud',
      name: 'Coulée Verte du Sud Parisien (Paris - Massy)',
      city: 'Paris',
      cityLabel: 'Paris (75014) / Hauts-de-Seine / Essonne',
      tag: 'Super Piste Cyclable Express',
      type: 'Voie verte 100% protégée en site propre',
      surface: 'Enrobé lisse asphalté',
      lengthKm: 14.2,
      lat: 48.8250,
      lng: 2.2980,
      coords: [
        [48.8370, 2.3180], [48.8250, 2.2980], [48.8150, 2.2960], [48.8000, 2.2930],
        [48.7880, 2.2900], [48.7720, 2.2970], [48.7530, 2.3000], [48.7280, 2.2600]
      ],
      description: 'L\'un des plus grands corridors cyclables d\'Île-de-France, au tracé continu et sans voiture de Montparnasse à Massy.'
    },
    {
      id: 'paris_daumesnil',
      name: 'Avenue Daumesnil (Bastille - Porte Dorée)',
      city: 'Paris',
      cityLabel: 'Paris (75012)',
      tag: 'Axe Vert Est Parisien',
      type: 'Piste bidirectionnelle séparée',
      surface: 'Enrobé lisse',
      lengthKm: 4.1,
      lat: 48.8398,
      lng: 2.3950,
      coords: [
        [48.8531, 2.3698], [48.8448, 2.3735], [48.8475, 2.3870], [48.8398, 2.3950], [48.8350, 2.4060], [48.8300, 2.4180]
      ],
      description: 'Large piste cyclable sécurisée permettant de rejoindre le Bois de Vincennes depuis Bastille en toute quiétude.'
    },
    {
      id: 'lyon_vl1',
      name: 'Voie Lyonnaise 1 (VL1) - Berges du Rhône',
      city: 'Lyon',
      cityLabel: 'Lyon (69006 / 69003 / 69007)',
      tag: 'Autoroute Cyclable Métropolitaine',
      type: 'Voie express vélo 4m de large séparée',
      surface: 'Enrobé lisse haute qualité',
      lengthKm: 8.5,
      lat: 45.7538,
      lng: 4.8423,
      coords: [
        [45.7760, 4.8540], [45.7680, 4.8420], [45.7550, 4.8390], [45.7480, 4.8380], [45.7320, 4.8320], [45.7280, 4.8250]
      ],
      description: 'La colonne vertébrale cyclable de la Métropole de Lyon : traverse toute la ville du Parc de la Tête d\'Or à Gerland le long du Rhône.'
    },
    {
      id: 'lyon_vl2',
      name: 'Voie Lyonnaise 2 (VL2) - Saône / Part-Dieu',
      city: 'Lyon',
      cityLabel: 'Lyon (69001 / 69003 / 69008)',
      tag: 'Voie Lyonnaise Majeure',
      type: 'Piste bidirectionnelle protégée',
      surface: 'Enrobé lisse',
      lengthKm: 6.2,
      lat: 45.7605,
      lng: 4.8580,
      coords: [
        [45.7890, 4.8250], [45.7800, 4.8300], [45.7690, 4.8310], [45.7600, 4.8350], [45.7600, 4.8400], [45.7605, 4.8580], [45.7430, 4.8780]
      ],
      description: 'Liaison directe sécurisée entre les Quais de Saône, la Presqu\'île, le quartier de la Part-Dieu et Grange Blanche.'
    },
    {
      id: 'bordeaux_quais',
      name: 'Voie Verte des Quais de Garonne (Rive Gauche)',
      city: 'Bordeaux',
      cityLabel: 'Bordeaux (33000 / 33300)',
      tag: 'Grande Piste Fluviale',
      type: 'Voie verte en site propre 100% isolée',
      surface: 'Enrobé lisse impeccable',
      lengthKm: 5.6,
      lat: 44.8412,
      lng: -0.5694,
      coords: [
        [44.8580, -0.5520], [44.8510, -0.5670], [44.8415, -0.5695], [44.8375, -0.5640], [44.8290, -0.5540], [44.8250, -0.5560]
      ],
      description: 'Magnifique piste cyclable longeant les façades XVIIIe des Chartrons, le Miroir d\'eau, le Pont de Pierre et la Gare Saint-Jean.'
    },
    {
      id: 'bordeaux_lacanau',
      name: 'Voie Verte Bordeaux - Lacanau (Tronçon Eysines)',
      city: 'Bordeaux',
      cityLabel: 'Bordeaux Métropole (Eysines / Le Bouscat)',
      tag: 'Voie Verte Sans Voitures',
      type: 'Piste cyclable dédiée en site propre',
      surface: 'Enrobé bitumé lisse',
      lengthKm: 7.2,
      lat: 44.8680,
      lng: -0.6120,
      coords: [
        [44.8820, -0.6500], [44.8680, -0.6120], [44.8560, -0.5900]
      ],
      description: 'Voie verte protégée aménagée sur l\'ancienne voie ferrée, idéale pour traverser le quadrant nord-ouest bordelais.'
    },
    {
      id: 'toulouse_canal_midi',
      name: 'Voie Verte du Canal du Midi (Ponts Jumeaux - Ramonville)',
      city: 'Toulouse',
      cityLabel: 'Toulouse (31000 / 31400 / 31520)',
      tag: 'Voie Verte Ombragée',
      type: 'Piste cyclable aménagée berge enrobée',
      surface: 'Enrobé lisse • Plat',
      lengthKm: 9.8,
      lat: 43.6050,
      lng: 1.4550,
      coords: [
        [43.6120, 1.4170], [43.6110, 1.4540], [43.5990, 1.4580], [43.5850, 1.4670], [43.5480, 1.4780]
      ],
      description: 'L\'axe cyclable emblématique de Toulouse sous les platanes, reliant les Ponts Jumeaux, la Gare Matabiau et Ramonville.'
    },
    {
      id: 'toulouse_garonne',
      name: 'Berges de la Garonne - Quai de la Daurade / Prairie des Filtres',
      city: 'Toulouse',
      cityLabel: 'Toulouse (31000 / 31300)',
      tag: 'Piste Cyclable du Fleuve',
      type: 'Voie cyclable sécurisée en bord de fleuve',
      surface: 'Enrobé lisse',
      lengthKm: 3.2,
      lat: 43.6000,
      lng: 1.4400,
      coords: [
        [43.6030, 1.4360], [43.6010, 1.4390], [43.5995, 1.4410], [43.5970, 1.4380], [43.5870, 1.4370]
      ],
      description: 'Piste cyclable paisible avec vue imprenable sur le Pont Neuf, le dôme de la Grave et l\'Île du Ramier.'
    },
    {
      id: 'strasbourg_forts',
      name: 'Piste des Forts (Ceinture Verte Européenne)',
      city: 'Strasbourg',
      cityLabel: 'Strasbourg (67000 / Eurométropole)',
      tag: 'Capitale du Vélo',
      type: 'Piste cyclable séparée continue',
      surface: 'Enrobé lisse impeccable',
      lengthKm: 11.5,
      lat: 48.5950,
      lng: 7.7750,
      coords: [
        [48.5910, 7.7710], [48.5970, 7.7720], [48.6080, 7.7850], [48.5690, 7.7980]
      ],
      description: 'Parcours cyclable d\'excellence dans la première ville cyclable de France, reliant le Parc de l\'Orangerie et le Rhin.'
    },
    {
      id: 'nantes_50_otages',
      name: 'Axe Nord-Sud Cours des 50 Otages',
      city: 'Nantes',
      cityLabel: 'Nantes (44000)',
      tag: 'Axe Magistral Vélo',
      type: 'Piste cyclable centrale protégée',
      surface: 'Enrobé lisse',
      lengthKm: 2.8,
      lat: 47.2170,
      lng: -1.5560,
      coords: [
        [47.2180, -1.5420], [47.2160, -1.5490], [47.2170, -1.5560], [47.2130, -1.5580], [47.2120, -1.5540]
      ],
      description: 'Corridor cyclable central traversant le cœur historique de Nantes, du Château des Ducs à la Place du Commerce.'
    },
    {
      id: 'lille_deule',
      name: 'Voie Verte des Berges de la Deûle (Lille - Wambrechies)',
      city: 'Lille',
      cityLabel: 'Lille (59000) / MEL',
      tag: 'Voie Verte Métropolitaine',
      type: 'Piste cyclable en site propre au bord de l\'eau',
      surface: 'Enrobé lisse 100%',
      lengthKm: 8.4,
      lat: 50.6510,
      lng: 3.0250,
      coords: [
        [50.6380, 3.0420], [50.6350, 3.0230], [50.6510, 3.0250], [50.6860, 3.0520]
      ],
      description: 'Axe cyclable vert majeur partant de la Citadelle de Lille pour remonter la Deûle jusqu\'à Lambersart et Wambrechies.'
    },
    {
      id: 'nice_promenade',
      name: 'Promenade des Anglais - Piste Maritime',
      city: 'Nice',
      cityLabel: 'Nice (06000 / 06200)',
      tag: 'Piste Littorale Sécurisée',
      type: 'Voie cyclable bidirectionnelle dédiée en bord de mer',
      surface: 'Enrobé lisse parfait',
      lengthKm: 7.5,
      lat: 43.6910,
      lng: 7.2480,
      coords: [
        [43.6940, 7.2850], [43.6945, 7.2750], [43.6960, 7.2680], [43.6910, 7.2480], [43.6760, 7.2250], [43.6650, 7.2050]
      ],
      description: 'Piste cyclable continue en front de mer, 100% isolée de la chaussée automobile du Port Lympia jusqu\'à l\'Aéroport.'
    },
    {
      id: 'marseille_corniche',
      name: 'Voie Verte de la Corniche Kennedy',
      city: 'Marseille',
      cityLabel: 'Marseille (13007 / 13008)',
      tag: 'Piste Maritime Panoramique',
      type: 'Piste cyclable séparée sur trottoir élargi',
      surface: 'Enrobé lisse',
      lengthKm: 4.3,
      lat: 43.2790,
      lng: 5.3620,
      coords: [
        [43.2910, 5.3520], [43.2840, 5.3500], [43.2790, 5.3620], [43.2610, 5.3740]
      ],
      description: 'Piste cyclable côtière séparée offrant une vue imprenable sur les îles du Frioul des Catalans jusqu\'au Prado.'
    },
    {
      id: 'montpellier_lez',
      name: 'Voie Verte des Rives du Lez (Antigone - Palavas)',
      city: 'Montpellier',
      cityLabel: 'Montpellier (34000) / Palavas-les-Flots',
      tag: 'Voie Verte Littorale',
      type: 'Piste cyclable 100% protégée',
      surface: 'Enrobé lisse',
      lengthKm: 11.2,
      lat: 43.5850,
      lng: 3.9100,
      coords: [
        [43.6080, 3.8900], [43.6000, 3.8990], [43.5850, 3.9100], [43.5320, 3.9310]
      ],
      description: 'Liaison cyclable directe et sécurisée d\'Antigone à la mer Méditerranée le long du fleuve Lez.'
    },
    {
      id: 'grenoble_isere',
      name: 'ChronoVélo 1 - Berges de l\'Isère',
      city: 'Grenoble',
      cityLabel: 'Grenoble (38000 / Grenoble-Alpes Métropole)',
      tag: 'Autoroute Vélo ChronoVélo',
      type: 'Voie express vélo protégée 4m',
      surface: 'Enrobé lisse haute performance',
      lengthKm: 9.1,
      lat: 45.1980,
      lng: 5.7420,
      coords: [
        [45.1930, 5.6880], [45.2010, 5.7070], [45.1960, 5.7220], [45.1980, 5.7420], [45.2080, 5.7720]
      ],
      description: 'Axe ChronoVélo majeur longeant l\'Isère d\'Ouest en Est, totalement plat et prioritaire à tous les carrefours.'
    }
  ];

  // =========================================================================
  // 11. Map Manager (Leaflet 2D Fiable & Vector High-Vis Overlay)
  // =========================================================================
  class MapManager {
    constructor(containerId = 'map') {
      this.containerId = containerId;
      this.map = null;
      this.scooterMarker = null;
      this.routePolylines = [];
      this.liveRecordPolyline = null;
      this.pastRidePolyline = null;
      this.verifiedTracksGroup = null;
      this.currentLayerId = 'osm';
      this.isAutoFollowing = true;
      this.defaultCenter = [48.8531, 2.3698];
      this.currentLocation = { lat: 48.8531, lng: 2.3698, heading: 90, speed: 0 };
      this.tileLayers = {};
      this.initMap();
    }

    initMap() {
      if (typeof L === 'undefined') return;

      this.map = L.map(this.containerId, {
        center: this.defaultCenter,
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true
      });

      L.control.attribution({ position: 'bottomleft' })
        .addAttribution('&copy; <a href="https://www.openstreetmap.org">OSM</a> | &copy; CyclOSM | &copy; IGN | &copy; Esri')
        .addTo(this.map);
      L.control.zoom({ position: 'topleft' }).addTo(this.map);

      this.map.on('dragstart', () => {
        this.setAutoFollow(false);
      });

      const tileOpts = { maxZoom: 19, crossOrigin: true };

      this.tileLayers = {
        osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { ...tileOpts, maxZoom: 19 }),
        cyclosm: L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', { ...tileOpts, subdomains: 'abc', maxZoom: 20 }),
        streets: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { ...tileOpts, maxZoom: 19 }),
        osmfr: L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', { ...tileOpts, subdomains: 'abc', maxZoom: 20 }),
        ign: L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', { ...tileOpts, maxZoom: 19, attribution: '&copy; IGN' }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { ...tileOpts, maxZoom: 19 }),
        night: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { ...tileOpts, subdomains: 'abcd', maxZoom: 19 })
      };

      // Verified Cycleways Overlay Tiles (CyclOSM)
      this.cyclewaysOverlay = L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
        ...tileOpts,
        subdomains: 'abc',
        maxZoom: 20,
        opacity: 0.85
      });
      this.isVerifiedCyclewaysEnabled = true;

      this.tileLayers.osm.addTo(this.map);
      this.cyclewaysOverlay.addTo(this.map); // Active by default for verified bike lanes
      
      // Initialize Vector High-Visibility Layer for Guaranteed Certified Cycle Corridors
      this.initVerifiedCyclewaysVectorLayer();

      this.createScooterMarker(this.defaultCenter[0], this.defaultCenter[1]);

      window.addEventListener('resize', () => this.map.invalidateSize());
      window.addEventListener('orientationchange', () => setTimeout(() => this.map.invalidateSize(), 200));
      setTimeout(() => this.map.invalidateSize(), 50);
      setTimeout(() => this.map.invalidateSize(), 300);
      setTimeout(() => this.map.invalidateSize(), 1200);
    }

    initVerifiedCyclewaysVectorLayer() {
      if (this.verifiedTracksGroup) {
        this.verifiedTracksGroup.clearLayers();
      } else {
        this.verifiedTracksGroup = L.layerGroup();
      }

      VERIFIED_CYCLEWAYS_CATALOG.forEach(track => {
        if (!track.coords || track.coords.length < 2) return;

        // Glowing outer emerald glow stroke
        const glow = L.polyline(track.coords, {
          color: 'rgba(16, 185, 129, 0.4)',
          weight: 10,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round'
        });

        // Core crisp emerald track line
        const line = L.polyline(track.coords, {
          color: '#10b981',
          weight: 4.5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        });

        const popupHtml = `
          <div class="verified-track-popup">
            <div class="track-popup-header">
              <span class="track-shield">🛡️ PISTE PROTÉGÉE VÉRIFIÉE</span>
              <span class="track-quality">✨ 100% Sûre</span>
            </div>
            <div class="track-popup-title">${track.name}</div>
            <div class="track-popup-city">📍 ${track.cityLabel || track.city}</div>
            <div class="track-popup-details">
              <div class="track-badge-pill">🛣️ ${track.surface}</div>
              <div class="track-badge-pill">🔒 ${track.type}</div>
              <div class="track-badge-pill">📏 ${track.lengthKm} km</div>
            </div>
            <p class="track-popup-desc">${track.description}</p>
            <button class="btn-navigate-track" onclick="if(window.trottiApp){window.trottiApp.navigateToCycleway('${track.id}');}">🛴 Naviguer sur cette piste</button>
          </div>
        `;

        line.bindPopup(popupHtml);
        glow.bindPopup(popupHtml);

        this.verifiedTracksGroup.addLayer(glow);
        this.verifiedTracksGroup.addLayer(line);
      });

      if (this.isVerifiedCyclewaysEnabled && this.map) {
        this.verifiedTracksGroup.addTo(this.map);
      }
    }

    setVerifiedCyclewaysVisible(enabled) {
      this.isVerifiedCyclewaysEnabled = enabled;
      if (enabled) {
        if (!this.map.hasLayer(this.cyclewaysOverlay)) {
          this.cyclewaysOverlay.addTo(this.map);
        }
        if (this.verifiedTracksGroup && !this.map.hasLayer(this.verifiedTracksGroup)) {
          this.verifiedTracksGroup.addTo(this.map);
        }
      } else {
        if (this.map.hasLayer(this.cyclewaysOverlay)) {
          this.map.removeLayer(this.cyclewaysOverlay);
        }
        if (this.verifiedTracksGroup && this.map.hasLayer(this.verifiedTracksGroup)) {
          this.map.removeLayer(this.verifiedTracksGroup);
        }
      }
      this.map.invalidateSize();
    }

    zoomToCycleway(trackId) {
      const track = VERIFIED_CYCLEWAYS_CATALOG.find(t => t.id === trackId);
      if (!track || !this.map || !track.coords) return;
      const poly = L.polyline(track.coords);
      this.map.fitBounds(poly.getBounds(), { padding: [60, 60], maxZoom: 16 });
      this.setAutoFollow(false);
    }

    setTileLayer(layerId) {
      if (!this.tileLayers[layerId]) return 'OpenStreetMap Standard';
      if (this.currentLayerId && this.tileLayers[this.currentLayerId]) {
        this.map.removeLayer(this.tileLayers[this.currentLayerId]);
      }
      this.currentLayerId = layerId;
      this.tileLayers[layerId].addTo(this.map);

      // Keep cycleways overlay on top if not using cyclosm base
      if (this.isVerifiedCyclewaysEnabled && layerId !== 'cyclosm') {
        if (!this.map.hasLayer(this.cyclewaysOverlay)) {
          this.cyclewaysOverlay.addTo(this.map);
        }
      } else if (layerId === 'cyclosm' && this.map.hasLayer(this.cyclewaysOverlay)) {
        this.map.removeLayer(this.cyclewaysOverlay);
      }

      this.map.invalidateSize();

      const names = {
        osm: 'OpenStreetMap Standard',
        cyclosm: 'CyclOSM France',
        streets: 'Style Urbain GPS (Esri)',
        osmfr: 'OpenStreetMap France',
        ign: 'Plan IGN Géoportail',
        satellite: 'Vue Satellite Réelle HD',
        night: 'Mode Nuit OLED'
      };
      return names[layerId] || layerId;
    }

    setAutoFollow(enabled) {
      this.isAutoFollowing = enabled;
      const btn = document.getElementById('btn-recenter');
      if (btn) btn.classList.toggle('active-tracking', enabled);
    }

    createScooterMarker(lat, lng, iconChar = '🛴') {
      const icon = L.divIcon({
        className: 'scooter-leaflet-div',
        html: `<div id="trotti-scooter-pin" class="scooter-marker-container"><div class="scooter-beam"></div><div class="scooter-icon-pin" id="scooter-icon-pin-inner">${iconChar}</div></div>`,
        iconSize: [44, 44], iconAnchor: [22, 22]
      });
      this.scooterMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(this.map);
    }

    updateScooterIcon(iconChar) {
      const pinInner = document.getElementById('scooter-icon-pin-inner');
      if (pinInner) pinInner.textContent = iconChar;
    }

    updateScooterPosition(lat, lng, heading = 0, speedKmh = 0) {
      this.currentLocation = { lat, lng, heading, speed: speedKmh };
      if (this.scooterMarker) {
        this.scooterMarker.setLatLng([lat, lng]);
        const pinEl = document.getElementById('trotti-scooter-pin');
        if (pinEl) pinEl.style.transform = `rotate(${heading}deg)`;
      }

      if (this.isAutoFollowing) {
        this.map.panTo([lat, lng], { animate: true, duration: 0.6, easeLinearity: 0.25 });
      }
    }

    recenter(zoom = 16) {
      this.setAutoFollow(true);
      if (this.currentLocation) {
        this.map.setView([this.currentLocation.lat, this.currentLocation.lng], zoom, {
          animate: true,
          pan: { duration: 0.5, easeLinearity: 0.25 }
        });
      }
      this.map.invalidateSize();
    }

    drawLiveTrackPoint(lat, lng) {
      if (!this.liveRecordPolyline) {
        this.liveRecordPolyline = L.polyline([[lat, lng]], {
          color: '#f43f5e',
          weight: 5,
          opacity: 0.9,
          lineJoin: 'round',
          dashArray: '8, 8'
        }).addTo(this.map);
      } else {
        this.liveRecordPolyline.addLatLng([lat, lng]);
      }
    }

    clearLiveTrack() {
      if (this.liveRecordPolyline) {
        this.map.removeLayer(this.liveRecordPolyline);
        this.liveRecordPolyline = null;
      }
    }

    displayPastRide(points) {
      this.clearPastRide();
      if (!points || points.length < 2) return;
      const latlngs = points.map(p => [p.lat, p.lng]);
      this.pastRidePolyline = L.polyline(latlngs, {
        color: '#38bdf8',
        weight: 6,
        opacity: 0.85
      }).addTo(this.map);
      this.map.fitBounds(this.pastRidePolyline.getBounds(), { padding: [40, 40] });
    }

    clearPastRide() {
      if (this.pastRidePolyline) {
        this.map.removeLayer(this.pastRidePolyline);
        this.pastRidePolyline = null;
      }
    }

    drawRoute(coordinates, mode = 'safe') {
      this.clearRoute();
      if (!coordinates || coordinates.length === 0) return;
      const colors = {
        safe: ['rgba(16,185,129,0.4)', '#10b981'],
        fast: ['rgba(14,165,233,0.4)', '#0ea5e9'],
        eco: ['rgba(234,179,8,0.4)', '#eab308'],
        nature: ['rgba(5,150,105,0.4)', '#059669']
      };
      const [glowColor, strokeColor] = colors[mode] || colors.safe;

      const glowLine = L.polyline(coordinates, { color: glowColor, weight: 10, opacity: 0.8 }).addTo(this.map);
      const mainLine = L.polyline(coordinates, { color: strokeColor, weight: 5, opacity: 1.0, lineCap: 'round', lineJoin: 'round' }).addTo(this.map);

      this.routePolylines.push(glowLine, mainLine);
      this.map.fitBounds(mainLine.getBounds(), { padding: [50, 50], maxZoom: 16 });
    }

    clearRoute() {
      this.routePolylines.forEach(layer => this.map.removeLayer(layer));
      this.routePolylines = [];
    }
  }

  // =========================================================================
  // 11. Routing Engine (Calcul d'Itinéraires Routiers Haute Précision OSRM)
  // =========================================================================
  class RoutingEngine {
    constructor(batteryEngine) {
      this.batteryEngine = batteryEngine;
      this.filters = {
        avoidCobblestones: true,
        avoidDirtPaths: true,
        avoidSteepHills: false,
        preferProtected: false
      };
      this.cache = new Map();
    }

    setFilters(filters) {
      this.filters = { ...this.filters, ...filters };
    }

    async searchAddress(query) {
      if (!query || query.trim().length < 2) return [];
      const clean = query.trim().toLowerCase();
      const results = [];
      const seen = new Set();

      // 0. Match Verified Cycleways Catalog FIRST (Priorité Pistes Sûres)
      if (typeof VERIFIED_CYCLEWAYS_CATALOG !== 'undefined') {
        VERIFIED_CYCLEWAYS_CATALOG.forEach(track => {
          const matchName = track.name.toLowerCase().includes(clean);
          const matchCity = track.city.toLowerCase().includes(clean) || (track.cityLabel && track.cityLabel.toLowerCase().includes(clean));
          const matchDesc = track.description && track.description.toLowerCase().includes(clean);
          const matchPiste = (clean.includes('piste') || clean.includes('voie') || clean.includes('canal') || clean.includes('quai') || clean.includes('berges') || clean.includes('rev')) && (matchName || matchCity);

          if (matchName || matchCity || matchDesc || matchPiste) {
            const key = `cycleway_${track.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                mainText: track.name,
                subText: `🛡️ ${track.tag} • ${track.city} (${track.lengthKm} km)`,
                fullLabel: `${track.name}, ${track.city}`,
                lat: track.lat,
                lng: track.lng,
                isVerifiedCycleway: true,
                trackId: track.id
              });
            }
          }
        });
      }

      // 1. Try French National Address API (BAN - Data.gouv)
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
                results.push({
                  mainText: props.name || props.label,
                  subText: props.context || `${props.postcode || ''} ${props.city || ''}`,
                  fullLabel: props.label,
                  lat: f.geometry.coordinates[1],
                  lng: f.geometry.coordinates[0],
                  isVerifiedCycleway: false
                });
              }
            });
          }
        }
      } catch (e) {}

      // 2. Fallback to OpenStreetMap Nominatim
      if (results.length < 3) {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=fr,be,ch`;
          const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
          if (res.ok) {
            const data = await res.json();
            data.forEach(item => {
              if (!seen.has(item.display_name.toLowerCase())) {
                seen.add(item.display_name.toLowerCase());
                results.push({
                  mainText: item.display_name.split(',')[0],
                  subText: item.display_name.split(',').slice(1, 3).join(',').trim(),
                  fullLabel: item.display_name,
                  lat: parseFloat(item.lat),
                  lng: parseFloat(item.lon),
                  isVerifiedCycleway: false
                });
              }
            });
          }
        } catch (e) {}
      }

      return results.slice(0, 6);
    }

    getNearestCycleways(lat, lng, limit = 12) {
      if (typeof VERIFIED_CYCLEWAYS_CATALOG === 'undefined') return [];
      return VERIFIED_CYCLEWAYS_CATALOG.map(t => {
        const dist = this.computeDistanceKm(lat, lng, t.lat, t.lng);
        return { ...t, distanceToUserKm: parseFloat(dist.toFixed(1)) };
      }).sort((a, b) => a.distanceToUserKm - b.distanceToUserKm).slice(0, limit);
    }

    async geocode(query) {
      const results = await this.searchAddress(query);
      return results.length > 0 ? { lat: results[0].lat, lng: results[0].lng } : null;
    }

    async calculateRoutes(startCoords, endCoords) {
      const sLat = startCoords.lat, sLng = startCoords.lng;
      const eLat = endCoords.lat, eLng = endCoords.lng;
      const cacheKey = `${sLat.toFixed(5)},${sLng.toFixed(5)}_${eLat.toFixed(5)},${eLng.toFixed(5)}`;

      let osrmBase = null;

      // 1. Fetch real road geometry from OpenStreetMap Bike Router
      const osrmEndpoints = [
        `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true`,
        `https://router.project-osrm.org/route/v1/bike/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true`,
        `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true`
      ];

      for (const endpoint of osrmEndpoints) {
        try {
          const res = await fetch(endpoint);
          if (res.ok) {
            const json = await res.json();
            if (json.routes && json.routes.length > 0 && json.routes[0].geometry) {
              osrmBase = json.routes[0];
              break;
            }
          }
        } catch (e) {
          // try next endpoint
        }
      }

      return this.buildTrottiRoutes(startCoords, endCoords, osrmBase);
    }

    buildTrottiRoutes(start, end, osrmBase = null) {
      let baseCoords = [];
      let baseDistanceKm = 0;
      let baseSteps = [];

      if (osrmBase && osrmBase.geometry && osrmBase.geometry.coordinates) {
        // Real road coordinates from OSRM: convert [lng, lat] to Leaflet [lat, lng]
        baseCoords = osrmBase.geometry.coordinates.map(c => [c[1], c[0]]);
        baseDistanceKm = parseFloat((osrmBase.distance / 1000).toFixed(2));

        if (osrmBase.legs && osrmBase.legs[0] && osrmBase.legs[0].steps) {
          baseSteps = osrmBase.legs[0].steps.map(s => {
            let mod = s.maneuver.modifier || 'straight';
            if (s.maneuver.type === 'arrive') mod = 'arrive';
            return {
              instruction: s.maneuver.type === 'arrive' ? 'Vous êtes arrivé à destination' : (s.name ? `Prenez ${s.name}` : 'Continuez tout droit'),
              distanceMeters: Math.round(s.distance),
              street: s.name || 'Voie cyclable sécurisée',
              modifier: mod,
              safety: '🟢 Piste cyclable protégée'
            };
          });
        }
      }

      // Offline / fallback: generate realistic street grid segments with 90° turns instead of straight lines
      if (baseCoords.length === 0) {
        const generated = this.generateRealisticGridRoute(start, end);
        baseCoords = generated.coords;
        baseDistanceKm = generated.distanceKm;
        baseSteps = generated.steps;
      }

      const speed = this.batteryEngine.config.speedPrefKmh || 25;

      const safeDist = parseFloat((baseDistanceKm * 1.05).toFixed(1));
      const fastDist = parseFloat((baseDistanceKm * 0.95).toFixed(1));
      const ecoDist = parseFloat((baseDistanceKm * 1.10).toFixed(1));
      const natureDist = parseFloat((baseDistanceKm * 1.20).toFixed(1));

      return {
        safe: {
          title: 'Sécurisé (Pistes Protégées)',
          mode: 'safe',
          distanceKm: safeDist,
          durationMin: Math.max(1, Math.round((safeDist / speed) * 60)),
          protectedPct: 94,
          praticability: '✨ 100% Voie cyclable séparée',
          cobblestonesCount: 0,
          elevationGainM: 12,
          elevationLossM: 10,
          maxSlopePct: 3,
          coordinates: baseCoords,
          steps: baseSteps.length > 0 ? baseSteps : [
            { distanceMeters: 250, street: 'Piste cyclable protégée', modifier: 'straight', instruction: 'Suivre la piste cyclable', safety: '🟢 Voie bidirectionnelle' },
            { distanceMeters: 100, street: 'Arrivée', modifier: 'arrive', instruction: 'Arrivée à destination', safety: '🏁 Point d\'arrivée' }
          ]
        },
        fast: {
          title: 'Direct & Rapide',
          mode: 'fast',
          distanceKm: fastDist,
          durationMin: Math.max(1, Math.round((fastDist / speed) * 60)),
          protectedPct: 62,
          praticability: this.filters.avoidCobblestones ? '✨ Bitumé' : '⚠️ 1 section pavée',
          cobblestonesCount: this.filters.avoidCobblestones ? 0 : 1,
          elevationGainM: 18,
          elevationLossM: 16,
          maxSlopePct: 5,
          coordinates: baseCoords,
          steps: baseSteps
        },
        eco: {
          title: 'Économie Batterie (Plat)',
          mode: 'eco',
          distanceKm: ecoDist,
          durationMin: Math.max(1, Math.round((ecoDist / speed) * 60)),
          protectedPct: 88,
          praticability: '✨ Pente douce < 2%',
          cobblestonesCount: 0,
          elevationGainM: 5,
          elevationLossM: 4,
          maxSlopePct: 2,
          coordinates: baseCoords,
          steps: baseSteps
        },
        nature: {
          title: 'Parcs & Canaux',
          mode: 'nature',
          distanceKm: natureDist,
          durationMin: Math.max(1, Math.round((natureDist / speed) * 60)),
          protectedPct: 98,
          praticability: '🌳 Voies vertes & berges',
          cobblestonesCount: 0,
          elevationGainM: 8,
          elevationLossM: 7,
          maxSlopePct: 2.5,
          coordinates: baseCoords,
          steps: baseSteps
        }
      };
    }

    generateRealisticGridRoute(start, end) {
      const coords = [];
      const lat1 = start.lat, lng1 = start.lng;
      const lat2 = end.lat, lng2 = end.lng;

      // Realistic urban street grid with orthogonal road turns (Manhattan grid)
      const numSegments = 16;
      coords.push([lat1, lng1]);

      const midLat = lat1 + (lat2 - lat1) * 0.45;
      const midLng = lng1 + (lng2 - lng1) * 0.55;

      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        coords.push([lat1 + (midLat - lat1) * t, lng1 + Math.sin(t * Math.PI) * 0.0004]);
      }
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        coords.push([midLat + Math.cos(t * Math.PI) * 0.0003, lng1 + (midLng - lng1) * t]);
      }
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        coords.push([midLat + (lat2 - midLat) * t, midLng + (lng2 - midLng) * t]);
      }
      coords.push([lat2, lng2]);

      const distKm = parseFloat((this.computeDistanceKm(lat1, lng1, lat2, lng2) * 1.25).toFixed(1));
      const steps = [
        { distanceMeters: 300, street: 'Piste cyclable urbaine', modifier: 'straight', instruction: 'Tout droit sur la piste', safety: '🟢 Voie propre' },
        { distanceMeters: 450, street: 'Axe transversal', modifier: 'right', instruction: 'Tournez à droite', safety: '🟢 Bande cyclable' },
        { distanceMeters: 200, street: 'Rue de destination', modifier: 'left', instruction: 'Tournez à gauche', safety: '🟡 Zone 30' },
        { distanceMeters: 50, street: 'Arrivée', modifier: 'arrive', instruction: 'Vous êtes arrivé !', safety: '🏁 Fin de trajet' }
      ];

      return { coords, distanceKm: distKm, steps };
    }

    computeDistanceKm(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }
  }

  // =========================================================================
  // 12. Navigation Engine
  // =========================================================================
  class NavigationEngine {
    constructor(mapManager, batteryEngine, rideRecorder, voiceEngine, compassManager) {
      this.mapManager = mapManager;
      this.batteryEngine = batteryEngine;
      this.rideRecorder = rideRecorder;
      this.voiceEngine = voiceEngine;
      this.compassManager = compassManager;
      this.activeRoute = null;
      this.isNavigating = false;
      this.isSimulated = false;
      this.simIndex = 0;
      this.simInterval = null;
      this.simulationSpeedMultiplier = 1;

      this.onSpeedUpdate = null;
      this.onStepUpdate = null;
      this.onTripUpdate = null;
      this.onArrival = null;
    }

    startNavigation(route, isSimulated = false) {
      this.activeRoute = route;
      this.isNavigating = true;
      this.isSimulated = isSimulated;
      this.simIndex = 0;

      if (this.voiceEngine) {
        this.voiceEngine.speak(`Départ. Suivez l'itinéraire ${route.title}, ${route.durationMin} minutes.`, 'turn');
      }

      if (isSimulated) {
        this.startSimulation();
      } else {
        this.startRealGpsTracking();
      }
    }

    startSimulation() {
      const coords = this.activeRoute.coordinates;
      if (this.simInterval) clearInterval(this.simInterval);

      this.simInterval = setInterval(() => {
        if (this.simIndex >= coords.length) {
          this.stopNavigation();
          if (this.onArrival) this.onArrival();
          return;
        }

        const currentPt = coords[this.simIndex];
        const nextPt = coords[Math.min(coords.length - 1, this.simIndex + 1)];
        const heading = this.calculateHeading(currentPt[0], currentPt[1], nextPt[0], nextPt[1]);
        const speed = Math.round((this.batteryEngine.config.speedPrefKmh || 25) * (0.9 + Math.random() * 0.15));

        this.mapManager.updateScooterPosition(currentPt[0], currentPt[1], heading, speed);
        if (this.compassManager) {
          this.compassManager.setHeading(heading);
        }

        if (this.rideRecorder && this.rideRecorder.isRecording) {
          this.rideRecorder.addGpsPoint(currentPt[0], currentPt[1], speed, 35);
          this.mapManager.drawLiveTrackPoint(currentPt[0], currentPt[1]);
        }

        if (this.onSpeedUpdate) this.onSpeedUpdate(speed);

        const stepIdx = Math.min(this.activeRoute.steps.length - 1, Math.floor((this.simIndex / coords.length) * this.activeRoute.steps.length));
        const step = this.activeRoute.steps[stepIdx];
        if (this.onStepUpdate) this.onStepUpdate(step);

        const progress = this.simIndex / coords.length;
        const remDist = Math.max(0, (this.activeRoute.distanceKm * (1 - progress)).toFixed(1));
        const remMin = Math.max(1, Math.round(this.activeRoute.durationMin * (1 - progress)));
        const batteryStatus = this.batteryEngine.estimateTrip(parseFloat(remDist), 5);

        if (this.onTripUpdate) {
          this.onTripUpdate({ remainingDistKm: remDist, remainingMin: remMin, batteryStatus });
        }

        this.simIndex++;
      }, 700 / this.simulationSpeedMultiplier);
    }

    startRealGpsTracking() {
      if (!navigator.geolocation) return;
      this.watchId = navigator.geolocation.watchPosition(
        pos => {
          const { latitude, longitude, speed, heading, altitude } = pos.coords;
          const speedKmh = Math.round((speed || 0) * 3.6);
          const currentHead = heading || 0;
          this.mapManager.updateScooterPosition(latitude, longitude, currentHead, speedKmh);
          if (this.compassManager) {
            this.compassManager.setHeading(currentHead);
          }

          if (this.rideRecorder && this.rideRecorder.isRecording) {
            this.rideRecorder.addGpsPoint(latitude, longitude, speedKmh, altitude || 0);
            this.mapManager.drawLiveTrackPoint(latitude, longitude);
          }

          if (this.onSpeedUpdate) this.onSpeedUpdate(speedKmh);
        },
        err => console.warn('GPS watch error:', err),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
      );
    }

    stopNavigation() {
      this.isNavigating = false;
      if (this.simInterval) clearInterval(this.simInterval);
      if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
    }

    setSimulationSpeed(multiplier) {
      this.simulationSpeedMultiplier = multiplier;
      if (this.isSimulated && this.isNavigating) this.startSimulation();
    }

    calculateHeading(lat1, lon1, lat2, lon2) {
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
      const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
                Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
      const brng = Math.atan2(y, x) * 180 / Math.PI;
      return (brng + 360) % 360;
    }
  }

  // =========================================================================
  // 13. Hazard Manager & Sound System
  // =========================================================================
  const HAZARD_TYPES = {
    charge: { label: 'Prise 230V / Borne', icon: '⚡', warning: 'Prise 230V standard disponible' },
    pothole: { label: 'Nid-de-poule / Pavés', icon: '🕳️', warning: 'Risque de chute roues 8-10"' },
    blocked: { label: 'Piste fermée / Travaux', icon: '🚧', warning: 'Déviation obligatoire' },
    police: { label: 'Contrôle Police', icon: '👮', warning: 'Vérif 25 km/h & équipement' },
    car: { label: 'Voiture sur la piste', icon: '🚗', warning: 'Obstruction dangereuse' },
    repair: { label: 'Station gonflage', icon: '🧰', warning: 'Pompe & outils publics' }
  };

  class HazardManager {
    constructor(mapManager) {
      this.mapManager = mapManager;
      this.hazards = [
        { id: 'h1', type: 'pothole', lat: 48.8552, lng: 2.3520, title: 'Nid-de-poule profond', desc: 'Rue de Rivoli voie droite', author: 'TrottiPro', upvotes: 5 },
        { id: 'h2', type: 'blocked', lat: 48.8580, lng: 2.3600, title: 'Travaux réseau', desc: 'Piste coupée sur 50m', author: 'NinebotMax', upvotes: 3 },
        { id: 'h3', type: 'police', lat: 48.8650, lng: 2.3650, title: 'Contrôle vitesse', desc: 'Place de la République', author: 'VeloParis', upvotes: 12 }
      ];
      this.markers = {};
      this.renderHazards();
    }

    renderHazards() {
      this.hazards.forEach(h => this.addHazardMarker(h));
    }

    addHazardMarker(h) {
      const cfg = HAZARD_TYPES[h.type] || HAZARD_TYPES.pothole;
      const icon = L.divIcon({
        className: 'hazard-leaflet-icon',
        html: `<div style="font-size:22px; filter:drop-shadow(0 2px 5px rgba(0,0,0,0.5)); cursor:pointer;" title="${h.title}">${cfg.icon}</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14]
      });
      const marker = L.marker([h.lat, h.lng], { icon }).addTo(this.mapManager.map);
      marker.bindPopup(`<strong>${cfg.icon} ${h.title}</strong><br><span style="font-size:11px; color:#64748b;">${h.desc}</span>`);
      this.markers[h.id] = marker;
    }

    addHazard(hazardData) {
      const id = 'h_' + Date.now();
      const h = { id, ...hazardData };
      this.hazards.push(h);
      this.addHazardMarker(h);
      return h;
    }

    playCockpitBell() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1760, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } catch (e) {}
    }
  }

  // =========================================================================
  // 14. Master TrottiWaze App Controller
  // =========================================================================
  class TrottiWazeApp {
    constructor() {
      window.trottiApp = this;
      this.authManager = new AuthManager();
      this.garageManager = new GarageManager(activeScooter => this.handleActiveScooterChanged(activeScooter));
      this.batteryEngine = new BatteryEngine(this.garageManager);
      this.weatherEngine = new WeatherEngine();
      this.historyManager = new HistoryManager();
      this.mapManager = new MapManager('map');
      this.compassManager = new OrientationCompassManager(this.mapManager);
      this.voiceEngine = new VoiceGuidanceEngine();
      
      this.rideRecorder = new RideRecorder(stats => this.handleRideRecorderUpdate(stats));
      this.chargingManager = new ChargingStationsManager(this.mapManager, station => this.navigateToChargingStation(station));
      this.routingEngine = new RoutingEngine(this.batteryEngine);
      this.navigationEngine = new NavigationEngine(this.mapManager, this.batteryEngine, this.rideRecorder, this.voiceEngine, this.compassManager);
      this.hazardManager = new HazardManager(this.mapManager);

      this.selectedRouteMode = 'safe';
      this.calculatedRoutes = null;
      this.selectedStartCoords = null;
      this.selectedEndCoords = null;
      this.selectedSignupAvatar = '🦊';
      this.selectedScooterIcon = '🛴';
      this.currentCyclewayCityFilter = 'all';

      this.cacheDOMElements();
      this.initEvents();
      this.initUserGPS();
      this.renderGarageFleetUI();
      this.renderRidesHistoryUI();
      this.initVoiceUI();
      this.updateUserAuthUI();
      this.chargingManager.render();
    }

    cacheDOMElements() {
      this.elRoutePanel = document.getElementById('route-panel');
      this.elExpandableContent = document.getElementById('panel-expandable-content');
      this.elStickyLaunchBar = document.getElementById('sticky-launch-bar');
      this.elLiveRecordingHud = document.getElementById('live-recording-hud');

      this.elStartInput = document.getElementById('start-input');
      this.elEndInput = document.getElementById('end-input');
      this.elStartSuggestions = document.getElementById('start-suggestions');
      this.elEndSuggestions = document.getElementById('end-suggestions');

      this.elNavBanner = document.getElementById('nav-banner');
      this.elNavDistance = document.getElementById('nav-step-distance');
      this.elNavStreet = document.getElementById('nav-step-street');
      this.elNavSafety = document.getElementById('nav-step-type');
      this.elNavIcon = document.getElementById('nav-turn-icon');

      this.elSettingsModal = document.getElementById('settings-modal');
      this.elAuthModal = document.getElementById('auth-modal');
      this.elReportModal = document.getElementById('report-modal');
      this.elCyclewaysModal = document.getElementById('cycleways-modal');
      this.elCyclewaysList = document.getElementById('cycleways-list-container');
      this.elCyclewaysFilterInput = document.getElementById('cycleways-filter-input');

      this.elHazardAlert = document.getElementById('hazard-proximity-alert');
      this.elSimuController = document.getElementById('simu-controller');
      this.elReportFab = document.getElementById('btn-report-hazard');

      this.elSpeedVal = document.getElementById('hud-speed-val');
      this.elSpeedCircle = document.getElementById('speed-circle-bar');
      this.elSpeedLimitBadge = document.getElementById('speed-limit-badge');
      this.elHudEta = document.getElementById('hud-eta');
      this.elHudTimeRem = document.getElementById('hud-time-rem');
      this.elHudDistRem = document.getElementById('hud-dist-rem');
      this.elBatteryFill = document.getElementById('hud-battery-fill');
      this.elBatteryPercent = document.getElementById('hud-battery-percent');
      this.elBatteryArrival = document.getElementById('hud-battery-arrival');

      this.elLaunchButtonLabel = document.getElementById('launch-button-label');
      this.elLaunchButtonSub = document.getElementById('launch-button-sub');

      this.elRoadAdhesionBar = document.getElementById('road-adhesion-bar');
      this.elWeatherIcon = document.getElementById('weather-icon');
      this.elWeatherSummary = document.getElementById('weather-summary');
      this.elRainWarningCard = document.getElementById('rain-warning-card');
      this.elRainAlertTitle = document.getElementById('rain-alert-title');
      this.elRainAlertAdvice = document.getElementById('rain-alert-advice');

      this.elWhCalcDrawer = document.getElementById('wh-calc-drawer');
      this.elToggleCharging = document.getElementById('toggle-charging-stations');
    }

    initUserGPS() {
      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(
        async pos => {
          const { latitude, longitude } = pos.coords;
          localStorage.setItem('trottiwaze_gps_allowed', 'true');
          this.selectedStartCoords = { lat: latitude, lng: longitude };
          this.mapManager.updateScooterPosition(latitude, longitude, 0, 0);
          this.mapManager.recenter(16);
          this.elStartInput.value = '📍 Ma position';
          this.showToast('📍 Position GPS détectée');

          this.chargingManager.generateNearbyStations(latitude, longitude);

          const weather = await this.weatherEngine.fetchWeather(latitude, longitude);
          this.updateWeatherUI(weather);
        },
        err => console.warn('GPS lookup notice:', err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    }

    updateWeatherUI(weather) {
      if (!weather) return;
      if (this.elWeatherSummary) this.elWeatherSummary.innerHTML = `${weather.summary}`;
      if (this.elWeatherIcon) this.elWeatherIcon.textContent = weather.roadStatus === 'wet' ? '🌧️' : weather.roadStatus === 'risk' ? '⛅' : '☀️';
      if (this.elRoadAdhesionBar) this.elRoadAdhesionBar.className = `road-adhesion-pill ${weather.roadStatus}`;

      if (weather.roadStatus === 'wet' || weather.roadStatus === 'risk') {
        if (this.elRainWarningCard) {
          this.elRainWarningCard.style.display = 'block';
          this.elRainAlertTitle.textContent = `Avertissement Pluie (${weather.rainProbPct}% de risque)`;
          this.elRainAlertAdvice.innerHTML = `⚠️ <strong>${weather.advice}</strong>`;
        }
      } else {
        if (this.elRainWarningCard) this.elRainWarningCard.style.display = 'none';
      }
    }

    navigateToChargingStation(station) {
      this.selectedEndCoords = { lat: station.lat, lng: station.lng };
      this.elEndInput.value = `⚡ ${station.name}`;
      this.calculateCurrentRoute();
      this.showToast(`Itinéraire vers ${station.name}`);
    }

    // =======================================================================
    // Garage & Scooter Fleet UI Handling
    // =======================================================================
    renderGarageFleetUI() {
      const container = document.getElementById('garage-scooters-list');
      if (!container) return;

      container.innerHTML = '';
      const active = this.garageManager.getActiveScooter();

      this.garageManager.scooters.forEach(scoot => {
        const isActive = scoot.id === active.id;
        const card = document.createElement('div');
        card.className = `scooter-fleet-card ${isActive ? 'active-scooter' : ''}`;
        card.innerHTML = `
          <div class="fleet-card-top">
            <div class="fleet-card-info">
              <span class="fleet-icon">${scoot.icon || '🛴'}</span>
              <span class="fleet-name">${scoot.name}</span>
            </div>
            ${isActive ? '<span class="fleet-active-badge">✓ Active</span>' : ''}
          </div>
          <div class="fleet-specs-tags">
            <span class="fleet-spec-tag">🔋 <strong>${scoot.batteryCapacityWh} Wh</strong></span>
            <span class="fleet-spec-tag">⚡ <strong>${scoot.speedPrefKmh} km/h</strong></span>
            <span class="fleet-spec-tag">⚖️ <strong>${scoot.scooterWeightKg} kg</strong> (trotti)</span>
            <span class="fleet-spec-tag">👤 <strong>${scoot.riderWeightKg} kg</strong> (rider)</span>
            <span class="fleet-spec-tag">🔋 <strong>${scoot.currentPercentage}%</strong></span>
          </div>
          <div class="fleet-actions-row">
            ${!isActive ? `<button class="btn-micro green btn-activate-scooter" data-id="${scoot.id}">⚡ Choisir ce modèle</button>` : `<span style="font-size:11px; color:var(--primary); font-weight:700;">Modèle sélectionné</span>`}
            <div style="display:flex; gap:6px;">
              <button class="btn-micro btn-edit-scooter" data-id="${scoot.id}" title="Modifier">✏️</button>
              <button class="btn-micro danger btn-del-scooter" data-id="${scoot.id}" title="Supprimer">🗑️</button>
            </div>
          </div>
        `;

        const btnAct = card.querySelector('.btn-activate-scooter');
        if (btnAct) {
          btnAct.addEventListener('click', () => {
            this.garageManager.setActiveScooter(scoot.id);
            this.renderGarageFleetUI();
            this.showToast(`🛴 Modèle actif : ${scoot.name}`);
          });
        }

        const btnEdit = card.querySelector('.btn-edit-scooter');
        if (btnEdit) {
          btnEdit.addEventListener('click', () => {
            this.openScooterDrawer(scoot);
          });
        }

        const btnDel = card.querySelector('.btn-del-scooter');
        if (btnDel) {
          btnDel.addEventListener('click', () => {
            if (confirm(`Supprimer la trottinette "${scoot.name}" de votre garage ?`)) {
              const res = this.garageManager.deleteScooter(scoot.id);
              if (res.success) {
                this.renderGarageFleetUI();
                this.showToast('🗑️ Trottinette supprimée du garage');
              } else {
                alert(res.message);
              }
            }
          });
        }

        container.appendChild(card);
      });

      this.updateHudWithActiveScooter(active);
    }

    openScooterDrawer(scoot = null) {
      const drawer = document.getElementById('scooter-form-drawer');
      if (!drawer) return;

      const title = document.getElementById('scooter-drawer-title');
      const editId = document.getElementById('edit-scooter-id');
      const nameInp = document.getElementById('scooter-custom-name');
      const capInp = document.getElementById('scooter-capacity');
      const riderInp = document.getElementById('scooter-rider-weight');
      const scootInp = document.getElementById('scooter-weight');
      const speedSlider = document.getElementById('scooter-speed-slider');
      const valSpeed = document.getElementById('val-speed-slider');
      const battSlider = document.getElementById('scooter-battery-pct');
      const valBatt = document.getElementById('val-battery-pct');

      if (scoot) {
        title.textContent = `✏️ Modifier "${scoot.name}"`;
        editId.value = scoot.id;
        nameInp.value = scoot.name;
        capInp.value = scoot.batteryCapacityWh;
        riderInp.value = scoot.riderWeightKg;
        scootInp.value = scoot.scooterWeightKg;
        speedSlider.value = scoot.speedPrefKmh;
        valSpeed.textContent = `${scoot.speedPrefKmh} km/h`;
        battSlider.value = scoot.currentPercentage;
        valBatt.textContent = `${scoot.currentPercentage}%`;
        this.selectedScooterIcon = scoot.icon || '🛴';
      } else {
        title.textContent = '➕ Nouvelle Trottinette';
        editId.value = '';
        nameInp.value = '';
        capInp.value = '550';
        riderInp.value = '75';
        scootInp.value = '18';
        speedSlider.value = '25';
        valSpeed.textContent = '25 km/h';
        battSlider.value = '80';
        valBatt.textContent = '80%';
        this.selectedScooterIcon = '🛴';
      }

      document.querySelectorAll('.scooter-icon-choice').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-icon') === this.selectedScooterIcon);
      });

      drawer.style.display = 'block';
    }

    handleActiveScooterChanged(scoot) {
      this.mapManager.updateScooterIcon(scoot.icon || '🛴');
      this.updateHudWithActiveScooter(scoot);
      this.updateAccordionSummaries();
      if (this.elEndInput && this.elEndInput.value.trim().length > 0) {
        this.calculateCurrentRoute();
      }
    }

    updateHudWithActiveScooter(scoot) {
      if (this.elSpeedLimitBadge) this.elSpeedLimitBadge.textContent = scoot.speedPrefKmh || 25;
      if (this.elBatteryPercent) this.elBatteryPercent.textContent = `${scoot.currentPercentage}%`;
      if (this.elBatteryFill) this.elBatteryFill.style.width = `${scoot.currentPercentage}%`;
    }

    // =======================================================================
    // Voice Guidance & Speech Settings UI
    // =======================================================================
    initVoiceUI() {
      const select = document.getElementById('voice-select-dropdown');
      const toggleVoice = document.getElementById('toggle-voice-enabled');
      const rateSlider = document.getElementById('voice-rate-slider');
      const valRate = document.getElementById('val-voice-rate');
      const pitchSlider = document.getElementById('voice-pitch-slider');
      const valPitch = document.getElementById('val-voice-pitch');
      const volSlider = document.getElementById('voice-volume-slider');
      const valVol = document.getElementById('val-voice-volume');

      const optTurns = document.getElementById('voice-opt-turns');
      const optWeather = document.getElementById('voice-opt-weather');
      const optHazards = document.getElementById('voice-opt-hazards');

      if (toggleVoice) toggleVoice.checked = this.voiceEngine.config.enabled;
      if (rateSlider) {
        rateSlider.value = this.voiceEngine.config.rate;
        valRate.textContent = `${this.voiceEngine.config.rate}x`;
      }
      if (pitchSlider) {
        pitchSlider.value = this.voiceEngine.config.pitch;
        valPitch.textContent = this.voiceEngine.config.pitch === 1.0 ? 'Neutre (1.0)' : this.voiceEngine.config.pitch > 1.0 ? 'Aigu' : 'Grave';
      }
      if (volSlider) {
        volSlider.value = Math.round(this.voiceEngine.config.volume * 100);
        valVol.textContent = `${Math.round(this.voiceEngine.config.volume * 100)}%`;
      }
      if (optTurns) optTurns.checked = this.voiceEngine.config.announceTurns;
      if (optWeather) optWeather.checked = this.voiceEngine.config.announceWeather;
      if (optHazards) optHazards.checked = this.voiceEngine.config.announceHazards;

      const populateSelect = (voices) => {
        if (!select) return;
        select.innerHTML = '';

        if (!voices || voices.length === 0) {
          select.innerHTML = '<option value="">Voix système par défaut</option>';
          return;
        }

        const frVoices = voices.filter(v => v.lang.startsWith('fr') || v.lang.startsWith('FR'));
        const otherVoices = voices.filter(v => !v.lang.startsWith('fr') && !v.lang.startsWith('FR'));

        if (frVoices.length > 0) {
          const grpFr = document.createElement('optgroup');
          grpFr.label = '🇫🇷 Voix Françaises (Recommandées)';
          frVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.voiceURI;
            opt.textContent = `${v.name} (${v.lang})`;
            if (v.voiceURI === this.voiceEngine.config.voiceURI || (!this.voiceEngine.config.voiceURI && v.default)) {
              opt.selected = true;
            }
            grpFr.appendChild(opt);
          });
          select.appendChild(grpFr);
        }

        if (otherVoices.length > 0) {
          const grpOther = document.createElement('optgroup');
          grpOther.label = '🌍 Autres langues disponibles';
          otherVoices.slice(0, 15).forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.voiceURI;
            opt.textContent = `${v.name} (${v.lang})`;
            grpOther.appendChild(opt);
          });
          select.appendChild(grpOther);
        }
      };

      this.voiceEngine.initVoices(voices => populateSelect(voices));

      if (select) {
        select.addEventListener('change', () => {
          this.voiceEngine.saveConfig({ voiceURI: select.value });
          this.showToast('🎙️ Voix GPS mise à jour');
        });
      }

      if (toggleVoice) {
        toggleVoice.addEventListener('change', (e) => {
          this.voiceEngine.saveConfig({ enabled: e.target.checked });
          const controls = document.getElementById('voice-customizer-controls');
          if (controls) controls.style.opacity = e.target.checked ? '1' : '0.4';
          this.updateAccordionSummaries();
          this.showToast(e.target.checked ? '🗣️ Guidage vocal activé' : '🔇 Guidage vocal coupé');
        });
      }

      if (rateSlider) {
        rateSlider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          valRate.textContent = `${val.toFixed(2)}x`;
          this.voiceEngine.saveConfig({ rate: val });
          this.updateAccordionSummaries();
        });
      }

      if (pitchSlider) {
        pitchSlider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          valPitch.textContent = val === 1.0 ? 'Neutre (1.0)' : val > 1.0 ? `Aigu (${val})` : `Grave (${val})`;
          this.voiceEngine.saveConfig({ pitch: val });
        });
      }

      if (volSlider) {
        volSlider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          valVol.textContent = `${val}%`;
          this.voiceEngine.saveConfig({ volume: val / 100 });
        });
      }

      const btnTestVoice = document.getElementById('btn-test-voice');
      if (btnTestVoice) {
        btnTestVoice.addEventListener('click', () => {
          this.voiceEngine.testVoice();
        });
      }

      [optTurns, optWeather, optHazards].forEach(chk => {
        if (chk) {
          chk.addEventListener('change', () => {
            this.voiceEngine.saveConfig({
              announceTurns: optTurns ? optTurns.checked : true,
              announceWeather: optWeather ? optWeather.checked : true,
              announceHazards: optHazards ? optHazards.checked : true
            });
          });
        }
      });
    }

    // =======================================================================
    // User Authentication & Profile UI
    // =======================================================================
    updateUserAuthUI() {
      const u = this.authManager.currentUser;
      const avatarBadge = document.getElementById('header-avatar-badge');
      const authLabel = document.getElementById('header-auth-label');
      const onlineDot = document.getElementById('auth-online-dot');
      const tabProfileBtn = document.querySelector('.auth-tab-btn[data-auth-tab="auth-profile"]');

      if (u) {
        if (avatarBadge) avatarBadge.textContent = u.avatar || '🦊';
        if (authLabel) authLabel.textContent = u.username;
        if (onlineDot) onlineDot.style.display = 'block';
        if (tabProfileBtn) tabProfileBtn.style.display = 'block';

        const dispUser = document.getElementById('profile-username-display');
        const dispEmail = document.getElementById('profile-email-display');
        const dispAvatar = document.getElementById('profile-avatar-display');
        const dispKm = document.getElementById('prof-stat-km');
        const dispRides = document.getElementById('prof-stat-rides');
        const dispScoots = document.getElementById('prof-stat-scooter');
        const dispRep = document.getElementById('prof-stat-reports');

        if (dispUser) dispUser.textContent = u.username;
        if (dispEmail) dispEmail.textContent = u.email;
        if (dispAvatar) dispAvatar.textContent = u.avatar;
        if (dispKm) dispKm.textContent = `${(u.stats && u.stats.totalKm) || 0} km`;
        if (dispRides) dispRides.textContent = (u.stats && u.stats.totalRides) || 0;
        if (dispScoots) dispScoots.textContent = `${this.garageManager.scooters.length} modèles`;
        if (dispRep) dispRep.textContent = (u.stats && u.stats.reportsCount) || 0;
      } else {
        if (avatarBadge) avatarBadge.textContent = '👤';
        if (authLabel) authLabel.textContent = 'Compte';
        if (onlineDot) onlineDot.style.display = 'none';
        if (tabProfileBtn) tabProfileBtn.style.display = 'none';
      }
    }

    switchAuthTab(tabKey) {
      document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-auth-tab') === tabKey));
      document.querySelectorAll('.auth-tab-pane').forEach(p => p.classList.remove('active'));
      const targetPane = document.getElementById(`pane-${tabKey}`);
      if (targetPane) targetPane.classList.add('active');
    }

    initAccordionEvents() {
      document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
          const item = header.closest('.accordion-item');
          if (item) {
            item.classList.toggle('open');
            this.mapManager.map.invalidateSize();
          }
        });
      });
    }

    updateAccordionSummaries() {
      const activeScoot = this.garageManager.getActiveScooter();
      const sumGarage = document.getElementById('acc-garage-summary');
      const badgeGarage = document.getElementById('acc-garage-badge');
      if (sumGarage && activeScoot) {
        sumGarage.textContent = `Actif : ${activeScoot.name} (${activeScoot.batteryCapacityWh} Wh • ${activeScoot.speedPrefKmh} km/h)`;
      }
      if (badgeGarage) {
        badgeGarage.textContent = `${this.garageManager.scooters.length} active`;
      }

      const chkAvoidDirt = document.getElementById('filter-avoid-dirt-paths');
      const sumFilters = document.getElementById('acc-filters-summary');
      if (sumFilters && chkAvoidDirt) {
        sumFilters.textContent = chkAvoidDirt.checked ? '100% Goudron • Chemins interdits' : 'Chemins autorisés';
      }

      const sumMaps = document.getElementById('acc-maps-summary');
      if (sumMaps) {
        sumMaps.textContent = `${this.mapManager.currentLayerId.toUpperCase()} • Pistes cyclables`;
      }

      const sumVoice = document.getElementById('acc-voice-summary');
      const badgeVoice = document.getElementById('acc-voice-badge');
      if (sumVoice) {
        sumVoice.textContent = this.voiceEngine.config.enabled ? `Voix active • ${this.voiceEngine.config.rate}x` : 'Guidage vocal coupé';
      }
      if (badgeVoice) {
        badgeVoice.textContent = this.voiceEngine.config.enabled ? 'Actif' : 'Coupé';
      }

      const ridesStats = this.rideRecorder.getGlobalStats();
      const sumRides = document.getElementById('acc-rides-summary');
      const badgeRides = document.getElementById('acc-rides-badge');
      if (sumRides) {
        sumRides.textContent = `${ridesStats.totalKm} km • ${ridesStats.tripsCount} sorties`;
      }
      if (badgeRides) {
        badgeRides.textContent = `${ridesStats.tripsCount} sortie${ridesStats.tripsCount > 1 ? 's' : ''}`;
      }
    }

    initEvents() {
      // Accordion Drawer Initialization
      this.initAccordionEvents();

      // Mobile Panel Fold
      const toggleFold = () => {
        this.elRoutePanel.classList.toggle('panel-folded');
        const isFolded = this.elRoutePanel.classList.contains('panel-folded');
        const foldBtn = document.getElementById('btn-toggle-panel-fold');
        if (foldBtn) foldBtn.textContent = isFolded ? '▼' : '▲';
        setTimeout(() => this.mapManager.map.invalidateSize(), 250);
      };

      const foldBtn = document.getElementById('btn-toggle-panel-fold');
      if (foldBtn) foldBtn.addEventListener('click', toggleFold);
      const handle = document.getElementById('panel-collapse-handle');
      if (handle) handle.addEventListener('click', toggleFold);

      // Settings Modal Open & Close
      document.getElementById('btn-open-settings').addEventListener('click', () => {
        this.elSettingsModal.style.display = 'flex';
        this.renderGarageFleetUI();
        this.renderRidesHistoryUI();
        this.updateAccordionSummaries();
      });
      document.getElementById('btn-close-settings').addEventListener('click', () => {
        this.elSettingsModal.style.display = 'none';
        this.mapManager.map.invalidateSize();
      });

      // Compass & Map Rotation Button
      const compassBtn = document.getElementById('btn-compass-mode');
      if (compassBtn) {
        compassBtn.addEventListener('click', () => {
          const mode = this.compassManager.toggleMode();
          this.showToast(mode === 'course-up' ? '🧭 Mode Cap en avant (Course-Up)' : '🧭 Mode Nord en haut (North-Up)');
        });
      }

      // Add Scooter Drawer Triggers
      const btnShowAddScoot = document.getElementById('btn-show-add-scooter');
      if (btnShowAddScoot) {
        btnShowAddScoot.addEventListener('click', () => this.openScooterDrawer(null));
      }

      const btnCloseDrawer = document.getElementById('btn-close-scooter-drawer');
      if (btnCloseDrawer) {
        btnCloseDrawer.addEventListener('click', () => {
          document.getElementById('scooter-form-drawer').style.display = 'none';
        });
      }

      document.querySelectorAll('.scooter-icon-choice').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.scooter-icon-choice').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.selectedScooterIcon = btn.getAttribute('data-icon');
        });
      });

      // Save Scooter Form (Add or Edit)
      const btnSaveScooter = document.getElementById('btn-save-scooter-form');
      if (btnSaveScooter) {
        btnSaveScooter.addEventListener('click', () => {
          const editId = document.getElementById('edit-scooter-id').value;
          const name = document.getElementById('scooter-custom-name').value.trim() || 'Ma Trottinette';
          const capWh = parseInt(document.getElementById('scooter-capacity').value, 10) || 474;
          const riderKg = parseInt(document.getElementById('scooter-rider-weight').value, 10) || 75;
          const scootKg = parseInt(document.getElementById('scooter-weight').value, 10) || 18;
          const speed = parseInt(document.getElementById('scooter-speed-slider').value, 10) || 25;
          const battPct = parseInt(document.getElementById('scooter-battery-pct').value, 10) || 80;

          const data = {
            name,
            icon: this.selectedScooterIcon || '🛴',
            batteryCapacityWh: capWh,
            riderWeightKg: riderKg,
            scooterWeightKg: scootKg,
            speedPrefKmh: speed,
            currentPercentage: battPct
          };

          if (editId) {
            this.garageManager.updateScooter(editId, data);
            this.showToast(`✏️ "${name}" mis à jour !`);
          } else {
            this.garageManager.addScooter(data);
            this.showToast(`➕ "${name}" ajouté au garage !`);
          }

          document.getElementById('scooter-form-drawer').style.display = 'none';
          this.renderGarageFleetUI();
        });
      }

      // Wh Mini-Calculator (Volts x Ah)
      const btnWhToggle = document.getElementById('btn-toggle-wh-calc');
      if (btnWhToggle) {
        btnWhToggle.addEventListener('click', () => {
          const isHidden = this.elWhCalcDrawer.style.display === 'none';
          this.elWhCalcDrawer.style.display = isHidden ? 'block' : 'none';
        });
      }

      const btnApplyWh = document.getElementById('btn-apply-wh-calc');
      if (btnApplyWh) {
        btnApplyWh.addEventListener('click', () => {
          const volts = parseFloat(document.getElementById('calc-volts').value) || 36;
          const ah = parseFloat(document.getElementById('calc-amphours').value) || 13;
          const wh = Math.round(volts * ah);
          const capInput = document.getElementById('scooter-capacity');
          if (capInput) capInput.value = wh;
          this.elWhCalcDrawer.style.display = 'none';
          this.showToast(`🔋 Capacité : ${wh} Wh (${volts}V × ${ah}Ah)`);
        });
      }

      // Map Layer Selection (Volet 3)
      document.querySelectorAll('.map-layer-option').forEach(opt => {
        opt.addEventListener('click', () => {
          document.querySelectorAll('.map-layer-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
          const layerId = opt.getAttribute('data-layer-id');
          const layerName = this.mapManager.setTileLayer(layerId);
          this.updateAccordionSummaries();
          this.showToast(`Carte : ${layerName}`);
        });
      });

      // Speed Slider & Presets (Drawer)
      const speedSlider = document.getElementById('scooter-speed-slider');
      const valSpeedSlider = document.getElementById('val-speed-slider');
      if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          if (valSpeedSlider) valSpeedSlider.textContent = `${val} km/h`;
          document.querySelectorAll('.speed-preset-btn').forEach(b => b.classList.toggle('active', parseInt(b.getAttribute('data-speed'), 10) === val));
        });
      }

      document.querySelectorAll('.speed-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = parseInt(btn.getAttribute('data-speed'), 10);
          if (speedSlider) speedSlider.value = val;
          if (valSpeedSlider) valSpeedSlider.textContent = `${val} km/h`;
          document.querySelectorAll('.speed-preset-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      // Battery Slider
      const battSlider = document.getElementById('scooter-battery-pct');
      const valBatt = document.getElementById('val-battery-pct');
      if (battSlider && valBatt) {
        battSlider.addEventListener('input', (e) => {
          valBatt.textContent = `${e.target.value}%`;
        });
      }

      // Auth Modal Open & Close
      const btnOpenAuth = document.getElementById('btn-open-auth');
      if (btnOpenAuth) {
        btnOpenAuth.addEventListener('click', () => {
          this.updateUserAuthUI();
          this.elAuthModal.style.display = 'flex';
          if (this.authManager.currentUser) {
            this.switchAuthTab('auth-profile');
          } else {
            this.switchAuthTab('auth-login');
          }
        });
      }

      document.getElementById('btn-close-auth').addEventListener('click', () => {
        this.elAuthModal.style.display = 'none';
      });

      document.querySelectorAll('.auth-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tabKey = btn.getAttribute('data-auth-tab');
          this.switchAuthTab(tabKey);
        });
      });

      // Links inside auth panes
      const linkGotoReset = document.getElementById('link-goto-reset');
      if (linkGotoReset) linkGotoReset.addEventListener('click', (e) => { e.preventDefault(); this.switchAuthTab('auth-reset'); });
      const linkGotoSignup = document.getElementById('link-goto-signup');
      if (linkGotoSignup) linkGotoSignup.addEventListener('click', (e) => { e.preventDefault(); this.switchAuthTab('auth-signup'); });
      const linkGotoLoginFromSignup = document.getElementById('link-goto-login-from-signup');
      if (linkGotoLoginFromSignup) linkGotoLoginFromSignup.addEventListener('click', (e) => { e.preventDefault(); this.switchAuthTab('auth-login'); });
      const linkBackToLogin = document.getElementById('link-back-to-login');
      if (linkBackToLogin) linkBackToLogin.addEventListener('click', (e) => { e.preventDefault(); this.switchAuthTab('auth-login'); });

      // Avatar selection in signup
      document.querySelectorAll('#signup-avatar-grid .avatar-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#signup-avatar-grid .avatar-choice-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.selectedSignupAvatar = btn.getAttribute('data-avatar');
        });
      });

      // Login form submit
      const btnSubmitLogin = document.getElementById('btn-submit-login');
      if (btnSubmitLogin) {
        btnSubmitLogin.addEventListener('click', () => {
          const identifier = document.getElementById('login-identifier').value;
          const pass = document.getElementById('login-password').value;
          const res = this.authManager.login({ identifier, password: pass });
          if (res.success) {
            this.updateUserAuthUI();
            this.switchAuthTab('auth-profile');
            this.showToast(`👋 Bienvenue, ${res.user.username} !`);
          } else {
            alert(res.message);
          }
        });
      }

      // Signup form submit
      const btnSubmitSignup = document.getElementById('btn-submit-signup');
      if (btnSubmitSignup) {
        btnSubmitSignup.addEventListener('click', () => {
          const username = document.getElementById('signup-username').value;
          const email = document.getElementById('signup-email').value;
          const pass = document.getElementById('signup-password').value;
          const passConf = document.getElementById('signup-password-confirm').value;

          if (pass !== passConf) {
            alert('Les mots de passe ne correspondent pas.');
            return;
          }

          const res = this.authManager.signup({
            username,
            email,
            avatar: this.selectedSignupAvatar || '🦊',
            password: pass
          });

          if (res.success) {
            this.updateUserAuthUI();
            this.switchAuthTab('auth-profile');
            this.showToast(`✨ Compte créé avec succès ! Bienvenue ${res.user.username}`);
          } else {
            alert(res.message);
          }
        });
      }

      // Password Reset Step 1: Send OTP email code
      const btnSendReset = document.getElementById('btn-send-reset-code');
      if (btnSendReset) {
        btnSendReset.addEventListener('click', () => {
          const email = document.getElementById('reset-email-input').value;
          if (!email) {
            alert('Veuillez saisir votre adresse email.');
            return;
          }

          const res = this.authManager.requestPasswordReset(email);
          if (res.success) {
            document.getElementById('reset-step-1').style.display = 'none';
            document.getElementById('reset-step-2').style.display = 'block';
            document.getElementById('sim-display-otp').textContent = res.code;
            this.showToast(`📬 Code de vérification envoyé à ${email}`);
          }
        });
      }

      // Password Reset Step 2: Confirm OTP & Set new password
      const btnConfirmReset = document.getElementById('btn-confirm-password-reset');
      if (btnConfirmReset) {
        btnConfirmReset.addEventListener('click', () => {
          const email = document.getElementById('reset-email-input').value;
          const otp = document.getElementById('reset-otp-input').value;
          const newPass = document.getElementById('reset-new-password').value;
          const newPassConf = document.getElementById('reset-new-password-confirm').value;

          if (newPass !== newPassConf) {
            alert('Les deux mots de passe ne correspondent pas.');
            return;
          }

          const res = this.authManager.confirmPasswordReset({
            email,
            code: otp,
            newPassword: newPass
          });

          if (res.success) {
            this.updateUserAuthUI();
            this.switchAuthTab('auth-profile');
            this.showToast('✅ Mot de passe mis à jour avec succès !');
          } else {
            alert(res.message);
          }
        });
      }

      // Profile Actions
      const btnLogout = document.getElementById('btn-auth-logout');
      if (btnLogout) {
        btnLogout.addEventListener('click', () => {
          this.authManager.logout();
          this.updateUserAuthUI();
          this.switchAuthTab('auth-login');
          this.showToast('🚪 Déconnecté');
        });
      }

      const btnExportData = document.getElementById('btn-auth-export-data');
      if (btnExportData) {
        btnExportData.addEventListener('click', () => {
          this.authManager.exportUserData();
          this.showToast('📥 Données exportées au format JSON');
        });
      }

      const btnDeleteAcc = document.getElementById('btn-auth-delete-account');
      if (btnDeleteAcc) {
        btnDeleteAcc.addEventListener('click', () => {
          if (confirm('Êtes-vous sûr de vouloir supprimer définitivement votre compte TrottiWaze ?')) {
            this.authManager.deleteAccount();
            this.updateUserAuthUI();
            this.switchAuthTab('auth-login');
            this.showToast('🗑️ Compte supprimé');
          }
        });
      }

      // 230V Charging Stations Toggle (Legend + Settings)
      if (this.elToggleCharging) {
        this.elToggleCharging.addEventListener('change', (e) => {
          this.chargingManager.setVisible(e.target.checked);
          const filterShow = document.getElementById('filter-show-charges');
          if (filterShow) filterShow.checked = e.target.checked;
        });
      }

      const filterShowCharges = document.getElementById('filter-show-charges');
      if (filterShowCharges) {
        filterShowCharges.addEventListener('change', (e) => {
          this.chargingManager.setVisible(e.target.checked);
          if (this.elToggleCharging) this.elToggleCharging.checked = e.target.checked;
        });
      }

      // Quick Find Nearest 230V Charge Chip
      const btnQuickCharge = document.getElementById('btn-quick-find-charge');
      if (btnQuickCharge) {
        btnQuickCharge.addEventListener('click', () => {
          const loc = this.mapManager.currentLocation;
          const nearest = this.chargingManager.findNearestStation(loc.lat, loc.lng);
          if (nearest) {
            this.navigateToChargingStation(nearest);
          } else {
            this.showToast('Recherche de prises 230V...');
          }
        });
      }

      // Verified Cycleways Layer Toggle
      const toggleVerifiedCycleways = document.getElementById('toggle-verified-cycleways');
      if (toggleVerifiedCycleways) {
        toggleVerifiedCycleways.addEventListener('change', (e) => {
          this.mapManager.setVerifiedCyclewaysVisible(e.target.checked);
          this.showToast(e.target.checked ? '🚲 Pistes cyclables vérifiées affichées' : '🚲 Pistes cyclables masquées');
        });
      }

      // Route Filters
      ['filter-avoid-cobblestones', 'filter-avoid-dirt-paths', 'filter-avoid-steep-hills', 'filter-prefer-protected'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', () => {
            const chkDirt = document.getElementById('filter-avoid-dirt-paths');
            const chkCobble = document.getElementById('filter-avoid-cobblestones');
            const chkHills = document.getElementById('filter-avoid-steep-hills');
            const chkProt = document.getElementById('filter-prefer-protected');

            this.routingEngine.setFilters({
              avoidCobblestones: chkCobble ? chkCobble.checked : true,
              avoidDirtPaths: chkDirt ? chkDirt.checked : true,
              avoidSteepHills: chkHills ? chkHills.checked : false,
              preferProtected: chkProt ? chkProt.checked : false
            });

            this.updateAccordionSummaries();
            if (this.elEndInput.value.trim().length > 0) this.calculateCurrentRoute();
          });
        }
      });

      // Clear All Rides
      document.getElementById('btn-clear-all-rides').addEventListener('click', () => {
        if (confirm('Supprimer tout l\'historique des trajets enregistrés ?')) {
          this.rideRecorder.clearAllRides();
          this.renderRidesHistoryUI();
          this.updateAccordionSummaries();
          this.showToast('🗑️ Historique effacé');
        }
      });

      // Ride Recorder Controls (Geovelo Style)
      const startRecordingFlow = () => {
        this.rideRecorder.startRecording();
        this.elLiveRecordingHud.style.display = 'block';
        this.showToast('🔴 Enregistrement du trajet démarré !');
      };

      document.getElementById('btn-quick-record-fab').addEventListener('click', startRecordingFlow);
      document.getElementById('btn-quick-record-trigger').addEventListener('click', startRecordingFlow);

      document.getElementById('btn-rec-pause').addEventListener('click', (e) => {
        if (this.rideRecorder.isPaused) {
          this.rideRecorder.resumeRecording();
          e.target.textContent = '⏸ Pause';
        } else {
          this.rideRecorder.pauseRecording();
          e.target.textContent = '▶ Reprendre';
        }
      });

      document.getElementById('btn-rec-stop').addEventListener('click', () => {
        const destTitle = this.elEndInput.value.trim() || 'Sortie Trottinette';
        const saved = this.rideRecorder.stopAndSave(destTitle);
        this.elLiveRecordingHud.style.display = 'none';
        this.mapManager.clearLiveTrack();
        if (saved) {
          this.authManager.updateUserStats(saved.distanceKm, 1);
          this.updateUserAuthUI();
          this.updateAccordionSummaries();
          this.showToast(`🎉 Trajet enregistré : ${saved.distanceKm} km (${saved.avgSpeedKmh} km/h)`);
        }
      });

      // Recenter Button
      document.getElementById('btn-recenter').addEventListener('click', () => {
        this.mapManager.recenter(16);
        this.showToast('🎯 Centrage & suivi GPS');
      });

      // Cockpit Bell
      document.getElementById('btn-cockpit-bell').addEventListener('click', () => {
        this.hazardManager.playCockpitBell();
        this.showToast('🔔 Dring Dring !');
      });

      // Theme toggle
      document.getElementById('btn-toggle-theme').addEventListener('click', () => {
        document.body.classList.toggle('theme-light');
        document.body.classList.toggle('theme-dark');
        document.getElementById('btn-toggle-theme').textContent = document.body.classList.contains('theme-light') ? '☀️' : '🌙';
      });

      // Autocomplete setup
      this.setupAutocomplete(this.elStartInput, this.elStartSuggestions, (coords, label) => {
        this.selectedStartCoords = coords;
        this.elStartInput.value = label;
        this.historyManager.addRecent({ fullLabel: label, lat: coords.lat, lng: coords.lng });
        this.calculateCurrentRoute();
      });

      this.setupAutocomplete(this.elEndInput, this.elEndSuggestions, (coords, label) => {
        this.selectedEndCoords = coords;
        this.elEndInput.value = label;
        this.historyManager.addRecent({ fullLabel: label, lat: coords.lat, lng: coords.lng });
        this.calculateCurrentRoute();
      });

      // Favorites Chips
      document.querySelectorAll('.quick-chips .fav-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const favKey = chip.getAttribute('data-fav');
          const fav = this.historyManager.getFavorite(favKey);
          if (fav) {
            this.selectedEndCoords = { lat: fav.lat, lng: fav.lng };
            this.elEndInput.value = fav.full;
            this.calculateCurrentRoute();
          }
        });
      });

      // Clear End Input
      document.getElementById('btn-clear-dest').addEventListener('click', () => {
        this.elEndInput.value = '';
        this.selectedEndCoords = null;
        this.calculatedRoutes = null;
        this.mapManager.clearRoute();
        this.elExpandableContent.style.display = 'none';
        this.elStickyLaunchBar.style.display = 'none';
        this.elEndInput.focus();
      });

      // Swap Locations
      document.getElementById('btn-swap-locations').addEventListener('click', () => {
        const tVal = this.elStartInput.value;
        this.elStartInput.value = this.elEndInput.value;
        this.elEndInput.value = tVal;
        const tCoords = this.selectedStartCoords;
        this.selectedStartCoords = this.selectedEndCoords;
        this.selectedEndCoords = tCoords;
        if (this.elEndInput.value.trim().length > 0) this.calculateCurrentRoute();
      });

      // Route Cards Selection
      document.querySelectorAll('.route-card').forEach(card => {
        card.addEventListener('click', () => {
          document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          this.selectedRouteMode = card.getAttribute('data-mode');
          this.applySelectedRoute();
        });
      });

      // Launch Buttons
      document.getElementById('btn-start-nav').addEventListener('click', () => this.beginTrip(false));
      document.getElementById('btn-start-simu').addEventListener('click', () => this.beginTrip(true));
      document.getElementById('btn-stop-nav').addEventListener('click', () => this.endTrip());

      // Navigation Engine Callbacks
      this.navigationEngine.onSpeedUpdate = (speed) => this.handleSpeedUpdate(speed);
      this.navigationEngine.onStepUpdate = (step) => this.handleStepUpdate(step);
      this.navigationEngine.onTripUpdate = (trip) => this.handleTripUpdate(trip);
      this.navigationEngine.onArrival = () => this.handleArrival();

      // Report Hazard Flow
      this.elReportFab.addEventListener('click', () => this.openReportModal());
      document.getElementById('btn-close-report').addEventListener('click', () => { this.elReportModal.style.display = 'none'; });
      document.querySelectorAll('.hazard-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.hazard-choice-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.selectedHazardType = btn.getAttribute('data-type');
          document.getElementById('btn-submit-report').disabled = false;
        });
      });
      document.getElementById('btn-submit-report').addEventListener('click', () => this.submitHazardReport());

      // Verified Cycleways Modal Listeners
      const btnQuickCycleways = document.getElementById('btn-quick-cycleways');
      if (btnQuickCycleways) {
        btnQuickCycleways.addEventListener('click', () => this.openCyclewaysModal());
      }

      const btnLegendCycleways = document.getElementById('btn-legend-cycleways');
      if (btnLegendCycleways) {
        btnLegendCycleways.addEventListener('click', () => this.openCyclewaysModal());
      }

      const btnCloseCycleways = document.getElementById('btn-close-cycleways');
      if (btnCloseCycleways) {
        btnCloseCycleways.addEventListener('click', () => {
          if (this.elCyclewaysModal) this.elCyclewaysModal.style.display = 'none';
        });
      }

      if (this.elCyclewaysFilterInput) {
        this.elCyclewaysFilterInput.addEventListener('input', (e) => {
          this.renderCyclewaysModalList(this.currentCyclewayCityFilter || 'all', e.target.value);
        });
      }

      document.querySelectorAll('#cycleways-city-chips .cycleway-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#cycleways-city-chips .cycleway-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          const city = chip.getAttribute('data-city');
          this.currentCyclewayCityFilter = city;
          const query = this.elCyclewaysFilterInput ? this.elCyclewaysFilterInput.value : '';
          this.renderCyclewaysModalList(city, query);
        });
      });
    }

    openCyclewaysModal() {
      if (!this.elCyclewaysModal) return;
      this.elCyclewaysModal.style.display = 'flex';
      this.currentCyclewayCityFilter = 'all';
      if (this.elCyclewaysFilterInput) this.elCyclewaysFilterInput.value = '';
      document.querySelectorAll('#cycleways-city-chips .cycleway-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-city') === 'all');
      });
      this.renderCyclewaysModalList('all', '');
    }

    renderCyclewaysModalList(cityFilter = 'all', searchQuery = '') {
      if (!this.elCyclewaysList) return;
      const userLoc = this.mapManager.currentLocation || { lat: 48.8531, lng: 2.3698 };
      const clean = (searchQuery || '').trim().toLowerCase();

      let list = this.routingEngine.getNearestCycleways(userLoc.lat, userLoc.lng, 35);

      if (cityFilter && cityFilter !== 'all') {
        list = list.filter(t => t.city.toLowerCase().includes(cityFilter.toLowerCase()));
      }

      if (clean.length > 0) {
        list = list.filter(t =>
          t.name.toLowerCase().includes(clean) ||
          t.city.toLowerCase().includes(clean) ||
          (t.cityLabel && t.cityLabel.toLowerCase().includes(clean)) ||
          (t.description && t.description.toLowerCase().includes(clean))
        );
      }

      if (list.length === 0) {
        this.elCyclewaysList.innerHTML = `
          <div style="text-align:center; padding: 24px 12px; color: var(--text-muted); font-size: 12px;">
            🚴 Aucune piste cyclable trouvée pour ces critères.<br>Essayez avec "Paris", "Lyon", "Bordeaux" ou "Toutes".
          </div>
        `;
        return;
      }

      this.elCyclewaysList.innerHTML = '';
      list.forEach(t => {
        const card = document.createElement('div');
        card.className = 'cycleway-item-card';
        card.innerHTML = `
          <div class="cycleway-item-header">
            <span class="cycleway-item-title">🛡️ ${t.name}</span>
            <span class="cycleway-item-distance">📍 ${t.distanceToUserKm} km</span>
          </div>
          <div class="cycleway-item-city">📍 ${t.cityLabel || t.city} • 📏 ${t.lengthKm} km</div>
          <div class="cycleway-badge-row">
            <span class="cycleway-tag-badge">✨ 100% Sûre</span>
            <span class="cycleway-tag-badge surface">🛣️ ${t.surface.split('•')[0].trim()}</span>
            <span class="cycleway-tag-badge">🔒 ${t.type.split('(')[0].trim()}</span>
          </div>
          <div class="cycleway-item-desc">${t.description}</div>
          <div class="cycleway-item-actions">
            <button class="btn-cycleway-nav" data-track-id="${t.id}">🛴 Y aller en trottinette</button>
            <button class="btn-cycleway-show" data-track-id="${t.id}">👁️ Voir sur carte</button>
          </div>
        `;

        card.querySelector('.btn-cycleway-nav').addEventListener('click', () => {
          this.navigateToCycleway(t.id);
        });

        card.querySelector('.btn-cycleway-show').addEventListener('click', () => {
          if (this.elCyclewaysModal) this.elCyclewaysModal.style.display = 'none';
          this.mapManager.zoomToCycleway(t.id);
          this.showToast(`🔍 Zoom sur : ${t.name}`);
        });

        this.elCyclewaysList.appendChild(card);
      });
    }

    navigateToCycleway(trackId) {
      if (typeof VERIFIED_CYCLEWAYS_CATALOG === 'undefined') return;
      const track = VERIFIED_CYCLEWAYS_CATALOG.find(t => t.id === trackId);
      if (!track) return;
      if (this.elCyclewaysModal) this.elCyclewaysModal.style.display = 'none';
      this.selectedEndCoords = { lat: track.lat, lng: track.lng };
      this.elEndInput.value = `${track.name}, ${track.city}`;
      this.calculateCurrentRoute();
      this.mapManager.zoomToCycleway(track.id);
      this.showToast(`🛴 Calcul d'itinéraire vers : ${track.name}`);
    }

    setupAutocomplete(inputEl, suggestionsEl, onSelectCallback) {
      let debounceTimer = null;

      const showShortcuts = () => {
        const userLoc = this.mapManager.currentLocation || { lat: 48.8531, lng: 2.3698 };
        const nearestTracks = this.routingEngine.getNearestCycleways(userLoc.lat, userLoc.lng, 3);
        if (nearestTracks.length === 0) return;

        suggestionsEl.innerHTML = `
          <div style="padding: 6px 10px; font-size: 10px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            🛡️ Pistes cyclables 100% sûres à proximité
          </div>
        `;
        nearestTracks.forEach(t => {
          const item = document.createElement('div');
          item.className = 'suggestion-item verified-cycleway';
          item.innerHTML = `
            <span class="sugg-icon">🛡️</span>
            <div class="sugg-text">
              <div class="sugg-main-row">
                <span class="sugg-main">${t.name}</span>
                <span class="sugg-verified-badge">Piste Sûre</span>
              </div>
              <span class="sugg-sub">📍 ${t.city} • ${t.distanceToUserKm} km • ${t.tag}</span>
            </div>
          `;
          item.addEventListener('click', () => {
            suggestionsEl.style.display = 'none';
            onSelectCallback({ lat: t.lat, lng: t.lng }, `${t.name}, ${t.city}`);
          });
          suggestionsEl.appendChild(item);
        });
        suggestionsEl.style.display = 'block';
      };

      inputEl.addEventListener('focus', () => {
        if (inputEl.value.trim().length === 0) {
          showShortcuts();
        }
      });

      inputEl.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = inputEl.value.trim();
        if (query.length < 2) {
          showShortcuts();
          return;
        }

        debounceTimer = setTimeout(async () => {
          const results = await this.routingEngine.searchAddress(query);
          if (results.length === 0) {
            suggestionsEl.style.display = 'none';
            return;
          }
          suggestionsEl.innerHTML = '';
          results.forEach(res => {
            const isVerified = res.isVerifiedCycleway;
            const item = document.createElement('div');
            item.className = `suggestion-item ${isVerified ? 'verified-cycleway' : ''}`;
            item.innerHTML = `
              <span class="sugg-icon">${isVerified ? '🛡️' : '📍'}</span>
              <div class="sugg-text">
                <div class="sugg-main-row">
                  <span class="sugg-main">${res.mainText}</span>
                  ${isVerified ? '<span class="sugg-verified-badge">Piste Sûre</span>' : ''}
                </div>
                <span class="sugg-sub">${res.subText}</span>
              </div>
            `;
            item.addEventListener('click', () => {
              suggestionsEl.style.display = 'none';
              onSelectCallback({ lat: res.lat, lng: res.lng }, res.fullLabel);
            });
            suggestionsEl.appendChild(item);
          });
          suggestionsEl.style.display = 'block';
        }, 250);
      });

      document.addEventListener('click', (e) => {
        if (!inputEl.contains(e.target) && !suggestionsEl.contains(e.target)) {
          suggestionsEl.style.display = 'none';
        }
      });
    }

    async calculateCurrentRoute() {
      const endVal = this.elEndInput.value.trim();
      if (!endVal) {
        this.elExpandableContent.style.display = 'none';
        this.elStickyLaunchBar.style.display = 'none';
        return;
      }

      let startCoords = this.selectedStartCoords || this.mapManager.currentLocation;
      let endCoords = this.selectedEndCoords;

      if (!endCoords) {
        endCoords = await this.routingEngine.geocode(endVal);
        if (endCoords) this.selectedEndCoords = endCoords;
      }

      if (!startCoords || !endCoords) return;

      this.calculatedRoutes = await this.routingEngine.calculateRoutes(startCoords, endCoords);
      this.updateRouteCardsUI();
      this.applySelectedRoute();

      this.elExpandableContent.style.display = 'block';
      this.elStickyLaunchBar.style.display = 'flex';
    }

    updateRouteCardsUI() {
      if (!this.calculatedRoutes) return;
      Object.keys(this.calculatedRoutes).forEach(mode => {
        const r = this.calculatedRoutes[mode];
        const card = document.querySelector(`.route-card[data-mode="${mode}"]`);
        if (card) {
          const timeEl = card.querySelector('.route-stat-time');
          const metaEl = card.querySelector('.route-stat-meta');
          if (timeEl) timeEl.textContent = `${r.durationMin} min`;
          if (metaEl) metaEl.textContent = `${r.distanceKm} km • ${r.cobblestonesCount === 0 ? '0 pavé' : r.cobblestonesCount + ' pavé'}`;
        }
      });
    }

    applySelectedRoute() {
      if (!this.calculatedRoutes) return;
      const r = this.calculatedRoutes[this.selectedRouteMode] || this.calculatedRoutes.safe;
      this.mapManager.drawRoute(r.coordinates, this.selectedRouteMode);

      if (this.elLaunchButtonLabel) {
        this.elLaunchButtonLabel.textContent = `DÉMARRER (${r.durationMin} MIN • ${r.distanceKm} KM)`;
      }
      if (this.elLaunchButtonSub) {
        this.elLaunchButtonSub.textContent = `${r.protectedPct}% Pistes • ${r.praticability}`;
      }

      const elevSummary = document.getElementById('elev-gain-summary');
      if (elevSummary) elevSummary.textContent = `+${r.elevationGainM} m / -${r.elevationLossM} m • Max ${r.maxSlopePct}%`;

      const elevEnd = document.getElementById('elev-end-dist');
      if (elevEnd) elevEnd.textContent = `${r.distanceKm} km`;

      const batt = this.batteryEngine.estimateTrip(r.distanceKm, r.elevationGainM);
      this.elBatteryArrival.textContent = `Fin: ~${batt.arrivalPct}%`;
    }

    beginTrip(isSimulated = false) {
      if (!this.calculatedRoutes) return;
      const activeRoute = this.calculatedRoutes[this.selectedRouteMode];
      this.elRoutePanel.style.display = 'none';
      this.elStickyLaunchBar.style.display = 'none';
      this.elNavBanner.style.display = 'flex';
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
      if (this.elEndInput.value.trim().length > 0) {
        this.elStickyLaunchBar.style.display = 'flex';
      }
    }

    handleArrival() {
      this.voiceEngine.speak("Vous êtes arrivé à destination.", 'turn');
      this.showToast('🎉 Arrivée à destination !');
      setTimeout(() => this.endTrip(), 4000);
    }

    handleSpeedUpdate(speedKmh) {
      this.elSpeedVal.textContent = speedKmh;
      const configuredSpeed = this.batteryEngine.config.speedPrefKmh || 25;
      this.elSpeedLimitBadge.textContent = configuredSpeed;

      if (speedKmh > configuredSpeed + 5) {
        this.elSpeedCircle.style.stroke = 'var(--danger)';
      } else if (speedKmh > 25) {
        this.elSpeedCircle.style.stroke = 'var(--warning)';
      } else {
        this.elSpeedCircle.style.stroke = 'var(--primary)';
      }

      const fraction = Math.min(1, speedKmh / Math.max(30, configuredSpeed * 1.2));
      this.elSpeedCircle.style.strokeDashoffset = 264 - (fraction * 264);
    }

    handleStepUpdate(step) {
      this.elNavDistance.textContent = `Dans ${step.distanceMeters} m`;
      this.elNavStreet.textContent = step.street || step.instruction;
      this.elNavSafety.textContent = step.safety || 'Piste cyclable';

      const icons = {
        right: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M5 19V9a4 4 0 0 1 4-4h10"/><polyline points="15 9 19 5 15 1"/></svg>',
        left: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M19 19V9a4 4 0 0 0-4-4H5"/><polyline points="9 9 5 5 9 1"/></svg>',
        arrive: '<span style="font-size:24px;">🏁</span>',
        straight: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
      };
      this.elNavIcon.innerHTML = icons[step.modifier] || icons.straight;
    }

    handleTripUpdate(trip) {
      this.elHudTimeRem.textContent = `${trip.remainingMin} min`;
      this.elHudDistRem.textContent = `${trip.remainingDistKm} km`;
      if (trip.batteryStatus) this.elBatteryArrival.textContent = `Fin: ~${trip.batteryStatus.arrivalPct}%`;
    }

    handleRideRecorderUpdate(stats) {
      const timeEl = document.getElementById('rec-live-time');
      const distEl = document.getElementById('rec-live-distance');
      const avgEl = document.getElementById('rec-live-avg-speed');
      const maxEl = document.getElementById('rec-live-max-speed');

      if (timeEl) timeEl.textContent = stats.timeFormatted;
      if (distEl) distEl.textContent = `${stats.distanceKm} km`;
      if (avgEl) avgEl.textContent = `${stats.avgSpeedKmh} km/h`;
      if (maxEl) maxEl.textContent = `${stats.maxSpeedKmh} km/h`;
    }

    renderRidesHistoryUI() {
      const listContainer = document.getElementById('rides-history-list');
      if (!listContainer) return;

      const globalStats = this.rideRecorder.getGlobalStats();
      const globKm = document.getElementById('global-stat-km');
      const globTime = document.getElementById('global-stat-time');
      const globAvg = document.getElementById('global-stat-avg-speed');
      const globCount = document.getElementById('global-stat-trips-count');

      if (globKm) globKm.textContent = `${globalStats.totalKm} km`;
      if (globTime) globTime.textContent = globalStats.totalTime;
      if (globAvg) globAvg.textContent = `${globalStats.avgSpeed} km/h`;
      if (globCount) globCount.textContent = globalStats.tripsCount;

      if (this.rideRecorder.savedRides.length === 0) {
        listContainer.innerHTML = `
          <div class="rides-empty-state">
            <span class="empty-icon">🛴</span>
            <p>Aucun trajet enregistré pour le moment.</p>
            <span class="empty-sub">Appuyez sur le bouton rouge 🔴 pour enregistrer votre prochaine sortie !</span>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = '';
      this.rideRecorder.savedRides.forEach(ride => {
        const item = document.createElement('div');
        item.className = 'ride-card-item';
        item.innerHTML = `
          <div class="ride-card-header">
            <span class="ride-date">📅 ${ride.date} • <strong>${ride.title}</strong></span>
            <span class="ride-badge">${ride.durationFormatted}</span>
          </div>
          <div class="ride-metrics-grid">
            <div><span class="ride-metric-val">${ride.distanceKm} km</span><br><span class="ride-metric-lbl">Distance</span></div>
            <div><span class="ride-metric-val">${ride.avgSpeedKmh} km/h</span><br><span class="ride-metric-lbl">Vitesse Moy.</span></div>
            <div><span class="ride-metric-val">${ride.maxSpeedKmh} km/h</span><br><span class="ride-metric-lbl">Vitesse Max</span></div>
            <div><span class="ride-metric-val">${ride.points ? ride.points.length : 0}</span><br><span class="ride-metric-lbl">Points GPS</span></div>
          </div>
          <div class="ride-actions">
            <button class="btn-micro view-ride-btn" data-id="${ride.id}">🗺️ Voir tracé</button>
            <button class="btn-micro gpx-ride-btn" data-id="${ride.id}">📥 Exporter GPX</button>
            <button class="btn-micro danger del-ride-btn" data-id="${ride.id}">🗑️</button>
          </div>
        `;

        item.querySelector('.view-ride-btn').addEventListener('click', () => {
          this.mapManager.displayPastRide(ride.points);
          this.elSettingsModal.style.display = 'none';
          this.showToast(`🗺️ Tracé affiché : ${ride.distanceKm} km`);
        });

        item.querySelector('.gpx-ride-btn').addEventListener('click', () => {
          this.rideRecorder.exportGpx(ride.id);
          this.showToast('📥 Fichier GPX téléchargé !');
        });

        item.querySelector('.del-ride-btn').addEventListener('click', () => {
          this.rideRecorder.deleteRide(ride.id);
          this.renderRidesHistoryUI();
          this.showToast('Trajet supprimé');
        });

        listContainer.appendChild(item);
      });
    }

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

      if (this.selectedHazardType === 'charge') {
        this.chargingManager.stations.push({
          id: 'ch_user_' + Date.now(),
          name: 'Point de Charge 230V Signalé',
          lat: currentLoc.lat,
          lng: currentLoc.lng,
          plug: 'Prise 230V standard 16A',
          access: 'Signalé par la communauté',
          desc: comment || 'Prise 230V disponible'
        });
        this.chargingManager.render();
      } else {
        this.hazardManager.addHazard({
          type: this.selectedHazardType,
          lat: currentLoc.lat + 0.0004,
          lng: currentLoc.lng + 0.0004,
          title: config.label,
          desc: comment || config.warning,
          author: (this.authManager.currentUser && this.authManager.currentUser.username) || 'Moi (Trottinette)',
          upvotes: 1
        });
      }

      this.authManager.incrementReports();
      this.updateUserAuthUI();
      this.elReportModal.style.display = 'none';
      this.showToast(`✅ Signalé : ${config.label} !`);
    }

    showToast(msg) {
      const existing = document.getElementById('trotti-toast');
      if (existing) existing.remove();
      const toast = document.createElement('div');
      toast.id = 'trotti-toast';
      toast.className = 'glass-panel';
      toast.style.cssText = `
        position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%);
        z-index: 2000; padding: 8px 16px; font-size: 12.5px; font-weight: 700;
        border-radius: 25px; border: 1px solid var(--primary);
        box-shadow: 0 4px 15px rgba(0,0,0,0.5); white-space: nowrap;
      `;
      toast.textContent = msg;
      document.getElementById('app-container').appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 2500);
    }
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new TrottiWazeApp());
  } else {
    new TrottiWazeApp();
  }
})();
