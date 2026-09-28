// <event-calendar>: the shared studio calendar. A month grid, the chosen
// day's events with RSVPs, and a form to add or edit events.
// Call start({ user, isAdmin }) once the member is logged in. Any member can
// add events; only admins can post studio events. Creators and admins can
// edit or delete an event.
import {
  supabase,
  setStatus,
  withForm,
  loadMemberNames,
  memberName,
  renderByline,
  el,
} from "../shared.js?v=2";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 2;

// Local calendar date as "YYYY-MM-DD" (what <input type="date"> uses).
const dayKey = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

const timeValue = (date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

class EventCalendar extends HTMLElement {
  #member = null;
  #month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  #selected = dayKey(new Date());
  #events = [];
  #rsvps = [];
  #names = new Map();
  #editing = null;

  connectedCallback() {
    if (this.hasChildNodes()) return;
    this.innerHTML = `
      <div class="calendar-toolbar">
        <button class="button button-quiet" type="button" data-step="-1" aria-label="Previous month">‹</button>
        <h3 class="calendar-month"></h3>
        <button class="button button-quiet" type="button" data-step="1" aria-label="Next month">›</button>
        <button class="button button-quiet" type="button" data-today>Today</button>
      </div>

      <div class="calendar-grid" role="grid"></div>
      <div class="calendar-legend">
        <span class="event-chip is-studio">Studio event</span>
        <span class="event-chip">Member event</span>
      </div>
      <div class="day-events"></div>

      <form class="member-form event-form" hidden>
        <h3 class="event-form-heading">Add an event</h3>
        <label class="field">
          <span>Title</span>
          <input type="text" name="title" maxlength="120" required />
        </label>
        <div class="event-when">
          <label class="field">
            <span>Date</span>
            <input type="date" name="date" required />
          </label>
          <label class="field">
            <span>Starts</span>
            <input type="time" name="start" required />
          </label>
          <label class="field">
            <span>Ends (optional)</span>
            <input type="time" name="end" />
          </label>
        </div>
        <label class="field">
          <span>Description</span>
          <textarea name="description" rows="3" maxlength="2000"></textarea>
        </label>
        <label class="checkbox studio-event-option" hidden>
          <input type="checkbox" name="is_studio_event" />
          <span>Studio event (firings, closures, cleanup days…)</span>
        </label>
        <div class="piece-actions">
          <button class="button" type="submit">Save event</button>
          <button class="button button-quiet" type="button" data-cancel>Cancel</button>
        </div>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>`;

    this.querySelectorAll("[data-step]").forEach((button) =>
      button.addEventListener("click", () => {
        this.#month = new Date(
          this.#month.getFullYear(),
          this.#month.getMonth() + Number(button.dataset.step),
          1,
        );
        this.load();
      }),
    );
    this.querySelector("[data-today]").addEventListener("click", () => {
      const today = new Date();
      this.#month = new Date(today.getFullYear(), today.getMonth(), 1);
      this.#selected = dayKey(today);
      this.load();
    });
    this.querySelector("[data-cancel]").addEventListener("click", () => this.#closeForm());
    const form = this.querySelector(".event-form");
    form.addEventListener("submit", this.#save);
    // Changing the form's date selects that day on the calendar.
    form.date.addEventListener("change", () => {
      if (!form.date.value || form.date.value === this.#selected) return;
      this.#selected = form.date.value;
      const [year, month] = form.date.value.split("-").map(Number);
      const shown = this.#month;
      if (year !== shown.getFullYear() || month - 1 !== shown.getMonth()) {
        this.#month = new Date(year, month - 1, 1);
        this.load();
      } else {
        this.#render();
      }
    });
  }

  start(member) {
    this.#member = member;
    this.querySelector(".studio-event-option").hidden = !member.isAdmin;
    this.load();
  }

  // The six weeks shown in the grid, starting on the Sunday on/before the 1st.
  #gridDays() {
    const first = new Date(this.#month);
    first.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(first);
      day.setDate(first.getDate() + i);
      return day;
    });
  }

  async load() {
    const days = this.#gridDays();
    const end = new Date(days[41]);
    end.setDate(end.getDate() + 1);

    const { data: events, error } = await supabase
      .from("events")
      .select("*")
      .gte("starts_at", days[0].toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at");
    if (error) console.error(error);
    this.#events = events ?? [];

    const ids = this.#events.map((event) => event.id);
    const { data: rsvps } = ids.length
      ? await supabase.from("event_rsvps").select("event_id, user_id").in("event_id", ids)
      : { data: [] };
    this.#rsvps = rsvps ?? [];

    this.#names = await loadMemberNames([
      ...this.#events.map((event) => event.created_by),
      ...this.#rsvps.map((rsvp) => rsvp.user_id),
    ]);

    this.#render();
  }

  #eventsOn(key) {
    return this.#events.filter((event) => dayKey(new Date(event.starts_at)) === key);
  }

  #render() {
    this.querySelector(".calendar-month").textContent = this.#month.toLocaleDateString(
      undefined,
      { month: "long", year: "numeric" },
    );

    const grid = this.querySelector(".calendar-grid");
    grid.replaceChildren(...WEEKDAYS.map((day) => el("div", "calendar-weekday", day)));

    const today = dayKey(new Date());
    this.#gridDays().forEach((day) => {
      const key = dayKey(day);
      const events = this.#eventsOn(key);
      const cell = el("button", "calendar-day");
      cell.type = "button";
      cell.classList.toggle("is-other-month", day.getMonth() !== this.#month.getMonth());
      cell.classList.toggle("is-today", key === today);
      cell.classList.toggle("is-selected", key === this.#selected);
      cell.setAttribute(
        "aria-label",
        `${day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, ${
          events.length
        } event${events.length === 1 ? "" : "s"}`,
      );
      cell.setAttribute("aria-pressed", key === this.#selected);

      cell.append(el("span", "calendar-date", day.getDate()));
      events.slice(0, MAX_CHIPS).forEach((event) => {
        cell.append(
          el("span", `event-chip${event.is_studio_event ? " is-studio" : ""}`, event.title),
        );
      });
      if (events.length > MAX_CHIPS) {
        cell.append(el("span", "event-more", `+${events.length - MAX_CHIPS} more`));
      }

      cell.addEventListener("click", () => {
        this.#selected = key;
        // Picking a day in the next/previous month moves the calendar there.
        if (day.getMonth() !== this.#month.getMonth()) {
          this.#month = new Date(day.getFullYear(), day.getMonth(), 1);
          this.load();
        } else {
          this.#render();
        }
      });
      grid.append(cell);
    });

    this.#renderDay();
  }

  #renderDay() {
    const panel = this.querySelector(".day-events");
    const [year, month, date] = this.#selected.split("-").map(Number);
    const heading = el(
      "h3",
      null,
      new Date(year, month - 1, date).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    );

    // Adding an event goes under the chosen day, for that day.
    const add = el("button", "button calendar-add", `Add event on ${new Date(
      year,
      month - 1,
      date,
    ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
    add.type = "button";
    add.addEventListener("click", () => this.#openForm());

    // A new event that's being filled in follows the day picked.
    const form = this.querySelector(".event-form");
    add.hidden = !form.hidden;
    if (!form.hidden && !this.#editing) form.date.value = this.#selected;

    const events = this.#eventsOn(this.#selected);
    if (!events.length) {
      panel.replaceChildren(heading, el("p", "field-note", "Nothing scheduled."), add);
      return;
    }

    const list = el("ul", "event-list");
    events.forEach((event) => list.append(this.#renderEvent(event)));
    panel.replaceChildren(heading, list, add);
  }

  #renderEvent(event) {
    const { user, isAdmin } = this.#member;
    const item = el("li", `event${event.is_studio_event ? " is-studio" : ""}`);

    const heading = el("div", "piece-heading");
    heading.append(el("h4", null, event.title));
    if (event.is_studio_event) heading.append(el("span", "piece-status status-bisque_fired", "Studio event"));

    const time = event.ends_at
      ? `${formatTime(event.starts_at)} – ${formatTime(event.ends_at)}`
      : formatTime(event.starts_at);
    const meta = el("p", "piece-meta", `${time} · added by `);
    meta.append(renderByline(this.#names.get(event.created_by)));

    item.append(heading, meta);
    if (event.description) item.append(el("p", "post-body", event.description));

    const going = this.#rsvps.filter((rsvp) => rsvp.event_id === event.id);
    const imGoing = going.some((rsvp) => rsvp.user_id === user.id);
    const names = going.map((rsvp) =>
      rsvp.user_id === user.id ? "You" : memberName(this.#names.get(rsvp.user_id)),
    );
    item.append(
      el(
        "p",
        "event-going",
        going.length ? `Going (${going.length}): ${names.join(", ")}` : "No one's going yet.",
      ),
    );

    const actions = el("div", "piece-actions");
    const rsvp = el("button", imGoing ? "button" : "button button-quiet", imGoing ? "Going ✓" : "I'm going");
    rsvp.type = "button";
    rsvp.setAttribute("aria-pressed", imGoing);
    rsvp.addEventListener("click", () => this.#toggleRsvp(event.id, imGoing));
    actions.append(rsvp);

    if (event.created_by === user.id || isAdmin) {
      const edit = el("button", "button button-quiet", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => this.#openForm(event));
      const remove = el("button", "button button-quiet", "Delete");
      remove.type = "button";
      remove.addEventListener("click", () => this.#delete(event));
      actions.append(edit, remove);
    }

    item.append(actions);
    return item;
  }

  #openForm(event = null) {
    this.#editing = event;
    const form = this.querySelector(".event-form");
    form.reset();
    setStatus(form, "");
    form.querySelector(".event-form-heading").textContent = event ? "Edit event" : "Add an event";

    if (event) {
      const starts = new Date(event.starts_at);
      form.elements.title.value = event.title;
      form.date.value = dayKey(starts);
      form.start.value = timeValue(starts);
      form.end.value = event.ends_at ? timeValue(new Date(event.ends_at)) : "";
      form.description.value = event.description ?? "";
      form.is_studio_event.checked = event.is_studio_event;
    } else {
      form.date.value = this.#selected;
      form.start.value = "18:00";
    }

    form.hidden = false;
    this.querySelector(".calendar-add").hidden = true;
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    form.elements.title.focus({ preventScroll: true });
  }

  #closeForm() {
    this.#editing = null;
    this.querySelector(".event-form").hidden = true;
    this.querySelector(".calendar-add").hidden = false;
  }

  #save = (submitEvent) => {
    submitEvent.preventDefault();
    const form = submitEvent.target;
    const starts = new Date(`${form.date.value}T${form.start.value}`);
    const ends = form.end.value ? new Date(`${form.date.value}T${form.end.value}`) : null;
    if (ends && ends < starts) {
      setStatus(form, "The end time must be after the start time.", true);
      return;
    }

    const values = {
      title: form.elements.title.value.trim(),
      description: form.description.value.trim() || null,
      starts_at: starts.toISOString(),
      ends_at: ends?.toISOString() ?? null,
      is_studio_event: this.#member.isAdmin && form.is_studio_event.checked,
    };

    withForm(form, "Saving…", async () => {
      const { error } = this.#editing
        ? await supabase.from("events").update(values).eq("id", this.#editing.id)
        : await supabase.from("events").insert(values);
      if (error) {
        console.error(error);
        setStatus(form, "Couldn't save the event. Please try again.", true);
        return;
      }
      this.#selected = dayKey(starts);
      this.#month = new Date(starts.getFullYear(), starts.getMonth(), 1);
      this.#closeForm();
      await this.load();
    });
  };

  async #toggleRsvp(eventId, going) {
    const { error } = going
      ? await supabase
          .from("event_rsvps")
          .delete()
          .eq("event_id", eventId)
          .eq("user_id", this.#member.user.id)
      : await supabase.from("event_rsvps").insert({ event_id: eventId });
    if (error) console.error(error);
    await this.load();
  }

  async #delete(event) {
    if (!window.confirm(`Delete "${event.title}"?`)) return;
    const { error } = await supabase.from("events").delete().eq("id", event.id);
    if (error) {
      console.error(error);
      window.alert("Couldn't delete that event. Please try again.");
      return;
    }
    await this.load();
  }
}

customElements.define("event-calendar", EventCalendar);
