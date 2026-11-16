let clicks = 0;
const button = document.getElementById('test-button');
const status = document.getElementById('status');

button.addEventListener('click', () => {
  clicks += 1;
  status.textContent = `Clicks: ${clicks}`;
});
