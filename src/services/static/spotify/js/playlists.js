import { apiFetch, initNav, updateNowPlaying } from "./shared.js";

async function fetchPlaylists() {
  try {
    const { items = [] } = await apiFetch("/api/playlists");
    renderPlaylists(items);
  } catch (e) {
    console.error("Playlists failed", e);
  }
}

function renderPlaylists(items) {
  const grid = document.getElementById("playlists-grid");
  const template = document.getElementById("playlist-card-template");
  grid.innerHTML = "";

  items.forEach((playlist) => {
    const clone = template.content.cloneNode(true);
    clone.querySelector("img").src = playlist.images?.[0]?.url || "";
    clone.querySelector(".playlist-name").textContent = playlist.name;
    clone.querySelector(".playlist-card").onclick = () => {
      globalThis.location.href = `playlist?id=${playlist.id}`;
    };
    grid.appendChild(clone);
  });
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  fetchPlaylists();
  updateNowPlaying();
  setInterval(updateNowPlaying, 30000); // 30s
});
