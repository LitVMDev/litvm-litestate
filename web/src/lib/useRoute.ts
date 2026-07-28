import { useEffect, useState } from "react";

export type Route = "home" | "how" | "app";

/// Hash-based routing on purpose. Path routing needs a server that rewrites
/// unknown paths to index.html; a hash works from any static host, including
/// IPFS gateways and a folder opened locally.
function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "how" || h === "how-it-works") return "how";
  if (h === "app") return "app";
  return "home";
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = r === "home" ? "/" : `/${r}`;
    window.scrollTo({ top: 0 });
  };

  return [route, navigate];
}

export const href: Record<Route, string> = {
  home: "#/",
  how: "#/how",
  app: "#/app",
};
