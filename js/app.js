// Jab It: Weight Loss Tracker - Main Application Controller
const App = (() => {
  let weightSummaryChart, weightFullChart, doseChart, doseRingChart;
  let currentProgressRange = 'all';
  let currentDoseRange = 'all';

  // ===== INIT =====
  function init() {
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

  function bootApp() {
    applyTheme();
    initNavigation();
    initSummaryPage();
    initDosesPage();
    initProgressPage();
    initSettingsPage();
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
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
        startDate: new Date().toISOString().split('T')[0],
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
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(l => l.classList.remove('active'));

    const pageEl = document.getElementById('page-' + page);
    const navEl = document.querySelector(`.nav-tab[data-page="${page}"]`);
    if (pageEl) pageEl.classList.add('active');
    if (navEl) navEl.classList.add('active');

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
  }

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

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateShort(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function daysAgo(dateStr) {
    const diff = Math.floor((new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return diff + 'd ago';
  }

  function daysUntil(dateStr) {
    const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
    if (diff <= 0) return 'Overdue';
    if (diff === 1) return 'Tomorrow';
    return diff + ' days';
  }

  function toast(msg, type = '') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
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

  // ===== SUMMARY PAGE =====
  function initSummaryPage() {
    document.getElementById('btn-quick-dose').addEventListener('click', () => openDoseModal());
    document.getElementById('btn-quick-weight').addEventListener('click', () => openWeightModal());
    refreshSummary();
  }

  function refreshSummary() {
    const stats = Store.getStats();
    const unit = Store.getSettings().weightUnit;

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

    // Next dose ring
    renderDoseRing(stats);

    // Weight trend chart
    renderWeightSummaryChart();
  }

  function renderDoseRing(stats) {
    doseRingChart = destroyChart(doseRingChart);
    const ctx = document.getElementById('chart-dose-ring').getContext('2d');
    const colors = getChartColors();

    const ringValue = document.getElementById('dose-ring-value');
    const ringSub = document.getElementById('dose-ring-sub');
    const ringInfo = document.getElementById('dose-ring-info');

    if (!stats.nextJabDate) {
      ringValue.textContent = '--';
      ringSub.textContent = '';
      ringInfo.textContent = 'No doses logged yet';
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

    const diff = Math.ceil((new Date(stats.nextJabDate) - new Date()) / (1000 * 60 * 60 * 24));
    const elapsed = 7 - diff;
    const progress = Math.max(0, Math.min(1, elapsed / 7));

    if (diff <= 0) {
      ringValue.textContent = 'Due!';
      ringSub.textContent = '';
      ringInfo.textContent = 'Time for your next dose';
    } else {
      ringValue.textContent = diff;
      ringSub.textContent = diff === 1 ? 'day' : 'days';
      ringInfo.textContent = 'until next dose';
    }

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
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const filtered = weights.filter(w => new Date(w.date) >= cutoff);

    weightSummaryChart = destroyChart(weightSummaryChart);
    const ctx = document.getElementById('chart-weight-summary').getContext('2d');

    const data = filtered.length > 0 ? filtered : weights;
    if (data.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    const gradient = createChartGradient(ctx, 'rgba(99,102,241,0.3)', 'rgba(99,102,241,0.01)');
    weightSummaryChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(w => w.date),
        datasets: [{
          label: 'Weight',
          data: data.map(w => parseFloat(w.weight)),
          borderColor: colors.primary,
          backgroundColor: gradient,
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: data.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: colors.primary,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
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
              label: (ctx) => ctx.parsed.y.toFixed(1) + ' ' + Store.getSettings().weightUnit,
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

    document.getElementById('dose-modal-close').addEventListener('click', () => doseModal.style.display = 'none');
    document.getElementById('dose-form-cancel').addEventListener('click', () => doseModal.style.display = 'none');
    doseModal.addEventListener('click', (e) => { if (e.target === doseModal) doseModal.style.display = 'none'; });

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
      doseModal.style.display = 'none';
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
      document.getElementById('dose-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('dose-time').value = new Date().toTimeString().slice(0, 5);
      document.getElementById('dose-medication').value = profile.medication || 'semaglutide';
      document.getElementById('dose-amount').value = '';
      document.getElementById('dose-unit').value = 'mg';
      document.getElementById('dose-site').value = '';
      document.getElementById('dose-notes').value = '';
      document.querySelectorAll('input[name="side-effect"]').forEach(cb => cb.checked = false);
    }
    modal.style.display = 'flex';
  }

  function refreshDoses() {
    const jabs = Store.getJabs();
    const empty = document.getElementById('dose-empty');
    const list = document.getElementById('dose-list');
    const chartContainer = document.getElementById('dose-chart-container');

    let filtered = jabs;
    if (currentDoseRange !== 'all') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - currentDoseRange);
      filtered = jabs.filter(j => new Date(j.date) >= cutoff);
    }

    if (jabs.length === 0) {
      empty.style.display = '';
      list.innerHTML = '';
      chartContainer.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    chartContainer.style.display = '';

    // Render dose list
    const sorted = [...filtered].reverse();
    list.innerHTML = sorted.map(j => `
      <div class="dose-item">
        <div class="dose-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 2l1.5 1.5L9 5"/><path d="M14 2l1.5 1.5L14 5"/><rect x="4" y="7" width="16" height="14" rx="2"/><path d="M12 11v6"/><path d="M9 14h6"/></svg>
        </div>
        <div class="dose-item-info">
          <div class="dose-item-title">${medicationLabel(j.medication)}</div>
          <div class="dose-item-sub">${formatDateShort(j.date)}${j.site ? ' &middot; ' + siteLabel(j.site) : ''}</div>
        </div>
        <div class="dose-item-value">${j.dose} ${j.doseUnit}</div>
        <div class="dose-item-actions">
          <button class="btn btn-ghost btn-sm" onclick="App.editDose('${j.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="App.removeDose('${j.id}')">Del</button>
        </div>
      </div>
    `).join('');

    staggerListItems('#dose-list .dose-item');
    renderDoseChart(filtered);
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
              label: (ctx) => ctx.parsed.y + ' ' + (jabs[ctx.dataIndex]?.doseUnit || 'mg'),
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

  function removeDose(id) {
    if (!confirm('Delete this dose entry?')) return;
    Store.deleteJab(id);
    toast('Dose deleted');
    refreshDoses();
    refreshSummary();
  }

  // ===== PROGRESS PAGE =====
  function initProgressPage() {
    const weightModal = document.getElementById('weight-modal');
    const weightForm = document.getElementById('weight-form');

    document.getElementById('btn-add-weight').addEventListener('click', () => openWeightModal());

    document.getElementById('weight-modal-close').addEventListener('click', () => weightModal.style.display = 'none');
    document.getElementById('weight-form-cancel').addEventListener('click', () => weightModal.style.display = 'none');
    weightModal.addEventListener('click', (e) => { if (e.target === weightModal) weightModal.style.display = 'none'; });

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
      weightModal.style.display = 'none';
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

    updateWeightUnitLabels();
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
      document.getElementById('weight-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('weight-value').value = '';
      document.getElementById('weight-note').value = '';
    }
    modal.style.display = 'flex';
  }

  function updateWeightUnitLabels() {
    const unit = Store.getSettings().weightUnit;
    document.querySelectorAll('.weight-unit-label').forEach(el => el.textContent = unit);
  }

  function refreshProgress() {
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

    // Filter weights
    let filtered = weights;
    if (currentProgressRange !== 'all') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - currentProgressRange);
      filtered = weights.filter(w => new Date(w.date) >= cutoff);
    }

    // Chart
    renderWeightFullChart(filtered);

    // Weight entries list
    renderWeightEntries(filtered);
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

    weightFullChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: !!goals.targetWeight, labels: { color: colors.textMuted, font: { size: 10 } } },
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
              label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + ' ' + Store.getSettings().weightUnit,
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
    list.innerHTML = sorted.map((w, i) => {
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
            <button class="btn btn-ghost btn-sm" onclick="App.editWeight('${w.id}')">Edit</button>
            <button class="btn btn-ghost btn-sm" onclick="App.removeWeight('${w.id}')">Del</button>
          </div>
        </div>
      `;
    }).join('');
    staggerListItems('#weight-entries-list .weight-item');
  }

  function removeWeight(id) {
    if (!confirm('Delete this weight entry?')) return;
    Store.deleteWeight(id);
    toast('Entry deleted');
    refreshProgress();
    refreshSummary();
  }

  // ===== SETTINGS PAGE =====
  function initSettingsPage() {
    document.getElementById('btn-save-settings').addEventListener('click', () => saveAllSettings());

    // Export
    document.getElementById('btn-export').addEventListener('click', () => {
      const data = Store.exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'weight-tracker-backup-' + new Date().toISOString().split('T')[0] + '.json';
      a.click();
      URL.revokeObjectURL(url);
      toast('Data exported!', 'success');
    });

    // Import
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (Store.importData(ev.target.result)) {
          toast('Data imported!', 'success');
          bootApp();
          navigateTo('summary');
        } else {
          toast('Import failed. Invalid file.', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Clear data
    document.getElementById('btn-clear-data').addEventListener('click', () => {
      if (!confirm('Are you sure you want to delete ALL data? This cannot be undone.')) return;
      if (!confirm('Really? This will clear all your entries and settings.')) return;
      Store.clearAll();
      toast('All data cleared');
      window.location.reload();
    });
  }

  function saveAllSettings() {
    const profile = Store.getProfile();
    profile.name = document.getElementById('set-name').value.trim();
    profile.height = document.getElementById('set-height').value;
    profile.heightUnit = document.getElementById('set-height-unit').value;
    profile.startWeight = document.getElementById('set-start-weight').value;
    profile.medication = document.getElementById('set-medication').value;
    Store.saveProfile(profile);

    const goals = Store.getGoals();
    goals.targetWeight = document.getElementById('set-goal-weight').value;
    Store.saveGoals(goals);

    const settings = Store.getSettings();
    settings.weightUnit = document.getElementById('set-weight-unit').value;
    Store.saveSettings(settings);

    // Save dosage and frequency to profile
    profile.dosage = document.getElementById('set-dosage').value;
    profile.frequency = document.getElementById('set-frequency').value;
    Store.saveProfile(profile);

    applyTheme();
    updateWeightUnitLabels();
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

    updateWeightUnitLabels();
  }

  // Public API
  return {
    init,
    editWeight: (id) => openWeightModal(id),
    removeWeight,
    editDose: (id) => openDoseModal(id),
    removeDose,
  };
})();

// Boot the app
document.addEventListener('DOMContentLoaded', App.init);
