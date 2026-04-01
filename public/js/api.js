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

export async function importExerciseTcx(xmlString) {
  const res = await fetch('/api/exercises/import', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlString,
  });

  if (res.status === 401) {
    window.location.reload();
    throw new Error('Not authenticated');
  }

  const data = await res.json();

  // 409 = duplicate, return exercise with a flag
  if (res.status === 409) {
    return { ...data.exercise, _duplicate: true };
  }

  if (!res.ok) {
    throw new Error(data.error || `Import failed: ${res.status}`);
  }

  return data;
}

export async function importExerciseJson(jsonData) {
  const res = await fetch('/api/exercises/import-json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonData),
  });

  if (res.status === 401) {
    window.location.reload();
    throw new Error('Not authenticated');
  }

  const data = await res.json();

  if (res.status === 409) {
    return { ...data.exercise, _duplicate: true };
  }

  if (!res.ok) {
    throw new Error(data.error || `Import failed: ${res.status}`);
  }

  return data;
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
