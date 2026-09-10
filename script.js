const page = document.querySelector(".page");
const currentPage = window.location.pathname.split("/").pop() || "index.html";

page.insertAdjacentHTML(
  "afterbegin",
  `<nav class="site-nav" aria-label="Main navigation">
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav-links">
      <span class="menu-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      Menu
    </button>
    <div class="nav-links" id="nav-links">
      <a href="index.html" data-page="index.html">Home</a>
      <a href="about.html" data-page="about.html">About</a>
      <a href="membership.html" data-page="membership.html">Membership</a>
    </div>
  </nav>`,
);

const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector(".site-nav");
const navLinks = document.querySelectorAll(".nav-links a");

document
  .querySelector(`[data-page="${currentPage}"]`)
  ?.setAttribute("aria-current", "page");

menuToggle.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", isOpen);
});

navLinks.forEach((navLink) => {
  navLink.addEventListener("click", () => {
    siteNav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});
