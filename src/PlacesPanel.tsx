import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Bookmark, CalendarPlus, ExternalLink, LocateFixed, MapPin, RefreshCw, Star, Trash2 } from "lucide-react";
import { supabase } from "./lib/supabase";
import type { CouplePlace, DateIdea, HomePartner, PlaceKind, PlaceRating } from "./types";

type Language = "en" | "pt";
type PlacesCouple = { id: string; partner_one_name: string; partner_two_name: string; weather_latitude: number | null; weather_longitude: number | null; weather_location_name: string | null };

// Mirrors the shape returned by /api/places.
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

export type PlaceToPlan = { name: string; address: string; latitude: number | null; longitude: number | null; kind: PlaceKind; googlePlaceId: string };

const distances = [
  { km: 1.2, pt: "A pé", en: "Walking" },
  { km: 6, pt: "Até 15 min", en: "Up to 15 min" },
  { km: 20, pt: "Até 30 min", en: "Up to 30 min" },
];
const cuisines: Array<{ value: string; pt: string; en: string }> = [
  { value: "", pt: "Qualquer", en: "Any" },
  { value: "portuguesa", pt: "Portuguesa", en: "Portuguese" },
  { value: "petiscos", pt: "Petiscos", en: "Small plates" },
  { value: "italiana", pt: "Italiana", en: "Italian" },
  { value: "sushi", pt: "Sushi", en: "Sushi" },
  { value: "hambúrguer", pt: "Hambúrgueres", en: "Burgers" },
  { value: "vegetariana", pt: "Vegetariana", en: "Vegetarian" },
  { value: "indiana", pt: "Indiana", en: "Indian" },
];
const kinds: Array<{ value: PlaceKind; pt: string; en: string }> = [
  { value: "restaurant", pt: "Jantar", en: "Dinner" },
  { value: "cafe", pt: "Café / brunch", en: "Café / brunch" },
  { value: "bar", pt: "Bar", en: "Bar" },
];

function euros(level: number | null) {
  return level === null ? "" : level === 0 ? "€" : "€".repeat(level);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function callPlaces(body: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/places", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { error?: string; results?: PlaceResult[]; url?: string | null };
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

function Stars({ value, onChange, label }: { value: number; onChange?: (value: number) => void; label: string }) {
  return <span className="stars" role={onChange ? "radiogroup" : "img"} aria-label={`${label}: ${value} / 5`}>
    {[1, 2, 3, 4, 5].map((star) => onChange
      ? <button key={star} type="button" role="radio" aria-checked={value === star} aria-label={`${star}`} onClick={() => onChange(star)}><Star size={18} fill={star <= value ? "currentColor" : "none"} aria-hidden="true" /></button>
      : <Star key={star} size={15} fill={star <= value ? "currentColor" : "none"} aria-hidden="true" />)}
  </span>;
}

function PlanForm({ language, onPlan, busy }: { language: Language; onPlan: (date: string, time: string) => void; busy: boolean }) {
  const pt = language === "pt";
  const now = new Date();
  const choices = [
    { key: dateKey(now), label: pt ? "Hoje" : "Today" },
    { key: dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)), label: pt ? "Amanhã" : "Tomorrow" },
    { key: dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((6 - now.getDay() + 7) % 7 || 7))), label: pt ? "Sábado" : "Saturday" },
  ].filter((choice, index, all) => all.findIndex((other) => other.key === choice.key) === index);
  const [day, setDay] = useState(choices[choices.length - 1].key);
  const [time, setTime] = useState("20:00");
  return <form className="place-plan-form" onSubmit={(event) => { event.preventDefault(); if (day) onPlan(day, time); }}>
    <div className="chip-row">{choices.map((choice) => <button type="button" key={choice.key} className={`chip ${day === choice.key ? "selected" : ""}`} aria-pressed={day === choice.key} onClick={() => setDay(choice.key)}>{choice.label}</button>)}<input className="form-input" type="date" aria-label={pt ? "Outro dia" : "Another day"} value={day} min={dateKey(now)} onChange={(event) => setDay(event.target.value)} /></div>
    <div className="quick-add-row"><input className="form-input" type="time" aria-label={pt ? "Hora" : "Time"} value={time} onChange={(event) => setTime(event.target.value)} /><button className="button button-primary" type="submit" disabled={busy || !day}>{pt ? "Marcar date" : "Plan date"}</button></div>
  </form>;
}

export function PlacesPanel({ couple, mySlot, dates, language, busy, onPlan }: { couple: PlacesCouple; mySlot: HomePartner | null; dates: DateIdea[]; language: Language; busy: boolean; onPlan: (place: PlaceToPlan, placeId: string, date: string, time: string) => Promise<boolean> }) {
  const pt = language === "pt";
  const [places, setPlaces] = useState<CouplePlace[]>([]);
  const [ratings, setRatings] = useState<PlaceRating[]>([]);
  const [kind, setKind] = useState<PlaceKind>("restaurant");
  const [maxPrice, setMaxPrice] = useState(2);
  const [radiusKm, setRadiusKm] = useState(distances[1].km);
  const [cuisine, setCuisine] = useState("");
  const [openNow, setOpenNow] = useState(false);
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number; label: string } | null>(
    couple.weather_latitude !== null && couple.weather_longitude !== null
      ? { latitude: couple.weather_latitude, longitude: couple.weather_longitude, label: couple.weather_location_name ?? (pt ? "Localização do casal" : "Couple location") }
      : null);
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [planningId, setPlanningId] = useState<string | null>(null);
  const [savedTab, setSavedTab] = useState<"want" | "been">("want");
  const [ratingDraft, setRatingDraft] = useState<{ placeId: string; rating: number; comment: string } | null>(null);
  const partnerName = (slot: HomePartner) => slot === "partner_one" ? couple.partner_one_name : couple.partner_two_name;

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void Promise.all([
      supabase.from("couple_places").select("*").order("created_at"),
      supabase.from("place_ratings").select("*"),
    ]).then(([placeResult, ratingResult]) => {
      if (!active) return;
      const loadError = placeResult.error ?? ratingResult.error;
      if (loadError) setMessage(pt ? `Não foi possível carregar os vossos sítios. Confirmem que a migration dos sítios foi aplicada: ${loadError.message}` : `We couldn't load your places. Make sure the places migration has been applied: ${loadError.message}`);
      setPlaces((placeResult.data ?? []) as CouplePlace[]);
      setRatings((ratingResult.data ?? []) as PlaceRating[]);
    });
    return () => { active = false; };
  }, [couple.id, pt]);

  const visitedPlaceIds = useMemo(() => new Set([
    ...dates.filter((date) => date.status === "completed" && date.place_id).map((date) => date.place_id as string),
    ...ratings.map((rating) => rating.place_id),
  ]), [dates, ratings]);
  const savedByGoogleId = useMemo(() => new Map(places.map((place) => [place.google_place_id, place])), [places]);

  // Well rated and well known first; places you've already been to drop down the list.
  const ranked = useMemo(() => (results ?? [])
    .map((result) => {
      const saved = savedByGoogleId.get(result.googlePlaceId);
      const been = saved ? visitedPlaceIds.has(saved.id) : false;
      return { result, score: (result.rating ?? 3.6) * Math.log10(result.ratingCount + 10) - (been ? 3 : 0) - result.distanceKm * 0.08 };
    })
    .sort((first, second) => second.score - first.score)
    .map(({ result }) => result), [results, savedByGoogleId, visitedPlaceIds]);
  const shown = ranked.slice(offset, offset + 3);

  useEffect(() => {
    for (const result of shown) {
      if (!result.photoName || result.googlePlaceId in photos) continue;
      setPhotos((current) => ({ ...current, [result.googlePlaceId]: null }));
      void callPlaces({ action: "photo", photoName: result.photoName })
        .then((photo) => setPhotos((current) => ({ ...current, [result.googlePlaceId]: photo.url ?? null })))
        .catch(() => undefined);
    }
  }, [photos, shown]);

  function locateMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude, label: pt ? "Onde estou agora" : "Where I am now" }),
      () => setMessage(pt ? "Não foi possível obter a localização deste dispositivo." : "We couldn't get this device's location."),
      { enableHighAccuracy: false, timeout: 10000 });
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!origin) return;
    setSearching(true);
    setMessage("");
    try {
      const found = await callPlaces({ latitude: origin.latitude, longitude: origin.longitude, radiusKm, kind, maxPrice, cuisine, openNow, language });
      setResults(found.results ?? []);
      setOffset(0);
      if (!found.results?.length) setMessage(pt ? "Nada encontrado com estes filtros. Experimentem aumentar a distância ou o preço." : "Nothing found with these filters. Try a longer distance or higher price.");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setMessage(code === "not_configured"
        ? pt ? "A pesquisa de sítios ainda não está ligada: falta a chave do Google Maps no Vercel." : "Place search isn't connected yet: the Google Maps key is missing in Vercel."
        : pt ? `Não foi possível pesquisar sítios (${code}).` : `We couldn't search places (${code}).`);
    }
    setSearching(false);
  }

  function nextThree() {
    if (offset + 3 < ranked.length) setOffset(offset + 3);
    else {
      setResults((current) => current ? [...current].sort(() => Math.random() - 0.5) : current);
      setOffset(0);
    }
  }

  async function savePlace(result: PlaceResult) {
    const existing = savedByGoogleId.get(result.googlePlaceId);
    if (existing || !supabase) return existing ?? null;
    const { data, error } = await supabase.from("couple_places").insert({
      couple_id: couple.id,
      google_place_id: result.googlePlaceId,
      name: result.name,
      address: result.address,
      latitude: result.latitude,
      longitude: result.longitude,
      kind,
    }).select("*").single();
    if (error) {
      setMessage(pt ? `Não foi possível guardar o sítio: ${error.message}` : `We couldn't save the place: ${error.message}`);
      return null;
    }
    setPlaces((current) => [...current, data as CouplePlace]);
    return data as CouplePlace;
  }

  async function planAt(place: CouplePlace, date: string, time: string) {
    const planned = await onPlan({ name: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude, kind: place.kind, googlePlaceId: place.google_place_id }, place.id, date, time);
    if (planned) {
      setPlanningId(null);
      setMessage(pt ? `Date marcado em ${place.name}.` : `Date planned at ${place.name}.`);
    }
  }

  async function removePlace(place: CouplePlace) {
    if (!supabase) return;
    const { error } = await supabase.from("couple_places").delete().eq("id", place.id);
    if (error) setMessage(pt ? `Não foi possível remover: ${error.message}` : `We couldn't remove it: ${error.message}`);
    else setPlaces((current) => current.filter((item) => item.id !== place.id));
  }

  async function saveRating() {
    if (!supabase || !ratingDraft || !mySlot || ratingDraft.rating < 1) return;
    const { data, error } = await supabase.from("place_ratings").upsert({
      place_id: ratingDraft.placeId,
      partner_slot: mySlot,
      rating: ratingDraft.rating,
      comment: ratingDraft.comment.trim(),
      updated_at: new Date().toISOString(),
    }).select("*").single();
    if (error) {
      setMessage(pt ? `Não foi possível guardar a avaliação: ${error.message}` : `We couldn't save the rating: ${error.message}`);
      return;
    }
    setRatings((current) => [...current.filter((rating) => !(rating.place_id === ratingDraft.placeId && rating.partner_slot === mySlot)), data as PlaceRating]);
    setRatingDraft(null);
  }

  const savedList = places.filter((place) => savedTab === "been" ? visitedPlaceIds.has(place.id) : !visitedPlaceIds.has(place.id));
  const theForkUrl = (name: string, address: string) => `https://www.google.com/search?q=${encodeURIComponent(`${name} ${address.split(",").slice(-2).join(" ")} TheFork`)}`;

  return (
    <section className="places-page" aria-label={pt ? "Sítios" : "Places"}>
      <form className="panel places-finder" onSubmit={(event) => void search(event)}>
        <p className="panel-label">{pt ? "Encontrar um sítio" : "Find a place"}</p>
        <div className="chip-row" role="group" aria-label={pt ? "Tipo" : "Type"}>{kinds.map((item) => <button type="button" key={item.value} className={`chip ${kind === item.value ? "selected" : ""}`} aria-pressed={kind === item.value} onClick={() => setKind(item.value)}>{pt ? item.pt : item.en}</button>)}</div>
        <div className="finder-grid">
          <label className="form-label">{pt ? "Preço até" : "Price up to"}<select className="form-input" value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))}><option value={1}>€</option><option value={2}>€€</option><option value={3}>€€€</option><option value={4}>{pt ? "Qualquer" : "Any"}</option></select></label>
          <label className="form-label">{pt ? "Distância" : "Distance"}<select className="form-input" value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}>{distances.map((distance) => <option key={distance.km} value={distance.km}>{pt ? distance.pt : distance.en}</option>)}</select></label>
          {kind === "restaurant" && <label className="form-label">{pt ? "Cozinha" : "Cuisine"}<select className="form-input" value={cuisine} onChange={(event) => setCuisine(event.target.value)}>{cuisines.map((item) => <option key={item.value} value={item.value}>{pt ? item.pt : item.en}</option>)}</select></label>}
          <label className="finder-check"><input type="checkbox" checked={openNow} onChange={(event) => setOpenNow(event.target.checked)} />{pt ? "Aberto agora" : "Open now"}</label>
        </div>
        <div className="finder-origin"><MapPin size={16} aria-hidden="true" /><span>{origin ? origin.label : pt ? "Sem localização" : "No location"}</span><button type="button" className="button button-ghost" onClick={locateMe}><LocateFixed size={16} aria-hidden="true" />{pt ? "Usar onde estou" : "Use where I am"}</button></div>
        <button className="button button-primary" type="submit" disabled={searching || !origin}>{searching ? pt ? "A procurar…" : "Searching…" : pt ? "Dar-me 3 ideias" : "Give me 3 ideas"}</button>
      </form>

      {message && <p className="form-alert config-alert" role="status">{message}</p>}

      {shown.length > 0 && <section aria-label={pt ? "Sugestões" : "Suggestions"}>
        <div className="panel-heading places-results-heading"><h2>{pt ? "3 ideias para vocês" : "3 ideas for you"}</h2><button type="button" className="button button-secondary" onClick={nextThree}><RefreshCw size={16} aria-hidden="true" />{pt ? "Outras 3" : "Another 3"}</button></div>
        <div className="place-grid">
          {shown.map((result) => {
            const saved = savedByGoogleId.get(result.googlePlaceId);
            return <article className="place-card" key={result.googlePlaceId}>
              <div className="place-photo">{photos[result.googlePlaceId] ? <img src={photos[result.googlePlaceId] as string} alt="" loading="lazy" /> : <MapPin size={28} aria-hidden="true" />}</div>
              <div className="place-body">
                <h3>{result.name}</h3>
                <p className="place-facts">{result.rating !== null && <span className="place-rating"><Star size={14} fill="currentColor" aria-hidden="true" />{result.rating.toFixed(1)} <small>({result.ratingCount})</small></span>}{result.priceLevel !== null && <span>{euros(result.priceLevel)}</span>}<span>{result.distanceKm} km</span>{result.openNow !== null && <span className={result.openNow ? "open" : "closed"}>{result.openNow ? pt ? "Aberto" : "Open" : pt ? "Fechado" : "Closed"}</span>}</p>
                {result.typeLabel && <p className="place-type">{result.typeLabel}</p>}
                {saved && visitedPlaceIds.has(saved.id) && <p className="place-type">{pt ? "Já foram aqui" : "You've been here"}</p>}
                <div className="panel-actions">
                  <button type="button" className="button button-primary" onClick={() => setPlanningId(planningId === result.googlePlaceId ? null : result.googlePlaceId)}><CalendarPlus size={16} aria-hidden="true" />{pt ? "Marcar" : "Plan"}</button>
                  <button type="button" className="button button-secondary" disabled={Boolean(saved)} onClick={() => void savePlace(result)}><Bookmark size={16} fill={saved ? "currentColor" : "none"} aria-hidden="true" />{saved ? pt ? "Guardado" : "Saved" : pt ? "Guardar" : "Save"}</button>
                  <a className="button button-ghost" href={result.mapsUrl} target="_blank" rel="noopener noreferrer">Maps<ExternalLink size={14} aria-hidden="true" /></a>
                  {kind === "restaurant" && <a className="button button-ghost" href={theForkUrl(result.name, result.address)} target="_blank" rel="noopener noreferrer">TheFork<ExternalLink size={14} aria-hidden="true" /></a>}
                </div>
                {planningId === result.googlePlaceId && <PlanForm language={language} busy={busy} onPlan={(date, time) => void savePlace(result).then((place) => place && planAt(place, date, time))} />}
              </div>
            </article>;
          })}
        </div>
      </section>}

      <section className="panel saved-places" aria-label={pt ? "Os vossos sítios" : "Your places"}>
        <div className="panel-heading"><h2>{pt ? "Os vossos sítios" : "Your places"}</h2><div className="chip-row" role="tablist">{(["want", "been"] as const).map((tab) => <button type="button" role="tab" key={tab} aria-selected={savedTab === tab} className={`chip ${savedTab === tab ? "selected" : ""}`} onClick={() => setSavedTab(tab)}>{tab === "want" ? pt ? "Queremos ir" : "Want to go" : pt ? "Já fomos" : "Been there"}</button>)}</div></div>
        {savedList.length === 0 ? <p className="panel-copy">{savedTab === "want" ? pt ? "Guardem sítios a partir das sugestões para os terem aqui." : "Save places from the suggestions to keep them here." : pt ? "Quando fizerem um date num sítio guardado, ou o avaliarem, aparece aqui." : "Places appear here once you've had a date there or rated them."}</p> : <ul className="saved-place-list">
          {savedList.map((place) => {
            const placeRatings = ratings.filter((rating) => rating.place_id === place.id);
            const visits = dates.filter((date) => date.status === "completed" && date.place_id === place.id).length;
            const mine = placeRatings.find((rating) => rating.partner_slot === mySlot);
            return <li key={place.id}>
              <div className="saved-place-main">
                <div><strong>{place.name}</strong><small>{place.address}</small>{visits > 0 && <small>{pt ? `${visits} date${visits === 1 ? "" : "s"} aqui` : `${visits} date${visits === 1 ? "" : "s"} here`}</small>}</div>
                <div className="saved-place-actions">
                  <button type="button" className="icon-button" aria-label={pt ? "Marcar date aqui" : "Plan a date here"} onClick={() => setPlanningId(planningId === place.id ? null : place.id)}><CalendarPlus size={17} aria-hidden="true" /></button>
                  <a className="icon-button" aria-label={pt ? "Abrir no Google Maps" : "Open in Google Maps"} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.google_place_id)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} aria-hidden="true" /></a>
                  <button type="button" className="icon-button" aria-label={pt ? "Remover" : "Remove"} onClick={() => void removePlace(place)}><Trash2 size={17} aria-hidden="true" /></button>
                </div>
              </div>
              {placeRatings.length > 0 && <div className="saved-place-ratings">{placeRatings.map((rating) => <p key={rating.partner_slot}><span>{partnerName(rating.partner_slot)}</span><Stars value={rating.rating} label={partnerName(rating.partner_slot)} />{rating.comment && <em>“{rating.comment}”</em>}</p>)}</div>}
              {mySlot && (ratingDraft?.placeId === place.id
                ? <div className="rating-form"><Stars value={ratingDraft.rating} label={pt ? "A tua avaliação" : "Your rating"} onChange={(rating) => setRatingDraft({ ...ratingDraft, rating })} /><input className="form-input" maxLength={300} placeholder={pt ? "Comentário (opcional)" : "Comment (optional)"} value={ratingDraft.comment} onChange={(event) => setRatingDraft({ ...ratingDraft, comment: event.target.value })} /><button type="button" className="button button-primary" disabled={ratingDraft.rating < 1} onClick={() => void saveRating()}>{pt ? "Guardar" : "Save"}</button></div>
                : <button type="button" className="button button-ghost rate-button" onClick={() => setRatingDraft({ placeId: place.id, rating: mine?.rating ?? 0, comment: mine?.comment ?? "" })}><Star size={15} aria-hidden="true" />{mine ? pt ? "Mudar a tua avaliação" : "Change your rating" : pt ? "Avaliar" : "Rate"}</button>)}
              {planningId === place.id && <PlanForm language={language} busy={busy} onPlan={(date, time) => void planAt(place, date, time)} />}
            </li>;
          })}
        </ul>}
      </section>
    </section>
  );
}
