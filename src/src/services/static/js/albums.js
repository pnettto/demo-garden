import { apiFetch, initNav, renderTracks, updateNowPlaying } from "./shared.js";

let allAlbums = [];
let isSyncing = false;
let searchTimeout;

async function fetchAlbums() {
  try {
    const data = await apiFetch("/api/albums");
    console.log(`data`, data);
    allAlbums = data.albums || [];

    if (allAlbums.length > 0) {
      populateGenreFilter(allAlbums);
      renderFilteredAlbums();
    } else {
      document.getElementById("albums-grid").innerHTML =
        '<div class="empty-state">No records found. Perform a sync.</div>';
    }
  } catch (e) {
    console.error("Album fetch failed", e);
  }
}

async function syncVault() {
  if (isSyncing) return;

  const syncBtn = document.getElementById("sync-vault-btn");
  const syncStatus = document.getElementById("sync-status");

  isSyncing = true;
  syncBtn.disabled = true;
  syncBtn.textContent = "Scanning Archive...";
  syncStatus.style.display = "flex";

  try {
    const data = await apiFetch("/api/sync");
    if (data.status !== "fresh") {
      allAlbums = data.albums || [];
      populateGenreFilter(allAlbums);
      renderFilteredAlbums();
    }
  } catch (e) {
    console.error("Sync failed", e);
  } finally {
    isSyncing = false;
    syncStatus.style.display = "none";
    syncBtn.disabled = false;
    syncBtn.textContent = "Sync collection";
  }
}

function renderFilteredAlbums() {
  const query = document.getElementById("search-input").value.toLowerCase();
  const decade = document.getElementById("decade-filter").value;
  const genre = document.getElementById("genre-filter").value;
  const sort = document.getElementById("sort-select").value;

  const pathParts = globalThis.location.pathname.split("/");
  const targetId = pathParts[2];

  const filtered = allAlbums.filter((album) => {
    // Deep link override
    if (targetId) {
      return album.id === targetId || album.uri === targetId;
    }
    let searchPattern = query.toLowerCase().replace(/'/gi, "");
    searchPattern = searchPattern
      .replace(/a/gi, "[aàáâãäåæāăąǎǟǡǻȁȃȧ]")
      .replace(/e/gi, "[eèéêëēĕėęěȅȇȩ]")
      .replace(/i/gi, "[iìíîïĩīĭįǐȉȋ]")
      .replace(/o/gi, "[oòóôõöøōŏőœơǒǫǭȍȏȫȭȯȱ]")
      .replace(/u/gi, "[uùúûüũūŭůűųưǔǖǘǚǜȕȗ]");

    const searchRegex = new RegExp(searchPattern, "i");
    const matchesSearch = !query ||
      searchRegex.test(album.name.toLowerCase().replace(/'/gi, "")) ||
      searchRegex.test(album.artist.toLowerCase().replace(/'/gi, "")) ||
      searchRegex.test(album.year.toLowerCase().replace(/'/gi, "")) ||
      (album.genres &&
        album.genres.some((g) =>
          searchRegex.test(g.toLowerCase().replace(/'/gi, ""))
        ));

    let matchesDecade = true;
    if (decade !== "all") {
      const year = parseInt(album.year);
      if (decade === "older") matchesDecade = year < 1970;
      else {
        matchesDecade = year >= parseInt(decade) &&
          year < parseInt(decade) + 10;
      }
    }

    const matchesGenre = genre === "all" ||
      (album.genres && album.genres.includes(genre));
    return matchesSearch && matchesDecade && matchesGenre;
  });

  filtered.sort((a, b) => {
    switch (sort) {
      case "date-asc":
        return new Date(a.full_date) - new Date(b.full_date);
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "artist-asc":
        return a.artist.localeCompare(b.artist);
      case "popularity":
        return b.popularity - a.popularity;
      default:
        return 0;
    }
  });

  renderTracks(document.getElementById("albums-grid"), filtered, {
    isAlbum: true,
  });
  document.getElementById("album-count").textContent = filtered.length;
}

function populateGenreFilter(albums) {
  const select = document.getElementById("genre-filter");
  const genres = [...new Set(albums.flatMap((a) => a.genres || []))].sort();
  select.innerHTML = '<option value="all">All Genres</option>' +
    genres.map((g) =>
      `<option value="${g}">${g.charAt(0).toUpperCase() + g.slice(1)}</option>`
    ).join("");
}

// Init
initNav();
fetchAlbums();
setTimeout(syncVault, 500);
updateNowPlaying();
setInterval(updateNowPlaying, 30000); // 30s

// Listeners
document.getElementById("sync-vault-btn").onclick = syncVault;
["search-input", "decade-filter", "genre-filter", "sort-select"].forEach(
  (id) => {
    const el = document.getElementById(id);
    el.onchange = renderFilteredAlbums;
    if (id === "search-input") {
      el.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(renderFilteredAlbums, 300);
      };
    }
  },
);
globalThis.onpopstate = () => {
  renderFilteredAlbums();
  initNav();
};

globalThis.addEventListener("beforeunload", (e) => {
  if (isSyncing) {
    e.preventDefault();
    return (e.returnValue = "");
  }
});
