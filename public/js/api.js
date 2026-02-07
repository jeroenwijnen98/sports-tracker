async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (res.status === 401) {
    window.location.reload();
    throw new Error('Not authenticated');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export function getAuthStatus() {
  return request('/auth/status');
}

export function logout() {
  return request('/auth/logout', { method: 'POST' });
}

export function getExercises() {
  return request('/api/exercises');
}
