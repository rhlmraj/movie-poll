import { fetchActivePolls, fetchUserVotes, submitVotes } from '../pollData.js';
import { escapeHtml, formatDate, getPosterUrl, renderPoster, renderVoteChoice, signInPrompt, showSignInPrompt } from './utils.js';

const KEYWORD = 'padathinuvarunno';
const LETTERBOXD_PROXY_URL = import.meta.env.VITE_LETTERBOXD_PROXY_URL;
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY;

export function mountHomePage(container, user) {
  let disposed = false;
  const pollStates = new Map();

  container.innerHTML = `
    <section class="hero page-card">
      <p class="eyebrow">A little friendly competition</p>
      <h1>Pick your movies.<br /><span>Let the votes decide.</span></h1>
      <p class="hero-copy">Create a movie poll whenever you like, share it with friends, and find out which films win.</p>
      <a class="button button-primary" href="#/create">Create a poll <span aria-hidden="true">→</span></a>
    </section>
    <section class="active-poll-section" aria-labelledby="active-poll-title">
      <div class="section-heading">
        <p class="eyebrow">The community is choosing</p>
        <h2 id="active-poll-title">Active polls</h2>
      </div>
      <div id="active-poll-content"><div class="loading-state" role="status">Finding active polls…</div></div>
    </section>
    <section class="featured-movies" aria-labelledby="featured-movies-title">
      <div class="section-heading"><h2 id="featured-movies-title">Featured movies</h2></div>
      <div class="featured-poster-grid" aria-label="Movie poster placeholders">
        <div class="featured-poster-slot" role="img" aria-label="Movie poster slot 1"></div>
        <div class="featured-poster-slot" role="img" aria-label="Movie poster slot 2"></div>
        <div class="featured-poster-slot" role="img" aria-label="Movie poster slot 3"></div>
      </div>
      <a class="button button-primary featured-movies-more" href="https://letterboxd.com/sarath_mohan/list/movie-of-the-weeks/" target="_blank" rel="noreferrer">See more <span aria-hidden="true">→</span></a>
    </section>
  `;

  const content = container.querySelector('#active-poll-content');
  const featuredSection = container.querySelector('.featured-movies');
  const featuredSlots = [...featuredSection.querySelectorAll('.featured-poster-slot')];

  function setFeaturedSlotMessage(slot, message, state) {
    slot.replaceChildren();
    slot.setAttribute('class', `featured-poster-slot is-${state}`);
    slot.setAttribute('role', 'status');
    slot.removeAttribute('aria-label');
    slot.textContent = message;
  }

  function resetFeaturedSlot(slot, index) {
    slot.replaceChildren();
    slot.setAttribute('class', 'featured-poster-slot');
    slot.setAttribute('role', 'img');
    slot.setAttribute('aria-label', `Movie poster slot ${index + 1}`);
  }

  function getItemChildText(item, localName) {
    const element = [...item.children].find((child) => child.localName === localName);
    return element?.textContent.trim() ?? '';
  }

  function getFeaturedEntries(xml) {
    const documentNode = new DOMParser().parseFromString(xml, 'application/xml');
    if (documentNode.querySelector('parsererror')) {
      throw new Error('The Letterboxd feed was not valid XML.');
    }

    const seenIds = new Set();
    const entries = [];
    for (const item of documentNode.getElementsByTagName('item')) {
      if (!item.textContent.toLowerCase().includes(KEYWORD)) continue;

      const movieIdElement = [...item.getElementsByTagName('*')]
        .find((element) => element.localName === 'movieId');
      const movieId = movieIdElement?.textContent.trim();
      if (!movieId || seenIds.has(movieId)) continue;

      seenIds.add(movieId);
      entries.push({
        movieId,
        letterboxdUrl: getItemChildText(item, 'link'),
      });
      if (entries.length === featuredSlots.length) break;
    }
    return entries;
  }

  function renderFeaturedMovie(slot, entry, movie) {
    const title = movie.title.trim();
    const year = /^\d{4}$/.test(movie.release_date?.slice(0, 4) ?? '')
      ? movie.release_date.slice(0, 4)
      : 'Release year unknown';
    const titleAndYear = `${title} (${year})`;
    const letterboxdUrl = new URL(entry.letterboxdUrl);
    if (letterboxdUrl.protocol !== 'https:'
      || (letterboxdUrl.hostname !== 'letterboxd.com' && !letterboxdUrl.hostname.endsWith('.letterboxd.com'))) {
      throw new Error('The Letterboxd feed contained an invalid movie link.');
    }
    const posterUrl = getPosterUrl(movie.poster_path, 'w342');
    if (!posterUrl) throw new Error('TMDB returned an invalid poster path.');

    slot.replaceChildren();
    slot.setAttribute('class', 'featured-poster-slot is-filled');
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', titleAndYear);

    const link = document.createElement('a');
    link.setAttribute('href', letterboxdUrl.href);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
    const poster = document.createElement('img');
    poster.setAttribute('src', posterUrl);
    poster.setAttribute('alt', titleAndYear);
    poster.setAttribute('loading', 'lazy');
    link.append(poster);
    slot.append(link);

    const caption = document.createElement('p');
    caption.setAttribute('class', 'featured-poster-caption');
    caption.textContent = titleAndYear;
    slot.append(caption);
  }

  async function loadFeaturedMovies() {
    featuredSlots.forEach((slot) => setFeaturedSlotMessage(slot, 'Loading…', 'loading'));
    try {
      if (!LETTERBOXD_PROXY_URL) {
        throw new Error('The Letterboxd feed is not configured.');
      }
      if (!TMDB_API_KEY) {
        throw new Error('Movie poster lookup is not configured.');
      }

      const feedResponse = await fetch(LETTERBOXD_PROXY_URL);
      if (!feedResponse.ok) throw new Error(`The Letterboxd feed returned ${feedResponse.status}.`);
      const entries = getFeaturedEntries(await feedResponse.text());
      if (disposed) return;

      featuredSlots.forEach(resetFeaturedSlot);
      if (!entries.length) {
        const message = document.createElement('p');
        message.setAttribute('class', 'featured-movies-empty');
        message.textContent = 'No recent entries found';
        featuredSection.insertBefore(message, featuredSection.querySelector('.featured-movies-more'));
        return;
      }

      entries.forEach((_, index) => setFeaturedSlotMessage(featuredSlots[index], 'Loading…', 'loading'));
      const movies = await Promise.all(entries.map(async ({ movieId }) => {
        const response = await fetch(
          `https://api.themoviedb.org/3/movie/${encodeURIComponent(movieId)}?api_key=${encodeURIComponent(TMDB_API_KEY)}`,
        );
        if (!response.ok) throw new Error(`TMDB returned ${response.status}.`);
        const movie = await response.json();
        if (typeof movie.title !== 'string' || !movie.title.trim() || !movie.poster_path) {
          throw new Error('TMDB did not return a title and poster for a selected movie.');
        }
        return movie;
      }));
      if (disposed) return;

      entries.forEach((entry, index) => renderFeaturedMovie(featuredSlots[index], entry, movies[index]));
    } catch {
      if (disposed) return;
      featuredSlots.forEach(resetFeaturedSlot);
      setFeaturedSlotMessage(featuredSlots[0], 'Could not load recent movies. Please try again later.', 'error');
    }
  }

  const attribution = document.createElement('p');
  attribution.setAttribute('class', 'featured-movies-attribution');
  attribution.textContent = 'Data from Letterboxd · Posters from TMDB';
  featuredSection.append(attribution);
  loadFeaturedMovies();

  function renderPoll(state) {
    window.clearInterval(state.countdownTimer);
    const { poll } = state;
    const card = [...content.querySelectorAll('[data-poll-id]')]
      .find((element) => element.dataset.pollId === poll.id);
    if (!card) return;

    const options = [...(poll.poll_options ?? [])].sort((a, b) => a.title.localeCompare(b.title));
    const endsAt = new Date(poll.ends_at).getTime();
    const remaining = endsAt - Date.now();
    const ended = state.serverMarkedEnded || remaining <= 0;
    const days = Math.floor(Math.max(remaining, 0) / 86400000);
    const hours = Math.floor((Math.max(remaining, 0) % 86400000) / 3600000);
    const minutes = Math.floor((Math.max(remaining, 0) % 3600000) / 60000);
    const seconds = Math.floor((Math.max(remaining, 0) % 60000) / 1000);
    const countdown = ended
      ? 'Voting just ended'
      : `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    const votedOptions = options.filter((option) => state.votedOptionIds.has(option.id));
    const cards = options.map((option) => `
      <article class="movie-card">
        ${renderPoster(option.poster_path, option.title)}
        <div class="movie-card-info">
          <h3>${escapeHtml(option.title)}</h3>
          <p>${option.year ? escapeHtml(option.year) : 'Release year unknown'}</p>
          ${user && !ended
            ? renderVoteChoice(option, state.selectedOptionIds.has(option.id), state.votedOptionIds.has(option.id), state.votedLoading)
              : ''}
        </div>
      </article>
    `).join('');

    card.innerHTML = `
      <h3 class="active-poll-card-title">Movie poll</h3>
      <p class="poll-creator">Created by <strong>${escapeHtml(poll.creator_name || 'Movie fan')}</strong></p>
      <div class="poll-meta"><span>Voting closes ${escapeHtml(formatDate(poll.ends_at))}</span><span class="countdown" aria-live="off"><span aria-hidden="true">◷</span> <span data-poll-countdown>${countdown}</span></span></div>
      ${votedOptions.length ? `<p class="inline-notice success-notice">You voted for <strong>${votedOptions.map((option) => escapeHtml(option.title)).join(', ')}</strong>.</p>` : ''}
      ${state.status ? `<p class="inline-notice error-notice" role="alert">${escapeHtml(state.status)}</p>` : ''}
      <div class="movie-grid">${cards}</div>
      ${user && !ended ? `<div class="vote-submit"><p>Select one or more movies.</p><button class="button button-primary" type="button" data-submit-votes ${!hasNewVotes(state) || state.votedLoading ? 'disabled' : ''}>${state.votedLoading ? 'Submitting…' : state.votedOptionIds.size ? 'Add selected votes' : 'Submit votes'}</button></div>` : ''}
      ${!user && !ended
        ? `<div class="poll-sign-in"><p>Sign in to cast your vote.</p>${signInPrompt()}</div>`
        : ''}
      ${ended ? `<p class="inline-notice">Voting has ended. <a class="text-link" href="#/poll/${encodeURIComponent(poll.id)}">See poll results</a></p>` : ''}
    `;
    card.querySelector('[data-sign-in]')?.addEventListener('click', showSignInPrompt);

    const countdownNode = card.querySelector('[data-poll-countdown]');
    if (countdownNode && !ended) {
      state.countdownTimer = window.setInterval(() => {
        const left = endsAt - Date.now();
        if (left <= 0) {
          window.clearInterval(state.countdownTimer);
          if (!disposed) renderPoll(state);
          return;
        }
        const d = Math.floor(left / 86400000);
        const h = Math.floor((left % 86400000) / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        const s = Math.floor((left % 60000) / 1000);
        countdownNode.textContent = `${d ? `${d}d ` : ''}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
      }, 1000);
    }
  }

  function hasNewVotes(state) {
    return [...state.selectedOptionIds].some((optionId) => !state.votedOptionIds.has(optionId));
  }

  content.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-option-choice]');
    const card = checkbox?.closest('[data-poll-id]');
    const state = card && pollStates.get(card.dataset.pollId);
    if (!checkbox || !state || state.votedLoading) return;
    if (checkbox.checked) state.selectedOptionIds.add(checkbox.dataset.optionChoice);
    else state.selectedOptionIds.delete(checkbox.dataset.optionChoice);
    checkbox.closest('.vote-choice')?.classList.toggle('is-selected', checkbox.checked);
    const submitButton = card.querySelector('[data-submit-votes]');
    if (submitButton) submitButton.disabled = !hasNewVotes(state);
  });

  content.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-submit-votes]');
    const card = button?.closest('[data-poll-id]');
    const state = card && pollStates.get(card.dataset.pollId);
    if (!button || !user || !state || state.votedLoading || !hasNewVotes(state)) return;
    state.votedLoading = true;
    state.status = '';
    button.disabled = true;
    try {
      const optionIds = await submitVotes(state.poll.id, [...state.selectedOptionIds]);
      state.votedOptionIds = new Set(optionIds);
      state.selectedOptionIds = new Set(optionIds);
    } catch (error) {
      state.status = error.message?.includes('Voting has ended')
        ? 'Voting has ended for this poll.'
        : 'Your votes could not be submitted. Please try again.';
      if (error.message?.includes('Voting has ended')) state.serverMarkedEnded = true;
    } finally {
      state.votedLoading = false;
      if (!disposed) renderPoll(state);
    }
  });

  async function load() {
    try {
      const polls = await fetchActivePolls();
      if (disposed) return;
      if (!polls.length) {
        content.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">✦</span><p>No active poll right now. Check the <a class="text-link" href="#/archive">archive</a> for past picks.</p></div>';
        return;
      }

      for (const poll of polls) {
        pollStates.set(poll.id, {
          poll,
          votedOptionIds: new Set(),
          selectedOptionIds: new Set(),
          status: '',
          countdownTimer: undefined,
          votedLoading: false,
          serverMarkedEnded: false,
        });
      }
      content.classList.add('active-poll-list');
      content.innerHTML = polls.map((poll) => `<article class="active-poll-card" data-poll-id="${escapeHtml(poll.id)}"></article>`).join('');

      await Promise.all(polls.map(async (poll) => {
        const state = pollStates.get(poll.id);
        if (user) {
          try {
            const optionIds = await fetchUserVotes(poll.id, user);
            state.votedOptionIds = new Set(optionIds);
            state.selectedOptionIds = new Set(optionIds);
          } catch {
            state.status = 'We could not check whether you have already voted. Refresh to try again.';
          }
        }
        if (!disposed) renderPoll(state);
      }));
    } catch (error) {
      if (!disposed) {
        content.classList.remove('active-poll-list');
        content.innerHTML = `<div class="error-state" role="alert"><p>We couldn't load the active polls.</p><p class="error-detail">${escapeHtml(error.message)}</p><button class="button button-quiet" type="button" data-retry>Try again</button></div>`;
        content.querySelector('[data-retry]').addEventListener('click', () => {
          content.innerHTML = '<div class="loading-state" role="status">Finding active polls…</div>';
          load();
        });
      }
    }
  }

  load();
  return () => {
    disposed = true;
    for (const state of pollStates.values()) window.clearInterval(state.countdownTimer);
  };
}
