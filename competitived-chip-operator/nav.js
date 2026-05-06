const links = Array.from(document.querySelectorAll(".navlinks a"))
  .filter((link) => {
    const href = link.getAttribute("href") || "";
    return href.startsWith("#") && href.length > 1;
  });
const sections = Array.from(document.querySelectorAll("section.floor"));

const byId = new Map(links.map((link) => [link.getAttribute("href").slice(1), link]));

const setActive = (id) => {
  links.forEach((link) => link.classList.remove("active"));
  const link = byId.get(id);
  if (link) link.classList.add("active");
};

const observer = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  setActive(visible.target.id);
}, { rootMargin: "-20% 0px -45% 0px", threshold: [0.15, 0.35, 0.6] });

sections.forEach((section) => observer.observe(section));

if (location.hash && byId.has(location.hash.slice(1))) {
  setActive(location.hash.slice(1));
}
