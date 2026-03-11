/* ═══════════════════════════════════════════════════════
   Coverage Dashboard — Prompt coverage & distribution
   ═══════════════════════════════════════════════════════ */

window.coveragePage = (() => {
  const $ = (id) => document.getElementById(id);

  const CATEGORY_CONFIG = {
    free_form:            { label: 'Free Form',          icon: '💬', color: '#3b82f6' },
    task_oriented:        { label: 'Task Oriented',      icon: '🎯', color: '#10b981' },
    short_command:        { label: 'Short Command',      icon: '⚡', color: '#f59e0b' },
    hard_transcription:   { label: 'Hard Transcription', icon: '🔤', color: '#ef4444' },
    read_speech:          { label: 'Read Speech',        icon: '📖', color: '#8b5cf6' },
    turn_taking:          { label: 'Turn Taking',        icon: '🔄', color: '#06b6d4' },
  };

  function init() {
    $('btn-refresh-coverage').addEventListener('click', loadCoverage);
  }

  async function loadCoverage() {
    try {
      const data = await api.getCoverage();
      renderStats(data);
      renderDonut(data.by_category);
      renderCategoryCards(data.by_category, data.by_prompt);
      renderUnderrepresented(data.underrepresented);
    } catch (err) {
      console.error('Coverage load error:', err);
      toast.error(`Failed to load coverage: ${err.message}`);
    }
  }

  function renderStats(data) {
    const totalRecordings = data.by_prompt.reduce((s, p) => s + p.count, 0);
    const activePrompts = data.by_prompt.length;
    const avg = activePrompts > 0 ? (totalRecordings / activePrompts).toFixed(1) : '0';
    const underrep = data.underrepresented.length;

    $('cov-total-recordings').textContent = totalRecordings;
    $('cov-active-prompts').textContent = activePrompts;
    $('cov-avg-per-prompt').textContent = avg;
    $('cov-underrep-count').textContent = underrep;
  }

  function renderDonut(byCategory) {
    const svg = $('donut-svg');
    const legend = $('donut-legend');
    const total = byCategory.reduce((s, c) => s + c.count, 0);
    $('donut-total').textContent = total;

    // Clear
    svg.innerHTML = '';
    legend.innerHTML = '';

    if (total === 0) {
      // Empty state circle
      svg.innerHTML = `<circle cx="100" cy="100" r="80" fill="none" stroke="var(--cc-bg-elevated)" stroke-width="20" />`;
      return;
    }

    const r = 80;
    const circumference = 2 * Math.PI * r;
    let offset = 0;

    byCategory.forEach(cat => {
      const cfg = CATEGORY_CONFIG[cat.category] || { label: cat.category, color: '#64748b' };
      const pct = cat.count / total;
      const dashLength = pct * circumference;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '100');
      circle.setAttribute('cy', '100');
      circle.setAttribute('r', String(r));
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', cfg.color);
      circle.setAttribute('stroke-width', '20');
      circle.setAttribute('stroke-dasharray', `${dashLength} ${circumference - dashLength}`);
      circle.setAttribute('stroke-dashoffset', String(-offset));
      circle.style.transition = 'all 0.6s ease-out';
      svg.appendChild(circle);

      offset += dashLength;

      // Legend item
      const li = document.createElement('div');
      li.className = 'legend__item';
      li.innerHTML = `
        <span class="legend__swatch legend__swatch--${cat.category}"></span>
        <span>${cfg.label}: <strong>${cat.count}</strong> (${(pct * 100).toFixed(0)}%)</span>
      `;
      legend.appendChild(li);
    });
  }

  function renderCategoryCards(byCategory, byPrompt) {
    const grid = $('category-grid');
    grid.innerHTML = '';

    const maxCount = Math.max(...byCategory.map(c => c.count), 1);

    byCategory.forEach(cat => {
      const cfg = CATEGORY_CONFIG[cat.category] || { label: cat.category, icon: '📁', color: '#64748b' };
      const promptsInCat = byPrompt.filter(p => p.category === cat.category);
      const pct = ((cat.count / maxCount) * 100).toFixed(0);

      const card = document.createElement('div');
      card.className = 'category-card';
      card.innerHTML = `
        <div class="category-card__header">
          <span class="category-card__name">
            <span class="category-card__icon category-card__icon--${cat.category}">${cfg.icon}</span>
            ${cfg.label}
          </span>
          <span class="category-card__count">${cat.count}</span>
        </div>
        <div class="category-card__bar-row">
          <div class="category-card__bar">
            <div class="category-card__bar-fill category-card__bar-fill--${cat.category}" style="width: ${pct}%"></div>
          </div>
          <span class="category-card__pct">${pct}%</span>
        </div>
        <div class="category-card__footer">
          <span>${promptsInCat.length} prompts</span>
          <span>avg ${promptsInCat.length > 0 ? (cat.count / promptsInCat.length).toFixed(1) : '0'}/prompt</span>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function renderUnderrepresented(underrep) {
    const list = $('underrep-list');
    $('underrep-badge').textContent = underrep.length;

    if (underrep.length === 0) {
      list.innerHTML = `
        <div class="empty-state" style="padding: var(--cc-space-xl);">
          <div class="empty-state__icon">✓</div>
          <div class="empty-state__title">Great coverage!</div>
          <div class="empty-state__desc">All prompts have above-average recording counts.</div>
        </div>`;
      return;
    }

    // Show top 20 most underrepresented
    const sorted = underrep.slice(0, 20);
    list.innerHTML = '';

    sorted.forEach(p => {
      const cfg = CATEGORY_CONFIG[p.category] || { label: p.category };
      const badgeColor = getCategoryBadgeColor(p.category);

      const item = document.createElement('div');
      item.className = 'underrep-item';
      item.innerHTML = `
        <span class="underrep-item__text" title="${escHtml(p.text)}">${escHtml(p.text)}</span>
        <span class="badge badge--${badgeColor}">${cfg.label}</span>
        <span class="underrep-item__count">${p.count} rec${p.count !== 1 ? 's' : ''}</span>
      `;
      list.appendChild(item);
    });
  }

  function getCategoryBadgeColor(cat) {
    const map = {
      free_form: 'blue', task_oriented: 'green', short_command: 'amber',
      hard_transcription: 'red', read_speech: 'violet', turn_taking: 'muted',
    };
    return map[cat] || 'muted';
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  return { init, loadCoverage };
})();
