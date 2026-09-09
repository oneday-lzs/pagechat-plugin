const IS_EXTENSION = Boolean(globalThis.chrome?.runtime?.id);

const DEFAULT_SETTINGS = {
  temperature: 0.7,
  includePageByDefault: false,
  maxPageChars: 12000,
  maxSitePages: 10
};

const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const tempLabel = document.getElementById("tempLabel");

function showStatus(text, ok) {
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.className = `status ${ok ? "ok" : "err"}`;
}

async function load() {
  let saved = {};
  if (IS_EXTENSION) {
    const data = await chrome.storage.local.get("pageyu_settings");
    saved = data.pageyu_settings || {};
  } else {
    const raw = localStorage.getItem("pageyu:local:pageyu_settings");
    saved = raw ? JSON.parse(raw) : {};
  }
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const field = form.elements[key];
    if (!field) continue;
    const next = settings[key];
    if (field.type === "checkbox") field.checked = Boolean(next);
    else field.value = next;
  }
  tempLabel.textContent = settings.temperature;
}

function readForm() {
  return {
    temperature: Number(form.temperature.value),
    includePageByDefault: form.includePageByDefault.checked,
    maxPageChars: Number(form.maxPageChars.value) || 12000,
    maxSitePages: Number(form.maxSitePages.value) || 10
  };
}

async function save(settings) {
  if (IS_EXTENSION) {
    const data = await chrome.storage.local.get("pageyu_settings");
    await chrome.storage.local.set({
      pageyu_settings: { ...(data.pageyu_settings || {}), ...settings }
    });
  } else {
    localStorage.setItem("pageyu:local:pageyu_settings", JSON.stringify(settings));
  }
}

form.temperature.addEventListener("input", () => {
  tempLabel.textContent = form.temperature.value;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await save(readForm());
  showStatus("Saved.", true);
});

load();
