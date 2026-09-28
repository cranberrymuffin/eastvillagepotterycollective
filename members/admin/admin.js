// Members page (studio admins only): register members, and view and edit each
// member's tier history (membership_periods). The database only lets admins
// make these changes; this page just hides itself from everyone else.
import {
  supabase,
  showNotConfigured,
  requireMember,
  loadProfile,
  setStatus,
  withForm,
  el,
} from "../shared.js?v=3";
import { TIERS, STUDIO_TIME_ZONE, formatPlainDate } from "../studio.js?v=3";
import "../components/tier-picker.js?v=2";

const adminView = document.querySelector("#admin-view");
const addForm = document.querySelector("#add-member-form");
const tierPicker = addForm.querySelector("tier-picker");
const memberList = document.querySelector("#member-list");
const membersEmpty = document.querySelector("#members-empty");

if (!supabase) {
  showNotConfigured();
  throw new Error("Supabase is not configured in /members/config.js");
}

// Messages for the database's checks on tier history.
const periodErrorMessage = (error) => {
  if (error.friendly) return error.friendly;
  if (error.code === "23P01") return "That overlaps another period for this member.";
  if (error.code === "23505") {
    return "Only one period can have no end date. Give the current period an end date first.";
  }
  if (error.code === "23514") return "The end date can't be before the start date.";
  return "Couldn't save. Please try again.";
};

// Registering a member ---------------------------------------------------------
// Registering an email lets that person create their own account on the
// login page. The database refuses signups from unregistered emails.

const registrationList = document.querySelector("#registration-list");
const registrationsEmpty = document.querySelector("#registrations-empty");

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = addForm.email.value.trim().toLowerCase();
  withForm(addForm, "Registering…", async () => {
    // Admins can read every profile, so check for an existing account first.
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      setStatus(addForm, "There's already an account with that email.", true);
      return;
    }

    const { error } = await supabase.from("member_registrations").insert({
      email,
      tier: tierPicker.value,
      full_name: addForm.full_name.value.trim() || null,
    });
    if (error) {
      console.error(error);
      setStatus(
        addForm,
        error.code === "23505"
          ? "That email is already registered."
          : "Couldn't register the member. Please try again.",
        true,
      );
      return;
    }
    addForm.reset();
    setStatus(
      addForm,
      `Registered ${email}. They can now create their account at eastvillagepottery.com/members/.`,
    );
    loadRegistrations();
  });
});

async function loadRegistrations() {
  const { data, error } = await supabase
    .from("member_registrations")
    .select("email, full_name, tier, registered_at")
    .order("registered_at", { ascending: false });
  if (error) {
    console.error(error);
    registrationsEmpty.textContent = "Couldn't load registrations. Please refresh.";
    registrationsEmpty.hidden = false;
    return;
  }

  registrationsEmpty.hidden = data.length > 0;
  registrationList.replaceChildren(
    ...data.map((registration) => {
      const item = el("li", "registration");
      const who = el("span", null, registration.full_name
        ? `${registration.full_name} · ${registration.email}`
        : registration.email);
      const tier = el("span", "field-note", TIERS[registration.tier]?.name ?? "");
      const remove = el("button", "link-button", "Remove");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Remove the registration for ${registration.email}?`)) return;
        const { error: removeError } = await supabase
          .from("member_registrations")
          .delete()
          .eq("email", registration.email);
        if (removeError) {
          console.error(removeError);
          window.alert("Couldn't remove it. Please try again.");
        }
        loadRegistrations();
      });
      item.append(who, tier, remove);
      return item;
    }),
  );
}

// Membership -------------------------------------------------------------------
// Each member shows their current tier with Change tier / End membership
// (or Activate when they have none), then their history, where any period
// can be corrected. Only one form is open on the page at a time.

// Today in the studio's time zone, as "2026-09-27".
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TIME_ZONE }).format(new Date());

let closeOpenForm = null;

// Shows `form` in `slot` (replacing what's there), closing any other form.
const openForm = (slot, form, onClose = () => {}) => {
  closeOpenForm?.();
  const previous = [...slot.childNodes];
  slot.replaceChildren(form);
  closeOpenForm = () => {
    slot.replaceChildren(...previous);
    onClose();
    closeOpenForm = null;
  };
  form.querySelector("select, input")?.focus();
};

const closeForm = () => closeOpenForm?.();

const tierLabel = (tier) => (TIERS[tier] ? `${TIERS[tier].name} · $${TIERS[tier].price}/month` : tier);

const tierSelect = (value, exclude = null) => {
  const field = el("label", "field");
  const select = el("select");
  select.name = "tier";
  select.required = true;
  Object.keys(TIERS)
    .filter((key) => key !== exclude)
    .forEach((key) => {
      const option = el("option", null, tierLabel(key));
      option.value = key;
      option.selected = key === value;
      select.append(option);
    });
  field.append(el("span", null, "Tier"), select);
  return field;
};

const dateField = (label, name, value, required = true) => {
  const field = el("label", "field");
  const input = el("input");
  input.type = "date";
  input.name = name;
  input.value = value ?? "";
  input.required = required;
  field.append(el("span", null, label), input);
  return field;
};

// A small form: fields, a note, the submit button, Cancel, and a status line.
// `onSubmit(form)` returns an error (or nothing when it worked).
const actionForm = ({ fields, note, submitLabel, extraButtons = [], onSubmit, onDone }) => {
  const form = el("form", "period-form");
  form.append(...fields);
  if (note) form.append(el("p", "field-note", note));
  const actions = el("div", "piece-actions");
  const submit = el("button", "button", submitLabel);
  submit.type = "submit";
  const cancel = el("button", "button button-quiet", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", closeForm);
  actions.append(submit, ...extraButtons, cancel);
  const status = el("p", "form-status");
  status.setAttribute("role", "status");
  form.append(actions, status);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    withForm(form, "Saving…", async () => {
      const error = await onSubmit(form);
      if (error) {
        console.error(error);
        setStatus(form, periodErrorMessage(error), true);
      } else {
        closeOpenForm = null;
        onDone();
      }
    });
  });
  return form;
};

// Our own membership functions explain themselves (22023 = bad date).
const rpcError = ({ error }) => error;
const withRpcMessage = (error) =>
  error?.code === "22023" ? { ...error, friendly: error.message } : error;

const periodDates = (period) =>
  period.ends_on
    ? `${formatPlainDate(period.starts_on, "short")} – ${formatPlainDate(period.ends_on, "short")}`
    : `since ${formatPlainDate(period.starts_on, "short")}`;

const renderMember = (member, periods) => {
  const item = el("li");
  const details = el("details", "admin-member");
  const summary = el("summary");
  const meta = el("span", "admin-member-meta");
  summary.append(el("strong", null, member.full_name || member.email), meta);
  const body = el("div", "admin-member-body");
  details.append(summary, body);

  const reload = async () => {
    const { data, error } = await supabase
      .from("membership_periods")
      .select("id, tier, starts_on, ends_on")
      .eq("user_id", member.id)
      .order("starts_on");
    if (error) console.error(error);
    show(data ?? []);
  };

  function show(memberPeriods) {
    const current = memberPeriods.find((period) => !period.ends_on);
    meta.textContent = [
      member.full_name ? member.email : null,
      current ? TIERS[current.tier]?.name : "No active membership",
    ]
      .filter(Boolean)
      .join(" · ");

    // Current tier and its actions.
    const status = el("div", "membership-current");
    const heading = el("p", "membership-status");
    if (current) {
      heading.append(el("strong", null, tierLabel(current.tier)), ` ${periodDates(current)}`);
    } else {
      heading.append(el("strong", null, "No active membership"));
    }
    const actionSlot = el("div", "membership-actions");
    const actions = el("div", "piece-actions");
    const button = (label, quiet, onClick) => {
      const b = el("button", quiet ? "button button-quiet" : "button", label);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    };

    if (current) {
      actions.append(
        button("Change tier", false, () =>
          openForm(
            actionSlot,
            actionForm({
              fields: [
                tierSelect(null, current.tier),
                dateField("Starting", "starting", today()),
              ],
              note: `Their ${TIERS[current.tier]?.name ?? "current"} period ends the day before.`,
              submitLabel: "Change tier",
              onSubmit: async (form) =>
                withRpcMessage(
                  rpcError(
                    await supabase.rpc("start_membership_tier", {
                      member: member.id,
                      new_tier: form.tier.value,
                      starting: form.starting.value,
                    }),
                  ),
                ),
              onDone: reload,
            }),
          ),
        ),
        button("End membership", true, () =>
          openForm(
            actionSlot,
            actionForm({
              fields: [dateField("Last day", "last_day", today())],
              note: "They're billed through the month of their last day.",
              submitLabel: "End membership",
              onSubmit: async (form) =>
                withRpcMessage(
                  rpcError(
                    await supabase.rpc("end_membership", {
                      member: member.id,
                      last_day: form.last_day.value,
                    }),
                  ),
                ),
              onDone: reload,
            }),
          ),
        ),
      );
    } else {
      actions.append(
        button("Activate", false, () =>
          openForm(
            actionSlot,
            actionForm({
              fields: [tierSelect("tier_1"), dateField("Starting", "starting", today())],
              submitLabel: "Activate",
              onSubmit: async (form) =>
                withRpcMessage(
                  rpcError(
                    await supabase.rpc("start_membership_tier", {
                      member: member.id,
                      new_tier: form.tier.value,
                      starting: form.starting.value,
                    }),
                  ),
                ),
              onDone: reload,
            }),
          ),
        ),
      );
    }
    actionSlot.append(actions);
    status.append(heading, actionSlot);

    // History, newest first; any period can be corrected.
    const history = el("ol", "period-list");
    [...memberPeriods].reverse().forEach((period) => {
      const row = el("li", "period-row");
      const text = el("span", null);
      text.append(el("strong", null, TIERS[period.tier]?.name ?? period.tier), ` · ${periodDates(period)}`);
      const edit = button("Edit", true, () => {
        const remove = el("button", "button button-quiet", "Delete");
        remove.type = "button";
        const form = actionForm({
          fields: [
            tierSelect(period.tier),
            dateField("Starts", "starts_on", period.starts_on),
            dateField("Ends (blank = current)", "ends_on", period.ends_on, false),
          ],
          submitLabel: "Save",
          extraButtons: [remove],
          onSubmit: async (form) =>
            (
              await supabase
                .from("membership_periods")
                .update({
                  tier: form.tier.value,
                  starts_on: form.starts_on.value,
                  ends_on: form.ends_on.value || null,
                })
                .eq("id", period.id)
            ).error,
          onDone: reload,
        });
        remove.addEventListener("click", () => {
          if (!window.confirm("Delete this period from their history?")) return;
          withForm(form, "Deleting…", async () => {
            const { error } = await supabase
              .from("membership_periods")
              .delete()
              .eq("id", period.id);
            if (error) {
              console.error(error);
              setStatus(form, "Couldn't delete. Please try again.", true);
            } else {
              closeOpenForm = null;
              reload();
            }
          });
        });
        openForm(row, form);
      });
      edit.classList.add("period-edit");
      row.append(text, edit);
      history.append(row);
    });

    body.replaceChildren(
      status,
      el("h3", null, "History"),
      memberPeriods.length ? history : el("p", "field-note", "No tier history yet."),
    );
  }

  show(periods);
  item.append(details);
  return item;
};

async function loadMembers() {
  const [{ data: members, error }, { data: periods, error: periodsError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_admin", false)
      .order("full_name"),
    supabase
      .from("membership_periods")
      .select("id, user_id, tier, starts_on, ends_on")
      .order("starts_on"),
  ]);
  if (error || periodsError) {
    console.error(error ?? periodsError);
    membersEmpty.textContent = "Couldn't load members. Please refresh.";
    membersEmpty.hidden = false;
    return;
  }

  // Keep open whichever members were open before reloading.
  const open = new Set(
    [...memberList.querySelectorAll("details[open]")].map((details) => details.dataset.id),
  );
  membersEmpty.hidden = members.length > 0;
  memberList.replaceChildren(
    ...members.map((member) => {
      const item = renderMember(
        member,
        periods.filter((period) => period.user_id === member.id),
      );
      const details = item.querySelector("details");
      details.dataset.id = member.id;
      details.open = open.has(member.id);
      return item;
    }),
  );
}

requireMember(async (user) => {
  const profile = await loadProfile(user.id);
  if (!profile?.is_admin) {
    const status = document.querySelector("#page-status");
    status.textContent = "This page is for the studio.";
    status.hidden = false;
    return;
  }
  adminView.hidden = false;
  loadRegistrations();
  loadMembers();
});
