// <tier-picker name="tier" required>: membership tier radio buttons.
// Renders into light DOM so the radios submit with the surrounding form and
// pick up the site styles.
import { TIERS } from "../studio.js?v=3";

class TierPicker extends HTMLElement {
  connectedCallback() {
    if (this.hasChildNodes()) return;
    const name = this.getAttribute("name") || "tier";

    const fieldset = document.createElement("fieldset");
    fieldset.className = "choice-group";
    const legend = document.createElement("legend");
    legend.textContent = this.getAttribute("legend") || "Membership tier";
    fieldset.append(legend);

    Object.entries(TIERS).forEach(([value, tier], index) => {
      const label = document.createElement("label");
      label.className = "choice";
      label.innerHTML = `<input type="radio" /><span><strong></strong></span>`;
      const input = label.querySelector("input");
      input.name = name;
      input.value = value;
      if (index === 0 && this.hasAttribute("required")) input.required = true;
      label.querySelector("strong").textContent = `${tier.name} · $${tier.price}/month`;
      label.querySelector("span").append(tier.perks);
      fieldset.append(label);
    });

    this.append(fieldset);
  }

  get value() {
    return this.querySelector("input:checked")?.value ?? null;
  }

  set value(tier) {
    this.querySelectorAll("input").forEach((input) => {
      input.checked = input.value === tier;
    });
  }
}

customElements.define("tier-picker", TierPicker);
