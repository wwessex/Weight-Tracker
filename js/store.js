// Jab It Data Store - localStorage persistence layer
const Store = (() => {
  const KEYS = {
    PROFILE: 'shotsy_profile',
    WEIGHTS: 'shotsy_weights',
    JABS: 'shotsy_jabs',
    GOALS: 'shotsy_goals',
    SETTINGS: 'shotsy_settings',
    VICTORIES: 'shotsy_victories',
    PHOTOS: 'shotsy_photos',
  };

  const defaults = {
    profile: {
      name: '',
      age: '',
      height: '',
      heightUnit: 'cm',
      startWeight: '',
      startDate: new Date().toISOString().split('T')[0],
      medication: 'semaglutide',
    },
    settings: {
      weightUnit: 'kg',
      theme: 'light',
      weeklyReminder: true,
      jabReminder: true,
      reminderDay: 'monday',
      weighInSchedule: 'weekly',
      doseReminderEnabled: false,
      weighInReminderEnabled: false,
      onboardingComplete: false,
    },
    goals: {
      targetWeight: '',
      weeklyTarget: 0.5,
      targetDate: '',
    },
  };

  function get(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  // Profile
  function getProfile() {
    return get(KEYS.PROFILE) || { ...defaults.profile };
  }
  function saveProfile(profile) {
    return set(KEYS.PROFILE, profile);
  }

  // Weight entries: [{ id, date, weight, note }]
  function getWeights() {
    return get(KEYS.WEIGHTS) || [];
  }
  function saveWeights(weights) {
    return set(KEYS.WEIGHTS, weights);
  }
  function addWeight(entry) {
    const weights = getWeights();
    entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    weights.push(entry);
    weights.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveWeights(weights);
    return entry;
  }
  function updateWeight(id, updates) {
    const weights = getWeights();
    const idx = weights.findIndex(w => w.id === id);
    if (idx !== -1) {
      weights[idx] = { ...weights[idx], ...updates };
      weights.sort((a, b) => new Date(a.date) - new Date(b.date));
      saveWeights(weights);
    }
    return weights;
  }
  function deleteWeight(id) {
    const weights = getWeights().filter(w => w.id !== id);
    saveWeights(weights);
    return weights;
  }

  // Jab entries: [{ id, date, time, medication, dose, doseUnit, site, sideEffects, notes }]
  function getJabs() {
    return get(KEYS.JABS) || [];
  }
  function saveJabs(jabs) {
    return set(KEYS.JABS, jabs);
  }
  function addJab(entry) {
    const jabs = getJabs();
    entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    jabs.push(entry);
    jabs.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveJabs(jabs);
    return entry;
  }
  function updateJab(id, updates) {
    const jabs = getJabs();
    const idx = jabs.findIndex(j => j.id === id);
    if (idx !== -1) {
      jabs[idx] = { ...jabs[idx], ...updates };
      jabs.sort((a, b) => new Date(a.date) - new Date(b.date));
      saveJabs(jabs);
    }
    return jabs;
  }
  function deleteJab(id) {
    const jabs = getJabs().filter(j => j.id !== id);
    saveJabs(jabs);
    return jabs;
  }

  // Non-scale victories: [{ id, date, text, category }]
  function getVictories() {
    return get(KEYS.VICTORIES) || [];
  }
  function saveVictories(victories) {
    return set(KEYS.VICTORIES, victories);
  }
  function addVictory(entry) {
    const victories = getVictories();
    entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    victories.push(entry);
    victories.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveVictories(victories);
    return entry;
  }
  function deleteVictory(id) {
    const victories = getVictories().filter(v => v.id !== id);
    saveVictories(victories);
    return victories;
  }

  // Progress photos: [{ id, date, note, dataUrl }]
  function getPhotos() {
    return get(KEYS.PHOTOS) || [];
  }
  function savePhotos(photos) {
    return set(KEYS.PHOTOS, photos);
  }
  function addPhoto(entry) {
    const photos = getPhotos();
    entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    photos.push(entry);
    photos.sort((a, b) => new Date(a.date) - new Date(b.date));
    savePhotos(photos);
    return entry;
  }
  function deletePhoto(id) {
    const photos = getPhotos().filter(p => p.id !== id);
    savePhotos(photos);
    return photos;
  }

  // Goals
  function getGoals() {
    return get(KEYS.GOALS) || { ...defaults.goals };
  }
  function saveGoals(goals) {
    return set(KEYS.GOALS, goals);
  }

  // Settings
  function getSettings() {
    return get(KEYS.SETTINGS) || { ...defaults.settings };
  }
  function saveSettings(settings) {
    return set(KEYS.SETTINGS, settings);
  }

  // Unit conversion helper
  function convertWeight(value, fromUnit, toUnit) {
    if (fromUnit === toUnit || !value) return value;
    const v = parseFloat(value);
    if (isNaN(v)) return value;
    // Convert to kg first
    let kg;
    if (fromUnit === 'kg') kg = v;
    else if (fromUnit === 'lbs') kg = v * 0.453592;
    else if (fromUnit === 'st') kg = v * 6.35029;
    else return value;
    // Convert from kg to target
    if (toUnit === 'kg') return Math.round(kg * 10) / 10;
    if (toUnit === 'lbs') return Math.round(kg / 0.453592 * 10) / 10;
    if (toUnit === 'st') return Math.round(kg / 6.35029 * 100) / 100;
    return value;
  }

  // Convert all historical weights when unit changes
  function convertAllWeights(fromUnit, toUnit) {
    if (fromUnit === toUnit) return;
    const weights = getWeights();
    weights.forEach(w => {
      w.weight = convertWeight(w.weight, fromUnit, toUnit);
    });
    saveWeights(weights);
    // Convert profile start weight
    const profile = getProfile();
    if (profile.startWeight) {
      profile.startWeight = convertWeight(profile.startWeight, fromUnit, toUnit);
      saveProfile(profile);
    }
    // Convert goal weight
    const goals = getGoals();
    if (goals.targetWeight) {
      goals.targetWeight = convertWeight(goals.targetWeight, fromUnit, toUnit);
      saveGoals(goals);
    }
  }

  // Stats helpers
  function getStats() {
    const weights = getWeights();
    const profile = getProfile();
    const goals = getGoals();
    const jabs = getJabs();
    const settings = getSettings();

    if (weights.length === 0) {
      return {
        currentWeight: profile.startWeight || null,
        startWeight: profile.startWeight || null,
        totalLost: 0,
        bmi: null,
        weightChange7d: 0,
        weightChange30d: 0,
        avgWeeklyLoss: 0,
        streak: 0,
        totalEntries: 0,
        totalJabs: jabs.length,
        lastJabDate: jabs.length > 0 ? jabs[jabs.length - 1].date : null,
        lastJabTime: jabs.length > 0 ? jabs[jabs.length - 1].time : null,
        nextJabDate: null,
        daysOnPlan: 0,
        targetWeight: goals.targetWeight || null,
        weightToGo: null,
        progressPercent: 0,
        unit: settings.weightUnit,
      };
    }

    const current = weights[weights.length - 1];
    const start = profile.startWeight ? parseFloat(profile.startWeight) : parseFloat(weights[0].weight);
    const currentW = parseFloat(current.weight);
    const totalLost = start - currentW;

    // BMI calculation (height in cm)
    let bmi = null;
    if (profile.height) {
      let heightM = parseFloat(profile.height) / 100;
      if (profile.heightUnit === 'ft') {
        heightM = parseFloat(profile.height) * 0.3048;
      }
      let weightKg = currentW;
      if (settings.weightUnit === 'lbs') {
        weightKg = currentW * 0.453592;
      } else if (settings.weightUnit === 'st') {
        weightKg = currentW * 6.35029;
      }
      bmi = weightKg / (heightM * heightM);
    }

    // Changes over time
    const now = new Date();
    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 7);
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);

    const weight7dAgo = weights.filter(w => new Date(w.date) <= d7).pop();
    const weight30dAgo = weights.filter(w => new Date(w.date) <= d30).pop();

    const weightChange7d = weight7dAgo ? currentW - parseFloat(weight7dAgo.weight) : 0;
    const weightChange30d = weight30dAgo ? currentW - parseFloat(weight30dAgo.weight) : 0;

    // Average weekly loss
    const daysDiff = (new Date(current.date) - new Date(weights[0].date)) / (1000 * 60 * 60 * 24);
    const weeks = daysDiff / 7;
    const avgWeeklyLoss = weeks > 0 ? totalLost / weeks : 0;

    // Streak: consecutive weeks with weight entries
    let streak = 0;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let checkDate = new Date();
    for (let i = 0; i < 52; i++) {
      const weekStart = new Date(checkDate - weekMs);
      const hasEntry = weights.some(w => {
        const d = new Date(w.date);
        return d >= weekStart && d <= checkDate;
      });
      if (hasEntry) {
        streak++;
        checkDate = weekStart;
      } else break;
    }

    // Days on plan
    const startDate = profile.startDate || weights[0].date;
    const daysOnPlan = Math.floor((now - new Date(startDate)) / (1000 * 60 * 60 * 24));

    // Progress toward goal
    const targetWeight = goals.targetWeight ? parseFloat(goals.targetWeight) : null;
    const weightToGo = targetWeight ? currentW - targetWeight : null;
    const totalToLose = targetWeight ? start - targetWeight : null;
    const progressPercent = totalToLose && totalToLose > 0 ? Math.min(100, Math.max(0, (totalLost / totalToLose) * 100)) : 0;

    // Next jab date
    let nextJabDate = null;
    const lastJab = jabs.length > 0 ? jabs[jabs.length - 1] : null;
    if (lastJab) {
      const freq = profile.frequency || 'weekly';
      const freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
      const days = freqDays[freq] || 7;
      const lastJabD = new Date(lastJab.date);
      nextJabDate = new Date(lastJabD);
      nextJabDate.setDate(nextJabDate.getDate() + days);
      nextJabDate = nextJabDate.toISOString().split('T')[0];
    }

    return {
      currentWeight: currentW,
      startWeight: start,
      totalLost,
      bmi,
      weightChange7d,
      weightChange30d,
      avgWeeklyLoss,
      streak,
      totalEntries: weights.length,
      totalJabs: jabs.length,
      lastJabDate: lastJab ? lastJab.date : null,
      lastJabTime: lastJab ? lastJab.time : null,
      nextJabDate,
      daysOnPlan,
      targetWeight,
      weightToGo,
      progressPercent,
      unit: settings.weightUnit,
      frequency: profile.frequency || 'weekly',
    };
  }

  // Enhanced streak data
  function getStreakData() {
    const weights = getWeights();
    const jabs = getJabs();
    const settings = getSettings();
    const profile = getProfile();
    const freq = profile.frequency || 'weekly';

    // Weight streak: consecutive weeks with a weigh-in
    let weightStreak = 0;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let checkDate = new Date();
    for (let i = 0; i < 52; i++) {
      const weekStart = new Date(checkDate - weekMs);
      const hasEntry = weights.some(w => {
        const d = new Date(w.date);
        return d >= weekStart && d <= checkDate;
      });
      if (hasEntry) {
        weightStreak++;
        checkDate = weekStart;
      } else break;
    }

    // Dose streak: consecutive dose periods on time
    let doseStreak = 0;
    const freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
    const periodDays = freqDays[freq] || 7;
    const periodMs = periodDays * 24 * 60 * 60 * 1000;
    checkDate = new Date();
    for (let i = 0; i < 52; i++) {
      const periodStart = new Date(checkDate - periodMs);
      const hasJab = jabs.some(j => {
        const d = new Date(j.date);
        return d >= periodStart && d <= checkDate;
      });
      if (hasJab) {
        doseStreak++;
        checkDate = periodStart;
      } else break;
    }

    return {
      weightStreak,
      doseStreak,
      combinedStreak: Math.min(weightStreak, doseStreak),
    };
  }

  // Milestone badges
  function getMilestones() {
    const stats = getStats();
    const milestones = [];

    if (!stats.startWeight || !stats.currentWeight) return milestones;

    const totalLostKg = stats.totalLost;
    const unit = stats.unit;
    const lostLbs = unit === 'lbs' ? totalLostKg : (unit === 'st' ? totalLostKg * 14 : totalLostKg * 2.20462);
    const lostInUnit = totalLostKg;
    const pctLost = stats.startWeight > 0 ? (totalLostKg / stats.startWeight) * 100 : 0;

    // First 5 lbs / 2.3 kg / 0.36 st
    const first5Threshold = unit === 'lbs' ? 5 : (unit === 'st' ? 0.36 : 2.3);
    if (lostInUnit >= first5Threshold) {
      milestones.push({ key: 'first5', label: unit === 'lbs' ? 'First 5 lbs lost!' : (unit === 'st' ? 'First 0.5 st lost!' : 'First 2 kg lost!'), icon: '5' });
    }

    // 10% body weight
    if (pctLost >= 10) {
      milestones.push({ key: 'pct10', label: '10% body weight lost!', icon: '10%' });
    }

    // Halfway to goal
    if (stats.progressPercent >= 50) {
      milestones.push({ key: 'halfway', label: 'Halfway to goal!', icon: '50%' });
    }

    // 10+ doses
    if (stats.totalJabs >= 10) {
      milestones.push({ key: '10doses', label: '10 doses logged!', icon: '10' });
    }

    // 30 days on plan
    if (stats.daysOnPlan >= 30) {
      milestones.push({ key: '30days', label: '30 days strong!', icon: '30d' });
    }

    // Goal reached
    if (stats.targetWeight && stats.currentWeight <= stats.targetWeight) {
      milestones.push({ key: 'goal', label: 'Goal reached!', icon: 'G' });
    }

    return milestones;
  }

  // Projected goal date
  function getProjectedGoalDate() {
    const stats = getStats();
    if (!stats.targetWeight || !stats.avgWeeklyLoss || stats.avgWeeklyLoss <= 0) return null;
    if (stats.weightToGo <= 0) return null;
    const weeksToGo = stats.weightToGo / stats.avgWeeklyLoss;
    const projected = new Date();
    projected.setDate(projected.getDate() + Math.round(weeksToGo * 7));
    return projected.toISOString().split('T')[0];
  }

  // Side effect trends
  function getSideEffectTrends() {
    const jabs = getJabs();
    const effectCounts = {};
    const monthlyEffects = {};

    jabs.forEach(j => {
      if (!j.sideEffects || j.sideEffects.length === 0) return;
      const month = j.date.substring(0, 7);
      if (!monthlyEffects[month]) monthlyEffects[month] = {};
      j.sideEffects.forEach(se => {
        if (se === 'none') return;
        effectCounts[se] = (effectCounts[se] || 0) + 1;
        monthlyEffects[month][se] = (monthlyEffects[month][se] || 0) + 1;
      });
    });

    return { effectCounts, monthlyEffects, totalDoses: jabs.length };
  }

  // Dose escalation log
  function getDoseEscalations() {
    const jabs = getJabs();
    if (jabs.length < 2) return [];
    const escalations = [];
    for (let i = 1; i < jabs.length; i++) {
      const prev = parseFloat(jabs[i - 1].dose);
      const curr = parseFloat(jabs[i].dose);
      if (curr !== prev && jabs[i].medication === jabs[i - 1].medication) {
        escalations.push({
          date: jabs[i].date,
          fromDose: prev,
          toDose: curr,
          medication: jabs[i].medication,
          unit: jabs[i].doseUnit || 'mg',
          direction: curr > prev ? 'up' : 'down',
        });
      }
    }
    return escalations;
  }

  // Moving average calculation (windowDays default 28 = 4 weeks)
  function getMovingAverage(windowDays) {
    windowDays = windowDays || 28;
    const weights = getWeights();
    if (weights.length < 2) return [];
    const result = [];
    for (let i = 0; i < weights.length; i++) {
      const endDate = new Date(weights[i].date);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - windowDays);
      const windowWeights = weights.filter(w => {
        const d = new Date(w.date);
        return d >= startDate && d <= endDate;
      });
      const avg = windowWeights.reduce((sum, w) => sum + parseFloat(w.weight), 0) / windowWeights.length;
      result.push({ date: weights[i].date, avg: Math.round(avg * 10) / 10 });
    }
    return result;
  }

  // Rate of loss for a period
  function getRateOfLoss(periodDays) {
    const weights = getWeights();
    if (weights.length < 2) return null;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - (periodDays || 30));
    const periodWeights = weights.filter(w => new Date(w.date) >= cutoff);
    if (periodWeights.length < 2) return null;
    const first = parseFloat(periodWeights[0].weight);
    const last = parseFloat(periodWeights[periodWeights.length - 1].weight);
    const days = (new Date(periodWeights[periodWeights.length - 1].date) - new Date(periodWeights[0].date)) / (1000 * 60 * 60 * 24);
    if (days === 0) return null;
    const weeklyRate = ((first - last) / days) * 7;
    return Math.round(weeklyRate * 10) / 10;
  }

  // Injection site rotation recommendation
  function getNextRecommendedSite() {
    const jabs = getJabs();
    const allSites = ['abdomen-left', 'abdomen-right', 'thigh-left', 'thigh-right', 'arm-left', 'arm-right'];
    if (jabs.length === 0) return { recommended: 'abdomen-left', lastSite: null, siteHistory: {} };

    // Count recent site usage (last 6 doses)
    const recentJabs = jabs.slice(-6);
    const siteHistory = {};
    allSites.forEach(s => siteHistory[s] = 0);
    recentJabs.forEach(j => {
      if (j.site && siteHistory[j.site] !== undefined) {
        siteHistory[j.site]++;
      }
    });

    const lastSite = jabs[jabs.length - 1].site || null;

    // Recommend least recently used site
    let minCount = Infinity;
    let recommended = allSites[0];
    allSites.forEach(s => {
      if (siteHistory[s] < minCount) {
        minCount = siteHistory[s];
        recommended = s;
      }
    });

    return { recommended, lastSite, siteHistory };
  }

  // Export data
  function exportData() {
    return JSON.stringify({
      profile: getProfile(),
      weights: getWeights(),
      jabs: getJabs(),
      goals: getGoals(),
      settings: getSettings(),
      victories: getVictories(),
      photos: getPhotos(),
      exportDate: new Date().toISOString(),
    }, null, 2);
  }

  // Export CSV with weight + dose data
  function exportCSV() {
    const weights = getWeights();
    const jabs = getJabs();
    const settings = getSettings();

    let csv = 'Type,Date,Weight (' + settings.weightUnit + '),Note,Medication,Dose,Dose Unit,Site,Side Effects\n';

    // Merge weights and jabs by date
    const allEntries = [];
    weights.forEach(w => allEntries.push({ type: 'weight', date: w.date, data: w }));
    jabs.forEach(j => allEntries.push({ type: 'dose', date: j.date, data: j }));
    allEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    allEntries.forEach(e => {
      if (e.type === 'weight') {
        const w = e.data;
        const note = (w.note || '').replace(/"/g, '""');
        csv += 'Weight,' + w.date + ',' + w.weight + ',"' + note + '",,,,\n';
      } else {
        const j = e.data;
        const notes = (j.notes || '').replace(/"/g, '""');
        const effects = (j.sideEffects || []).join('; ');
        csv += 'Dose,' + j.date + ',,"' + notes + '",' + (j.medication || '') + ',' + (j.dose || '') + ',' + (j.doseUnit || '') + ',' + (j.site || '') + ',"' + effects + '"\n';
      }
    });

    return csv;
  }

  // Import data
  function importData(jsonStr) {
    const result = { success: false, warnings: 0 };

    function isPlainObject(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function toNumber(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    }

    function toDateString(value) {
      if (typeof value !== 'string' && !(value instanceof Date)) return null;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString().split('T')[0];
    }

    function toStringOrEmpty(value) {
      if (value === undefined || value === null) return '';
      return String(value);
    }

    function sanitizeWeights(weights) {
      return weights.map(entry => {
        if (!isPlainObject(entry)) {
          result.warnings++;
          return null;
        }
        const date = toDateString(entry.date);
        const weight = toNumber(entry.weight);
        if (!date || weight === null) {
          result.warnings++;
          return null;
        }
        return {
          id: toStringOrEmpty(entry.id) || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          date,
          weight,
          note: toStringOrEmpty(entry.note),
        };
      }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    function sanitizeJabs(jabs) {
      return jabs.map(entry => {
        if (!isPlainObject(entry)) {
          result.warnings++;
          return null;
        }
        const date = toDateString(entry.date);
        const dose = toNumber(entry.dose);
        if (!date || dose === null) {
          result.warnings++;
          return null;
        }
        const sideEffects = Array.isArray(entry.sideEffects)
          ? entry.sideEffects.map(toStringOrEmpty).filter(Boolean)
          : [];
        return {
          id: toStringOrEmpty(entry.id) || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          date,
          time: toStringOrEmpty(entry.time),
          medication: toStringOrEmpty(entry.medication),
          dose,
          doseUnit: toStringOrEmpty(entry.doseUnit || 'mg'),
          site: toStringOrEmpty(entry.site),
          sideEffects,
          notes: toStringOrEmpty(entry.notes),
        };
      }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    function sanitizeVictories(victories) {
      return victories.map(entry => {
        if (!isPlainObject(entry)) {
          result.warnings++;
          return null;
        }
        const date = toDateString(entry.date);
        const text = toStringOrEmpty(entry.text).trim();
        if (!date || !text) {
          result.warnings++;
          return null;
        }
        return {
          id: toStringOrEmpty(entry.id) || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          date,
          text,
          category: toStringOrEmpty(entry.category),
        };
      }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    function sanitizePhotos(photos) {
      return photos.map(entry => {
        if (!isPlainObject(entry)) {
          result.warnings++;
          return null;
        }
        const date = toDateString(entry.date);
        const dataUrl = toStringOrEmpty(entry.dataUrl);
        if (!date || !dataUrl) {
          result.warnings++;
          return null;
        }
        return {
          id: toStringOrEmpty(entry.id) || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          date,
          note: toStringOrEmpty(entry.note),
          dataUrl,
        };
      }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    try {
      const data = JSON.parse(jsonStr);

      if (!isPlainObject(data)) return result;

      // Objects
      if (data.profile === undefined) {
        saveProfile({ ...defaults.profile });
      } else if (!isPlainObject(data.profile)) {
        result.warnings++;
      } else {
        const mergedProfile = {
          ...defaults.profile,
          ...data.profile,
        };
        const startDate = toDateString(mergedProfile.startDate);
        const age = toNumber(mergedProfile.age);
        const height = toNumber(mergedProfile.height);
        const startWeight = toNumber(mergedProfile.startWeight);

        mergedProfile.name = toStringOrEmpty(mergedProfile.name);
        mergedProfile.age = age === null ? '' : age;
        mergedProfile.height = height === null ? '' : height;
        mergedProfile.heightUnit = toStringOrEmpty(mergedProfile.heightUnit || defaults.profile.heightUnit);
        mergedProfile.startWeight = startWeight === null ? '' : startWeight;
        mergedProfile.startDate = startDate || defaults.profile.startDate;
        mergedProfile.medication = toStringOrEmpty(mergedProfile.medication || defaults.profile.medication);

        saveProfile(mergedProfile);
      }

      if (data.goals === undefined) {
        saveGoals({ ...defaults.goals });
      } else if (!isPlainObject(data.goals)) {
        result.warnings++;
      } else {
        const mergedGoals = {
          ...defaults.goals,
          ...data.goals,
        };
        const targetWeight = toNumber(mergedGoals.targetWeight);
        const weeklyTarget = toNumber(mergedGoals.weeklyTarget);
        const targetDate = toDateString(mergedGoals.targetDate);

        mergedGoals.targetWeight = targetWeight === null ? '' : targetWeight;
        mergedGoals.weeklyTarget = weeklyTarget === null ? defaults.goals.weeklyTarget : weeklyTarget;
        mergedGoals.targetDate = targetDate || '';

        saveGoals(mergedGoals);
      }

      if (data.settings === undefined) {
        saveSettings({ ...defaults.settings });
      } else if (!isPlainObject(data.settings)) {
        result.warnings++;
      } else {
        const mergedSettings = {
          ...defaults.settings,
          ...data.settings,
        };
        saveSettings(mergedSettings);
      }

      // Arrays
      if (data.weights === undefined) {
        saveWeights([]);
      } else if (!Array.isArray(data.weights)) {
        result.warnings++;
      } else {
        saveWeights(sanitizeWeights(data.weights));
      }

      if (data.jabs === undefined) {
        saveJabs([]);
      } else if (!Array.isArray(data.jabs)) {
        result.warnings++;
      } else {
        saveJabs(sanitizeJabs(data.jabs));
      }

      if (data.victories === undefined) {
        saveVictories([]);
      } else if (!Array.isArray(data.victories)) {
        result.warnings++;
      } else {
        saveVictories(sanitizeVictories(data.victories));
      }

      if (data.photos === undefined) {
        savePhotos([]);
      } else if (!Array.isArray(data.photos)) {
        result.warnings++;
      } else {
        savePhotos(sanitizePhotos(data.photos));
      }

      result.success = true;
      return result;
    } catch {
      return result;
    }
  }

  // Generate shareable backup link
  function generateBackupLink() {
    const data = exportData();
    try {
      const encoded = btoa(unescape(encodeURIComponent(data)));
      return encoded;
    } catch {
      return null;
    }
  }

  // Import from backup link
  function importFromBackupLink(encoded) {
    const failure = { success: false, warnings: 0 };
    try {
      const json = decodeURIComponent(escape(atob(encoded)));
      return importData(json);
    } catch {
      return failure;
    }
  }

  // Clear all data
  function clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  }

  return {
    getProfile, saveProfile,
    getWeights, saveWeights, addWeight, updateWeight, deleteWeight,
    getJabs, saveJabs, addJab, updateJab, deleteJab,
    getVictories, saveVictories, addVictory, deleteVictory,
    getPhotos, savePhotos, addPhoto, deletePhoto,
    getGoals, saveGoals,
    getSettings, saveSettings,
    getStats, getStreakData, getMilestones, getProjectedGoalDate,
    getSideEffectTrends, getDoseEscalations,
    getMovingAverage, getRateOfLoss, getNextRecommendedSite,
    convertWeight, convertAllWeights,
    exportData, exportCSV, importData,
    generateBackupLink, importFromBackupLink,
    clearAll,
  };
})();
