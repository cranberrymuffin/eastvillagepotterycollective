// <payment-fields>: Venmo/Zelle choice, the member's handle, a link to check
// their Venmo profile, and a "this is my account" confirmation.
//
// Venmo and Zelle have no API for confirming who owns an account, so members
// check it themselves here, and the studio marks it verified
// (profiles.payment_verified) once a payment from it arrives. The
// confirmation is only asked for when the details differ from `saved`.

const METHODS = {
  venmo: {
    name: "Venmo",
    label: "Venmo username",
    placeholder: "@username",
    // Venmo usernames: 5–30 letters, numbers, hyphens or underscores.
    pattern: "@?[A-Za-z0-9_\\-]{5,30}",
    confirm: "I've opened the link above and it's my Venmo account.",
  },
  zelle: {
    name: "Zelle",
    label: "Zelle email or phone number",
    placeholder: "you@example.com or 212-555-0123",
    pattern: null,
    confirm: "This is the email or phone number registered with my Zelle.",
  },
};

export const normalizeHandle = (method, handle) =>
  method === "venmo" ? handle.trim().replace(/^@/, "") : handle.trim();

export const venmoProfileUrl = (username) =>
  `https://venmo.com/u/${encodeURIComponent(username)}`;

class PaymentFields extends HTMLElement {
  #saved = { method: null, handle: null };

  connectedCallback() {
    if (this.hasChildNodes()) return;

    this.innerHTML = `
      <fieldset class="choice-group">
        <legend></legend>
        <div class="choice-row"></div>
        <label class="field">
          <span class="payment-handle-label">Venmo username or Zelle email/phone</span>
          <input type="text" name="payment_handle" maxlength="100" autocomplete="off" required />
        </label>
        <p class="payment-preview" hidden>
          Check this is you: <a target="_blank" rel="noopener"></a>
        </p>
        <label class="checkbox payment-confirm" hidden>
          <input type="checkbox" name="payment_confirmed" />
          <span></span>
        </label>
        <p class="field-note">
          So we can match your membership payments. We never charge your account.
        </p>
      </fieldset>`;

    this.querySelector("legend").textContent =
      this.getAttribute("legend") || "How you'll pay";

    const row = this.querySelector(".choice-row");
    Object.entries(METHODS).forEach(([value, method], index) => {
      const label = document.createElement("label");
      label.className = "choice";
      label.innerHTML = `<input type="radio" name="payment_method" /><span><strong></strong></span>`;
      const input = label.querySelector("input");
      input.value = value;
      if (index === 0) input.required = true;
      label.querySelector("strong").textContent = method.name;
      row.append(label);
    });

    this.addEventListener("input", this.#update);
    this.addEventListener("change", this.#update);
    this.#update();
  }

  get method() {
    return this.querySelector("input[name=payment_method]:checked")?.value ?? null;
  }

  get handle() {
    return normalizeHandle(this.method, this.querySelector("input[name=payment_handle]").value);
  }

  // Fills in the member's current details; unchanged details need no re-confirming.
  setSaved(method, handle) {
    this.#saved = { method, handle };
    this.querySelectorAll("input[name=payment_method]").forEach((input) => {
      input.checked = input.value === method;
    });
    this.querySelector("input[name=payment_handle]").value =
      method === "venmo" && handle ? `@${handle}` : handle ?? "";
    this.#update();
  }

  // Call after the surrounding form is reset.
  reset() {
    this.#saved = { method: null, handle: null };
    this.#update();
  }

  #update = () => {
    const method = this.method;
    const fields = METHODS[method];
    const handleInput = this.querySelector("input[name=payment_handle]");

    if (fields) {
      this.querySelector(".payment-handle-label").textContent = fields.label;
      handleInput.placeholder = fields.placeholder;
      if (fields.pattern) handleInput.pattern = fields.pattern;
      else handleInput.removeAttribute("pattern");
      this.querySelector(".payment-confirm span").textContent = fields.confirm;
    }

    const handle = this.handle;
    const preview = this.querySelector(".payment-preview");
    preview.hidden = !(method === "venmo" && handle && handleInput.checkValidity());
    if (!preview.hidden) {
      const link = preview.querySelector("a");
      link.href = venmoProfileUrl(handle);
      link.textContent = `venmo.com/u/${handle}`;
    }

    const changed = method !== this.#saved.method || handle !== this.#saved.handle;
    const confirm = this.querySelector(".payment-confirm");
    const confirmBox = confirm.querySelector("input");
    confirm.hidden = !(fields && handle && changed);
    confirmBox.required = !confirm.hidden;
    if (confirm.hidden) confirmBox.checked = false;
  };
}

customElements.define("payment-fields", PaymentFields);
