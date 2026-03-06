// Jab It Data Store - localStorage persistence layer
/**
 * @typedef {{ name: string, age: string, height: string, heightUnit: string, startWeight: string, startDate: string, medication: string, dosage: string, frequency: string }} Profile
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

  function warnInvalidDate(context, dateValue) {
    console.warn(`[Store] Skipping ${context} with invalid date:`, dateValue);
  }

  function sortByLocalDate(a, b) {
    const aDate = parseLocalDate(a.date);
    const bDate = parseLocalDate(b.date);
    if (!aDate || !bDate) return 0;
    return aDate - bDate;
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

    function getAll() { return get(key) || []; }
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
    return get(KEYS.PROFILE) || { ...defaults.profile };
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

  const measurementCol = createCollection(KEYS.MEASUREMENTS, { invalidateCache: true });
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
        daysOnPlan: 0,
        targetWeight: goals.targetWeight || null,
        weightToGo: null,
        progressPercent: 0,
        unit: settings.weightUnit,
      };
      _statsCache = emptyResult;
      _statsCacheVersion = _cacheVersion;
      return emptyResult;
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
    const now = parseLocalDate(new Date());
    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 7);
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);

    const weight7dAgo = weights.filter(w => w._localDate <= d7).pop();
    const weight30dAgo = weights.filter(w => w._localDate <= d30).pop();

    const weightChange7d = weight7dAgo ? currentW - parseFloat(weight7dAgo.weight) : 0;
    const weightChange30d = weight30dAgo ? currentW - parseFloat(weight30dAgo.weight) : 0;

    // Average weekly loss
    const daysDiff = (current._localDate - weights[0]._localDate) / (1000 * 60 * 60 * 24);
    const weeks = daysDiff / 7;
    const avgWeeklyLoss = weeks > 0 ? totalLost / weeks : 0;

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
    const daysOnPlan = startDate ? Math.round((now - startDate) / (1000 * 60 * 60 * 24)) : 0;

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
      const lastJabD = parseLocalDate(lastJab.date);
      if (!lastJabD) {
        warnInvalidDate('last dose entry', lastJab.date);
      } else {
        nextJabDate = new Date(lastJabD);
        nextJabDate.setDate(nextJabDate.getDate() + days);
        nextJabDate = formatLocalDate(nextJabDate);
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
      nextJabTime: lastJab ? lastJab.time : null,
      daysOnPlan,
      targetWeight,
      weightToGo,
      progressPercent,
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

    const totalLostKg = stats.totalLost;
    const unit = stats.unit;
    const lostLbs = unit === 'lbs' ? totalLostKg : (unit === 'st' ? totalLostKg * 14 : totalLostKg * 2.20462);
    const lostInUnit = totalLostKg;
    const pctLost = stats.startWeight > 0 ? (totalLostKg / stats.startWeight) * 100 : 0;

    // First 5 lbs / 2.3 kg / 0.36 st
    const first5Threshold = unit === 'lbs' ? 5 : (unit === 'st' ? 0.5 : 2);
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
      const val = parseFloat(weights[i].weight);
      windowSum += val;
      windowCount++;

      while (windowStart < i && (endTime - weights[windowStart]._localDate.getTime()) > windowMs) {
        windowSum -= parseFloat(weights[windowStart].weight);
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

      const bFirst = parseFloat(before[0].weight);
      const bLast = parseFloat(before[before.length - 1].weight);
      const bDays = (before[before.length - 1]._localDate - before[0]._localDate) / (1000 * 60 * 60 * 24);
      const rateBefore = bDays > 0 ? Math.round(((bFirst - bLast) / bDays) * 7 * 10) / 10 : 0;

      const aFirst = parseFloat(after[0].weight);
      const aLast = parseFloat(after[after.length - 1].weight);
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
    const first = parseFloat(periodWeights[0].weight);
    const last = parseFloat(periodWeights[periodWeights.length - 1].weight);
    const days = (periodWeights[periodWeights.length - 1]._localDate - periodWeights[0]._localDate) / (1000 * 60 * 60 * 24);
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
    convertWeight, convertAllWeights,
    exportData, exportCSV, importData,
    exportEncryptedBackup, importBackupData,
    getBackupSizeInfo,
    generateBackupLink, generateMetadataBackupLink, importFromBackupLink,
    SAFE_BACKUP_LINK_CHARS,
    parseLocalDate, formatLocalDate,
    clearAll,
  };
})();
