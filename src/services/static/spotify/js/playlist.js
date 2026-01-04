import { apiFetch, initNav, renderTracks, updateNowPlaying } from "./shared.js";

async function fetchPlaylistTracks() {
  const playlistId = new URLSearchParams(globalThis.location.search).get("id");
  if (!playlistId) return (globalThis.location.href = "/playlists");

  const container = document.getElementById("playlist-tracks");
  const nameEl = document.getElementById("current-playlist-name");

  try {
    const { items = [] } = await apiFetch(
      `/api/playlists/${playlistId}/tracks`,
    );

    // Attempt to get name from API or just use placeholder
    nameEl.textContent = "Playlist Details";

    renderTracks(container, items.map((i) => i.track), { isGrid: true });
  } catch (e) {
    console.error("Tracks failed", e);
    nameEl.textContent = "Error loading playlist";
  }
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  fetchPlaylistTracks();
  updateNowPlaying();
  setInterval(updateNowPlaying, 30000); // 30s
});

document.getElementById("back-to-playlists").onclick = () => {
  globalThis.location.href = "/playlists";
};
