// Shotsy - Main Application Controller
const App = (() => {
  let weightChart, weeklyChart, weightFullChart, doseChart, sideEffectsChart, projectionChart, progressRingChart;
  let currentRange = 30;

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
    initThemeToggle();
    initMenuToggle();
    updateGreeting();
    initDashboard();
    initWeightPage();
    initJabPage();
    initGoalsPage();
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

      // Add first weight entry
      Store.addWeight({
        date: profile.startDate,
        weight: profile.startWeight,
        note: 'Starting weight',
      });

      document.getElementById('onboarding-modal').style.display = 'none';
      document.getElementById('app').style.display = '';
      bootApp();
      toast('Welcome to Shotsy! Your journey starts now.', 'success');
    });
  }

  // ===== NAVIGATION =====
  function initNavigation() {
    document.querySelectorAll('.nav-link, [data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        const page = link.dataset.page || link.getAttribute('href')?.replace('#', '');
        if (page) {
          e.preventDefault();
          navigateTo(page);
        }
      });
    });
  }

  function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

    const pageEl = document.getElementById('page-' + page);
    const navEl = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (pageEl) pageEl.classList.add('active');
    if (navEl) navEl.classList.add('active');

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');

    window.location.hash = page;

    // Refresh page data
    if (page === 'dashboard') refreshDashboard();
    if (page === 'weight') refreshWeightPage();
    if (page === 'jabs') refreshJabPage();
    if (page === 'goals') refreshGoalsPage();
    if (page === 'settings') refreshSettingsPage();
  }

  function handleHashChange() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);
  }

  // ===== THEME =====
  function applyTheme() {
    const settings = Store.getSettings();
    let theme = settings.theme;
    if (theme === 'auto') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  }

  function initThemeToggle() {
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      const settings = Store.getSettings();
      settings.theme = next;
      Store.saveSettings(settings);
    });
  }

  function initMenuToggle() {
    document.getElementById('menu-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Close sidebar on main content click (mobile)
    document.getElementById('main-content').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
    });
  }

  function updateGreeting() {
    const profile = Store.getProfile();
    const hour = new Date().getHours();
    let greeting = 'Good evening';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 18) greeting = 'Good afternoon';
    document.getElementById('user-greeting').textContent = `${greeting}, ${profile.name}`;
  }

  // ===== HELPERS =====
  function formatWeight(val) {
    const settings = Store.getSettings();
    if (val === null || val === undefined || isNaN(val)) return '--';
    return parseFloat(val).toFixed(1) + ' ' + settings.weightUnit;
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
    return diff + ' days ago';
  }

  function daysUntil(dateStr) {
    const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
    if (diff <= 0) return 'Overdue!';
    if (diff === 1) return 'Tomorrow';
    return 'in ' + diff + ' days';
  }

  function toast(msg, type = '') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function getBmiLabel(bmi) {
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Healthy';
    if (bmi < 30) return 'Overweight';
    if (bmi < 35) return 'Obese I';
    if (bmi < 40) return 'Obese II';
    return 'Obese III';
  }

  function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      primary: '#6366f1',
      primaryLight: 'rgba(99,102,241,0.2)',
      success: '#10b981',
      successLight: 'rgba(16,185,129,0.2)',
      danger: '#ef4444',
      dangerLight: 'rgba(239,68,68,0.2)',
      warning: '#f59e0b',
      text: isDark ? '#f1f5f9' : '#0f172a',
      textMuted: isDark ? '#64748b' : '#94a3b8',
      grid: isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)',
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

  // ===== DASHBOARD =====
  function initDashboard() {
    // Chart range controls
    document.querySelectorAll('.chart-controls .chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-controls .chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRange = btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range);
        renderWeightChart();
      });
    });
    refreshDashboard();
  }

  function refreshDashboard() {
    const stats = Store.getStats();
    const settings = Store.getSettings();
    const unit = settings.weightUnit;

    // Stats cards
    document.getElementById('stat-current').textContent = stats.currentWeight ? parseFloat(stats.currentWeight).toFixed(1) + ' ' + unit : '--';
    document.getElementById('stat-lost').textContent = stats.totalLost ? parseFloat(stats.totalLost).toFixed(1) + ' ' + unit : '--';
    document.getElementById('stat-streak').textContent = stats.streak || '0';

    // BMI
    if (stats.bmi) {
      document.getElementById('stat-bmi').textContent = stats.bmi.toFixed(1);
      document.getElementById('stat-bmi-label').textContent = getBmiLabel(stats.bmi);
    } else {
      document.getElementById('stat-bmi').textContent = '--';
      document.getElementById('stat-bmi-label').textContent = '';
    }

    // 7d change
    const changeEl = document.getElementById('stat-change-7d');
    if (stats.weightChange7d !== 0) {
      const val = stats.weightChange7d.toFixed(1);
      const sign = stats.weightChange7d > 0 ? '+' : '';
      changeEl.textContent = sign + val + ' ' + unit + ' (7d)';
      changeEl.className = 'stat-change ' + (stats.weightChange7d > 0 ? 'positive' : 'negative');
    } else {
      changeEl.textContent = '';
    }

    // Progress
    document.getElementById('stat-progress-pct').textContent = stats.targetWeight ? stats.progressPercent.toFixed(0) + '% of goal' : '';

    // Days on plan
    document.getElementById('days-on-plan').textContent = stats.daysOnPlan > 0 ? `Day ${stats.daysOnPlan} of your journey` : '';

    // Progress bar
    if (stats.targetWeight && stats.startWeight) {
      document.getElementById('progress-section').style.display = '';
      document.getElementById('progress-label').textContent = stats.progressPercent.toFixed(0) + '%';
      document.getElementById('progress-fill').style.width = stats.progressPercent + '%';
      document.getElementById('progress-start').textContent = parseFloat(stats.startWeight).toFixed(1) + ' ' + unit;
      document.getElementById('progress-target').textContent = parseFloat(stats.targetWeight).toFixed(1) + ' ' + unit;
    } else {
      document.getElementById('progress-section').style.display = 'none';
    }

    // Jab alert
    if (stats.nextJabDate) {
      const diff = Math.ceil((new Date(stats.nextJabDate) - new Date()) / (1000 * 60 * 60 * 24));
      if (diff <= 2) {
        document.getElementById('jab-alert').style.display = 'flex';
        if (diff <= 0) {
          document.getElementById('jab-alert-text').textContent = 'Your jab is overdue! Time to log it.';
        } else if (diff === 1) {
          document.getElementById('jab-alert-text').textContent = 'Your next jab is due tomorrow.';
        } else {
          document.getElementById('jab-alert-text').textContent = 'Your next jab is due in ' + diff + ' days.';
        }
      } else {
        document.getElementById('jab-alert').style.display = 'none';
      }
    } else {
      document.getElementById('jab-alert').style.display = 'none';
    }

    renderWeightChart();
    renderWeeklyChart();
    renderActivityList();
  }

  function renderWeightChart() {
    const weights = Store.getWeights();
    const colors = getChartColors();

    let filtered = weights;
    if (currentRange !== 'all') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - currentRange);
      filtered = weights.filter(w => new Date(w.date) >= cutoff);
    }

    const labels = filtered.map(w => w.date);
    const data = filtered.map(w => parseFloat(w.weight));

    weightChart = destroyChart(weightChart);
    const ctx = document.getElementById('chart-weight').getContext('2d');

    if (data.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    weightChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Weight',
          data,
          borderColor: colors.primary,
          backgroundColor: colors.primaryLight,
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointRadius: data.length > 30 ? 0 : 4,
          pointHoverRadius: 6,
          pointBackgroundColor: colors.primary,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.text,
            titleColor: colors.text === '#0f172a' ? '#fff' : '#0f172a',
            bodyColor: colors.text === '#0f172a' ? '#fff' : '#0f172a',
            cornerRadius: 8,
            padding: 10,
            callbacks: {
              label: (ctx) => ctx.parsed.y.toFixed(1) + ' ' + Store.getSettings().weightUnit,
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: currentRange <= 30 ? 'day' : currentRange <= 90 ? 'week' : 'month', tooltipFormat: 'dd MMM yyyy' },
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted, font: { size: 11 } },
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted, font: { size: 11 }, callback: v => v.toFixed(0) },
          },
        },
      },
    });
  }

  function renderWeeklyChart() {
    const weights = Store.getWeights();
    const colors = getChartColors();

    // Calculate weekly changes
    const weeklyChanges = [];
    for (let i = 1; i < weights.length; i++) {
      const daysDiff = (new Date(weights[i].date) - new Date(weights[i-1].date)) / (1000 * 60 * 60 * 24);
      if (daysDiff > 0) {
        const change = parseFloat(weights[i].weight) - parseFloat(weights[i-1].weight);
        weeklyChanges.push({ date: weights[i].date, change });
      }
    }

    weeklyChart = destroyChart(weeklyChart);
    const ctx = document.getElementById('chart-weekly').getContext('2d');

    if (weeklyChanges.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    weeklyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: weeklyChanges.map(w => w.date),
        datasets: [{
          label: 'Change',
          data: weeklyChanges.map(w => w.change),
          backgroundColor: weeklyChanges.map(w => w.change <= 0 ? colors.success : colors.danger),
          borderRadius: 4,
          barPercentage: 0.7,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y.toFixed(1);
                return (ctx.parsed.y > 0 ? '+' : '') + v + ' ' + Store.getSettings().weightUnit;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'week', tooltipFormat: 'dd MMM yyyy' },
            grid: { display: false },
            ticks: { color: colors.textMuted, font: { size: 11 } },
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted, font: { size: 11 }, callback: v => (v > 0 ? '+' : '') + v.toFixed(1) },
          },
        },
      },
    });
  }

  function renderActivityList() {
    const weights = Store.getWeights();
    const jabs = Store.getJabs();
    const list = document.getElementById('activity-list');
    const unit = Store.getSettings().weightUnit;

    const activities = [];
    weights.forEach(w => activities.push({ type: 'weight', date: w.date, text: `Logged weight: ${parseFloat(w.weight).toFixed(1)} ${unit}`, note: w.note }));
    jabs.forEach(j => activities.push({ type: 'jab', date: j.date, text: `${medicationLabel(j.medication)} jab: ${j.dose} ${j.doseUnit}` }));

    activities.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = activities.slice(0, 10);

    if (recent.length === 0) {
      list.innerHTML = '<p class="empty-state">No activity yet. Start by logging your weight!</p>';
      return;
    }

    list.innerHTML = recent.map(a => `
      <div class="activity-item">
        <span class="activity-dot ${a.type}"></span>
        <span class="activity-text">${a.text}${a.note ? ' - ' + a.note : ''}</span>
        <span class="activity-date">${daysAgo(a.date)}</span>
      </div>
    `).join('');
  }

  // ===== WEIGHT PAGE =====
  function initWeightPage() {
    const modal = document.getElementById('weight-modal');
    const form = document.getElementById('weight-form');

    document.getElementById('btn-add-weight').addEventListener('click', () => {
      document.getElementById('weight-edit-id').value = '';
      document.getElementById('weight-modal-title').textContent = 'Log Weight';
      document.getElementById('weight-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('weight-value').value = '';
      document.getElementById('weight-note').value = '';
      modal.style.display = 'flex';
    });

    document.getElementById('weight-modal-close').addEventListener('click', () => modal.style.display = 'none');
    document.getElementById('weight-form-cancel').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('weight-edit-id').value;
      const entry = {
        date: document.getElementById('weight-date').value,
        weight: document.getElementById('weight-value').value,
        note: document.getElementById('weight-note').value,
      };
      if (id) {
        Store.updateWeight(id, entry);
        toast('Weight entry updated', 'success');
      } else {
        Store.addWeight(entry);
        toast('Weight logged!', 'success');
      }
      modal.style.display = 'none';
      refreshWeightPage();
      refreshDashboard();
    });

    // Update unit labels
    updateWeightUnitLabels();
  }

  function updateWeightUnitLabels() {
    const unit = Store.getSettings().weightUnit;
    document.querySelectorAll('.weight-unit-label').forEach(el => el.textContent = unit);
  }

  function refreshWeightPage() {
    const weights = Store.getWeights();
    const unit = Store.getSettings().weightUnit;
    const tbody = document.getElementById('weight-tbody');
    const empty = document.getElementById('weight-empty');
    const count = document.getElementById('weight-count');

    updateWeightUnitLabels();
    count.textContent = weights.length;

    if (weights.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = '';
      document.getElementById('weight-table').style.display = 'none';
    } else {
      empty.style.display = 'none';
      document.getElementById('weight-table').style.display = '';

      // Render in reverse chronological
      const sorted = [...weights].reverse();
      tbody.innerHTML = sorted.map((w, i) => {
        const idx = weights.length - 1 - i;
        let change = '';
        if (idx > 0) {
          const diff = parseFloat(w.weight) - parseFloat(weights[idx - 1].weight);
          const sign = diff > 0 ? '+' : '';
          const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
          change = `<span class="stat-change ${cls}">${sign}${diff.toFixed(1)}</span>`;
        }
        return `<tr>
          <td>${formatDate(w.date)}</td>
          <td><strong>${parseFloat(w.weight).toFixed(1)} ${unit}</strong></td>
          <td>${change}</td>
          <td>${w.note || '--'}</td>
          <td class="actions">
            <button class="btn btn-ghost btn-sm" onclick="App.editWeight('${w.id}')">Edit</button>
            <button class="btn btn-ghost btn-sm" onclick="App.removeWeight('${w.id}')">Delete</button>
          </td>
        </tr>`;
      }).join('');
    }

    renderWeightFullChart();
  }

  function editWeight(id) {
    const weights = Store.getWeights();
    const w = weights.find(x => x.id === id);
    if (!w) return;
    document.getElementById('weight-edit-id').value = id;
    document.getElementById('weight-modal-title').textContent = 'Edit Weight';
    document.getElementById('weight-date').value = w.date;
    document.getElementById('weight-value').value = w.weight;
    document.getElementById('weight-note').value = w.note || '';
    document.getElementById('weight-modal').style.display = 'flex';
  }

  function removeWeight(id) {
    if (!confirm('Delete this weight entry?')) return;
    Store.deleteWeight(id);
    toast('Entry deleted');
    refreshWeightPage();
    refreshDashboard();
  }

  function renderWeightFullChart() {
    const weights = Store.getWeights();
    const colors = getChartColors();
    const goals = Store.getGoals();

    weightFullChart = destroyChart(weightFullChart);
    const ctx = document.getElementById('chart-weight-full').getContext('2d');

    if (weights.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    const datasets = [{
      label: 'Weight',
      data: weights.map(w => ({ x: w.date, y: parseFloat(w.weight) })),
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
      borderWidth: 2.5,
      tension: 0.3,
      fill: true,
      pointRadius: weights.length > 50 ? 0 : 4,
      pointHoverRadius: 6,
      pointBackgroundColor: colors.primary,
    }];

    // Target weight line
    if (goals.targetWeight) {
      datasets.push({
        label: 'Target',
        data: weights.map(w => ({ x: w.date, y: parseFloat(goals.targetWeight) })),
        borderColor: colors.success,
        borderDash: [6, 4],
        borderWidth: 2,
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
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: !!goals.targetWeight, labels: { color: colors.textMuted } },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + ' ' + Store.getSettings().weightUnit,
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'dd MMM yyyy' },
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted },
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted },
          },
        },
      },
    });
  }

  // ===== JAB PAGE =====
  function initJabPage() {
    const modal = document.getElementById('jab-modal');
    const form = document.getElementById('jab-form');
    const profile = Store.getProfile();

    document.getElementById('btn-add-jab').addEventListener('click', () => {
      document.getElementById('jab-edit-id').value = '';
      document.getElementById('jab-modal-title').textContent = 'Log Jab';
      document.getElementById('jab-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('jab-time').value = new Date().toTimeString().slice(0, 5);
      document.getElementById('jab-medication').value = profile.medication || 'semaglutide';
      document.getElementById('jab-dose').value = '';
      document.getElementById('jab-dose-unit').value = 'mg';
      document.getElementById('jab-site').value = '';
      document.getElementById('jab-notes').value = '';
      document.querySelectorAll('input[name="side-effect"]').forEach(cb => cb.checked = false);
      modal.style.display = 'flex';
    });

    document.getElementById('jab-modal-close').addEventListener('click', () => modal.style.display = 'none');
    document.getElementById('jab-form-cancel').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('jab-edit-id').value;
      const sideEffects = Array.from(document.querySelectorAll('input[name="side-effect"]:checked')).map(cb => cb.value);
      const entry = {
        date: document.getElementById('jab-date').value,
        time: document.getElementById('jab-time').value,
        medication: document.getElementById('jab-medication').value,
        dose: document.getElementById('jab-dose').value,
        doseUnit: document.getElementById('jab-dose-unit').value,
        site: document.getElementById('jab-site').value,
        sideEffects,
        notes: document.getElementById('jab-notes').value,
      };
      if (id) {
        Store.updateJab(id, entry);
        toast('Jab entry updated', 'success');
      } else {
        Store.addJab(entry);
        toast('Jab logged!', 'success');
      }
      modal.style.display = 'none';
      refreshJabPage();
      refreshDashboard();
    });
  }

  function refreshJabPage() {
    const jabs = Store.getJabs();
    const stats = Store.getStats();
    const tbody = document.getElementById('jab-tbody');
    const empty = document.getElementById('jab-empty');

    // Stats
    document.getElementById('jab-stat-total').textContent = jabs.length;
    document.getElementById('jab-stat-last').textContent = stats.lastJabDate ? formatDateShort(stats.lastJabDate) : '--';
    document.getElementById('jab-stat-next').textContent = stats.nextJabDate ? formatDateShort(stats.nextJabDate) : '--';
    document.getElementById('jab-stat-countdown').textContent = stats.nextJabDate ? daysUntil(stats.nextJabDate) : '';
    document.getElementById('jab-count').textContent = jabs.length;

    // Table
    if (jabs.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = '';
      document.getElementById('jab-table').style.display = 'none';
    } else {
      empty.style.display = 'none';
      document.getElementById('jab-table').style.display = '';

      const sorted = [...jabs].reverse();
      tbody.innerHTML = sorted.map(j => `<tr>
        <td>${formatDate(j.date)}${j.time ? '<br><small>' + j.time + '</small>' : ''}</td>
        <td>${medicationLabel(j.medication)}</td>
        <td><strong>${j.dose} ${j.doseUnit}</strong></td>
        <td>${siteLabel(j.site)}</td>
        <td>${j.sideEffects && j.sideEffects.length > 0 ? j.sideEffects.map(s => '<span class="badge">' + s + '</span>').join(' ') : '--'}</td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" onclick="App.editJab('${j.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="App.removeJab('${j.id}')">Delete</button>
        </td>
      </tr>`).join('');
    }

    // Site rotation
    updateSiteRotation(jabs);

    renderDoseChart(jabs);
    renderSideEffectsChart(jabs);
  }

  function editJab(id) {
    const jabs = Store.getJabs();
    const j = jabs.find(x => x.id === id);
    if (!j) return;
    document.getElementById('jab-edit-id').value = id;
    document.getElementById('jab-modal-title').textContent = 'Edit Jab';
    document.getElementById('jab-date').value = j.date;
    document.getElementById('jab-time').value = j.time || '';
    document.getElementById('jab-medication').value = j.medication;
    document.getElementById('jab-dose').value = j.dose;
    document.getElementById('jab-dose-unit').value = j.doseUnit;
    document.getElementById('jab-site').value = j.site || '';
    document.getElementById('jab-notes').value = j.notes || '';
    document.querySelectorAll('input[name="side-effect"]').forEach(cb => {
      cb.checked = j.sideEffects && j.sideEffects.includes(cb.value);
    });
    document.getElementById('jab-modal').style.display = 'flex';
  }

  function removeJab(id) {
    if (!confirm('Delete this jab entry?')) return;
    Store.deleteJab(id);
    toast('Jab deleted');
    refreshJabPage();
    refreshDashboard();
  }

  function updateSiteRotation(jabs) {
    const sites = ['arm-left', 'arm-right', 'abdomen-left', 'abdomen-right', 'thigh-left', 'thigh-right'];
    const counts = {};
    sites.forEach(s => counts[s] = 0);
    jabs.forEach(j => { if (j.site && counts[j.site] !== undefined) counts[j.site]++; });

    sites.forEach(s => {
      const el = document.getElementById('site-' + s);
      if (el) el.textContent = counts[s];
    });

    // Suggest least used site
    const minCount = Math.min(...Object.values(counts));
    const leastUsed = sites.filter(s => counts[s] === minCount);
    const suggestion = leastUsed.length > 0 ? `Suggested next site: ${siteLabel(leastUsed[0])}` : '';
    document.getElementById('site-suggestion').textContent = suggestion;
  }

  function renderDoseChart(jabs) {
    const colors = getChartColors();
    doseChart = destroyChart(doseChart);
    const ctx = document.getElementById('chart-doses').getContext('2d');

    if (jabs.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    doseChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: jabs.map(j => j.date),
        datasets: [{
          label: 'Dose',
          data: jabs.map(j => parseFloat(j.dose)),
          borderColor: colors.success,
          backgroundColor: colors.successLight,
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointRadius: 5,
          pointBackgroundColor: colors.success,
          stepped: 'after',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.parsed.y + ' ' + (jabs[ctx.dataIndex]?.doseUnit || 'mg'),
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'dd MMM yyyy' },
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted },
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function renderSideEffectsChart(jabs) {
    const colors = getChartColors();
    sideEffectsChart = destroyChart(sideEffectsChart);
    const ctx = document.getElementById('chart-side-effects').getContext('2d');

    const effectCounts = {};
    jabs.forEach(j => {
      if (j.sideEffects) {
        j.sideEffects.forEach(se => {
          if (se !== 'none') effectCounts[se] = (effectCounts[se] || 0) + 1;
        });
      }
    });

    const labels = Object.keys(effectCounts);
    const data = Object.values(effectCounts);

    if (labels.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    const bgColors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

    sideEffectsChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.map(l => l.charAt(0).toUpperCase() + l.slice(1).replace('-', ' ')),
        datasets: [{
          data,
          backgroundColor: bgColors.slice(0, labels.length),
          borderWidth: 0,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: colors.textMuted, padding: 12, usePointStyle: true, pointStyle: 'circle' },
          },
        },
      },
    });
  }

  // ===== GOALS PAGE =====
  function initGoalsPage() {
    document.getElementById('goals-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const goals = {
        targetWeight: document.getElementById('goal-target').value,
        weeklyTarget: document.getElementById('goal-weekly').value,
        targetDate: document.getElementById('goal-date').value,
      };
      Store.saveGoals(goals);
      toast('Goals saved!', 'success');
      refreshGoalsPage();
      refreshDashboard();
    });
  }

  function refreshGoalsPage() {
    const goals = Store.getGoals();
    const stats = Store.getStats();
    const unit = Store.getSettings().weightUnit;

    updateWeightUnitLabels();

    // Fill form
    document.getElementById('goal-target').value = goals.targetWeight || '';
    document.getElementById('goal-weekly').value = goals.weeklyTarget || 0.5;
    document.getElementById('goal-date').value = goals.targetDate || '';

    // Progress
    document.getElementById('goal-progress-pct').textContent = stats.progressPercent.toFixed(0) + '%';
    document.getElementById('goal-start-w').textContent = stats.startWeight ? stats.startWeight.toFixed(1) + ' ' + unit : '--';
    document.getElementById('goal-current-w').textContent = stats.currentWeight ? stats.currentWeight.toFixed(1) + ' ' + unit : '--';
    document.getElementById('goal-target-w').textContent = stats.targetWeight ? parseFloat(stats.targetWeight).toFixed(1) + ' ' + unit : '--';
    document.getElementById('goal-remaining').textContent = stats.weightToGo ? stats.weightToGo.toFixed(1) + ' ' + unit : '--';
    document.getElementById('goal-avg-weekly').textContent = stats.avgWeeklyLoss ? stats.avgWeeklyLoss.toFixed(2) + ' ' + unit + '/wk' : '--';

    // Estimated completion
    if (stats.weightToGo && stats.avgWeeklyLoss > 0) {
      const weeksLeft = stats.weightToGo / stats.avgWeeklyLoss;
      const estDate = new Date();
      estDate.setDate(estDate.getDate() + weeksLeft * 7);
      document.getElementById('goal-est-date').textContent = formatDate(estDate.toISOString().split('T')[0]);
    } else {
      document.getElementById('goal-est-date').textContent = '--';
    }

    renderProgressRing(stats.progressPercent);
    renderMilestones(stats);
    renderProjectionChart(stats);
  }

  function renderProgressRing(percent) {
    progressRingChart = destroyChart(progressRingChart);
    const ctx = document.getElementById('chart-progress-ring').getContext('2d');
    const colors = getChartColors();

    progressRingChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [Math.min(percent, 100), Math.max(100 - percent, 0)],
          backgroundColor: [colors.primary, colors.grid],
          borderWidth: 0,
          cutout: '80%',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: { animateRotate: true },
      },
    });
  }

  function renderMilestones(stats) {
    const container = document.getElementById('milestones-list');
    if (!stats.startWeight || !stats.targetWeight) {
      container.innerHTML = '<p class="empty-state">Set a target weight to see milestones</p>';
      return;
    }

    const totalToLose = stats.startWeight - stats.targetWeight;
    if (totalToLose <= 0) {
      container.innerHTML = '<p class="empty-state">Set a target weight below your starting weight</p>';
      return;
    }

    const milestones = [
      { pct: 5, icon: '🌱', title: '5% Lost' },
      { pct: 10, icon: '🔥', title: '10% Lost' },
      { pct: 15, icon: '💪', title: '15% Lost' },
      { pct: 25, icon: '⭐', title: '25% Lost' },
      { pct: 50, icon: '🎯', title: 'Halfway!' },
      { pct: 75, icon: '🏆', title: '75% Done' },
      { pct: 90, icon: '🚀', title: 'Almost There!' },
      { pct: 100, icon: '👑', title: 'Goal Reached!' },
    ];

    container.innerHTML = milestones.map(m => {
      const achieved = stats.progressPercent >= m.pct;
      const weightAtMilestone = stats.startWeight - (totalToLose * m.pct / 100);
      return `<div class="milestone ${achieved ? 'achieved' : ''}">
        <span class="milestone-icon">${m.icon}</span>
        <div class="milestone-text">
          <div class="milestone-title">${m.title}</div>
          <div class="milestone-sub">${weightAtMilestone.toFixed(1)} ${stats.unit}</div>
        </div>
      </div>`;
    }).join('');
  }

  function renderProjectionChart(stats) {
    const weights = Store.getWeights();
    const goals = Store.getGoals();
    const colors = getChartColors();

    projectionChart = destroyChart(projectionChart);
    const ctx = document.getElementById('chart-projection').getContext('2d');

    if (weights.length < 2 || !goals.targetWeight) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    const actualData = weights.map(w => ({ x: w.date, y: parseFloat(w.weight) }));

    // Generate projection
    const projData = [];
    if (stats.avgWeeklyLoss > 0 && stats.weightToGo > 0) {
      let currentW = stats.currentWeight;
      let currentD = new Date(weights[weights.length - 1].date);
      const target = parseFloat(goals.targetWeight);

      projData.push({ x: currentD.toISOString().split('T')[0], y: currentW });
      while (currentW > target) {
        currentD = new Date(currentD);
        currentD.setDate(currentD.getDate() + 7);
        currentW -= stats.avgWeeklyLoss;
        if (currentW < target) currentW = target;
        projData.push({ x: currentD.toISOString().split('T')[0], y: parseFloat(currentW.toFixed(1)) });
        if (projData.length > 104) break; // max 2 years
      }
    }

    const datasets = [
      {
        label: 'Actual',
        data: actualData,
        borderColor: colors.primary,
        backgroundColor: colors.primaryLight,
        borderWidth: 2.5,
        tension: 0.3,
        fill: false,
        pointRadius: weights.length > 30 ? 0 : 3,
      },
    ];

    if (projData.length > 0) {
      datasets.push({
        label: 'Projection',
        data: projData,
        borderColor: colors.warning,
        borderDash: [6, 4],
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        pointRadius: 0,
      });
    }

    // Target line
    const allDates = [...actualData.map(d => d.x), ...projData.map(d => d.x)];
    datasets.push({
      label: 'Target',
      data: [
        { x: allDates[0], y: parseFloat(goals.targetWeight) },
        { x: allDates[allDates.length - 1], y: parseFloat(goals.targetWeight) },
      ],
      borderColor: colors.success,
      borderDash: [4, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
    });

    projectionChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { labels: { color: colors.textMuted, usePointStyle: true } },
        },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'dd MMM yyyy' },
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted },
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.textMuted },
          },
        },
      },
    });
  }

  // ===== SETTINGS PAGE =====
  function initSettingsPage() {
    // Profile form
    document.getElementById('profile-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const profile = {
        name: document.getElementById('set-name').value.trim(),
        age: document.getElementById('set-age').value,
        height: document.getElementById('set-height').value,
        heightUnit: document.getElementById('set-height-unit').value,
        startWeight: document.getElementById('set-start-weight').value,
        startDate: document.getElementById('set-start-date').value,
        medication: document.getElementById('set-medication').value,
      };
      Store.saveProfile(profile);
      updateGreeting();
      toast('Profile saved!', 'success');
    });

    // Settings form
    document.getElementById('settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const settings = Store.getSettings();
      settings.weightUnit = document.getElementById('set-weight-unit').value;
      settings.theme = document.getElementById('set-theme').value;
      Store.saveSettings(settings);
      applyTheme();
      updateWeightUnitLabels();
      toast('Preferences saved!', 'success');
    });

    // Export
    document.getElementById('btn-export').addEventListener('click', () => {
      const data = Store.exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shotsy-backup-' + new Date().toISOString().split('T')[0] + '.json';
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
          toast('Data imported successfully!', 'success');
          bootApp();
          navigateTo('dashboard');
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
      if (!confirm('Really? This will clear all your weight entries, jab logs, and settings.')) return;
      Store.clearAll();
      toast('All data cleared');
      window.location.reload();
    });
  }

  function refreshSettingsPage() {
    const profile = Store.getProfile();
    const settings = Store.getSettings();

    document.getElementById('set-name').value = profile.name || '';
    document.getElementById('set-age').value = profile.age || '';
    document.getElementById('set-height').value = profile.height || '';
    document.getElementById('set-height-unit').value = profile.heightUnit || 'cm';
    document.getElementById('set-start-weight').value = profile.startWeight || '';
    document.getElementById('set-start-date').value = profile.startDate || '';
    document.getElementById('set-medication').value = profile.medication || 'semaglutide';

    document.getElementById('set-weight-unit').value = settings.weightUnit || 'kg';
    document.getElementById('set-theme').value = settings.theme || 'light';

    updateWeightUnitLabels();
  }

  // Public API
  return {
    init,
    editWeight,
    removeWeight,
    editJab,
    removeJab,
  };
})();

// Boot the app
document.addEventListener('DOMContentLoaded', App.init);
