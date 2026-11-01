import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowRight, CalendarDays, Check, Clock, MapPin, Shuffle, UtensilsCrossed } from "lucide-react";
import type { DateIdea } from "./types";
import { describeWindows } from "./SchedulePanel";
import type { sharedFreeDays } from "./SchedulePanel";

type Language = "en" | "pt";
type FreeDay = ReturnType<typeof sharedFreeDays>[number];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shortDay(key: string, language: Language) {
  return new Intl.DateTimeFormat(language === "pt" ? "pt-PT" : "en-GB", { weekday: "long", day: "numeric", month: "short" }).format(new Date(`${key}T12:00:00`));
}

export function TodayView({
  language,
  upcomingDates,
  overdueCount,
  freeDays,
  hasSchedule,
  suggestion,
  busy,
  anniversary,
  birthdays,
  companion,
  weather,
  onQuickAdd,
  onPlanSuggestion,
  onAnotherSuggestion,
  onMarkDone,
  onOpenIdeas,
  onOpenPlanned,
  onOpenAgenda,
  onOpenPlaces,
}: {
  language: Language;
  upcomingDates: DateIdea[];
  overdueCount: number;
  freeDays: FreeDay[];
  hasSchedule: boolean;
  suggestion: DateIdea | null;
  busy: boolean;
  anniversary: { days: number; date: string; years: number } | null;
  birthdays: Array<{ name: string; date: string; days: number }>;
  companion: ReactNode;
  weather: ReactNode;
  onQuickAdd: (title: string, date: string, time: string) => Promise<boolean>;
  onPlanSuggestion: (idea: DateIdea, date: string) => void;
  onAnotherSuggestion: () => void;
  onMarkDone: (id: string) => void;
  onOpenIdeas: () => void;
  onOpenPlanned: () => void;
  onOpenAgenda: () => void;
  onOpenPlaces: () => void;
}) {
  const pt = language === "pt";
  const now = new Date();
  const today = dateKey(now);
  const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const saturday = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((6 - now.getDay() + 7) % 7 || 7)));
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(saturday);
  const [customDay, setCustomDay] = useState(false);
  const [time, setTime] = useState("");
  const [nextDate, ...laterDates] = upcomingDates;
  const firstFreeDay = freeDays.find((freeDay) => freeDay.windows.length > 0 && freeDay.dates.length === 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !day) return;
    if (await onQuickAdd(title.trim(), day, time)) {
      setTitle("");
      setTime("");
    }
  }

  const dayChoices = [
    { key: today, label: pt ? "Hoje" : "Today" },
    { key: tomorrow, label: pt ? "Amanhã" : "Tomorrow" },
    ...(saturday !== tomorrow ? [{ key: saturday, label: pt ? "Sábado" : "Saturday" }] : []),
  ];

  return (
    <div className="today-grid">
      <section className="panel today-next" aria-label={pt ? "Próximo date" : "Next date"}>
        <p className="panel-label">{pt ? "Próximo date" : "Next date"}</p>
        {overdueCount > 0 && <button type="button" className="overdue-note" onClick={onOpenPlanned}>{pt ? `${overdueCount} date${overdueCount === 1 ? "" : "s"} que já passou — marquem como feito ou apaguem` : `${overdueCount} past date${overdueCount === 1 ? "" : "s"} — mark done or delete`}<ArrowRight size={15} aria-hidden="true" /></button>}
        {nextDate ? <>
          <h2>{nextDate.emoji} {nextDate.title}</h2>
          <p className="today-meta"><CalendarDays size={16} aria-hidden="true" />{nextDate.planned_for ? shortDay(nextDate.planned_for, language) : pt ? "Dia por decidir" : "Day to decide"}{nextDate.planned_start_time && <><Clock size={16} aria-hidden="true" />{nextDate.planned_start_time.slice(0, 5)}</>}</p>
          {nextDate.location_name && <p className="today-meta"><MapPin size={16} aria-hidden="true" />{nextDate.location_name}</p>}
          <div className="panel-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => onMarkDone(nextDate.id)}><Check size={16} aria-hidden="true" />{pt ? "Já fizemos" : "We did it"}</button>{laterDates.length > 0 && <button type="button" className="button button-ghost" onClick={onOpenPlanned}>{pt ? `Mais ${laterDates.length} planeado${laterDates.length === 1 ? "" : "s"}` : `${laterDates.length} more planned`}<ArrowRight size={16} aria-hidden="true" /></button>}</div>
        </> : <>
          <h2>{pt ? "Nada marcado ainda" : "Nothing planned yet"}</h2>
          <p className="panel-copy">{firstFreeDay
            ? pt ? `Estão os dois livres ${shortDay(firstFreeDay.key, language)}. Marquem algo aqui ao lado.` : `You're both free on ${shortDay(firstFreeDay.key, language)}. Plan something alongside.`
            : pt ? "Marquem algo aqui ao lado, ou vejam as ideias." : "Plan something alongside, or browse ideas."}</p>
        </>}
      </section>

      <section className="panel today-quick-add" aria-label={pt ? "Marcar um date" : "Plan a date"}>
        <div className="panel-heading"><p className="panel-label">{pt ? "Marcar um date" : "Plan a date"}</p><button type="button" className="button button-ghost" onClick={onOpenPlaces}><UtensilsCrossed size={16} aria-hidden="true" />{pt ? "Jantar fora" : "Eat out"}</button></div>
        <form onSubmit={(event) => void submit(event)}>
          <input className="form-input" required maxLength={120} aria-label={pt ? "O que vão fazer" : "What you'll do"} placeholder={pt ? "O que vão fazer? ex.: Jantar no Taberna" : "What will you do? e.g. Dinner at Taberna"} value={title} onChange={(event) => setTitle(event.target.value)} />
          <div className="chip-row" role="group" aria-label={pt ? "Dia" : "Day"}>
            {dayChoices.map((choice) => <button type="button" key={choice.key} className={`chip ${!customDay && day === choice.key ? "selected" : ""}`} aria-pressed={!customDay && day === choice.key} onClick={() => { setCustomDay(false); setDay(choice.key); }}>{choice.label}</button>)}
            <button type="button" className={`chip ${customDay ? "selected" : ""}`} aria-pressed={customDay} onClick={() => { setCustomDay(true); setDay(""); }}>{pt ? "Outro dia" : "Another day"}</button>
          </div>
          <div className="quick-add-row">
            {customDay && <input className="form-input" type="date" required min={today} aria-label={pt ? "Dia" : "Day"} value={day} onChange={(event) => setDay(event.target.value)} />}
            <input className="form-input" type="time" aria-label={pt ? "Hora (opcional)" : "Time (optional)"} value={time} onChange={(event) => setTime(event.target.value)} />
            <button className="button button-primary" type="submit" disabled={busy || !title.trim() || !day}>{pt ? "Marcar" : "Plan it"}</button>
          </div>
        </form>
      </section>

      <section className="panel today-free" aria-label={pt ? "Tempo livre em comum" : "Shared free time"}>
        <div className="panel-heading"><p className="panel-label">{pt ? "Livres os dois" : "Both free"}</p><button type="button" className="button button-ghost" onClick={onOpenAgenda}>{pt ? "Agenda" : "Schedule"}<ArrowRight size={16} aria-hidden="true" /></button></div>
        {!hasSchedule && <p className="panel-copy">{pt ? "Ponham o horário de trabalho na Agenda para ver aqui só o tempo que têm em comum." : "Add your work hours in the Schedule to see only the time you share."}</p>}
        <ul className="free-days">
          {freeDays.slice(0, 4).map((freeDay) => <li key={freeDay.key}><strong>{freeDay.key === today ? pt ? "Hoje" : "Today" : shortDay(freeDay.key, language)}</strong><span>{freeDay.dates.length ? `${freeDay.dates[0].emoji} ${freeDay.dates[0].title}` : describeWindows(freeDay.windows, language)}</span></li>)}
        </ul>
      </section>

      <section className="panel today-suggestion" aria-label={pt ? "Sugestão" : "Suggestion"}>
        <div className="panel-heading"><p className="panel-label">{pt ? "Sugestão para o fim de semana" : "Idea for the weekend"}</p><button type="button" className="icon-button" aria-label={pt ? "Outra sugestão" : "Another idea"} onClick={onAnotherSuggestion}><Shuffle size={18} aria-hidden="true" /></button></div>
        {suggestion ? <>
          <h2>{suggestion.emoji} {suggestion.title}</h2>
          <p className="panel-copy">{suggestion.description}</p>
          <p className="today-meta"><Clock size={16} aria-hidden="true" />{suggestion.duration}<span aria-hidden="true">·</span>{suggestion.budget}</p>
          <div className="panel-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => onPlanSuggestion(suggestion, saturday)}>{pt ? "Marcar para sábado" : "Plan for Saturday"}</button><button type="button" className="button button-ghost" onClick={onOpenIdeas}>{pt ? "Ver ideias" : "Browse ideas"}<ArrowRight size={16} aria-hidden="true" /></button></div>
        </> : <p className="panel-copy">{pt ? "Já fizeram todas as ideias. Acrescentem novas em Ideias." : "You've done every idea. Add new ones in Ideas."}</p>}
      </section>

      {(anniversary || birthdays.length > 0) && <section className="panel today-dates" aria-label={pt ? "Datas especiais" : "Special dates"}>
        <p className="panel-label">{pt ? "Datas especiais" : "Special dates"}</p>
        <ul className="special-dates">
          {anniversary && <li><strong>{anniversary.days === 0 ? pt ? "Hoje" : "Today" : pt ? `${anniversary.days} dias` : `${anniversary.days} days`}</strong><span>{pt ? `Aniversário de namoro · ${anniversary.years} ${anniversary.years === 1 ? "ano" : "anos"}` : `Anniversary · ${anniversary.years} ${anniversary.years === 1 ? "year" : "years"}`}</span></li>}
          {birthdays.map((birthday) => <li key={birthday.name}><strong>{birthday.days === 0 ? pt ? "Hoje" : "Today" : pt ? `${birthday.days} dias` : `${birthday.days} days`}</strong><span>{pt ? `Anos de ${birthday.name}` : `${birthday.name}'s birthday`}</span></li>)}
        </ul>
      </section>}

      <div className="today-companion">{companion}</div>
      <div className="today-weather">{weather}</div>
    </div>
  );
}
