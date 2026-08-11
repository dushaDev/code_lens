/**
 * Centralized API Client for Code Lens.
 * Handles request authorization and global API error states (such as 401 Unauthorized).
 */

export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

/**
 * Perform a fetch request to the backend API.
 * Automatically injects the JWT token from localStorage if present.
 * If a 401 response is received, it removes the token and dispatches an unauthorized event.
 * 
 * @param {string} input - The URL path to fetch (e.g. '/api/v1/projects')
 * @param {RequestInit} [init={}] - Fetch configuration options
 * @returns {Promise<Response>}
 */
export async function apiFetch(input, init = {}) {
  const token = localStorage.getItem('token');
  
  // Clone/initialize headers
  const headers = new Headers(init.headers || {});
  
  // Auto-inject authorization token if present and not overridden
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const options = {
    ...init,
    headers
  };
  
  const response = await fetch(input, options);
  
  if (response.status === 401) {
    localStorage.removeItem('token');
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  
  return response;
}
