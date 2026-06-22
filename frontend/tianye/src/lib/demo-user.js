const STORAGE_KEY = "tianye-demo-user-state";

const DEFAULT_USERS = [
  {
    id: "demo-alex",
    name: "Alex",
    homeCity: "Beijing",
  },
  {
    id: "demo-tiantian",
    name: "Tiantian",
    homeCity: "Haidian",
  },
];

export function loadDemoUserState() {
  if (typeof window === "undefined") {
    return {
      currentUserId: DEFAULT_USERS[0].id,
      users: DEFAULT_USERS,
      favoritesByUser: {},
      downloadsByUser: {},
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        currentUserId: DEFAULT_USERS[0].id,
        users: DEFAULT_USERS,
        favoritesByUser: {},
        downloadsByUser: {},
      };
    }
    const parsed = JSON.parse(raw);
    return {
      currentUserId: parsed.currentUserId || DEFAULT_USERS[0].id,
      users: Array.isArray(parsed.users) && parsed.users.length ? parsed.users : DEFAULT_USERS,
      favoritesByUser: parsed.favoritesByUser || {},
      downloadsByUser: parsed.downloadsByUser || {},
    };
  } catch {
    return {
      currentUserId: DEFAULT_USERS[0].id,
      users: DEFAULT_USERS,
      favoritesByUser: {},
      downloadsByUser: {},
    };
  }
}

export function saveDemoUserState(state) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createDemoUser(name) {
  return {
    id: `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
    name,
    homeCity: "Beijing",
  };
}
