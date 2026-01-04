import { Hono } from "hono";
import { cors } from "hono/cors";
import "@std/dotenv/load";

/**
 * Configuration & Constants
 */
const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");
const REDIRECT_URI = Deno.env.get("SPOTIFY_REDIRECT_URI");

const REFRESH_TOKEN_KEY = ["auth", "refresh_token"];
const ALBUMS_CHUNK_PREFIX = ["albums_v4"];
const CHUNK_SIZE = 50;

const app = new Hono();
// Handle api CORS
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

const kv = Deno.env.get("DENO_DEPLOYMENT_ID")
  ? await Deno.openKv() // Deno Deploy
  : await Deno.openKv("./db/kv.db"); // Docker

console.log(`\nServer started at ${REDIRECT_URI?.replace("/callback", "")}`);
console.log(`Spotify Redirect URI: ${REDIRECT_URI}\n`);

/**
 * Types & Interfaces
 */
interface Album {
  name: string;
  artist: string;
  year: string;
  full_date: string;
  cover: string;
  link: string;
  uri: string;
  genres: string[];
  popularity: number;
  added_at: string;
}

interface SpotifyAlbumItem {
  added_at: string;
  album: {
    name: string;
    artists: { id: string; name: string }[];
    release_date: string;
    images: { url: string }[];
    external_urls: { spotify: string };
    uri: string;
    popularity: number;
  };
}

interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
}

/**
 * Helper Functions
 */
async function getAccessTokenFromRefresh() {
  const res = await kv.get<string>(REFRESH_TOKEN_KEY);
  if (!res.value) return null;
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: res.value,
    }),
  });
  const data = await response.json();
  return data.access_token;
}

async function getCachedAlbums(limit?: number): Promise<Album[]> {
  const iter = kv.list<Album[]>({ prefix: ALBUMS_CHUNK_PREFIX });
  const all: Album[] = [];
  for await (const entry of iter) {
    all.push(...entry.value);
    if (limit && all.length >= limit) break;
  }
  return limit ? all.slice(0, limit) : all;
}

async function saveCachedAlbums(albums: Album[]) {
  // Clear old version
  const old = kv.list({ prefix: ALBUMS_CHUNK_PREFIX });
  for await (const entry of old) await kv.delete(entry.key);

  // Split into 50-item chunks to perfectly preserve Spotify's order in KV
  for (let i = 0; i < albums.length; i += CHUNK_SIZE) {
    const chunk = albums.slice(i, i + CHUNK_SIZE);
    const index = String(Math.floor(i / CHUNK_SIZE)).padStart(4, "0"); // 0000, 00001, etc
    await kv.set([...ALBUMS_CHUNK_PREFIX, index], chunk);
  }
}

async function isCacheFresh(token: string) {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/albums?limit=10", {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    const batch = data.items || [];
    const cached = await getCachedAlbums(10);

    if (batch.length === 0 || cached.length === 0) return false;

    // Strict order check to detect moves (e.g. pos 9 to 1)
    return batch.every((item: SpotifyAlbumItem, idx: number) =>
      item.album.uri === cached[idx]?.uri
    );
  } catch {
    return false;
  }
}

async function syncLibrary(token: string) {
  console.log("Sync: Identifying library changes...");
  let all: Album[] = [];
  let nextUrl: string | null = "https://api.spotify.com/v1/me/albums?limit=50";
  let isFirstPass = true;
  const cached = await getCachedAlbums();

  while (nextUrl) {
    const resp = await fetch(nextUrl, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!resp.ok) break;
    const data: { items: SpotifyAlbumItem[]; next: string | null } = await resp
      .json();
    if (!data.items) break;

    const artistIds = [...new Set(data.items.map((i) => i.album.artists[0].id))]
      .filter((id) => !!id)
      .join(",");
    const genreMap: Record<string, string[]> = {};

    if (artistIds) {
      const artRes = await fetch(
        `https://api.spotify.com/v1/artists?ids=${artistIds}`,
        {
          headers: { "Authorization": `Bearer ${token}` },
        },
      );
      if (artRes.ok) {
        const artData: { artists: SpotifyArtist[] } = await artRes.json();
        artData.artists.forEach((a) => genreMap[a.id] = a.genres || []);
      }
    }

    const items: Album[] = data.items.map((i: SpotifyAlbumItem) => ({
      name: i.album.name,
      artist: i.album.artists.map((a) => a.name).join(", "),
      year: i.album.release_date.split("-")[0],
      full_date: i.album.release_date,
      cover: i.album.images[0]?.url || "",
      link: i.album.external_urls.spotify,
      uri: i.album.uri,
      genres: genreMap[i.album.artists[0].id] || [],
      popularity: i.album.popularity || 0,
      added_at: i.added_at,
    }));

    // Incremental Sync logic: find exactly where new items meet old cache
    if (isFirstPass && cached.length > 0) {
      const MATCH_WINDOW = 10;
      for (let i = 0; i <= items.length - MATCH_WINDOW; i++) {
        const slice = items.slice(i, i + MATCH_WINDOW);
        const overlapIndex = cached.findIndex((c) => c.uri === slice[0].uri);

        if (overlapIndex !== -1) {
          const target = cached.slice(
            overlapIndex,
            overlapIndex + MATCH_WINDOW,
          );
          if (
            target.length === MATCH_WINDOW &&
            slice.every((s, idx) => s.uri === target[idx].uri)
          ) {
            console.log(
              `Incremental sync: Merging at Spotify index ${i} -> Cache index ${overlapIndex}`,
            );
            const newLead = items.slice(0, i);
            const dedupedOld = cached.filter((c) =>
              !newLead.some((n) => n.uri === c.uri)
            );
            all = [...newLead, ...dedupedOld];
            nextUrl = null;
            break;
          }
        }
      }
    }

    isFirstPass = false;

    if (nextUrl) {
      console.log(`Downloading page: ${nextUrl}`);
      all = [...all, ...items];
      nextUrl = data.next;
    }
  }

  await saveCachedAlbums(all);
  return { status: "updated", count: all.length };
}

/**
 * Routes
 */
app.get("/login", (c) => {
  const scope =
    "user-library-read user-read-currently-playing playlist-read-private playlist-read-collaborative";
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("client_id", CLIENT_ID!);
  authUrl.searchParams.append("scope", scope);
  authUrl.searchParams.append("redirect_uri", REDIRECT_URI!);
  authUrl.searchParams.append("show_dialog", "true");
  return c.redirect(authUrl.toString());
});

app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code || "",
      redirect_uri: REDIRECT_URI!,
    }),
  });
  const data = await response.json();
  if (data.refresh_token) {
    await kv.set(REFRESH_TOKEN_KEY, data.refresh_token);
    return c.redirect("/");
  }
  return c.text("Authentication failed", 400);
});

app.get("/api/auth/status", async (c) => {
  const res = await kv.get(REFRESH_TOKEN_KEY);
  return c.json({ authenticated: !!res.value });
});

app.get("/api/albums", async (c) => {
  const albums = await getCachedAlbums();
  return c.json({ albums });
});

app.get("/api/sync", async (c) => {
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  if (await isCacheFresh(token) && c.req.query("force") === undefined) {
    return c.json({ status: "fresh" });
  }

  const result = await syncLibrary(token);
  return c.json({ ...result, albums: await getCachedAlbums() });
});

app.get("/api/now-playing", async (c) => {
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ playing: false });
  try {
    const res = await fetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      {
        headers: { "Authorization": `Bearer ${token}` },
      },
    );
    if (res.status === 204 || res.status > 400) {
      return c.json({ playing: false });
    }
    const data = await res.json();
    if (!data.item) return c.json({ playing: false });

    const artistIds = data.item.artists.map((a: SpotifyArtist) => a.id).join(
      ",",
    );
    let genres: string[] = [];
    if (artistIds) {
      const artRes = await fetch(
        `https://api.spotify.com/v1/artists?ids=${artistIds}`,
        { headers: { "Authorization": `Bearer ${token}` } },
      );
      if (artRes.ok) {
        const artData: { artists: SpotifyArtist[] } = await artRes.json();
        genres = [
          ...new Set(artData.artists.flatMap((a) => a.genres || [])),
        ] as string[];
      }
    }

    const currentTrack = {
      name: data.item.name,
      artist: data.item.artists.map((a: SpotifyArtist) => a.name).join(", "),
      album: data.item.album.name,
      cover: data.item.album.images[0]?.url || "",
      link: data.item.external_urls.spotify,
      uri: data.item.uri,
      timestamp: Date.now(),
      genres,
    };

    const lastKey = ["listening_history", "latest"];
    const lastEntry = await kv.get<{ name: string; artist: string }>(lastKey);

    if (
      !lastEntry.value || lastEntry.value.name !== currentTrack.name ||
      lastEntry.value.artist !== currentTrack.artist
    ) {
      await kv.set(["listening_history", currentTrack.timestamp], currentTrack);
      await kv.set(lastKey, currentTrack);
    }
    return c.json({ playing: true, ...currentTrack });
  } catch {
    return c.json({ playing: false });
  }
});

app.get("/api/history/all", async (c) => {
  const iter = kv.list({ prefix: ["listening_history"] }, {
    reverse: true,
  });
  const history = [];
  for await (const entry of iter) {
    if (entry.key[1] !== "latest") history.push(entry.value);
  }
  return c.json({ history });
});

app.get("/api/history", async (c) => {
  const limit = parseInt(c.req.query("limit") || "6");
  const cursor = c.req.query("cursor");
  const iter = kv.list({ prefix: ["listening_history"] }, {
    reverse: true,
    limit,
    cursor,
  });
  const history = [];
  for await (const entry of iter) {
    if (entry.key[1] !== "latest") history.push(entry.value);
  }
  return c.json({ history, nextCursor: iter.cursor || null });
});

app.get("/api/playlists", async (c) => {
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const res = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
    headers: { "Authorization": `Bearer ${token}` },
  });
  return c.json(await res.json());
});

app.get("/api/playlists/:id/tracks", async (c) => {
  const id = c.req.param("id");
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const res = await fetch(
    `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`,
    {
      headers: { "Authorization": `Bearer ${token}` },
    },
  );
  return c.json(await res.json());
});

// KV Admin
import { registerKvRoutes } from "./kv/main.ts";
registerKvRoutes(app);

Deno.serve({ port: 8000 }, app.fetch);
