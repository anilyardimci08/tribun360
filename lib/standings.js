'use strict';
const key = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function appStat(entry, names) {
  // Exact aliases only: P must never match GP or pointsAgainst.
  for (const name of names) {
    const stat = (entry.stats || []).find(s =>
      [s.name, s.type, s.abbreviation, s.displayName, s.shortDisplayName].some(k => key(k) === key(name)));
    if (stat) return stat.value ?? stat.displayValue ?? null;
  }
  return null;
}
function appStandingsEntries(data) {
  const rows = [], seen = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.team && Array.isArray(value.stats)) {
      const id = String(value.team.id || value.team.uid || value.team.displayName || '');
      if (id && !seen.has(id)) { seen.add(id); rows.push(value); }
      return;
    }
    Object.values(value).forEach(walk);
  }
  walk(data); return rows;
}
function appStandings(data, league) {
  const number = value => value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  return appStandingsEntries(data).map((entry, index) => {
    const t = entry.team, stat = names => number(appStat(entry, names));
    const logo = t.logos?.[0] || t.logo;
    return {rank: stat(['rank', 'position']) ?? index + 1, teamId: String(t.id || t.uid || ''),
      name: t.displayName || t.name || '', shortName: t.shortDisplayName || t.abbreviation || '',
      logo: typeof logo === 'string' ? logo : logo?.href || logo?.url || '', league,
      played: stat(['gamesPlayed','played','gp']), wins: stat(['wins','w']),
      draws: stat(['ties','draws','d']), losses: stat(['losses','l']),
      gf: stat(['pointsFor','goalsFor','gf','f']), ga: stat(['pointsAgainst','goalsAgainst','ga','a']),
      gd: stat(['pointDifferential','goalDifference','gd']), points: stat(['points','pts','p'])};
  }).sort((a,b) => a.rank - b.rank);
}
module.exports = {appStat, appStandingsEntries, appStandings};
