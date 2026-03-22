// Jab It: Weight Loss Tracker - Main Application Controller
const App = (() => {
  let weightSummaryChart, weightFullChart, doseChart, doseRingChart;
  let measurementChart, moodTrendChart, fastingRingChart;
  let currentProgressRange = 'all';
  let currentDoseRange = 'all';
  let countdownInterval = null;
  let fastingTimerInterval = null;
  let remindersInterval = null;
  let reminderSyncCapabilities = null;
  let isUiBound = false;
  let isHashListenerBound = false;
  let isGlobalListenersBound = false;
  let isCriticalButtonFallbackBound = false;
  let isPhotoStorageChecked = false;
  let pendingSummaryBannerMessage = '';
  const REMINDER_CHECK_INTERVAL_MS = 30 * 60 * 1000;
  const REMINDER_CATCH_UP_INTERVAL_MS = 2 * 60 * 60 * 1000;
  const DOSAGE_DRAFT_KEY = 'shotsy_dosage_draft';
  let settingsHeightDraft = null;

  // ===== UTILITIES =====
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setButtonLoading(button, loadingText) {
    if (!button) return;
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = loadingText || 'Loading...';
  }

  function clearButtonLoading(button) {
    if (!button) return;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.defaultLabel) {
      button.textContent = button.dataset.defaultLabel;
    }
  }

  function getDosageDraft() {
    try {
      const value = localStorage.getItem(DOSAGE_DRAFT_KEY);
      return value === null ? '' : value;
    } catch {
      return '';
    }
  }

  function setDosageDraft(value) {
    try {
      localStorage.setItem(DOSAGE_DRAFT_KEY, value || '');
    } catch {
      // Best effort only.
    }
  }

  function clearDosageDraft() {
    try {
      localStorage.removeItem(DOSAGE_DRAFT_KEY);
    } catch {
      // Best effort only.
    }
  }

  function completeRestoreToSummary(successMessage, bannerMessage) {
    document.getElementById('onboarding-modal').style.display = 'none';
    document.getElementById('app').style.display = '';
    pendingSummaryBannerMessage = bannerMessage || 'Your data was restored successfully.';
    bootApp();
    navigateTo('summary');
    toast((successMessage || 'Data restored!') + ' Opening your dashboard…', 'success');
  }

  // ===== INIT =====
  function showOnboardingOrApp() {
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
  }

  function init() {
    var didShowApp = false;
    try {
      // Hide SEO landing content once app JS is running
      var landingEl = document.querySelector('.landing-content');
      if (landingEl) landingEl.style.display = 'none';

      applyTheme();
      bindGlobalListeners();
      bindCriticalButtonFallbacks();

      // Initialize auth (non-blocking, degrades gracefully if Supabase CDN or config fails)
      try {
        if (typeof Auth !== 'undefined') {
          Auth.init();
          window.addEventListener('auth-state-change', handleAuthStateChange);
        }
      } catch (e) {
        console.error('[App] Auth init failed (non-fatal):', e);
      }
      try {
        if (typeof Sync !== 'undefined') {
          Sync.init();
        }
      } catch (e) {
        console.error('[App] Sync init failed (non-fatal):', e);
      }

      // Check for restore param before deciding on onboarding
      const params = new URLSearchParams(window.location.search);
      if (params.has('restore')) {
        const encoded = params.get('restore');
        window.history.replaceState({}, '', window.location.pathname);
        Store.importFromBackupLink(encoded).then(function (importResult) {
          if (importResult.success) {
            completeRestoreToSummary('Data restored from link!', 'Backup restored from link.');
          } else if (importResult.metadataOnly) {
            toast('This is a metadata-only link. Use an encrypted backup file for full restore.', 'error');
            showOnboardingOrApp();
          } else {
            showOnboardingOrApp();
          }
        }).catch(function () {
          showOnboardingOrApp();
        });
      } else {
        showOnboardingOrApp();
        didShowApp = true;
      }

      registerServiceWorker();
    } catch (e) {
      console.error('[App] Init error:', e);
      if (!didShowApp) {
        try {
          showOnboardingOrApp();
        } catch (e2) {
          // Last resort: show onboarding modal raw so user isn't stuck on blank page
          document.getElementById('onboarding-modal').style.display = 'flex';
          document.getElementById('app').style.display = 'none';
        }
      }
    }
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

  function bindCriticalButtonFallbacks() {
    if (isCriticalButtonFallbackBound) return;

    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;

      var obNewUserBtn = target.closest('#btn-ob-new-user');
      if (obNewUserBtn) {
        var chooser = document.getElementById('ob-screen-chooser');
        var form = document.getElementById('ob-screen-form');
        var signin = document.getElementById('ob-screen-signin');
        if (chooser && form) {
          chooser.style.display = 'none';
          if (signin) signin.style.display = 'none';
          form.style.display = '';
        }
      }

      var openAuthBtn = target.closest('#btn-open-auth');
      if (openAuthBtn) {
        var authModal = document.getElementById('auth-modal');
        var authForm = document.getElementById('auth-form');
        var authSent = document.getElementById('auth-magic-link-sent');
        var authEmail = document.getElementById('auth-email');
        var sendBtn = document.getElementById('btn-send-magic-link');
        if (authForm) authForm.style.display = '';
        if (authSent) authSent.style.display = 'none';
        if (authEmail) authEmail.value = '';
        if (sendBtn) clearButtonLoading(sendBtn);
        if (authModal) openModal(authModal);
      }

      // Fallback: onboarding back buttons → return to chooser screen
      if (target.closest('#btn-ob-back-form') || target.closest('#btn-ob-back-signin')) {
        var chooser = document.getElementById('ob-screen-chooser');
        var form = document.getElementById('ob-screen-form');
        var signin = document.getElementById('ob-screen-signin');
        if (chooser) chooser.style.display = '';
        if (form) form.style.display = 'none';
        if (signin) signin.style.display = 'none';
      }

      // Fallback: navigation tabs
      var navTab = target.closest('.nav-tab[data-page]');
      if (navTab && navTab.dataset.page) {
        e.preventDefault();
        try { navigateTo(navTab.dataset.page); } catch (err) {
          window.location.hash = '#' + navTab.dataset.page;
        }
      }

      // Delegated data-action handlers (replaces inline onclick)
      var actionEl = target.closest('[data-action]');
      if (actionEl) {
        var action = actionEl.dataset.action;
        var id = actionEl.dataset.id;
        switch (action) {
          case 'edit-weight': App.editWeight(id); break;
          case 'remove-weight': App.removeWeight(id); break;
          case 'edit-dose': App.editDose(id); break;
          case 'remove-dose': App.removeDose(id); break;
          case 'remove-photo':
            e.stopPropagation();
            App.removePhoto(id);
            break;
          case 'view-photos': App.viewPhotos(); break;
          case 'remove-victory': App.removeVictory(id); break;
          case 'edit-measurement': App.editMeasurement(id); break;
          case 'remove-measurement': App.removeMeasurement(id); break;
          case 'edit-journal': App.editJournalEntry(id); break;
          case 'remove-journal': App.removeJournalEntry(id); break;
          case 'edit-exercise': App.editExercise(id); break;
          case 'remove-exercise': App.removeExercise(id); break;
          case 'remove-fast': App.removeFast(id); break;
        }
      }
    });

    // Fallback: onboarding form submit (skipped if primary handler already ran)
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.id !== 'onboarding-form' || form._handled) return;
      e.preventDefault();

      var name = (document.getElementById('ob-name').value || '').trim();
      if (!name) return;

      var obHeightUnit = document.getElementById('ob-height-unit').value;
      var normalizedHeightCm = parseFloat(document.getElementById('ob-height').value);
      if (obHeightUnit === 'ft') {
        var ft = parseFloat(document.getElementById('ob-height-ft').value || '');
        var inches = parseFloat(document.getElementById('ob-height-in').value || '');
        if (Number.isFinite(ft) && Number.isFinite(inches)) {
          normalizedHeightCm = ((ft * 12) + inches) * 2.54;
        }
      }

      var selectedUnit = getActiveObWeightUnit();
      var startWeight, targetWeight;
      if (selectedUnit === 'st') {
        startWeight = Store.stLbsToDecimal(
          document.getElementById('ob-weight-st').value,
          document.getElementById('ob-weight-lbs').value
        );
        targetWeight = Store.stLbsToDecimal(
          document.getElementById('ob-target-st').value,
          document.getElementById('ob-target-lbs').value
        );
      } else {
        startWeight = document.getElementById('ob-weight').value;
        targetWeight = document.getElementById('ob-target').value;
      }

      var profile = {
        name: name,
        height: Number.isFinite(normalizedHeightCm) ? normalizedHeightCm.toFixed(1) : '',
        heightUnit: obHeightUnit,
        startWeight: startWeight,
        startDate: new Date().toISOString().split('T')[0],
        medication: document.getElementById('ob-medication').value,
        dosage: '',
        frequency: 'weekly',
        age: '',
      };
      Store.saveProfile(profile);
      Store.saveSettings(Object.assign({}, Store.getSettings(), {
        weightUnit: selectedUnit
      }));
      Store.saveGoals(Object.assign({}, Store.getGoals(), {
        targetWeight: targetWeight
      }));
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

    isCriticalButtonFallbackBound = true;
  }

  function bindUiOnce() {
    if (isUiBound) return;

    // Wrap each page init in try-catch so a failure in one page
    // does not prevent event listeners from binding on other pages
    const inits = [initNavigation, initSummaryPage, initDosesPage, initProgressPage, initJournalPage, initSettingsPage, initModals];
    inits.forEach(fn => {
      try { fn(); } catch (e) { console.error('[App] Init error in ' + fn.name + ':', e); }
    });

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
    refreshFirstRunChecklist();
    // Schedule reminder checks
    checkReminders({ source: 'app-load', isCatchUp: true });
    scheduleReminderChecks();
    ensureBackgroundReminderScheduling();
  }

  function renderAllPages() {
    refreshSummary();
    refreshDoses();
    refreshProgress();
    refreshJournal();
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
    var onboardingModal = document.getElementById('onboarding-modal');
    var screenChooser = document.getElementById('ob-screen-chooser');
    var screenForm = document.getElementById('ob-screen-form');
    var screenSignin = document.getElementById('ob-screen-signin');
    var restorePanel = document.getElementById('ob-restore-options');
    var btnReturningUser = document.getElementById('btn-ob-returning-user');
    var progressChooser = document.getElementById('ob-progress-chooser');
    var progressForm = document.getElementById('ob-progress-form');
    var progressSignin = document.getElementById('ob-progress-signin');
    var obLiveRegion = document.getElementById('ob-screen-live');
    var hasInertSupport = 'inert' in document.createElement('div');
    var activeObFlow = 'new';

    function getProgressText(screen) {
      if (screen === screenChooser) return 'Step 1 of 2 · Choose setup path';
      if (activeObFlow === 'returning') return 'Step 2 of 2 · Returning user restore';
      if (screen === screenForm) return 'Step 2 of 2 · New user setup';
      return 'Step 1 of 2 · New user setup';
    }

    function updateOnboardingProgress(screen) {
      var progressText = getProgressText(screen);
      [progressChooser, progressForm, progressSignin].forEach(function (el) {
        if (el) el.textContent = progressText;
      });
    }

    function setRestorePanelOpen(isOpen) {
      if (!restorePanel || !btnReturningUser) return;
      restorePanel.style.display = isOpen ? '' : 'none';
      restorePanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      btnReturningUser.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    function setScreenFocusableState(screen, isActive) {
      if (!screen) return;
      screen.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if (hasInertSupport) {
        screen.inert = !isActive;
        return;
      }
      screen.querySelectorAll('button, [href], input, select, textarea, [tabindex]').forEach(function (el) {
        if (isActive) {
          if (el.hasAttribute('data-ob-prev-tabindex')) {
            var prev = el.getAttribute('data-ob-prev-tabindex');
            if (prev === '') el.removeAttribute('tabindex');
            else el.setAttribute('tabindex', prev);
            el.removeAttribute('data-ob-prev-tabindex');
          }
        } else if (!el.hasAttribute('data-ob-prev-tabindex')) {
          el.setAttribute('data-ob-prev-tabindex', el.getAttribute('tabindex') || '');
          el.setAttribute('tabindex', '-1');
        }
      });
    }

    function focusOnboardingScreen(screen) {
      if (!screen) return;
      var preferred = screen.querySelector('h1[tabindex="-1"], h2[tabindex="-1"], h3[tabindex="-1"]');
      var firstInteractive = screen.querySelector('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      var focusTarget = preferred || firstInteractive;
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
      }
    }

    function announceObScreen(screen) {
      if (!obLiveRegion || !screen) return;
      var message = screen === screenSignin ? 'Sign-in step' : 'New user setup step';
      obLiveRegion.textContent = '';
      setTimeout(function () {
        obLiveRegion.textContent = message;
      }, 30);
    }

    // --- Screen navigation ---
    function showObScreen(screen) {
      [screenChooser, screenForm, screenSignin].forEach(function (obScreen) {
        var isActive = obScreen === screen;
        obScreen.style.display = isActive ? '' : 'none';
        setScreenFocusableState(obScreen, isActive);
      });
      if (screen === screenChooser) setRestorePanelOpen(false);
      updateOnboardingProgress(screen);
      announceObScreen(screen);
      screen.closest('.modal').scrollTop = 0;
      setTimeout(function () {
        focusOnboardingScreen(screen);
      }, 0);
    }

    // "Get Started" → new user form
    document.getElementById('btn-ob-new-user').addEventListener('click', function () {
      activeObFlow = 'new';
      showObScreen(screenForm);
    });

    // "Already have data?" -> toggle restore options panel
    if (btnReturningUser) {
      btnReturningUser.addEventListener('click', function () {
        var isOpen = btnReturningUser.getAttribute('aria-expanded') === 'true';
        if (isOpen) {
          activeObFlow = 'new';
        } else {
          activeObFlow = 'returning';
        }
        showObScreen(screenChooser);
        setRestorePanelOpen(!isOpen);
      });
    }

    // "Sign in to sync" → returning user (only visible if Auth is available and configured)
    var btnSignIn = document.getElementById('btn-ob-sign-in');
    if (typeof Auth !== 'undefined' && Auth.isConfigured()) {
      btnSignIn.style.display = '';
      btnSignIn.addEventListener('click', function () {
        activeObFlow = 'returning';
        // Reset sign-in form state when navigating to it
        var obSigninForm = document.getElementById('ob-signin-form');
        var obSigninSent = document.getElementById('ob-signin-sent');
        if (obSigninForm) obSigninForm.style.display = '';
        if (obSigninSent) obSigninSent.style.display = 'none';
        var sendBtn = document.getElementById('btn-ob-send-magic-link');
        if (sendBtn) clearButtonLoading(sendBtn);
        showObScreen(screenSignin);
      });
    }

    // Back buttons
    document.getElementById('btn-ob-back-form').addEventListener('click', function () {
      activeObFlow = 'new';
      showObScreen(screenChooser);
    });
    document.getElementById('btn-ob-back-signin').addEventListener('click', function () {
      activeObFlow = 'returning';
      showObScreen(screenChooser);
    });

    if (onboardingModal) {
      onboardingModal.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          activeObFlow = 'new';
          showObScreen(screenChooser);
          return;
        }
        if (e.key !== 'Backspace') return;
        if (e.target && /input|textarea/i.test(e.target.tagName)) return;
        if (screenForm.style.display !== 'none' || screenSignin.style.display !== 'none') {
          e.preventDefault();
          activeObFlow = screenSignin.style.display !== 'none' ? 'returning' : 'new';
          showObScreen(screenChooser);
        }
      });
    }

    // "Restore from backup" links (on chooser and sign-in screens)
    var obImportFile = document.getElementById('ob-import-file');
    var obRestoreButton = document.getElementById('btn-ob-restore-link');
    if (obRestoreButton) {
      obRestoreButton.addEventListener('click', function () {
        if (obRestoreButton.disabled) return;
        obImportFile.click();
      });
    }
    document.getElementById('btn-ob-restore-link-signin').addEventListener('click', function (e) {
      e.preventDefault();
      obImportFile.click();
    });

    showObScreen(screenChooser);

    // --- Existing onboarding form logic ---
    var onboardingForm = document.getElementById('onboarding-form');
    var obHeightInput = document.getElementById('ob-height');
    var obHeightUnit = document.getElementById('ob-height-unit');
    var obHeightCmGroup = document.getElementById('ob-height-cm-group');
    var obHeightImperialGroup = document.getElementById('ob-height-imperial-group');
    var obHeightFtInput = document.getElementById('ob-height-ft');
    var obHeightInInput = document.getElementById('ob-height-in');
    var obHeightValidation = document.getElementById('ob-height-validation');
    var obWeightInput = document.getElementById('ob-weight');
    var obTargetInput = document.getElementById('ob-target');
    var obTargetValidation = document.getElementById('ob-target-validation');
    var obWeightWarning = document.getElementById('ob-weight-warning');
    var obWeightUnit = document.getElementById('ob-weight-unit');

    function setInlineMessage(element, message) {
      if (!element) return;
      element.textContent = message || '';
      element.style.display = message ? '' : 'none';
    }

    function getActiveObWeightUnit() {
      var isSt = document.getElementById('ob-weight-st-row').style.display !== 'none';
      return isSt ? document.getElementById('ob-weight-unit-st').value : obWeightUnit.value;
    }

    function updateWeightUnitUi() {
      var unit = getActiveObWeightUnit();
      var isSt = unit === 'st';
      document.querySelectorAll('.ob-weight-unit-label').forEach(function (el) { el.textContent = unit; });
      // Toggle stone vs decimal rows
      document.getElementById('ob-weight-decimal-row').style.display = isSt ? 'none' : '';
      document.getElementById('ob-weight-st-row').style.display = isSt ? '' : 'none';
      document.getElementById('ob-target-decimal-group').style.display = isSt ? 'none' : '';
      document.getElementById('ob-target-st-group').style.display = isSt ? '' : 'none';
      obWeightInput.required = !isSt;
      obTargetInput.required = !isSt;
      if (!isSt) {
        var unitLimits = {
          kg: { min: 0.1, max: 500 },
          lbs: { min: 0.1, max: 1100 },
        };
        var limits = unitLimits[unit] || unitLimits.kg;
        obWeightInput.min = String(limits.min);
        obWeightInput.max = String(limits.max);
        obTargetInput.min = '0';
        obTargetInput.max = String(limits.max);
      }
    }

    function updateHeightUnitUi() {
      var isImperial = obHeightUnit.value === 'ft';
      obHeightCmGroup.style.display = isImperial ? 'none' : '';
      obHeightImperialGroup.style.display = isImperial ? '' : 'none';
      obHeightInput.required = !isImperial;
      obHeightFtInput.required = isImperial;
      obHeightInInput.required = isImperial;
      if (!isImperial) {
        obHeightFtInput.value = '';
        obHeightInInput.value = '';
      }
      setInlineMessage(obHeightValidation, '');
    }

    function getNormalizedHeightCm() {
      if (obHeightUnit.value === 'ft') {
        var feetRaw = (obHeightFtInput.value || '').trim();
        var inchesRaw = (obHeightInInput.value || '').trim();
        if (!feetRaw || !inchesRaw) {
          return { error: 'Please enter both feet and inches for your height.' };
        }
        var feet = parseFloat(feetRaw);
        var inches = parseFloat(inchesRaw);
        if (!Number.isFinite(feet) || !Number.isFinite(inches)) {
          return { error: 'Height must be a valid number.' };
        }
        var cm = ((feet * 12) + inches) * 2.54;
        if (cm < 100 || cm > 250) {
          return { error: 'Height must be between 100 cm and 250 cm.' };
        }
        return { value: cm.toFixed(1) };
      }

      var cmHeight = parseFloat(obHeightInput.value);
      if (!Number.isFinite(cmHeight) || cmHeight < 100 || cmHeight > 250) {
        return { error: 'Height must be between 100 cm and 250 cm.' };
      }
      return { value: cmHeight.toFixed(1) };
    }

    obWeightUnit.addEventListener('change', function () {
      updateWeightUnitUi();
      setInlineMessage(obTargetValidation, '');
      setInlineMessage(obWeightWarning, '');
    });

    document.getElementById('ob-weight-unit-st').addEventListener('change', function () {
      // Sync with the main unit selector when switching away from stones
      obWeightUnit.value = this.value;
      updateWeightUnitUi();
      setInlineMessage(obTargetValidation, '');
      setInlineMessage(obWeightWarning, '');
    });

    obHeightUnit.addEventListener('change', function () {
      updateHeightUnitUi();
    });

    updateWeightUnitUi();
    updateHeightUnitUi();

    onboardingForm.addEventListener('submit', function (e) {
      e.preventDefault();

      setInlineMessage(obHeightValidation, '');
      setInlineMessage(obTargetValidation, '');
      setInlineMessage(obWeightWarning, '');

      var normalizedHeight = getNormalizedHeightCm();
      if (normalizedHeight.error) {
        setInlineMessage(obHeightValidation, normalizedHeight.error);
        return;
      }

      var selectedUnit = getActiveObWeightUnit();
      var startWeight, targetWeight;
      if (selectedUnit === 'st') {
        startWeight = Store.stLbsToDecimal(
          document.getElementById('ob-weight-st').value,
          document.getElementById('ob-weight-lbs').value
        );
        targetWeight = Store.stLbsToDecimal(
          document.getElementById('ob-target-st').value,
          document.getElementById('ob-target-lbs').value
        );
      } else {
        startWeight = parseFloat(obWeightInput.value);
        targetWeight = parseFloat(obTargetInput.value);
      }
      if (!Number.isFinite(targetWeight) || targetWeight < 0) {
        setInlineMessage(obTargetValidation, 'Goal weight must be 0 or greater.');
        return;
      }
      if (!Number.isFinite(startWeight) || startWeight <= 0) return;

      if (startWeight <= targetWeight) {
        setInlineMessage(obWeightWarning, 'Tip: starting weight is usually above goal weight. You can still continue.');
      }

      e.target._handled = true;
      var profile = {
        name: document.getElementById('ob-name').value.trim(),
        height: normalizedHeight.value,
        heightUnit: 'cm',
        startWeight: startWeight,
        startDate: formatLocalDate(new Date()),
        medication: document.getElementById('ob-medication').value,
        dosage: '',
        frequency: 'weekly',
        age: '',
      };
      Store.saveProfile(profile);

      Store.saveSettings({ ...Store.getSettings(), weightUnit: selectedUnit });

      Store.saveGoals({ ...Store.getGoals(), targetWeight: targetWeight });

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

    // --- Sign-in form (magic link) ---
    var obSigninFormEl = document.getElementById('ob-signin-form');
    if (obSigninFormEl) {
      obSigninFormEl.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('ob-signin-email').value.trim();
        if (!email || typeof Auth === 'undefined' || !Auth.isConfigured()) return;
        var sendBtn = document.getElementById('btn-ob-send-magic-link');
        setButtonLoading(sendBtn, 'Sending link...');
        Auth.signInWithMagicLink(email).then(function (result) {
          if (result.error) {
            toast(result.error.message || 'Failed to send magic link. Try again or cancel.', 'error');
            clearButtonLoading(sendBtn);
            return;
          }
          clearButtonLoading(sendBtn);
          document.getElementById('ob-signin-form').style.display = 'none';
          document.getElementById('ob-signin-sent').style.display = '';
          document.getElementById('ob-signin-sent-email').textContent = email;
        }).catch(function (err) {
          toast((err && err.message) || 'Failed to send magic link. Check your connection. Try again or cancel.', 'error');
          clearButtonLoading(sendBtn);
        });
      });
    }


    var obPasskeyBtn = document.getElementById('btn-ob-passkey');
    if (obPasskeyBtn) {
      obPasskeyBtn.style.display = canUsePasskeys() ? '' : 'none';
      obPasskeyBtn.addEventListener('click', function () {
        var email = document.getElementById('ob-signin-email').value.trim();
        startPasskeySignIn(email, { button: obPasskeyBtn, source: 'onboarding' });
      });
    }

    // --- Import backup file from welcome screen ---
    obImportFile.addEventListener('change', async function (e) {
      var file = e.target.files[0];
      if (!file || obImportFile.dataset.importing === 'true') return;
      obImportFile.dataset.importing = 'true';
      if (btnReturningUser) btnReturningUser.disabled = true;
      setButtonLoading(obRestoreButton, 'Importing backup...');

      async function readBackupFile(fileToRead) {
        if (fileToRead.name.endsWith('.gz')) {
          if (typeof DecompressionStream === 'undefined') {
            throw new Error('compressed-not-supported');
          }
          var stream = fileToRead.stream().pipeThrough(new DecompressionStream('gzip'));
          return new Response(stream).text();
        }
        return fileToRead.text();
      }

      try {
        var content = await readBackupFile(file);
        var importResult = await Store.importBackupData(content, '');

        if (importResult.requiresPassphrase) {
          var passphrase = prompt('Enter the backup passphrase to decrypt this file.');
          if (passphrase === null) {
            e.target.value = '';
            obImportFile.dataset.importing = 'false';
            if (btnReturningUser) btnReturningUser.disabled = false;
            clearButtonLoading(obRestoreButton);
            return;
          }
          importResult = await Store.importBackupData(content, passphrase);
        }

        if (importResult.success) {
          if (importResult.warnings > 0) {
            completeRestoreToSummary('Data restored with ' + importResult.warnings + ' skipped row(s).', 'Backup restored from file.');
          } else {
            completeRestoreToSummary('Data restored! Welcome back.', 'Backup restored from file.');
          }
        } else if (importResult.requiresPassphrase && importResult.error === 'invalid-passphrase') {
          toast('Incorrect passphrase. Try again or cancel.', 'error');
        } else {
          toast('Import failed. Invalid backup file.', 'error');
        }
      } catch (err) {
        if (err && err.message === 'compressed-not-supported') {
          toast('Compressed backup import is not supported in this browser.', 'error');
        } else {
          toast('Import failed. Invalid file.', 'error');
        }
      }

      e.target.value = '';
      obImportFile.dataset.importing = 'false';
      if (btnReturningUser) btnReturningUser.disabled = false;
      clearButtonLoading(obRestoreButton);
    });
  }

  // ===== FIRST-RUN CHECKLIST / TOUR =====
  function getFirstRunChecklistState() {
    const profile = Store.getProfile() || {};
    const weights = Store.getWeights();
    const doses = Store.getJabs();
    const settings = Store.getSettings();

    const hasProfile = !!(profile.name && String(profile.name).trim());
    const hasDose = Array.isArray(doses) && doses.length > 0;
    const hasWeight = Array.isArray(weights) && weights.length > 0;

    const items = [
      { key: 'profile', label: 'Confirm profile', done: hasProfile },
      { key: 'dose', label: 'Log first dose', done: hasDose },
      { key: 'weight', label: "Log today's weight", done: hasWeight },
    ];

    const completedCount = items.filter(item => item.done).length;
    const allDone = completedCount === items.length;

    return {
      settings,
      items,
      completedCount,
      allDone,
      shouldShow: !settings.firstRunChecklistComplete && !settings.firstRunChecklistDismissed,
    };
  }

  function saveFirstRunChecklistState(patch) {
    const settings = Store.getSettings();
    Store.saveSettings(Object.assign({}, settings, patch));
  }

  function updateChecklistItemElement(itemEl, isDone) {
    if (!itemEl) return;
    itemEl.classList.toggle('done', !!isDone);
    itemEl.setAttribute('aria-checked', isDone ? 'true' : 'false');
    const icon = itemEl.querySelector('.first-run-checklist-item-icon');
    if (icon) icon.textContent = isDone ? '✓' : '○';
  }

  function refreshFirstRunChecklist() {
    const card = document.getElementById('first-run-checklist-card');
    if (!card) return;

    const state = getFirstRunChecklistState();
    const completedText = document.getElementById('first-run-checklist-progress');

    state.items.forEach((item) => {
      updateChecklistItemElement(document.querySelector('[data-checklist-item="' + item.key + '"]'), item.done);
    });

    if (completedText) {
      completedText.textContent = state.completedCount + ' of ' + state.items.length + ' complete';
    }

    if (state.allDone && !state.settings.firstRunChecklistComplete) {
      saveFirstRunChecklistState({
        firstRunChecklistComplete: true,
        firstRunChecklistDismissed: true,
        onboardingComplete: true,
      });
    }

    card.style.display = state.shouldShow && !state.allDone ? '' : 'none';
  }

  function dismissFirstRunChecklist() {
    saveFirstRunChecklistState({ firstRunChecklistDismissed: true });
    refreshFirstRunChecklist();
  }

  function startTour() {
    const steps = [
      { text: 'Summary gives you a quick snapshot of progress, upcoming doses, and trends.' },
      { text: 'Use Log Dose and Log Weight buttons to quickly keep your data up to date.' },
      { text: 'Use the bottom tabs to open Doses, Progress, Journal, and Settings any time.' },
    ];

    let step = 0;
    const overlay = document.getElementById('tour-overlay');
    const text = document.getElementById('tour-text');
    const label = document.getElementById('tour-step-label');
    const nextBtn = document.getElementById('tour-next');
    const skipBtn = document.getElementById('tour-skip');

    function finishTour() {
      overlay.style.display = 'none';
      saveFirstRunChecklistState({ onboardingComplete: true });
    }

    function show() {
      if (step >= steps.length) {
        finishTour();
        return;
      }
      label.textContent = 'Step ' + (step + 1) + ' of ' + steps.length;
      text.textContent = steps[step].text;
      nextBtn.textContent = step === steps.length - 1 ? 'Done' : 'Next';
      overlay.style.display = 'flex';
    }

    nextBtn.onclick = () => { step++; show(); };
    skipBtn.onclick = finishTour;
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

    // Clear fasting timer when leaving journal page
    if (page !== 'journal' && fastingTimerInterval) {
      clearInterval(fastingTimerInterval);
      fastingTimerInterval = null;
    }

    const refreshers = { summary: refreshSummary, doses: refreshDoses, progress: refreshProgress, journal: refreshJournal, settings: refreshSettings };
    if (refreshers[page]) refreshers[page]();
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
    invalidateChartCache();
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
  var _animationId = 0;
  function animateValue(el, end, duration, suffix, decimals) {
    if (!el || end === null || end === undefined || isNaN(end)) return;
    duration = duration || 600;
    suffix = suffix || '';
    var myId = ++_animationId;
    el._animId = myId;
    const start = 0;
    const range = parseFloat(end) - start;
    const isInt = Number.isInteger(parseFloat(end));
    const startTime = performance.now();
    function update(now) {
      if (el._animId !== myId) return;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + range * eased;
      const dp = decimals !== undefined ? decimals : 1;
      el.textContent = (isInt ? Math.round(current) : current.toFixed(dp)) + suffix;
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
    if (unit === 'st') return Store.formatStone(val);
    return parseFloat(val).toFixed(1) + ' ' + unit;
  }

  function formatWeightShort(val) {
    const unit = Store.getSettings().weightUnit;
    if (val === null || val === undefined || isNaN(val)) return '--';
    if (unit === 'st') return Store.formatStone(val);
    return parseFloat(val).toFixed(1);
  }

  // Reuse Store's date parsing utilities (single source of truth)
  const parseLocalDate = Store.parseLocalDate;
  const formatLocalDate = Store.formatLocalDate;
  const parseTimeParts = Store.parseTimeParts;

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

  var _chartDataHashes = {};

  function chartDataHash(key, data, fields) {
    var length = Array.isArray(data) ? data.length : 0;
    var firstDate = '';
    var lastDate = '';
    var checksum = 2166136261; // FNV-1a 32-bit offset basis
    var includeFields = Array.isArray(fields) && fields.length > 0 ? fields : ['id'];

    function updateChecksum(value) {
      var str = value == null ? '' : String(value);
      for (var i = 0; i < str.length; i++) {
        checksum ^= str.charCodeAt(i);
        checksum = Math.imul(checksum, 16777619);
      }
      // Field separator to avoid accidental collisions across concatenated values
      checksum ^= 124;
      checksum = Math.imul(checksum, 16777619);
    }

    if (length > 0) {
      firstDate = data[0] && data[0].date ? String(data[0].date) : '';
      lastDate = data[length - 1] && data[length - 1].date ? String(data[length - 1].date) : '';

      for (var idx = 0; idx < length; idx++) {
        var row = data[idx] || {};
        for (var fieldIdx = 0; fieldIdx < includeFields.length; fieldIdx++) {
          var field = includeFields[fieldIdx];
          updateChecksum(row[field]);
        }
      }
    }

    var hash = length + ':' + firstDate + ':' + lastDate + ':' + (checksum >>> 0).toString(16);
    if (_chartDataHashes[key] === hash) return true; // unchanged
    _chartDataHashes[key] = hash;
    return false; // changed
  }

  function invalidateChartCache() {
    _chartDataHashes = {};
  }

  function destroyChart(chart) {
    if (chart) chart.destroy();
    return null;
  }

  // Animate a stat value or show a fallback placeholder
  function displayStat(id, value, suffix, fallback, decimals, useStoneFormat) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value != null) {
      if (useStoneFormat) {
        el._animId = ++_animationId;
        el.textContent = Store.formatStone(value);
      } else {
        animateValue(el, value, 600, suffix || '', decimals);
      }
    } else {
      el._animId = ++_animationId;
      el.textContent = fallback !== undefined ? fallback : '--';
    }
  }

  // Shared chart tooltip configuration
  function chartTooltipConfig(overrides) {
    return {
      backgroundColor: 'rgba(15,23,42,0.9)',
      titleColor: '#f1f5f9',
      bodyColor: '#e2e8f0',
      cornerRadius: 10,
      padding: 12,
      ...overrides,
    };
  }

  // Bind common modal close/cancel/backdrop handlers
  function bindModal(modalId, closeBtnIds, formId, onSubmit) {
    const modal = document.getElementById(modalId);
    closeBtnIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => closeModal(modal));
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
    if (formId && onSubmit) {
      document.getElementById(formId).addEventListener('submit', (e) => {
        e.preventDefault();
        onSubmit(e);
      });
    }
    return modal;
  }

  // Initialize filter chip toggle groups
  function initFilterChips(containerId, onChange) {
    document.querySelectorAll('#' + containerId + ' .filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#' + containerId + ' .filter-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range));
      });
    });
  }

  // Filter normalized entries by date range
  function filterByDateRange(entries, range) {
    if (range === 'all') return entries;
    const cutoff = parseLocalDate(new Date());
    cutoff.setDate(cutoff.getDate() - range);
    return entries.filter(e => e._localDate >= cutoff);
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
      'abdomen-upper-left': 'Abdomen (UL)',
      'abdomen-upper-right': 'Abdomen (UR)',
      'abdomen-lower-left': 'Abdomen (LL)',
      'abdomen-lower-right': 'Abdomen (LR)',
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
    if (!('Notification' in window)) return 'in-app only';
    if (Notification.permission === 'denied') return 'in-app only (notifications blocked)';
    if (Notification.permission === 'granted') return 'native push';
    // permission === 'default' — not yet asked
    if (canUseServiceWorkerNotifications()) return 'native push (pending permission)';
    return 'in-app only (tap "Test Notification" to enable)';
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
    if (typeof Sync !== 'undefined' && typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      Sync.syncOnResume();
    }
  }


  function canUsePasskeys() {
    return typeof Auth !== 'undefined' && Auth.isConfigured() && Auth.supportsPasskeys && Auth.supportsPasskeys();
  }

  function startPasskeySignIn(email, opts) {
    var options = opts || {};
    var button = options.button || null;
    var source = options.source || 'passkey';
    if (!email) {
      toast('Enter your email first so we can find your account.', 'error');
      return;
    }
    if (!canUsePasskeys()) {
      toast('Passkeys are not available yet in this browser. Use the magic link option.', 'error');
      return;
    }

    if (button) button.disabled = true;
    Auth.signInWithPasskey(email).then(function (result) {
      if (result && result.error) {
        toast(result.error.message || 'Passkey sign-in failed. Try magic link instead.', 'error');
        return;
      }
      toast(source === 'onboarding' ? 'Passkey accepted. Signing you in...' : 'Signed in with passkey.', 'success');
    }).catch(function (err) {
      toast((err && err.message) || 'Passkey sign-in failed. Try magic link instead.', 'error');
    }).finally(function () {
      if (button) button.disabled = false;
    });
  }

  // ===== AUTH / SYNC =====
  function handleAuthStateChange(e) {
    const event = e.detail.event;
    const session = e.detail.session;
    const onboardingModal = document.getElementById('onboarding-modal');
    const isOnboarding = onboardingModal && onboardingModal.style.display === 'flex';

    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
      if (event === 'SIGNED_IN') {
        toast('Signed in! Syncing your data…', 'success');
        // Close auth modal if open (settings context)
        const authModal = document.getElementById('auth-modal');
        if (authModal) closeModal(authModal);
      }

      // Show syncing status on onboarding sign-in screen
      if (isOnboarding) {
        var syncingMsg = document.getElementById('ob-signin-syncing');
        if (syncingMsg) syncingMsg.style.display = '';
      }

      if (typeof Sync !== 'undefined') {
        // Pause sync listener during merge to avoid re-entrant pushes
        Sync.pauseSync();
        Sync.mergeOnSignIn().then(function () {
          Sync.resumeSync();

          if (isOnboarding) {
            // Check if sync brought profile data
            var profile = Store.getProfile();
            if (profile.name) {
              // Data restored from cloud — close onboarding and boot app
              completeRestoreToSummary('Welcome back! Your data has been restored.', 'Cloud data restored after sign-in.');
            } else {
              // Signed in but no cloud data — show new user form
              toast('Signed in, but no existing data found. Let\'s set up your profile.', '');
              var screenChooser = document.getElementById('ob-screen-chooser');
              var screenForm = document.getElementById('ob-screen-form');
              var screenSignin = document.getElementById('ob-screen-signin');
              if (screenChooser) screenChooser.style.display = 'none';
              if (screenSignin) screenSignin.style.display = 'none';
              if (screenForm) screenForm.style.display = '';
            }
          } else {
            if (event === 'SIGNED_IN') toast('Data synced!', 'success');
            renderAllPages();
          }
        }).catch(function (err) {
          Sync.resumeSync();
          console.error('[App] Sync failed:', err);
          toast('Sync failed. Your data is safe locally.', 'error');
        });
      }
    }

    if (event === 'SIGNED_OUT') {
      toast('Signed out. Your data is still stored locally.', 'success');
    }

    if (!isOnboarding) {
      updateAccountUI();
    }
  }

  function updateAccountUI() {
    const signedOut = document.getElementById('account-signed-out');
    const signedIn = document.getElementById('account-signed-in');
    const accountSection = document.getElementById('settings-account');
    if (!signedOut || !signedIn) return;

    // Hide entire account section if auth is not configured
    if (typeof Auth === 'undefined' || !Auth.isConfigured()) {
      if (accountSection) accountSection.style.display = 'none';
      return;
    }

    if (accountSection) accountSection.style.display = '';

    if (Auth.isLoggedIn()) {
      signedOut.style.display = 'none';
      signedIn.style.display = '';
      const user = Auth.getUser();
      document.getElementById('account-email').textContent = (user && user.email) || 'Unknown';
      const lastSync = typeof Sync !== 'undefined' ? Sync.getLastSyncTime() : null;
      document.getElementById('account-last-sync').textContent = lastSync
        ? 'Last synced ' + new Date(lastSync).toLocaleString()
        : 'Never';
    } else {
      signedOut.style.display = '';
      signedIn.style.display = 'none';
    }
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

  // Safari-compatible requestPermission: handles both callback and Promise patterns
  function safariRequestPermission(callback) {
    var called = false;
    function once(perm) {
      if (called) return;
      called = true;
      callback(perm);
    }
    try {
      // Pass callback for legacy Safari (callback pattern), capture return for Promise pattern
      var result = Notification.requestPermission(once);
      if (result && typeof result.then === 'function') {
        result.then(once).catch(function() { once('denied'); });
      }
    } catch (e) {
      once('denied');
    }
  }

  // Send a test notification, preferring ServiceWorker for Safari PWA compatibility
  async function sendTestNotification() {
    // Safari PWAs require ServiceWorker-based notifications, not new Notification()
    if ('serviceWorker' in navigator) {
      try {
        var registration = await navigator.serviceWorker.ready;
        if (registration && registration.showNotification) {
          await registration.showNotification('Jab It - Test', { body: 'Notifications are working!', icon: 'icons/icon-192.png', tag: 'test' });
          return;
        }
      } catch (e) {
        // Fall through to new Notification()
      }
    }
    new Notification('Jab It - Test', { body: 'Notifications are working!', icon: 'icons/icon-192.png' });
  }

  async function sendReminder(title, message, type) {
    // Prefer ServiceWorker notifications (required for Safari PWAs where new Notification() throws)
    if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      try {
        var registration = await navigator.serviceWorker.ready;
        if (registration && registration.showNotification) {
          await registration.showNotification(title, { body: message, icon: 'icons/icon-192.png', tag: type });
          return;
        }
      } catch (e) {
        // Fall through to new Notification() or in-app banner
      }
    }

    // Fallback to Notification constructor (works in most desktop browsers)
    if (canUseNativeNotifications()) {
      try {
        new Notification(title, { body: message, icon: 'icons/icon-192.png' });
        return;
      } catch (e) {
        // Safari PWA throws TypeError on new Notification() — fall through to banner
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

  function resolveNextJabDateTime(stats, context) {
    if (stats && stats.nextJabDateTime) {
      const canonicalTarget = new Date(stats.nextJabDateTime);
      if (!Number.isNaN(canonicalTarget.getTime())) return canonicalTarget;
    }

    // Legacy fallback for pre-nextJabDateTime stats payloads
    if (stats && stats.nextJabDate) {
      console.warn('[App][NextDoseDateTimeFallback] Falling back to nextJabDate/nextJabTime for ' + context + '.', {
        nextJabDateTime: stats.nextJabDateTime,
        nextJabDate: stats.nextJabDate,
        nextJabTime: stats.nextJabTime,
      });
      const fallbackTarget = parseLocalDate(stats.nextJabDate);
      if (!fallbackTarget) return null;
      if (stats.nextJabTime) {
        const parsedTime = parseTimeParts(stats.nextJabTime);
        if (parsedTime) {
          fallbackTarget.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
        } else {
          fallbackTarget.setHours(9, 0, 0, 0);
        }
      } else {
        fallbackTarget.setHours(9, 0, 0, 0);
      }
      return fallbackTarget;
    }

    if (stats && (stats.nextJabDateTime || stats.nextJabDate)) {
      console.warn('[App][NextDoseDateTimeFallback] Unable to resolve next dose datetime for ' + context + '.', {
        nextJabDateTime: stats.nextJabDateTime,
        nextJabDate: stats.nextJabDate,
        nextJabTime: stats.nextJabTime,
      });
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
    if (settings.doseReminderEnabled) {
      const nextDoseTarget = resolveNextJabDateTime(stats, 'dose reminder');
      if (nextDoseTarget) {
        const diff = dayDiff(new Date(), nextDoseTarget);
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

    // Re-read settings to pick up any reminderDedup changes saved by shouldSendReminder
    var latestSettings = Store.getSettings();
    latestSettings.lastReminderCheckAt = new Date().toISOString();
    Store.saveSettings(latestSettings);
    refreshReminderCapabilityStatus();
  }

  // ===== INIT ALL EXTRA MODALS =====
  function initModals() {
    // NSV Modal
    const nsvModal = bindModal('nsv-modal', ['nsv-modal-close', 'nsv-form-cancel'], 'nsv-form', () => {
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
    const photoModal = bindModal('photo-modal', ['photo-modal-close', 'photo-form-cancel'], 'photo-form', async () => {
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
    bindModal('photo-viewer-modal', ['photo-viewer-close']);

    // Share Card Modal
    bindModal('share-modal', ['share-modal-close']);
    document.getElementById('btn-download-card').addEventListener('click', downloadShareCard);

    // Missed Dose Modal
    const missedModal = bindModal('missed-dose-modal', ['missed-dose-modal-close', 'missed-dose-cancel'], 'missed-dose-form', () => {
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

    const checklistDismiss = document.getElementById('first-run-checklist-dismiss');
    if (checklistDismiss) {
      checklistDismiss.addEventListener('click', () => dismissFirstRunChecklist());
    }

    const quickTourLink = document.getElementById('first-run-quick-tour-link');
    if (quickTourLink) {
      quickTourLink.addEventListener('click', (e) => {
        e.preventDefault();
        startTour();
      });
    }

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
        document.getElementById('streak-label').textContent = combinedStreak === 1 ? 'week streak' : 'weeks streak';
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
    const nextDoseTarget = resolveNextJabDateTime(stats, 'missed dose banner');
    if (nextDoseTarget) {
      const diff = dayDiff(new Date(), nextDoseTarget);
      if (diff < 0) {
        banner.style.display = '';
        document.getElementById('missed-dose-text').textContent = 'Dose overdue by ' + Math.abs(diff) + ' day(s)!';
      } else {
        banner.style.display = 'none';
      }
    } else {
      banner.style.display = 'none';
    }

    if (pendingSummaryBannerMessage) {
      showReminderBanner('dose', pendingSummaryBannerMessage);
      pendingSummaryBannerMessage = '';
    }

    // Stats grid with animated counters
    displayStat('sum-total-doses', stats.totalJabs > 0 ? stats.totalJabs : null, '', '0');
    const isSt = unit === 'st';
    const sumDecimals = isSt ? 2 : 1;
    displayStat(
      'sum-weight-lost',
      Number.isFinite(stats.totalLost) ? stats.totalLost : null,
      ' ' + unit,
      undefined,
      sumDecimals,
      isSt
    );
    displayStat(
      'sum-current',
      Number.isFinite(stats.currentWeight) ? stats.currentWeight : null,
      ' ' + unit,
      undefined,
      sumDecimals,
      isSt
    );
    displayStat(
      'sum-to-goal',
      Number.isFinite(stats.weightToGo) ? stats.weightToGo : null,
      ' ' + unit,
      undefined,
      sumDecimals,
      isSt
    );
    displayStat('sum-pct-lost', Number.isFinite(stats.percentBodyWeightLost) ? stats.percentBodyWeightLost : null, '%');
    var bmiEl = document.getElementById('sum-bmi');
    if (bmiEl) {
      bmiEl._animId = ++_animationId;
      bmiEl.textContent = (stats.bmi && Number.isFinite(stats.bmi)) ? stats.bmi.toFixed(1) : '--';
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

    refreshFirstRunChecklist();
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
      const text = unit === 'st' ? sign + Store.formatStone(Math.abs(val)) : sign + val.toFixed(1) + ' ' + unit;
      return { text, cls };
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

    const filtered = filterByDateRange(normalizeDateEntries(weights, 'weight trend entry'), 30);

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

    const target = resolveNextJabDateTime(stats, 'dose ring');
    if (!target) {
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
      const diffMs = target - now;
      const totalHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
      const diffDays = Math.floor(totalHours / 24);
      const diffHours = totalHours % 24;
      const diffMins = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));

      // Format the due time for display
      const dueTimeStr = target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

      if (diffMs <= 0) {
        ringValue.textContent = 'Due!';
        ringSub.textContent = '';
        ringInfo.textContent = 'Time for your next dose';
        detail.style.display = 'none';
      } else if (diffDays === 0) {
        if (diffHours === 0) {
          ringValue.textContent = diffMins;
          ringSub.textContent = diffMins === 1 ? 'minute' : 'minutes';
        } else {
          ringValue.textContent = diffHours;
          ringSub.textContent = diffHours === 1 ? 'hour' : 'hours';
        }
        ringInfo.textContent = 'until next dose';
        detail.style.display = 'block';
        detail.textContent = 'Due today at ' + dueTimeStr;
      } else {
        ringValue.textContent = diffDays;
        ringSub.textContent = diffDays === 1 ? 'day' : 'days';
        ringInfo.textContent = 'until next dose';
        detail.style.display = 'block';
        detail.textContent = diffDays + 'd ' + diffHours + 'h remaining \u00B7 ' + formatDate(formatLocalDate(target)) + ' at ' + dueTimeStr;
      }
    }
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 60000);

    // Calculate progress using exact canonical datetime for accurate ring fill
    let progress = 0;
    const cycleDuration = cycleDays * 24 * 60 * 60 * 1000;
    const remaining = target - new Date();
    const elapsed = cycleDuration - Math.max(0, remaining);
    progress = Math.max(0, Math.min(1, elapsed / cycleDuration));

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
    const filtered = filterByDateRange(normalizedWeights, 30);

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
          tooltip: chartTooltipConfig({
            borderColor: 'rgba(99,102,241,0.3)',
            borderWidth: 1,
            displayColors: false,
            callbacks: {
              label: (c) => {
                const u = Store.getSettings().weightUnit;
                return c.dataset.label + ': ' + (u === 'st' ? Store.formatStone(c.parsed.y) : c.parsed.y.toFixed(1) + ' ' + u);
              },
            },
          }),
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
    document.getElementById('btn-add-dose').addEventListener('click', () => openDoseModal());
    document.getElementById('btn-first-dose').addEventListener('click', () => openDoseModal());

    const doseModal = bindModal('dose-modal', ['dose-modal-close', 'dose-form-cancel'], 'dose-form', () => {
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
        var result = Store.addJab(entry);
        if (result && result.success === false) {
          toast(result.error, 'error');
          return;
        }
        toast('Dose logged!', 'success');
      }
      // Sync profile dosage/medication with the latest dose entry
      const prof = Store.getProfile();
      if (entry.dose) {
        prof.dosage = String(entry.dose);
      }
      if (entry.medication) {
        prof.medication = entry.medication;
      }
      Store.saveProfile(prof);
      closeModal(doseModal);
      refreshDoses();
      refreshSummary();
    });

    initFilterChips('dose-filters', (range) => {
      currentDoseRange = range;
      refreshDoses();
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
      document.getElementById('dose-amount').value = profile.dosage ? parseFloat(profile.dosage) || '' : '';
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

    let filtered = filterByDateRange(normalizeDateEntries(jabs, 'dose chart/list entry'), currentDoseRange);

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
          <div class="dose-item-title">${escapeHtml(medicationLabel(j.medication))}</div>
          <div class="dose-item-sub">${formatDateShort(j.date)}${j.site ? ' &middot; ' + escapeHtml(siteLabel(j.site)) : ''}${j.notes && j.notes.startsWith('MISSED') ? ' &middot; <strong style="color:var(--warning)">Missed</strong>' : ''}</div>
        </div>
        <div class="dose-item-value">${escapeHtml(j.dose)} ${escapeHtml(j.doseUnit)}</div>
        <div class="dose-item-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit-dose" data-id="${escapeHtml(j.id)}" aria-label="Edit dose">Edit</button>
          <button class="btn btn-ghost btn-sm" data-action="remove-dose" data-id="${escapeHtml(j.id)}" aria-label="Delete dose">Del</button>
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
    if (doseChart && chartDataHash('doses', jabs, ['date', 'dose', 'doseUnit', 'medication'])) return;
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
          tooltip: chartTooltipConfig({
            borderColor: 'rgba(20,184,166,0.3)',
            borderWidth: 1,
            displayColors: false,
            callbacks: {
              label: (c) => c.parsed.y + ' ' + (jabs[c.dataIndex]?.doseUnit || 'mg'),
            },
          }),
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
    const allSites = ['abdomen-upper-left', 'abdomen-upper-right', 'abdomen-lower-left', 'abdomen-lower-right', 'thigh-left', 'thigh-right', 'arm-left', 'arm-right'];

    allSites.forEach(s => {
      const el = document.getElementById('site-' + s);
      if (!el) return;
      el.classList.remove('last-used', 'recommended');
      if (s === data.lastSite) el.classList.add('last-used');
      if (s === data.recommended) el.classList.add('recommended');
    });

    const rec = document.getElementById('site-recommendation');
    rec.innerHTML = 'Last: <strong>' + escapeHtml(siteLabel(data.lastSite)) + '</strong> &middot; Recommended next: <strong>' + escapeHtml(siteLabel(data.recommended)) + '</strong>';
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
          <span class="side-effect-bar-label">${escapeHtml(label)}</span>
          <div class="side-effect-bar-track">
            <div class="side-effect-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="side-effect-bar-count">${count}</span>
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
      <div class="escalation-item ${escapeHtml(e.direction)}" style="animation-delay:${i * 0.05}s">
        <div class="escalation-date">${formatDate(e.date)}</div>
        <div class="escalation-detail">
          ${escapeHtml(e.fromDose)} ${escapeHtml(e.unit)}
          <span class="escalation-arrow">${e.direction === 'up' ? '&#x2191;' : '&#x2193;'}</span>
          ${escapeHtml(e.toDose)} ${escapeHtml(e.unit)}
          (${escapeHtml(medicationLabel(e.medication))})
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
            ${escapeHtml(d.fromDose)} ${escapeHtml(d.unit)} &rarr; ${escapeHtml(d.toDose)} ${escapeHtml(d.unit)}
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
    toast('Dose deleted', 'success');
    refreshDoses();
    refreshSummary();
  }

  // ===== PROGRESS PAGE =====
  async function initProgressPage() {
    document.getElementById('btn-add-weight').addEventListener('click', () => openWeightModal());

    const weightModal = bindModal('weight-modal', ['weight-modal-close', 'weight-form-cancel'], 'weight-form', () => {
      const id = document.getElementById('weight-edit-id').value;
      const unit = Store.getSettings().weightUnit;
      let weightVal;
      if (unit === 'st') {
        weightVal = Store.stLbsToDecimal(
          document.getElementById('weight-st').value,
          document.getElementById('weight-lbs').value
        );
      } else {
        weightVal = document.getElementById('weight-value').value;
      }
      const entry = {
        date: document.getElementById('weight-date').value,
        weight: weightVal,
        note: document.getElementById('weight-note').value,
      };
      if (id) {
        Store.updateWeight(id, entry);
        toast('Weight updated', 'success');
      } else {
        var result = Store.addWeight(entry);
        if (result && result.success === false) {
          toast(result.error, 'error');
          return;
        }
        toast('Weight logged!', 'success');
      }
      closeModal(weightModal);
      refreshProgress();
      refreshSummary();
    });

    initFilterChips('progress-filters', (range) => {
      currentProgressRange = range;
      refreshProgress();
    });

    // Measurement button
    document.getElementById('btn-add-measurement').addEventListener('click', () => openMeasurementModal());

    // Measurement modal
    const measurementModal = bindModal('measurement-modal', ['measurement-modal-close', 'measurement-form-cancel'], 'measurement-form', () => {
      const id = document.getElementById('measurement-edit-id').value;
      const entry = {
        date: document.getElementById('measurement-date').value,
        waist: document.getElementById('measurement-waist').value || null,
        hips: document.getElementById('measurement-hips').value || null,
        chest: document.getElementById('measurement-chest').value || null,
        neck: document.getElementById('measurement-neck').value || null,
        armLeft: document.getElementById('measurement-arm-left').value || null,
        armRight: document.getElementById('measurement-arm-right').value || null,
        thighLeft: document.getElementById('measurement-thigh-left').value || null,
        thighRight: document.getElementById('measurement-thigh-right').value || null,
        note: document.getElementById('measurement-note').value,
      };
      if (id) {
        Store.updateMeasurement(id, entry);
        toast('Measurement updated', 'success');
      } else {
        Store.addMeasurement(entry);
        toast('Measurement logged!', 'success');
      }
      closeModal(measurementModal);
      refreshProgress();
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
  }

  function openWeightModal(id) {
    const modal = document.getElementById('weight-modal');
    const unit = Store.getSettings().weightUnit;
    const isSt = unit === 'st';

    // Toggle input visibility
    document.getElementById('weight-decimal-group').style.display = isSt ? 'none' : '';
    document.getElementById('weight-st-group').style.display = isSt ? '' : 'none';
    // Manage required attributes
    document.getElementById('weight-value').required = !isSt;

    if (id) {
      const weights = Store.getWeights();
      const w = weights.find(x => x.id === id);
      if (!w) return;
      document.getElementById('weight-edit-id').value = id;
      document.getElementById('weight-modal-title').textContent = 'Edit Weight';
      document.getElementById('weight-date').value = w.date;
      if (isSt) {
        var parts = Store.decimalToStLbs(w.weight);
        document.getElementById('weight-st').value = parts.st;
        document.getElementById('weight-lbs').value = parts.lbs;
      } else {
        document.getElementById('weight-value').value = w.weight;
      }
      document.getElementById('weight-note').value = w.note || '';
    } else {
      document.getElementById('weight-edit-id').value = '';
      document.getElementById('weight-modal-title').textContent = 'Log Weight';
      document.getElementById('weight-date').value = formatLocalDate(new Date());
      document.getElementById('weight-value').value = '';
      document.getElementById('weight-st').value = '';
      document.getElementById('weight-lbs').value = '';
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
    const progIsSt = unit === 'st';
    const progDecimals = progIsSt ? 2 : 1;
    displayStat(
      'prog-current',
      Number.isFinite(stats.currentWeight) ? stats.currentWeight : null,
      ' ' + unit,
      undefined,
      progDecimals,
      progIsSt
    );
    displayStat(
      'prog-start',
      Number.isFinite(stats.startWeight) ? stats.startWeight : null,
      ' ' + unit,
      undefined,
      progDecimals,
      progIsSt
    );
    displayStat(
      'prog-total-lost',
      Number.isFinite(stats.totalLost) ? stats.totalLost : null,
      ' ' + unit,
      undefined,
      progDecimals,
      progIsSt
    );
    displayStat('prog-pct-lost', Number.isFinite(stats.percentBodyWeightLost) ? stats.percentBodyWeightLost : null, '%');
    displayStat(
      'prog-to-goal',
      Number.isFinite(stats.weightToGo) ? stats.weightToGo : null,
      ' ' + unit,
      undefined,
      progDecimals,
      progIsSt
    );
    displayStat(
      'prog-weekly-avg',
      Number.isFinite(stats.avgWeeklyLoss) ? stats.avgWeeklyLoss : null,
      ' ' + unit,
      undefined,
      progDecimals,
      progIsSt
    );

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
    const filtered = filterByDateRange(normalizedWeights, currentProgressRange);

    // Chart
    renderWeightFullChart(filtered);

    // Weight entries list
    renderWeightEntries(filtered);

    // Body measurements
    renderMeasurements();

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
    if (weightFullChart && chartDataHash('weightFull', weights, ['date', 'weight'])) return;
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
          tooltip: chartTooltipConfig({
            borderColor: 'rgba(99,102,241,0.3)',
            borderWidth: 1,
            displayColors: false,
            filter: (item) => !item.dataset.label.startsWith('Healthy'),
            callbacks: {
              label: (c) => {
                const u = Store.getSettings().weightUnit;
                return c.dataset.label + ': ' + (u === 'st' ? Store.formatStone(c.parsed.y) : c.parsed.y.toFixed(1) + ' ' + u);
              },
            },
          }),
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
        let diffDisplay;
        if (unit === 'st') {
          const diffLbs = Math.round(Math.abs(diff) * 14);
          diffDisplay = (diff > 0 ? '+' : '-') + diffLbs + 'lbs';
        } else {
          diffDisplay = sign + diff.toFixed(1);
        }
        changeHtml = `<span class="weight-item-change ${cls}">${diffDisplay}</span>`;
      }
      const weightDisplay = unit === 'st' ? Store.formatStone(w.weight) : parseFloat(w.weight).toFixed(1) + ' ' + unit;
      return `
        <div class="weight-item">
          <div class="weight-item-info">
            <div class="weight-item-date">${formatDateShort(w.date)} ${w.note ? '&middot; ' + escapeHtml(w.note) : ''}</div>
            <div class="weight-item-value">${weightDisplay} ${changeHtml}</div>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-sm" data-action="edit-weight" data-id="${escapeHtml(w.id)}" aria-label="Edit weight entry">Edit</button>
            <button class="btn btn-ghost btn-sm" data-action="remove-weight" data-id="${escapeHtml(w.id)}" aria-label="Delete weight entry">Del</button>
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

    gallery.innerHTML = [...photos].reverse().map(function(p) {
      var imgSrc = p.thumbDataUrl || p.dataUrl;
      var syncIcon = p.syncedAt
        ? '<span class="photo-sync-badge synced" title="Synced to cloud"></span>'
        : '<span class="photo-sync-badge pending" title="Not yet synced"></span>';
      return '<div class="photo-thumb" data-action="view-photos">'
        + '<img src="' + escapeHtml(imgSrc) + '" alt="Progress photo ' + formatDateShort(p.date) + '" loading="lazy">'
        + '<span class="photo-thumb-date">' + formatDateShort(p.date) + '</span>'
        + syncIcon
        + '<button class="photo-thumb-delete" data-action="remove-photo" data-id="' + escapeHtml(p.id) + '" aria-label="Delete photo">&times;</button>'
        + '</div>';
    }).join('');
  }

  async function viewPhotos() {
    const photos = await Store.getPhotos();
    if (photos.length === 0) return;

    const leftSel = document.getElementById('photo-compare-left');
    const rightSel = document.getElementById('photo-compare-right');

    const options = photos.map(p =>
      '<option value="' + escapeHtml(p.id) + '">' + formatDateShort(p.date) + (p.note ? ' - ' + escapeHtml(p.note) : '') + '</option>'
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

    leftFrame.innerHTML = leftPhoto ? '<img src="' + escapeHtml(leftPhoto.dataUrl) + '" alt="Left comparison photo">' : 'No photo';
    rightFrame.innerHTML = rightPhoto ? '<img src="' + escapeHtml(rightPhoto.dataUrl) + '" alt="Right comparison photo">' : 'No photo';
  }

  async function removePhoto(id) {
    if (!confirm('Delete this photo?')) return;
    await Store.deletePhoto(id);
    toast('Photo deleted', 'success');
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
          <div class="nsv-text">${escapeHtml(v.text)}</div>
          <div class="nsv-meta">${formatDateShort(v.date)} &middot; ${escapeHtml(v.category)}</div>
        </div>
        <button class="nsv-delete" data-action="remove-victory" data-id="${escapeHtml(v.id)}" aria-label="Delete victory">&times;</button>
      </div>
    `).join('');
    staggerListItems('#nsv-list .nsv-item');
  }

  function removeVictory(id) {
    if (!confirm('Delete this entry?')) return;
    Store.deleteVictory(id);
    toast('Entry deleted', 'success');
    renderNSVList();
  }

  function removeWeight(id) {
    if (!confirm('Delete this weight entry?')) return;
    Store.deleteWeight(id);
    toast('Entry deleted', 'success');
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
      const passphrase = prompt('Create a backup passphrase (minimum 8 characters). You will need it to restore this file.');
      if (passphrase === null) return;
      const dateStamp = new Date().toISOString().split('T')[0];
      try {
        const encryptedPayload = await Store.exportEncryptedBackup(passphrase);
        if (preferCompressed) {
          const compressedBlob = await buildCompressedBackupBlob(encryptedPayload);
          if (compressedBlob) {
            triggerDownload(compressedBlob, 'jabit-backup-' + dateStamp + '.json.gz');
            toast(largePayloadFallback ? 'Large URL payload blocked; encrypted backup file exported instead.' : 'Encrypted backup exported!', 'success');
            return;
          }
        }
        triggerDownload(new Blob([encryptedPayload], { type: 'application/json' }), 'jabit-backup-' + dateStamp + '.json');
        toast(largePayloadFallback ? 'Large URL payload blocked; encrypted backup file exported instead.' : 'Encrypted backup exported!', 'success');
      } catch (err) {
        if (err && err.message === 'invalid-passphrase') {
          toast('Use a passphrase with at least 8 characters.', 'error');
        } else if (err && err.message === 'crypto-not-supported') {
          toast('Encrypted backups are not supported in this browser.', 'error');
        } else {
          toast('Backup export failed. Please try again.', 'error');
        }
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
      linkExportButton.disabled = false;
      linkExportButton.title = 'Create a metadata-only backup link (no personal entries included).';
    }

    async function importFromEncodedPayload(encoded, fromRestoreParam) {
      const importResult = await Store.importFromBackupLink(encoded);
      if (importResult.success) {
        if (importResult.warnings > 0) {
          completeRestoreToSummary('Data restored' + (fromRestoreParam ? ' from link' : '') + ' with ' + importResult.warnings + ' skipped invalid row(s).', 'Backup restored from link.');
        } else {
          completeRestoreToSummary('Data restored' + (fromRestoreParam ? ' from link' : '') + '!', 'Backup restored from link.');
        }
        return;
      }
      if (importResult.metadataOnly) {
        toast('This is a metadata-only link. Ask for the encrypted backup file to fully restore data.', 'error');
        return;
      }
      if (importResult.blocked) {
        toast('Restore link blocked for privacy. Use Import Data with an encrypted backup file instead.', 'error');
        return;
      }
      toast('Invalid backup link.', 'error');
    }

    document.getElementById('btn-save-settings').addEventListener('click', () => saveAllSettings());

    // Persist current dose in real-time so it isn't lost when navigating away from Settings.
    const setDosageInput = document.getElementById('set-dosage');
    if (setDosageInput) {
      const persistDosageDraft = () => {
        setDosageDraft(setDosageInput.value);
        const profile = Store.getProfile();
        profile.dosage = setDosageInput.value;
        Store.saveProfile(profile);
      };
      setDosageInput.addEventListener('input', persistDosageDraft);
      setDosageInput.addEventListener('change', persistDosageDraft);
    }

    // Doctor visit report
    document.getElementById('btn-doctor-report').addEventListener('click', generateDoctorReport);

    // Settings height unit toggle (cm ↔ feet/inches)
    document.getElementById('set-height-unit').addEventListener('change', function () {
      updateSettingsHeightUnitUi();
      setSettingsHeightDraft();
    });
    document.getElementById('set-height').addEventListener('input', setSettingsHeightDraft);
    document.getElementById('set-height-ft').addEventListener('input', setSettingsHeightDraft);
    document.getElementById('set-height-in').addEventListener('input', setSettingsHeightDraft);

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
    const importButton = document.getElementById('btn-import');
    document.getElementById('btn-import').addEventListener('click', () => {
      if (importButton && importButton.disabled) return;
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || e.target.dataset.importing === 'true') return;
      e.target.dataset.importing = 'true';
      setButtonLoading(importButton, 'Importing backup...');

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
        let importResult = await Store.importBackupData(content, '');

        if (importResult.requiresPassphrase) {
          const passphrase = prompt('Enter the backup passphrase to decrypt this file.');
          if (passphrase === null) {
            e.target.value = '';
            e.target.dataset.importing = 'false';
            clearButtonLoading(importButton);
            return;
          }
          importResult = await Store.importBackupData(content, passphrase);
        }

        if (importResult.success) {
          if (importResult.warnings > 0) {
            completeRestoreToSummary('Data imported with ' + importResult.warnings + ' skipped invalid row(s).', 'Backup imported from file.');
          } else {
            completeRestoreToSummary('Data imported!', 'Backup imported from file.');
          }
          await updateBackupLinkState();
        } else if (importResult.requiresPassphrase && importResult.error === 'invalid-passphrase') {
          toast('Incorrect passphrase. Try again or cancel.', 'error');
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
      e.target.dataset.importing = 'false';
      clearButtonLoading(importButton);
    });

    // Export/copy backup link (metadata only)
    if (linkExportButton) {
      linkExportButton.addEventListener('click', () => {
        const encoded = Store.generateMetadataBackupLink();
        if (!encoded) {
          toast('Failed to generate metadata link.', 'error');
          return;
        }
        const link = window.location.origin + window.location.pathname + '?restore=' + encoded;
        copyText(link, 'Metadata-only link copied. Share encrypted backup file for full restore.');
      });
    }

    // Paste backup link
    document.getElementById('btn-paste-backup').addEventListener('click', () => {
      const input = prompt('Paste a metadata backup link. For full restore, use an encrypted backup file.');
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
      toast('All data cleared', 'success');
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
        sendTestNotification();
        toast('Test notification sent!', 'success');
      } else if (Notification.permission === 'denied') {
        // Still show in-app banner as fallback
        showReminderBanner('dose', 'This is a test reminder. In-app banners will appear on the Summary page when reminders are due.');
        toast('Browser notifications blocked. In-app reminders will be used instead.', 'error');
      } else {
        // Safari (older) uses callback, modern browsers return a Promise
        safariRequestPermission(function(perm) {
          if (perm === 'granted') {
            sendTestNotification();
            toast('Notifications enabled!', 'success');
          } else {
            showReminderBanner('dose', 'This is a test reminder. In-app banners will appear on the Summary page when reminders are due.');
            toast('Using in-app reminders instead.', 'success');
          }
          refreshReminderCapabilityStatus();
        });
      }
    });

    // ===== Account / Auth Buttons =====
    const btnOpenAuth = document.getElementById('btn-open-auth');
    if (btnOpenAuth) {
      btnOpenAuth.addEventListener('click', function () {
        const authModal = document.getElementById('auth-modal');
        // Reset modal to input state
        document.getElementById('auth-form').style.display = '';
        document.getElementById('auth-magic-link-sent').style.display = 'none';
        document.getElementById('auth-email').value = '';
        const sendBtn = document.getElementById('btn-send-magic-link');
        if (sendBtn) clearButtonLoading(sendBtn);
        const passkeyBtn = document.getElementById('btn-sign-in-passkey');
        if (passkeyBtn) {
          passkeyBtn.disabled = false;
          passkeyBtn.style.display = canUsePasskeys() ? '' : 'none';
        }
        openModal(authModal);
      });
    }

    const authForm = document.getElementById('auth-form');
    if (authForm) {
      authForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const email = document.getElementById('auth-email').value.trim();
        if (!email || typeof Auth === 'undefined' || !Auth.isConfigured()) return;
        const sendBtn = document.getElementById('btn-send-magic-link');
        setButtonLoading(sendBtn, 'Sending link...');
        Auth.signInWithMagicLink(email).then(function (result) {
          if (result.error) {
            toast(result.error.message || 'Failed to send magic link. Try again or cancel.', 'error');
            clearButtonLoading(sendBtn);
            return;
          }
          clearButtonLoading(sendBtn);
          document.getElementById('auth-form').style.display = 'none';
          document.getElementById('auth-magic-link-sent').style.display = '';
          document.getElementById('auth-sent-email').textContent = email;
        }).catch(function (err) {
          toast((err && err.message) || 'Failed to send magic link. Check your connection. Try again or cancel.', 'error');
          clearButtonLoading(sendBtn);
        });
      });
    }

    const btnPasskeySignIn = document.getElementById('btn-sign-in-passkey');
    if (btnPasskeySignIn) {
      btnPasskeySignIn.style.display = canUsePasskeys() ? '' : 'none';
      btnPasskeySignIn.addEventListener('click', function () {
        const email = document.getElementById('auth-email').value.trim();
        startPasskeySignIn(email, { button: btnPasskeySignIn, source: 'settings' });
      });
    }


    const authModalClose = document.getElementById('auth-modal-close');
    if (authModalClose) {
      authModalClose.addEventListener('click', function () {
        closeModal(document.getElementById('auth-modal'));
      });
    }

    // Close auth modal on backdrop click
    const authModal = document.getElementById('auth-modal');
    if (authModal) {
      authModal.addEventListener('click', function (e) {
        if (e.target === authModal) closeModal(authModal);
      });
    }

    const btnSignOut = document.getElementById('btn-sign-out');
    if (btnSignOut) {
      btnSignOut.addEventListener('click', function () {
        if (typeof Auth === 'undefined') return;
        if (!confirm('Sign out? Your data will remain on this device.')) return;
        Auth.signOut().then(function () {
          updateAccountUI();
        });
      });
    }

    const btnSyncNow = document.getElementById('btn-sync-now');
    if (btnSyncNow) {
      btnSyncNow.addEventListener('click', function () {
        if (typeof Auth === 'undefined' || typeof Sync === 'undefined' || !Auth.isLoggedIn()) return;
        toast('Syncing...');
        btnSyncNow.disabled = true;
        Sync.pauseSync();
        Sync.pullAll().then(function () {
          return Sync.pushAll();
        }).then(function () {
          Sync.resumeSync();
          toast('Sync complete!', 'success');
          renderAllPages();
          btnSyncNow.disabled = false;
        }).catch(function () {
          Sync.resumeSync();
          toast('Sync failed. Please try again.', 'error');
          btnSyncNow.disabled = false;
        });
      });
    }

    // Check for restore param on load
    const params = new URLSearchParams(window.location.search);
    if (params.has('restore')) {
      const encoded = params.get('restore');
      importFromEncodedPayload(encoded, true);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  function updateSettingsWeightFields(unit, startWeight, goalWeight) {
    var isSt = unit === 'st';
    document.getElementById('set-start-decimal-group').style.display = isSt ? 'none' : '';
    document.getElementById('set-start-st-group').style.display = isSt ? '' : 'none';
    document.getElementById('set-goal-decimal-group').style.display = isSt ? 'none' : '';
    document.getElementById('set-goal-st-group').style.display = isSt ? '' : 'none';
    if (isSt) {
      if (startWeight) {
        var sp = Store.decimalToStLbs(startWeight);
        document.getElementById('set-start-st').value = sp.st;
        document.getElementById('set-start-lbs').value = sp.lbs;
      } else {
        document.getElementById('set-start-st').value = '';
        document.getElementById('set-start-lbs').value = '';
      }
      if (goalWeight) {
        var gp = Store.decimalToStLbs(goalWeight);
        document.getElementById('set-goal-st').value = gp.st;
        document.getElementById('set-goal-lbs').value = gp.lbs;
      } else {
        document.getElementById('set-goal-st').value = '';
        document.getElementById('set-goal-lbs').value = '';
      }
    } else {
      document.getElementById('set-start-weight').value = startWeight || '';
      document.getElementById('set-goal-weight').value = goalWeight || '';
    }
  }

  function updateSettingsHeightUnitUi() {
    var unit = document.getElementById('set-height-unit').value;
    var cmGroup = document.getElementById('set-height-cm-group');
    var imperialGroup = document.getElementById('set-height-imperial-group');
    var isImperial = unit === 'ft';

    cmGroup.style.display = isImperial ? 'none' : '';
    imperialGroup.style.display = isImperial ? '' : 'none';

    if (isImperial) {
      // Convert current cm value to feet/inches for display
      var cmVal = parseFloat(document.getElementById('set-height').value);
      if (Number.isFinite(cmVal) && cmVal > 0) {
        var totalInches = cmVal / 2.54;
        var feet = Math.floor(totalInches / 12);
        var inches = Math.round(totalInches % 12);
        if (inches === 12) { feet++; inches = 0; }
        document.getElementById('set-height-ft').value = feet;
        document.getElementById('set-height-in').value = inches;
      }
    } else {
      // Convert feet/inches back to cm
      var ft = parseFloat(document.getElementById('set-height-ft').value);
      var inc = parseFloat(document.getElementById('set-height-in').value);
      if (Number.isFinite(ft) && Number.isFinite(inc)) {
        var cm = ((ft * 12) + inc) * 2.54;
        document.getElementById('set-height').value = cm.toFixed(1);
      }
    }
  }

  function setSettingsHeightDraft() {
    settingsHeightDraft = {
      cm: document.getElementById('set-height').value,
      unit: document.getElementById('set-height-unit').value,
      ft: document.getElementById('set-height-ft').value,
      inch: document.getElementById('set-height-in').value
    };
  }

  function saveAllSettings() {
    const profile = Store.getProfile();
    profile.name = document.getElementById('set-name').value.trim();
    var heightUnit = document.getElementById('set-height-unit').value;
    if (heightUnit === 'ft') {
      var ft = parseFloat(document.getElementById('set-height-ft').value) || 0;
      var inc = parseFloat(document.getElementById('set-height-in').value) || 0;
      profile.height = (((ft * 12) + inc) * 2.54).toFixed(1);
    } else {
      profile.height = document.getElementById('set-height').value;
    }
    profile.heightUnit = heightUnit;
    settingsHeightDraft = null;
    var currentUnit = Store.getSettings().weightUnit;
    if (currentUnit === 'st') {
      profile.startWeight = Store.stLbsToDecimal(
        document.getElementById('set-start-st').value,
        document.getElementById('set-start-lbs').value
      );
    } else {
      profile.startWeight = document.getElementById('set-start-weight').value;
    }
    profile.medication = document.getElementById('set-medication').value;
    profile.dosage = document.getElementById('set-dosage').value;
    profile.frequency = document.getElementById('set-frequency').value;
    Store.saveProfile(profile);
    clearDosageDraft();

    const goals = Store.getGoals();
    if (currentUnit === 'st') {
      goals.targetWeight = Store.stLbsToDecimal(
        document.getElementById('set-goal-st').value,
        document.getElementById('set-goal-lbs').value
      );
    } else {
      goals.targetWeight = document.getElementById('set-goal-weight').value;
    }
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
      const newGoals = Store.getGoals();
      updateSettingsWeightFields(newUnit, newProfile.startWeight, newGoals.targetWeight);
      toast('All weights converted to ' + newUnit + '!', 'success');
    }

    // Request notification permission if reminders enabled (Safari-compatible)
    if ((settings.doseReminderEnabled || settings.weighInReminderEnabled) && 'Notification' in window && Notification.permission === 'default') {
      safariRequestPermission(function() { refreshReminderCapabilityStatus(); });
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
    // Height is always stored in cm internally
    if (settingsHeightDraft) {
      document.getElementById('set-height').value = settingsHeightDraft.cm || '';
      document.getElementById('set-height-unit').value = settingsHeightDraft.unit || 'cm';
      document.getElementById('set-height-ft').value = settingsHeightDraft.ft || '';
      document.getElementById('set-height-in').value = settingsHeightDraft.inch || '';
    } else {
      document.getElementById('set-height').value = profile.height || '';
      document.getElementById('set-height-unit').value = profile.heightUnit || 'cm';
      // Pre-populate feet/inches from stored cm value
      var storedCm = parseFloat(profile.height);
      if (Number.isFinite(storedCm) && storedCm > 0) {
        var totalIn = storedCm / 2.54;
        var ftVal = Math.floor(totalIn / 12);
        var inVal = Math.round(totalIn % 12);
        if (inVal === 12) { ftVal++; inVal = 0; }
        document.getElementById('set-height-ft').value = ftVal;
        document.getElementById('set-height-in').value = inVal;
      } else {
        document.getElementById('set-height-ft').value = '';
        document.getElementById('set-height-in').value = '';
      }
    }
    // Show/hide correct input group
    var isImp = document.getElementById('set-height-unit').value === 'ft';
    document.getElementById('set-height-cm-group').style.display = isImp ? 'none' : '';
    document.getElementById('set-height-imperial-group').style.display = isImp ? '' : 'none';
    document.getElementById('set-weight-unit').value = settings.weightUnit || 'kg';
    updateSettingsWeightFields(settings.weightUnit, profile.startWeight, goals.targetWeight);
    document.getElementById('set-medication').value = profile.medication || 'semaglutide';
    const dosageDraft = getDosageDraft();
    document.getElementById('set-dosage').value = dosageDraft || profile.dosage || '';
    document.getElementById('set-frequency').value = profile.frequency || 'weekly';
    document.getElementById('set-theme').value = settings.theme || 'light';
    document.getElementById('set-weigh-schedule').value = settings.weighInSchedule || 'weekly';
    document.getElementById('set-dose-reminder').checked = !!settings.doseReminderEnabled;
    document.getElementById('set-weighin-reminder').checked = !!settings.weighInReminderEnabled;

    updateWeightUnitLabels();
    refreshReminderCapabilityStatus();
    updateAccountUI();
  }

  // ===== BODY MEASUREMENTS =====
  function openMeasurementModal(id) {
    const modal = document.getElementById('measurement-modal');
    if (id) {
      const measurements = Store.getMeasurements();
      const m = measurements.find(x => x.id === id);
      if (!m) return;
      document.getElementById('measurement-edit-id').value = id;
      document.getElementById('measurement-modal-title').textContent = 'Edit Measurements';
      document.getElementById('measurement-date').value = m.date;
      document.getElementById('measurement-waist').value = m.waist || '';
      document.getElementById('measurement-hips').value = m.hips || '';
      document.getElementById('measurement-chest').value = m.chest || '';
      document.getElementById('measurement-neck').value = m.neck || '';
      document.getElementById('measurement-arm-left').value = m.armLeft || '';
      document.getElementById('measurement-arm-right').value = m.armRight || '';
      document.getElementById('measurement-thigh-left').value = m.thighLeft || '';
      document.getElementById('measurement-thigh-right').value = m.thighRight || '';
      document.getElementById('measurement-note').value = m.note || '';
    } else {
      document.getElementById('measurement-edit-id').value = '';
      document.getElementById('measurement-modal-title').textContent = 'Log Measurements';
      document.getElementById('measurement-date').value = formatLocalDate(new Date());
      document.getElementById('measurement-waist').value = '';
      document.getElementById('measurement-hips').value = '';
      document.getElementById('measurement-chest').value = '';
      document.getElementById('measurement-neck').value = '';
      document.getElementById('measurement-arm-left').value = '';
      document.getElementById('measurement-arm-right').value = '';
      document.getElementById('measurement-thigh-left').value = '';
      document.getElementById('measurement-thigh-right').value = '';
      document.getElementById('measurement-note').value = '';
    }
    openModal(modal);
  }

  function renderMeasurements() {
    const measurements = Store.getMeasurements();
    const list = document.getElementById('measurement-list');
    const empty = document.getElementById('measurement-empty');
    const chartContainer = document.getElementById('measurement-chart-container');
    const statsEl = document.getElementById('measurement-stats');

    if (measurements.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      chartContainer.style.display = 'none';
      statsEl.style.display = 'none';
      return;
    }

    empty.style.display = 'none';

    // Measurement stats
    const mStats = Store.getMeasurementStats();
    if (mStats) {
      statsEl.style.display = '';
      const fields = [
        { key: 'waist', label: 'Waist' },
        { key: 'hips', label: 'Hips' },
        { key: 'chest', label: 'Chest' },
      ];
      statsEl.innerHTML = '<div class="measurement-stats-grid">' + fields.map(f => {
        const latest = mStats.latest[f.key];
        const change = mStats.changes[f.key];
        if (!latest) return '';
        const changeStr = change ? (change > 0 ? '+' : '') + change + ' cm' : '';
        const cls = change ? (change < 0 ? 'loss' : change > 0 ? 'gain' : '') : '';
        return '<div class="measurement-stat-item"><span class="measurement-stat-label">' + f.label + '</span><span class="measurement-stat-value">' + latest + ' cm</span>' + (changeStr ? '<span class="measurement-stat-change ' + cls + '">' + changeStr + '</span>' : '') + '</div>';
      }).filter(Boolean).join('') + '</div>';
    } else {
      statsEl.style.display = 'none';
    }

    // Chart
    if (measurements.length >= 2) {
      chartContainer.style.display = '';
      renderMeasurementChart(measurements);
    } else {
      chartContainer.style.display = 'none';
    }

    // List
    const sorted = [...measurements].reverse();
    list.innerHTML = sorted.map(m => {
      const parts = [];
      if (m.waist) parts.push('W:' + m.waist);
      if (m.hips) parts.push('H:' + m.hips);
      if (m.chest) parts.push('C:' + m.chest);
      return '<div class="measurement-item"><div class="measurement-item-info"><div class="measurement-item-date">' + formatDateShort(m.date) + '</div><div class="measurement-item-values">' + escapeHtml(parts.join(' | ')) + ' cm</div></div><div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" data-action="edit-measurement" data-id="' + escapeHtml(m.id) + '" aria-label="Edit measurement">Edit</button><button class="btn btn-ghost btn-sm" data-action="remove-measurement" data-id="' + escapeHtml(m.id) + '" aria-label="Delete measurement">Del</button></div></div>';
    }).join('');
    staggerListItems('#measurement-list .measurement-item');
  }

  function renderMeasurementChart(measurements) {
    if (measurementChart && chartDataHash('measurements', measurements, ['date', 'waist', 'hips', 'chest'])) return;
    const colors = getChartColors();
    measurementChart = destroyChart(measurementChart);
    const ctx = document.getElementById('chart-measurements').getContext('2d');

    const labels = measurements.map(m => m.date);
    const datasets = [];
    const colorMap = { waist: '#8b5cf6', hips: '#ec4899', chest: '#f59e0b' };
    const fields = [
      { key: 'waist', label: 'Waist' },
      { key: 'hips', label: 'Hips' },
      { key: 'chest', label: 'Chest' },
    ];

    fields.forEach(f => {
      const data = measurements.map(m => m[f.key] ? parseFloat(m[f.key]) : null);
      if (data.some(d => d !== null)) {
        datasets.push({
          label: f.label,
          data,
          borderColor: colorMap[f.key],
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: colorMap[f.key],
          fill: false,
          spanGaps: true,
        });
      }
    });

    if (datasets.length === 0) return;

    measurementChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: true, labels: { color: colors.textMuted, font: { size: 10 } } },
          tooltip: chartTooltipConfig({
            callbacks: { label: (c) => c.dataset.label + ': ' + c.parsed.y + ' cm' },
          }),
        },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'dd MMM yyyy' }, grid: { display: false }, ticks: { color: colors.textMuted, font: { size: 10 }, maxTicksLimit: 6 } },
          y: { grid: { color: colors.grid }, ticks: { color: colors.textMuted, font: { size: 10 } } },
        },
      },
    });
  }

  function removeMeasurement(id) {
    if (!confirm('Delete this measurement?')) return;
    Store.deleteMeasurement(id);
    toast('Measurement deleted', 'success');
    refreshProgress();
  }

  // ===== JOURNAL PAGE =====
  function initJournalPage() {
    document.getElementById('btn-add-journal').addEventListener('click', () => openJournalModal());

    // Mood/energy picker toggle helper
    function initPickerButtons(pickerId, hiddenInputId) {
      document.querySelectorAll('#' + pickerId + ' .mood-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#' + pickerId + ' .mood-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById(hiddenInputId).value = btn.dataset.value;
        });
      });
    }
    initPickerButtons('mood-picker', 'journal-mood');
    initPickerButtons('energy-picker', 'journal-energy');

    const journalModal = bindModal('journal-modal', ['journal-modal-close', 'journal-form-cancel'], 'journal-form', () => {
      const id = document.getElementById('journal-edit-id').value;
      const entry = {
        date: document.getElementById('journal-date').value,
        mood: document.getElementById('journal-mood').value ? parseInt(document.getElementById('journal-mood').value) : null,
        energy: document.getElementById('journal-energy').value ? parseInt(document.getElementById('journal-energy').value) : null,
        symptoms: Array.from(document.querySelectorAll('input[name="journal-symptom"]:checked')).map(cb => cb.value),
        text: document.getElementById('journal-text').value,
      };
      if (id) {
        Store.updateJournalEntry(id, entry);
        toast('Journal entry updated', 'success');
      } else {
        Store.addJournalEntry(entry);
        toast('Journal entry saved!', 'success');
      }
      closeModal(journalModal);
      refreshJournal();
    });

    // Exercise modal
    document.getElementById('btn-add-exercise').addEventListener('click', () => openExerciseModal());

    const exerciseModal = bindModal('exercise-modal', ['exercise-modal-close', 'exercise-form-cancel'], 'exercise-form', () => {
      const id = document.getElementById('exercise-edit-id').value;
      const entry = {
        date: document.getElementById('exercise-date').value,
        type: document.getElementById('exercise-type').value,
        duration: document.getElementById('exercise-duration').value,
        intensity: document.getElementById('exercise-intensity').value,
        calories: document.getElementById('exercise-calories').value || null,
        note: document.getElementById('exercise-note').value,
      };
      if (id) {
        Store.updateExercise(id, entry);
        toast('Exercise updated', 'success');
      } else {
        Store.addExercise(entry);
        toast('Exercise logged!', 'success');
      }
      closeModal(exerciseModal);
      refreshJournal();
    });

    // Fasting timer protocol chips
    document.querySelectorAll('#fasting-protocols .protocol-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#fasting-protocols .protocol-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('btn-start-fast').addEventListener('click', startFast);
    document.getElementById('btn-end-fast').addEventListener('click', endFast);
    document.getElementById('btn-cancel-fast').addEventListener('click', cancelFast);
  }

  function openJournalModal(id) {
    const modal = document.getElementById('journal-modal');
    if (id) {
      const journal = Store.getJournal();
      const j = journal.find(x => x.id === id);
      if (!j) return;
      document.getElementById('journal-edit-id').value = id;
      document.getElementById('journal-modal-title').textContent = 'Edit Journal Entry';
      document.getElementById('journal-date').value = j.date;
      document.getElementById('journal-mood').value = j.mood || '';
      document.getElementById('journal-energy').value = j.energy || '';
      document.getElementById('journal-text').value = j.text || '';
      // Set mood buttons
      document.querySelectorAll('#mood-picker .mood-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.value === String(j.mood));
      });
      document.querySelectorAll('#energy-picker .mood-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.value === String(j.energy));
      });
      document.querySelectorAll('input[name="journal-symptom"]').forEach(cb => {
        cb.checked = j.symptoms && j.symptoms.includes(cb.value);
      });
    } else {
      document.getElementById('journal-edit-id').value = '';
      document.getElementById('journal-modal-title').textContent = 'Journal Entry';
      document.getElementById('journal-date').value = formatLocalDate(new Date());
      document.getElementById('journal-mood').value = '';
      document.getElementById('journal-energy').value = '';
      document.getElementById('journal-text').value = '';
      document.querySelectorAll('#mood-picker .mood-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#energy-picker .mood-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('input[name="journal-symptom"]').forEach(cb => cb.checked = false);
    }
    openModal(modal);
  }

  function openExerciseModal(id) {
    const modal = document.getElementById('exercise-modal');
    if (id) {
      const exercises = Store.getExercises();
      const ex = exercises.find(x => x.id === id);
      if (!ex) return;
      document.getElementById('exercise-edit-id').value = id;
      document.getElementById('exercise-modal-title').textContent = 'Edit Exercise';
      document.getElementById('exercise-date').value = ex.date;
      document.getElementById('exercise-type').value = ex.type || 'walking';
      document.getElementById('exercise-duration').value = ex.duration || '';
      document.getElementById('exercise-intensity').value = ex.intensity || 'moderate';
      document.getElementById('exercise-calories').value = ex.calories || '';
      document.getElementById('exercise-note').value = ex.note || '';
    } else {
      document.getElementById('exercise-edit-id').value = '';
      document.getElementById('exercise-modal-title').textContent = 'Log Exercise';
      document.getElementById('exercise-date').value = formatLocalDate(new Date());
      document.getElementById('exercise-type').value = 'walking';
      document.getElementById('exercise-duration').value = '';
      document.getElementById('exercise-intensity').value = 'moderate';
      document.getElementById('exercise-calories').value = '';
      document.getElementById('exercise-note').value = '';
    }
    openModal(modal);
  }

  function refreshJournal() {
    refreshFastingTimer();
    refreshFastingHistory();
    refreshJournalList();
    refreshMoodTrend();
    refreshExerciseList();
  }

  // --- Journal entries ---
  function refreshJournalList() {
    const journal = Store.getJournal();
    const list = document.getElementById('journal-list');
    const empty = document.getElementById('journal-empty');

    if (journal.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    const moodLabels = { 1: 'Awful', 2: 'Bad', 3: 'Okay', 4: 'Good', 5: 'Great' };
    const energyLabels = { 1: 'Very Low', 2: 'Low', 3: 'Normal', 4: 'High', 5: 'Very High' };
    const sorted = [...journal].reverse();
    list.innerHTML = sorted.map(j => {
      const moodText = j.mood ? moodLabels[j.mood] || j.mood : '';
      const energyText = j.energy ? energyLabels[j.energy] || j.energy : '';
      const tags = [moodText ? 'Mood: ' + moodText : '', energyText ? 'Energy: ' + energyText : ''].filter(Boolean).join(' | ');
      const symptomHtml = (j.symptoms && j.symptoms.length && !(j.symptoms.length === 1 && j.symptoms[0] === 'none'))
        ? '<div class="journal-item-symptoms">' + j.symptoms.filter(s => s !== 'none').map(s =>
            '<span class="symptom-tag">' + escapeHtml(s.replace('-', ' ')) + '</span>'
          ).join('') + '</div>'
        : '';
      return '<div class="journal-item"><div class="journal-item-info"><div class="journal-item-date">' + formatDateShort(j.date) + '</div>' + (tags ? '<div class="journal-item-tags">' + escapeHtml(tags) + '</div>' : '') + symptomHtml + (j.text ? '<div class="journal-item-text">' + escapeHtml(j.text) + '</div>' : '') + '</div><div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" data-action="edit-journal" data-id="' + escapeHtml(j.id) + '" aria-label="Edit journal">Edit</button><button class="btn btn-ghost btn-sm" data-action="remove-journal" data-id="' + escapeHtml(j.id) + '" aria-label="Delete journal">Del</button></div></div>';
    }).join('');
    staggerListItems('#journal-list .journal-item');
  }

  function refreshMoodTrend() {
    const trend = Store.getMoodTrend(30);
    const card = document.getElementById('mood-trend-card');
    if (trend.length < 2) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    const colors = getChartColors();
    moodTrendChart = destroyChart(moodTrendChart);
    const ctx = document.getElementById('chart-mood-trend').getContext('2d');

    const datasets = [];
    const moodData = trend.map(t => t.mood);
    const energyData = trend.map(t => t.energy);

    if (moodData.some(d => d !== null)) {
      datasets.push({
        label: 'Mood',
        data: moodData,
        borderColor: '#8b5cf6',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#8b5cf6',
        fill: false,
        spanGaps: true,
      });
    }
    if (energyData.some(d => d !== null)) {
      datasets.push({
        label: 'Energy',
        data: energyData,
        borderColor: '#f59e0b',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#f59e0b',
        fill: false,
        spanGaps: true,
      });
    }

    if (datasets.length === 0) { card.style.display = 'none'; return; }

    moodTrendChart = new Chart(ctx, {
      type: 'line',
      data: { labels: trend.map(t => t.date), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: { display: true, labels: { color: colors.textMuted, font: { size: 10 } } },
          tooltip: chartTooltipConfig({ padding: 10 }),
        },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'dd MMM yyyy' }, grid: { display: false }, ticks: { color: colors.textMuted, font: { size: 10 }, maxTicksLimit: 6 } },
          y: { min: 0.5, max: 5.5, grid: { color: colors.grid }, ticks: { color: colors.textMuted, stepSize: 1, callback: v => ({ 1: 'Awful', 2: 'Bad', 3: 'Okay', 4: 'Good', 5: 'Great' }[v] || '') } },
        },
      },
    });
  }

  function removeJournalEntry(id) {
    if (!confirm('Delete this journal entry?')) return;
    Store.deleteJournalEntry(id);
    toast('Entry deleted', 'success');
    refreshJournal();
  }

  // --- Exercise ---
  function refreshExerciseList() {
    const exercises = Store.getExercises();
    const list = document.getElementById('exercise-list');
    const empty = document.getElementById('exercise-empty');
    const statsRow = document.getElementById('exercise-stats-row');

    if (exercises.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      statsRow.style.display = 'none';
      return;
    }
    empty.style.display = 'none';

    // Stats
    const stats = Store.getExerciseStats(30);
    if (stats.sessions > 0) {
      statsRow.style.display = '';
      document.getElementById('ex-sessions').textContent = stats.sessions;
      document.getElementById('ex-minutes').textContent = stats.totalMinutes;
      document.getElementById('ex-weekly').textContent = stats.weeklyAvg;
    } else {
      statsRow.style.display = 'none';
    }

    const typeIcons = { walking: '🚶', running: '🏃', swimming: '🏊', cycling: '🚴', strength: '💪', yoga: '🧘', stretching: '🤸', other: '⚡' };
    const sorted = [...exercises].reverse();
    list.innerHTML = sorted.map(ex => {
      const icon = typeIcons[ex.type] || '⚡';
      const typeName = ex.type ? ex.type.charAt(0).toUpperCase() + ex.type.slice(1) : 'Exercise';
      return '<div class="exercise-item"><div class="exercise-item-icon">' + icon + '</div><div class="exercise-item-info"><div class="exercise-item-title">' + escapeHtml(typeName) + '</div><div class="exercise-item-sub">' + formatDateShort(ex.date) + ' | ' + (ex.duration || 0) + ' min | ' + escapeHtml(ex.intensity || 'moderate') + (ex.calories ? ' | ' + ex.calories + ' cal' : '') + '</div></div><div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" data-action="edit-exercise" data-id="' + escapeHtml(ex.id) + '" aria-label="Edit exercise">Edit</button><button class="btn btn-ghost btn-sm" data-action="remove-exercise" data-id="' + escapeHtml(ex.id) + '" aria-label="Delete exercise">Del</button></div></div>';
    }).join('');
    staggerListItems('#exercise-list .exercise-item');
  }

  function removeExercise(id) {
    if (!confirm('Delete this exercise?')) return;
    Store.deleteExercise(id);
    toast('Exercise deleted', 'success');
    refreshJournal();
  }

  // --- Fasting Timer ---
  function startFast() {
    const activeChip = document.querySelector('#fasting-protocols .protocol-chip.active');
    const protocol = activeChip ? activeChip.dataset.protocol : '16:8';
    const targetHours = activeChip ? parseInt(activeChip.dataset.hours) : 16;

    Store.setActiveFast({
      startTime: new Date().toISOString(),
      targetHours,
      protocol,
    });
    toast('Fast started!', 'success');
    refreshFastingTimer();
  }

  function endFast() {
    const active = Store.getActiveFast();
    if (!active) return;

    const duration = (new Date() - new Date(active.startTime)) / (1000 * 60 * 60);
    const completed = duration >= active.targetHours;

    Store.addFast({
      startTime: active.startTime,
      endTime: new Date().toISOString(),
      targetHours: active.targetHours,
      protocol: active.protocol,
      completed,
      note: '',
    });
    Store.clearActiveFast();
    toast(completed ? 'Fast completed! Well done!' : 'Fast ended.', completed ? 'success' : '');
    refreshFastingTimer();
    refreshFastingHistory();
  }

  function cancelFast() {
    if (!confirm('Cancel this fast?')) return;
    Store.clearActiveFast();
    toast('Fast cancelled', 'success');
    refreshFastingTimer();
  }

  function refreshFastingTimer() {
    const active = Store.getActiveFast();
    const startBtn = document.getElementById('btn-start-fast');
    const endBtn = document.getElementById('btn-end-fast');
    const cancelBtn = document.getElementById('btn-cancel-fast');
    const timerValue = document.getElementById('fasting-timer-value');
    const timerSub = document.getElementById('fasting-timer-sub');

    if (fastingTimerInterval) {
      clearInterval(fastingTimerInterval);
      fastingTimerInterval = null;
    }

    if (!active) {
      startBtn.style.display = '';
      endBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
      timerValue.textContent = '00:00:00';
      timerSub.textContent = 'ready';
      renderFastingRing(0);
      return;
    }

    startBtn.style.display = 'none';
    endBtn.style.display = '';
    cancelBtn.style.display = '';

    function updateTimer() {
      const elapsed = (new Date() - new Date(active.startTime)) / 1000;
      const hours = Math.floor(elapsed / 3600);
      const mins = Math.floor((elapsed % 3600) / 60);
      const secs = Math.floor(elapsed % 60);
      timerValue.textContent = String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

      const targetSecs = active.targetHours * 3600;
      const remaining = targetSecs - elapsed;
      if (remaining > 0) {
        const rh = Math.floor(remaining / 3600);
        const rm = Math.floor((remaining % 3600) / 60);
        timerSub.textContent = rh + 'h ' + rm + 'm remaining';
      } else {
        timerSub.textContent = 'Goal reached!';
      }

      const progress = Math.min(1, elapsed / targetSecs);
      renderFastingRing(progress);
    }
    updateTimer();
    fastingTimerInterval = setInterval(updateTimer, 1000);
  }

  function renderFastingRing(progress) {
    const colors = getChartColors();
    fastingRingChart = destroyChart(fastingRingChart);
    const ctx = document.getElementById('chart-fasting-ring').getContext('2d');

    fastingRingChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [progress * 100, (1 - progress) * 100],
          backgroundColor: [progress >= 1 ? '#10b981' : '#8b5cf6', colors.grid],
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
        animation: { duration: 300 },
      },
    });
  }

  function refreshFastingHistory() {
    const fasts = Store.getFasts();
    const stats = Store.getFastingStats();
    const statsRow = document.getElementById('fasting-stats-row');
    const header = document.getElementById('fasting-history-header');
    const list = document.getElementById('fasting-list');

    if (fasts.length === 0) {
      statsRow.style.display = 'none';
      header.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    // Stats
    statsRow.style.display = '';
    document.getElementById('fast-total').textContent = stats.totalFasts;
    document.getElementById('fast-avg').textContent = stats.avgDuration + 'h';
    document.getElementById('fast-longest').textContent = stats.longestFast + 'h';
    document.getElementById('fast-rate').textContent = stats.completionRate + '%';

    // History list
    header.style.display = '';
    document.getElementById('fast-count').textContent = fasts.length;
    const sorted = [...fasts].reverse().slice(0, 20);
    list.innerHTML = sorted.map(f => {
      const duration = f.startTime && f.endTime ? Math.round((new Date(f.endTime) - new Date(f.startTime)) / (1000 * 60 * 60) * 10) / 10 : 0;
      const dateStr = f.startTime ? formatDateShort(f.startTime.split('T')[0]) : '--';
      const status = f.completed ? '<span style="color:var(--success)">Completed</span>' : '<span style="color:var(--text-muted)">Ended early</span>';
      return '<div class="fasting-item"><div class="fasting-item-info"><div class="fasting-item-date">' + dateStr + ' | ' + escapeHtml(f.protocol) + '</div><div class="fasting-item-detail">' + duration + 'h / ' + f.targetHours + 'h target | ' + status + '</div></div><button class="btn btn-ghost btn-sm" data-action="remove-fast" data-id="' + escapeHtml(f.id) + '" aria-label="Delete fast">Del</button></div>';
    }).join('');
  }

  function removeFast(id) {
    if (!confirm('Delete this fast?')) return;
    Store.deleteFast(id);
    toast('Fast deleted', 'success');
    refreshFastingHistory();
  }

  // ===== DOCTOR VISIT REPORT =====
  function generateDoctorReport() {
    const report = Store.generateDoctorReport();
    const unit = report.weightSummary.unit;

    const medLabels = { semaglutide: 'Semaglutide (Ozempic/Wegovy)', tirzepatide: 'Tirzepatide (Mounjaro/Zepbound)', liraglutide: 'Liraglutide (Saxenda)', other: 'Other', none: 'None' };
    const medName = medLabels[report.patient.medication] || report.patient.medication || 'Not specified';

    const siteLabels = { 'abdomen-upper-left': 'Abdomen (UL)', 'abdomen-upper-right': 'Abdomen (UR)', 'abdomen-lower-left': 'Abdomen (LL)', 'abdomen-lower-right': 'Abdomen (LR)', 'abdomen-left': 'Abdomen (L)', 'abdomen-right': 'Abdomen (R)', 'thigh-left': 'Thigh (L)', 'thigh-right': 'Thigh (R)', 'arm-left': 'Arm (L)', 'arm-right': 'Arm (R)' };

    function formatChange(val) {
      if (!val) return '0';
      if (unit === 'st') return (val > 0 ? '+' : '') + Store.formatStone(val);
      return (val > 0 ? '+' : '') + val;
    }

    function fmtWt(val) {
      if (val === null || val === undefined || !val) return '--';
      if (unit === 'st') return Store.formatStone(val);
      return parseFloat(val).toFixed(1) + ' ' + unit;
    }

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Doctor Visit Report - ' + report.reportDate + '</title>';
    html += '<style>body{font-family:Inter,Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#1e293b;font-size:14px}';
    html += 'h1{font-size:22px;border-bottom:2px solid #6366f1;padding-bottom:8px;margin-bottom:4px}';
    html += 'h2{font-size:16px;color:#6366f1;margin-top:24px;margin-bottom:8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}';
    html += '.report-meta{color:#64748b;font-size:12px;margin-bottom:16px}';
    html += '.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}';
    html += '.stat-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}';
    html += '.stat-value{font-size:24px;font-weight:700;color:#0f172a}.stat-label{font-size:11px;color:#64748b;margin-top:2px}';
    html += '.stat-sub{font-size:10px;color:#94a3b8;margin-top:2px}';
    html += 'table{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}th,td{padding:6px 10px;border:1px solid #e2e8f0;text-align:left}th{background:#f1f5f9;font-weight:600}';
    html += '.inline-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:12px 0}';
    html += '.change-pos{color:#16a34a}.change-neg{color:#dc2626}';
    html += '.footer{margin-top:32px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px}';
    html += '@media print{body{margin:0;padding:10px}}</style></head><body>';

    html += '<h1>Weight Loss Progress Report</h1>';
    html += '<p class="report-meta">Generated: ' + report.reportDate + ' | Days on plan: ' + report.daysOnPlan + '</p>';

    // Patient info
    html += '<h2>Patient Information</h2>';
    html += '<table><tr><th>Name</th><td>' + (report.patient.name || '--') + '</td><th>Age</th><td>' + (report.patient.age || '--') + '</td></tr>';
    var heightDisplay = '--';
    if (report.patient.height) {
      if (report.patient.heightUnit === 'ft') {
        var hCm = parseFloat(report.patient.height);
        var hTotalIn = hCm / 2.54;
        var hFt = Math.floor(hTotalIn / 12);
        var hIn = Math.round(hTotalIn % 12);
        if (hIn === 12) { hFt++; hIn = 0; }
        heightDisplay = hFt + '\' ' + hIn + '"';
      } else {
        heightDisplay = report.patient.height + ' cm';
      }
    }
    html += '<tr><th>Height</th><td>' + heightDisplay + '</td><th>Start Date</th><td>' + (report.patient.startDate || '--') + '</td></tr>';
    html += '<tr><th>Medication</th><td>' + medName + '</td><th>Dosage</th><td>' + (report.patient.dosage || '--') + '</td></tr>';
    html += '<tr><th>Frequency</th><td>' + (report.patient.frequency || '--') + '</td><th>Target Weight</th><td>' + fmtWt(report.weightSummary.targetWeight) + '</td></tr></table>';

    // Weight summary
    html += '<h2>Weight Summary</h2>';
    html += '<div class="stats-grid">';
    html += '<div class="stat-box"><div class="stat-value">' + fmtWt(report.weightSummary.currentWeight) + '</div><div class="stat-label">Current Weight</div></div>';
    html += '<div class="stat-box"><div class="stat-value">' + fmtWt(report.weightSummary.totalLost) + '</div><div class="stat-label">Total Lost</div></div>';
    html += '<div class="stat-box"><div class="stat-value">' + (report.weightSummary.bmi || '--') + '</div><div class="stat-label">BMI</div></div>';
    html += '</div>';
    html += '<div class="stats-grid">';
    html += '<div class="stat-box"><div class="stat-value">' + formatChange(report.weightSummary.weightChange7d) + '</div><div class="stat-label">7-Day Change</div></div>';
    html += '<div class="stat-box"><div class="stat-value">' + formatChange(report.weightSummary.weightChange30d) + '</div><div class="stat-label">30-Day Change</div></div>';
    html += '<div class="stat-box"><div class="stat-value">' + (report.weightSummary.rateOfLoss !== null ? fmtWt(report.weightSummary.rateOfLoss) + '/wk' : '--') + '</div><div class="stat-label">Rate of Loss (90d)</div></div>';
    html += '</div>';
    html += '<div class="stats-grid">';
    html += '<div class="stat-box"><div class="stat-value">' + fmtWt(report.weightSummary.startWeight) + '</div><div class="stat-label">Start Weight</div></div>';
    html += '<div class="stat-box"><div class="stat-value">' + (report.weightSummary.avgWeeklyLoss ? fmtWt(report.weightSummary.avgWeeklyLoss) + '/wk' : '--') + '</div><div class="stat-label">Avg Weekly Loss</div></div>';
    html += '<div class="stat-box"><div class="stat-value">' + report.weightSummary.progressPercent + '%</div><div class="stat-label">Goal Progress</div>';
    if (report.weightSummary.projectedGoalDate) {
      html += '<div class="stat-sub">Est. ' + report.weightSummary.projectedGoalDate + '</div>';
    }
    html += '</div>';
    html += '</div>';

    // Medication adherence
    if (report.adherence.rate !== null) {
      html += '<h2>Medication Adherence (Last 90 Days)</h2>';
      html += '<div class="stats-grid">';
      html += '<div class="stat-box"><div class="stat-value">' + report.adherence.actual + '/' + report.adherence.expected + '</div><div class="stat-label">Doses Logged / Expected</div></div>';
      html += '<div class="stat-box"><div class="stat-value">' + report.adherence.rate + '%</div><div class="stat-label">Adherence Rate</div></div>';
      var sitesUsed = Object.keys(report.siteDistribution).length;
      html += '<div class="stat-box"><div class="stat-value">' + sitesUsed + '</div><div class="stat-label">Injection Sites Used</div></div>';
      html += '</div>';
      // Injection site breakdown
      if (sitesUsed > 0) {
        html += '<table><tr><th>Injection Site</th><th>Times Used</th></tr>';
        Object.entries(report.siteDistribution).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
          html += '<tr><td>' + (siteLabels[entry[0]] || entry[0]) + '</td><td>' + entry[1] + '</td></tr>';
        });
        html += '</table>';
      }
    }

    // Recent weights
    if (report.recentWeights.length > 0) {
      html += '<h2>Recent Weight Entries (Last 90 Days)</h2>';
      html += '<table><tr><th>Date</th><th>Weight (' + unit + ')</th><th>Notes</th></tr>';
      report.recentWeights.forEach(function(w) {
        html += '<tr><td>' + w.date + '</td><td>' + w.weight + '</td><td>' + (w.note || '') + '</td></tr>';
      });
      html += '</table>';
    }

    // Dose history
    if (report.recentDoses.length > 0) {
      html += '<h2>Dose History (Last 90 Days)</h2>';
      html += '<table><tr><th>Date</th><th>Dose</th><th>Site</th><th>Side Effects</th></tr>';
      report.recentDoses.forEach(function(d) {
        var effects = d.sideEffects && d.sideEffects.length > 0 ? d.sideEffects.join(', ') : 'None';
        html += '<tr><td>' + d.date + '</td><td>' + (d.dose || '') + ' ' + (d.doseUnit || 'mg') + '</td><td>' + (siteLabels[d.site] || d.site || '--') + '</td><td>' + effects + '</td></tr>';
      });
      html += '</table>';
    }

    // Side effects summary with monthly trend
    if (report.sideEffects && Object.keys(report.sideEffects).length > 0) {
      html += '<h2>Side Effect Summary</h2>';
      var hasMonthly = report.monthlyEffects && report.recentMonths;
      html += '<table><tr><th>Side Effect</th><th>All Time</th>';
      if (hasMonthly) {
        report.recentMonths.forEach(function(month) { html += '<th>' + month + '</th>'; });
      }
      html += '</tr>';
      Object.entries(report.sideEffects).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
        var effect = entry[0];
        var count = entry[1];
        html += '<tr><td>' + effect.replace(/-/g, ' ') + '</td><td>' + count + '</td>';
        if (hasMonthly) {
          report.recentMonths.forEach(function(month) {
            var monthData = report.monthlyEffects[month];
            html += '<td>' + (monthData && monthData[effect] ? monthData[effect] : '0') + '</td>';
          });
        }
        html += '</tr>';
      });
      html += '</table>';
    }

    // Dose escalations
    if (report.doseEscalations.length > 0) {
      html += '<h2>Dose Escalation History</h2>';
      html += '<table><tr><th>Date</th><th>From</th><th>To</th><th>Direction</th></tr>';
      report.doseEscalations.forEach(function(e) {
        html += '<tr><td>' + e.date + '</td><td>' + e.fromDose + ' ' + e.unit + '</td><td>' + e.toDose + ' ' + e.unit + '</td><td>' + e.direction + '</td></tr>';
      });
      html += '</table>';
    }

    // Body measurements with trends
    if (report.latestMeasurements) {
      var latest = report.latestMeasurements;
      var earliest = report.earliestMeasurements;
      var showChange = earliest && earliest.date !== latest.date;
      html += '<h2>Body Measurements</h2>';
      html += '<table><tr><th>Metric</th>';
      if (showChange) html += '<th>' + earliest.date + '</th>';
      html += '<th>' + latest.date + '</th>';
      if (showChange) html += '<th>Change</th>';
      html += '</tr>';
      ['waist', 'hips', 'chest', 'neck'].forEach(function(key) {
        var label = key.charAt(0).toUpperCase() + key.slice(1);
        var latestVal = latest[key] ? parseFloat(latest[key]) : null;
        var earliestVal = earliest && earliest[key] ? parseFloat(earliest[key]) : null;
        html += '<tr><td>' + label + ' (cm)</td>';
        if (showChange) html += '<td>' + (earliestVal !== null ? earliestVal : '--') + '</td>';
        html += '<td>' + (latestVal !== null ? latestVal : '--') + '</td>';
        if (showChange) {
          if (latestVal !== null && earliestVal !== null) {
            var diff = Math.round((latestVal - earliestVal) * 10) / 10;
            var cls = diff < 0 ? 'change-pos' : (diff > 0 ? 'change-neg' : '');
            html += '<td class="' + cls + '">' + formatChange(diff) + '</td>';
          } else {
            html += '<td>--</td>';
          }
        }
        html += '</tr>';
      });
      html += '</table>';
    }

    // Exercise summary
    if (report.exerciseStats && report.exerciseStats.sessions > 0) {
      html += '<h2>Exercise Summary (Last 90 Days)</h2>';
      html += '<div class="stats-grid">';
      html += '<div class="stat-box"><div class="stat-value">' + report.exerciseStats.sessions + '</div><div class="stat-label">Sessions</div></div>';
      html += '<div class="stat-box"><div class="stat-value">' + report.exerciseStats.totalMinutes + '</div><div class="stat-label">Total Minutes</div></div>';
      html += '<div class="stat-box"><div class="stat-value">' + (report.exerciseStats.weeklyAvg || '--') + '</div><div class="stat-label">Sessions/Week</div></div>';
      html += '</div>';
      if (report.exerciseStats.mostCommon) {
        html += '<p style="font-size:13px;color:#64748b;margin:4px 0;">Most common activity: <strong>' + report.exerciseStats.mostCommon + '</strong></p>';
      }
    }

    // Wellbeing / Mood & Energy
    if (report.wellbeing && report.wellbeing.entries > 0) {
      html += '<h2>Wellbeing (Last 90 Days)</h2>';
      html += '<div class="stats-grid">';
      html += '<div class="stat-box"><div class="stat-value">' + (report.wellbeing.moodAvg !== null ? report.wellbeing.moodAvg + '/5' : '--') + '</div><div class="stat-label">Avg Mood</div></div>';
      html += '<div class="stat-box"><div class="stat-value">' + (report.wellbeing.energyAvg !== null ? report.wellbeing.energyAvg + '/5' : '--') + '</div><div class="stat-label">Avg Energy</div></div>';
      html += '<div class="stat-box"><div class="stat-value">' + report.wellbeing.entries + '</div><div class="stat-label">Journal Entries</div></div>';
      html += '</div>';
    }

    html += '<div class="footer">Generated by Jab It Weight Tracker | ' + report.reportDate + '</div>';
    html += '</body></html>';

    var reportWindow = window.open('', '_blank');
    if (reportWindow) {
      reportWindow.document.write(html);
      reportWindow.document.close();
      toast('Report generated! Use your browser\'s print function to save as PDF.', 'success');
    } else {
      toast('Pop-up blocked. Please allow pop-ups for this site.', 'error');
    }
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
    editMeasurement: (id) => openMeasurementModal(id),
    removeMeasurement,
    editJournalEntry: (id) => openJournalModal(id),
    removeJournalEntry,
    editExercise: (id) => openExerciseModal(id),
    removeExercise,
    removeFast,
  };
})();

// Boot the app
document.addEventListener('DOMContentLoaded', App.init);
