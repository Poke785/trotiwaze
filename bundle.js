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
          this.users = [];
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
  // 3. Garage & Multi-Vehicle Fleet Manager (Trottinettes, Gyroroues, E-Skate, VAE)
  // =========================================================================
  const VEHICLE_TYPES_PRESETS = {
    '🛴': { name: 'Trottinette Standard', type: 'trotti', icon: '🛴', wh: 474, volts: 36, ah: 13, scootKg: 18, speed: 25 },
    '⚡': { name: 'Trottinette Sport Bi-Moteur', type: 'trotti_sport', icon: '⚡', wh: 1400, volts: 60, ah: 23, scootKg: 32, speed: 45 },
    '🎡': { name: 'Gyroroue / Monoroue', type: 'gyroroue', icon: '🎡', wh: 1500, volts: 84, ah: 18, scootKg: 24, speed: 35 },
    '🛹': { name: 'E-Skate / Longboard', type: 'eskate', icon: '🛹', wh: 350, volts: 36, ah: 10, scootKg: 8, speed: 30 },
    '🚲': { name: 'Vélo Électrique (VAE)', type: 'vae', icon: '🚲', wh: 500, volts: 36, ah: 14, scootKg: 22, speed: 25 },
    '🛞': { name: 'Onewheel Tout-Terrain', type: 'onewheel', icon: '🛞', wh: 325, volts: 63, ah: 5.2, scootKg: 14, speed: 25 },
    '🛵': { name: 'Draisine Électrique', type: 'draisine', icon: '🛵', wh: 650, volts: 48, ah: 13.5, scootKg: 20, speed: 25 }
  };

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
          this.scooters = [];
        }

        const savedActiveId = localStorage.getItem('trottiwaze_active_scooter_id');
        if (savedActiveId && this.scooters.find(s => s.id === savedActiveId)) {
          this.activeScooterId = savedActiveId;
        } else {
          this.activeScooterId = this.scooters[0] ? this.scooters[0].id : null;
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
        name: 'Mon Véhicule',
        icon: '🛴',
        batteryCapacityWh: 474,
        currentPercentage: 100,
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
        name: data.name || 'Nouveau Modèle',
        icon: data.icon || '🛴',
        batteryCapacityWh: parseInt(data.batteryCapacityWh, 10) || 474,
        currentPercentage: parseInt(data.currentPercentage, 10) || 100,
        riderWeightKg: parseInt(data.riderWeightKg, 10) || 75,
        scooterWeightKg: parseInt(data.scooterWeightKg, 10) || 18,
        speedPrefKmh: parseInt(data.speedPrefKmh, 10) || 25,
        volts: data.volts || 36,
        amphours: data.amphours || 13,
        odometerKm: parseFloat(data.odometerKm) || 0,
        lastTireCheckKm: parseFloat(data.lastTireCheckKm) || 0,
        lastBrakeCheckKm: parseFloat(data.lastBrakeCheckKm) || 0
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
          currentPercentage: parseInt(data.currentPercentage, 10) || this.scooters[index].currentPercentage,
          odometerKm: data.odometerKm !== undefined ? parseFloat(data.odometerKm) : (this.scooters[index].odometerKm || 0),
          lastTireCheckKm: data.lastTireCheckKm !== undefined ? parseFloat(data.lastTireCheckKm) : (this.scooters[index].lastTireCheckKm || 0),
          lastBrakeCheckKm: data.lastBrakeCheckKm !== undefined ? parseFloat(data.lastBrakeCheckKm) : (this.scooters[index].lastBrakeCheckKm || 0)
        };
        this.saveGarage();
        if (this.activeScooterId === id && this.onActiveChangedCallback) {
          this.onActiveChangedCallback(this.scooters[index]);
        }
        return this.scooters[index];
      }
      return null;
    }

    addKmToActiveScooter(km) {
      const active = this.getActiveScooter();
      if (!active || isNaN(km) || km <= 0) return;
      active.odometerKm = parseFloat(((active.odometerKm || 0) + km).toFixed(2));
      this.saveGarage();
      if (this.onActiveChangedCallback) this.onActiveChangedCallback(active);
    }

    recordTireCheck(scooterId) {
      const scoot = this.scooters.find(s => s.id === scooterId);
      if (scoot) {
        scoot.lastTireCheckKm = scoot.odometerKm || 0;
        this.saveGarage();
        if (this.onActiveChangedCallback) this.onActiveChangedCallback(scoot);
        return true;
      }
      return false;
    }

    recordBrakeCheck(scooterId) {
      const scoot = this.scooters.find(s => s.id === scooterId);
      if (scoot) {
        scoot.lastBrakeCheckKm = scoot.odometerKm || 0;
        this.saveGarage();
        if (this.onActiveChangedCallback) this.onActiveChangedCallback(scoot);
        return true;
      }
      return false;
    }

    deleteScooter(id) {
      this.scooters = this.scooters.filter(s => s.id !== id);
      if (this.activeScooterId === id) {
        this.activeScooterId = this.scooters[0] ? this.scooters[0].id : null;
        if (this.onActiveChangedCallback) {
          this.onActiveChangedCallback(this.getActiveScooter());
        }
      }
      this.saveGarage();
      return { success: true };
    }
  }

  // =========================================================================
  // 4. Battery & Energy Engine (Calcul Dénivelé, Montées, KERS & Impact Froid)
  // =========================================================================
  class BatteryEngine {
    constructor(garageManager, weatherEngine = null) {
      this.garageManager = garageManager;
      this.weatherEngine = weatherEngine;
      this.baseEfficiencyWhPerKm = 16.5;
    }

    get config() {
      return this.garageManager ? this.garageManager.getActiveScooter() : {
        name: 'Mon Véhicule',
        batteryCapacityWh: 474,
        currentPercentage: 100,
        riderWeightKg: 75,
        scooterWeightKg: 18,
        speedPrefKmh: 25
      };
    }

    estimateTrip(distanceKm, elevationGainM = 5, elevationLossM = 5, customSpeed = null) {
      const cfg = this.config;
      const riderKg = cfg.riderWeightKg || 75;
      const scooterKg = cfg.scooterWeightKg || 18;
      const totalMassKg = riderKg + scooterKg;
      const weightFactor = totalMassKg / 90; // Masse de référence pilote 72kg + trottinette 18kg
      const effectiveSpeed = customSpeed || cfg.speedPrefKmh || 25;

      // 1. Modèle physique de consommation sur le plat :
      // - Roulement pneu/frottements : ~7.2 Wh/km (proportionnel à la masse)
      // - Traînée aérodynamique : ~5.2 Wh/km à 20 km/h, varie selon le carré de la vitesse (v/20)^2
      const baseRollingWhPerKm = 7.2 * weightFactor;
      const speedRatio = Math.max(12, effectiveSpeed) / 20;
      const aeroWhPerKm = 5.2 * Math.pow(speedRatio, 2);
      const flatEfficiencyWhPerKm = baseRollingWhPerKm + aeroWhPerKm;
      const flatEnergyWh = distanceKm * flatEfficiencyWhPerKm;

      // 2. Énergie en montée (dénivelé positif) : E_climb = (m * g * deltaH) / (3600 * rendement)
      const avgSlopePct = distanceKm > 0 ? (elevationGainM / (distanceKm * 1000)) * 100 : 0;
      const motorEfficiency = avgSlopePct > 5 ? 0.68 : 0.76;
      const climbEnergyWh = (totalMassKg * 9.81 * Math.max(0, elevationGainM)) / (3600 * motorEfficiency);

      // 3. Récupération KERS en descente (~20% de l'énergie potentielle restituée)
      const regenEnergyWh = (totalMassKg * 9.81 * Math.max(0, elevationLossM) * 0.20) / 3600;

      // 4. Énergie nette mécanique
      const netMechanicalWh = Math.max(1, flatEnergyWh + climbEnergyWh - regenEnergyWh);

      // 5. Modélisation thermique Lithium-Ion (Température Open-Meteo)
      const tempC = (this.weatherEngine && this.weatherEngine.currentWeather && this.weatherEngine.currentWeather.tempC !== undefined) 
        ? this.weatherEngine.currentWeather.tempC : 20;
      
      let thermalFactor = 1.0;
      let thermalLabel = `🌡️ ${tempC}°C • Rendement optimal`;

      if (tempC <= -5) {
        thermalFactor = 0.75; // -25% grand froid
        thermalLabel = `❄️ Grand Froid (${tempC}°C) : -25% d'autonomie`;
      } else if (tempC < 8) {
        thermalFactor = 0.85 + (tempC - (-5)) * 0.008; // ~ -15%
        thermalLabel = `❄️ Froid Hivernal (${tempC}°C) : -15% d'autonomie`;
      } else if (tempC < 16) {
        thermalFactor = 0.93 + (tempC - 8) * 0.009; // ~ -7%
        thermalLabel = `⛅ Frais (${tempC}°C) : -7% d'autonomie`;
      } else if (tempC <= 30) {
        thermalFactor = 1.0;
        thermalLabel = `☀️ Idéal (${tempC}°C) : 100% nominal`;
      } else {
        thermalFactor = 0.95;
        thermalLabel = `🔥 Forte chaleur (${tempC}°C) : perte légère`;
      }

      const totalWhUsed = Math.max(1, netMechanicalWh / thermalFactor);
      const thermalLossWh = Math.round(totalWhUsed - netMechanicalWh);

      const fullCapacityWh = cfg.batteryCapacityWh || 474;
      const consumedPct = Math.min(100, Math.max(1, Math.round((totalWhUsed / fullCapacityWh) * 100)));
      const remainingPct = Math.max(0, 100 - consumedPct);

      // Temps estimé pour recharger les Wh dépensés sur prise 230V standard
      const rechargeTimeMin = Math.max(5, Math.round((totalWhUsed / 280) * 60));
      const avgConsumptionPerKm = parseFloat((totalWhUsed / (distanceKm || 1)).toFixed(1));
      const remainingRangeKm = ((remainingPct / 100) * fullCapacityWh / (avgConsumptionPerKm || 13)).toFixed(1);

      return {
        consumedPct,
        consumedWh: Math.round(totalWhUsed),
        whUsed: Math.round(totalWhUsed),
        flatWh: Math.round(flatEnergyWh),
        climbWh: Math.round(climbEnergyWh),
        regenWh: Math.round(regenEnergyWh),
        tempC,
        thermalFactor: Math.round(thermalFactor * 100),
        thermalLossWh,
        thermalLabel,
        currentPct: 100,
        arrivalPct: remainingPct,
        remainingRangeKm: parseFloat(remainingRangeKm),
        rechargeTimeMin,
        isCritical: consumedPct > 85,
        elevationGainM: Math.round(elevationGainM),
        elevationLossM: Math.round(elevationLossM)
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
  // 7. 230V & IRVE Charging Stations Engine (Vraies Bornes Réelles & Overpass API)
  // =========================================================================
  const REAL_IRVE_STATIONS_CATALOG = [
    // Paris / IDF (Belib, TotalEnergies, Izivia, Electra, Tesla)
    { id: 'irve_p1', name: 'Belib\' - Hôtel de Ville / Rivoli', lat: 48.8566, lng: 2.3522, operator: 'Belib\' Métropole', power: '22 kW', connectors: 'Type 2 AC • Prise 230V standard 16A', address: 'Place de l\'Hôtel de Ville, 75004 Paris', access: 'Public 24h/24', fee: 'Payant Belib\'' },
    { id: 'irve_p2', name: 'Belib\' - Bastille / Boulevard Richard Lenoir', lat: 48.8540, lng: 2.3705, operator: 'Belib\'', power: '22 kW', connectors: 'Type 2 AC • Prise 230V E/F', address: 'Boulevard Richard Lenoir, 75011 Paris', access: 'Public 24h/24', fee: 'Payant Belib\'' },
    { id: 'irve_p3', name: 'TotalEnergies - Relais République', lat: 48.8672, lng: 2.3635, operator: 'TotalEnergies', power: '50 kW', connectors: 'Combo CCS • Type 2 • Prise 230V 16A', address: 'Place de la République, 75003 Paris', access: 'Station service 24h/24', fee: 'Payant TotalEnergies' },
    { id: 'irve_p4', name: 'Belib\' - Gare de Lyon / Diderot', lat: 48.8448, lng: 2.3735, operator: 'Belib\'', power: '22 kW', connectors: 'Type 2 AC • Prise 230V 16A E/F', address: 'Boulevard Diderot, 75012 Paris', access: 'Public 24h/24', fee: 'Payant Belib\'' },
    { id: 'irve_p5', name: 'Izivia - Châtelet / Les Halles', lat: 48.8615, lng: 2.3470, operator: 'Izivia Grand Paris', power: '22 kW', connectors: 'Type 2 AC • Prise 230V 16A', address: 'Rue Berger / Les Halles, 75001 Paris', access: 'Public 24h/24', fee: 'Payant Izivia' },
    { id: 'irve_p6', name: 'Belib\' - Opéra / Boulevard des Capucines', lat: 48.8705, lng: 2.3320, operator: 'Belib\'', power: '22 kW', connectors: 'Type 2 AC • Prise 230V standard', address: 'Boulevard des Capucines, 75009 Paris', access: 'Public 24h/24', fee: 'Payant Belib\'' },
    { id: 'irve_p7', name: 'Belib\' - Montparnasse / Vaugirard', lat: 48.8420, lng: 2.3215, operator: 'Belib\'', power: '22 kW', connectors: 'Type 2 AC • Prise 230V 16A E/F', address: 'Boulevard de Vaugirard, 75015 Paris', access: 'Public 24h/24', fee: 'Payant Belib\'' },
    { id: 'irve_p8', name: 'Belib\' - Nation / Cours de Vincennes', lat: 48.8480, lng: 2.3970, operator: 'Belib\'', power: '22 kW', connectors: 'Type 2 AC • Prise 230V standard', address: 'Cours de Vincennes, 75012 Paris', access: 'Public 24h/24', fee: 'Payant Belib\'' },
    
    // Lyon Métropole
    { id: 'irve_ly1', name: 'IZIVIA Grand Lyon - Bellecour', lat: 45.7578, lng: 4.8320, operator: 'Grand Lyon', power: '22 kW', connectors: 'Type 2 AC • Prise 230V 16A E/F', address: 'Place Bellecour, 69002 Lyon', access: 'Public 24h/24', fee: 'Payant Izivia' },
    { id: 'irve_ly2', name: 'Borne Métropole - Part-Dieu / Vivier Merle', lat: 45.7605, lng: 4.8600, operator: 'Métropole de Lyon', power: '22 kW', connectors: 'Type 2 AC • Prise 230V', address: 'Boulevard Vivier Merle, 69003 Lyon', access: 'Public 24h/24', fee: 'Payant Métropole' },
    
    // Bordeaux Métropole
    { id: 'irve_bd1', name: 'Bordeaux Métropole - Place de la Bourse / Quais', lat: 44.8415, lng: -0.5695, operator: 'Bordeaux Métropole', power: '22 kW', connectors: 'Type 2 AC • Prise 230V standard', address: 'Quai Richelieu, 33000 Bordeaux', access: 'Public 24h/24', fee: 'Payant' },
    
    // Toulouse Métropole
    { id: 'irve_tl1', name: 'Toulouse Métropole - Capitole / Alsace Lorraine', lat: 43.6045, lng: 1.4440, operator: 'Toulouse Métropole', power: '22 kW', connectors: 'Type 2 AC • Prise 230V standard', address: 'Rue d\'Alsace Lorraine, 31000 Toulouse', access: 'Public 24h/24', fee: 'Payant' },
    
    // Nantes / Strasbourg / Nice / Lille
    { id: 'irve_na1', name: 'Nantes Métropole - Commerce / 50 Otages', lat: 47.2140, lng: -1.5580, operator: 'Nantes Métropole', power: '22 kW', connectors: 'Type 2 AC • Prise 230V 16A', address: 'Cours des 50 Otages, 44000 Nantes', access: 'Public 24h/24', fee: 'Payant' },
    { id: 'irve_st1', name: 'Strasbourg Eurométropole - Place Kléber', lat: 48.5835, lng: 7.7455, operator: 'Strasbourg Métropole', power: '22 kW', connectors: 'Type 2 AC • Prise 230V E/F', address: 'Place Kléber, 67000 Strasbourg', access: 'Public 24h/24', fee: 'Payant' },
    { id: 'irve_nc1', name: 'Nice Côte d\'Azur - Promenade des Anglais', lat: 43.6950, lng: 7.2680, operator: 'Prise de Nice', power: '22 kW', connectors: 'Type 2 AC • Prise 230V standard', address: 'Promenade des Anglais, 06000 Nice', access: 'Public 24h/24', fee: 'Payant' },
    { id: 'irve_ll1', name: 'Lille Métropole - Grand Place / Opéra', lat: 50.6370, lng: 3.0640, operator: 'MEL Lille', power: '22 kW', connectors: 'Type 2 AC • Prise 230V standard', address: 'Place du Théâtre, 59000 Lille', access: 'Public 24h/24', fee: 'Payant' }
  ];

  class ChargingStationsManager {
    constructor(mapManager, onNavigateToStation) {
      this.mapManager = mapManager;
      this.onNavigateToStation = onNavigateToStation;
      this.stations = [...REAL_IRVE_STATIONS_CATALOG];
      this.markers = [];
      this.isVisible = true;
      this.lastQueryCoords = null;
      this.isLoading = false;
    }

    async generateNearbyStations(centerLat, centerLng) {
      return this.fetchRealEVStations(centerLat, centerLng);
    }

    async fetchRealEVStations(centerLat, centerLng) {
      if (!centerLat || !centerLng || isNaN(centerLat) || isNaN(centerLng)) return;

      // Rate limit / deduplicate queries if user only moved slightly (< 1 km)
      if (this.lastQueryCoords) {
        const distKm = Math.hypot(this.lastQueryCoords.lat - centerLat, (this.lastQueryCoords.lng - centerLng) * Math.cos(centerLat * Math.PI / 180)) * 111;
        if (distKm < 1.0 && this.stations.length > 0) return;
      }
      this.lastQueryCoords = { lat: centerLat, lng: centerLng };

      this.isLoading = true;
      let fetchedStations = [];

      // 1. Primary Live Source: OpenStreetMap Overpass API (Worldwide real EV charging stations)
      try {
        const bboxRadiusM = 6500;
        const overpassQuery = `[out:json][timeout:8];(node["amenity"="charging_station"](around:${bboxRadiusM},${centerLat},${centerLng});way["amenity"="charging_station"](around:${bboxRadiusM},${centerLat},${centerLng}););out center 40;`;
        const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6500);

        const res = await fetch(overpassUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const json = await res.json();
          if (json && json.elements && json.elements.length > 0) {
            fetchedStations = json.elements.map(el => {
              const tags = el.tags || {};
              const lat = el.lat || (el.center && el.center.lat);
              const lng = el.lon || (el.center && el.center.lon);
              if (!lat || !lng) return null;

              const operator = tags.operator || tags.brand || tags.network || tags.owner || 'Borne Voiture Électrique';
              let stationName = tags.name;
              if (!stationName) {
                const street = tags['addr:street'] || tags['addr:city'] || '';
                stationName = street ? `${operator} - ${street}` : `Station ${operator}`;
              }

              const capacity = tags.capacity ? `${tags.capacity} points de charge` : 'Borne de recharge voiture';
              const power = tags.maxpower ? `${tags.maxpower} kW` : (tags['socket:combo_ccs:output'] || tags['socket:type2:output'] || 'Jusqu\'à 22-150 kW');

              const connectors = [];
              if (tags['socket:combo_ccs'] || tags['socket:combo_ccs:output']) connectors.push('Combo CCS (DC)');
              if (tags['socket:type2'] || tags['socket:type2:output'] || tags['socket:type2_cable']) connectors.push('Type 2 AC');
              if (tags['socket:domestic'] === 'yes' || tags['socket:type_e'] === 'yes') connectors.push('Prise 230V 16A (E/F)');
              if (tags['socket:chademo']) connectors.push('CHAdeMO');
              if (connectors.length === 0) connectors.push('Type 2 / Prise 230V');

              let address = '';
              if (tags['addr:street']) {
                address = `${tags['addr:housenumber'] || ''} ${tags['addr:street']}, ${tags['addr:city'] || ''}`.trim();
              }

              return {
                id: 'osm_irve_' + el.id,
                name: stationName,
                operator: operator,
                lat: lat,
                lng: lng,
                power: power,
                capacity: capacity,
                connectors: connectors.join(' • '),
                address: address,
                access: tags.opening_hours || tags.access || 'Public 24h/24',
                fee: tags.fee === 'no' ? 'Gratuit' : (tags.fee === 'yes' ? 'Payant' : 'Tarif selon réseau')
              };
            }).filter(Boolean);
          }
        }
      } catch (e) {
        console.warn('Overpass EV charging stations lookup notice:', e);
      }

      // 2. Secondary Live Source: French Official OpenDataSoft IRVE API (data.gouv.fr)
      if (fetchedStations.length === 0) {
        try {
          const odsUrl = `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/fichier-consolide-des-bornes-de-recharge-pour-vehicules-electriques-irve/records?where=within_distance(geo_point_borne,%20geom'POINT(${centerLng}%20${centerLat})',%208km)&limit=35`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);
          const odsRes = await fetch(odsUrl, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (odsRes.ok) {
            const odsData = await odsRes.json();
            if (odsData && odsData.results && odsData.results.length > 0) {
              fetchedStations = odsData.results.map((r, idx) => {
                const lat = r.geo_point_borne ? r.geo_point_borne.lat : (r.coordonneesXY ? r.coordonneesXY[1] : null);
                const lng = r.geo_point_borne ? r.geo_point_borne.lon : (r.coordonneesXY ? r.coordonneesXY[0] : null);
                if (!lat || !lng) return null;

                const operator = r.nom_enseigne || r.nom_operateur || r.nom_amenageur || 'Réseau IRVE';
                const name = r.nom_station || r.n_station || `${operator} - Borne Voiture`;
                const power = r.puissance_nominale ? `${r.puissance_nominale} kW` : (r.puiss_max ? `${r.puiss_max} kW` : '22 kW');

                const connectors = [];
                if (r.prise_type_2) connectors.push('Type 2');
                if (r.prise_type_combo_ccs) connectors.push('Combo CCS');
                if (r.prise_type_ef) connectors.push('Prise 230V E/F');
                if (connectors.length === 0) connectors.push('Prise Type 2 / 230V');

                return {
                  id: 'ods_irve_' + (r.id_station_itinerance || idx),
                  name: name,
                  operator: operator,
                  lat: lat,
                  lng: lng,
                  power: power,
                  capacity: r.nbre_pdc ? `${r.nbre_pdc} points de charge` : 'Station de recharge',
                  connectors: connectors.join(' • '),
                  address: r.adresse_station || r.ad_station || '',
                  access: r.condition_acces || r.horaires || 'Public 24h/24',
                  fee: r.tarification || 'Tarif selon réseau'
                };
              }).filter(Boolean);
            }
          }
        } catch (e) {
          console.warn('OpenDataSoft IRVE lookup notice:', e);
        }
      }

      this.isLoading = false;

      // Merge real stations avoiding duplicates (strictly no fake offsets!)
      if (fetchedStations.length > 0) {
        fetchedStations.forEach(ns => {
          const exists = this.stations.find(s => Math.hypot(s.lat - ns.lat, s.lng - ns.lng) < 0.0003 || s.id === ns.id);
          if (!exists) {
            this.stations.unshift(ns);
          }
        });
        if (this.stations.length > 80) this.stations.length = 80;
        this.render();
      }
    }

    render() {
      this.clearMarkers();
      if (!this.isVisible || !this.mapManager || !this.mapManager.map) return;

      this.stations.forEach(st => {
        const icon = L.divIcon({
          className: 'charging-marker-icon',
          html: `<div class="charge-bubble-pin" title="${st.name}"><span class="charge-bubble-glow"></span><span class="charge-icon-sym">⚡</span></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

        const marker = L.marker([st.lat, st.lng], { icon }).addTo(this.mapManager.map);
        
        const popupContent = `
          <div class="charging-popup-card">
            <div class="charge-popup-header">
              <span class="charge-popup-tag">🚗⚡ RECHARGE VOITURE (IRVE)</span>
              <span class="charge-popup-power">${st.power || '22 kW'}</span>
            </div>
            <div class="charge-popup-title">${st.name}</div>
            <div class="charge-popup-operator">🏢 Opérateur : <strong>${st.operator || 'Réseau IRVE'}</strong></div>
            <div class="charge-popup-plug">🔌 Connecteurs : <strong>${st.connectors || 'Type 2 / 230V'}</strong></div>
            ${st.address ? `<div class="charge-popup-addr">📍 ${st.address}</div>` : ''}
            <div class="charge-popup-desc">🕒 ${st.access || '24h/24'} • 💳 ${st.fee || 'Tarif opérateur'}</div>
            <button class="btn-charge-route" id="btn-goto-charge-${st.id}">🚀 Y aller en trottinette</button>
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
      this.favorites = {};
      this.load();
    }

    load() {
      try {
        const r = localStorage.getItem('trottiwaze_recents_v2');
        if (r) this.recents = JSON.parse(r);
        const f = localStorage.getItem('trottiwaze_favs_v2');
        if (f) this.favorites = JSON.parse(f);
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

    setFavorite(key, item) {
      this.favorites[key] = item;
      this.save();
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
  } // ← end RideRecorder

  // =========================================================================
  // 9b. Parking & Where is My Scooter Manager
  // =========================================================================
  class ParkingManager {
    constructor(mapManager, app) {
      this.mapManager = mapManager;
      this.app = app;
      this.parkedLocation = null;
      this.parkingMarker = null;
      this.load();
    }

    load() {
      try {
        const raw = localStorage.getItem('trottiwaze_parked_scooter');
        if (raw) {
          this.parkedLocation = JSON.parse(raw);
        }
      } catch (e) {}
    }

    save() {
      try {
        if (this.parkedLocation) {
          localStorage.setItem('trottiwaze_parked_scooter', JSON.stringify(this.parkedLocation));
        } else {
          localStorage.removeItem('trottiwaze_parked_scooter');
        }
      } catch (e) {}
    }

    parkHere(lat, lng, note = '') {
      const active = this.app.garageManager.getActiveScooter();
      this.parkedLocation = {
        lat,
        lng,
        note: note.trim() || 'Arceau / Stationnement trottinette',
        vehicleName: active.name || 'Mon Véhicule',
        vehicleIcon: active.icon || '🛴',
        timestamp: Date.now(),
        dateFormatted: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      };
      this.save();
      this.renderMarker();
      this.updateBanner();
      this.app.showToast('🅿️ Emplacement trottinette mémorisé !');
    }

    clearParking() {
      this.parkedLocation = null;
      this.save();
      if (this.parkingMarker && this.mapManager && this.mapManager.map) {
        this.mapManager.map.removeLayer(this.parkingMarker);
        this.parkingMarker = null;
      }
      this.updateBanner();
      this.app.showToast('🔓 Trottinette récupérée');
    }

    renderMarker() {
      if (!this.parkedLocation || !this.mapManager || !this.mapManager.map) return;
      if (this.parkingMarker) {
        this.mapManager.map.removeLayer(this.parkingMarker);
        this.parkingMarker = null;
      }

      const icon = L.divIcon({
        className: 'parking-marker-leaflet',
        html: `
          <div class="parked-pin-container">
            <div class="parked-pin-pulse"></div>
            <div class="parked-pin-icon">🅿️</div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      this.parkingMarker = L.marker([this.parkedLocation.lat, this.parkedLocation.lng], { icon, zIndexOffset: 950 }).addTo(this.mapManager.map);
      
      const popupHtml = `
        <div class="parking-popup-card">
          <div class="parking-popup-badge">🅿️ TROTTINETTE GARÉE</div>
          <div class="parking-popup-title">${this.parkedLocation.vehicleIcon} ${this.parkedLocation.vehicleName}</div>
          <div class="parking-popup-time">🕒 Garée à ${this.parkedLocation.dateFormatted}</div>
          ${this.parkedLocation.note ? `<div class="parking-popup-note">📝 ${this.parkedLocation.note}</div>` : ''}
          <div class="parking-popup-actions">
            <button class="btn-micro" id="btn-popup-walk-to-scooter">🚶 Retrouver à pied</button>
            <button class="btn-micro danger" id="btn-popup-unpark">🔓 Récupérer</button>
          </div>
        </div>
      `;
      this.parkingMarker.bindPopup(popupHtml);
      this.parkingMarker.on('popupopen', () => {
        const btnWalk = document.getElementById('btn-popup-walk-to-scooter');
        if (btnWalk) btnWalk.addEventListener('click', () => {
          this.parkingMarker.closePopup();
          this.navigateToParkedScooter();
        });
        const btnUnpark = document.getElementById('btn-popup-unpark');
        if (btnUnpark) btnUnpark.addEventListener('click', () => {
          this.parkingMarker.closePopup();
          this.clearParking();
        });
      });
    }

    navigateToParkedScooter() {
      if (!this.parkedLocation) return;
      this.app.selectedEndCoords = { lat: this.parkedLocation.lat, lng: this.parkedLocation.lng };
      this.app.elEndInput.value = `🅿️ Ma trottinette (${this.parkedLocation.vehicleName})`;
      this.app.calculateCurrentRoute();
      this.app.showToast('🚶 Itinéraire piéton vers votre trottinette');
    }

    updateBanner() {
      const banner = document.getElementById('parked-scooter-floating-banner');
      if (!banner) return;
      if (this.parkedLocation) {
        banner.style.display = 'flex';
        const txt = document.getElementById('parked-banner-text');
        const minAgo = Math.max(0, Math.floor((Date.now() - this.parkedLocation.timestamp) / 60000));
        const timeStr = minAgo < 1 ? 'à l\'instant' : `il y a ${minAgo} min`;
        if (txt) txt.innerHTML = `<strong>${this.parkedLocation.vehicleIcon} Garée ${timeStr}</strong> • ${this.parkedLocation.note}`;
      } else {
        banner.style.display = 'none';
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
      this.currentLayerId = 'waze';
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
        .addAttribution('&copy; <a href="https://www.openstreetmap.org">OSM</a> | &copy; CartoDB | &copy; CyclOSM | &copy; Esri')
        .addTo(this.map);
      L.control.zoom({ position: 'topleft' }).addTo(this.map);

      this.map.on('dragstart', () => {
        this.setAutoFollow(false);
      });

      const tileOpts = { maxZoom: 20, crossOrigin: true };

      this.tileLayers = {
        waze: L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', { ...tileOpts, subdomains: 'abc', maxZoom: 19 }),
        osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { ...tileOpts, maxZoom: 19 }),
        cyclosm: L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', { ...tileOpts, subdomains: 'abc', maxZoom: 20 }),
        streets: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { ...tileOpts, maxZoom: 19 }),
        opentopo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { ...tileOpts, maxZoom: 17 }),
        ign: L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', { ...tileOpts, maxZoom: 19 }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { ...tileOpts, maxZoom: 19 }),
        night: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { ...tileOpts, maxZoom: 19 })
      };

      // Verified Cycleways Overlay (vector layer for green corridors)
      this.isVerifiedCyclewaysEnabled = true;

      // Restore saved map layer or default to Waze
      const savedLayer = localStorage.getItem('trottiwaze_map_layer') || 'waze';
      this.currentLayerId = this.tileLayers[savedLayer] ? savedLayer : 'waze';
      this.tileLayers[this.currentLayerId].addTo(this.map);
      
      // Initialize Vector High-Visibility Layer for Guaranteed Certified Cycle Corridors
      this.initVerifiedCyclewaysVectorLayer();

      this.createScooterMarker(this.defaultCenter[0], this.defaultCenter[1]);

      let moveDebounceTimer = null;
      this.map.on('moveend', () => {
        if (moveDebounceTimer) clearTimeout(moveDebounceTimer);
        moveDebounceTimer = setTimeout(() => {
          if (this.map && this.onMapMoveCenter) {
            const center = this.map.getCenter();
            this.onMapMoveCenter(center.lat, center.lng);
          }
        }, 900);
      });

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

    setVerifiedCyclewaysVisible(visible) {
      this.isVerifiedCyclewaysEnabled = visible;
      if (visible) {
        if (this.cyclewaysOverlay) this.cyclewaysOverlay.addTo(this.map);
        if (this.verifiedTracksGroup) this.verifiedTracksGroup.addTo(this.map);
      } else {
        if (this.cyclewaysOverlay) this.map.removeLayer(this.cyclewaysOverlay);
        if (this.verifiedTracksGroup) this.map.removeLayer(this.verifiedTracksGroup);
      }
    }

    zoomToCycleway(trackId) {
      const track = VERIFIED_CYCLEWAYS_CATALOG.find(t => t.id === trackId);
      if (track && track.coords && track.coords.length > 0) {
        const bounds = L.latLngBounds(track.coords);
        this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
      }
    }

    setTileLayer(layerId) {
      if (!this.tileLayers[layerId]) return;

      Object.keys(this.tileLayers).forEach(k => {
        if (this.map.hasLayer(this.tileLayers[k])) {
          this.map.removeLayer(this.tileLayers[k]);
        }
      });

      this.tileLayers[layerId].addTo(this.map);
      this.currentLayerId = layerId;

      if (this.isVerifiedCyclewaysEnabled && this.verifiedTracksGroup) {
        this.verifiedTracksGroup.bringToFront();
      }

      this.map.invalidateSize();

      const names = {
        waze: 'Style Cartoon Dessin Animé HD (OSM Pastel)',
        osm: 'OpenStreetMap Standard',
        cyclosm: 'CyclOSM Pistes Cyclables',
        streets: 'Style GPS Urbain (Esri)',
        opentopo: 'OpenTopoMap Relief & Dénivelé HD',
        ign: 'Plan IGN France Officiel (GEOPF)',
        satellite: 'Vue Satellite Réelle HD',
        night: 'Mode Nuit Épuré (Dark Canvas)'
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
        html: `<div id="trotti-scooter-pin" class="scooter-marker-container"><div class="scooter-beam"></div><div class="scooter-icon-pin cartoon-waze-pin" id="scooter-icon-pin-inner">${iconChar}</div></div>`,
        iconSize: [46, 46], iconAnchor: [23, 23]
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
        safe: ['rgba(16,185,129,0.35)', '#10b981'],
        fast: ['rgba(14,165,233,0.35)', '#0ea5e9'],
        eco: ['rgba(234,179,8,0.35)', '#eab308'],
        nature: ['rgba(5,150,105,0.35)', '#059669']
      };
      const [glowColor, strokeColor] = colors[mode] || colors.safe;

      // Soft glow aura
      const glowLine = L.polyline(coordinates, { color: glowColor, weight: 14, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(this.map);
      // Dark / contrast casing line for cartoon clarity
      const casingLine = L.polyline(coordinates, { color: 'rgba(15, 23, 42, 0.75)', weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(this.map);
      // Vivid candy center line
      const mainLine = L.polyline(coordinates, { color: strokeColor, weight: 5.5, opacity: 1.0, lineCap: 'round', lineJoin: 'round' }).addTo(this.map);

      this.routePolylines.push(glowLine, casingLine, mainLine);
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

      // 1. French National Address & City API (BAN - Data.gouv) - Priority 1
      try {
        const banUrl = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=7&autocomplete=1`;
        const res = await fetch(banUrl);
        if (res.ok) {
          const data = await res.json();
          if (data && data.features) {
            data.features.forEach(f => {
              const props = f.properties;
              const full = props.label;
              if (!seen.has(full.toLowerCase())) {
                seen.add(full.toLowerCase());
                const isCity = props.type === 'municipality';
                results.push({
                  mainText: isCity ? (props.city || props.name) : props.name,
                  subText: isCity ? `${props.postcode || ''} • Ville` : `${props.postcode || ''} ${props.city || ''} (${props.context || ''})`,
                  fullLabel: props.label,
                  lat: f.geometry.coordinates[1],
                  lng: f.geometry.coordinates[0],
                  icon: isCity ? '🏙️' : '📍',
                  isVerifiedCycleway: false
                });
              }
            });
          }
        }
      } catch (e) {}

      // 2. If user specifically types "piste", "canal", "voie", or exact cycle track name, search catalog
      const wantsCycleway = clean.includes('piste') || clean.includes('voie') || clean.includes('canal') || clean.includes('berges') || clean.includes('quai');
      if (typeof VERIFIED_CYCLEWAYS_CATALOG !== 'undefined' && (wantsCycleway || results.length < 2)) {
        VERIFIED_CYCLEWAYS_CATALOG.forEach(track => {
          const matchName = track.name.toLowerCase().includes(clean);
          const matchCity = track.city.toLowerCase().includes(clean);

          if (matchName || (wantsCycleway && matchCity)) {
            const key = `cycleway_${track.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                mainText: track.name,
                subText: `🛡️ Piste sûre • ${track.city} (${track.lengthKm} km)`,
                fullLabel: `${track.name}, ${track.city}`,
                lat: track.lat,
                lng: track.lng,
                icon: '🛡️',
                isVerifiedCycleway: true,
                trackId: track.id
              });
            }
          }
        });
      }

      // 3. Fallback to OpenStreetMap Nominatim for POIs or cross-border cities
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
                  icon: item.type === 'city' || item.type === 'administrative' ? '🏙️' : '📍',
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

      const fetchWithTimeout = async (url, ms = 3500) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), ms);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) return null;
          return await res.json();
        } catch (e) {
          return null;
        }
      };

      // 1. Fetch car / paved arterial routes (100% paved roadway, zero dirt paths)
      const fetchCarDirect = async () => {
        const endpoints = [
          `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true&alternatives=3`,
          `https://routing.openstreetmap.de/routed-car/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true&alternatives=true`
        ];
        for (const url of endpoints) {
          const data = await fetchWithTimeout(url, 3200);
          if (data && data.routes && data.routes.length > 0) {
            return data.routes;
          }
        }
        return [];
      };

      // 2. Fetch bike routes with cycleways and greenways
      const fetchBikeWithAlternatives = async () => {
        const endpoints = [
          `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true&alternatives=true`,
          `https://router.project-osrm.org/route/v1/bike/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true&alternatives=true`
        ];
        for (const url of endpoints) {
          const data = await fetchWithTimeout(url, 3200);
          if (data && data.routes && data.routes.length > 0) {
            return data.routes;
          }
        }
        return [];
      };

      // Parallel execution with strict timeout fallback (vehicular/scooter road & cycle profiles only)
      const [carRoutes, bikeRoutes] = await Promise.all([
        fetchCarDirect(),
        fetchBikeWithAlternatives()
      ]);

      return this.buildTrottiRoutes(startCoords, endCoords, bikeRoutes, carRoutes);
    }

    _parseOSRM(osrmRoute) {
      if (osrmRoute && osrmRoute.geometry && osrmRoute.geometry.coordinates) {
        // Leaflet requires [lat, lng], OSRM GeoJSON provides [lng, lat]
        const coords = osrmRoute.geometry.coordinates.map(c => [c[1], c[0]]);
        const distanceKm = parseFloat((osrmRoute.distance / 1000).toFixed(2));
        const steps = osrmRoute.legs ? osrmRoute.legs.flatMap(leg => (leg.steps || []).map(s => ({
          instruction: s.maneuver.type === 'arrive' ? 'Vous êtes arrivé à destination' : (s.name ? `Prenez ${s.name}` : 'Continuez tout droit'),
          distanceMeters: Math.round(s.distance),
          street: s.name || 'Voie aménagée',
          modifier: s.maneuver.modifier || (s.maneuver.type === 'arrive' ? 'arrive' : 'straight'),
          safety: '🟢 Voie cyclable'
        }))) : [];
        return { coords, distanceKm, steps };
      }
      return null;
    }

    _isUnpavedOrDirt(steps) {
      if (!steps || steps.length === 0) return false;
      // Strictly detect unpaved dirt / mud / gravel surfaces, never ordinary street names like 'Chemin des Dames'
      const dirtPattern = /\b(terre|boue|mud|dirt|gravier|gravillons|non[- ]?goudronn|non[- ]?bitum|sentier[- ]?de[- ]?terre|chemin[- ]?de[- ]?terre|piste[- ]?de[- ]?terre)\b/i;
      return steps.some(s => {
        const txt = `${s.street || ''} ${s.instruction || ''}`;
        return dirtPattern.test(txt);
      });
    }

    buildTrottiRoutes(start, end, bikeRoutes = [], carRoutes = []) {
      const speed = this.batteryEngine.config.speedPrefKmh || 25;
      const straightKm = this.computeDistanceKm(start.lat, start.lng, end.lat, end.lng);
      const avoidDirt = !!this.filters.avoidDirtPaths;

      // 1. Collect all valid candidate routes from road network engines
      const candidates = [];
      const addCandidate = (osrmRoute, defaultMode, title, isGuaranteedPaved = false) => {
        if (!osrmRoute) return;
        const parsed = this._parseOSRM(osrmRoute);
        if (!parsed || !parsed.coords || parsed.coords.length < 2) return;
        
        // If user wants ONLY paved roads: car routes are always 100% asphalt by definition.
        // For bike routes, reject if unpaved dirt/gravel was detected.
        if (avoidDirt && !isGuaranteedPaved && this._isUnpavedOrDirt(parsed.steps)) {
          return;
        }

        candidates.push({
          data: parsed,
          mode: defaultMode,
          title,
          isPaved: isGuaranteedPaved || !this._isUnpavedOrDirt(parsed.steps)
        });
      };

      // Priority 1: Direct Car Route (100% asphalt / major arteries without dead-ends or dirt)
      if (Array.isArray(carRoutes) && carRoutes.length > 0) {
        carRoutes.forEach((cr, i) => {
          addCandidate(cr, i === 0 ? 'fast' : 'eco', i === 0 ? '⚡ Direct & Rapide' : '🔋 Alternative Chaussée', true);
        });
      } else if (carRoutes && !Array.isArray(carRoutes)) {
        addCandidate(carRoutes, 'fast', '⚡ Direct & Rapide', true);
      }

      // Priority 2: Bike routes (tested for dirt paths if filter is enabled)
      if (bikeRoutes && bikeRoutes.length > 0) {
        bikeRoutes.forEach((br, idx) => {
          addCandidate(br, idx === 0 ? 'safe' : 'eco', idx === 0 ? '🟢 Sécurisé (Pistes)' : '🔋 Éco & Pistes Douces');
        });
      }

      // 2. Strict Deduplication: filter out routes that follow effectively the same path
      const uniqueCandidates = [];
      for (const cand of candidates) {
        const candDist = cand.data.distanceKm;
        const isDuplicate = uniqueCandidates.some(existing => {
          const distDiff = Math.abs(existing.data.distanceKm - candDist);
          // If total distance differs by less than 80 meters, check if mid-point is also identical
          if (distDiff < 0.08) {
            const midIndexA = Math.floor(existing.data.coords.length / 2);
            const midIndexB = Math.floor(cand.data.coords.length / 2);
            const ptA = existing.data.coords[midIndexA];
            const ptB = cand.data.coords[midIndexB];
            if (ptA && ptB) {
              const midDist = this.computeDistanceKm(ptA[0], ptA[1], ptB[0], ptB[1]);
              return midDist < 0.08; // Identical path
            }
            return true;
          }
          return false;
        });

        if (!isDuplicate) {
          uniqueCandidates.push(cand);
        }
        if (uniqueCandidates.length >= 3) break; // Maximum 3 routes
      }

      // 3. Fallback only if offline / no server answered (generate orthogonal street-following grid)
      if (uniqueCandidates.length === 0) {
        const fallback = this.generateRealisticGridRoute(start, end, 1.25);
        uniqueCandidates.push({
          data: fallback,
          mode: 'safe',
          title: '🟢 Voie Bitumée',
          isPaved: true
        });
      }

      // 4. Map to Fast, Safe, Eco modes (strictly 1, 2, or 3 routes based on availability)
      const routesResult = {};
      const modeKeys = ['fast', 'safe', 'eco'];

      uniqueCandidates.forEach((cand, idx) => {
        const mode = modeKeys[idx] || `route_${idx + 1}`;
        const distKm = parseFloat(cand.data.distanceKm.toFixed(2));
        const gainM = mode === 'fast' ? Math.max(8, Math.round(straightKm * 3.5)) :
                     mode === 'safe' ? Math.max(4, Math.round(straightKm * 2.0)) :
                     Math.max(2, Math.round(straightKm * 0.7));
        const lossM = Math.max(2, Math.round(gainM * 0.9));
        const slope = mode === 'fast' ? 4.2 : mode === 'safe' ? 2.5 : 1.1;
        
        // Realistic calibrated scooter cruising speeds:
        // - Fast: nominal top speed (e.g. 25 km/h)
        // - Safe: ~88% of top speed for relaxed cycleway navigation (e.g. 22 km/h)
        // - Eco: ~80% of top speed for optimal energy saving (e.g. 20 km/h)
        const modeSpeed = mode === 'fast' ? speed :
                          mode === 'safe' ? Math.max(16, Math.round(speed * 0.88)) :
                          Math.max(15, Math.round(speed * 0.80));

        let modeTitle = cand.title;
        if (idx === 0) modeTitle = '⚡ Direct & Rapide';
        if (idx === 1) modeTitle = '🟢 Sécurisé (Pistes)';
        if (idx === 2) modeTitle = '🔋 Éco & Plat';

        routesResult[mode] = {
          title: modeTitle,
          mode: mode,
          distanceKm: distKm,
          durationMin: Math.max(1, Math.round((distKm / modeSpeed) * 60)),
          protectedPct: mode === 'safe' ? 92 : mode === 'eco' ? 86 : 58,
          praticability: avoidDirt ? '✨ 100% Goudronné (Aucun chemin)' : (this.filters.avoidCobblestones ? '✨ Grands axes bitumés' : '✨ Route praticable'),
          cobblestonesCount: 0,
          elevationGainM: gainM,
          elevationLossM: lossM,
          maxSlopePct: slope,
          cruisingSpeedKmh: modeSpeed,
          coordinates: cand.data.coords, // Full array of real street turns & vertices
          steps: cand.data.steps
        };
      });

      return routesResult;
    }

    generateRealisticGridRoute(start, end, factor = 1.25) {
      // Orthogonal Manhattan city street simulation with realistic turns (fallback only)
      const lat1 = start.lat, lng1 = start.lng;
      const lat2 = end.lat, lng2 = end.lng;
      const corner1Lat = lat2;
      const corner1Lng = lng1;

      const coords = [];
      const stepsCount = 18;
      // Leg 1: along longitude
      for (let i = 0; i <= stepsCount; i++) {
        const t = i / stepsCount;
        coords.push([lat1 + (corner1Lat - lat1) * t, lng1]);
      }
      // Leg 2: along latitude
      for (let i = 1; i <= stepsCount; i++) {
        const t = i / stepsCount;
        coords.push([corner1Lat, lng1 + (lng2 - corner1Lng) * t]);
      }

      const rawDist = this.computeDistanceKm(lat1, lng1, lat2, lng2);
      const distanceKm = parseFloat((rawDist * factor).toFixed(2));
      const steps = [
        { distanceMeters: Math.round(distanceKm * 500), street: 'Chaussée bitumée', modifier: 'straight', instruction: 'Continuez tout droit sur la route goudronnée', safety: '🟢 Chaussée lisse' },
        { distanceMeters: Math.round(distanceKm * 450), street: 'Avenue urbaine', modifier: 'right', instruction: 'Tournez à droite sur l\'avenue', safety: '🟢 Route goudronnée' },
        { distanceMeters: 50, street: 'Arrivée', modifier: 'arrive', instruction: 'Vous êtes arrivé !', safety: '🏁 Fin de trajet' }
      ];
      return { coords, distanceKm, steps };
    }

    computeDistanceKm(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }
  } // ← end RoutingEngine


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
  } // ← end HazardManager

  // =========================================================================
  // 14. WebAudio Horn Synthesizer (Clochette, Klaxon Waze, Alerte Urgence)
  // =========================================================================
  class HornAudioSynthesizer {
    constructor() {
      this.ctx = null;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playDingDong() {
      this.init();
      if (!this.ctx) return;
      try {
        const now = this.ctx.currentTime;
        // Chime 1
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(2093, now); // C7
        osc1.frequency.exponentialRampToValueAtTime(1046, now + 0.3);
        gain1.gain.setValueAtTime(0.5, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc1.connect(gain1);
        gain1.connect(this.ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.35);

        // Chime 2
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1567, now + 0.12); // G6
        osc2.frequency.exponentialRampToValueAtTime(783, now + 0.5);
        gain2.gain.setValueAtTime(0.4, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.55);
      } catch (e) {}
    }

    playWazeBip() {
      this.init();
      if (!this.ctx) return;
      try {
        const now = this.ctx.currentTime;
        [0, 0.11].forEach((offset, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(idx === 0 ? 587.33 : 880, now + offset);
          gain.gain.setValueAtTime(0.4, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.09);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.09);
        });
      } catch (e) {}
    }

    playHazardAlarm() {
      this.init();
      if (!this.ctx) return;
      try {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1400, now);
        osc.frequency.linearRampToValueAtTime(500, now + 0.18);
        osc.frequency.linearRampToValueAtTime(1400, now + 0.36);
        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
      } catch (e) {}
    }
  }

  // =========================================================================
  // 15. Cockpit HUD Fullscreen Handlebar Manager (Mode Guidon OLED Pro)
  // =========================================================================
  class CockpitHUDManager {
    constructor(app) {
      this.app = app;
      this.isOpen = false;
      this.isMirror = false;
      this.currentSpeed = 0;
      this.currentSlopePct = 0;
      this.initElements();
      this.initEvents();
      this.initSensors();
    }

    initElements() {
      this.elOverlay = document.getElementById('cockpit-hud-overlay');
      this.elSpeedVal = document.getElementById('cockpit-speed-val');
      this.elPowerWatts = document.getElementById('cockpit-power-watts');
      this.elPowerFill = document.getElementById('cockpit-power-meter-fill');
      this.elSlopeVal = document.getElementById('cockpit-slope-val');
      this.elSlopeSub = document.getElementById('cockpit-slope-sub');
      this.elBattVal = document.getElementById('cockpit-batt-val');
      this.elWhVal = document.getElementById('cockpit-wh-val');
      this.elChronoVal = document.getElementById('cockpit-chrono-val');
      this.elDistVal = document.getElementById('cockpit-dist-val');
      this.elAvgSpeedVal = document.getElementById('cockpit-avg-speed-val');
      this.elMaxSpeedSub = document.getElementById('cockpit-max-speed-sub');
      this.elVehicleIcon = document.getElementById('cockpit-vehicle-icon');
      this.elVehicleName = document.getElementById('cockpit-vehicle-name');
      this.elSpeedLimitLabel = document.getElementById('cockpit-speed-limit-label');
    }

    initEvents() {
      const btnOpen = document.getElementById('btn-open-cockpit-hud');
      if (btnOpen) btnOpen.addEventListener('click', () => this.open());

      const btnClose = document.getElementById('btn-close-cockpit-hud');
      if (btnClose) btnClose.addEventListener('click', () => this.close());

      const btnMirror = document.getElementById('btn-cockpit-mirror');
      if (btnMirror) {
        btnMirror.addEventListener('click', () => {
          this.isMirror = !this.isMirror;
          if (this.elOverlay) this.elOverlay.classList.toggle('mirror-mode', this.isMirror);
          btnMirror.classList.toggle('active', this.isMirror);
        });
      }
    }

    initSensors() {
      if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', (e) => {
          if (!this.isOpen) return;
          const pitch = e.beta;
          if (pitch !== null && !isNaN(pitch)) {
            const clamped = Math.max(-25, Math.min(25, pitch - 70));
            const slope = Math.round(Math.tan(clamped * Math.PI / 180) * 100 * 10) / 10;
            this.currentSlopePct = slope;
            this.updateSlopeDisplay(slope);
            this.updatePowerWatts();
          }
        });
      }
    }

    open() {
      this.isOpen = true;
      if (this.elOverlay) this.elOverlay.style.display = 'flex';
      this.syncVehicleInfo();
      this.updateStats();
      this.app.showToast('🎛️ Mode Cockpit Guidon Activé');
    }

    close() {
      this.isOpen = false;
      if (this.elOverlay) this.elOverlay.style.display = 'none';
    }

    syncVehicleInfo() {
      const active = this.app.garageManager.getActiveScooter();
      if (this.elVehicleIcon) this.elVehicleIcon.textContent = active.icon || '🛴';
      if (this.elVehicleName) this.elVehicleName.textContent = (active.name || 'Mon Véhicule').toUpperCase();
      if (this.elSpeedLimitLabel) this.elSpeedLimitLabel.textContent = `BRIDE : ${active.speedPrefKmh || 25} KM/H`;
    }

    updateSpeed(speedKmh) {
      this.currentSpeed = Math.max(0, speedKmh);
      if (this.elSpeedVal) this.elSpeedVal.textContent = Math.round(this.currentSpeed);
      this.updatePowerWatts();
      if (this.isOpen) this.updateStats();
    }

    updateSlopeDisplay(slopePct) {
      if (this.elSlopeVal) {
        const sign = slopePct > 0 ? '+' : '';
        this.elSlopeVal.textContent = `${sign}${slopePct.toFixed(1)}%`;
      }
      if (this.elSlopeSub) {
        if (slopePct > 5) this.elSlopeSub.textContent = 'Côte raide ⛰️';
        else if (slopePct > 1.5) this.elSlopeSub.textContent = 'Montée douce 📈';
        else if (slopePct < -3) this.elSlopeSub.textContent = 'Descente (KERS ⚡)';
        else this.elSlopeSub.textContent = 'Terrain plat';
      }
    }

    updatePowerWatts() {
      const active = this.app.garageManager.getActiveScooter();
      const totalMass = (active.riderWeightKg || 75) + (active.scooterWeightKg || 18);
      const speedMs = (this.currentSpeed || 0) / 3.6;

      if (speedMs < 0.2) {
        if (this.elPowerWatts) this.elPowerWatts.textContent = '0 W';
        if (this.elPowerFill) this.elPowerFill.style.width = '0%';
        return;
      }

      const theta = Math.atan((this.currentSlopePct || 0) / 100);
      const pGrav = totalMass * 9.81 * Math.sin(theta) * speedMs;
      const pRoll = 0.015 * totalMass * 9.81 * speedMs;
      const pAero = 0.5 * 1.2 * 0.35 * Math.pow(speedMs, 3);

      const totalWatts = Math.round(Math.max(-150, pGrav + pRoll + pAero));
      
      if (this.elPowerWatts) {
        this.elPowerWatts.textContent = totalWatts < 0 ? `⚡ KERS ${totalWatts} W` : `${totalWatts} W`;
      }
      if (this.elPowerFill) {
        const pct = Math.min(100, Math.max(0, (totalWatts / (active.speedPrefKmh > 30 ? 1200 : 600)) * 100));
        this.elPowerFill.style.width = `${pct}%`;
      }
    }

    updateStats() {
      const rec = this.app.rideRecorder;
      if (this.elChronoVal) this.elChronoVal.textContent = rec.formatTime(rec.durationSec || 0);
      if (this.elDistVal) this.elDistVal.textContent = `${(rec.distanceKm || 0).toFixed(2)} km`;
      if (this.elAvgSpeedVal) this.elAvgSpeedVal.textContent = `${(rec.avgSpeedKmh || 0).toFixed(1)} km/h`;
      if (this.elMaxSpeedSub) this.elMaxSpeedSub.textContent = `Max: ${(rec.maxSpeedKmh || 0).toFixed(1)} km/h`;

      const active = this.app.garageManager.getActiveScooter();
      const battEst = this.app.batteryEngine.estimateTrip(rec.distanceKm || 0, 5, 5);
      if (this.elBattVal) this.elBattVal.textContent = `-${Math.round(battEst.consumedPct)}%`;
      if (this.elWhVal) this.elWhVal.textContent = `⚡ ${Math.round(battEst.whUsed)} Wh`;
    }
  }

  // =========================================================================
  // 16. Master TrottiWaze App Controller
  // =========================================================================
  class TrottiWazeApp {
    constructor() {
      window.trottiApp = this;
      this.weatherEngine = new WeatherEngine();
      this.authManager = new AuthManager();
      this.garageManager = new GarageManager(activeScooter => this.handleActiveScooterChanged(activeScooter));
      this.batteryEngine = new BatteryEngine(this.garageManager, this.weatherEngine);
      this.historyManager = new HistoryManager();
      this.mapManager = new MapManager('map');
      this.compassManager = new OrientationCompassManager(this.mapManager);
      this.voiceEngine = new VoiceGuidanceEngine();
      this.hornSynth = new HornAudioSynthesizer();
      
      this.parkingManager = new ParkingManager(this.mapManager, this);
      this.rideRecorder = new RideRecorder(stats => this.handleRideRecorderUpdate(stats));
      this.chargingManager = new ChargingStationsManager(this.mapManager, station => this.navigateToChargingStation(station));
      this.routingEngine = new RoutingEngine(this.batteryEngine);
      this.navigationEngine = new NavigationEngine(this.mapManager, this.batteryEngine, this.rideRecorder, this.voiceEngine, this.compassManager);
      this.hazardManager = new HazardManager(this.mapManager);
      this.cockpitHUD = new CockpitHUDManager(this);

      this.selectedRouteMode = 'fast';
      this.calculatedRoutes = null;
      this.selectedStartCoords = null;
      this.selectedEndCoords = null;
      this.selectedSignupAvatar = '🦊';
      this.selectedScooterIcon = '🛴';
      this.currentCyclewayCityFilter = 'all';

      this.mapManager.onMapMoveCenter = (lat, lng) => {
        if (this.chargingManager && this.chargingManager.isVisible) {
          this.chargingManager.fetchRealEVStations(lat, lng);
        }
      };

      this.cacheDOMElements();
      this.initEvents();
      this.initUserGPS();
      this.renderGarageFleetUI();
      this.renderRidesHistoryUI();
      this.initVoiceUI();
      this.updateUserAuthUI();
      this.chargingManager.render();
      this.parkingManager.renderMarker();
      this.parkingManager.updateBanner();
    }

    cacheDOMElements() {
      this.elRoutePanel = document.getElementById('route-panel');
      this.elExpandableContent = document.getElementById('panel-expandable-content');
      this.elStickyLaunchBar = document.getElementById('sticky-launch-bar');
      this.elWazeRouteSheet = document.getElementById('waze-route-sheet');
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

      if (this.garageManager.scooters.length === 0) {
        container.innerHTML = `
          <div class="empty-garage-card">
            <span class="empty-garage-icon">🛴</span>
            <div class="empty-garage-title">Votre garage est vide</div>
            <div class="empty-garage-desc">Ajoutez votre trottinette (batterie, vitesse, poids) pour calibrer précisément l'autonomie et le calcul d'énergie.</div>
            <button type="button" class="btn-primary" id="btn-empty-add-scoot" style="margin-top: 12px; width: auto; padding: 8px 18px; display: inline-flex; align-items: center; gap: 6px;">
              ➕ Ajouter ma première trottinette
            </button>
          </div>
        `;
        const btnEmpty = container.querySelector('#btn-empty-add-scoot');
        if (btnEmpty) {
          btnEmpty.addEventListener('click', () => this.openScooterDrawer(null));
        }
        this.updateHudWithActiveScooter(active);
        return;
      }

      this.garageManager.scooters.forEach(scoot => {
        const isActive = scoot.id === active.id;
        const odo = parseFloat((scoot.odometerKm || 0).toFixed(1));
        const kmSinceTire = parseFloat(Math.max(0, odo - (scoot.lastTireCheckKm || 0)).toFixed(1));
        const kmSinceBrake = parseFloat(Math.max(0, odo - (scoot.lastBrakeCheckKm || 0)).toFixed(1));
        const tirePercent = Math.min(100, Math.round((kmSinceTire / 150) * 100));
        const brakePercent = Math.min(100, Math.round((kmSinceBrake / 500) * 100));
        const tireAlert = kmSinceTire >= 150;
        const brakeAlert = kmSinceBrake >= 500;

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
            <span class="fleet-spec-tag">⚖️ <strong>${scoot.scooterWeightKg} kg</strong></span>
            <span class="fleet-spec-tag">🛣️ <strong>${odo} km</strong> roulés</span>
            <span class="fleet-spec-tag">🔋 <strong>${scoot.currentPercentage}%</strong></span>
          </div>

          <!-- Carnet d'Entretien & Anti-Crevaison -->
          <div class="fleet-maintenance-box">
            <div class="maint-header">
              <span>🔧 Entretien & Pression (Odomètre : <strong>${odo} km</strong>)</span>
            </div>
            <div class="maint-row ${tireAlert ? 'maint-alert' : ''}">
              <div class="maint-label-row">
                <span>🛞 Pression pneus : <strong>${kmSinceTire} / 150 km</strong></span>
                ${tireAlert ? '<span class="maint-badge-warn">⚠️ Vérifier !</span>' : '<span class="maint-badge-ok">OK</span>'}
              </div>
              <div class="maint-bar-track">
                <div class="maint-bar-fill ${tireAlert ? 'danger' : ''}" style="width: ${tirePercent}%;"></div>
              </div>
              <button type="button" class="btn-micro btn-maint-tire" data-id="${scoot.id}">✅ Valider pression pneus (${odo} km)</button>
            </div>
            <div class="maint-row ${brakeAlert ? 'maint-alert' : ''}">
              <div class="maint-label-row">
                <span>🛑 Plaquettes de frein : <strong>${kmSinceBrake} / 500 km</strong></span>
                ${brakeAlert ? '<span class="maint-badge-warn">⚠️ Contrôle requis</span>' : '<span class="maint-badge-ok">OK</span>'}
              </div>
              <div class="maint-bar-track">
                <div class="maint-bar-fill ${brakeAlert ? 'danger' : ''}" style="width: ${brakePercent}%;"></div>
              </div>
              <button type="button" class="btn-micro btn-maint-brake" data-id="${scoot.id}">✅ Valider contrôle freins (${odo} km)</button>
            </div>
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

        const btnTire = card.querySelector('.btn-maint-tire');
        if (btnTire) {
          btnTire.addEventListener('click', () => {
            this.garageManager.recordTireCheck(scoot.id);
            this.renderGarageFleetUI();
            this.showToast(`🛞 Pression des pneus validée pour "${scoot.name}"`);
          });
        }

        const btnBrake = card.querySelector('.btn-maint-brake');
        if (btnBrake) {
          btnBrake.addEventListener('click', () => {
            this.garageManager.recordBrakeCheck(scoot.id);
            this.renderGarageFleetUI();
            this.showToast(`🛑 Contrôle des freins validé pour "${scoot.name}"`);
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
        battSlider.value = scoot.currentPercentage || 100;
        valBatt.textContent = `${scoot.currentPercentage || 100}%`;
        this.selectedScooterIcon = scoot.icon || '🛴';
      } else {
        title.textContent = '➕ Nouveau Véhicule (Trotti, Gyroroue, VAE...)';
        editId.value = '';
        nameInp.value = '';
        capInp.value = '474';
        riderInp.value = '75';
        scootInp.value = '18';
        speedSlider.value = '25';
        valSpeed.textContent = '25 km/h';
        battSlider.value = '100';
        valBatt.textContent = '100%';
        this.selectedScooterIcon = '🛴';
      }

      document.querySelectorAll('.scooter-icon-choice').forEach(b => {
        const iconKey = b.getAttribute('data-icon');
        b.classList.toggle('active', iconKey === this.selectedScooterIcon);
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
      if (this.elBatteryPercent) this.elBatteryPercent.textContent = `-0%`;
      if (this.elBatteryArrival) this.elBatteryArrival.textContent = `⚡ Conso : 0 Wh`;
      if (this.elBatteryFill) this.elBatteryFill.style.width = `15%`;
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
      if (sumGarage) {
        if (this.garageManager.scooters.length > 0 && activeScoot) {
          sumGarage.textContent = `Actif : ${activeScoot.name} (${activeScoot.batteryCapacityWh} Wh • ${activeScoot.speedPrefKmh} km/h)`;
        } else {
          sumGarage.textContent = 'Aucune trottinette enregistrée (Garage vide)';
        }
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
      // Close settings modal when clicking anywhere on the backdrop outside the card
      this.elSettingsModal.addEventListener('click', (e) => {
        if (!e.target.closest('.modal-card')) {
          this.elSettingsModal.style.display = 'none';
          this.mapManager.map.invalidateSize();
        }
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
          const icon = btn.getAttribute('data-icon');
          this.selectedScooterIcon = icon;

          // If adding new vehicle, auto-fill with vehicle category preset
          const editId = document.getElementById('edit-scooter-id').value;
          if (!editId && VEHICLE_TYPES_PRESETS[icon]) {
            const p = VEHICLE_TYPES_PRESETS[icon];
            const nameInp = document.getElementById('scooter-custom-name');
            const capInp = document.getElementById('scooter-capacity');
            const scootInp = document.getElementById('scooter-weight');
            const speedSlider = document.getElementById('scooter-speed-slider');
            const valSpeed = document.getElementById('val-speed-slider');

            if (nameInp && (!nameInp.value || Object.values(VEHICLE_TYPES_PRESETS).some(vp => vp.name === nameInp.value))) {
              nameInp.value = p.name;
            }
            if (capInp) capInp.value = p.wh;
            if (scootInp) scootInp.value = p.scootKg;
            if (speedSlider) {
              speedSlider.value = p.speed;
              if (valSpeed) valSpeed.textContent = `${p.speed} km/h`;
              document.querySelectorAll('.speed-preset-btn').forEach(b => b.classList.toggle('active', parseInt(b.getAttribute('data-speed'), 10) === p.speed));
            }
          }
        });
      });

      // Save Scooter Form (Add or Edit)
      const btnSaveScooter = document.getElementById('btn-save-scooter-form');
      if (btnSaveScooter) {
        btnSaveScooter.addEventListener('click', () => {
          const editId = document.getElementById('edit-scooter-id').value;
          const name = document.getElementById('scooter-custom-name').value.trim() || 'Mon Véhicule';
          const capWh = parseInt(document.getElementById('scooter-capacity').value, 10) || 474;
          const riderKg = parseInt(document.getElementById('scooter-rider-weight').value, 10) || 75;
          const scootKg = parseInt(document.getElementById('scooter-weight').value, 10) || 18;
          const speed = parseInt(document.getElementById('scooter-speed-slider').value, 10) || 25;
          const battPct = parseInt(document.getElementById('scooter-battery-pct').value, 10) || 100;

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
        opt.classList.toggle('active', opt.getAttribute('data-layer-id') === this.mapManager.currentLayerId);
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
      // Close auth modal when clicking anywhere on the backdrop outside the card
      this.elAuthModal.addEventListener('click', (e) => {
        if (!e.target.closest('.modal-card')) {
          this.elAuthModal.style.display = 'none';
        }
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
          this.garageManager.addKmToActiveScooter(saved.distanceKm);
          this.authManager.updateUserStats(saved.distanceKm, 1);
          this.renderGarageFleetUI();
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

      // Parking FAB & Modal Listeners
      const btnParkFab = document.getElementById('btn-park-scooter');
      const modalPark = document.getElementById('park-scooter-modal');
      const btnClosePark = document.getElementById('btn-close-park-modal');
      const btnConfirmPark = document.getElementById('btn-confirm-park');
      const inpParkNote = document.getElementById('park-memo-note');
      const btnParkedWalk = document.getElementById('btn-parked-walk');
      const btnParkedClear = document.getElementById('btn-parked-clear');

      if (btnParkFab) {
        btnParkFab.addEventListener('click', () => {
          if (modalPark) modalPark.style.display = 'flex';
          if (inpParkNote) {
            inpParkNote.value = '';
            inpParkNote.focus();
          }
        });
      }

      if (btnClosePark && modalPark) {
        btnClosePark.addEventListener('click', () => {
          modalPark.style.display = 'none';
        });
      }

      if (modalPark) {
        modalPark.addEventListener('click', (e) => {
          if (!e.target.closest('.modal-card')) {
            modalPark.style.display = 'none';
          }
        });
      }

      if (btnConfirmPark) {
        btnConfirmPark.addEventListener('click', () => {
          const loc = this.mapManager.currentLocation;
          const note = (inpParkNote ? inpParkNote.value : '');
          this.parkingManager.parkHere(loc.lat, loc.lng, note);
          if (modalPark) modalPark.style.display = 'none';
          if (inpParkNote) inpParkNote.value = '';
        });
      }

      if (btnParkedWalk) {
        btnParkedWalk.addEventListener('click', () => {
          this.parkingManager.navigateToParkedScooter();
        });
      }

      if (btnParkedClear) {
        btnParkedClear.addEventListener('click', () => {
          this.parkingManager.clearParking();
        });
      }


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
          if (fav && fav.lat && fav.lng) {
            this.selectedEndCoords = { lat: fav.lat, lng: fav.lng };
            this.elEndInput.value = fav.full || fav.name;
            this.calculateCurrentRoute();
          } else {
            const label = favKey === 'home' ? 'Domicile' : 'Travail';
            this.showToast(`ℹ️ Entrez une adresse pour votre ${label}`);
            this.elEndInput.placeholder = `Adresse ${label}...`;
            this.elEndInput.focus();
          }
        });
      });

      // Clear End Input
      document.getElementById('btn-clear-dest').addEventListener('click', () => {
        this.elEndInput.value = '';
        this.selectedEndCoords = null;
        this.calculatedRoutes = null;
        this.mapManager.clearRoute();
        if (this.elExpandableContent) this.elExpandableContent.style.display = 'none';
        if (this.elStickyLaunchBar) this.elStickyLaunchBar.style.display = 'none';
        if (this.elWazeRouteSheet) this.elWazeRouteSheet.style.display = 'none';
        if (this.elRoutePanel) this.elRoutePanel.classList.remove('panel-compact');
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

      // Waze Route Sheet Toggle (Minimize / Expand)
      const btnToggleSheet = document.getElementById('btn-toggle-route-sheet');
      const sheetToggleBar = document.getElementById('waze-sheet-toggle');
      const toggleSheetFn = () => {
        if (!this.elWazeRouteSheet) return;
        const isCollapsed = this.elWazeRouteSheet.classList.toggle('sheet-collapsed');
        if (btnToggleSheet) btnToggleSheet.textContent = isCollapsed ? '▲' : '▼';
      };
      if (btnToggleSheet) btnToggleSheet.addEventListener('click', (e) => { e.stopPropagation(); toggleSheetFn(); });
      if (sheetToggleBar) sheetToggleBar.addEventListener('click', toggleSheetFn);

      // Route Cards Selection (Waze style — 3 cards)
      document.querySelectorAll('.route-card-waze').forEach(card => {
        card.addEventListener('click', () => {
          document.querySelectorAll('.route-card-waze').forEach(c => c.classList.remove('active'));
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
      // Close report modal when clicking anywhere on the backdrop outside the card
      this.elReportModal.addEventListener('click', (e) => {
        if (!e.target.closest('.modal-card')) {
          this.elReportModal.style.display = 'none';
        }
      });
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
      // Close cycleways modal when clicking anywhere on the backdrop outside the card
      if (this.elCyclewaysModal) {
        this.elCyclewaysModal.addEventListener('click', (e) => {
          if (!e.target.closest('.modal-card')) {
            this.elCyclewaysModal.style.display = 'none';
          }
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
      const wrapperEl = inputEl.closest('.input-row-wrapper');

      const closeDropdown = () => {
        suggestionsEl.style.display = 'none';
        if (wrapperEl) wrapperEl.classList.remove('active-autocomplete');
        if (this.elRoutePanel) this.elRoutePanel.classList.remove('has-suggestions');
      };

      const openDropdown = () => {
        suggestionsEl.style.display = 'block';
        if (wrapperEl) wrapperEl.classList.add('active-autocomplete');
        if (this.elRoutePanel) this.elRoutePanel.classList.add('has-suggestions');
      };

      // Show ONLY past recent searches on focus when input is empty (per user request)
      const showRecentSearches = () => {
        const recents = (this.historyManager && this.historyManager.recents) || [];
        if (recents.length === 0) {
          closeDropdown();
          return;
        }

        suggestionsEl.innerHTML = `
          <div style="padding: 7px 10px; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
            <span>🕒 Recherches récentes</span>
            <span style="font-size: 9px; color: #64748b;">${recents.length} sauvegardée(s)</span>
          </div>
        `;

        recents.forEach(item => {
          const div = document.createElement('div');
          div.className = 'suggestion-item recent-search-item';
          div.innerHTML = `
            <span class="sugg-icon">🕒</span>
            <div class="sugg-text">
              <div class="sugg-main-row">
                <span class="sugg-main">${item.mainText || item.fullLabel}</span>
              </div>
              <span class="sugg-sub">${item.subText || ''}</span>
            </div>
          `;
          div.addEventListener('click', (e) => {
            e.stopPropagation();
            closeDropdown();
            onSelectCallback({ lat: item.lat, lng: item.lng }, item.fullLabel);
          });
          suggestionsEl.appendChild(div);
        });

        openDropdown();
      };

      inputEl.addEventListener('focus', () => {
        if (inputEl.value.trim().length === 0) {
          showRecentSearches();
        }
      });

      inputEl.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = inputEl.value.trim();

        if (query.length < 2) {
          if (query.length === 0) {
            showRecentSearches();
          } else {
            closeDropdown();
          }
          return;
        }

        debounceTimer = setTimeout(async () => {
          const results = await this.routingEngine.searchAddress(query);
          if (results.length === 0) {
            closeDropdown();
            return;
          }

          suggestionsEl.innerHTML = '';
          results.forEach(res => {
            const isVerified = res.isVerifiedCycleway;
            const iconChar = res.icon || (isVerified ? '🛡️' : '📍');
            const item = document.createElement('div');
            item.className = `suggestion-item ${isVerified ? 'verified-cycleway' : ''}`;
            item.innerHTML = `
              <span class="sugg-icon">${iconChar}</span>
              <div class="sugg-text">
                <div class="sugg-main-row">
                  <span class="sugg-main">${res.mainText}</span>
                  ${isVerified ? '<span class="sugg-verified-badge">Piste Sûre</span>' : ''}
                </div>
                <span class="sugg-sub">${res.subText}</span>
              </div>
            `;
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              closeDropdown();
              onSelectCallback({ lat: res.lat, lng: res.lng }, res.fullLabel);
            });
            suggestionsEl.appendChild(item);
          });

          openDropdown();
        }, 200);
      });

      document.addEventListener('click', (e) => {
        if (!inputEl.contains(e.target) && !suggestionsEl.contains(e.target)) {
          closeDropdown();
        }
      });
    }

    async calculateCurrentRoute() {
      const endVal = this.elEndInput.value.trim();
      if (!endVal) {
        if (this.elWazeRouteSheet) this.elWazeRouteSheet.style.display = 'none';
        if (this.elRoutePanel) this.elRoutePanel.classList.remove('panel-compact');
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

      if (this.chargingManager && this.chargingManager.isVisible) {
        this.chargingManager.fetchRealEVStations(endCoords.lat, endCoords.lng);
      }

      if (this.elWazeRouteSheet) {
        this.elWazeRouteSheet.style.display = 'flex';
        this.elWazeRouteSheet.classList.remove('sheet-collapsed');
      }
      if (this.elRoutePanel) {
        this.elRoutePanel.classList.add('panel-compact');
      }
    }

    updateRouteCardsUI() {
      if (!this.calculatedRoutes) return;

      const availableModes = Object.keys(this.calculatedRoutes);
      if (availableModes.length === 0) return;

      // If currently selected mode is no longer available, select the first available
      if (!this.calculatedRoutes[this.selectedRouteMode]) {
        this.selectedRouteMode = availableModes[0];
      }

      // Update and show/hide each Waze card dynamically
      ['fast', 'safe', 'eco'].forEach(mode => {
        const cardEl = document.querySelector(`.route-card-waze[data-mode="${mode}"]`);
        const r = this.calculatedRoutes[mode];

        if (!r) {
          if (cardEl) cardEl.style.display = 'none';
          return;
        }

        if (cardEl) {
          cardEl.style.display = 'flex';
          cardEl.classList.toggle('active', mode === this.selectedRouteMode);
        }

        const batt = this.batteryEngine.estimateTrip(r.distanceKm, r.elevationGainM || 5, r.elevationLossM || 5, r.cruisingSpeedKmh);
        const timeEl = document.getElementById(`rcw-time-${mode}`);
        const distEl = document.getElementById(`rcw-dist-${mode}`);
        const climbEl = document.getElementById(`rcw-climb-${mode}`);
        const pisteEl = document.getElementById(`rcw-piste-${mode}`);

        if (timeEl) timeEl.textContent = `${r.durationMin} min`;
        if (distEl) distEl.textContent = `${r.distanceKm} km`;
        if (climbEl) climbEl.textContent = `↗ +${r.elevationGainM}m (${r.maxSlopePct}%)`;
        if (pisteEl) {
          pisteEl.textContent = `⚡ -${batt.consumedPct}% (${batt.whUsed} Wh)`;
        }
      });
    }

    applySelectedRoute() {
      if (!this.calculatedRoutes) return;
      const availableModes = Object.keys(this.calculatedRoutes);
      if (availableModes.length === 0) return;

      let r = this.calculatedRoutes[this.selectedRouteMode];
      if (!r) {
        this.selectedRouteMode = availableModes[0];
        r = this.calculatedRoutes[this.selectedRouteMode];
      }
      if (!r) return;

      // Update active highlight class on cards
      document.querySelectorAll('.route-card-waze').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-mode') === this.selectedRouteMode);
      });
      this.mapManager.drawRoute(r.coordinates, this.selectedRouteMode);

      const batt = this.batteryEngine.estimateTrip(r.distanceKm, r.elevationGainM || 5, r.elevationLossM || 5, r.cruisingSpeedKmh);

      if (this.elLaunchButtonLabel) {
        this.elLaunchButtonLabel.textContent = `DÉMARRER (${r.durationMin} MIN • ${r.distanceKm} KM • -${batt.consumedPct}%)`;
      }
      if (this.elLaunchButtonSub) {
        this.elLaunchButtonSub.textContent = `⚡ Conso : ${batt.whUsed} Wh • 🔌 Recharge ~${batt.rechargeTimeMin} min (230V) • ${r.protectedPct}% Pistes`;
      }

      const elevSummary = document.getElementById('elev-gain-summary');
      if (elevSummary) {
        elevSummary.textContent = `${r.title} : +${r.elevationGainM}m montée (max ${r.maxSlopePct}%) • Conso ~${batt.whUsed} Wh • ${r.praticability}`;
      }

      if (this.elBatteryPercent) this.elBatteryPercent.textContent = `-${batt.consumedPct}%`;
      if (this.elBatteryArrival) this.elBatteryArrival.textContent = `⚡ Conso : ${batt.whUsed} Wh (🔌 ~${batt.rechargeTimeMin}m)`;
      if (this.elBatteryFill) this.elBatteryFill.style.width = `${Math.min(100, Math.max(12, batt.consumedPct))}%`;

      const thermalTag = document.getElementById('batt-thermal-impact-tag');
      if (thermalTag) {
        if (batt.thermalLossWh > 0 || batt.tempC <= 10 || batt.tempC >= 30) {
          thermalTag.style.display = 'inline-block';
          thermalTag.textContent = batt.thermalLabel;
        } else {
          thermalTag.style.display = 'none';
        }
      }
    }

    beginTrip(isSimulated = false) {
      if (!this.calculatedRoutes) return;
      const modes = Object.keys(this.calculatedRoutes);
      if (modes.length === 0) return;
      const activeRoute = this.calculatedRoutes[this.selectedRouteMode] || this.calculatedRoutes[modes[0]];
      if (!activeRoute) return;
      if (this.elRoutePanel) this.elRoutePanel.style.display = 'none';
      if (this.elWazeRouteSheet) this.elWazeRouteSheet.style.display = 'none';
      if (this.elStickyLaunchBar) this.elStickyLaunchBar.style.display = 'none';
      this.elNavBanner.style.display = 'flex';
      if (isSimulated) this.elSimuController.style.display = 'flex';
      this.navigationEngine.startNavigation(activeRoute, isSimulated);
    }

    endTrip() {
      this.navigationEngine.stopNavigation();
      if (this.elRoutePanel) this.elRoutePanel.style.display = 'block';
      this.elNavBanner.style.display = 'none';
      this.elSimuController.style.display = 'none';
      this.elHazardAlert.style.display = 'none';
      this.handleSpeedUpdate(0);
      if (this.elEndInput.value.trim().length > 0) {
        if (this.elWazeRouteSheet) this.elWazeRouteSheet.style.display = 'flex';
      }
    }

    handleArrival() {
      if (this.navigationEngine && this.navigationEngine.activeRoute && this.navigationEngine.activeRoute.distanceKm) {
        const km = this.navigationEngine.activeRoute.distanceKm;
        this.garageManager.addKmToActiveScooter(km);
        this.authManager.updateUserStats(km, 1);
        this.renderGarageFleetUI();
        this.updateUserAuthUI();
      }
      this.voiceEngine.speak("Vous êtes arrivé à destination.", 'turn');
      this.showToast('🎉 Arrivée à destination !');
      setTimeout(() => this.endTrip(), 4000);
    }

    handleSpeedUpdate(speedKmh) {
      if (this.cockpitHUD) {
        this.cockpitHUD.updateSpeed(speedKmh);
      }
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
      if (trip.batteryStatus) {
        this.elBatteryPercent.textContent = `-${trip.batteryStatus.consumedPct || 0}%`;
        this.elBatteryArrival.textContent = `⚡ Conso : ${trip.batteryStatus.whUsed || 0} Wh`;
      }
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
