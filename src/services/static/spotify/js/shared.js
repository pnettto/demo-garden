/**
 * Shared logic for Spotify Client
 */

export const apiUrl = "https://spotify.pnettto.deno.net";

export async function apiFetch(url) {
  const res = await fetch(`${apiUrl}${url}`);
  if (!res.ok) {
    throw new Error(`HTTP error. Status: ${res.status}`);
  }
  const data = await res.json();
  return data;
}

export function openInSpotify(link) {
  if (!link) return;
  let uri = link;
  if (link.startsWith("http")) {
    uri = link.replace("https://open.spotify.com/", "spotify:").replace(
      /\//g,
      ":",
    );
  } else if (!link.startsWith("spotify:")) {
    uri = `spotify:track:${link}`;
  }
  globalThis.location.href = uri;
}

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.max(1, Math.floor(diff / 60000));
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  if (days > 0) return `${days}d ago`;
  if (hrs > 0) return `${hrs}h ago`;
  return `${mins}m ago`;
}

export function renderTracks(container, tracks, options = {}) {
  const { isHistory = false, append = false, isAlbum = false } = options;
  if (!append) container.innerHTML = "";

  const template = document.getElementById("album-card-template");

  tracks.forEach((track) => {
    if (!track) return;
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".album-card");
    const img = clone.querySelector("img");

    img.src = track.cover || track.album?.images?.[0]?.url ||
      "https://via.placeholder.com/300?text=No+Cover";
    clone.querySelector(".album-name").textContent = track.name;

    let sub = track.artist || track.artists?.map((a) => a.name).join(", ");
    if (isHistory && track.timestamp) sub += ` • ${timeAgo(track.timestamp)}`;
    clone.querySelector(".album-artist").textContent = sub;

    if (isAlbum || (isHistory && track.genres?.length)) {
      if (isAlbum) {
        clone.querySelector(".album-year").textContent = track.year;
      }
      clone.querySelector(".genre-list").textContent =
        track.genres?.join(", ") || "No words could ever describe this 🦄";

      card.onclick = (e) => {
        if (e.target.matches(".genre-toggle")) {
          e.preventDefault();
          card.querySelector(".genre-list").classList.toggle("is-visible");
        } else if (e.target.matches("img")) {
          openInSpotify(track.uri || track.link);
        }
      };
    } else {
      clone.querySelector(".album-meta-row")?.remove();
      card.onclick = () =>
        openInSpotify(track.link || track.uri || track.external_urls?.spotify);
    }

    container.appendChild(clone);
  });
}

export async function updateNowPlaying() {
  const banner = document.getElementById("now-playing");
  if (!banner) return;
  try {
    const data = await apiFetch("/api/history");

    if (data.playing) {
      document.getElementById("now-playing-cover").src = data.cover;
      document.getElementById("now-playing-name").textContent = data.name;
      document.getElementById("now-playing-artist").textContent = data.artist;
      banner.style.display = "block";
      banner.onclick = () => openInSpotify(data.link || data.uri);
    } else {
      banner.style.display = "none";
      banner.onclick = null;
    }
  } catch (_e) {
    banner.style.display = "none";
  }
}

export function initNav() {
  const path = globalThis.location.pathname;
  document.querySelectorAll(".nav-link").forEach((link) => {
    // Basic path matching
    const linkPath = link.getAttribute("href");
    const isAlbums =
      (path === "/" || path === "/albums" || path.startsWith("/albums/")) &&
      linkPath === "/albums";
    if (path === linkPath || isAlbums) {
      link.classList.add("active");
    }
  });
}
