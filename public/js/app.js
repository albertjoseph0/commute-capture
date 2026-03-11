/* ═══════════════════════════════════════════════════════
   App Bootstrap — Initialize all modules
   ═══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize modules
  capturePage.init();
  reviewPage.init();
  coveragePage.init();

  // Initialize router with page-change callback
  router.init((page) => {
    if (page === 'review') {
      reviewPage.loadRecordings();
    } else if (page === 'coverage') {
      coveragePage.loadCoverage();
    }
  });

  console.log('🎙️ CommuteCapture frontend initialized');
});
