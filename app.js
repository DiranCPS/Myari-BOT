document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();

  const tabs = document.querySelectorAll('.tab');
  const rows = document.querySelectorAll('.command-row');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      const selected = tab.dataset.tab;
      rows.forEach((row) => {
        const visible = selected === 'all'
          || row.dataset.category === selected;
        row.style.display = visible ? 'grid' : 'none';
      });
    });
  });
});
