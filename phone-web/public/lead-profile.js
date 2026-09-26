// Reuse the live controls and their listeners inside a compact profile card.
export function buildLeadProfile(card, history, lead, expanded = false) {
  const bio = document.createElement('details');
  bio.className = 'profileBio';
  bio.open = expanded;
  const summary = document.createElement('summary');
  summary.innerHTML = '<span class="bioClosed">View details</span><span class="bioOpened">Close details</span><span class="bioSubtitle">Contact info · comments · history</span>';
  bio.append(summary);
  const body = document.createElement('div');
  body.className = 'profileBioBody';
  for (const item of [...card.children]) {
    if (item.matches('.detail,.leadNotes,.timingInsight')) body.append(item);
  }
  body.append(history);
  bio.append(body);
  const hero = document.createElement('div');
  hero.className = 'profileHero';
  for (const item of [...card.children]) {
    if (item.matches('.requestBadge,h2')) hero.append(item);
  }
  card.prepend(hero);
  const cues = document.createElement('div');
  cues.className = 'profileSwipeCues';
  cues.setAttribute('aria-hidden', 'true');
  cues.innerHTML = '<span>← No answer</span><span>Appointment →</span>';
  const stamp = document.createElement('div');
  stamp.className = 'profileSwipeStamp';
  stamp.setAttribute('aria-hidden', 'true');
  const down = document.createElement('span'); down.className = 'profileRefusedCue'; down.textContent = '↓ Refused appointment';
  cues.append(down);
  card.append(stamp, cues, bio);
  card.classList.add('profileCard');
}
