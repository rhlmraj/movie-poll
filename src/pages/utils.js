export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function getPosterUrl(path, size = 'w342') {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9._-]+$/.test(path)) return '';
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function renderPoster(path, title, size = 'w342') {
  const url = getPosterUrl(path, size);
  return url
    ? `<img class="movie-poster" src="${url}" alt="Poster for ${escapeHtml(title)}" loading="lazy" />`
    : '<div class="poster-placeholder" aria-label="No poster available"><span aria-hidden="true">✦</span></div>';
}

export function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function signInPrompt() {
  return '<button class="button button-primary" type="button" data-sign-in>Sign in with Google</button>';
}

export function renderVoteChoice(option, checked, alreadyVoted, disabled = false) {
  const isDisabled = alreadyVoted || disabled;
  return `
    <label class="vote-choice${checked ? ' is-selected' : ''}${isDisabled ? ' is-locked' : ''}">
      <input type="checkbox" data-option-choice="${escapeHtml(option.id)}" aria-label="Vote for ${escapeHtml(option.title)}" ${checked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''} />
      <span>${alreadyVoted ? 'Voted' : 'Select'}</span>
    </label>
  `;
}

export function showSignInPrompt() {
  window.dispatchEvent(new CustomEvent('movie-poll:sign-in'));
}
