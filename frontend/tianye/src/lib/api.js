function getCsrfToken() {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const chunk of cookies) {
    const cookie = chunk.trim();
    if (cookie.startsWith("csrftoken=")) {
      return decodeURIComponent(cookie.slice("csrftoken=".length));
    }
  }
  return "";
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

export async function ensureCsrfCookie() {
  await fetch("/api/csrf/", {
    method: "GET",
    credentials: "same-origin",
  });
}

export async function postJson(url, payload) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCsrfToken(),
    },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
}

export async function postFormData(url, formData) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "X-CSRFToken": getCsrfToken(),
    },
    credentials: "same-origin",
    body: formData,
  });
}
