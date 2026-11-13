/* ===========================================================
   Expense & Budget Visualizer — app logic
   Vanilla JS, single file. All data is persisted in localStorage.
   =========================================================== */
(function () {
  'use strict';

  /* ----- Constants ----- */
  var STORAGE_KEY = 'ebv_state';

  // The three categories required by the spec, each with a fixed color.
  var DEFAULT_CATEGORIES = [
    { name: 'Food', color: '#f97316' },
    { name: 'Transport', color: '#3b82f6' },
    { name: 'Fun', color: '#ec4899' }
  ];

  // Colors assigned to custom categories in order.
  var COLOR_PALETTE = [
    '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4',
    '#84cc16', '#a855f7', '#14b8a6', '#f43f5e', '#6366f1'
  ];

  var SUN_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  /* ----- State ----- */
  var state = loadState();
  var chart = null; // Chart.js instance (created lazily)

  /* ----- Small helpers ----- */
  function $(id) { return document.getElementById(id); }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Escape user text before injecting into HTML (prevents XSS).
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Format a number as currency, e.g. 1234.5 -> "$1,234.50".
  function formatMoney(n) {
    var v = Number.isFinite(n) ? n : 0;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ----- Persistence ----- */
  function defaultState() {
    return {
      transactions: [],
      budget: 0,
      categories: clone(DEFAULT_CATEGORIES),
      theme: 'light',
      sortBy: 'newest'
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      var merged = Object.assign(defaultState(), parsed);
      if (!Array.isArray(merged.transactions)) merged.transactions = [];
      if (!Array.isArray(merged.categories) || merged.categories.length === 0) {
        merged.categories = clone(DEFAULT_CATEGORIES);
      }
      if (typeof merged.budget !== 'number' || !isFinite(merged.budget)) merged.budget = 0;
      return merged;
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage may be full/blocked */ }
  }

  /* ----- Derived data ----- */
  function totalSpent() {
    return state.transactions.reduce(function (sum, t) { return sum + t.amount; }, 0);
  }

  function aggregateByCategory() {
    var totals = {};
    state.transactions.forEach(function (t) {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });
    return totals;
  }

  function categoryColor(name) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].name === name) return state.categories[i].color;
    }
    return '#94a3b8';
  }

  function getSortedTransactions() {
    var arr = state.transactions.slice();
    switch (state.sortBy) {
      case 'amount-desc':
        arr.sort(function (a, b) { return b.amount - a.amount; }); break;
      case 'amount-asc':
        arr.sort(function (a, b) { return a.amount - b.amount; }); break;
      case 'category-asc':
        arr.sort(function (a, b) {
          return a.category.localeCompare(b.category) || (b.createdAt - a.createdAt);
        }); break;
      case 'newest':
      default:
        arr.sort(function (a, b) { return b.createdAt - a.createdAt; });
    }
    return arr;
  }

  /* ----- Rendering ----- */
  function renderAll() {
    renderBalance();
    renderCategorySelect();
    renderChart();
    renderList();
  }

  function renderBalance() {
    var spent = totalSpent();
    var balance = state.budget - spent;
    $('balance').textContent = formatMoney(balance);
    $('balance').classList.toggle('is-negative', balance < 0);
    $('spent').textContent = formatMoney(spent);
  }

  function renderCategorySelect() {
    var sel = $('category');
    var current = sel.value;
    sel.innerHTML = '';
    state.categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    // Keep the previously selected category if it still exists.
    if (state.categories.some(function (c) { return c.name === current; })) {
      sel.value = current;
    }
  }

  function renderChart() {
    var totals = aggregateByCategory();
    var labels = Object.keys(totals);
    var data = labels.map(function (l) { return totals[l]; });
    var colors = labels.map(categoryColor);
    var hasData = labels.length > 0;
    var chartAvailable = typeof window.Chart !== 'undefined';

    var canvas = $('chart');
    var placeholder = $('chartPlaceholder');

    if (!hasData) {
      if (chart) {
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.update();
      }
      // The canvas stays mounted (Chart.js keeps its sizing stable that way);
      // the placeholder simply sits on top of the empty pie.
      placeholder.hidden = false;
      placeholder.textContent = 'No spending to chart yet.';
      renderLegend([], [], []);
      return;
    }

    placeholder.hidden = true;

    // Graceful fallback if Chart.js failed to load (e.g. offline):
    // the legend still shows the full breakdown without the canvas.
    if (!chartAvailable) {
      renderLegend(labels, data, colors);
      return;
    }

    if (!chart) {
      chart = new window.Chart(canvas, {
        type: 'pie',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: colors,
            borderColor: cssVar('--card-bg') || '#ffffff',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: cssVar('--card-bg') || '#000',
              titleColor: cssVar('--text'),
              bodyColor: cssVar('--text'),
              borderColor: cssVar('--card-border'),
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: function (ctx) {
                  var total = ctx.dataset.data.reduce(function (s, v) { return s + v; }, 0) || 1;
                  var pct = Math.round((ctx.parsed / total) * 100);
                  return ' ' + ctx.label + ': ' + formatMoney(ctx.parsed) + ' (' + pct + '%)';
                }
              }
            }
          }
        }
      });
    } else {
      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].backgroundColor = colors;
      chart.data.datasets[0].borderColor = cssVar('--card-bg') || '#ffffff';
      chart.update();
    }

    renderLegend(labels, data, colors);
  }

  // Recreate the chart from scratch (used on theme change so colors update).
  function rebuildChart() {
    if (chart) { chart.destroy(); chart = null; }
    renderChart();
  }

  function renderLegend(labels, data, colors) {
    var ul = $('legend');
    ul.innerHTML = '';
    var total = data.reduce(function (s, v) { return s + v; }, 0) || 1;
    labels.forEach(function (label, i) {
      var pct = Math.round((data[i] / total) * 100);
      var li = document.createElement('li');
      li.className = 'legend__item';
      li.innerHTML =
        '<span class="legend__dot" style="background:' + colors[i] + '"></span>' +
        '<span class="legend__name">' + escapeHtml(label) + '</span>' +
        '<span class="legend__pct">' + pct + '%</span>' +
        '<span class="legend__amt">' + formatMoney(data[i]) + '</span>';
      ul.appendChild(li);
    });
  }

  function renderList() {
    var list = $('txList');
    var empty = $('emptyState');
    var items = getSortedTransactions();

    if (items.length === 0) {
      list.innerHTML = '';
      list.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.hidden = false;
    list.innerHTML = '';

    items.forEach(function (t) {
      var color = categoryColor(t.category);
      var li = document.createElement('li');
      li.className = 'tx';
      li.dataset.id = t.id;
      li.innerHTML =
        '<span class="tx__dot" style="background:' + color + '"></span>' +
        '<div class="tx__info">' +
          '<span class="tx__name">' + escapeHtml(t.name) + '</span>' +
          '<span class="tx__cat" style="color:' + color + '">' + escapeHtml(t.category) + '</span>' +
        '</div>' +
        '<span class="tx__amount">' + formatMoney(t.amount) + '</span>' +
        '<button class="tx__delete" data-delete="' + t.id + '" type="button" ' +
          'aria-label="Delete ' + escapeHtml(t.name) + '" title="Delete">&#10005;</button>';
      list.appendChild(li);
    });
  }

  /* ----- Event handlers ----- */
  function showError(msg) {
    var el = $('formError');
    el.textContent = msg;
    el.hidden = false;
  }

  function hideError() {
    var el = $('formError');
    el.hidden = true;
    el.textContent = '';
  }

  function onSubmit(e) {
    e.preventDefault();
    var name = $('itemName').value.trim();
    var amountRaw = $('amount').value;
    var amount = parseFloat(amountRaw);
    var category = $('category').value;

    // Validate that all fields are filled (required by the spec).
    if (!name) { showError('Please enter an item name.'); $('itemName').focus(); return; }
    if (!amountRaw || isNaN(amount) || amount <= 0) {
      showError('Please enter an amount greater than 0.'); $('amount').focus(); return;
    }
    if (!category) { showError('Please choose a category.'); return; }

    hideError();

    state.transactions.push({
      id: genId(),
      name: name,
      amount: Math.round(amount * 100) / 100, // 2 decimals
      category: category,
      createdAt: Date.now()
    });
    saveState();
    renderAll();

    // Reset the form for the next entry, keep focus on the name field.
    $('itemName').value = '';
    $('amount').value = '';
    $('itemName').focus();
  }

  function onBudgetInput(e) {
    var v = parseFloat(e.target.value);
    state.budget = (isNaN(v) || v < 0) ? 0 : Math.round(v * 100) / 100;
    saveState();
    renderBalance();
  }

  function onSortChange(e) {
    state.sortBy = e.target.value;
    saveState();
    renderList();
  }

  function onDelete(e) {
    var btn = e.target.closest('[data-delete]');
    if (!btn) return;
    var id = btn.getAttribute('data-delete');
    state.transactions = state.transactions.filter(function (t) { return t.id !== id; });
    saveState();
    renderAll();
  }

  /* ----- Custom categories ----- */
  function showCustomCategory() {
    $('customCategoryWrap').hidden = false;
    $('customCategory').value = '';
    $('customCategory').focus();
  }

  function hideCustomCategory() {
    $('customCategoryWrap').hidden = true;
  }

  function selectCategory(name) {
    var sel = $('category');
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === name) { sel.value = name; return; }
    }
  }

  function confirmCustomCategory() {
    var name = $('customCategory').value.trim();
    if (!name) { $('customCategory').focus(); return; }

    // If the category already exists (case-insensitive), just select it.
    var existing = state.categories.filter(function (c) {
      return c.name.toLowerCase() === name.toLowerCase();
    })[0];
    if (existing) {
      hideCustomCategory();
      selectCategory(existing.name);
      return;
    }

    var color = COLOR_PALETTE[state.categories.length % COLOR_PALETTE.length];
    state.categories.push({ name: name, color: color });
    saveState();
    renderCategorySelect();
    selectCategory(name);
    hideCustomCategory();
    renderChart(); // keep chart/legend in sync
  }

  /* ----- Theme ----- */
  function updateThemeIcon() {
    var btn = $('themeToggle');
    btn.innerHTML = state.theme === 'dark' ? SUN_SVG : MOON_SVG;
    btn.setAttribute('aria-label', state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    saveState();
    updateThemeIcon();
    rebuildChart(); // border + tooltip colors depend on theme
  }

  /* ----- Clear all data ----- */
  function onClearAll() {
    var hasNothing = state.transactions.length === 0 && state.budget === 0 &&
      state.categories.length === DEFAULT_CATEGORIES.length;
    if (hasNothing) return;
    if (!window.confirm('Clear all transactions, budget, and custom categories? This cannot be undone.')) return;

    var keepTheme = state.theme;
    state = defaultState();
    state.theme = keepTheme;
    saveState();

    // Reset UI controls that aren't fully re-rendered by renderAll().
    $('budgetInput').value = '';
    $('sortBy').value = state.sortBy;
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeIcon();
    renderAll();
  }

  /* ----- Init ----- */
  function init() {
    // Make sure the theme attribute matches stored state.
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeIcon();

    // Seed UI controls with stored values.
    $('budgetInput').value = state.budget ? state.budget : '';
    $('sortBy').value = state.sortBy;

    // Wire up events.
    $('txForm').addEventListener('submit', onSubmit);
    $('budgetInput').addEventListener('input', onBudgetInput);
    $('sortBy').addEventListener('change', onSortChange);
    $('themeToggle').addEventListener('click', toggleTheme);
    $('addCategoryBtn').addEventListener('click', showCustomCategory);
    $('cancelCategoryBtn').addEventListener('click', hideCustomCategory);
    $('confirmCategoryBtn').addEventListener('click', confirmCustomCategory);
    $('customCategory').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmCustomCategory(); }
      if (e.key === 'Escape') { hideCustomCategory(); }
    });
    $('txList').addEventListener('click', onDelete);
    $('clearAllBtn').addEventListener('click', onClearAll);

    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
