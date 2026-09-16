// ESPN occasionally rejects date ranges while individual days remain available.
async function fixturesInRange(start, end, request, calendarDays) {
  try {
    const result = await request(`${start}-${end}`);
    if (!Array.isArray(result.events)) throw Error('Missing events');
    return result.events;
  } catch {
    const parse = s => new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`);
    let days = calendarDays ? await calendarDays() : null;
    if (!days) {
      days = [];
      for (let d = parse(start); d <= parse(end); d.setUTCDate(d.getUTCDate()+1)) days.push(d.toISOString().slice(0,10).replace(/-/g,''));
    }
    days = [...new Set(days)].filter(d=>d>=start&&d<=end);
    let cursor = 0;
    const events = [];
    await Promise.all(Array.from({length:Math.min(6,days.length)},async()=>{
      while(cursor < days.length) {
        const result = await request(days[cursor++]);
        if (!Array.isArray(result.events)) throw Error('Missing events');
        events.push(...result.events);
      }
    }));
    return [...new Map(events.map(e=>[e.id,e])).values()];
  }
}
module.exports = {fixturesInRange};
