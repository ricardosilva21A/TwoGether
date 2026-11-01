import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./lib/supabase";
import type { CoupleTask, DateIdea, HomePartner, WorkScheduleBlock } from "./types";

type Language = "en" | "pt";
type ScheduleCouple = { id: string; partner_one_name: string; partner_two_name: string };
type FreeWindow = { start: number; end: number };

const weekdayLabels: Record<Language, string[]> = {
  pt: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
// The part of the day worth suggesting time together in.
const dayStart = 8 * 60;
const dayEnd = 23 * 60 + 30;
const shortestFreeWindow = 90;

function minutesOf(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isoWeekday(date: Date) {
  return ((date.getDay() + 6) % 7) + 1;
}

// Busy minutes of one day from the weekly blocks; a shift past midnight also fills the next morning.
function busyFromBlocks(blocks: WorkScheduleBlock[], weekday: number) {
  const previousWeekday = weekday === 1 ? 7 : weekday - 1;
  return blocks.flatMap((block) => {
    const start = minutesOf(block.starts_at);
    const end = minutesOf(block.ends_at);
    if (end > start) return block.weekday === weekday ? [{ start, end }] : [];
    return [
      ...(block.weekday === weekday ? [{ start, end: 24 * 60 }] : []),
      ...(block.weekday === previousWeekday ? [{ start: 0, end }] : []),
    ];
  });
}

export function freeWindows(busy: FreeWindow[], from: number) {
  const windows: FreeWindow[] = [];
  let cursor = from;
  for (const interval of [...busy].sort((first, second) => first.start - second.start)) {
    if (interval.start > cursor) windows.push({ start: cursor, end: Math.min(interval.start, dayEnd) });
    cursor = Math.max(cursor, interval.end);
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) windows.push({ start: cursor, end: dayEnd });
  return windows.filter((window) => window.end - window.start >= shortestFreeWindow);
}

// Shared free time for the next days, from both work schedules and timed planned dates.
export function sharedFreeDays(blocks: WorkScheduleBlock[], plannedDates: DateIdea[], length = 7, now = new Date()) {
  return Array.from({ length }, (_, offset) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const key = localDateKey(day);
    const busyIntervals = [
      ...busyFromBlocks(blocks, isoWeekday(day)),
      ...plannedDates.flatMap((date) => date.planned_for === key && date.planned_start_time
        ? [{ start: minutesOf(date.planned_start_time), end: minutesOf(date.planned_start_time) + (date.duration_minutes ?? 120) }]
        : []),
    ];
    const from = offset === 0 ? Math.max(dayStart, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15) : dayStart;
    return { day, key, windows: freeWindows(busyIntervals, from), dates: plannedDates.filter((date) => date.planned_for === key) };
  });
}

export function describeWindows(windows: FreeWindow[], language: Language) {
  if (windows.length === 0) return language === "pt" ? "Sem tempo livre em comum" : "No shared free time";
  if (windows.length === 1 && windows[0].start === dayStart && windows[0].end === dayEnd) return language === "pt" ? "Livres o dia todo" : "Free all day";
  return windows.map((window) => `${clock(window.start)}–${clock(window.end)}`).join(" · ");
}

export function SchedulePanel({ couple, mySlot, plannedDates, blocks, onBlocksChange, language, onFindDate }: { couple: ScheduleCouple; mySlot: HomePartner | null; plannedDates: DateIdea[]; blocks: WorkScheduleBlock[]; onBlocksChange: (update: (current: WorkScheduleBlock[]) => WorkScheduleBlock[]) => void; language: Language; onFindDate: () => void }) {
  const pt = language === "pt";
  const setBlocks = onBlocksChange;
  const [tasks, setTasks] = useState<CoupleTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blockPartner, setBlockPartner] = useState<HomePartner>(mySlot ?? "partner_one");
  const [blockDays, setBlockDays] = useState("weekdays");
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("18:00");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDate, setTaskDate] = useState("");
  const [taskTime, setTaskTime] = useState("");
  const [taskAssignee, setTaskAssignee] = useState<HomePartner | "both">("both");
  const [showDone, setShowDone] = useState(false);
  const [feedUrl, setFeedUrl] = useState("");
  const [feedMessage, setFeedMessage] = useState("");
  const partnerName = (slot: HomePartner) => slot === "partner_one" ? couple.partner_one_name : couple.partner_two_name;

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.from("couple_tasks").select("*").order("created_at").then((taskResult) => {
      if (!active) return;
      if (taskResult.error) setError(pt ? `Não foi possível carregar as tarefas: ${taskResult.error.message}` : `We couldn't load your tasks: ${taskResult.error.message}`);
      setTasks((taskResult.data ?? []) as CoupleTask[]);
      setLoaded(true);
    });
    return () => { active = false; };
  }, [couple.id, pt]);

  const nextDays = useMemo(() => sharedFreeDays(blocks, plannedDates), [blocks, plannedDates]);

  const openTasks = useMemo(() => tasks.filter((task) => !task.done_at).sort((first, second) =>
    (first.due_date ?? "9999") .localeCompare(second.due_date ?? "9999") || (first.due_time ?? "").localeCompare(second.due_time ?? "") || first.created_at.localeCompare(second.created_at)), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((task) => task.done_at).sort((first, second) => (second.done_at ?? "").localeCompare(first.done_at ?? "")).slice(0, 10), [tasks]);

  async function addBlocks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || blockStart === blockEnd) return;
    const weekdays = blockDays === "weekdays" ? [1, 2, 3, 4, 5] : blockDays === "weekend" ? [6, 7] : [Number(blockDays)];
    setBusy(true);
    setError("");
    const { data, error: saveError } = await supabase.from("work_schedule_blocks")
      .insert(weekdays.map((weekday) => ({ couple_id: couple.id, partner_slot: blockPartner, weekday, starts_at: blockStart, ends_at: blockEnd })))
      .select("*");
    if (saveError) setError(pt ? `Não foi possível guardar o horário: ${saveError.message}` : `We couldn't save the schedule: ${saveError.message}`);
    else setBlocks((current) => [...current, ...data as WorkScheduleBlock[]]);
    setBusy(false);
  }

  async function removeBlock(id: string) {
    if (!supabase) return;
    setBusy(true);
    const { error: removeError } = await supabase.from("work_schedule_blocks").delete().eq("id", id);
    if (removeError) setError(pt ? `Não foi possível remover o horário: ${removeError.message}` : `We couldn't remove that block: ${removeError.message}`);
    else setBlocks((current) => current.filter((block) => block.id !== id));
    setBusy(false);
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!supabase || !title) return;
    setBusy(true);
    setError("");
    const { data, error: saveError } = await supabase.from("couple_tasks").insert({
      couple_id: couple.id,
      title,
      due_date: taskDate || null,
      due_time: taskDate && taskTime ? taskTime : null,
      assigned_to: taskAssignee === "both" ? null : taskAssignee,
    }).select("*").single();
    if (saveError) setError(pt ? `Não foi possível adicionar a tarefa: ${saveError.message}` : `We couldn't add the task: ${saveError.message}`);
    else {
      setTasks((current) => [...current, data as CoupleTask]);
      setTaskTitle("");
      setTaskDate("");
      setTaskTime("");
    }
    setBusy(false);
  }

  async function toggleTask(task: CoupleTask) {
    if (!supabase) return;
    const { data, error: saveError } = await supabase.from("couple_tasks")
      .update({ done_at: task.done_at ? null : new Date().toISOString() })
      .eq("id", task.id).select("*").single();
    if (saveError) setError(pt ? `Não foi possível atualizar a tarefa: ${saveError.message}` : `We couldn't update the task: ${saveError.message}`);
    else setTasks((current) => current.map((item) => item.id === task.id ? data as CoupleTask : item));
  }

  async function removeTask(id: string) {
    if (!supabase) return;
    const { error: removeError } = await supabase.from("couple_tasks").delete().eq("id", id);
    if (removeError) setError(pt ? `Não foi possível apagar a tarefa: ${removeError.message}` : `We couldn't delete the task: ${removeError.message}`);
    else setTasks((current) => current.filter((task) => task.id !== id));
  }

  async function loadFeed(rotate = false) {
    if (!supabase) return;
    setBusy(true);
    setFeedMessage("");
    const { data, error: feedError } = await supabase.rpc("get_calendar_feed_token", { rotate });
    if (feedError) setFeedMessage(pt ? `Não foi possível criar a ligação: ${feedError.message}` : `We couldn't create the link: ${feedError.message}`);
    else {
      setFeedUrl(`${window.location.origin}/api/calendar?token=${data as string}&lang=${language}`);
      if (rotate) setFeedMessage(pt ? "Ligação nova criada. A antiga deixou de funcionar — subscrevam de novo no iPhone." : "New link created. The old one has stopped working — subscribe again on your iPhone.");
    }
    setBusy(false);
  }

  async function copyFeed() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setFeedMessage(pt ? "Ligação copiada." : "Link copied.");
    } catch {
      setFeedMessage(pt ? "Não foi possível copiar. Selecionem a ligação e copiem-na manualmente." : "We couldn't copy it. Select the link and copy it manually.");
    }
  }

  const formatDay = (day: Date) => new Intl.DateTimeFormat(pt ? "pt-PT" : "en-GB", { weekday: "long", day: "numeric", month: "short" }).format(day);
  const formatDue = (task: CoupleTask) => task.due_date
    ? `${new Intl.DateTimeFormat(pt ? "pt-PT" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${task.due_date}T12:00:00`))}${task.due_time ? ` · ${task.due_time.slice(0, 5)}` : ""}`
    : pt ? "Sem data" : "No date";
  const assigneeLabel = (task: CoupleTask) => task.assigned_to ? partnerName(task.assigned_to) : pt ? "Os dois" : "Both";

  return (
    <section className="schedule-page" aria-label={pt ? "Agenda do casal" : "Couple schedule"}>
      {error && <p className="form-alert error-alert" role="alert">{error}</p>}

      <article className="schedule-card free-time-card">
        <div className="schedule-card-heading"><div><p className="section-kicker">{pt ? "PRÓXIMOS 7 DIAS" : "NEXT 7 DAYS"}</p><h2>{pt ? "Quando estão os dois livres" : "When you're both free"}</h2></div><button type="button" className="add-button" onClick={onFindDate}>{pt ? "Encontrar um date" : "Find a date"}</button></div>
        {loaded && blocks.length === 0 && <p className="schedule-hint">{pt ? "Adicionem o horário de trabalho de cada um, aqui em baixo, para verem só o tempo que têm em comum." : "Add each of your work schedules below to see only the time you share."}</p>}
        <ul className="free-time-list">
          {nextDays.map(({ day, key, windows, dates }) => <li key={key}>
            <strong>{formatDay(day)}</strong>
            <span>{describeWindows(windows, language)}</span>
            {dates.map((date) => <em key={date.id}>{date.emoji} {date.title}{date.planned_start_time ? ` · ${date.planned_start_time.slice(0, 5)}` : ""}</em>)}
          </li>)}
        </ul>
      </article>

      <div className="schedule-columns">
        <article className="schedule-card">
          <p className="section-kicker">{pt ? "HORÁRIO DE TRABALHO" : "WORK SCHEDULE"}</p>
          <h2>{pt ? "A semana de cada um" : "Each of your weeks"}</h2>
          {(["partner_one", "partner_two"] as const).map((slot) => {
            const partnerBlocks = blocks.filter((block) => block.partner_slot === slot).sort((first, second) => first.weekday - second.weekday || first.starts_at.localeCompare(second.starts_at));
            return <div className="schedule-partner" key={slot}>
              <h3>{partnerName(slot)}{slot === mySlot && <span>{pt ? " (tu)" : " (you)"}</span>}</h3>
              {partnerBlocks.length === 0 ? <p className="schedule-hint">{pt ? "Ainda sem horário." : "No schedule yet."}</p> : <ul className="schedule-blocks">
                {partnerBlocks.map((block) => <li key={block.id}><span>{weekdayLabels[language][block.weekday - 1]}</span><span>{block.starts_at.slice(0, 5)}–{block.ends_at.slice(0, 5)}{minutesOf(block.ends_at) < minutesOf(block.starts_at) ? pt ? " (dia seguinte)" : " (next day)" : ""}</span><button type="button" disabled={busy} aria-label={pt ? "Remover" : "Remove"} onClick={() => void removeBlock(block.id)}>×</button></li>)}
              </ul>}
            </div>;
          })}
          <form className="schedule-form" onSubmit={(event) => void addBlocks(event)}>
            <label className="form-label">{pt ? "Quem" : "Who"}<select className="form-input" value={blockPartner} onChange={(event) => setBlockPartner(event.target.value as HomePartner)}><option value="partner_one">{couple.partner_one_name}</option><option value="partner_two">{couple.partner_two_name}</option></select></label>
            <label className="form-label">{pt ? "Dias" : "Days"}<select className="form-input" value={blockDays} onChange={(event) => setBlockDays(event.target.value)}><option value="weekdays">{pt ? "Segunda a sexta" : "Monday to Friday"}</option><option value="weekend">{pt ? "Fim de semana" : "Weekend"}</option>{weekdayLabels[language].map((label, index) => <option key={label} value={String(index + 1)}>{label}</option>)}</select></label>
            <label className="form-label">{pt ? "Entrada" : "Start"}<input className="form-input" type="time" required value={blockStart} onChange={(event) => setBlockStart(event.target.value)} /></label>
            <label className="form-label">{pt ? "Saída" : "End"}<input className="form-input" type="time" required value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} /></label>
            <button className="modal-submit" type="submit" disabled={busy || blockStart === blockEnd}>{pt ? "Adicionar horário" : "Add hours"}</button>
          </form>
        </article>

        <article className="schedule-card">
          <p className="section-kicker">{pt ? "COISAS A FAZER" : "TO DO"}</p>
          <h2>{pt ? "Tarefas do casal" : "Couple tasks"} <span className="heading-count">{openTasks.length}</span></h2>
          <form className="task-form" onSubmit={(event) => void addTask(event)}>
            <input className="form-input task-title-input" required maxLength={200} aria-label={pt ? "Nova tarefa" : "New task"} placeholder={pt ? "ex.: Reservar o jantar de sábado" : "e.g. Book Saturday's dinner"} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
            <div className="task-form-row">
              <input className="form-input" type="date" aria-label={pt ? "Data (opcional)" : "Date (optional)"} value={taskDate} onChange={(event) => setTaskDate(event.target.value)} />
              <input className="form-input" type="time" aria-label={pt ? "Hora (opcional)" : "Time (optional)"} disabled={!taskDate} value={taskTime} onChange={(event) => setTaskTime(event.target.value)} />
              <select className="form-input" aria-label={pt ? "Para quem" : "For whom"} value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value as HomePartner | "both")}><option value="both">{pt ? "Os dois" : "Both"}</option><option value="partner_one">{couple.partner_one_name}</option><option value="partner_two">{couple.partner_two_name}</option></select>
              <button className="modal-submit" type="submit" disabled={busy || !taskTitle.trim()}>{pt ? "Adicionar" : "Add"}</button>
            </div>
          </form>
          {openTasks.length === 0 ? <p className="schedule-hint">{loaded ? pt ? "Nada pendente. 🎉" : "Nothing pending. 🎉" : pt ? "A carregar…" : "Loading…"}</p> : <ul className="task-list">
            {openTasks.map((task) => <li key={task.id}><input type="checkbox" checked={false} aria-label={pt ? `Marcar "${task.title}" como feita` : `Mark "${task.title}" as done`} onChange={() => void toggleTask(task)} /><div><strong>{task.title}</strong><small>{formatDue(task)} · {assigneeLabel(task)}</small></div><button type="button" aria-label={pt ? "Apagar tarefa" : "Delete task"} onClick={() => void removeTask(task.id)}>×</button></li>)}
          </ul>}
          {doneTasks.length > 0 && <button type="button" className="task-done-toggle" onClick={() => setShowDone((shown) => !shown)}>{showDone ? pt ? "Esconder feitas" : "Hide done" : pt ? `Ver feitas (${doneTasks.length})` : `Show done (${doneTasks.length})`}</button>}
          {showDone && <ul className="task-list done-tasks">
            {doneTasks.map((task) => <li key={task.id}><input type="checkbox" checked aria-label={pt ? `Voltar a abrir "${task.title}"` : `Reopen "${task.title}"`} onChange={() => void toggleTask(task)} /><div><strong>{task.title}</strong><small>{assigneeLabel(task)}</small></div><button type="button" aria-label={pt ? "Apagar tarefa" : "Delete task"} onClick={() => void removeTask(task.id)}>×</button></li>)}
          </ul>}
        </article>
      </div>

      <article className="schedule-card calendar-sync-card">
        <p className="section-kicker">{pt ? "CALENDÁRIO DO IPHONE" : "IPHONE CALENDAR"}</p>
        <h2>{pt ? "Ver tudo no calendário do telemóvel" : "See it all in your phone's calendar"}</h2>
        <p className="schedule-hint">{pt
          ? "Os dates planeados, as tuas tarefas (e as dos dois), o aniversário de namoro e os anos de cada um aparecem sozinhos no Calendário do iPhone. Cada um faz isto no seu telemóvel, com a sua conta."
          : "Planned dates, your tasks (and shared ones), your anniversary and both birthdays show up by themselves in the iPhone Calendar. Each of you does this on your own phone, signed in to your own account."}</p>
        {!feedUrl ? <button type="button" className="modal-submit" disabled={busy || !mySlot} onClick={() => void loadFeed()}>{pt ? "Ligar ao calendário do iPhone" : "Connect to the iPhone calendar"}</button> : <>
          <div className="calendar-sync-actions"><a className="modal-submit" href={feedUrl.replace(/^https?:/, "webcal:")}>{pt ? "Subscrever no iPhone" : "Subscribe on iPhone"}</a><button type="button" className="photo-upload-button" onClick={() => void copyFeed()}>{pt ? "Copiar ligação" : "Copy link"}</button></div>
          <ol className="calendar-sync-steps">
            <li>{pt ? "Abram esta página no iPhone e toquem em “Subscrever no iPhone”, depois em “Subscrever”." : "Open this page on the iPhone, tap “Subscribe on iPhone”, then “Subscribe”."}</li>
            <li>{pt ? "Ou: Definições → Calendário → Contas → Adicionar conta → Outra → Adicionar calendário subscrito, e colem a ligação." : "Or: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar, and paste the link."}</li>
            <li>{pt ? "O iPhone vai buscar as novidades sozinho, normalmente a cada hora." : "The iPhone fetches updates on its own, usually every hour."}</li>
          </ol>
          <input className="form-input" readOnly aria-label={pt ? "Ligação do calendário" : "Calendar link"} value={feedUrl} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="task-done-toggle" disabled={busy} onClick={() => void loadFeed(true)}>{pt ? "Gerar uma ligação nova (a antiga deixa de funcionar)" : "Create a new link (the old one stops working)"}</button>
        </>}
        {feedMessage && <p className="form-alert config-alert" role="status">{feedMessage}</p>}
      </article>
    </section>
  );
}
