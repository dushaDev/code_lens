// User-account Cloud AI API key management.
//
// These keys live on the user account (not per-course): the backend stores
// them in the user_api_keys table and auto-migrates any legacy per-course
// keys into it. The "active" key is the one used for qualitative report
// generation. Shared by the Settings page and the CourseSelect card so both
// surfaces talk to the same endpoints.

const BASE = '/api/v1/user/api-keys';

function authHeaders(extra = {}) {
  const token = localStorage.getItem('token');
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function errorMessage(res, fallback) {
  try {
    const data = await res.json();
    return data?.detail || fallback;
  } catch {
    return fallback;
  }
}

// List the current user's API keys (newest first).
export async function fetchApiKeys() {
  const res = await fetch(BASE, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load API keys.'));
  return res.json();
}

// Create a new key. `value` is the plaintext key; the server encrypts it and
// returns the masked record. The first key a user adds becomes active.
export async function createApiKey({ name, provider, value }) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: (name || '').trim(),
      provider: provider || 'Gemini',
      api_key: (value || '').trim(),
    }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to save API key.'));
  return res.json();
}

// Mark one key active; the server deactivates the others.
export async function activateApiKey(id) {
  const res = await fetch(`${BASE}/${id}/activate`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to activate API key.'));
  return res.json();
}

// Delete a key (server responds 204 No Content).
export async function deleteApiKey(id) {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to delete API key.'));
}
