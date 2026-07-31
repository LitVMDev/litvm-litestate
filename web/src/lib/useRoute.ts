import { useEffect, useState } from "react";

export type Route = "home" | "how" | "app";

const ROUTES: Record<string, Route> = {
  "": "home",
  home: "home",
  how: "how",
  "how-it-works": "how",
  app: "app",
};

export type Location = { route: Route; section?: string };

/// Hash-based routing on purpose. Path routing needs a server that rewrites
/// unknown paths to index.html; a hash works from any static host, including
/// IPFS gateways and a folder opened locally.
///
/// The hash carries two things: which page, and which heading on it, separated
/// by a second '#'. So "#/how#approval" is the approval section of How it
/// works, and stays shareable.
///
/// A hash naming no known page is read as a heading on the page already
/// showing — which is what a bare "#idea" from a table of contents is. Parsing
/// those as routes is what used to drop people on the landing page, still
/// scrolled to wherever they had been, since the heading they asked for was no
/// longer on screen to scroll to.
function parse(current: Route): Location {
  const raw = window.location.hash.replace(/^#/, "");
  const [pathPart = "", sectionPart] = raw.split("#");
  const path = pathPart.replace(/^\//, "");
  const route = ROUTES[path];

  if (route === undefined) {
    return { route: current, section: path || undefined };
  }

  return { route, section: sectionPart || undefined };
}

export function useRoute(): [Route, (r: Route) => void, string | undefined] {
  const [loc, setLoc] = useState<Location>(() => parse("home"));

  useEffect(() => {
    const onChange = () => setLoc((prev) => parse(prev.route));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Scrolling is deliberately not done here: navigate() is only one of the ways
  // the hash changes (every link in the header is a plain anchor), so the
  // scroll belongs with the route, not with this one function.
  const navigate = (r: Route) => {
    window.location.hash = r === "home" ? "/" : `/${r}`;
  };

  return [loc.route, navigate, loc.section];
}

export const href: Record<Route, string> = {
  home: "#/",
  how: "#/how",
  app: "#/app",
};

/// Link to a heading on a page, e.g. sectionHref("how", "approval").
export function sectionHref(route: Route, id: string): string {
  return `${href[route]}#${id}`;
}
