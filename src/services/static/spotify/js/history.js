import { apiFetch, initNav, renderTracks, updateNowPlaying } from "./shared.js";

let allHistory = [];
let historyCursor = null;
let searchTimeout;

async function fetchHistory() {
  const container = document.getElementById("history-list");
  const loadMoreBtn = document.getElementById("load-more-history");

  try {
    let url = "/api/history?limit=50";
    if (historyCursor) url += `&cursor=${encodeURIComponent(historyCursor)}`;
    const { history = [], nextCursor } = await apiFetch(url);

    const isAppending = !!historyCursor;
    allHistory = isAppending ? [...allHistory, ...history] : history;
    historyCursor = nextCursor;

    if (document.getElementById("history-search").value) {
      renderFilteredHistory();
    } else {
      renderTracks(container, history, {
        isGrid: true,
        isHistory: true,
        append: isAppending,
      });
    }
    loadMoreBtn.style.display = historyCursor ? "block" : "none";
  } catch (e) {
    console.error("History failed", e);
  }
}

function renderFilteredHistory() {
  const query = document.getElementById("history-search").value.toLowerCase();
  const container = document.getElementById("history-list");
  const loadMoreBtn = document.getElementById("load-more-history");

  if (!query) {
    container.innerHTML = "";
    renderTracks(container, allHistory, { isGrid: true, isHistory: true });
    loadMoreBtn.style.display = historyCursor ? "block" : "none";
    return;
  }

  let searchPattern = query.toLowerCase().replace(/'/gi, "");
  searchPattern = searchPattern
    .replace(/a/gi, "[aàáâãäåæāăąǎǟǡǻȁȃȧ]")
    .replace(/e/gi, "[eèéêëēĕėęěȅȇȩ]")
    .replace(/i/gi, "[iìíîïĩīĭįǐȉȋ]")
    .replace(/o/gi, "[oòóôõöøōŏőœơǒǫǭȍȏȫȭȯȱ]")
    .replace(/u/gi, "[uùúûüũūŭůűųưǔǖǘǚǜȕȗ]");

  const searchRegex = new RegExp(searchPattern, "i");

  const filtered = allHistory.filter((item) => {
    const songName = (item.name || "").toLowerCase().replace(/'/gi, "");
    const artistName = (item.artist || "").toLowerCase().replace(/'/gi, "");
    const albumName = (item.album || "").toLowerCase().replace(/'/gi, "");
    const genres = (item.genres || []).join(" ").toLowerCase().replace(
      /'/gi,
      "",
    );

    return searchRegex.test(songName) ||
      searchRegex.test(artistName) ||
      searchRegex.test(albumName) ||
      searchRegex.test(genres);
  });

  renderTracks(container, filtered, { isGrid: true, isHistory: true });
  loadMoreBtn.style.display = "none";
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  // Listeners
  document.getElementById("load-more-history").onclick = fetchHistory;
  const searchEl = document.getElementById("history-search");
  searchEl.onchange = renderFilteredHistory;
  searchEl.oninput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(renderFilteredHistory, 500);
  };

  initNav();
  fetchHistory();
  updateNowPlaying();
  setInterval(updateNowPlaying, 30000); // 30s
});
