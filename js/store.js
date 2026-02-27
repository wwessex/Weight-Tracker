// Jab It Data Store - localStorage persistence layer
const Store = (() => {
  const KEYS = {
    PROFILE: 'shotsy_profile',
    WEIGHTS: 'shotsy_weights',
    JABS: 'shotsy_jabs',
    GOALS: 'shotsy_goals',
    SETTINGS: 'shotsy_settings',
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
    if (jabs.length > 0) {
      const lastJab = jabs[jabs.length - 1];
      const lastJabD = new Date(lastJab.date);
      nextJabDate = new Date(lastJabD);
      nextJabDate.setDate(nextJabDate.getDate() + 7);
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
      lastJabDate: jabs.length > 0 ? jabs[jabs.length - 1].date : null,
      nextJabDate,
      daysOnPlan,
      targetWeight,
      weightToGo,
      progressPercent,
      unit: settings.weightUnit,
    };
  }

  // Export data
  function exportData() {
    return JSON.stringify({
      profile: getProfile(),
      weights: getWeights(),
      jabs: getJabs(),
      goals: getGoals(),
      settings: getSettings(),
      exportDate: new Date().toISOString(),
    }, null, 2);
  }

  // Import data
  function importData(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.profile) saveProfile(data.profile);
      if (data.weights) saveWeights(data.weights);
      if (data.jabs) saveJabs(data.jabs);
      if (data.goals) saveGoals(data.goals);
      if (data.settings) saveSettings(data.settings);
      return true;
    } catch {
      return false;
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
    getGoals, saveGoals,
    getSettings, saveSettings,
    getStats, exportData, importData, clearAll,
  };
})();
