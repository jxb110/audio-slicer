const LOCAL_SESSION_TOKEN_KEY = "audio-slicer.local-session-token";

export function getLocalSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(LOCAL_SESSION_TOKEN_KEY);
}

export function setLocalSessionToken(token: string): void {
  window.sessionStorage.setItem(LOCAL_SESSION_TOKEN_KEY, token);
}

export function clearLocalSessionToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(LOCAL_SESSION_TOKEN_KEY);
}

export function getLocalSessionHeaders(): HeadersInit {
  const token = getLocalSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
