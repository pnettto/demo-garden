const entryList = document.getElementById("entry-list");
const modal = document.getElementById("modal");
const addBtn = document.getElementById("add-btn");
const cancelBtn = document.getElementById("cancel-btn");
const saveBtn = document.getElementById("save-btn");
const entryKeyInput = document.getElementById("entry-key");
const entryValueInput = document.getElementById("entry-value");
const modalTitle = document.getElementById("modal-title");

async function createHash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return hashHex;
}

let editingKey = null;
let currentEntries = [];

async function authFetch(url, options = {}) {
  const apiKey = localStorage.getItem("apiKey");
  const headers = {
    ...options.headers,
    "Authorization": `Bearer ${apiKey}`,
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    const password = prompt("Please enter your password:");
    if (password) {
      const hash = await createHash(password.trim());
      localStorage.setItem("apiKey", hash);
      return authFetch(url, options);
    }
  }
  return res;
}

async function fetchEntries() {
  const res = await authFetch("/kv/api/entries");
  const entries = await res.json();
  currentEntries = entries;
  renderEntries(entries);
}

function renderEntries(entries) {
  entryList.innerHTML = entries.map((entry, index) => `
        <div class="entry-card">
            <div class="entry-header">
                <span class="entry-key">${JSON.stringify(entry.key)}</span>
                <div class="entry-actions">
                    <button class="action-btn" onclick="editEntry(${index})">Edit</button>
                    <button class="action-btn delete" onclick="deleteEntry(${index})">Delete</button>
                </div>
            </div>
            <pre class="entry-value">${
    JSON.stringify(entry.value, null, 2)
  }</pre>
        </div>
    `).join("") ||
    '<p style="text-align: center; color: var(--text-secondary);">No entries found.</p>';
}

globalThis.editEntry = (index) => {
  const entry = currentEntries[index];
  const { key, value } = entry;

  editingKey = key;
  modalTitle.textContent = "Edit Entry";
  entryKeyInput.value = JSON.stringify(key);
  entryKeyInput.disabled = true;
  entryValueInput.value = JSON.stringify(value, null, 2);
  showModal();
};

globalThis.deleteEntry = async (index) => {
  const key = currentEntries[index].key;
  if (confirm(`Delete key ${JSON.stringify(key)}?`)) {
    await authFetch("/kv/api/entries", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    fetchEntries();
  }
};

function showModal() {
  modal.classList.remove("hidden");
}

function hideModal() {
  modal.classList.add("hidden");
  editingKey = null;
  modalTitle.textContent = "New Entry";
  entryKeyInput.value = "";
  entryKeyInput.disabled = false;
  entryValueInput.value = "";
}

addBtn.addEventListener("click", () => {
  hideModal();
  showModal();
});

cancelBtn.addEventListener("click", hideModal);

saveBtn.addEventListener("click", async () => {
  try {
    const key = JSON.parse(entryKeyInput.value);
    const value = JSON.parse(entryValueInput.value);

    if (!Array.isArray(key)) {
      alert('Key must be a JSON array, e.g. ["key"]');
      return;
    }

    const res = await authFetch("/kv/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });

    if (res.ok) {
      hideModal();
      fetchEntries();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to save entry");
    }
  } catch (e) {
    alert("Invalid JSON in key or value. Keys MUST be arrays.");
  }
});

// Initial load
fetchEntries();
