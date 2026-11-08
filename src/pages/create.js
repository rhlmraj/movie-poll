import { supabase } from '../supabaseClient.js';
import { escapeHtml, getPosterUrl, showSignInPrompt } from './utils.js';

const searchEndpoint = 'https://api.themoviedb.org/3/search/movie';
const apiKey = import.meta.env.VITE_TMDB_API_KEY;

function getYear(movie) {
  const year = movie.release_date?.slice(0, 4);
  return /^\d{4}$/.test(year ?? '') ? Number(year) : null;
}

export function mountCreatePage(container, user) {
  if (!user) {
    container.innerHTML = `
      <section class="page-card page-intro">
        <p class="eyebrow">This week's pick</p><h1>Create a movie poll</h1>
        <p>You need to sign in before creating a poll.</p>
        <div class="auth-prompt">${'<button class="button button-primary" type="button" data-sign-in>Sign in with Google</button>'}</div>
      </section>
    `;
    container.querySelector('[data-sign-in]').addEventListener('click', showSignInPrompt);
    return () => {};
  }

  let selected = [];
  let results = [];
  let debounceTimer;
  let activeRequest;
  let submitting = false;
  let notice = '';
  let noticeType = '';
  let disposed = false;

  container.innerHTML = `
    <section class="page-card page-intro create-page">
      <p class="eyebrow">This week's pick</p>
      <h1>Create a movie poll</h1>
      <p>Choose between one and five movies for everyone to vote on. Only one poll can be created each week.</p>
      <div class="create-form">
        <label class="field-label" for="movie-search">Search movies</label>
        <input id="movie-search" class="search-input" type="search" maxlength="120" placeholder="Try a title, like The Grand Budapest Hotel" autocomplete="off" />
        <p class="field-hint">Search powered by The Movie Database (TMDB).</p>
        <div id="search-results" class="search-results" aria-live="polite"></div>
        <div class="selection-heading"><h2>Your picks <span id="selection-count">(0/5)</span></h2></div>
        <div id="selected-movies" class="selected-movies"><p class="selection-empty">Choose at least one movie to create your poll.</p></div>
        <div id="create-notice" aria-live="polite"></div>
        <button id="submit-poll" class="button button-primary submit-poll" type="button" disabled>Create poll</button>
      </div>
    </section>
  `;

  const searchInput = container.querySelector('#movie-search');
  const searchResults = container.querySelector('#search-results');
  const selectionNode = container.querySelector('#selected-movies');
  const countNode = container.querySelector('#selection-count');
  const submitButton = container.querySelector('#submit-poll');
  const noticeNode = container.querySelector('#create-notice');

  function renderSelection() {
    countNode.textContent = `(${selected.length}/5)`;
    selectionNode.innerHTML = selected.length
      ? selected.map((movie) => `
        <span class="movie-chip">
          ${escapeHtml(movie.title)}${movie.year ? ` · ${movie.year}` : ''}
          <button type="button" data-remove="${movie.id}" aria-label="Remove ${escapeHtml(movie.title)}">×</button>
        </span>
      `).join('')
      : '<p class="selection-empty">Choose at least one movie to create your poll.</p>';
    submitButton.disabled = selected.length === 0 || submitting;
    submitButton.textContent = submitting ? 'Creating poll…' : 'Create poll';
  }

  function renderNotice() {
    noticeNode.innerHTML = notice
      ? `<p class="inline-notice ${noticeType === 'error' ? 'error-notice' : 'success-notice'}" role="${noticeType === 'error' ? 'alert' : 'status'}">${escapeHtml(notice)}</p>`
      : '';
  }

  function renderResults() {
    searchResults.innerHTML = results.length
      ? results.map((movie) => {
        const title = movie.title || movie.original_title || 'Untitled movie';
        const year = getYear(movie);
        const isSelected = selected.some((item) => item.id === movie.id);
        const canSelect = !isSelected && selected.length < 5;
        const posterUrl = getPosterUrl(movie.poster_path, 'w92');
        return `
          <article class="search-result">
            ${posterUrl ? `<img src="${posterUrl}" alt="" loading="lazy" />` : '<div class="result-poster-placeholder" aria-hidden="true">✦</div>'}
            <div class="search-result-info"><h3>${escapeHtml(title)}</h3><p>${year ?? 'Release year unknown'}</p></div>
            <button class="button button-quiet" type="button" data-select="${movie.id}" ${canSelect ? '' : 'disabled'}>${isSelected ? 'Added' : selected.length >= 5 ? 'Limit reached' : 'Add'}</button>
          </article>
        `;
      }).join('')
      : '';
  }

  async function search(query) {
    if (activeRequest) activeRequest.abort();
    if (!apiKey) {
      searchResults.innerHTML = '<p class="error-notice" role="alert">Movie search is not configured. Add VITE_TMDB_API_KEY to the project environment.</p>';
      return;
    }
    if (query.length < 2) {
      results = [];
      searchResults.innerHTML = query ? '<p class="field-hint">Enter at least two characters to search.</p>' : '';
      return;
    }

    activeRequest = new AbortController();
    searchResults.innerHTML = '<p class="loading-state" role="status">Searching movies…</p>';
    const url = new URL(searchEndpoint);
    url.search = new URLSearchParams({
      api_key: apiKey,
      query,
      include_adult: 'false',
    });

    try {
      const response = await fetch(url, { signal: activeRequest.signal });
      if (!response.ok) throw new Error(`TMDB search failed (${response.status}).`);
      const data = await response.json();
      if (disposed) return;
      results = (data.results ?? []).filter((movie) => movie && Number.isInteger(movie.id) && movie.id > 0);
      if (results.length) renderResults();
      else searchResults.innerHTML = '<p class="empty-search">No movies found. Try another title.</p>';
    } catch (error) {
      if (error.name === 'AbortError' || disposed) return;
      searchResults.innerHTML = `<p class="error-notice" role="alert">${escapeHtml(error.message || 'Movie search failed. Please try again.')}</p>`;
    }
  }

  searchInput.addEventListener('input', () => {
    window.clearTimeout(debounceTimer);
    const query = searchInput.value.trim();
    debounceTimer = window.setTimeout(() => search(query), 300);
  });

  container.addEventListener('click', async (event) => {
    const removeButton = event.target.closest('[data-remove]');
    if (removeButton) {
      selected = selected.filter((movie) => String(movie.id) !== removeButton.dataset.remove);
      renderSelection();
      renderResults();
      return;
    }

    const selectButton = event.target.closest('[data-select]');
    if (selectButton) {
      const movie = results.find((item) => String(item.id) === selectButton.dataset.select);
      if (!movie || selected.length >= 5 || selected.some((item) => item.id === movie.id)) return;
      const title = (movie.title || movie.original_title || '').trim();
      if (!title || title.length > 300) {
        notice = 'This movie has a title that cannot be added to a poll.';
        noticeType = 'error';
        renderNotice();
        return;
      }
      selected.push({
        id: movie.id,
        tmdb_id: movie.id,
        title,
        year: getYear(movie),
        poster_path: movie.poster_path ?? null,
      });
      notice = '';
      renderNotice();
      renderSelection();
      renderResults();
      return;
    }

    if (event.target.closest('#submit-poll')) {
      if (selected.length === 0 || submitting) return;
      submitting = true;
      notice = '';
      renderNotice();
      renderSelection();
      try {
        const movies = selected.map(({ tmdb_id, title, year, poster_path }) => ({
          tmdb_id,
          title,
          year,
          poster_path,
        }));
        const { data: pollId, error } = await supabase.rpc('create_poll', { movies });
        if (error) throw error;
        if (typeof pollId !== 'string' || !pollId) throw new Error('The poll was created but its link could not be loaded.');
        window.location.hash = `#/poll/${encodeURIComponent(pollId)}`;
      } catch (error) {
        const message = error.message ?? '';
        notice = message.includes('already been created this week')
          ? 'A poll has already been created this week. You can vote in the current poll or check the archive.'
          : message.includes('between 1 and 5 movies')
            ? 'Please choose between one and five movies.'
            : message.includes('same TMDB movie')
              ? 'Each movie in a poll must be different.'
              : 'We could not create your poll. Please check your connection and try again.';
        noticeType = 'error';
      } finally {
        submitting = false;
        if (!disposed) {
          renderNotice();
          renderSelection();
        }
      }
    }
  });

  renderSelection();
  return () => {
    disposed = true;
    window.clearTimeout(debounceTimer);
    activeRequest?.abort();
  };
}
