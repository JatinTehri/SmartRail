import axios from 'axios';

/**
 * Pre-configured Axios instance for SmartRail backend API.
 *
 * - Base URL points to the Express backend
 * - withCredentials enables HTTP-only cookie transport for JWT auth
 * - Timeout prevents hanging requests
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
