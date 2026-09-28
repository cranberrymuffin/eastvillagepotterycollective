// Members page (studio admins only): add members, and view and edit each
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
import { TIERS, formatPlainDate } from "../studio.js?v=3";
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
  if (error.code === "23P01") return "That overlaps another period for this member.";
  if (error.code === "23505") {
    return "Only one period can have no end date. Give the current period an end date first.";
  }
  if (error.code === "23514") return "The end date can't be before the start date.";
  return "Couldn't save. Please try again.";
};

// Adding a member --------------------------------------------------------------

const ADD_ERRORS = {
  email_exists: "There's already an account with that email.",
  rate_limited:
    "Too many invite emails were sent recently. Please wait a few minutes and try again.",
  invalid_input: "Please enter a valid email and choose a tier.",
  not_admin: "Only the studio account can add members.",
};

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = addForm.email.value.trim();
  withForm(addForm, "Adding…", async () => {
    const { error } = await supabase.functions.invoke("create-member", {
      body: {
        email,
        tier: tierPicker.value,
        full_name: addForm.full_name.value.trim(),
      },
    });
    if (error) {
      // The function's JSON error code, when it sent one.
      const code = await error.context?.json?.().then((body) => body.error).catch(() => null);
      console.error(error, code);
      setStatus(addForm, ADD_ERRORS[code] ?? "Couldn't add the member. Please try again.", true);
      return;
    }
    addForm.reset();
    setStatus(addForm, `Added ${email}. They'll get an email to set their password.`);
    loadMembers();
  });
});

// Tier history -------------------------------------------------------------------

const tierSelect = (value) => {
  const select = el("select");
  select.name = "tier";
  select.required = true;
  Object.entries(TIERS).forEach(([key, tier]) => {
    const option = el("option", null, `${tier.name} · $${tier.price}/month`);
    option.value = key;
    option.selected = key === value;
    select.append(option);
  });
  return select;
};

const dateField = (label, name, value, required) => {
  const field = el("label", "field");
  const input = el("input");
  input.type = "date";
  input.name = name;
  input.value = value ?? "";
  input.required = required;
  field.append(el("span", null, label), input);
  return field;
};

// One period as a small form: tier, start, end, Save / Delete. With no
// period it's the "Add a period" form.
const renderPeriod = (member, period, reload) => {
  const form = el("form", "period-form");
  const tierField = el("label", "field");
  tierField.append(el("span", null, "Tier"), tierSelect(period?.tier ?? "tier_1"));
  form.append(
    tierField,
    dateField("Starts", "starts_on", period?.starts_on, true),
    dateField("Ends (blank = current)", "ends_on", period?.ends_on, false),
  );

  const actions = el("div", "piece-actions");
  const save = el("button", "button", period ? "Save" : "Add period");
  save.type = "submit";
  actions.append(save);
  if (period) {
    const remove = el("button", "button button-quiet", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (!window.confirm("Delete this period from their history?")) return;
      withForm(form, "Deleting…", async () => {
        const { error } = await supabase.from("membership_periods").delete().eq("id", period.id);
        if (error) {
          console.error(error);
          setStatus(form, "Couldn't delete. Please try again.", true);
        } else {
          reload();
        }
      });
    });
    actions.append(remove);
  }
  const status = el("p", "form-status");
  status.setAttribute("role", "status");
  form.append(actions, status);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = {
      tier: form.tier.value,
      starts_on: form.starts_on.value,
      ends_on: form.ends_on.value || null,
    };
    withForm(form, "Saving…", async () => {
      const { error } = period
        ? await supabase.from("membership_periods").update(values).eq("id", period.id)
        : await supabase.from("membership_periods").insert({ ...values, user_id: member.id });
      if (error) {
        console.error(error);
        setStatus(form, periodErrorMessage(error), true);
      } else {
        reload();
      }
    });
  });
  return form;
};

const currentTierLabel = (periods) => {
  const open = periods.find((period) => !period.ends_on);
  return open ? TIERS[open.tier]?.name ?? open.tier : "No current tier";
};

const renderMember = (member, periods) => {
  const item = el("li");
  const details = el("details", "admin-member");
  const summary = el("summary");
  const name = el("strong", null, member.full_name || member.email);
  const meta = el("span", "admin-member-meta");
  summary.append(name, meta);
  details.append(summary);

  const body = el("div", "admin-member-body");
  details.append(body);

  const show = (memberPeriods) => {
    const since = memberPeriods[0]?.starts_on;
    meta.textContent = [
      member.full_name ? member.email : null,
      currentTierLabel(memberPeriods),
      since ? `since ${formatPlainDate(since, "short")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const reload = async () => {
      const { data, error } = await supabase
        .from("membership_periods")
        .select("id, tier, starts_on, ends_on")
        .eq("user_id", member.id)
        .order("starts_on");
      if (error) console.error(error);
      show(data ?? []);
    };

    const list = el("ol", "period-list");
    list.append(
      ...[...memberPeriods].reverse().map((period) => {
        const row = el("li");
        row.append(renderPeriod(member, period, reload));
        return row;
      }),
    );
    body.replaceChildren(
      ...(memberPeriods.length
        ? [list]
        : [el("p", "field-note", "No tier history yet.")]),
      el("h3", null, "Add a period"),
      renderPeriod(member, null, reload),
    );
  };

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
  loadMembers();
});
