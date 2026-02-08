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

export function getCachedExercises() {
  return request('/api/exercises/cached');
}

export async function getExerciseTcx(id) {
  try {
    const res = await fetch(`/api/exercises/${id}/tcx`);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

export async function getExerciseGpx(id) {
  try {
    const res = await fetch(`/api/exercises/${id}/gpx`);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}
