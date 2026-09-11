const CONFIG = {
  // Base URL for API requests. Change this for production deployment.
  API_BASE_URL: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://apidownlynk.mita.in'
};
