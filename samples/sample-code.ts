export function renderModelCard(user_profle_name: string) {
  const HTTPServerConfig = "ready";
  const homerseklet = "normal";
  const modell = "domain";
  return `${HTTPServerConfig}-${user_profle_name}-${homerseklet}-${modell}`;
}
