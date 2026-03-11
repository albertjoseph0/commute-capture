/* ═══════════════════════════════════════════════════════
   Client-Side Router — Hash-based SPA navigation
   ═══════════════════════════════════════════════════════ */

window.router = {
  _pages: {},
  _navLinks: [],
  _onNavigate: null,

  init(onNavigate) {
    this._onNavigate = onNavigate;
    this._pages = {
      capture:  document.getElementById('page-capture'),
      review:   document.getElementById('page-review'),
      coverage: document.getElementById('page-coverage'),
    };
    this._navLinks = document.querySelectorAll('.nav-link[data-page]');

    // Listen for nav clicks
    this._navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        this.navigate(page);
      });
    });

    // Handle hash changes
    window.addEventListener('hashchange', () => {
      const page = location.hash.slice(1) || 'capture';
      this._activate(page);
    });

    // Initial route
    const initial = location.hash.slice(1) || 'capture';
    this._activate(initial);
  },

  navigate(page) {
    location.hash = page;
  },

  _activate(page) {
    if (!this._pages[page]) page = 'capture';

    // Toggle page views
    Object.entries(this._pages).forEach(([key, el]) => {
      el.classList.toggle('active', key === page);
    });

    // Toggle nav links
    this._navLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    // Notify
    if (this._onNavigate) this._onNavigate(page);
  },
};
