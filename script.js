const page = document.querySelector(".page");
const currentPage = window.location.pathname.split("/").pop() || "index.html";

const favicon = document.createElement("link");
favicon.rel = "icon";
favicon.href = "favicon.svg";
favicon.type = "image/svg+xml";
document.head.appendChild(favicon);

const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector(".site-nav");
const navLinks = document.querySelectorAll(".nav-links a");

document
  .querySelector(`.nav-links a[href="${currentPage}"]`)
  ?.setAttribute("aria-current", "page");

if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", isOpen);
  });
}

navLinks.forEach((navLink) => {
  navLink.addEventListener("click", () => {
    siteNav.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
  });
});
