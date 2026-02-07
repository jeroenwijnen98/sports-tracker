import { getAll } from '../db.js';
import { createRunCard } from '../components/runCard.js';

const panel = document.getElementById('tab-activities');

export async function renderActivities() {
  const exercises = await getAll('exercises');

  // Sort by start-time descending (newest first)
  exercises.sort((a, b) => {
    const dateA = a['start-time'] || '';
    const dateB = b['start-time'] || '';
    return dateB.localeCompare(dateA);
  });

  panel.innerHTML = '';

  if (exercises.length === 0) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏃</div>
        <h3>Nog geen activiteiten</h3>
        <p>Druk op de sync knop om je hardloopdata van Polar op te halen.</p>
      </div>
    `;
    return;
  }

  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <h2>Activities</h2>
    <span class="count">${exercises.length} runs</span>
  `;
  panel.appendChild(header);

  const list = document.createElement('div');
  list.className = 'card-list';

  for (const exercise of exercises) {
    list.appendChild(createRunCard(exercise));
  }

  panel.appendChild(list);
}
