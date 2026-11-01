// Private calendar feed that phones subscribe to (webcal://…/api/calendar?token=…).
// Calendar apps cannot sign in, so the secret token is checked by the calendar_feed
// database function, which returns only that partner's couple data.

declare const process: { env: Record<string, string | undefined> };

type Language = "en" | "pt";
type PartnerSlot = "partner_one" | "partner_two";

export type CalendarFeed = {
  partner_slot: PartnerSlot;
  couple: {
    id: string;
    partner_one_name: string;
    partner_two_name: string;
    partner_one_birth_date: string | null;
    partner_two_birth_date: string | null;
    relationship_date: string;
  };
  dates: Array<{
    id: string;
    title: string;
    description: string;
    emoji: string;
    planned_for: string;
    planned_start_time: string | null;
    duration_minutes: number | null;
    location_name: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    notes: string;
    due_date: string;
    due_time: string | null;
    assigned_to: PartnerSlot | null;
  }>;
};

const timeZone = "Europe/Lisbon";
const lisbonTimeZone = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Lisbon",
  "BEGIN:STANDARD",
  "DTSTART:19701025T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0000",
  "TZNAME:WET",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T010000",
  "TZOFFSETFROM:+0000",
  "TZOFFSETTO:+0100",
  "TZNAME:WEST",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

// RFC 5545 lines are at most 75 octets; longer ones continue on lines starting with a space.
function foldLine(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (currentBytes + bytes > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function compactDate(date: string) {
  return date.replace(/-/g, "");
}

// Adds minutes to a local date and time without involving the server's time zone.
function localDateTime(date: string, time: string, addMinutes = 0) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, hours, minutes + addMinutes));
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}00`;
}

function nextDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function event(fields: { uid: string; stamp: string; summary: string; date: string; time?: string | null; durationMinutes?: number; description?: string; location?: string | null; yearly?: boolean }) {
  const lines = ["BEGIN:VEVENT", `UID:${fields.uid}@nossia.app`, `DTSTAMP:${fields.stamp}`, `SUMMARY:${escapeText(fields.summary)}`];
  if (fields.time) {
    lines.push(`DTSTART;TZID=${timeZone}:${localDateTime(fields.date, fields.time)}`);
    lines.push(`DTEND;TZID=${timeZone}:${localDateTime(fields.date, fields.time, fields.durationMinutes ?? 60)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(fields.date)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(nextDay(fields.date))}`);
    lines.push("TRANSP:TRANSPARENT");
  }
  if (fields.yearly) lines.push("RRULE:FREQ=YEARLY");
  if (fields.description) lines.push(`DESCRIPTION:${escapeText(fields.description)}`);
  if (fields.location) lines.push(`LOCATION:${escapeText(fields.location)}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(feed: CalendarFeed, language: Language, now = new Date()) {
  const pt = language === "pt";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const { couple } = feed;
  const partnerName = (slot: PartnerSlot) => slot === "partner_one" ? couple.partner_one_name : couple.partner_two_name;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nossia//Couple calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Nossia · ${couple.partner_one_name} & ${couple.partner_two_name}`)}`,
    `X-WR-TIMEZONE:${timeZone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...lisbonTimeZone,
  ];

  for (const date of feed.dates) {
    lines.push(...event({
      uid: `date-${date.id}`,
      stamp,
      summary: `${date.emoji} ${date.title}`,
      date: date.planned_for,
      time: date.planned_start_time,
      durationMinutes: date.duration_minutes ?? 120,
      description: date.description,
      location: date.location_name,
    }));
  }

  for (const task of feed.tasks) {
    const owner = task.assigned_to ? partnerName(task.assigned_to) : pt ? "os dois" : "both of you";
    lines.push(...event({
      uid: `task-${task.id}`,
      stamp,
      summary: `📝 ${task.title}`,
      date: task.due_date,
      time: task.due_time,
      durationMinutes: 30,
      description: [pt ? `Tarefa para ${owner}` : `Task for ${owner}`, task.notes].filter(Boolean).join("\n\n"),
    }));
  }

  lines.push(...event({
    uid: `anniversary-${couple.id}`,
    stamp,
    summary: pt ? `💞 Aniversário de ${couple.partner_one_name} & ${couple.partner_two_name}` : `💞 ${couple.partner_one_name} & ${couple.partner_two_name}'s anniversary`,
    date: couple.relationship_date,
    yearly: true,
  }));
  for (const slot of ["partner_one", "partner_two"] as const) {
    const birthDate = slot === "partner_one" ? couple.partner_one_birth_date : couple.partner_two_birth_date;
    if (!birthDate) continue;
    lines.push(...event({
      uid: `birthday-${slot}-${couple.id}`,
      stamp,
      summary: pt ? `🎂 Anos de ${partnerName(slot)}` : `🎂 ${partnerName(slot)}'s birthday`,
      date: birthDate,
      yearly: true,
    }));
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const language: Language = url.searchParams.get("lang") === "en" ? "en" : "pt";
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Not found", { status: 404 });

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return new Response("Calendar feed is not configured", { status: 500 });

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/calendar_feed`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ feed_token: token }),
  });
  if (!response.ok) return new Response("Calendar feed is unavailable", { status: 502 });
  const feed = await response.json() as CalendarFeed | null;
  if (!feed) return new Response("Not found", { status: 404 });

  return new Response(buildCalendar(feed, language), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="nossia.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
