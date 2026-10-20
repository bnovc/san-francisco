export type QuestKind = 'flavor' | 'landmark' | 'transit' | 'adventure' | 'culture' | 'view' | 'photo';
export type QuestStatus = 'available' | 'active' | 'completed';

export interface QuestDefinition {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  kind: QuestKind;
  icon: string;
  steps: string[];
  reward: string;
  location: string;
}

export interface QuestState {
  status: QuestStatus;
  progress: number;
}

export interface QuestSnapshot {
  id: string;
  title: string;
  status: QuestStatus;
  progress: number;
  total: number;
}

/**
 * The first-pass quest catalogue. The definitions are intentionally independent
 * of the world so real locations and activities can be wired in incrementally.
 */
export const SF_QUESTS: QuestDefinition[] = [
  {
    id: 'perfect-pour',
    title: 'Perfect Pour',
    subtitle: 'Get a third-wave coffee',
    description: 'Find a serious little roaster, order something with tasting notes, and let the city wake you up.',
    kind: 'flavor',
    icon: '☕',
    steps: ['Find a local roaster', 'Order your pick-me-up', 'Take the first sip like it changed your life'],
    reward: '250 SF cred',
    location: 'Coffee shop TBD',
  },
  {
    id: 'span-the-fog',
    title: 'Span the Fog',
    subtitle: 'Visit the Golden Gate Bridge',
    description: 'Stand beneath the orange towers, look west, and confirm that the fog is absolutely showing off.',
    kind: 'landmark',
    icon: '🌉',
    steps: ['Reach the bridge', 'Look out over the strait', 'Get a fog-level view'],
    reward: '500 SF cred',
    location: 'Golden Gate Bridge',
  },
  {
    id: 'ring-the-bell',
    title: 'Ring the Bell',
    subtitle: 'Ride a cable car',
    description: 'Hop aboard, grab a rail, and let an actual bell announce your trip up the hill.',
    kind: 'transit',
    icon: '🚋',
    steps: ['Find a cable car stop', 'Board the car', 'Ride one full block'],
    reward: '400 SF cred',
    location: 'Powell cable car line',
  },
  {
    id: 'grip-the-city',
    title: 'Grip the City',
    subtitle: 'Go rock climbing',
    description: 'Trade the sidewalk grid for a climbing wall and earn your own tiny summit story.',
    kind: 'adventure',
    icon: '🧗',
    steps: ['Find a climbing gym or crag', 'Reach the top of a route', 'Stick the landing'],
    reward: '450 SF cred',
    location: 'Climbing spot TBD',
  },
  {
    id: 'mission-color-run',
    title: 'Mission Color Run',
    subtitle: 'Find a Mission mural',
    description: 'Track down a wall-sized burst of color and give the neighborhood’s public art a proper look.',
    kind: 'culture',
    icon: '🎨',
    steps: ['Enter the Mission', 'Find a mural', 'Name your favorite color in it'],
    reward: '300 SF cred',
    location: 'Mission District',
  },
  {
    id: 'sourdough-diplomacy',
    title: 'Sourdough Diplomacy',
    subtitle: 'Eat something in a bread bowl',
    description: 'Settle the eternal waterfront question: soup first, bread first, or both at once?',
    kind: 'flavor',
    icon: '🥖',
    steps: ['Reach the waterfront', 'Acquire a bread bowl', 'Protect it from hungry gulls'],
    reward: '350 SF cred',
    location: "Fisherman's Wharf",
  },
  {
    id: 'above-the-grid',
    title: 'Above the Grid',
    subtitle: 'Catch sunset from Twin Peaks',
    description: 'Watch the avenues turn into ribbons of light before the fog decides whether to stay.',
    kind: 'view',
    icon: '🌇',
    steps: ['Climb to the overlook', 'Arrive during golden hour', 'Spot downtown through the fog'],
    reward: '500 SF cred',
    location: 'Twin Peaks',
  },
  {
    id: 'postcard-row',
    title: 'Postcard Row',
    subtitle: 'Frame the Painted Ladies',
    description: 'Find the city’s famous row of colors and compose a shot that your group chat will actually like.',
    kind: 'photo',
    icon: '📸',
    steps: ['Reach Alamo Square', 'Frame the Painted Ladies', 'Take the postcard shot'],
    reward: '300 SF cred',
    location: 'Alamo Square',
  },
];

const KIND_LABELS: Record<QuestKind, string> = {
  flavor: 'TASTE',
  landmark: 'LANDMARK',
  transit: 'TRANSIT',
  adventure: 'ADVENTURE',
  culture: 'CULTURE',
  view: 'VIEWPOINT',
  photo: 'PHOTO OP',
};

const STATUS_LABELS: Record<QuestStatus, string> = {
  available: 'AVAILABLE',
  active: 'TRACKING',
  completed: 'COMPLETE',
};

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Small data-driven quest log. World systems can call setProgress/complete when
 * location, interaction, transit, or activity triggers become available.
 */
export class QuestSystem {
  readonly definitions = SF_QUESTS;
  private readonly states = new Map<string, QuestState>();
  private readonly panel = document.getElementById('quest-panel')!;
  private readonly list = document.getElementById('quest-list')!;
  private readonly summary = document.getElementById('quest-summary')!;
  private readonly toggleButton = document.getElementById('quest-toggle')!;
  private readonly count = document.getElementById('quest-count')!;
  private readonly toast = document.getElementById('toast')!;
  private toastTimer = 0;

  constructor() {
    this.definitions.forEach((quest, index) => this.states.set(quest.id, { status: index === 0 ? 'active' : 'available', progress: 0 }));
    this.toggleButton.addEventListener('click', () => this.toggle());
    document.getElementById('quest-close')?.addEventListener('click', () => this.setOpen(false));
    this.render();
  }

  toggle() { this.setOpen(!this.panel.classList.contains('open')); }

  setOpen(open: boolean) {
    this.panel.classList.toggle('open', open);
    this.toggleButton.setAttribute('aria-expanded', String(open));
  }

  activate(id: string): boolean {
    const quest = this.definitions.find((item) => item.id === id);
    const state = quest && this.states.get(id);
    if (!quest || !state || state.status === 'completed') return false;
    state.status = 'active';
    this.emit('activate', id);
    this.render();
    this.showToast(`Quest tracking · ${quest.title}`);
    return true;
  }

  setProgress(id: string, progress: number): boolean {
    const quest = this.definitions.find((item) => item.id === id);
    const state = quest && this.states.get(id);
    if (!quest || !state) return false;
    if (state.status === 'completed') return true;
    state.status = 'active';
    const requested = Number.isFinite(progress) ? progress : 0;
    state.progress = Math.max(0, Math.min(quest.steps.length, Math.floor(requested)));
    if (state.progress === quest.steps.length) state.status = 'completed';
    this.emit(state.status === 'completed' ? 'complete' : 'progress', id, state.progress);
    this.render();
    if (state.status === 'completed') this.showToast(`Quest complete · ${quest.title} · +${quest.reward}`);
    return true;
  }

  complete(id: string): boolean {
    const quest = this.definitions.find((item) => item.id === id);
    return quest ? this.setProgress(id, quest.steps.length) : false;
  }

  snapshot(): QuestSnapshot[] {
    return this.definitions.map((quest) => {
      const state = this.states.get(quest.id)!;
      return { id: quest.id, title: quest.title, status: state.status, progress: state.progress, total: quest.steps.length };
    });
  }

  private emit(event: 'activate' | 'progress' | 'complete', id: string, progress?: number) {
    document.dispatchEvent(new CustomEvent('twin:quest', { detail: { event, id, progress, status: this.states.get(id)?.status } }));
  }

  private showToast(message: string) {
    this.toast.textContent = message;
    this.toast.style.display = 'block';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast.style.display = 'none'; }, 3000);
  }

  private render() {
    const snapshot = this.snapshot();
    const completed = snapshot.filter((quest) => quest.status === 'completed').length;
    const active = snapshot.filter((quest) => quest.status === 'active').length;
    this.count.textContent = `${completed}/${snapshot.length}`;
    this.summary.textContent = `${completed} complete · ${active} tracking · pick a side quest and make the city yours.`;
    this.list.replaceChildren();

    const ordered = [...this.definitions].sort((a, b) => {
      const rank = (status: QuestStatus) => status === 'active' ? 0 : status === 'available' ? 1 : 2;
      return rank(this.states.get(a.id)!.status) - rank(this.states.get(b.id)!.status);
    });
    for (const quest of ordered) this.list.appendChild(this.renderQuest(quest, this.states.get(quest.id)!));
  }

  private renderQuest(quest: QuestDefinition, state: QuestState) {
    const card = node('article', `quest-card ${state.status}`);
    const top = node('div', 'quest-card-top');
    top.append(node('span', 'quest-icon', quest.icon));
    const heading = node('div', 'quest-heading');
    heading.append(node('span', 'quest-kind', KIND_LABELS[quest.kind]), node('h3', '', quest.title));
    top.appendChild(heading);
    top.appendChild(node('span', 'quest-status', STATUS_LABELS[state.status]));
    card.appendChild(top);
    card.appendChild(node('p', 'quest-subtitle', quest.subtitle));
    card.appendChild(node('p', 'quest-description', quest.description));

    const steps = node('div', 'quest-steps');
    quest.steps.forEach((step, index) => {
      const row = node('div', `quest-step ${index < state.progress ? 'done' : ''}`);
      row.append(node('span', 'quest-step-mark', index < state.progress ? '✓' : '○'), node('span', '', step));
      steps.appendChild(row);
    });
    card.appendChild(steps);

    const footer = node('div', 'quest-footer');
    footer.append(node('span', '', quest.location), node('span', 'quest-reward', `+${quest.reward}`));
    card.appendChild(footer);
    if (state.status === 'available') {
      const button = node('button', 'quest-action', 'Track this quest');
      button.type = 'button';
      button.addEventListener('click', () => this.activate(quest.id));
      card.appendChild(button);
    } else if (state.status === 'active') {
      card.appendChild(node('div', 'quest-placeholder', 'World trigger queued for a future pass'));
    }
    return card;
  }
}
