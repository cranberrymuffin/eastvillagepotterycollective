// <site-nav>: the main navigation shared by every page.
// Shows "My account" (with a hover menu) instead of "Login" when this
// browser has a member session. It reads the Supabase session key directly
// so public pages don't have to load the Supabase library.
import { SUPABASE_URL } from "/members/config.js";

const LINKS = [
  ["/", "Home"],
  ["/about/", "About"],
  ["/membership/", "Membership"],
];

const sessionKey = SUPABASE_URL
  ? `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`
  : null;

const isLoggedIn = () => {
  try {
    return Boolean(sessionKey && localStorage.getItem(sessionKey));
  } catch {
    return false;
  }
};

const currentPath = () => {
  const { pathname } = window.location;
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
};

class SiteNav extends HTMLElement {
  connectedCallback() {
    this.render();
    // Fired by the members pages on login/logout, and by other tabs.
    window.addEventListener("member-auth-change", this.render);
    window.addEventListener("storage", this.render);
  }

  disconnectedCallback() {
    window.removeEventListener("member-auth-change", this.render);
    window.removeEventListener("storage", this.render);
  }

  render = () => {
    const loggedIn = isLoggedIn();
    const links = loggedIn ? LINKS : [...LINKS, ["/members/", "Login"]];

    const nav = document.createElement("nav");
    nav.className = "site-nav";
    nav.setAttribute("aria-label", "Main navigation");
    nav.innerHTML = `
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav-links">
        <span class="menu-icon" aria-hidden="true"><span></span><span></span><span></span></span>
        Menu
      </button>
      <div class="nav-links" id="nav-links"></div>`;

    const toggle = nav.querySelector(".menu-toggle");
    const linkList = nav.querySelector(".nav-links");
    const here = currentPath();

    const makeLink = ([href, label]) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      if (href === here) link.setAttribute("aria-current", "page");
      link.addEventListener("click", () => {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
      return link;
    };

    linkList.append(...links.map(makeLink));
    if (loggedIn) linkList.append(this.accountMenu(makeLink, here));

    toggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen);
    });

    this.replaceChildren(nav);
  };

  // "My account" with a menu that opens on hover or keyboard focus.
  accountMenu(makeLink, here) {
    const menu = document.createElement("div");
    menu.className = "nav-menu";

    const trigger = makeLink(["/members/account/", "My account"]);
    if (here.startsWith("/members/")) trigger.setAttribute("aria-current", "page");
    trigger.setAttribute("aria-haspopup", "true");

    const submenu = document.createElement("div");
    submenu.className = "nav-submenu";
    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.textContent = "Sign out";
    signOut.addEventListener("click", async () => {
      // Loaded on demand so public pages don't pull in the Supabase library.
      const { supabase } = await import("/members/shared.js");
      await supabase?.auth.signOut();
      window.location.assign("/members/");
    });
    submenu.append(
      makeLink(["/members/", "Bisque log"]),
      makeLink(["/members/account/", "Account settings"]),
      signOut,
    );

    menu.append(trigger, submenu);
    return menu;
  }
}

customElements.define("site-nav", SiteNav);
