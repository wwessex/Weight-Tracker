// Jab It Data Store - localStorage persistence layer
/**
 * @typedef {{ name: string, age: string, height: string, heightUnit: string, startWeight: string, startDate: string, medication: string, dosage: string, doseUnit: string, frequency: string }} Profile
 * @typedef {{ id: string, date: string, weight: number, note: string }} WeightEntry
 * @typedef {{ id: string, date: string, time: string, medication: string, dose: number, doseUnit: string, site: string, sideEffects: string[], notes: string }} JabEntry
 * @typedef {{ targetWeight: number, weeklyTarget: number, targetDate: string }} Goals
 * @typedef {{ weightUnit: string, theme: string, weeklyReminder: boolean, jabReminder: boolean, reminderDay: string }} Settings
 */
const Store = (() => {
  const KEYS = {
    PROFILE: 'shotsy_profile',
    WEIGHTS: 'shotsy_weights',
    JABS: 'shotsy_jabs',
    GOALS: 'shotsy_goals',
    SETTINGS: 'shotsy_settings',
    VICTORIES: 'shotsy_victories',
    PHOTOS: 'shotsy_photos',
    PHOTOS_MIGRATED: 'shotsy_photos_migrated_v1',
    MEASUREMENTS: 'shotsy_measurements',
    JOURNAL: 'shotsy_journal',
    FASTS: 'shotsy_fasts',
    EXERCISES: 'shotsy_exercises',
  };

  const PHOTO_DB = {
    NAME: 'shotsy_photo_db',
    VERSION: 2,
    STORE: 'photos',
  };

  let photoDbPromise = null;
  let photoMigrationPromise = null;

  // Stats cache — invalidated on any data mutation
  let _cacheVersion = 0;
  let _statsCache = null;
  let _statsCacheVersion = -1;
  let _movingAvgCache = {};
  let _movingAvgCacheVersion = -1;

  function _invalidateCache() {
    _cacheVersion++;
  }

  const defaults = {
    profile: {
      name: '',
      age: '',
      height: '',
      heightUnit: 'cm',
      startWeight: '',
      startDate: formatLocalDate(new Date()),
      medication: 'semaglutide',
      dosage: '',
      doseUnit: 'mg',
      frequency: 'weekly',
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
      firstRunChecklistComplete: false,
      firstRunChecklistDismissed: false,
      lastReminderCheckAt: null,
    },
    goals: {
      targetWeight: '',
      weeklyTarget: 0.5,
      targetDate: '',
    },
  };

  const SAFE_BACKUP_LINK_CHARS = 12000;
  const ENCRYPTED_BACKUP_TYPE = 'jabit-encrypted-backup';
  const ENCRYPTED_BACKUP_VERSION = 1;
  const ENCRYPTION_ITERATIONS = 250000;

  function parseLocalDate(value) {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnlyMatch) {
        const year = parseInt(dateOnlyMatch[1], 10);
        const monthIndex = parseInt(dateOnlyMatch[2], 10) - 1;
        const day = parseInt(dateOnlyMatch[3], 10);
        const parsed = new Date(year, monthIndex, day);
        if (parsed.getFullYear() === year && parsed.getMonth() === monthIndex && parsed.getDate() === day) {
          return parsed;
        }
        return null;
      }
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) return null;
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
    return null;
  }

  function formatLocalDate(value) {
    const date = parseLocalDate(value);
    if (!date) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseTimeParts(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Accept HH:mm, HH:mm:ss, h.mmam/pm and h:mm am/pm variants from legacy imports.
    const timeMatch = trimmed.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]m)?$/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const meridiem = timeMatch[3] ? timeMatch[3].toLowerCase() : '';

    if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) return null;
    if (meridiem) {
      if (hours < 1 || hours > 12) return null;
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    }
    if (hours < 0 || hours > 23) return null;

    return {
      hours,
      minutes,
      normalized: String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0'),
    };
  }

  function warnInvalidDate(context, dateValue) {
    console.warn(`[Store] Skipping ${context} with invalid date:`, dateValue);
  }

  function sortByLocalDate(a, b) {
    const aDate = parseLocalDate(a.date);
    const bDate = parseLocalDate(b.date);
    if (!aDate || !bDate) return 0;
    const dateDiff = aDate - bDate;
    if (dateDiff !== 0) return dateDiff;
    // Same date: sort by time if available (entries with time come after entries without)
    const aTime = a.time || '';
    const bTime = b.time || '';
    if (!aTime && !bTime) return 0;
    if (!aTime) return -1;
    if (!bTime) return 1;
    return aTime.localeCompare(bTime);
  }

  function withNormalizedLocalDates(records, context) {
    return records.map((record) => {
      const parsedDate = parseLocalDate(record.date);
      if (!parsedDate) {
        warnInvalidDate(context, record && record.date);
        return null;
      }
      return {
        ...record,
        _localDate: parsedDate,
      };
    }).filter(Boolean).sort((a, b) => a._localDate - b._localDate);
  }

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
      window.dispatchEvent(new CustomEvent('store-mutation', { detail: { key: key } }));
      return true;
    } catch {
      return false;
    }
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * Validates a date string is in YYYY-MM-DD format and represents a real date.
   * @param {string} dateStr
   * @returns {boolean}
   */
  function isValidDateString(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    var d = new Date(dateStr + 'T00:00:00');
    return !isNaN(d.getTime());
  }

  // Generic CRUD factory for localStorage-backed collections
  function createCollection(key, options) {
    const sortFn = (options && options.sortFn) || sortByLocalDate;
    const shouldInvalidate = !!(options && options.invalidateCache);
    const validateFn = (options && options.validate) || null;

    function getAll() { return (get(key) || []).sort(sortFn); }
    function saveAll(items) {
      if (shouldInvalidate) _invalidateCache();
      return set(key, items);
    }
    function add(entry) {
      if (validateFn) {
        var error = validateFn(entry);
        if (error) return { success: false, error: error };
      }
      const items = getAll();
      entry.id = generateId();
      items.push(entry);
      items.sort(sortFn);
      saveAll(items);
      return entry;
    }
    function update(id, updates) {
      const items = getAll();
      const idx = items.findIndex(item => item.id === id);
      if (idx !== -1) {
        items[idx] = { ...items[idx], ...updates };
        if (validateFn) {
          var error = validateFn(items[idx]);
          if (error) return { success: false, error: error };
        }
        items.sort(sortFn);
        saveAll(items);
      }
      return items;
    }
    function remove(id) {
      const items = getAll().filter(item => item.id !== id);
      saveAll(items);
      return items;
    }
    return { getAll, saveAll, add, update, remove };
  }

  function openPhotoDb() {
    if (photoDbPromise) return photoDbPromise;
    photoDbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = indexedDB.open(PHOTO_DB.NAME, PHOTO_DB.VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PHOTO_DB.STORE)) {
          db.createObjectStore(PHOTO_DB.STORE, { keyPath: 'id' });
        }
        // v2: existing records get thumbBlob/contentHash/syncedAt on first access
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open photo storage'));
    });
    return photoDbPromise;
  }

  function isQuotaError(error) {
    if (!error) return false;
    return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    if (parts.length < 2) throw new Error('Invalid image data');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Unable to read image blob'));
      reader.readAsDataURL(blob);
    });
  }

  function compressImage(blob, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error('Compression failed')),
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for compression'));
      };
      img.src = url;
    });
  }

  async function computeContentHash(blob) {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function withPhotoStore(mode, handler) {
    return openPhotoDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_DB.STORE, mode);
      const store = tx.objectStore(PHOTO_DB.STORE);
      let settled = false;

      function finish(fn, value) {
        if (settled) return;
        settled = true;
        fn(value);
      }

      tx.oncomplete = () => finish(resolve, undefined);
      tx.onerror = () => finish(reject, tx.error || new Error('Photo transaction failed'));
      tx.onabort = () => finish(reject, tx.error || new Error('Photo transaction aborted'));

      try {
        const maybePromise = handler(store, tx, resolve, reject, finish);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch((error) => finish(reject, error));
        }
      } catch (error) {
        finish(reject, error);
      }
    }));
  }

  async function migrateLegacyPhotos() {
    if (get(KEYS.PHOTOS_MIGRATED)) return;
    const legacyPhotos = get(KEYS.PHOTOS) || [];
    if (!Array.isArray(legacyPhotos) || legacyPhotos.length === 0) {
      set(KEYS.PHOTOS_MIGRATED, true);
      localStorage.removeItem(KEYS.PHOTOS);
      return;
    }

    for (const legacyPhoto of legacyPhotos) {
      if (!legacyPhoto || !legacyPhoto.dataUrl) continue;
      const record = {
        id: legacyPhoto.id || generateId(),
        date: legacyPhoto.date || formatLocalDate(new Date()),
        note: legacyPhoto.note || '',
        blob: dataUrlToBlob(legacyPhoto.dataUrl),
      };
      await withPhotoStore('readwrite', (store, tx, resolve, reject, finish) => {
        const req = store.put(record);
        req.onerror = () => finish(reject, req.error || new Error('Failed to migrate photo'));
      });
    }

    localStorage.removeItem(KEYS.PHOTOS);
    set(KEYS.PHOTOS_MIGRATED, true);
  }

  function ensurePhotoStorageReady() {
    if (photoMigrationPromise) return photoMigrationPromise;
    photoMigrationPromise = openPhotoDb().then(() => migrateLegacyPhotos());
    return photoMigrationPromise;
  }

  // Profile
  function getProfile() {
    const stored = get(KEYS.PROFILE);
    const profile = { ...defaults.profile, ...(stored || {}) };
    // Migrate: parse unit from legacy free-text dosage (e.g. "0.25 mg")
    if (profile.dosage && stored && !stored.doseUnit) {
      const m = String(profile.dosage).match(/^([\d.]+)\s*(mg|ml)$/i);
      if (m) {
        profile.dosage = m[1];
        profile.doseUnit = m[2].toLowerCase();
        set(KEYS.PROFILE, profile);
      }
    }
    return profile;
  }
  function saveProfile(profile) {
    _invalidateCache();
    return set(KEYS.PROFILE, profile);
  }

  // Entity collections via generic CRUD factory
  const weightCol = createCollection(KEYS.WEIGHTS, {
    invalidateCache: true,
    validate: function(entry) {
      var w = parseFloat(entry.weight);
      if (isNaN(w) || w <= 0 || w > 1500) return 'Weight must be between 0 and 1500';
      entry.weight = w; // ensure stored as number
      if (entry.date && !isValidDateString(entry.date)) return 'Invalid date format';
      return null;
    }
  });
  const getWeights = weightCol.getAll;
  const saveWeights = weightCol.saveAll;
  const addWeight = weightCol.add;
  const updateWeight = weightCol.update;
  const deleteWeight = weightCol.remove;

  const jabCol = createCollection(KEYS.JABS, {
    invalidateCache: true,
    validate: function(entry) {
      var d = parseFloat(entry.dose);
      if (isNaN(d) || d < 0 || d > 500) return 'Dose must be between 0 and 500';
      entry.dose = d; // ensure stored as number
      if (entry.date && !isValidDateString(entry.date)) return 'Invalid date format';
      return null;
    }
  });
  const getJabs = jabCol.getAll;
  const saveJabs = jabCol.saveAll;
  const addJab = jabCol.add;
  const updateJab = jabCol.update;
  const deleteJab = jabCol.remove;

  const victoryCol = createCollection(KEYS.VICTORIES);
  const getVictories = victoryCol.getAll;
  const saveVictories = victoryCol.saveAll;
  const addVictory = victoryCol.add;
  const deleteVictory = victoryCol.remove;

  const measurementCol = createCollection(KEYS.MEASUREMENTS, {
    invalidateCache: true,
    validate: function(entry) {
      var fields = ['waist', 'hips', 'chest', 'neck', 'armLeft', 'armRight', 'thighLeft', 'thighRight'];
      fields.forEach(function(f) {
        if (entry[f] != null && entry[f] !== '') {
          var v = parseFloat(entry[f]);
          entry[f] = isNaN(v) ? null : v;
        }
      });
      if (entry.date && !isValidDateString(entry.date)) return 'Invalid date format';
      return null;
    }
  });
  const getMeasurements = measurementCol.getAll;
  const saveMeasurements = measurementCol.saveAll;
  const addMeasurement = measurementCol.add;
  const updateMeasurement = measurementCol.update;
  const deleteMeasurement = measurementCol.remove;
  function getMeasurementStats() {
    const measurements = getMeasurements();
    if (measurements.length === 0) return null;
    const latest = measurements[measurements.length - 1];
    const first = measurements[0];
    const fields = ['waist', 'hips', 'chest', 'armLeft', 'armRight', 'thighLeft', 'thighRight', 'neck'];
    const changes = {};
    fields.forEach(f => {
      if (latest[f] && first[f]) {
        changes[f] = Math.round((parseFloat(latest[f]) - parseFloat(first[f])) * 10) / 10;
      }
    });
    return { latest, first, changes, total: measurements.length };
  }

  const journalCol = createCollection(KEYS.JOURNAL);
  const getJournal = journalCol.getAll;
  const saveJournal = journalCol.saveAll;
  const addJournalEntry = journalCol.add;
  const updateJournalEntry = journalCol.update;
  const deleteJournalEntry = journalCol.remove;
  function getMoodTrend(days) {
    const journal = withNormalizedLocalDates(getJournal(), 'journal mood trend');
    if (journal.length === 0) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days || 30));
    return journal
      .filter(j => j._localDate >= cutoff)
      .map(j => ({ date: j.date, mood: j.mood || null, energy: j.energy || null }));
  }

  const fastCol = createCollection(KEYS.FASTS, {
    sortFn: (a, b) => new Date(a.startTime) - new Date(b.startTime),
  });
  const getFasts = fastCol.getAll;
  const saveFasts = fastCol.saveAll;
  const addFast = fastCol.add;
  const deleteFast = fastCol.remove;
  function getActiveFast() {
    const settings = getSettings();
    return settings.activeFast || null;
  }
  function setActiveFast(fast) {
    const settings = getSettings();
    settings.activeFast = fast;
    saveSettings(settings);
  }
  function clearActiveFast() {
    const settings = getSettings();
    delete settings.activeFast;
    saveSettings(settings);
  }
  function getFastingStats() {
    const allFasts = getFasts();
    const fasts = allFasts.filter(f => f.completed);
    if (fasts.length === 0) return { totalFasts: 0, avgDuration: 0, longestFast: 0, completionRate: 0 };
    const durations = fasts.map(f => {
      if (!f.startTime || !f.endTime) return 0;
      return (new Date(f.endTime) - new Date(f.startTime)) / (1000 * 60 * 60);
    }).filter(d => d > 0);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length * 10) / 10 : 0;
    const longestFast = durations.length > 0 ? Math.round(Math.max(...durations) * 10) / 10 : 0;
    const completionRate = allFasts.length > 0 ? Math.round((fasts.length / allFasts.length) * 100) : 0;
    return { totalFasts: fasts.length, avgDuration, longestFast, completionRate };
  }

  const exerciseCol = createCollection(KEYS.EXERCISES);
  const getExercises = exerciseCol.getAll;
  const saveExercises = exerciseCol.saveAll;
  const addExercise = exerciseCol.add;
  const updateExercise = exerciseCol.update;
  const deleteExercise = exerciseCol.remove;
  function getExerciseStats(days) {
    const exercises = withNormalizedLocalDates(getExercises(), 'exercise stats');
    if (exercises.length === 0) return { totalMinutes: 0, sessions: 0, mostCommon: null, weeklyAvg: 0 };
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days || 30));
    const filtered = exercises.filter(e => e._localDate >= cutoff);
    if (filtered.length === 0) return { totalMinutes: 0, sessions: 0, mostCommon: null, weeklyAvg: 0 };
    const totalMinutes = filtered.reduce((sum, e) => sum + (parseFloat(e.duration) || 0), 0);
    const typeCounts = {};
    filtered.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
    const mostCommon = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
    const periodDays = (new Date() - cutoff) / (1000 * 60 * 60 * 24);
    const weeklyAvg = periodDays > 0 ? Math.round((filtered.length / periodDays) * 7 * 10) / 10 : 0;
    return { totalMinutes: Math.round(totalMinutes), sessions: filtered.length, mostCommon: mostCommon ? mostCommon[0] : null, weeklyAvg };
  }

  // Doctor visit report generator
  function generateDoctorReport() {
    const profile = getProfile();
    const stats = getStats();
    const settings = getSettings();
    const goals = getGoals();
    const weights = getWeights();
    const jabs = getJabs();
    const measurements = getMeasurements();
    const sideEffects = getSideEffectTrends();
    const escalations = getDoseEscalations();
    const rateOfLoss = getRateOfLoss(90);
    const exerciseStats = getExerciseStats(90);
    const moodTrend = getMoodTrend(90);
    const cutoff90 = new Date();
    cutoff90.setDate(cutoff90.getDate() - 90);
    const cutoffStr = formatLocalDate(cutoff90);
    const recentDoses = jabs.filter(j => j.date >= cutoffStr);

    // Medication adherence calculation
    const freq = profile.frequency || 'weekly';
    let expectedDoses = 0;
    const daysInPeriod = Math.min(stats.daysOnPlan || 0, 90);
    if (freq === 'daily') expectedDoses = daysInPeriod;
    else if (freq === 'weekly') expectedDoses = Math.round(daysInPeriod / 7);
    else if (freq === 'biweekly') expectedDoses = Math.round(daysInPeriod / 14);
    else if (freq === 'monthly') expectedDoses = Math.round(daysInPeriod / 30);
    else expectedDoses = Math.round(daysInPeriod / 7);
    const adherenceRate = expectedDoses > 0 ? Math.min(100, Math.round((recentDoses.length / expectedDoses) * 100)) : null;

    // Injection site distribution from recent doses
    const siteDistribution = {};
    recentDoses.forEach(d => {
      if (d.site) siteDistribution[d.site] = (siteDistribution[d.site] || 0) + 1;
    });

    // Measurement trends: earliest and latest in period
    const recentMeasurements = measurements.filter(m => m.date >= cutoffStr);
    const earliestMeasurement = recentMeasurements.length > 0 ? recentMeasurements[0] : null;
    const latestMeasurement = recentMeasurements.length > 0 ? recentMeasurements[recentMeasurements.length - 1] : (measurements.length > 0 ? measurements[measurements.length - 1] : null);

    // Mood/energy averages
    let moodAvg = null;
    let energyAvg = null;
    const moodEntries = moodTrend.filter(m => m.mood != null);
    const energyEntries = moodTrend.filter(m => m.energy != null);
    if (moodEntries.length > 0) moodAvg = Math.round(moodEntries.reduce((s, m) => s + m.mood, 0) / moodEntries.length * 10) / 10;
    if (energyEntries.length > 0) energyAvg = Math.round(energyEntries.reduce((s, m) => s + m.energy, 0) / energyEntries.length * 10) / 10;

    // Side effects monthly (last 3 months)
    const now = new Date();
    const recentMonths = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      recentMonths.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }

    return {
      patient: {
        name: profile.name,
        age: profile.age,
        height: profile.height,
        heightUnit: profile.heightUnit,
        medication: profile.medication,
        dosage: profile.dosage,
        frequency: profile.frequency,
        startDate: profile.startDate,
      },
      weightSummary: {
        startWeight: stats.startWeight,
        currentWeight: stats.currentWeight,
        totalLost: stats.totalLost ? Math.round(stats.totalLost * 10) / 10 : 0,
        bmi: stats.bmi ? Math.round(stats.bmi * 10) / 10 : null,
        rateOfLoss: rateOfLoss,
        weightChange7d: stats.weightChange7d ? Math.round(stats.weightChange7d * 10) / 10 : 0,
        weightChange30d: stats.weightChange30d ? Math.round(stats.weightChange30d * 10) / 10 : 0,
        avgWeeklyLoss: stats.avgWeeklyLoss ? Math.round(stats.avgWeeklyLoss * 10) / 10 : 0,
        unit: settings.weightUnit,
        targetWeight: goals.targetWeight,
        progressPercent: Math.round(stats.progressPercent),
        projectedGoalDate: getProjectedGoalDate(),
      },
      adherence: {
        expected: expectedDoses,
        actual: recentDoses.length,
        rate: adherenceRate,
      },
      recentWeights: weights.filter(w => w.date >= cutoffStr).slice(-20),
      recentDoses: recentDoses,
      sideEffects: sideEffects.effectCounts,
      monthlyEffects: sideEffects.monthlyEffects,
      recentMonths: recentMonths,
      doseEscalations: escalations,
      siteDistribution: siteDistribution,
      latestMeasurements: latestMeasurement,
      earliestMeasurements: earliestMeasurement,
      exerciseStats: exerciseStats,
      wellbeing: {
        moodAvg: moodAvg,
        energyAvg: energyAvg,
        entries: moodEntries.length,
      },
      reportDate: formatLocalDate(new Date()),
      daysOnPlan: stats.daysOnPlan,
    };
  }

  // Progress photos: [{ id, date, note, dataUrl }]
  async function getPhotos() {
    await ensurePhotoStorageReady();
    const records = await withPhotoStore('readonly', (store, tx, resolve, reject, finish) => {
      const req = store.getAll();
      req.onsuccess = () => finish(resolve, req.result || []);
      req.onerror = () => finish(reject, req.error || new Error('Unable to read photos'));
    });

    const photos = await Promise.all(records.map(async (p) => ({
      id: p.id,
      date: p.date,
      note: p.note || '',
      contentHash: p.contentHash || null,
      syncedAt: p.syncedAt || null,
      thumbDataUrl: p.thumbBlob ? await blobToDataUrl(p.thumbBlob) : '',
      dataUrl: p.blob ? await blobToDataUrl(p.blob) : '',
    })));

    return photos
      .filter(p => p.dataUrl)
      .sort(sortByLocalDate);
  }

  async function savePhotos(photos) {
    await ensurePhotoStorageReady();
    await withPhotoStore('readwrite', async (store, tx, resolve, reject, finish) => {
      store.clear();
      for (const photo of photos) {
        if (!photo || !photo.dataUrl) continue;
        const req = store.put({
          id: photo.id || generateId(),
          date: photo.date,
          note: photo.note || '',
          blob: dataUrlToBlob(photo.dataUrl),
        });
        req.onerror = () => finish(reject, req.error || new Error('Unable to save photos'));
      }
    });
    return true;
  }

  async function addPhoto(entry) {
    await ensurePhotoStorageReady();
    var rawBlob = entry.blob || (entry.dataUrl ? dataUrlToBlob(entry.dataUrl) : null);
    if (!rawBlob) throw new Error('Missing photo image data');

    // Always compress: full image (1200px, 80% quality) + thumbnail (200px, 60%)
    var fullBlob, thumbBlob, contentHash;
    try {
      fullBlob = await compressImage(rawBlob, 1200, 0.8);
      thumbBlob = await compressImage(rawBlob, 200, 0.6);
      contentHash = await computeContentHash(fullBlob);
    } catch (compressErr) {
      // Fallback: use raw blob if compression fails (e.g. SVG)
      fullBlob = rawBlob;
      thumbBlob = rawBlob;
      contentHash = null;
    }

    const photo = {
      id: entry.id || generateId(),
      date: entry.date,
      note: entry.note || '',
      blob: fullBlob,
      thumbBlob: thumbBlob,
      contentHash: contentHash,
      syncedAt: null,
    };

    try {
      await withPhotoStore('readwrite', (store, tx, resolve, reject, finish) => {
        const req = store.put(photo);
        req.onerror = () => finish(reject, req.error || new Error('Unable to save photo'));
      });
    } catch (error) {
      if (isQuotaError(error)) {
        const quotaError = new Error('Photo storage is full. Try a smaller image or remove old photos.');
        quotaError.code = 'QUOTA_EXCEEDED';
        throw quotaError;
      }
      throw error;
    }

    // Dispatch mutation event for sync
    window.dispatchEvent(new CustomEvent('store-mutation', { detail: { key: 'shotsy_photos', photoId: photo.id } }));

    return {
      id: photo.id,
      date: photo.date,
      note: photo.note,
      contentHash: photo.contentHash,
      syncedAt: null,
      dataUrl: await blobToDataUrl(photo.blob),
    };
  }

  async function deletePhoto(id) {
    await ensurePhotoStorageReady();
    await withPhotoStore('readwrite', (store, tx, resolve, reject, finish) => {
      const req = store.delete(id);
      req.onerror = () => finish(reject, req.error || new Error('Unable to delete photo'));
    });
    window.dispatchEvent(new CustomEvent('store-mutation', { detail: { key: 'shotsy_photos', photoId: id, deleted: true } }));
    return getPhotos();
  }

  async function getPhotoRecord(id) {
    await ensurePhotoStorageReady();
    return withPhotoStore('readonly', (store, tx, resolve, reject, finish) => {
      const req = store.get(id);
      req.onsuccess = () => finish(resolve, req.result || null);
      req.onerror = () => finish(reject, req.error || new Error('Unable to read photo'));
    });
  }

  async function markPhotoSynced(id) {
    await ensurePhotoStorageReady();
    const record = await getPhotoRecord(id);
    if (!record) return;
    record.syncedAt = new Date().toISOString();
    await withPhotoStore('readwrite', (store, tx, resolve, reject, finish) => {
      const req = store.put(record);
      req.onerror = () => finish(reject, req.error || new Error('Unable to update photo'));
    });
  }

  async function savePhotoFromRemote(record) {
    await ensurePhotoStorageReady();
    await withPhotoStore('readwrite', (store, tx, resolve, reject, finish) => {
      const req = store.put(record);
      req.onerror = () => finish(reject, req.error || new Error('Unable to save remote photo'));
    });
  }

  // Goals
  function getGoals() {
    return get(KEYS.GOALS) || { ...defaults.goals };
  }
  function saveGoals(goals) {
    _invalidateCache();
    return set(KEYS.GOALS, goals);
  }

  // Settings
  function getSettings() {
    return { ...defaults.settings, ...(get(KEYS.SETTINGS) || {}) };
  }
  function saveSettings(settings) {
    const merged = {
      ...defaults.settings,
      ...(settings || {}),
    };
    if (typeof merged.lastReminderCheckAt === 'undefined') {
      merged.lastReminderCheckAt = null;
    }
    _invalidateCache();
    return set(KEYS.SETTINGS, merged);
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
    if (toUnit === 'st') return Math.round(kg / 6.35029 * 10000) / 10000;
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

  // Stone + pounds helpers
  function normalizeStoneValue(value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return parsed;

    const raw = String(value == null ? '' : value).trim();
    const match = raw.match(/^(-?\d+)(?:\.(\d+))?$/);
    if (!match || !match[2]) return parsed;

    const whole = parseInt(match[1], 10);
    const frac = match[2];

    // Legacy shorthand support:
    // 20.9  => 20st 9lbs
    // 20.10 => 20st 10lbs
    // 20.30 => 20st 3lbs (common trailing-zero entry)
    if (frac.length === 1) {
      return whole + (parseInt(frac, 10) / 14);
    }
    if (frac.length === 2) {
      const pounds = parseInt(frac, 10);
      if (pounds <= 13) {
        return whole + (pounds / 14);
      }
      if (frac.endsWith('0')) {
        const tens = parseInt(frac[0], 10);
        if (tens <= 13) {
          return whole + (tens / 14);
        }
      }
    }

    return parsed;
  }

  function stLbsToDecimal(st, lbs) {
    const stRaw = String(st == null ? '' : st).trim();
    const lbsRaw = String(lbs == null ? '' : lbs).trim();
    const pounds = parseFloat(lbsRaw);

    // If pounds are explicitly provided, trust st + lbs fields.
    if (lbsRaw !== '' && Number.isFinite(pounds)) {
      return (parseFloat(stRaw) || 0) + (pounds / 14);
    }

    // If only stone is provided and it uses dotted shorthand (e.g., 20.9),
    // interpret it as 20st 9lbs for backwards/user compatibility.
    if (stRaw.includes('.')) {
      return normalizeStoneValue(stRaw);
    }

    return parseFloat(stRaw) || 0;
  }

  function decimalToStLbs(decimal) {
    var totalLbs = Math.round(parseFloat(decimal) * 14);
    var st = Math.floor(totalLbs / 14);
    var lbs = totalLbs % 14;
    return { st: st, lbs: lbs };
  }

  function formatStone(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    var normalized = normalizeStoneValue(val);
    var parts = decimalToStLbs(parseFloat(normalized));
    return parts.st + 'st ' + parts.lbs + 'lbs';
  }

  // Stats helpers
  function getStats() {
    if (_statsCache && _statsCacheVersion === _cacheVersion) return _statsCache;
    const weights = withNormalizedLocalDates(getWeights(), 'weight entry');
    const profile = getProfile();
    const goals = getGoals();
    const jabs = withNormalizedLocalDates(getJabs(), 'dose entry');
    const settings = getSettings();

    if (weights.length === 0) {
      const emptyResult = {
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
        nextJabDateTime: null,
        daysOnPlan: 0,
        targetWeight: goals.targetWeight || null,
        weightToGo: null,
        progressPercent: 0,
        percentBodyWeightLost: 0,
        unit: settings.weightUnit,
      };
      _statsCache = emptyResult;
      _statsCacheVersion = _cacheVersion;
      return emptyResult;
    }

    const parsedWeights = weights.map((entry) => {
      const parsed = settings.weightUnit === 'st'
        ? normalizeStoneValue(entry.weight)
        : parseFloat(entry.weight);
      return {
        entry,
        value: Number.isFinite(parsed) ? parsed : null,
      };
    }).filter((item) => item.value !== null);

    if (parsedWeights.length === 0) {
      const emptyParsedResult = {
        currentWeight: null,
        startWeight: null,
        totalLost: null,
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
        nextJabDateTime: null,
        daysOnPlan: 0,
        targetWeight: goals.targetWeight || null,
        weightToGo: null,
        progressPercent: 0,
        percentBodyWeightLost: 0,
        unit: settings.weightUnit,
      };
      _statsCache = emptyParsedResult;
      _statsCacheVersion = _cacheVersion;
      return emptyParsedResult;
    }

    const firstWeight = parsedWeights[0].value;
    const currentParsed = parsedWeights[parsedWeights.length - 1];
    const current = currentParsed.entry;
    const currentW = currentParsed.value;
    const profileStartWeight = settings.weightUnit === 'st' ? normalizeStoneValue(profile.startWeight) : parseFloat(profile.startWeight);
    const start = Number.isFinite(profileStartWeight) ? profileStartWeight : firstWeight;
    const totalLost = Number.isFinite(start) && Number.isFinite(currentW) ? start - currentW : null;

    // BMI calculation (height in cm)
    let bmi = null;
    if (profile.height) {
      var rawHeight = parseFloat(profile.height);
      // If heightUnit is 'ft' but height is stored in cm (should be), use as-is.
      // If height looks like raw feet (< 10), convert to cm.
      if (Number.isFinite(rawHeight) && rawHeight > 0 && rawHeight < 10 && profile.heightUnit === 'ft') {
        // Stored as feet (legacy fallback) — don't use, too imprecise
        rawHeight = null;
      }
      var heightM = rawHeight ? rawHeight / 100 : 0;
      let weightKg = currentW;
      if (settings.weightUnit === 'lbs') {
        weightKg = currentW * 0.453592;
      } else if (settings.weightUnit === 'st') {
        weightKg = currentW * 6.35029;
      }
      if (Number.isFinite(heightM) && heightM > 0.5 && Number.isFinite(weightKg) && weightKg > 0) {
        bmi = Math.round(weightKg / (heightM * heightM) * 10) / 10;
      }
    }

    // Changes over time
    const now = parseLocalDate(new Date());
    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 7);
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);

    const weight7dAgo = weights.filter(w => w._localDate <= d7).pop();
    const weight30dAgo = weights.filter(w => w._localDate <= d30).pop();

    const parsedWeight7d = weight7dAgo
      ? (settings.weightUnit === 'st' ? normalizeStoneValue(weight7dAgo.weight) : parseFloat(weight7dAgo.weight))
      : null;
    const parsedWeight30d = weight30dAgo
      ? (settings.weightUnit === 'st' ? normalizeStoneValue(weight30dAgo.weight) : parseFloat(weight30dAgo.weight))
      : null;
    const weightChange7d = Number.isFinite(parsedWeight7d) ? currentW - parsedWeight7d : 0;
    const weightChange30d = Number.isFinite(parsedWeight30d) ? currentW - parsedWeight30d : 0;

    // Average weekly loss
    const daysDiff = (current._localDate - weights[0]._localDate) / (1000 * 60 * 60 * 24);
    const weeks = daysDiff / 7;
    const avgWeeklyLoss = weeks > 0 && Number.isFinite(totalLost) ? totalLost / weeks : 0;

    // Streak: consecutive weeks with weight entries
    let streak = 0;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let checkDate = new Date(now);
    for (let i = 0; i < 52; i++) {
      const weekStart = new Date(checkDate - weekMs);
      const hasEntry = weights.some(w => {
        const d = w._localDate;
        return d >= weekStart && d <= checkDate;
      });
      if (hasEntry) {
        streak++;
        checkDate = weekStart;
      } else break;
    }

    // Days on plan
    const startDate = parseLocalDate(profile.startDate || weights[0].date);
    const daysOnPlanRaw = startDate ? Math.round((now - startDate) / (1000 * 60 * 60 * 24)) : 0;
    const daysOnPlan = Math.max(0, daysOnPlanRaw);

    // Progress toward goal
    const parsedTargetWeight = settings.weightUnit === 'st' ? normalizeStoneValue(goals.targetWeight) : parseFloat(goals.targetWeight);
    const targetWeight = Number.isFinite(parsedTargetWeight) ? parsedTargetWeight : null;
    const weightToGo = targetWeight !== null ? currentW - targetWeight : null;
    const totalToLose = targetWeight !== null ? start - targetWeight : null;
    const progressPercent = Number.isFinite(totalLost) && totalToLose && totalToLose > 0
      ? Math.min(100, Math.max(0, (totalLost / totalToLose) * 100))
      : 0;
    const percentBodyWeightLost = Number.isFinite(totalLost) && start > 0 ? (totalLost / start) * 100 : 0;

    // Next jab date
    let nextJabDate = null;
    let nextJabDateTime = null;
    const lastJab = jabs.length > 0 ? jabs[jabs.length - 1] : null;
    // Find the time from the last jab that has a time recorded
    // (missed doses may have empty time, so look back for a real time)
    let lastJabTimeForNext = lastJab ? lastJab.time : null;
    if (lastJab && !lastJabTimeForNext) {
      for (let i = jabs.length - 2; i >= 0; i--) {
        if (jabs[i] && jabs[i].time) {
          lastJabTimeForNext = jabs[i].time;
          break;
        }
      }
    }
    if (lastJab) {
      const freq = profile.frequency || 'weekly';
      const freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
      const days = freqDays[freq] || 7;
      const lastJabD = parseLocalDate(lastJab.date);
      if (!lastJabD) {
        warnInvalidDate('last dose entry', lastJab.date);
      } else {
        // Apply the dose time to calculate the exact next dose datetime
        var nextTarget = new Date(lastJabD);
        if (lastJabTimeForNext) {
          var parsedTime = parseTimeParts(lastJabTimeForNext);
          if (parsedTime) {
            nextTarget.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
            lastJabTimeForNext = parsedTime.normalized;
          }
        }
        nextTarget.setDate(nextTarget.getDate() + days);
        nextJabDate = formatLocalDate(nextTarget);
        nextJabDateTime = nextTarget.toISOString();
      }
    }

    const result = {
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
      nextJabDateTime,
      nextJabTime: lastJabTimeForNext || null,
      daysOnPlan,
      targetWeight,
      weightToGo,
      progressPercent,
      percentBodyWeightLost,
      unit: settings.weightUnit,
      frequency: profile.frequency || 'weekly',
    };
    _statsCache = result;
    _statsCacheVersion = _cacheVersion;
    return result;
  }

  // Enhanced streak data
  function getStreakData() {
    const weights = withNormalizedLocalDates(getWeights(), 'weight streak entry');
    const jabs = withNormalizedLocalDates(getJabs(), 'dose streak entry');
    const settings = getSettings();
    const profile = getProfile();
    const freq = profile.frequency || 'weekly';

    // Weight streak: consecutive weeks with a weigh-in
    let weightStreak = 0;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let checkDate = parseLocalDate(new Date());
    for (let i = 0; i < 52; i++) {
      const weekStart = new Date(checkDate - weekMs);
      const hasEntry = weights.some(w => {
        const d = w._localDate;
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
        const d = j._localDate;
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

    const totalLost = stats.totalLost;
    const unit = stats.unit;
    const pctLost = stats.startWeight > 0 ? (totalLost / stats.startWeight) * 100 : 0;

    // First 5 lbs equivalent by active unit.
    const first5Threshold = unit === 'lbs' ? 5 : (unit === 'st' ? 0.36 : 2.27);
    if (totalLost >= first5Threshold) {
      milestones.push({ key: 'first5', label: unit === 'lbs' ? 'First 5 lbs lost!' : (unit === 'st' ? 'First 5 lbs lost!' : 'First 2.3 kg lost!'), icon: '5' });
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
    return formatLocalDate(projected);
  }

  // Side effect trends
  function getSideEffectTrends() {
    const jabs = getJabs();
    const journal = getJournal();
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

    journal.forEach(j => {
      if (!j.symptoms || j.symptoms.length === 0) return;
      const month = j.date.substring(0, 7);
      if (!monthlyEffects[month]) monthlyEffects[month] = {};
      j.symptoms.forEach(s => {
        if (s === 'none') return;
        effectCounts[s] = (effectCounts[s] || 0) + 1;
        monthlyEffects[month][s] = (monthlyEffects[month][s] || 0) + 1;
      });
    });

    return { effectCounts, monthlyEffects, totalDoses: jabs.length, totalEntries: jabs.length + journal.length };
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
  // Optimized O(n) sliding window instead of O(n²) nested filter
  function parseWeight(value) {
    var unit = getSettings().weightUnit;
    return unit === 'st' ? normalizeStoneValue(value) : parseFloat(value);
  }

  function getMovingAverage(windowDays) {
    windowDays = windowDays || 28;
    if (_movingAvgCacheVersion === _cacheVersion && _movingAvgCache[windowDays]) {
      return _movingAvgCache[windowDays];
    }
    const weights = withNormalizedLocalDates(getWeights(), 'moving-average weight entry');
    if (weights.length < 2) return [];
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const result = [];
    let windowStart = 0;
    let windowSum = 0;
    let windowCount = 0;

    for (let i = 0; i < weights.length; i++) {
      const endTime = weights[i]._localDate.getTime();
      const val = parseWeight(weights[i].weight);
      windowSum += val;
      windowCount++;

      while (windowStart < i && (endTime - weights[windowStart]._localDate.getTime()) > windowMs) {
        windowSum -= parseWeight(weights[windowStart].weight);
        windowCount--;
        windowStart++;
      }

      result.push({ date: weights[i].date, avg: Math.round((windowSum / windowCount) * 10) / 10 });
    }

    if (_movingAvgCacheVersion !== _cacheVersion) {
      _movingAvgCache = {};
      _movingAvgCacheVersion = _cacheVersion;
    }
    _movingAvgCache[windowDays] = result;
    return result;
  }

  // Period summary for weekly/monthly cards
  function getPeriodSummary() {
    const weights = withNormalizedLocalDates(getWeights(), 'period-summary weight');
    const jabs = withNormalizedLocalDates(getJabs(), 'period-summary dose');
    const now = parseLocalDate(new Date());
    const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);

    return {
      dosesThisWeek: jabs.filter(j => j._localDate >= d7).length,
      dosesThisMonth: jabs.filter(j => j._localDate >= d30).length,
      weighInsThisWeek: weights.filter(w => w._localDate >= d7).length,
      weighInsThisMonth: weights.filter(w => w._localDate >= d30).length,
    };
  }

  // What-if goal calculator
  function calculateGoalDate(weeklyRate) {
    const stats = getStats();
    if (!stats.targetWeight || !weeklyRate || weeklyRate <= 0) return null;
    if (stats.currentWeight <= stats.targetWeight) return { date: formatLocalDate(new Date()), weeks: 0 };
    const weightToGo = stats.currentWeight - stats.targetWeight;
    const weeksToGo = weightToGo / weeklyRate;
    const projected = new Date();
    projected.setDate(projected.getDate() + Math.round(weeksToGo * 7));
    return { date: formatLocalDate(projected), weeks: Math.round(weeksToGo * 10) / 10 };
  }

  // Dose-weight correlation: compare weight loss rates before/after dose changes
  function getDoseWeightCorrelation() {
    const escalations = getDoseEscalations();
    if (escalations.length === 0) return [];
    const weights = withNormalizedLocalDates(getWeights(), 'correlation weight');
    if (weights.length < 4) return [];
    const windowDays = 28;
    const results = [];

    escalations.forEach(esc => {
      const escDate = parseLocalDate(esc.date);
      if (!escDate) return;
      const beforeStart = new Date(escDate); beforeStart.setDate(beforeStart.getDate() - windowDays);
      const afterEnd = new Date(escDate); afterEnd.setDate(afterEnd.getDate() + windowDays);

      const before = weights.filter(w => w._localDate >= beforeStart && w._localDate < escDate);
      const after = weights.filter(w => w._localDate > escDate && w._localDate <= afterEnd);

      if (before.length < 2 || after.length < 2) return;

      const bFirst = parseWeight(before[0].weight);
      const bLast = parseWeight(before[before.length - 1].weight);
      const bDays = (before[before.length - 1]._localDate - before[0]._localDate) / (1000 * 60 * 60 * 24);
      const rateBefore = bDays > 0 ? Math.round(((bFirst - bLast) / bDays) * 7 * 10) / 10 : 0;

      const aFirst = parseWeight(after[0].weight);
      const aLast = parseWeight(after[after.length - 1].weight);
      const aDays = (after[after.length - 1]._localDate - after[0]._localDate) / (1000 * 60 * 60 * 24);
      const rateAfter = aDays > 0 ? Math.round(((aFirst - aLast) / aDays) * 7 * 10) / 10 : 0;

      results.push({
        date: esc.date,
        fromDose: esc.fromDose,
        toDose: esc.toDose,
        medication: esc.medication,
        unit: esc.unit,
        direction: esc.direction,
        rateBefore,
        rateAfter,
        improvement: Math.round((rateAfter - rateBefore) * 10) / 10,
      });
    });

    return results;
  }

  // Rate of loss for a period
  function getRateOfLoss(periodDays) {
    const weights = withNormalizedLocalDates(getWeights(), 'rate-of-loss weight entry');
    if (weights.length < 2) return null;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - (periodDays || 30));
    const periodWeights = weights.filter(w => w._localDate >= cutoff);
    if (periodWeights.length < 2) return null;
    const first = parseWeight(periodWeights[0].weight);
    const last = parseWeight(periodWeights[periodWeights.length - 1].weight);
    const days = (periodWeights[periodWeights.length - 1]._localDate - periodWeights[0]._localDate) / (1000 * 60 * 60 * 24);
    if (days === 0) return null;
    const weeklyRate = ((first - last) / days) * 7;
    return Math.round(weeklyRate * 10) / 10;
  }

  // Injection site rotation recommendation
  function getNextRecommendedSite() {
    const jabs = getJabs();
    const allSites = ['abdomen-upper-left', 'abdomen-upper-right', 'abdomen-lower-left', 'abdomen-lower-right', 'thigh-left', 'thigh-right', 'arm-left', 'arm-right'];
    if (jabs.length === 0) return { recommended: 'abdomen-upper-left', lastSite: null, siteHistory: {} };

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
  async function exportData() {
    const photos = await getPhotos();
    return JSON.stringify({
      profile: getProfile(),
      weights: getWeights(),
      jabs: getJabs(),
      goals: getGoals(),
      settings: getSettings(),
      victories: getVictories(),
      photos,
      measurements: getMeasurements(),
      journal: getJournal(),
      fasts: getFasts(),
      exercises: getExercises(),
      exportDate: new Date().toISOString(),
    }, null, 2);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function deriveBackupKey(passphrase, saltBytes) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: ENCRYPTION_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  function isEncryptedBackupPayload(parsed) {
    return !!(
      parsed
      && typeof parsed === 'object'
      && parsed.type === ENCRYPTED_BACKUP_TYPE
      && parsed.version === ENCRYPTED_BACKUP_VERSION
    );
  }

  async function exportEncryptedBackup(passphrase) {
    if (typeof passphrase !== 'string' || passphrase.trim().length < 8) {
      throw new Error('invalid-passphrase');
    }
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('crypto-not-supported');
    }
    const plainText = await exportData();
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(passphrase.trim(), salt);
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(plainText),
    );
    const payload = {
      type: ENCRYPTED_BACKUP_TYPE,
      version: ENCRYPTED_BACKUP_VERSION,
      exportDate: new Date().toISOString(),
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: ENCRYPTION_ITERATIONS,
      },
      cipher: 'AES-GCM',
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    };
    return JSON.stringify(payload, null, 2);
  }

  async function getBackupSizeInfo() {
    const payload = await exportData();
    const utf8Bytes = new TextEncoder().encode(payload).length;
    const encodedLength = Math.ceil(utf8Bytes / 3) * 4;
    return {
      bytes: utf8Bytes,
      encodedLength,
      exceedsSafeLink: encodedLength > SAFE_BACKUP_LINK_CHARS,
    };
  }

  // Export CSV with weight + dose data
  function exportCSV() {
    const weights = getWeights();
    const jabs = getJabs();
    const measurements = getMeasurements();
    const exercises = getExercises();
    const journal = getJournal();
    const settings = getSettings();

    let csv = 'Type,Date,Weight (' + settings.weightUnit + '),Note,Medication,Dose,Dose Unit,Site,Side Effects,Waist,Hips,Chest,Exercise Type,Duration (min),Intensity,Mood,Energy\n';

    // Merge all entries by date
    const allEntries = [];
    weights.forEach(w => allEntries.push({ type: 'weight', date: w.date, data: w }));
    jabs.forEach(j => allEntries.push({ type: 'dose', date: j.date, data: j }));
    measurements.forEach(m => allEntries.push({ type: 'measurement', date: m.date, data: m }));
    exercises.forEach(e => allEntries.push({ type: 'exercise', date: e.date, data: e }));
    journal.forEach(j => allEntries.push({ type: 'journal', date: j.date, data: j }));
    allEntries.sort(sortByLocalDate);

    allEntries.forEach(e => {
      if (e.type === 'weight') {
        const w = e.data;
        const note = (w.note || '').replace(/"/g, '""');
        csv += 'Weight,' + w.date + ',' + w.weight + ',"' + note + '",,,,,,,,,,,,\n';
      } else if (e.type === 'dose') {
        const j = e.data;
        const notes = (j.notes || '').replace(/"/g, '""');
        const effects = (j.sideEffects || []).join('; ');
        csv += 'Dose,' + j.date + ',,"' + notes + '",' + (j.medication || '') + ',' + (j.dose || '') + ',' + (j.doseUnit || '') + ',' + (j.site || '') + ',"' + effects + '",,,,,,,,\n';
      } else if (e.type === 'measurement') {
        const m = e.data;
        const note = (m.note || '').replace(/"/g, '""');
        csv += 'Measurement,' + m.date + ',,"' + note + '",,,,,,,' + (m.waist || '') + ',' + (m.hips || '') + ',' + (m.chest || '') + ',,,,\n';
      } else if (e.type === 'exercise') {
        const ex = e.data;
        const note = (ex.note || '').replace(/"/g, '""');
        csv += 'Exercise,' + ex.date + ',,"' + note + '",,,,,,,,,' + (ex.type || '') + ',' + (ex.duration || '') + ',' + (ex.intensity || '') + ',,\n';
      } else if (e.type === 'journal') {
        const j = e.data;
        const text = (j.text || '').replace(/"/g, '""');
        csv += 'Journal,' + j.date + ',,"' + text + '",,,,,,,,,,,,,' + (j.mood || '') + ',' + (j.energy || '') + '\n';
      }
    });

    return csv;
  }

  // Import data
  async function importData(jsonStr) {
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
      return formatLocalDate(value);
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
          id: toStringOrEmpty(entry.id) || generateId(),
          date,
          weight,
          note: toStringOrEmpty(entry.note),
        };
      }).filter(Boolean).sort(sortByLocalDate);
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
          id: toStringOrEmpty(entry.id) || generateId(),
          date,
          time: toStringOrEmpty(entry.time),
          medication: toStringOrEmpty(entry.medication),
          dose,
          doseUnit: toStringOrEmpty(entry.doseUnit || 'mg'),
          site: toStringOrEmpty(entry.site),
          sideEffects,
          notes: toStringOrEmpty(entry.notes),
        };
      }).filter(Boolean).sort(sortByLocalDate);
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
          id: toStringOrEmpty(entry.id) || generateId(),
          date,
          text,
          category: toStringOrEmpty(entry.category),
        };
      }).filter(Boolean).sort(sortByLocalDate);
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
          id: toStringOrEmpty(entry.id) || generateId(),
          date,
          note: toStringOrEmpty(entry.note),
          dataUrl,
        };
      }).filter(Boolean).sort(sortByLocalDate);
    }

    function sanitizeMeasurements(measurements) {
      return measurements.map(entry => {
        if (!isPlainObject(entry)) { result.warnings++; return null; }
        const date = toDateString(entry.date);
        if (!date) { result.warnings++; return null; }
        return {
          id: toStringOrEmpty(entry.id) || generateId(),
          date,
          waist: toNumber(entry.waist),
          hips: toNumber(entry.hips),
          chest: toNumber(entry.chest),
          armLeft: toNumber(entry.armLeft),
          armRight: toNumber(entry.armRight),
          thighLeft: toNumber(entry.thighLeft),
          thighRight: toNumber(entry.thighRight),
          neck: toNumber(entry.neck),
          note: toStringOrEmpty(entry.note),
        };
      }).filter(Boolean).sort(sortByLocalDate);
    }

    function sanitizeJournal(journal) {
      return journal.map(entry => {
        if (!isPlainObject(entry)) { result.warnings++; return null; }
        const date = toDateString(entry.date);
        if (!date) { result.warnings++; return null; }
        return {
          id: toStringOrEmpty(entry.id) || generateId(),
          date,
          mood: toNumber(entry.mood),
          energy: toNumber(entry.energy),
          text: toStringOrEmpty(entry.text),
        };
      }).filter(Boolean).sort(sortByLocalDate);
    }

    function sanitizeFasts(fasts) {
      return fasts.map(entry => {
        if (!isPlainObject(entry)) { result.warnings++; return null; }
        if (!entry.startTime) { result.warnings++; return null; }
        return {
          id: toStringOrEmpty(entry.id) || generateId(),
          startTime: toStringOrEmpty(entry.startTime),
          endTime: toStringOrEmpty(entry.endTime),
          targetHours: toNumber(entry.targetHours) || 16,
          protocol: toStringOrEmpty(entry.protocol),
          completed: !!entry.completed,
          note: toStringOrEmpty(entry.note),
        };
      }).filter(Boolean);
    }

    function sanitizeExercises(exercises) {
      return exercises.map(entry => {
        if (!isPlainObject(entry)) { result.warnings++; return null; }
        const date = toDateString(entry.date);
        if (!date) { result.warnings++; return null; }
        return {
          id: toStringOrEmpty(entry.id) || generateId(),
          date,
          type: toStringOrEmpty(entry.type),
          duration: toNumber(entry.duration),
          intensity: toStringOrEmpty(entry.intensity),
          calories: toNumber(entry.calories),
          note: toStringOrEmpty(entry.note),
        };
      }).filter(Boolean).sort(sortByLocalDate);
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
        mergedProfile.dosage = toStringOrEmpty(mergedProfile.dosage);
        mergedProfile.doseUnit = toStringOrEmpty(mergedProfile.doseUnit || defaults.profile.doseUnit);
        mergedProfile.frequency = toStringOrEmpty(mergedProfile.frequency || defaults.profile.frequency);

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
        await savePhotos([]);
      } else if (!Array.isArray(data.photos)) {
        result.warnings++;
      } else {
        await savePhotos(sanitizePhotos(data.photos));
      }

      if (data.measurements === undefined) {
        saveMeasurements([]);
      } else if (!Array.isArray(data.measurements)) {
        result.warnings++;
      } else {
        saveMeasurements(sanitizeMeasurements(data.measurements));
      }

      if (data.journal === undefined) {
        saveJournal([]);
      } else if (!Array.isArray(data.journal)) {
        result.warnings++;
      } else {
        saveJournal(sanitizeJournal(data.journal));
      }

      if (data.fasts === undefined) {
        saveFasts([]);
      } else if (!Array.isArray(data.fasts)) {
        result.warnings++;
      } else {
        saveFasts(sanitizeFasts(data.fasts));
      }

      if (data.exercises === undefined) {
        saveExercises([]);
      } else if (!Array.isArray(data.exercises)) {
        result.warnings++;
      } else {
        saveExercises(sanitizeExercises(data.exercises));
      }

      result.success = true;
      return result;
    } catch {
      return result;
    }
  }

  async function importBackupData(backupPayload, passphrase) {
    const failure = { success: false, warnings: 0 };
    let parsed;
    try {
      parsed = JSON.parse(backupPayload);
    } catch {
      return failure;
    }

    if (!isEncryptedBackupPayload(parsed)) {
      return importData(backupPayload);
    }

    if (!window.crypto || !window.crypto.subtle) {
      return { ...failure, requiresPassphrase: true, error: 'crypto-not-supported' };
    }
    if (typeof passphrase !== 'string' || passphrase.trim() === '') {
      return { ...failure, requiresPassphrase: true, error: 'passphrase-required' };
    }

    try {
      const salt = base64ToBytes(parsed.salt);
      const iv = base64ToBytes(parsed.iv);
      const ciphertext = base64ToBytes(parsed.ciphertext);
      const key = await deriveBackupKey(passphrase.trim(), salt);
      const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext,
      );
      const plainText = new TextDecoder().decode(plainBuffer);
      return await importData(plainText);
    } catch {
      return { ...failure, requiresPassphrase: true, error: 'invalid-passphrase' };
    }
  }

  // Generate shareable backup link
  async function generateBackupLink() {
    const data = await exportData();
    try {
      const encoded = btoa(unescape(encodeURIComponent(data)));
      return encoded;
    } catch {
      return null;
    }
  }

  function generateMetadataBackupLink() {
    const profile = getProfile();
    const settings = getSettings();
    const weights = getWeights();
    const jabs = getJabs();
    const payload = {
      type: 'metadata',
      version: 1,
      exportDate: new Date().toISOString(),
      profile: {
        name: profile.name || '',
        medication: profile.medication || '',
      },
      settings: {
        weightUnit: settings.weightUnit || 'kg',
        theme: settings.theme || 'light',
      },
      counts: {
        weights: weights.length,
        jabs: jabs.length,
      },
      note: 'Metadata link only. Share exported backup file for full restore.',
    };
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    } catch {
      return null;
    }
  }

  // Import from backup link
  async function importFromBackupLink(encoded) {
    const failure = { success: false, warnings: 0 };
    if (!encoded || encoded.length > SAFE_BACKUP_LINK_CHARS) {
      return { ...failure, blocked: true, reason: 'oversized' };
    }
    try {
      const json = decodeURIComponent(escape(atob(encoded)));
      const parsed = JSON.parse(json);
      if (parsed && parsed.type === 'metadata') {
        return { success: false, warnings: 0, metadataOnly: true, metadata: parsed };
      }

      const hasSensitiveShape = parsed
        && typeof parsed === 'object'
        && (
          Object.prototype.hasOwnProperty.call(parsed, 'profile')
          || Object.prototype.hasOwnProperty.call(parsed, 'weights')
          || Object.prototype.hasOwnProperty.call(parsed, 'jabs')
          || Object.prototype.hasOwnProperty.call(parsed, 'photos')
          || isEncryptedBackupPayload(parsed)
        );
      if (hasSensitiveShape || json.length > 2500) {
        return { ...failure, blocked: true, reason: 'sensitive' };
      }

      return await importData(json);
    } catch {
      return failure;
    }
  }

  // Clear all data
  // ===== ANALYTICS: Weekly Summary =====
  function getWeeklySummary() {
    var now = parseLocalDate(new Date());
    var dayOfWeek = now.getDay(); // 0=Sun
    // Monday-based week: find previous Monday
    var mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    var thisMonday = new Date(now);
    thisMonday.setDate(thisMonday.getDate() - mondayOffset);

    var prevMonday = new Date(thisMonday);
    prevMonday.setDate(prevMonday.getDate() - 7);
    var prevSunday = new Date(thisMonday);
    prevSunday.setDate(prevSunday.getDate() - 1);

    // Also get the week before that for comparison
    var prevPrevMonday = new Date(prevMonday);
    prevPrevMonday.setDate(prevPrevMonday.getDate() - 7);

    var weekId = now.getFullYear() + '-W' + String(Math.ceil(((thisMonday - new Date(now.getFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0');

    // Check if dismissed
    var dismissed = [];
    try {
      dismissed = JSON.parse(localStorage.getItem('shotsy_weekly_dismissed') || '[]');
    } catch (e) { dismissed = []; }

    function summarizeWeek(startDate, endDate) {
      var weights = withNormalizedLocalDates(getWeights(), 'weekly-summary weight');
      var jabs = withNormalizedLocalDates(getJabs(), 'weekly-summary dose');
      var journal = withNormalizedLocalDates(getJournal(), 'weekly-summary journal');
      var exercises = withNormalizedLocalDates(getExercises(), 'weekly-summary exercise');
      var fasts = getFasts().filter(function(f) { return f.completed; });

      var wWeights = weights.filter(function(w) { return w._localDate >= startDate && w._localDate <= endDate; });
      var wJabs = jabs.filter(function(j) { return j._localDate >= startDate && j._localDate <= endDate; });
      var wJournal = journal.filter(function(j) { return j._localDate >= startDate && j._localDate <= endDate; });
      var wExercises = exercises.filter(function(e) { return e._localDate >= startDate && e._localDate <= endDate; });
      var wFasts = fasts.filter(function(f) {
        var d = parseLocalDate(f.startTime || f.date);
        return d && d >= startDate && d <= endDate;
      });

      // Weight change
      var weightChange = null;
      if (wWeights.length >= 2) {
        var first = parseWeight(wWeights[0].weight);
        var last = parseWeight(wWeights[wWeights.length - 1].weight);
        if (Number.isFinite(first) && Number.isFinite(last)) {
          weightChange = Math.round((last - first) * 100) / 100;
        }
      }

      // Doses
      var profile = getProfile();
      var freq = profile.frequency || 'weekly';
      var freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
      var expectedDoses = Math.round(7 / (freqDays[freq] || 7));

      // Exercise
      var exerciseMinutes = wExercises.reduce(function(sum, e) { return sum + (parseFloat(e.duration) || 0); }, 0);

      // Mood/Energy
      var moods = wJournal.filter(function(j) { return j.mood; }).map(function(j) { return parseFloat(j.mood); });
      var energies = wJournal.filter(function(j) { return j.energy; }).map(function(j) { return parseFloat(j.energy); });
      var avgMood = moods.length > 0 ? Math.round(moods.reduce(function(a, b) { return a + b; }, 0) / moods.length * 10) / 10 : null;
      var avgEnergy = energies.length > 0 ? Math.round(energies.reduce(function(a, b) { return a + b; }, 0) / energies.length * 10) / 10 : null;

      // Side effects
      var effectCounts = {};
      wJabs.forEach(function(j) {
        if (!j.sideEffects) return;
        j.sideEffects.forEach(function(se) {
          if (se !== 'none') effectCounts[se] = (effectCounts[se] || 0) + 1;
        });
      });
      wJournal.forEach(function(j) {
        if (!j.symptoms) return;
        j.symptoms.forEach(function(s) {
          if (s !== 'none') effectCounts[s] = (effectCounts[s] || 0) + 1;
        });
      });
      var topEffect = Object.entries(effectCounts).sort(function(a, b) { return b[1] - a[1]; })[0];

      return {
        weightChange: weightChange,
        weighIns: wWeights.length,
        doses: wJabs.length,
        expectedDoses: expectedDoses,
        exerciseSessions: wExercises.length,
        exerciseMinutes: Math.round(exerciseMinutes),
        avgMood: avgMood,
        avgEnergy: avgEnergy,
        fasts: wFasts.length,
        topSideEffect: topEffect ? topEffect[0] : null,
      };
    }

    var current = summarizeWeek(prevMonday, prevSunday);
    var prior = summarizeWeek(prevPrevMonday, new Date(prevMonday.getTime() - 86400000));

    return {
      weekId: weekId,
      startDate: formatLocalDate(prevMonday),
      endDate: formatLocalDate(prevSunday),
      current: current,
      prior: prior,
      isDismissed: dismissed.indexOf(weekId) !== -1,
      unit: getSettings().weightUnit,
    };
  }

  function isWeeklySummaryAvailable() {
    var summary = getWeeklySummary();
    if (summary.isDismissed) return false;
    var c = summary.current;
    return c.weighIns > 0 || c.doses > 0 || c.exerciseSessions > 0;
  }

  function dismissWeeklySummary(weekId) {
    var dismissed = [];
    try {
      dismissed = JSON.parse(localStorage.getItem('shotsy_weekly_dismissed') || '[]');
    } catch (e) { dismissed = []; }
    if (dismissed.indexOf(weekId) === -1) {
      dismissed.push(weekId);
      // Keep only last 10
      if (dismissed.length > 10) dismissed = dismissed.slice(-10);
      localStorage.setItem('shotsy_weekly_dismissed', JSON.stringify(dismissed));
    }
  }

  // ===== ANALYTICS: Weight Velocity =====
  function getWeightVelocity() {
    var weights = withNormalizedLocalDates(getWeights(), 'velocity weight');
    if (weights.length < 4) return { dataPoints: [], trend: 'steady', currentRate: null };

    var now = parseLocalDate(new Date());
    var cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 90);
    var recent = weights.filter(function(w) { return w._localDate >= cutoff; });
    if (recent.length < 4) recent = weights;

    var windowDays = 14;
    var stepDays = 7;
    var dataPoints = [];
    var startDate = recent[0]._localDate;
    var endDate = recent[recent.length - 1]._localDate;
    var cursor = new Date(startDate);
    cursor.setDate(cursor.getDate() + windowDays);

    while (cursor <= endDate) {
      var windowStart = new Date(cursor);
      windowStart.setDate(windowStart.getDate() - windowDays);
      var inWindow = recent.filter(function(w) {
        return w._localDate >= windowStart && w._localDate <= cursor;
      });
      if (inWindow.length >= 2) {
        var first = parseWeight(inWindow[0].weight);
        var last = parseWeight(inWindow[inWindow.length - 1].weight);
        var days = (inWindow[inWindow.length - 1]._localDate - inWindow[0]._localDate) / 86400000;
        if (days > 0) {
          var weeklyRate = Math.round(((first - last) / days) * 7 * 100) / 100;
          dataPoints.push({ periodEnd: formatLocalDate(cursor), weeklyRate: weeklyRate });
        }
      }
      cursor.setDate(cursor.getDate() + stepDays);
    }

    // Determine trend via simple linear regression on rates
    var trend = 'steady';
    var currentRate = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].weeklyRate : null;
    if (dataPoints.length >= 3) {
      var n = dataPoints.length;
      var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (var i = 0; i < n; i++) {
        sumX += i;
        sumY += dataPoints[i].weeklyRate;
        sumXY += i * dataPoints[i].weeklyRate;
        sumX2 += i * i;
      }
      var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      if (slope > 0.05) trend = 'accelerating';
      else if (slope < -0.05) trend = 'slowing';
    }

    return { dataPoints: dataPoints, trend: trend, currentRate: currentRate };
  }

  // ===== ANALYTICS: Smart Insights =====
  function getInsights() {
    var insights = [];
    var stats = getStats();
    var settings = getSettings();
    var unit = settings.weightUnit;

    // Need minimum data
    if (stats.daysOnPlan < 7 || stats.totalEntries < 2) return insights;

    var weights = withNormalizedLocalDates(getWeights(), 'insights weight');
    var jabs = withNormalizedLocalDates(getJabs(), 'insights dose');
    var journal = withNormalizedLocalDates(getJournal(), 'insights journal');
    var exercises = withNormalizedLocalDates(getExercises(), 'insights exercise');
    var now = parseLocalDate(new Date());

    // 1. Plateau Detection
    if (weights.length >= 4) {
      var d14 = new Date(now); d14.setDate(d14.getDate() - 14);
      var d28 = new Date(now); d28.setDate(d28.getDate() - 28);
      var recent14 = weights.filter(function(w) { return w._localDate >= d14; });
      var prior14 = weights.filter(function(w) { return w._localDate >= d28 && w._localDate < d14; });
      if (recent14.length >= 2 && prior14.length >= 2) {
        var recentFirst = parseWeight(recent14[0].weight);
        var recentLast = parseWeight(recent14[recent14.length - 1].weight);
        var priorFirst = parseWeight(prior14[0].weight);
        var priorLast = parseWeight(prior14[prior14.length - 1].weight);
        var recentChange = Math.abs(recentFirst - recentLast);
        var priorChange = priorFirst - priorLast;
        var plateauThreshold = unit === 'lbs' ? 0.5 : (unit === 'st' ? 0.04 : 0.2);
        var lossThreshold = unit === 'lbs' ? 1.0 : (unit === 'st' ? 0.07 : 0.5);
        if (recentChange < plateauThreshold && priorChange > lossThreshold) {
          insights.push({ type: 'alert', message: 'You may be hitting a plateau - this is normal on GLP-1 medications. Stay consistent!', icon: '\u23F8', priority: 9 });
        }
      }
    }

    // 2. Exercise-Weight Correlation (need 4+ weeks)
    if (weights.length >= 4 && exercises.length >= 2 && stats.daysOnPlan >= 28) {
      var weekBuckets = {};
      weights.forEach(function(w) {
        var weekKey = w.date.substring(0, 7) + '-W' + Math.floor(w._localDate.getDate() / 7);
        if (!weekBuckets[weekKey]) weekBuckets[weekKey] = { weights: [], exercises: 0 };
        weekBuckets[weekKey].weights.push(parseWeight(w.weight));
      });
      exercises.forEach(function(e) {
        var weekKey = e.date.substring(0, 7) + '-W' + Math.floor(e._localDate.getDate() / 7);
        if (weekBuckets[weekKey]) weekBuckets[weekKey].exercises++;
      });
      var activeWeeks = [], inactiveWeeks = [];
      Object.values(weekBuckets).forEach(function(b) {
        if (b.weights.length < 2) return;
        var change = b.weights[0] - b.weights[b.weights.length - 1];
        if (b.exercises >= 3) activeWeeks.push(change);
        else inactiveWeeks.push(change);
      });
      if (activeWeeks.length >= 2 && inactiveWeeks.length >= 2) {
        var avgActive = activeWeeks.reduce(function(a, b) { return a + b; }, 0) / activeWeeks.length;
        var avgInactive = inactiveWeeks.reduce(function(a, b) { return a + b; }, 0) / inactiveWeeks.length;
        if (avgActive > avgInactive * 1.2 && avgActive > 0) {
          var diff = unit === 'st' ? Store.formatStone(Math.abs(avgActive - avgInactive)) : Math.abs(avgActive - avgInactive).toFixed(1) + ' ' + unit;
          insights.push({ type: 'positive', message: 'Weeks with 3+ workouts show ' + diff + ' more loss on average.', icon: '\uD83C\uDFCB', priority: 8 });
        }
      }
    }

    // 3. Dose Day Mood
    if (jabs.length >= 3 && journal.length >= 5) {
      var jabDates = {};
      jabs.forEach(function(j) { jabDates[j.date] = true; });
      var doseDayMoods = [], nonDoseMoods = [];
      journal.forEach(function(j) {
        if (!j.mood) return;
        if (jabDates[j.date]) doseDayMoods.push(parseFloat(j.mood));
        else nonDoseMoods.push(parseFloat(j.mood));
      });
      if (doseDayMoods.length >= 2 && nonDoseMoods.length >= 2) {
        var avgDose = doseDayMoods.reduce(function(a, b) { return a + b; }, 0) / doseDayMoods.length;
        var avgNonDose = nonDoseMoods.reduce(function(a, b) { return a + b; }, 0) / nonDoseMoods.length;
        if (Math.abs(avgDose - avgNonDose) >= 0.5) {
          var direction = avgDose < avgNonDose ? 'lower' : 'higher';
          insights.push({ type: 'neutral', message: 'Your mood tends to be ' + direction + ' on dose days (' + avgDose.toFixed(1) + ' vs ' + avgNonDose.toFixed(1) + ').', icon: '\uD83D\uDE4F', priority: 6 });
        }
      }
    }

    // 4. Side Effect After Escalation
    var escalations = getDoseEscalations();
    if (escalations.length >= 1 && jabs.length >= 3) {
      var postEscEffects = 0, postEscDoses = 0;
      var normalEffects = 0, normalDoses = 0;
      escalations.forEach(function(esc) {
        var escDate = parseLocalDate(esc.date);
        if (!escDate) return;
        var weekAfter = new Date(escDate);
        weekAfter.setDate(weekAfter.getDate() + 7);
        jabs.forEach(function(j) {
          if (!j.sideEffects || j.sideEffects.length === 0) return;
          var effectCount = j.sideEffects.filter(function(se) { return se !== 'none'; }).length;
          if (j._localDate >= escDate && j._localDate <= weekAfter) {
            postEscEffects += effectCount;
            postEscDoses++;
          } else {
            normalEffects += effectCount;
            normalDoses++;
          }
        });
      });
      if (postEscDoses >= 1 && normalDoses >= 2) {
        var postRate = postEscEffects / postEscDoses;
        var normalRate = normalEffects / normalDoses;
        if (postRate > normalRate * 1.5) {
          insights.push({ type: 'neutral', message: 'Side effects are most common in the first week after a dose increase.', icon: '\u26A0', priority: 7 });
        }
      }
    }

    // 5. Best Weigh-in Day
    if (weights.length >= 14) {
      var dayBuckets = [[], [], [], [], [], [], []];
      var dayNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
      weights.forEach(function(w) { dayBuckets[w._localDate.getDay()].push(parseWeight(w.weight)); });
      var bestDay = -1, bestVariance = Infinity;
      dayBuckets.forEach(function(bucket, idx) {
        if (bucket.length < 3) return;
        var mean = bucket.reduce(function(a, b) { return a + b; }, 0) / bucket.length;
        var variance = bucket.reduce(function(sum, v) { return sum + Math.pow(v - mean, 2); }, 0) / bucket.length;
        if (variance < bestVariance) { bestVariance = variance; bestDay = idx; }
      });
      if (bestDay >= 0) {
        insights.push({ type: 'neutral', message: 'Your most consistent weigh-ins are on ' + dayNames[bestDay] + '.', icon: '\uD83D\uDCC5', priority: 3 });
      }
    }

    // 6. Measurement vs Scale
    var measStats = getMeasurementStats();
    if (measStats.total >= 2 && weights.length >= 4) {
      var d30m = new Date(now); d30m.setDate(d30m.getDate() - 30);
      var recent30 = weights.filter(function(w) { return w._localDate >= d30m; });
      if (recent30.length >= 2) {
        var scaleChange = parseWeight(recent30[recent30.length - 1].weight) - parseWeight(recent30[0].weight);
        var measChange = 0;
        var measFields = ['waist', 'hips', 'chest'];
        measFields.forEach(function(f) {
          if (measStats.changes && measStats.changes[f]) measChange += measStats.changes[f];
        });
        if (Math.abs(scaleChange) < 0.5 && measChange < -2) {
          insights.push({ type: 'positive', message: 'Your measurements show progress even though the scale hasn\'t moved - you may be recomposing!', icon: '\uD83D\uDCCF', priority: 8 });
        }
      }
    }

    // 7. Streak Celebration
    var streakData = getStreakData();
    var combinedStreak = Math.max(streakData.weightStreak, streakData.doseStreak);
    if (combinedStreak >= 3) {
      insights.push({ type: 'positive', message: 'You\'re on a ' + combinedStreak + '-week streak! Keep it going!', icon: '\uD83D\uDD25', priority: 4 });
    }

    // 8. Projected Milestone
    if (stats.avgWeeklyLoss > 0 && stats.targetWeight) {
      var nextMilestones = [];
      var totalLost = stats.totalLost || 0;
      var pctLost = stats.startWeight > 0 ? (totalLost / stats.startWeight) * 100 : 0;
      if (pctLost < 5) nextMilestones.push({ label: '5% body weight', target: stats.startWeight * 0.05 - totalLost });
      else if (pctLost < 10) nextMilestones.push({ label: '10% body weight', target: stats.startWeight * 0.10 - totalLost });
      if (stats.progressPercent < 50) nextMilestones.push({ label: 'halfway to goal', target: (stats.startWeight - stats.targetWeight) / 2 - totalLost });
      var nextMs = nextMilestones.filter(function(m) { return m.target > 0; }).sort(function(a, b) { return a.target - b.target; })[0];
      if (nextMs && stats.avgWeeklyLoss > 0) {
        var weeksToMs = Math.round(nextMs.target / stats.avgWeeklyLoss);
        if (weeksToMs > 0 && weeksToMs < 52) {
          insights.push({ type: 'neutral', message: 'At your current rate, you\'ll hit ' + nextMs.label + ' in ~' + weeksToMs + ' week' + (weeksToMs === 1 ? '' : 's') + '.', icon: '\uD83C\uDFAF', priority: 5 });
        }
      }
    }

    // 9. Dose Adherence Impact
    if (jabs.length >= 4 && weights.length >= 8 && stats.daysOnPlan >= 28) {
      var profile = getProfile();
      var freq = profile.frequency || 'weekly';
      var freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
      var interval = freqDays[freq] || 7;
      // Compare weeks with on-time doses vs missed
      var onTimeWeeks = [], missedWeeks = [];
      var weekStart = new Date(weights[0]._localDate);
      while (weekStart < now) {
        var weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        var wWeights = weights.filter(function(w) { return w._localDate >= weekStart && w._localDate < weekEnd; });
        var wJabs = jabs.filter(function(j) { return j._localDate >= weekStart && j._localDate < weekEnd; });
        var expectedCount = Math.round(7 / interval);
        if (wWeights.length >= 2) {
          var wFirst = parseWeight(wWeights[0].weight);
          var wLast = parseWeight(wWeights[wWeights.length - 1].weight);
          var loss = wFirst - wLast;
          if (wJabs.length >= expectedCount) onTimeWeeks.push(loss);
          else missedWeeks.push(loss);
        }
        weekStart = weekEnd;
      }
      if (onTimeWeeks.length >= 2 && missedWeeks.length >= 1) {
        var avgOnTime = onTimeWeeks.reduce(function(a, b) { return a + b; }, 0) / onTimeWeeks.length;
        var avgMissed = missedWeeks.reduce(function(a, b) { return a + b; }, 0) / missedWeeks.length;
        if (avgOnTime > avgMissed + 0.1) {
          insights.push({ type: 'positive', message: 'Consistent dosing appears to improve your results. Keep up the adherence!', icon: '\uD83D\uDC89', priority: 7 });
        }
      }
    }

    // Sort by priority (highest first), return top 4
    insights.sort(function(a, b) { return b.priority - a.priority; });
    return insights.slice(0, 4);
  }

  // ===== ANALYTICS: Monthly Comparison =====
  function getMonthlyComparison() {
    var weights = withNormalizedLocalDates(getWeights(), 'monthly-comparison weight');
    var jabs = withNormalizedLocalDates(getJabs(), 'monthly-comparison dose');
    var exercises = withNormalizedLocalDates(getExercises(), 'monthly-comparison exercise');
    var journal = withNormalizedLocalDates(getJournal(), 'monthly-comparison journal');
    var now = parseLocalDate(new Date());

    var months = [];
    for (var i = 0; i < 6; i++) {
      var monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      var monthLabel = monthStart.toLocaleDateString('en', { month: 'short', year: '2-digit' });

      var mWeights = weights.filter(function(w) { return w._localDate >= monthStart && w._localDate <= monthEnd; });
      var mJabs = jabs.filter(function(j) { return j._localDate >= monthStart && j._localDate <= monthEnd; });
      var mExercises = exercises.filter(function(e) { return e._localDate >= monthStart && e._localDate <= monthEnd; });
      var mJournal = journal.filter(function(j) { return j._localDate >= monthStart && j._localDate <= monthEnd; });

      var weightLost = null;
      if (mWeights.length >= 2) {
        var first = parseWeight(mWeights[0].weight);
        var last = parseWeight(mWeights[mWeights.length - 1].weight);
        weightLost = Math.round((first - last) * 100) / 100;
      }

      var moods = mJournal.filter(function(j) { return j.mood; }).map(function(j) { return parseFloat(j.mood); });
      var avgMood = moods.length > 0 ? Math.round(moods.reduce(function(a, b) { return a + b; }, 0) / moods.length * 10) / 10 : null;

      var exerciseMin = mExercises.reduce(function(sum, e) { return sum + (parseFloat(e.duration) || 0); }, 0);

      months.push({
        label: monthLabel,
        isCurrent: i === 0,
        weightLost: weightLost,
        doses: mJabs.length,
        exerciseSessions: mExercises.length,
        exerciseMinutes: Math.round(exerciseMin),
        avgMood: avgMood,
      });
    }

    return months.reverse();
  }

  // ===== ANALYTICS: Weight Variability & Confidence Band =====
  function getWeightVariability() {
    var weights = withNormalizedLocalDates(getWeights(), 'variability weight');
    if (weights.length < 5) return { stdDev: null, typicalRange: null, isWithinNormal: true };

    var d30 = new Date(parseLocalDate(new Date()));
    d30.setDate(d30.getDate() - 30);
    var recent = weights.filter(function(w) { return w._localDate >= d30; });
    if (recent.length < 5) recent = weights.slice(-30);

    // Calculate daily changes
    var changes = [];
    for (var i = 1; i < recent.length; i++) {
      var prev = parseWeight(recent[i - 1].weight);
      var curr = parseWeight(recent[i].weight);
      if (Number.isFinite(prev) && Number.isFinite(curr)) {
        changes.push(curr - prev);
      }
    }
    if (changes.length < 3) return { stdDev: null, typicalRange: null, isWithinNormal: true };

    var mean = changes.reduce(function(a, b) { return a + b; }, 0) / changes.length;
    var variance = changes.reduce(function(sum, c) { return sum + Math.pow(c - mean, 2); }, 0) / changes.length;
    var stdDev = Math.round(Math.sqrt(variance) * 100) / 100;
    var typicalRange = Math.round(stdDev * 2 * 100) / 100;

    // Check if latest weight is within normal
    var movingAvg = getMovingAverage(14);
    var isWithinNormal = true;
    if (movingAvg.length > 0 && weights.length > 0) {
      var latestWeight = parseWeight(weights[weights.length - 1].weight);
      var latestAvg = movingAvg[movingAvg.length - 1].avg;
      isWithinNormal = Math.abs(latestWeight - latestAvg) <= stdDev * 2;
    }

    return { stdDev: stdDev, typicalRange: typicalRange, isWithinNormal: isWithinNormal };
  }

  function getConfidenceBand() {
    var variability = getWeightVariability();
    if (!variability.stdDev) return [];

    var movingAvg = getMovingAverage(14);
    var bandWidth = variability.stdDev * 1.5;

    return movingAvg.map(function(point) {
      return {
        date: point.date,
        upper: Math.round((point.avg + bandWidth) * 100) / 100,
        lower: Math.round((point.avg - bandWidth) * 100) / 100,
        avg: point.avg,
      };
    });
  }

  function clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    if (window.indexedDB) {
      indexedDB.deleteDatabase(PHOTO_DB.NAME);
    }
    photoDbPromise = null;
    photoMigrationPromise = null;
    _invalidateCache();
  }

  return {
    getProfile, saveProfile,
    getWeights, saveWeights, addWeight, updateWeight, deleteWeight,
    getJabs, saveJabs, addJab, updateJab, deleteJab,
    getVictories, saveVictories, addVictory, deleteVictory,
    ensurePhotoStorageReady,
    getPhotos, savePhotos, addPhoto, deletePhoto,
    getPhotoRecord, markPhotoSynced, savePhotoFromRemote,
    compressImage, computeContentHash, dataUrlToBlob, blobToDataUrl,
    getMeasurements, saveMeasurements, addMeasurement, updateMeasurement, deleteMeasurement, getMeasurementStats,
    getJournal, saveJournal, addJournalEntry, updateJournalEntry, deleteJournalEntry, getMoodTrend,
    getFasts, saveFasts, addFast, deleteFast, getActiveFast, setActiveFast, clearActiveFast, getFastingStats,
    getExercises, saveExercises, addExercise, updateExercise, deleteExercise, getExerciseStats,
    generateDoctorReport,
    getGoals, saveGoals,
    getSettings, saveSettings,
    getStats, getStreakData, getMilestones, getProjectedGoalDate,
    getSideEffectTrends, getDoseEscalations,
    getMovingAverage, getRateOfLoss, getNextRecommendedSite,
    getPeriodSummary, calculateGoalDate, getDoseWeightCorrelation,
    getWeeklySummary, isWeeklySummaryAvailable, dismissWeeklySummary,
    getWeightVelocity, getInsights, getMonthlyComparison,
    getWeightVariability, getConfidenceBand,
    convertWeight, convertAllWeights,
    stLbsToDecimal, decimalToStLbs, formatStone,
    exportData, exportCSV, importData,
    exportEncryptedBackup, importBackupData,
    getBackupSizeInfo,
    generateBackupLink, generateMetadataBackupLink, importFromBackupLink,
    SAFE_BACKUP_LINK_CHARS,
    parseLocalDate, formatLocalDate, parseTimeParts,
    clearAll,
  };
})();
