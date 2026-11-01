// Searches Google Places for restaurants, cafés and bars near the couple. The Google key
// stays on the server; only signed-in Nossia users can call this, so the quota is not open
// to the world.

declare const process: { env: Record<string, string | undefined> };

export type PlaceKind = "restaurant" | "cafe" | "bar";

export type PlaceResult = {
  googlePlaceId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number | null;
  ratingCount: number;
  priceLevel: number | null;
  openNow: boolean | null;
  mapsUrl: string;
  photoName: string | null;
  typeLabel: string | null;
  distanceKm: number;
};

type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  currentOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
  photos?: Array<{ name: string }>;
  primaryTypeDisplayName?: { text: string };
};

const priceLevels = ["PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"];
const kindQuery: Record<PlaceKind, { type: string; pt: string; en: string }> = {
  restaurant: { type: "restaurant", pt: "restaurante", en: "restaurant" },
  cafe: { type: "cafe", pt: "café brunch", en: "café brunch" },
  bar: { type: "bar", pt: "bar", en: "bar" },
};

export function distanceKm(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(toLatitude - fromLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(fromLatitude)) * Math.cos(radians(toLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function toPlaceResult(place: GooglePlace, fromLatitude: number, fromLongitude: number): PlaceResult | null {
  if (!place.location || !place.displayName) return null;
  const level = place.priceLevel ? priceLevels.indexOf(place.priceLevel) : -1;
  return {
    googlePlaceId: place.id,
    name: place.displayName.text,
    address: place.formattedAddress ?? "",
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    rating: place.rating ?? null,
    ratingCount: place.userRatingCount ?? 0,
    priceLevel: level >= 0 ? level : null,
    openNow: place.currentOpeningHours?.openNow ?? null,
    mapsUrl: place.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}&query=${encodeURIComponent(place.displayName.text)}`,
    photoName: place.photos?.[0]?.name ?? null,
    typeLabel: place.primaryTypeDisplayName?.text ?? null,
    distanceKm: Math.round(distanceKm(fromLatitude, fromLongitude, place.location.latitude, place.location.longitude) * 10) / 10,
  };
}

async function signedIn(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");
  if (!supabaseUrl || !anonKey || !authorization?.startsWith("Bearer ")) return false;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
  return response.ok;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return json({ error: "not_configured" }, 503);
  if (!await signedIn(request)) return json({ error: "unauthorized" }, 401);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "bad_request" }, 400);

  if (body.action === "photo") {
    const photoName = typeof body.photoName === "string" && /^places\/[\w-]+\/photos\/[\w-]+$/.test(body.photoName) ? body.photoName : null;
    if (!photoName) return json({ error: "bad_request" }, 400);
    const response = await fetch(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=480&skipHttpRedirect=true`, { headers: { "X-Goog-Api-Key": apiKey } });
    if (!response.ok) return json({ error: "google_error" }, 502);
    const photo = await response.json() as { photoUri?: string };
    return json({ url: photo.photoUri ?? null });
  }

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const radiusKm = Math.min(Math.max(Number(body.radiusKm) || 5, 0.5), 30);
  const kind: PlaceKind = body.kind === "cafe" || body.kind === "bar" ? body.kind : "restaurant";
  const language = body.language === "en" ? "en" : "pt";
  const maxPrice = Math.min(Math.max(Number(body.maxPrice) || 4, 1), 4);
  const cuisine = typeof body.cuisine === "string" ? body.cuisine.trim().slice(0, 60) : "";
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return json({ error: "bad_request" }, 400);

  const query = kindQuery[kind];
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours.openNow,places.googleMapsUri,places.photos,places.primaryTypeDisplayName",
    },
    body: JSON.stringify({
      textQuery: [cuisine, query[language]].filter(Boolean).join(" "),
      includedType: query.type,
      languageCode: language === "pt" ? "pt-PT" : "en",
      regionCode: "PT",
      pageSize: 20,
      openNow: body.openNow === true,
      // Places without a known price would be dropped by the filter, so only filter when capped.
      ...(maxPrice < 4 ? { priceLevels: priceLevels.slice(1, maxPrice + 1) } : {}),
      locationBias: { circle: { center: { latitude, longitude }, radius: radiusKm * 1000 } },
    }),
  });
  if (!response.ok) return json({ error: "google_error", detail: (await response.text()).slice(0, 300) }, 502);
  const data = await response.json() as { places?: GooglePlace[] };
  const results = (data.places ?? [])
    .map((place) => toPlaceResult(place, latitude, longitude))
    .filter((place): place is PlaceResult => place !== null && place.distanceKm <= radiusKm);
  return json({ results });
}
