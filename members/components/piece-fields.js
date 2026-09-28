// <piece-fields>: title, description, size and a live firing-cost estimate
// for a piece. Used by the "Submit a piece" form and the edit form on each
// piece card. Renders into light DOM so the inputs belong to the parent form.
import { formatVolume } from "../studio.js?v=2";

const DIMENSIONS = [
  ["length_in", "Length"],
  ["width_in", "Width"],
  ["height_in", "Height"],
];

class PieceFields extends HTMLElement {
  connectedCallback() {
    if (this.hasChildNodes()) return;

    this.innerHTML = `
      <label class="field">
        <span>Title</span>
        <input type="text" name="title" maxlength="120" required />
      </label>
      <label class="field">
        <span>Description</span>
        <textarea name="description" rows="3" maxlength="2000"></textarea>
      </label>
      <fieldset class="dimensions">
        <legend>Size (inches)</legend>
      </fieldset>
      <p class="field-note volume-estimate"></p>`;

    const fieldset = this.querySelector("fieldset");
    DIMENSIONS.forEach(([name, label]) => {
      const field = document.createElement("label");
      field.className = "field";
      field.innerHTML = `<span></span><input type="number" min="0.25" max="999" step="0.25" inputmode="decimal" required />`;
      field.querySelector("span").textContent = label;
      field.querySelector("input").name = name;
      fieldset.append(field);
    });

    this.addEventListener("input", this.#updateEstimate);
  }

  #input(name) {
    return this.querySelector(`[name="${name}"]`);
  }

  get value() {
    const [length_in, width_in, height_in] = DIMENSIONS.map(([name]) =>
      Number(this.#input(name).value),
    );
    return {
      title: this.#input("title").value.trim(),
      description: this.#input("description").value.trim() || null,
      length_in,
      width_in,
      height_in,
    };
  }

  set value(piece) {
    this.#input("title").value = piece.title ?? "";
    this.#input("description").value = piece.description ?? "";
    DIMENSIONS.forEach(([name]) => {
      this.#input(name).value = piece[name] == null ? "" : Number(piece[name]);
    });
    this.#updateEstimate();
  }

  // Call after the surrounding form is reset.
  reset() {
    this.#updateEstimate();
  }

  focus() {
    this.#input("title").focus();
  }

  #updateEstimate = () => {
    const { length_in, width_in, height_in } = this.value;
    this.querySelector(".volume-estimate").textContent =
      length_in && width_in && height_in
        ? formatVolume(length_in, width_in, height_in)
        : "";
  };
}

customElements.define("piece-fields", PieceFields);
