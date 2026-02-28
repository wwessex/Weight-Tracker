// Jab It: Weight Loss Tracker - Main Application Controller
const App = (() => {
  let weightSummaryChart, weightFullChart, doseChart, doseRingChart;
  let currentProgressRange = 'all';
  let currentDoseRange = 'all';
  let countdownInterval = null;
  let remindersInterval = null;
  let reminderSyncCapabilities = null;
  let isUiBound = false;
  let isHashListenerBound = false;
  let isGlobalListenersBound = false;
  let isPhotoStorageChecked = false;
  const REMINDER_CHECK_INTERVAL_MS = 30 * 60 * 1000;
  const REMINDER_CATCH_UP_INTERVAL_MS = 2 * 60 * 60 * 1000;

  // ===== INIT =====
  function init() {
    applyTheme();
    bindGlobalListeners();
    const profile = Store.getProfile();
    if (!profile.name) {
      document.getElementById('onboarding-modal').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      initOnboarding();
    } else {
      document.getElementById('onboarding-modal').style.display = 'none';
      document.getElementById('app').style.display = '';
      bootApp();
    }
    registerServiceWorker();
  }

  function bootApp() {
    bindUiOnce();
    refreshApp();
  }

  function bindGlobalListeners() {
    if (isGlobalListenersBound) return;
    window.addEventListener('beforeunload', teardownReminderChecks);
    window.addEventListener('focus', handleAppResume);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    }
    isGlobalListenersBound = true;
  }

  function bindUiOnce() {
    if (isUiBound) return;

    initNavigation();
    initSummaryPage();
    initDosesPage();
    initProgressPage();
    initSettingsPage();
    initModals();

    if (!isPhotoStorageChecked) {
      isPhotoStorageChecked = true;
      Store.ensurePhotoStorageReady().catch(() => {
        toast('Photo storage is unavailable in this browser.', 'error');
      });
    }

    if (!isHashListenerBound) {
      window.addEventListener('hashchange', handleHashChange);
      isHashListenerBound = true;
    }

    isUiBound = true;
  }

  function refreshApp() {
    teardownReminderChecks();
    applyTheme();
    renderAllPages();
    handleHashChange();
    // Show tour if first time
    const settings = Store.getSettings();
    if (!settings.onboardingComplete) {
      setTimeout(startTour, 800);
    }
    // Schedule reminder checks
    checkReminders({ source: 'app-load', isCatchUp: true });
    scheduleReminderChecks();
    ensureBackgroundReminderScheduling();
  }

  function renderAllPages() {
    refreshSummary();
    refreshDoses();
    refreshProgress();
    refreshSettings();
  }

  function teardownReminderChecks() {
    if (remindersInterval) {
      clearInterval(remindersInterval);
      remindersInterval = null;
    }
  }

  function scheduleReminderChecks() {
    teardownReminderChecks();
    const settings = Store.getSettings();
    if (!settings.doseReminderEnabled && !settings.weighInReminderEnabled) return;
    remindersInterval = setInterval(checkReminders, REMINDER_CHECK_INTERVAL_MS);
  }

  // ===== PWA SERVICE WORKER =====
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(() => {
          detectReminderCapabilities();
          ensureBackgroundReminderScheduling();
        })
        .catch(() => {
          reminderSyncCapabilities = null;
          refreshReminderCapabilityStatus();
        });
    } else {
      reminderSyncCapabilities = null;
      refreshReminderCapabilityStatus();
    }
  }

  // ===== ONBOARDING =====
  function initOnboarding() {
    document.getElementById('onboarding-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const profile = {
        name: document.getElementById('ob-name').value.trim(),
        height: document.getElementById('ob-height').value,
        heightUnit: document.getElementById('ob-height-unit').value,
        startWeight: document.getElementById('ob-weight').value,
        startDate: formatLocalDate(new Date()),
        medication: document.getElementById('ob-medication').value,
        age: '',
      };
      Store.saveProfile(profile);

      const weightUnit = document.getElementById('ob-weight-unit').value;
      Store.saveSettings({ ...Store.getSettings(), weightUnit });

      const targetWeight = document.getElementById('ob-target').value;
      Store.saveGoals({ ...Store.getGoals(), targetWeight });

      Store.addWeight({
        date: profile.startDate,
        weight: profile.startWeight,
        note: 'Starting weight',
      });

      document.getElementById('onboarding-modal').style.display = 'none';
      document.getElementById('app').style.display = '';
      bootApp();
      toast('Welcome! Your journey starts now.', 'success');
    });
  }

  // ===== ONBOARDING TOUR =====
  function startTour() {
    const steps = [
      { text: 'Welcome to Jab It! This is your Summary dashboard. It shows your key stats, streaks, and upcoming doses at a glance.' },
      { text: 'Use these quick action buttons to log a medication dose or record your weight in seconds.' },
      { text: 'Your stats grid shows weight lost, BMI, progress toward your goal, and more. Cards update in real-time.' },
      { text: 'Navigate between Summary, Doses, Progress, and Settings using the bottom tabs.' },
      { text: "You're all set! Head to Settings to customise reminders, themes, and export options. Good luck on your journey!" },
    ];
    let step = 0;
    const overlay = document.getElementById('tour-overlay');
    const tooltip = document.getElementById('tour-tooltip');
    const text = document.getElementById('tour-text');
    const label = document.getElementById('tour-step-label');
    const nextBtn = document.getElementById('tour-next');
    const skipBtn = document.getElementById('tour-skip');

    function show() {
      if (step >= steps.length) {
        overlay.style.display = 'none';
        const settings = Store.getSettings();
        settings.onboardingComplete = true;
        Store.saveSettings(settings);
        return;
      }
      label.textContent = 'Step ' + (step + 1) + ' of ' + steps.length;
      text.textContent = steps[step].text;
      nextBtn.textContent = step === steps.length - 1 ? 'Done' : 'Next';
      overlay.style.display = 'flex';
    }

    nextBtn.onclick = () => { step++; show(); };
    skipBtn.onclick = () => {
      overlay.style.display = 'none';
      const settings = Store.getSettings();
      settings.onboardingComplete = true;
      Store.saveSettings(settings);
    };
    show();
  }

  // ===== NAVIGATION =====
  function initNavigation() {
    document.querySelectorAll('.nav-tab, [data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        const page = link.dataset.page;
        if (page) {
          e.preventDefault();
          navigateTo(page);
        }
      });
    });
  }

  function navigateTo(page) {
    // Clear countdown timer when leaving summary page
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(l => {
      l.classList.remove('active');
      l.setAttribute('aria-selected', 'false');
    });

    const pageEl = document.getElementById('page-' + page);
    const navEl = document.querySelector(`.nav-tab[data-page="${page}"]`);
    if (pageEl) pageEl.classList.add('active');
    if (navEl) {
      navEl.classList.add('active');
      navEl.setAttribute('aria-selected', 'true');
    }

    window.location.hash = page;

    if (page === 'summary') refreshSummary();
    if (page === 'doses') refreshDoses();
    if (page === 'progress') refreshProgress();
    if (page === 'settings') refreshSettings();
  }

  function handleHashChange() {
    const hash = window.location.hash.replace('#', '') || 'summary';
    navigateTo(hash);
  }

  // ===== THEME =====
  function applyTheme() {
    const settings = Store.getSettings();
    let theme = settings.theme || 'light';
    if (theme === 'auto') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
    // Update meta theme-color for Safari status bar
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const colors = { light: '#f8fafc', dark: '#0f172a', calm: '#f5f0eb' };
      meta.content = colors[theme] || '#f8fafc';
    }
    // Update apple-mobile-web-app-status-bar-style for iOS Safari
    const appleMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (appleMeta) {
      appleMeta.content = theme === 'dark' ? 'black' : 'default';
    }
  }

  // Listen for system theme changes (relevant when theme is set to 'auto')
  (function initAutoThemeListener() {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    function onSystemThemeChange() {
      var settings = Store.getSettings();
      if (settings.theme === 'auto') {
        applyTheme();
      }
    }
    // Safari supports addEventListener on MediaQueryList since Safari 14,
    // but older versions only support the deprecated addListener
    if (mq.addEventListener) {
      mq.addEventListener('change', onSystemThemeChange);
    } else if (mq.addListener) {
      mq.addListener(onSystemThemeChange);
    }
  })();

  // ===== ANIMATION HELPERS =====
  function animateValue(el, end, duration, suffix) {
    if (!el || end === null || end === undefined || isNaN(end)) return;
    duration = duration || 600;
    suffix = suffix || '';
    const start = 0;
    const range = parseFloat(end) - start;
    const isInt = Number.isInteger(parseFloat(end));
    const startTime = performance.now();
    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + range * eased;
      el.textContent = (isInt ? Math.round(current) : current.toFixed(1)) + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  function staggerListItems(selector) {
    const items = document.querySelectorAll(selector);
    items.forEach((item, i) => {
      item.style.animationDelay = (Math.min(i, 15) * 0.04) + 's';
    });
  }

  function createChartGradient(ctx, colorTop, colorBottom) {
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, colorTop);
    gradient.addColorStop(1, colorBottom);
    return gradient;
  }

  // ===== HELPERS =====
  function formatWeight(val) {
    const unit = Store.getSettings().weightUnit;
    if (val === null || val === undefined || isNaN(val)) return '--';
    return parseFloat(val).toFixed(1) + ' ' + unit;
  }

  function formatWeightShort(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return parseFloat(val).toFixed(1);
  }

  // Reuse Store's date parsing utilities (single source of truth)
  const parseLocalDate = Store.parseLocalDate;
  const formatLocalDate = Store.formatLocalDate;

  function toLocalDayNumber(value) {
    const date = parseLocalDate(value);
    if (!date) return null;
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (1000 * 60 * 60 * 24));
  }

  function dayDiff(fromValue, toValue) {
    const fromDay = toLocalDayNumber(fromValue);
    const toDay = toLocalDayNumber(toValue);
    if (fromDay === null || toDay === null) return null;
    return toDay - fromDay;
  }

  function normalizeDateEntries(entries, context) {
    return entries.map((entry) => {
      const localDate = parseLocalDate(entry.date);
      if (!localDate) {
        console.warn(`[App] Skipping ${context} with invalid date:`, entry && entry.date);
        return null;
      }
      return {
        ...entry,
        _localDate: localDate,
      };
    }).filter(Boolean);
  }

  function formatDate(dateStr) {
    const d = parseLocalDate(dateStr);
    if (!d) return '--';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateShort(dateStr) {
    const d = parseLocalDate(dateStr);
    if (!d) return '--';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function daysAgo(dateStr) {
    const diff = dayDiff(dateStr, new Date());
    if (diff === null) return '--';
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return diff + 'd ago';
  }

  function daysUntil(dateStr) {
    const diff = dayDiff(new Date(), dateStr);
    if (diff === null) return '--';
    if (diff <= 0) return 'Overdue';
    if (diff === 1) return 'Tomorrow';
    return diff + ' days';
  }

  function toast(msg, type) {
    type = type || '';
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    t.setAttribute('role', 'status');
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add('dismissing');
      t.addEventListener('animationend', () => t.remove());
    }, 3000);
  }

  function getBmiLabel(bmi) {
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Healthy';
    if (bmi < 30) return 'Overweight';
    if (bmi < 35) return 'Obese I';
    return 'Obese II+';
  }

  function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const isCalm = document.documentElement.getAttribute('data-theme') === 'calm';
    if (isCalm) {
      return {
        primary: '#7c8bbf',
        primaryLight: 'rgba(124,139,191,0.15)',
        teal: '#5b9a8b',
        tealLight: 'rgba(91,154,139,0.15)',
        success: '#7fb5a0',
        danger: '#c07070',
        text: '#3d3832',
        textMuted: '#9a8f84',
        grid: 'rgba(154,143,132,0.15)',
      };
    }
    return {
      primary: '#6366f1',
      primaryLight: 'rgba(99,102,241,0.15)',
      teal: '#14b8a6',
      tealLight: 'rgba(20,184,166,0.15)',
      success: '#10b981',
      danger: '#ef4444',
      text: isDark ? '#f1f5f9' : '#0f172a',
      textMuted: isDark ? '#64748b' : '#94a3b8',
      grid: isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.15)',
    };
  }

  function destroyChart(chart) {
    if (chart) chart.destroy();
    return null;
  }

  function medicationLabel(med) {
    const labels = {
      semaglutide: 'Semaglutide',
      tirzepatide: 'Tirzepatide',
      liraglutide: 'Liraglutide',
      other: 'Other',
      none: 'None',
    };
    return labels[med] || med;
  }

  function siteLabel(site) {
    const labels = {
      'abdomen-left': 'Abdomen (L)',
      'abdomen-right': 'Abdomen (R)',
      'thigh-left': 'Thigh (L)',
      'thigh-right': 'Thigh (R)',
      'arm-left': 'Arm (L)',
      'arm-right': 'Arm (R)',
    };
    return labels[site] || site || '--';
  }

  function nsvCategoryIcon(cat) {
    const icons = { fitness: '&#x1F3C3;', clothing: '&#x1F455;', energy: '&#x26A1;', health: '&#x1F49A;', confidence: '&#x2B50;', other: '&#x1F4DD;' };
    return icons[cat] || icons.other;
  }

  // ===== FOCUS TRAP (Accessibility) =====
  function trapFocus(modal) {
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    function handler(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    modal._focusTrap = handler;
    modal.addEventListener('keydown', handler);
    first.focus();
  }

  function releaseFocus(modal) {
    if (modal._focusTrap) {
      modal.removeEventListener('keydown', modal._focusTrap);
      delete modal._focusTrap;
    }
  }

  function openModal(modal) {
    modal.style.display = 'flex';
    trapFocus(modal);
    // Close on Escape
    modal._escHandler = (e) => { if (e.key === 'Escape') closeModal(modal); };
    document.addEventListener('keydown', modal._escHandler);
  }

  function closeModal(modal) {
    modal.style.display = 'none';
    releaseFocus(modal);
    if (modal._escHandler) {
      document.removeEventListener('keydown', modal._escHandler);
      delete modal._escHandler;
    }
  }

  // ===== REMINDERS (Web Notifications API) =====
  function canUseNativeNotifications() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  function canUseServiceWorkerNotifications() {
    return 'serviceWorker' in navigator && 'PushManager' in window;
  }

  async function detectReminderCapabilities() {
    const supportsBackgroundSync = 'serviceWorker' in navigator && 'SyncManager' in window;
    const supportsPeriodicSync = 'serviceWorker' in navigator && 'PeriodicSyncManager' in window;
    reminderSyncCapabilities = {
      backgroundSync: supportsBackgroundSync,
      periodicSync: supportsPeriodicSync,
    };
    refreshReminderCapabilityStatus();
    return reminderSyncCapabilities;
  }

  function getReminderCapabilityStatus() {
    if (canUseNativeNotifications()) return 'native push';
    if (canUseServiceWorkerNotifications()) return 'native push';
    if (reminderSyncCapabilities && (reminderSyncCapabilities.periodicSync || reminderSyncCapabilities.backgroundSync)) {
      return 'native push';
    }
    return 'in-app only';
  }

  function refreshReminderCapabilityStatus() {
    const statusEl = document.getElementById('reminder-capability-status');
    if (!statusEl) return;
    statusEl.textContent = getReminderCapabilityStatus();
  }

  async function ensureBackgroundReminderScheduling() {
    refreshReminderCapabilityStatus();
    const settings = Store.getSettings();
    if (!settings.doseReminderEnabled && !settings.weighInReminderEnabled) return;
    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;

      if ('periodicSync' in registration) {
        try {
          await registration.periodicSync.register('jabit-reminder-check', {
            minInterval: REMINDER_CHECK_INTERVAL_MS,
          });
          return;
        } catch {
          // Permission denied or unsupported; fall back to one-off sync where possible.
        }
      }

      if ('sync' in registration) {
        try {
          await registration.sync.register('jabit-reminder-check');
        } catch {
          // Best-effort only.
        }
      }
    } catch {
      // Keep in-app interval fallback only.
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    handleAppResume();
  }

  function handleAppResume() {
    checkReminders({ source: 'resume', isCatchUp: true });
    ensureBackgroundReminderScheduling();
  }

  function handleServiceWorkerMessage(event) {
    if (!event || !event.data) return;
    if (event.data.type === 'CHECK_REMINDERS') {
      checkReminders({ source: 'sw-sync', isCatchUp: true });
    }
  }

  function showReminderBanner(type, message) {
    var container = document.getElementById('reminder-banners');
    if (!container) return;
    var icon = type === 'dose' ? '💉' : '⚖️';
    var banner = document.createElement('div');
    banner.className = 'reminder-banner ' + type;
    banner.innerHTML = '<span class="reminder-banner-icon">' + icon + '</span>' +
      '<span class="reminder-banner-text">' + message + '</span>' +
      '<button class="reminder-banner-dismiss" aria-label="Dismiss">&times;</button>';
    banner.querySelector('.reminder-banner-dismiss').addEventListener('click', function() {
      banner.style.animation = 'toastOut 0.3s ease forwards';
      banner.addEventListener('animationend', function() { banner.remove(); });
    });
    container.appendChild(banner);
  }

  async function sendReminder(title, message, type) {
    if (canUseNativeNotifications()) {
      new Notification(title, { body: message, icon: 'icons/icon-192.png' });
      return;
    }

    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration && registration.showNotification) {
          await registration.showNotification(title, { body: message, icon: 'icons/icon-192.png', tag: type });
          return;
        }
      } catch {
        // Fall through to in-app banner.
      }
    }

    showReminderBanner(type, message);
  }

  function getReminderDedupState() {
    const settings = Store.getSettings();
    if (!settings.reminderDedup || typeof settings.reminderDedup !== 'object') {
      settings.reminderDedup = {};
      Store.saveSettings(settings);
    }
    return { settings, dedup: settings.reminderDedup };
  }

  function shouldSendReminder(type, dedupKey) {
    const { settings, dedup } = getReminderDedupState();
    if (dedup[type] === dedupKey) return false;
    dedup[type] = dedupKey;
    settings.reminderDedup = dedup;
    Store.saveSettings(settings);
    return true;
  }

  function getDoseReminderWindowKey(diff) {
    if (diff === 0) return 'due-window:' + formatLocalDate(new Date());
    if (diff < 0) {
      const overdueDays = Math.abs(diff);
      const now = new Date();
      const windowStart = new Date(now);
      windowStart.setDate(now.getDate() - overdueDays);
      return 'overdue-window:' + formatLocalDate(windowStart) + ':' + formatLocalDate(now);
    }
    return null;
  }

  function getWeighInReminderWindowKey(daysSince, threshold) {
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(now.getDate() - Math.max(daysSince, threshold));
    return 'weigh-window:' + threshold + ':' + formatLocalDate(windowStart) + ':' + formatLocalDate(now);
  }

  function shouldRunCatchUpCheck(lastReminderCheckAt) {
    if (!lastReminderCheckAt) return true;
    const parsed = new Date(lastReminderCheckAt);
    if (Number.isNaN(parsed.getTime())) return true;
    return (Date.now() - parsed.getTime()) >= REMINDER_CATCH_UP_INTERVAL_MS;
  }

  function checkReminders(options = {}) {
    const settings = Store.getSettings();
    var container = document.getElementById('reminder-banners');
    if (container) container.innerHTML = '';

    const isCatchUp = !!options.isCatchUp;

    if (!settings.doseReminderEnabled && !settings.weighInReminderEnabled) {
      refreshReminderCapabilityStatus();
      return;
    }

    if (isCatchUp && !shouldRunCatchUpCheck(settings.lastReminderCheckAt)) {
      refreshReminderCapabilityStatus();
      return;
    }

    const stats = Store.getStats();

    // Check dose reminder
    if (settings.doseReminderEnabled && stats.nextJabDate) {
      const diff = dayDiff(new Date(), stats.nextJabDate);
      if (diff === 0) {
        const dedupKey = getDoseReminderWindowKey(diff);
        if (shouldSendReminder('dose', dedupKey)) {
          sendReminder('Jab It - Dose Reminder', 'Your dose is due today!', 'dose');
        }
      } else if (diff < 0) {
        const dedupKey = getDoseReminderWindowKey(diff);
        if (shouldSendReminder('dose', dedupKey)) {
          sendReminder('Jab It - Dose Overdue', 'Your dose is ' + Math.abs(diff) + ' day(s) overdue.', 'dose');
        }
      }
    }

    // Check weigh-in reminder
    if (settings.weighInReminderEnabled) {
      const weights = Store.getWeights();
      if (weights.length > 0) {
        const daysSince = dayDiff(weights[weights.length - 1].date, new Date());
        if (daysSince === null) {
          console.warn('[App] Skipping weigh-in reminder due to invalid last weight date:', weights[weights.length - 1].date);
        } else {
          const scheduleMap = { daily: 1, every3: 3, weekly: 7 };
          const threshold = scheduleMap[settings.weighInSchedule] || 7;
          if (daysSince >= threshold) {
            const dedupKey = getWeighInReminderWindowKey(daysSince, threshold);
            if (shouldSendReminder('weighin', dedupKey)) {
              sendReminder('Jab It - Weigh-in Reminder', "It's been " + daysSince + ' days since your last weigh-in.', 'weighin');
            }
          }
        }
      }
    }

    settings.lastReminderCheckAt = new Date().toISOString();
    Store.saveSettings(settings);
    refreshReminderCapabilityStatus();
  }

  // ===== INIT ALL EXTRA MODALS =====
  function initModals() {
    // NSV Modal
    const nsvModal = document.getElementById('nsv-modal');
    const nsvForm = document.getElementById('nsv-form');
    document.getElementById('nsv-modal-close').addEventListener('click', () => closeModal(nsvModal));
    document.getElementById('nsv-form-cancel').addEventListener('click', () => closeModal(nsvModal));
    nsvModal.addEventListener('click', (e) => { if (e.target === nsvModal) closeModal(nsvModal); });
    nsvForm.addEventListener('submit', (e) => {
      e.preventDefault();
      Store.addVictory({
        date: document.getElementById('nsv-date').value,
        category: document.getElementById('nsv-category').value,
        text: document.getElementById('nsv-text').value,
      });
      closeModal(nsvModal);
      toast('Victory logged!', 'success');
      refreshProgress();
    });

    // Photo Modal
    const photoModal = document.getElementById('photo-modal');
    const photoForm = document.getElementById('photo-form');
    document.getElementById('photo-modal-close').addEventListener('click', () => closeModal(photoModal));
    document.getElementById('photo-form-cancel').addEventListener('click', () => closeModal(photoModal));
    photoModal.addEventListener('click', (e) => { if (e.target === photoModal) closeModal(photoModal); });
    photoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = document.getElementById('photo-file').files[0];
      if (!file) return;
      const date = document.getElementById('photo-date').value;
      const note = document.getElementById('photo-note').value;
      const attempts = [
        { maxWidth: 1200, quality: 0.82 },
        { maxWidth: 900, quality: 0.7 },
        { maxWidth: 700, quality: 0.55 },
        { maxWidth: 500, quality: 0.45 },
      ];

      try {
        let saved = false;
        let quotaError = null;
        for (let i = 0; i < attempts.length && !saved; i++) {
          const candidate = await resizeImage(file, attempts[i].maxWidth, attempts[i].quality);
          try {
            await Store.addPhoto({ date, note, blob: candidate.blob });
            saved = true;
            closeModal(photoModal);
            toast(i > 0 ? 'Photo saved (compressed to fit storage).' : 'Photo saved!', 'success');
            await refreshProgress();
          } catch (error) {
            if (error && error.code === 'QUOTA_EXCEEDED') {
              quotaError = error;
            } else {
              throw error;
            }
          }
        }

        if (!saved && quotaError) {
          toast('Storage full: unable to save photo. Delete older photos or use a smaller image.', 'error');
        }
      } catch {
        toast('Failed to save photo. Please try again.', 'error');
      }
    });

    // Photo Viewer
    const viewerModal = document.getElementById('photo-viewer-modal');
    document.getElementById('photo-viewer-close').addEventListener('click', () => closeModal(viewerModal));
    viewerModal.addEventListener('click', (e) => { if (e.target === viewerModal) closeModal(viewerModal); });

    // Share Card Modal
    const shareModal = document.getElementById('share-modal');
    document.getElementById('share-modal-close').addEventListener('click', () => closeModal(shareModal));
    shareModal.addEventListener('click', (e) => { if (e.target === shareModal) closeModal(shareModal); });
    document.getElementById('btn-download-card').addEventListener('click', downloadShareCard);

    // Missed Dose Modal
    const missedModal = document.getElementById('missed-dose-modal');
    const missedForm = document.getElementById('missed-dose-form');
    document.getElementById('missed-dose-modal-close').addEventListener('click', () => closeModal(missedModal));
    document.getElementById('missed-dose-cancel').addEventListener('click', () => closeModal(missedModal));
    missedModal.addEventListener('click', (e) => { if (e.target === missedModal) closeModal(missedModal); });
    missedForm.addEventListener('submit', (e) => {
      e.preventDefault();
      Store.addJab({
        date: document.getElementById('missed-dose-date').value,
        time: '',
        medication: Store.getProfile().medication || 'semaglutide',
        dose: 0,
        doseUnit: 'mg',
        site: '',
        sideEffects: [],
        notes: 'MISSED - ' + (document.getElementById('missed-dose-reason').value || 'No reason given'),
      });
      closeModal(missedModal);
      toast('Missed dose logged', 'success');
      refreshSummary();
      refreshDoses();
    });
  }

  // Image resize helper
  function resizeImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width;
          let h = img.height;
          if (w > maxWidth) {
            h = (h * maxWidth) / w;
            w = maxWidth;
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Unable to process image'));
              return;
            }
            resolve({ blob, dataUrl: canvas.toDataURL('image/jpeg', quality) });
          }, 'image/jpeg', quality);
        };
        img.onerror = () => reject(new Error('Invalid image file'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Unable to read image file'));
      reader.readAsDataURL(file);
    });
  }

  // ===== SUMMARY PAGE =====
  function initSummaryPage() {
    document.getElementById('btn-quick-dose').addEventListener('click', () => openDoseModal());
    document.getElementById('btn-quick-weight').addEventListener('click', () => openWeightModal());

    // Missed dose actions
    document.getElementById('btn-log-overdue').addEventListener('click', () => openDoseModal());
    document.getElementById('btn-log-missed').addEventListener('click', () => {
      const stats = Store.getStats();
      document.getElementById('missed-dose-date').value = stats.nextJabDate || formatLocalDate(new Date());
      document.getElementById('missed-dose-reason').value = '';
      openModal(document.getElementById('missed-dose-modal'));
    });

    refreshSummary();
  }

  function refreshSummary() {
    const stats = Store.getStats();
    const unit = Store.getSettings().weightUnit;

    // Streak & Milestones
    const streakData = Store.getStreakData();
    const milestones = Store.getMilestones();
    const row = document.getElementById('streak-milestones-row');
    const combinedStreak = Math.max(streakData.weightStreak, streakData.doseStreak);

    if (combinedStreak > 0 || milestones.length > 0) {
      row.style.display = 'flex';
      const counter = document.getElementById('streak-counter');
      if (combinedStreak > 0) {
        counter.style.display = 'inline-flex';
        document.getElementById('streak-value').textContent = combinedStreak;
        document.getElementById('streak-label').textContent = combinedStreak === 1 ? 'week streak' : 'week streak';
      } else {
        counter.style.display = 'none';
      }
      const mRow = document.getElementById('milestones-row');
      mRow.innerHTML = milestones.map((m, i) =>
        '<span class="milestone-badge" style="animation-delay:' + (i * 0.1) + 's">' +
        '<span class="milestone-badge-icon">' + m.icon + '</span>' +
        m.label + '</span>'
      ).join('');
    } else {
      row.style.display = 'none';
    }

    // Missed dose banner
    const banner = document.getElementById('missed-dose-banner');
    if (stats.nextJabDate) {
      const diff = dayDiff(new Date(), stats.nextJabDate);
      if (diff < 0) {
        banner.style.display = '';
        document.getElementById('missed-dose-text').textContent = 'Dose overdue by ' + Math.abs(diff) + ' day(s)!';
      } else {
        banner.style.display = 'none';
      }
    } else {
      banner.style.display = 'none';
    }

    // Stats grid with animated counters
    if (stats.totalJabs > 0) {
      animateValue(document.getElementById('sum-total-doses'), stats.totalJabs, 600, '');
    } else {
      document.getElementById('sum-total-doses').textContent = '0';
    }

    if (stats.totalLost) {
      animateValue(document.getElementById('sum-weight-lost'), stats.totalLost, 600, ' ' + unit);
    } else {
      document.getElementById('sum-weight-lost').textContent = '--';
    }

    if (stats.currentWeight) {
      animateValue(document.getElementById('sum-current'), stats.currentWeight, 600, ' ' + unit);
    } else {
      document.getElementById('sum-current').textContent = '--';
    }

    if (stats.weightToGo !== null) {
      animateValue(document.getElementById('sum-to-goal'), stats.weightToGo, 600, ' ' + unit);
    } else {
      document.getElementById('sum-to-goal').textContent = '--';
    }

    if (stats.progressPercent > 0) {
      animateValue(document.getElementById('sum-pct-lost'), stats.progressPercent, 600, '%');
    } else {
      document.getElementById('sum-pct-lost').textContent = '--';
    }

    if (stats.bmi) {
      animateValue(document.getElementById('sum-bmi'), stats.bmi, 600, '');
    } else {
      document.getElementById('sum-bmi').textContent = '--';
    }

    // Projected goal date
    const projDate = Store.getProjectedGoalDate();
    const projCard = document.getElementById('projected-goal-card');
    if (projDate) {
      projCard.style.display = 'flex';
      document.getElementById('projected-goal-text').textContent =
        "At this rate, you'll reach your goal around " + formatDate(projDate) + '.';
    } else {
      projCard.style.display = 'none';
    }

    // Period summary card
    renderPeriodSummary(stats);

    // Mini sparkline
    renderSparkline();

    // Next dose ring
    renderDoseRing(stats);

    // Weight trend chart
    renderWeightSummaryChart();
  }

  function renderPeriodSummary(stats) {
    const card = document.getElementById('period-summary-card');
    const period = Store.getPeriodSummary();
    const unit = stats.unit;

    const hasData = period.dosesThisWeek > 0 || period.dosesThisMonth > 0
      || period.weighInsThisWeek > 0 || period.weighInsThisMonth > 0;

    if (!hasData) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';

    function formatChange(val) {
      if (val === null || val === undefined) return { text: '--', cls: '' };
      const sign = val > 0 ? '+' : '';
      const cls = val < 0 ? 'loss' : val > 0 ? 'gain' : '';
      return { text: sign + val.toFixed(1) + ' ' + unit, cls };
    }

    const weekWeight = formatChange(stats.weightChange7d);
    const monthWeight = formatChange(stats.weightChange30d);

    const psWeekWeight = document.getElementById('ps-week-weight');
    psWeekWeight.textContent = weekWeight.text;
    psWeekWeight.className = 'period-summary-value' + (weekWeight.cls ? ' ' + weekWeight.cls : '');

    document.getElementById('ps-week-doses').textContent = period.dosesThisWeek;
    document.getElementById('ps-week-weighins').textContent = period.weighInsThisWeek;

    const psMonthWeight = document.getElementById('ps-month-weight');
    psMonthWeight.textContent = monthWeight.text;
    psMonthWeight.className = 'period-summary-value' + (monthWeight.cls ? ' ' + monthWeight.cls : '');

    document.getElementById('ps-month-doses').textContent = period.dosesThisMonth;
    document.getElementById('ps-month-weighins').textContent = period.weighInsThisMonth;
  }

  function renderSparkline() {
    const weights = Store.getWeights();
    const card = document.getElementById('sparkline-card');
    const canvas = document.getElementById('sparkline-canvas');
    const changeEl = document.getElementById('sparkline-change');

    const normalizedWeights = normalizeDateEntries(weights, 'weight trend entry');
    const cutoff = parseLocalDate(new Date());
    cutoff.setDate(cutoff.getDate() - 30);
    const filtered = normalizedWeights.filter(w => w._localDate >= cutoff);

    if (filtered.length < 2) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = 4;

    ctx.clearRect(0, 0, w, h);

    const values = filtered.map(x => parseFloat(x.weight));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = getChartColors().primary;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    values.forEach((v, i) => {
      const x = padding + (i / (values.length - 1)) * (w - padding * 2);
      const y = h - padding - ((v - min) / range) * (h - padding * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Change label
    const change = values[values.length - 1] - values[0];
    const unit = Store.getSettings().weightUnit;
    const sign = change > 0 ? '+' : '';
    changeEl.textContent = sign + change.toFixed(1) + ' ' + unit;
    changeEl.className = 'sparkline-change ' + (change > 0 ? 'positive' : 'negative');
  }

  function renderDoseRing(stats) {
    doseRingChart = destroyChart(doseRingChart);
    const ctx = document.getElementById('chart-dose-ring').getContext('2d');
    const colors = getChartColors();

    const ringValue = document.getElementById('dose-ring-value');
    const ringSub = document.getElementById('dose-ring-sub');
    const ringInfo = document.getElementById('dose-ring-info');
    const detail = document.getElementById('dose-countdown-detail');

    // Clear any existing countdown
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    if (!stats.nextJabDate) {
      ringValue.textContent = '--';
      ringSub.textContent = '';
      ringInfo.textContent = 'No doses logged yet';
      detail.style.display = 'none';
      // Draw empty ring
      doseRingChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          datasets: [{
            data: [1],
            backgroundColor: [colors.grid],
            borderWidth: 0,
            cutout: '78%',
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        },
      });
      return;
    }

    const profile = Store.getProfile();
    const freq = profile.frequency || 'weekly';
    const freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
    const cycleDays = freqDays[freq] || 7;

    function updateCountdown() {
      const now = new Date();
      const targetDate = parseLocalDate(stats.nextJabDate);
      if (!targetDate) {
        console.warn('[App] Invalid next jab date for countdown:', stats.nextJabDate);
        return;
      }
      const target = new Date(targetDate);
      target.setHours(23, 59, 59, 999);
      const diffMs = target - now;
      const diffDays = dayDiff(new Date(), stats.nextJabDate);
      const diffHours = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));

      if (diffMs <= 0) {
        ringValue.textContent = 'Due!';
        ringSub.textContent = '';
        ringInfo.textContent = 'Time for your next dose';
        detail.style.display = 'none';
      } else if (diffDays <= 1) {
        ringValue.textContent = diffHours;
        ringSub.textContent = diffHours === 1 ? 'hour' : 'hours';
        ringInfo.textContent = 'until next dose';
        detail.style.display = 'block';
        detail.textContent = 'Due ' + formatDate(stats.nextJabDate);
      } else {
        ringValue.textContent = diffDays;
        ringSub.textContent = diffDays === 1 ? 'day' : 'days';
        ringInfo.textContent = 'until next dose';
        detail.style.display = 'block';
        detail.textContent = diffDays + 'd ' + diffHours + 'h remaining';
      }
    }
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 60000);

    const diff = dayDiff(new Date(), stats.nextJabDate);
    const elapsed = cycleDays - Math.max(0, diff);
    const progress = Math.max(0, Math.min(1, elapsed / cycleDays));

    doseRingChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [progress * 100, (1 - progress) * 100],
          backgroundColor: ['#14b8a6', colors.grid],
          borderWidth: 0,
          cutout: '78%',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        rotation: -90,
        circumference: 360,
        animation: {
          animateRotate: true,
          duration: 1000,
          easing: 'easeOutQuart',
        },
      },
    });
  }

  function renderWeightSummaryChart() {
    const weights = Store.getWeights();
    const colors = getChartColors();

    // Show last 30 days on summary
    const normalizedWeights = normalizeDateEntries(weights, 'weight trend entry');
    const cutoff = parseLocalDate(new Date());
    cutoff.setDate(cutoff.getDate() - 30);
    const filtered = normalizedWeights.filter(w => w._localDate >= cutoff);

    const ctx = document.getElementById('chart-weight-summary').getContext('2d');

    const data = filtered.length > 0 ? filtered : normalizedWeights;
    if (data.length === 0) {
      weightSummaryChart = destroyChart(weightSummaryChart);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    const gradient = createChartGradient(ctx, 'rgba(99,102,241,0.3)', 'rgba(99,102,241,0.01)');

    // Build datasets: weight line + optional moving average
    const newLabels = data.map(w => w.date);
    const weightData = data.map(w => parseFloat(w.weight));
    const movingAvg = Store.getMovingAverage(28);
    const dataDateSet = new Set(newLabels);
    const filteredAvg = movingAvg.filter(ma => dataDateSet.has(ma.date));
    const showLegend = filteredAvg.length >= 2;

    // Update existing chart in place if possible
    if (weightSummaryChart && weightSummaryChart.canvas) {
      weightSummaryChart.data.labels = newLabels;
      weightSummaryChart.data.datasets[0].data = weightData;
      weightSummaryChart.data.datasets[0].borderColor = colors.primary;
      weightSummaryChart.data.datasets[0].backgroundColor = gradient;
      weightSummaryChart.data.datasets[0].pointBackgroundColor = colors.primary;
      weightSummaryChart.data.datasets[0].pointRadius = data.length > 20 ? 0 : 3;

      if (showLegend) {
        if (weightSummaryChart.data.datasets.length < 2) {
          weightSummaryChart.data.datasets.push({
            label: '4-Week Avg', data: [], borderColor: colors.success,
            borderWidth: 2, borderDash: [4, 4], pointRadius: 0, fill: false, tension: 0.4,
          });
        }
        weightSummaryChart.data.datasets[1].data = filteredAvg.map(ma => ma.avg);
        weightSummaryChart.data.datasets[1].borderColor = colors.success;
      } else {
        weightSummaryChart.data.datasets.length = 1;
      }

      weightSummaryChart.options.plugins.legend.display = showLegend;
      weightSummaryChart.options.scales.x.ticks.color = colors.textMuted;
      weightSummaryChart.options.scales.y.grid.color = colors.grid;
      weightSummaryChart.options.scales.y.ticks.color = colors.textMuted;
      weightSummaryChart.update('active');
      return;
    }

    // Create new chart
    const datasets = [{
      label: 'Weight',
      data: weightData,
      borderColor: colors.primary,
      backgroundColor: gradient,
      borderWidth: 2,
      tension: 0.4,
      fill: true,
      pointRadius: data.length > 20 ? 0 : 3,
      pointHoverRadius: 5,
      pointBackgroundColor: colors.primary,
    }];

    if (showLegend) {
      datasets.push({
        label: '4-Week Avg',
        data: filteredAvg.map(ma => ma.avg),
        borderColor: colors.success,
        borderWidth: 2,
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false,
        tension: 0.4,
      });
    }

    weightSummaryChart = new Chart(ctx, {
      type: 'line',
      data: { labels: newLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: showLegend, labels: { color: colors.textMuted, font: { size: 10 } } },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.9)',
            titleColor: '#f1f5f9',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(99,102,241,0.3)',
            borderWidth: 1,
            cornerRadius: 10,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(1) + ' ' + Store.getSettings().weightUnit,
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day', tooltipFormat: 'dd MMM yyyy' },
            grid: { display: false },
            ticks: { color: colors.textMuted, font: { size: 10 }, maxTicksLimit: 6 },
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted, font: { size: 10 }, callback: v => v.toFixed(0) },
          },
        },
      },
    });
  }

  // ===== DOSES PAGE =====
  function initDosesPage() {
    const doseModal = document.getElementById('dose-modal');
    const doseForm = document.getElementById('dose-form');

    document.getElementById('btn-add-dose').addEventListener('click', () => openDoseModal());
    document.getElementById('btn-first-dose').addEventListener('click', () => openDoseModal());

    document.getElementById('dose-modal-close').addEventListener('click', () => closeModal(doseModal));
    document.getElementById('dose-form-cancel').addEventListener('click', () => closeModal(doseModal));
    doseModal.addEventListener('click', (e) => { if (e.target === doseModal) closeModal(doseModal); });

    doseForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('dose-edit-id').value;
      const sideEffects = Array.from(document.querySelectorAll('input[name="side-effect"]:checked')).map(cb => cb.value);
      const entry = {
        date: document.getElementById('dose-date').value,
        time: document.getElementById('dose-time').value,
        medication: document.getElementById('dose-medication').value,
        dose: document.getElementById('dose-amount').value,
        doseUnit: document.getElementById('dose-unit').value,
        site: document.getElementById('dose-site').value,
        sideEffects,
        notes: document.getElementById('dose-notes').value,
      };
      if (id) {
        Store.updateJab(id, entry);
        toast('Dose updated', 'success');
      } else {
        Store.addJab(entry);
        toast('Dose logged!', 'success');
      }
      closeModal(doseModal);
      refreshDoses();
      refreshSummary();
    });

    // Time filter chips
    document.querySelectorAll('#dose-filters .filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dose-filters .filter-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDoseRange = btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range);
        refreshDoses();
      });
    });
  }

  function openDoseModal(id) {
    const modal = document.getElementById('dose-modal');
    const profile = Store.getProfile();

    if (id) {
      const jabs = Store.getJabs();
      const j = jabs.find(x => x.id === id);
      if (!j) return;
      document.getElementById('dose-edit-id').value = id;
      document.getElementById('dose-modal-title').textContent = 'Edit Dose';
      document.getElementById('dose-date').value = j.date;
      document.getElementById('dose-time').value = j.time || '';
      document.getElementById('dose-medication').value = j.medication;
      document.getElementById('dose-amount').value = j.dose;
      document.getElementById('dose-unit').value = j.doseUnit;
      document.getElementById('dose-site').value = j.site || '';
      document.getElementById('dose-notes').value = j.notes || '';
      document.querySelectorAll('input[name="side-effect"]').forEach(cb => {
        cb.checked = j.sideEffects && j.sideEffects.includes(cb.value);
      });
    } else {
      document.getElementById('dose-edit-id').value = '';
      document.getElementById('dose-modal-title').textContent = 'Log Dose';
      document.getElementById('dose-date').value = formatLocalDate(new Date());
      document.getElementById('dose-time').value = new Date().toTimeString().slice(0, 5);
      document.getElementById('dose-medication').value = profile.medication || 'semaglutide';
      document.getElementById('dose-amount').value = '';
      document.getElementById('dose-unit').value = 'mg';
      // Pre-select recommended site
      const siteRec = Store.getNextRecommendedSite();
      document.getElementById('dose-site').value = siteRec.recommended || '';
      document.getElementById('dose-notes').value = '';
      document.querySelectorAll('input[name="side-effect"]').forEach(cb => cb.checked = false);
    }
    openModal(modal);
  }

  function refreshDoses() {
    const jabs = Store.getJabs();
    const empty = document.getElementById('dose-empty');
    const list = document.getElementById('dose-list');
    const chartContainer = document.getElementById('dose-chart-container');

    let filtered = normalizeDateEntries(jabs, 'dose chart/list entry');
    if (currentDoseRange !== 'all') {
      const cutoff = parseLocalDate(new Date());
      cutoff.setDate(cutoff.getDate() - currentDoseRange);
      filtered = filtered.filter(j => j._localDate >= cutoff);
    }

    if (jabs.length === 0) {
      empty.style.display = '';
      list.innerHTML = '';
      chartContainer.style.display = 'none';
      document.getElementById('site-rotation-card').style.display = 'none';
      document.getElementById('side-effect-trends').style.display = 'none';
      document.getElementById('escalation-section').style.display = 'none';
      document.getElementById('correlation-card').style.display = 'none';
      document.getElementById('dose-count').textContent = '0';
      return;
    }

    empty.style.display = 'none';
    chartContainer.style.display = '';
    document.getElementById('dose-count').textContent = filtered.length;

    // Render dose list
    const sorted = [...filtered].reverse();
    list.innerHTML = sorted.map(j => `
      <div class="dose-item">
        <div class="dose-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 2l1.5 1.5L9 5"/><path d="M14 2l1.5 1.5L14 5"/><rect x="4" y="7" width="16" height="14" rx="2"/><path d="M12 11v6"/><path d="M9 14h6"/></svg>
        </div>
        <div class="dose-item-info">
          <div class="dose-item-title">${medicationLabel(j.medication)}</div>
          <div class="dose-item-sub">${formatDateShort(j.date)}${j.site ? ' &middot; ' + siteLabel(j.site) : ''}${j.notes && j.notes.startsWith('MISSED') ? ' &middot; <strong style="color:var(--warning)">Missed</strong>' : ''}</div>
        </div>
        <div class="dose-item-value">${j.dose} ${j.doseUnit}</div>
        <div class="dose-item-actions">
          <button class="btn btn-ghost btn-sm" onclick="App.editDose('${j.id}')" aria-label="Edit dose">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="App.removeDose('${j.id}')" aria-label="Delete dose">Del</button>
        </div>
      </div>
    `).join('');

    staggerListItems('#dose-list .dose-item');
    renderDoseChart(filtered);
    renderSiteRotation();
    renderSideEffectTrends();
    renderDoseEscalation();
    renderDoseWeightCorrelation();
  }

  function renderDoseChart(jabs) {
    const colors = getChartColors();
    doseChart = destroyChart(doseChart);
    const ctx = document.getElementById('chart-doses').getContext('2d');

    if (jabs.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    const gradient = createChartGradient(ctx, 'rgba(20,184,166,0.3)', 'rgba(20,184,166,0.01)');
    doseChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: jabs.map(j => j.date),
        datasets: [{
          label: 'Dose',
          data: jabs.map(j => parseFloat(j.dose)),
          borderColor: colors.teal,
          backgroundColor: gradient,
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: colors.teal,
          stepped: 'after',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.9)',
            titleColor: '#f1f5f9',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(20,184,166,0.3)',
            borderWidth: 1,
            cornerRadius: 10,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: (c) => c.parsed.y + ' ' + (jabs[c.dataIndex]?.doseUnit || 'mg'),
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'dd MMM yyyy' },
            grid: { display: false },
            ticks: { color: colors.textMuted, font: { size: 10 }, maxTicksLimit: 6 },
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted, font: { size: 10 } },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function renderSiteRotation() {
    const card = document.getElementById('site-rotation-card');
    const jabs = Store.getJabs();
    if (jabs.length === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    const data = Store.getNextRecommendedSite();
    const allSites = ['abdomen-left', 'abdomen-right', 'thigh-left', 'thigh-right', 'arm-left', 'arm-right'];

    allSites.forEach(s => {
      const el = document.getElementById('site-' + s);
      if (!el) return;
      el.classList.remove('last-used', 'recommended');
      if (s === data.lastSite) el.classList.add('last-used');
      if (s === data.recommended) el.classList.add('recommended');
    });

    const rec = document.getElementById('site-recommendation');
    rec.innerHTML = 'Last: <strong>' + siteLabel(data.lastSite) + '</strong> &middot; Recommended next: <strong>' + siteLabel(data.recommended) + '</strong>';
  }

  function renderSideEffectTrends() {
    const container = document.getElementById('side-effect-trends');
    const summary = document.getElementById('side-effect-summary');
    const trends = Store.getSideEffectTrends();

    const entries = Object.entries(trends.effectCounts);
    if (entries.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    entries.sort((a, b) => b[1] - a[1]);
    const maxCount = entries[0][1];

    summary.innerHTML = entries.map(([effect, count]) => {
      const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
      const label = effect.replace('-', ' ');
      return `
        <div class="side-effect-bar-row">
          <span class="side-effect-bar-label">${label}</span>
          <div class="side-effect-bar-track">
            <div class="side-effect-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="side-effect-bar-count">${count}/${trends.totalDoses}</span>
        </div>
      `;
    }).join('');
  }

  function renderDoseEscalation() {
    const section = document.getElementById('escalation-section');
    const list = document.getElementById('escalation-list');
    const escalations = Store.getDoseEscalations();

    if (escalations.length === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    list.innerHTML = escalations.reverse().map((e, i) => `
      <div class="escalation-item ${e.direction}" style="animation-delay:${i * 0.05}s">
        <div class="escalation-date">${formatDate(e.date)}</div>
        <div class="escalation-detail">
          ${e.fromDose} ${e.unit}
          <span class="escalation-arrow">${e.direction === 'up' ? '&#x2191;' : '&#x2193;'}</span>
          ${e.toDose} ${e.unit}
          (${medicationLabel(e.medication)})
        </div>
      </div>
    `).join('');
  }

  function renderDoseWeightCorrelation() {
    const card = document.getElementById('correlation-card');
    const content = document.getElementById('correlation-content');
    const data = Store.getDoseWeightCorrelation();
    const unit = Store.getSettings().weightUnit;

    if (!data || data.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';
    content.innerHTML = data.map(d => {
      const improved = d.improvement > 0;
      const icon = improved ? '&#x2191;' : d.improvement < 0 ? '&#x2193;' : '&#x2194;';
      const cls = improved ? 'positive' : d.improvement < 0 ? 'negative' : 'neutral';
      return `
        <div class="correlation-item">
          <div class="correlation-dose-change">
            ${d.fromDose} ${d.unit} &rarr; ${d.toDose} ${d.unit}
            <span class="correlation-date">(${formatDateShort(d.date)})</span>
          </div>
          <div class="correlation-rates">
            <span>Before: ${d.rateBefore.toFixed(1)} ${unit}/wk</span>
            <span class="correlation-arrow ${cls}">${icon}</span>
            <span>After: ${d.rateAfter.toFixed(1)} ${unit}/wk</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function removeDose(id) {
    if (!confirm('Delete this dose entry?')) return;
    Store.deleteJab(id);
    toast('Dose deleted');
    refreshDoses();
    refreshSummary();
  }

  // ===== PROGRESS PAGE =====
  async function initProgressPage() {
    const weightModal = document.getElementById('weight-modal');
    const weightForm = document.getElementById('weight-form');

    document.getElementById('btn-add-weight').addEventListener('click', () => openWeightModal());

    document.getElementById('weight-modal-close').addEventListener('click', () => closeModal(weightModal));
    document.getElementById('weight-form-cancel').addEventListener('click', () => closeModal(weightModal));
    weightModal.addEventListener('click', (e) => { if (e.target === weightModal) closeModal(weightModal); });

    weightForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('weight-edit-id').value;
      const entry = {
        date: document.getElementById('weight-date').value,
        weight: document.getElementById('weight-value').value,
        note: document.getElementById('weight-note').value,
      };
      if (id) {
        Store.updateWeight(id, entry);
        toast('Weight updated', 'success');
      } else {
        Store.addWeight(entry);
        toast('Weight logged!', 'success');
      }
      closeModal(weightModal);
      refreshProgress();
      refreshSummary();
    });

    // Time filter chips
    document.querySelectorAll('#progress-filters .filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#progress-filters .filter-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentProgressRange = btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range);
        refreshProgress();
      });
    });

    // Photo & NSV buttons
    document.getElementById('btn-add-photo').addEventListener('click', () => {
      document.getElementById('photo-date').value = formatLocalDate(new Date());
      document.getElementById('photo-note').value = '';
      document.getElementById('photo-file').value = '';
      openModal(document.getElementById('photo-modal'));
    });

    document.getElementById('btn-add-nsv').addEventListener('click', () => {
      document.getElementById('nsv-date').value = formatLocalDate(new Date());
      document.getElementById('nsv-text').value = '';
      document.getElementById('nsv-category').value = 'fitness';
      openModal(document.getElementById('nsv-modal'));
    });

    // Share card button
    document.getElementById('btn-share-card').addEventListener('click', generateShareCard);

    // Photo compare selects
    document.getElementById('photo-compare-left').addEventListener('change', () => updatePhotoCompare());
    document.getElementById('photo-compare-right').addEventListener('change', () => updatePhotoCompare());

    // What-If calculator toggle
    document.getElementById('whatif-toggle').addEventListener('click', () => {
      const body = document.getElementById('whatif-body');
      const chevron = document.getElementById('whatif-chevron');
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      chevron.innerHTML = isOpen ? '&#x25BC;' : '&#x25B2;';
    });

    // What-If calculator live input
    document.getElementById('whatif-rate').addEventListener('input', updateWhatIf);

    updateWeightUnitLabels();

    const linkExportButton = document.getElementById('btn-export-link') || document.getElementById('btn-copy-backup');
    if (linkExportButton) {
      const size = await Store.getBackupSizeInfo();
      linkExportButton.disabled = size.exceedsSafeLink;
      linkExportButton.title = size.exceedsSafeLink
        ? 'Backup too large for a safe URL. Export and share a backup file instead.'
        : 'Create a full restore backup link';
    }
  }

  function openWeightModal(id) {
    const modal = document.getElementById('weight-modal');

    if (id) {
      const weights = Store.getWeights();
      const w = weights.find(x => x.id === id);
      if (!w) return;
      document.getElementById('weight-edit-id').value = id;
      document.getElementById('weight-modal-title').textContent = 'Edit Weight';
      document.getElementById('weight-date').value = w.date;
      document.getElementById('weight-value').value = w.weight;
      document.getElementById('weight-note').value = w.note || '';
    } else {
      document.getElementById('weight-edit-id').value = '';
      document.getElementById('weight-modal-title').textContent = 'Log Weight';
      document.getElementById('weight-date').value = formatLocalDate(new Date());
      document.getElementById('weight-value').value = '';
      document.getElementById('weight-note').value = '';
    }
    openModal(modal);
  }

  function updateWeightUnitLabels() {
    const unit = Store.getSettings().weightUnit;
    document.querySelectorAll('.weight-unit-label').forEach(el => el.textContent = unit);
  }

  async function refreshProgress() {
    const weights = Store.getWeights();
    const stats = Store.getStats();
    const unit = Store.getSettings().weightUnit;

    updateWeightUnitLabels();

    // Stats with animated counters
    if (stats.currentWeight) {
      animateValue(document.getElementById('prog-current'), stats.currentWeight, 600, ' ' + unit);
    } else {
      document.getElementById('prog-current').textContent = '--';
    }

    if (stats.startWeight) {
      animateValue(document.getElementById('prog-start'), stats.startWeight, 600, ' ' + unit);
    } else {
      document.getElementById('prog-start').textContent = '--';
    }

    if (stats.totalLost) {
      animateValue(document.getElementById('prog-total-lost'), stats.totalLost, 600, ' ' + unit);
    } else {
      document.getElementById('prog-total-lost').textContent = '--';
    }

    if (stats.progressPercent > 0) {
      animateValue(document.getElementById('prog-pct-lost'), stats.progressPercent, 600, '%');
    } else {
      document.getElementById('prog-pct-lost').textContent = '--';
    }

    if (stats.weightToGo !== null) {
      animateValue(document.getElementById('prog-to-goal'), stats.weightToGo, 600, ' ' + unit);
    } else {
      document.getElementById('prog-to-goal').textContent = '--';
    }

    if (stats.avgWeeklyLoss) {
      animateValue(document.getElementById('prog-weekly-avg'), stats.avgWeeklyLoss, 600, ' ' + unit);
    } else {
      document.getElementById('prog-weekly-avg').textContent = '--';
    }

    // Weight count
    document.getElementById('weight-count').textContent = weights.length;

    // Rate of loss
    const rateCard = document.getElementById('rate-of-loss-card');
    const rate30 = Store.getRateOfLoss(30);
    if (rate30 !== null && rate30 !== 0) {
      rateCard.style.display = 'flex';
      const sign = rate30 > 0 ? '-' : '+';
      document.getElementById('rate-of-loss-text').textContent =
        sign + Math.abs(rate30).toFixed(1) + ' ' + unit + '/week this month';
    } else {
      rateCard.style.display = 'none';
    }

    // Filter weights
    const normalizedWeights = normalizeDateEntries(weights, 'progress weight entry');
    let filtered = normalizedWeights;
    if (currentProgressRange !== 'all') {
      const cutoff = parseLocalDate(new Date());
      cutoff.setDate(cutoff.getDate() - currentProgressRange);
      filtered = normalizedWeights.filter(w => w._localDate >= cutoff);
    }

    // Chart
    renderWeightFullChart(filtered);

    // Weight entries list
    renderWeightEntries(filtered);

    // Photos
    await renderPhotoGallery();

    // NSVs
    renderNSVList();

    // What-If calculator visibility
    const whatifCard = document.getElementById('whatif-card');
    const goals = Store.getGoals();
    if (goals.targetWeight && weights.length >= 2) {
      whatifCard.style.display = '';
      document.getElementById('whatif-unit').textContent = unit;
      updateWhatIf();
    } else {
      whatifCard.style.display = 'none';
    }

    // Share button visibility
    const shareBtn = document.getElementById('btn-share-card');
    shareBtn.style.display = weights.length >= 2 ? '' : 'none';
  }

  function updateWhatIf() {
    const rate = parseFloat(document.getElementById('whatif-rate').value);
    const resultEl = document.getElementById('whatif-result');
    if (!rate || rate <= 0) {
      resultEl.textContent = '';
      return;
    }
    const projection = Store.calculateGoalDate(rate);
    if (!projection) {
      resultEl.textContent = 'Set a goal weight in Settings first.';
      return;
    }
    if (projection.weeks === 0) {
      resultEl.innerHTML = "You've already reached your goal!";
      return;
    }
    const unit = Store.getSettings().weightUnit;
    resultEl.innerHTML =
      "You'll reach your goal in about <strong>" + projection.weeks + ' weeks</strong> (' +
      formatDate(projection.date) + ').';
  }

  function renderWeightFullChart(weights) {
    const colors = getChartColors();
    const goals = Store.getGoals();

    weightFullChart = destroyChart(weightFullChart);
    const ctx = document.getElementById('chart-weight-full').getContext('2d');

    if (weights.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    const gradient = createChartGradient(ctx, 'rgba(99,102,241,0.3)', 'rgba(99,102,241,0.01)');
    const datasets = [{
      label: 'Weight',
      data: weights.map(w => ({ x: w.date, y: parseFloat(w.weight) })),
      borderColor: colors.primary,
      backgroundColor: gradient,
      borderWidth: 2,
      tension: 0.4,
      fill: true,
      pointRadius: weights.length > 30 ? 0 : 3,
      pointHoverRadius: 5,
      pointBackgroundColor: colors.primary,
    }];

    // 4-week moving average line
    const movingAvg = Store.getMovingAverage(28);
    if (movingAvg.length >= 2) {
      const filteredAvg = movingAvg.filter(ma => {
        return weights.some(w => w.date === ma.date);
      });
      if (filteredAvg.length >= 2) {
        datasets.push({
          label: '4-Week Avg',
          data: filteredAvg.map(ma => ({ x: ma.date, y: ma.avg })),
          borderColor: colors.success,
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          tension: 0.4,
        });
      }
    }

    // Goal line
    if (goals.targetWeight) {
      datasets.push({
        label: 'Goal',
        data: weights.map(w => ({ x: w.date, y: parseFloat(goals.targetWeight) })),
        borderColor: colors.success,
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      });
    }

    // Healthy weight range band (BMI 18.5-25)
    const profile = Store.getProfile();
    if (profile.height) {
      let heightM = parseFloat(profile.height) / 100;
      if (profile.heightUnit === 'ft') {
        heightM = parseFloat(profile.height) * 0.3048;
      }
      if (heightM > 0) {
        let healthyLow = 18.5 * heightM * heightM;
        let healthyHigh = 25 * heightM * heightM;
        const unit = Store.getSettings().weightUnit;
        if (unit === 'lbs') { healthyLow /= 0.453592; healthyHigh /= 0.453592; }
        else if (unit === 'st') { healthyLow /= 6.35029; healthyHigh /= 6.35029; }

        datasets.push({
          label: 'Healthy Range (High)',
          data: weights.map(w => ({ x: w.date, y: Math.round(healthyHigh * 10) / 10 })),
          borderColor: 'rgba(16,185,129,0.2)',
          borderWidth: 0,
          pointRadius: 0,
          fill: '+1',
          backgroundColor: 'rgba(16,185,129,0.08)',
        });
        datasets.push({
          label: 'Healthy Range (Low)',
          data: weights.map(w => ({ x: w.date, y: Math.round(healthyLow * 10) / 10 })),
          borderColor: 'rgba(16,185,129,0.2)',
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
        });
      }
    }

    weightFullChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: colors.textMuted,
              font: { size: 10 },
              filter: (item) => !item.text.startsWith('Healthy'),
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.9)',
            titleColor: '#f1f5f9',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(99,102,241,0.3)',
            borderWidth: 1,
            cornerRadius: 10,
            padding: 12,
            displayColors: false,
            filter: (item) => !item.dataset.label.startsWith('Healthy'),
            callbacks: {
              label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(1) + ' ' + Store.getSettings().weightUnit,
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'dd MMM yyyy' },
            grid: { display: false },
            ticks: { color: colors.textMuted, font: { size: 10 }, maxTicksLimit: 6 },
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted, font: { size: 10 } },
          },
        },
      },
    });
  }

  function renderWeightEntries(weights) {
    const unit = Store.getSettings().weightUnit;
    const list = document.getElementById('weight-entries-list');
    const empty = document.getElementById('weight-empty');
    const allWeights = Store.getWeights();

    if (weights.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }

    empty.style.display = 'none';
    const sorted = [...weights].reverse();
    list.innerHTML = sorted.map((w) => {
      const globalIdx = allWeights.findIndex(x => x.id === w.id);
      let changeHtml = '';
      if (globalIdx > 0) {
        const diff = parseFloat(w.weight) - parseFloat(allWeights[globalIdx - 1].weight);
        const sign = diff > 0 ? '+' : '';
        const cls = diff > 0 ? 'gain' : diff < 0 ? 'loss' : 'neutral';
        changeHtml = `<span class="weight-item-change ${cls}">${sign}${diff.toFixed(1)}</span>`;
      }
      return `
        <div class="weight-item">
          <div class="weight-item-info">
            <div class="weight-item-date">${formatDateShort(w.date)} ${w.note ? '&middot; ' + w.note : ''}</div>
            <div class="weight-item-value">${parseFloat(w.weight).toFixed(1)} ${unit} ${changeHtml}</div>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-sm" onclick="App.editWeight('${w.id}')" aria-label="Edit weight entry">Edit</button>
            <button class="btn btn-ghost btn-sm" onclick="App.removeWeight('${w.id}')" aria-label="Delete weight entry">Del</button>
          </div>
        </div>
      `;
    }).join('');
    staggerListItems('#weight-entries-list .weight-item');
  }

  async function renderPhotoGallery() {
    const photos = await Store.getPhotos();
    const gallery = document.getElementById('photo-gallery');
    const empty = document.getElementById('photo-empty');

    if (photos.length === 0) {
      gallery.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    gallery.innerHTML = [...photos].reverse().map(p => `
      <div class="photo-thumb" onclick="App.viewPhotos()">
        <img src="${p.dataUrl}" alt="Progress photo ${formatDateShort(p.date)}" loading="lazy">
        <span class="photo-thumb-date">${formatDateShort(p.date)}</span>
        <button class="photo-thumb-delete" onclick="event.stopPropagation();App.removePhoto('${p.id}')" aria-label="Delete photo">&times;</button>
      </div>
    `).join('');
  }

  async function viewPhotos() {
    const photos = await Store.getPhotos();
    if (photos.length === 0) return;

    const leftSel = document.getElementById('photo-compare-left');
    const rightSel = document.getElementById('photo-compare-right');

    const options = photos.map(p =>
      '<option value="' + p.id + '">' + formatDateShort(p.date) + (p.note ? ' - ' + p.note : '') + '</option>'
    ).join('');

    leftSel.innerHTML = options;
    rightSel.innerHTML = options;

    // Default: first and last
    if (photos.length >= 2) {
      leftSel.value = photos[0].id;
      rightSel.value = photos[photos.length - 1].id;
    }

    await updatePhotoCompare();
    openModal(document.getElementById('photo-viewer-modal'));
  }

  async function updatePhotoCompare() {
    const photos = await Store.getPhotos();
    const leftId = document.getElementById('photo-compare-left').value;
    const rightId = document.getElementById('photo-compare-right').value;
    const leftFrame = document.getElementById('photo-frame-left');
    const rightFrame = document.getElementById('photo-frame-right');

    const leftPhoto = photos.find(p => p.id === leftId);
    const rightPhoto = photos.find(p => p.id === rightId);

    leftFrame.innerHTML = leftPhoto ? '<img src="' + leftPhoto.dataUrl + '" alt="Left comparison photo">' : 'No photo';
    rightFrame.innerHTML = rightPhoto ? '<img src="' + rightPhoto.dataUrl + '" alt="Right comparison photo">' : 'No photo';
  }

  async function removePhoto(id) {
    if (!confirm('Delete this photo?')) return;
    await Store.deletePhoto(id);
    toast('Photo deleted');
    await renderPhotoGallery();
  }

  function renderNSVList() {
    const victories = Store.getVictories();
    const list = document.getElementById('nsv-list');
    const empty = document.getElementById('nsv-empty');

    if (victories.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    list.innerHTML = [...victories].reverse().map(v => `
      <div class="nsv-item">
        <div class="nsv-category-icon">${nsvCategoryIcon(v.category)}</div>
        <div class="nsv-content">
          <div class="nsv-text">${v.text}</div>
          <div class="nsv-meta">${formatDateShort(v.date)} &middot; ${v.category}</div>
        </div>
        <button class="nsv-delete" onclick="App.removeVictory('${v.id}')" aria-label="Delete victory">&times;</button>
      </div>
    `).join('');
    staggerListItems('#nsv-list .nsv-item');
  }

  function removeVictory(id) {
    if (!confirm('Delete this entry?')) return;
    Store.deleteVictory(id);
    toast('Entry deleted');
    renderNSVList();
  }

  function removeWeight(id) {
    if (!confirm('Delete this weight entry?')) return;
    Store.deleteWeight(id);
    toast('Entry deleted');
    refreshProgress();
    refreshSummary();
  }

  // ===== SHARE CARD =====
  function generateShareCard() {
    const stats = Store.getStats();
    const unit = Store.getSettings().weightUnit;
    const canvas = document.getElementById('share-card-canvas');
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#6366f1';
    ctx.fillRect(0, 0, 600, 400);

    // Overlay pattern
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 20; i++) {
      ctx.fillRect(i * 40, 0, 2, 400);
    }

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('My Weight Loss Progress', 300, 60);

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(100, 80);
    ctx.lineTo(500, 80);
    ctx.stroke();

    // Big number
    const lost = stats.totalLost ? stats.totalLost.toFixed(1) : '0';
    ctx.font = 'bold 72px Inter, sans-serif';
    ctx.fillText(lost + ' ' + unit, 300, 170);

    ctx.font = '24px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('lost so far', 300, 205);

    // Stats row
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    const col1 = 150, col2 = 300, col3 = 450;
    const row = 270;

    ctx.fillText(stats.totalJabs + ' doses', col1, row);
    ctx.fillText(stats.daysOnPlan + ' days', col2, row);
    ctx.fillText(stats.progressPercent.toFixed(0) + '% done', col3, row);

    ctx.font = '14px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('logged', col1, row + 22);
    ctx.fillText('on plan', col2, row + 22);
    ctx.fillText('to goal', col3, row + 22);

    // Footer
    ctx.font = '14px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('Tracked with Jab It', 300, 370);

    openModal(document.getElementById('share-modal'));
  }

  function downloadShareCard() {
    const canvas = document.getElementById('share-card-canvas');
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'progress-card-' + new Date().toISOString().split('T')[0] + '.png';
      a.click();
      URL.revokeObjectURL(url);
      toast('Card downloaded!', 'success');
    });
  }

  // ===== SETTINGS PAGE =====
  function initSettingsPage() {
    const linkExportButton = document.getElementById('btn-export-link') || document.getElementById('btn-copy-backup');

    function triggerDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    async function buildCompressedBackupBlob(jsonPayload) {
      if (typeof CompressionStream === 'undefined') return null;
      const stream = new Blob([jsonPayload], { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
      return new Response(stream).blob();
    }

    async function exportBackupFile(preferCompressed, largePayloadFallback) {
      const data = await Store.exportData();
      const dateStamp = new Date().toISOString().split('T')[0];
      try {
        if (preferCompressed) {
          const compressedBlob = await buildCompressedBackupBlob(data);
          if (compressedBlob) {
            triggerDownload(compressedBlob, 'jabit-backup-' + dateStamp + '.json.gz');
            toast(largePayloadFallback ? 'Backup too large for link; file export created instead.' : 'Compressed backup exported!', 'success');
            return;
          }
        }
        triggerDownload(new Blob([data], { type: 'application/json' }), 'jabit-backup-' + dateStamp + '.json');
        toast(largePayloadFallback ? 'Backup too large for link; file export created instead.' : 'Backup file exported!', 'success');
      } catch {
        toast('Backup export failed. Please try again.', 'error');
      }
    }

    function copyText(text, successMessage) {
      navigator.clipboard.writeText(text).then(() => {
        toast(successMessage, 'success');
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast(successMessage, 'success');
      });
    }

    async function updateBackupLinkState() {
      if (!linkExportButton) return;
      const size = await Store.getBackupSizeInfo();
      linkExportButton.disabled = size.exceedsSafeLink;
      linkExportButton.title = size.exceedsSafeLink
        ? 'Backup too large for a safe URL. Export and share a backup file instead.'
        : 'Create a full restore backup link';
    }

    async function importFromEncodedPayload(encoded, fromRestoreParam) {
      const importResult = await Store.importFromBackupLink(encoded);
      if (importResult.success) {
        if (importResult.warnings > 0) {
          toast('Data restored' + (fromRestoreParam ? ' from link' : '') + ' with ' + importResult.warnings + ' skipped invalid row(s).', 'success');
        } else {
          toast('Data restored' + (fromRestoreParam ? ' from link' : '') + '!', 'success');
        }
        bootApp();
        navigateTo('summary');
        return;
      }
      if (importResult.metadataOnly) {
        toast('This is a metadata-only link. Ask for the backup file to fully restore data.', 'error');
        return;
      }
      toast('Invalid backup link.', 'error');
    }

    document.getElementById('btn-save-settings').addEventListener('click', () => saveAllSettings());

    // Live theme preview in settings
    document.getElementById('set-theme').addEventListener('change', (e) => {
      const settings = Store.getSettings();
      settings.theme = e.target.value;
      Store.saveSettings(settings);
      applyTheme();
    });

    // Export backup file (JSON canonical payload, compressed when available)
    document.getElementById('btn-export').addEventListener('click', () => {
      exportBackupFile(true, false);
    });

    // Export CSV
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      const csv = Store.exportCSV();
      triggerDownload(new Blob([csv], { type: 'text/csv' }), 'weight-tracker-' + new Date().toISOString().split('T')[0] + '.csv');
      toast('CSV exported!', 'success');
    });

    // Import
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      async function readBackupFile(fileToRead) {
        if (fileToRead.name.endsWith('.gz')) {
          if (typeof DecompressionStream === 'undefined') {
            throw new Error('compressed-not-supported');
          }
          const stream = fileToRead.stream().pipeThrough(new DecompressionStream('gzip'));
          return new Response(stream).text();
        }
        return fileToRead.text();
      }

      try {
        const content = await readBackupFile(file);
        const importResult = await Store.importData(content);
        if (importResult.success) {
          if (importResult.warnings > 0) {
            toast('Data imported with ' + importResult.warnings + ' skipped invalid row(s).', 'success');
          } else {
            toast('Data imported!', 'success');
          }
          bootApp();
          navigateTo('summary');
          await updateBackupLinkState();
        } else {
          toast('Import failed. Invalid file.', 'error');
        }
      } catch (err) {
        if (err && err.message === 'compressed-not-supported') {
          toast('Compressed backup import is not supported in this browser. Use .json backup file.', 'error');
        } else {
          toast('Import failed. Invalid file.', 'error');
        }
      }

      e.target.value = '';
    });

    // Export/copy backup link
    if (linkExportButton) {
      linkExportButton.addEventListener('click', async () => {
        const size = await Store.getBackupSizeInfo();

        if (size.exceedsSafeLink) {
          exportBackupFile(true, true);
          const metadataEncoded = Store.generateMetadataBackupLink();
          if (metadataEncoded) {
            const metadataLink = window.location.origin + window.location.pathname + '?restore=' + metadataEncoded;
            copyText(metadataLink, 'Metadata-only link copied. Share backup file for full restore.');
          }
          return;
        }

        const encoded = await Store.generateBackupLink();
        if (!encoded) {
          toast('Failed to generate backup link.', 'error');
          return;
        }

        const link = window.location.origin + window.location.pathname + '?restore=' + encoded;
        copyText(link, 'Backup link copied!');
      });
    }

    // Paste backup link
    document.getElementById('btn-paste-backup').addEventListener('click', () => {
      const input = prompt('Paste your backup link. For full restore, use a backup file export.');
      if (!input) return;
      let encoded = input;
      if (input.includes('?restore=')) {
        encoded = input.split('?restore=')[1];
      }
      importFromEncodedPayload(encoded, false);
    });

    updateBackupLinkState();

    // Clear data
    document.getElementById('btn-clear-data').addEventListener('click', () => {
      if (!confirm('Are you sure you want to delete ALL data? This cannot be undone.')) return;
      if (!confirm('Really? This will clear all your entries and settings.')) return;
      Store.clearAll();
      toast('All data cleared');
      window.location.reload();
    });

    // Test notification
    document.getElementById('btn-test-notification').addEventListener('click', () => {
      if (!('Notification' in window)) {
        // Fallback: show in-app banner (Safari iOS, older browsers)
        showReminderBanner('dose', 'This is a test reminder. In-app banners will appear on the Summary page when reminders are due.');
        toast('In-app reminders will be used (browser notifications unavailable)', 'success');
        return;
      }
      if (Notification.permission === 'granted') {
        new Notification('Jab It - Test', { body: 'Notifications are working!', icon: 'icons/icon-192.png' });
        toast('Test notification sent!', 'success');
      } else if (Notification.permission === 'denied') {
        // Still show in-app banner as fallback
        showReminderBanner('dose', 'This is a test reminder. In-app banners will appear on the Summary page when reminders are due.');
        toast('Browser notifications blocked. In-app reminders will be used instead.', 'error');
      } else {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') {
            new Notification('Jab It - Test', { body: 'Notifications are working!', icon: 'icons/icon-192.png' });
            toast('Notifications enabled!', 'success');
          } else {
            showReminderBanner('dose', 'This is a test reminder. In-app banners will appear on the Summary page when reminders are due.');
            toast('Using in-app reminders instead.', 'success');
          }
        });
      }
    });

    // Check for restore param on load
    const params = new URLSearchParams(window.location.search);
    if (params.has('restore')) {
      const encoded = params.get('restore');
      importFromEncodedPayload(encoded, true);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  function saveAllSettings() {
    const profile = Store.getProfile();
    profile.name = document.getElementById('set-name').value.trim();
    profile.height = document.getElementById('set-height').value;
    profile.heightUnit = document.getElementById('set-height-unit').value;
    profile.startWeight = document.getElementById('set-start-weight').value;
    profile.medication = document.getElementById('set-medication').value;
    profile.dosage = document.getElementById('set-dosage').value;
    profile.frequency = document.getElementById('set-frequency').value;
    Store.saveProfile(profile);

    const goals = Store.getGoals();
    goals.targetWeight = document.getElementById('set-goal-weight').value;
    Store.saveGoals(goals);

    const settings = Store.getSettings();
    const oldUnit = settings.weightUnit;
    const newUnit = document.getElementById('set-weight-unit').value;

    settings.weightUnit = newUnit;
    settings.theme = document.getElementById('set-theme').value;
    settings.weighInSchedule = document.getElementById('set-weigh-schedule').value;
    settings.doseReminderEnabled = document.getElementById('set-dose-reminder').checked;
    settings.weighInReminderEnabled = document.getElementById('set-weighin-reminder').checked;
    Store.saveSettings(settings);

    // Auto-convert weights on unit change
    if (oldUnit !== newUnit) {
      Store.convertAllWeights(oldUnit, newUnit);
      // Update display values
      const newProfile = Store.getProfile();
      document.getElementById('set-start-weight').value = newProfile.startWeight || '';
      const newGoals = Store.getGoals();
      document.getElementById('set-goal-weight').value = newGoals.targetWeight || '';
      toast('All weights converted to ' + newUnit + '!', 'success');
    }

    // Request notification permission if reminders enabled
    if ((settings.doseReminderEnabled || settings.weighInReminderEnabled) && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    applyTheme();
    updateWeightUnitLabels();
    checkReminders({ source: 'settings-save' });
    scheduleReminderChecks();
    ensureBackgroundReminderScheduling();
    toast('Settings saved!', 'success');
  }

  function refreshSettings() {
    const profile = Store.getProfile();
    const settings = Store.getSettings();
    const goals = Store.getGoals();

    document.getElementById('set-name').value = profile.name || '';
    document.getElementById('set-height').value = profile.height || '';
    document.getElementById('set-height-unit').value = profile.heightUnit || 'cm';
    document.getElementById('set-start-weight').value = profile.startWeight || '';
    document.getElementById('set-goal-weight').value = goals.targetWeight || '';
    document.getElementById('set-weight-unit').value = settings.weightUnit || 'kg';
    document.getElementById('set-medication').value = profile.medication || 'semaglutide';
    document.getElementById('set-dosage').value = profile.dosage || '';
    document.getElementById('set-frequency').value = profile.frequency || 'weekly';
    document.getElementById('set-theme').value = settings.theme || 'light';
    document.getElementById('set-weigh-schedule').value = settings.weighInSchedule || 'weekly';
    document.getElementById('set-dose-reminder').checked = !!settings.doseReminderEnabled;
    document.getElementById('set-weighin-reminder').checked = !!settings.weighInReminderEnabled;

    updateWeightUnitLabels();
    refreshReminderCapabilityStatus();
  }

  // Public API
  return {
    init,
    editWeight: (id) => openWeightModal(id),
    removeWeight,
    editDose: (id) => openDoseModal(id),
    removeDose,
    removePhoto,
    removeVictory,
    viewPhotos,
  };
})();

// Boot the app
document.addEventListener('DOMContentLoaded', App.init);
