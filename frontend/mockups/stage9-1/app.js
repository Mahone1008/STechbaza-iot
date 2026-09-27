(() => {
  const screens = Array.from(document.querySelectorAll('[data-screen]'));
  const buttons = Array.from(document.querySelectorAll('[data-target]'));

  function showScreen(name) {
    const target = screens.some((screen) => screen.dataset.screen === name) ? name : 'device';
    screens.forEach((screen) => { screen.hidden = screen.dataset.screen !== target; });
    buttons.forEach((button) => button.classList.toggle('is-active', button.dataset.target === target));
    document.title = `KERUMO — ${target === 'device' ? 'Панель пристрою' : target}`;
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      location.hash = button.dataset.target;
    });
  });

  window.addEventListener('hashchange', () => showScreen(location.hash.slice(1)));
  showScreen(location.hash.slice(1) || 'device');
})();
