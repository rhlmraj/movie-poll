import {
  fetchPollById,
  fetchPollResults,
  fetchUserVotes,
  submitVotes,
} from '../pollData.js';
import { escapeHtml, formatDate, renderPoster, renderVoteChoice, signInPrompt, showSignInPrompt } from './utils.js';

export function mountPollPage(container, id, user) {
  let disposed = false;
  let poll = null;
  let votedOptionIds = new Set();
  let selectedOptionIds = new Set();
  let resultOptions = null;
  let status = '';
  let loadingVote = false;
  let retryTimer;
  let countdownTimer;

  container.innerHTML = '<div class="loading-state" role="status">Loading poll…</div>';

  function renderResults() {
    if (!resultOptions) return '';
    const total = resultOptions.voterCount;
    const options = resultOptions.options;
    const highest = Math.max(0, ...options.map((option) => option.voteCount));
    const winners = total ? new Set(options.filter((option) => option.voteCount === highest).map((option) => option.id)) : new Set();
    return `
      <section class="results-section" aria-labelledby="results-title">
        <div class="section-heading"><p class="eyebrow">The votes are in</p><h2 id="results-title">Poll results</h2></div>
        <div class="results-list">
          ${options.map((option) => {
            const percentage = total ? Math.round((option.voteCount / total) * 100) : 0;
            const winner = winners.has(option.id);
            return `
              <article class="result-row${winner ? ' is-winner' : ''}">
                ${renderPoster(option.poster_path, option.title, 'w92')}
                <div class="result-main">
                  <div class="result-heading"><h3>${escapeHtml(option.title)}${option.year ? ` <span>(${escapeHtml(option.year)})</span>` : ''}</h3>${winner ? '<span class="winner-label">Winner</span>' : ''}</div>
                  <div class="result-track" role="progressbar" aria-label="${escapeHtml(option.title)} vote share" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(percentage, 100)}">
                    <span style="width: ${Math.min(percentage, 100)}%"></span>
                  </div>
                </div>
                <div class="result-total"><strong>${percentage}%</strong><span>${option.voteCount} ${option.voteCount === 1 ? 'vote' : 'votes'}</span></div>
              </article>
            `;
          }).join('')}
        </div>
        <p class="results-total">${total} ${total === 1 ? 'voter' : 'voters'} total</p>
      </section>
    `;
  }

  function render() {
    window.clearInterval(countdownTimer);
    const isEnded = Date.now() >= new Date(poll.ends_at).getTime();
    const options = [...(poll.poll_options ?? [])].sort((a, b) => a.title.localeCompare(b.title));
    const votedOptions = options.filter((option) => votedOptionIds.has(option.id));
    container.innerHTML = `
      <section class="page-card page-intro poll-page">
        <p class="eyebrow">${isEnded ? 'Poll closed' : 'Cast your vote'}</p>
        <h1>Movie poll</h1>
        <p class="poll-creator">Created by <strong>${escapeHtml(poll.creator_name || 'Movie fan')}</strong></p>
        <p>Voting ${isEnded ? 'ended' : 'closes'} ${escapeHtml(formatDate(poll.ends_at))}.</p>
        ${!isEnded ? `<p class="poll-detail-countdown">Time remaining: <strong id="poll-time-remaining"></strong></p>` : ''}
        ${status ? `<p class="inline-notice error-notice" role="alert">${escapeHtml(status)}</p>` : ''}
        ${votedOptions.length
          ? `<p class="inline-notice success-notice">You voted for <strong>${votedOptions.map((option) => escapeHtml(option.title)).join(', ')}</strong>.</p>`
          : ''}
        <div class="movie-grid">
          ${options.map((option) => `
            <article class="movie-card">
              ${renderPoster(option.poster_path, option.title)}
              <div class="movie-card-info">
                <h3>${escapeHtml(option.title)}</h3>
                <p>${option.year ? escapeHtml(option.year) : 'Release year unknown'}</p>
                ${!isEnded && user
                  ? renderVoteChoice(option, selectedOptionIds.has(option.id), votedOptionIds.has(option.id), loadingVote)
                  : ''}
              </div>
            </article>
          `).join('')}
        </div>
        ${!isEnded && user ? `<div class="vote-submit"><p>Select one or more movies.</p><button class="button button-primary" type="button" data-submit-votes ${!hasNewVotes() || loadingVote ? 'disabled' : ''}>${loadingVote ? 'Submitting…' : votedOptionIds.size ? 'Add selected votes' : 'Submit votes'}</button></div>` : ''}
        ${!isEnded && !user ? `<div class="poll-sign-in"><p>Sign in to cast your vote.</p>${signInPrompt()}</div>` : ''}
        ${isEnded
          ? resultOptions
            ? renderResults()
            : `<div class="loading-state" role="status">${status ? escapeHtml(status) : 'Results are not available yet. Checking again shortly…'} <button class="button button-quiet" type="button" data-retry-results>Check results</button></div>`
          : ''}
        <a class="text-link back-link" href="#/">← Back to the active poll</a>
      </section>
    `;
    container.querySelector('[data-sign-in]')?.addEventListener('click', showSignInPrompt);
    if (!isEnded) {
      const countdown = container.querySelector('#poll-time-remaining');
      countdownTimer = window.setInterval(() => {
        const remaining = new Date(poll.ends_at).getTime() - Date.now();
        if (remaining <= 0) {
          window.clearInterval(countdownTimer);
          render();
          loadResults();
          return;
        }
        const days = Math.floor(remaining / 86400000);
        const hours = Math.floor((remaining % 86400000) / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        countdown.textContent = `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
      }, 1000);
      const remaining = new Date(poll.ends_at).getTime() - Date.now();
      const days = Math.floor(remaining / 86400000);
      const hours = Math.floor((remaining % 86400000) / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      countdown.textContent = `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }
  }

  function hasNewVotes() {
    return [...selectedOptionIds].some((optionId) => !votedOptionIds.has(optionId));
  }

  container.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-option-choice]');
    if (!checkbox || loadingVote) return;
    if (checkbox.checked) selectedOptionIds.add(checkbox.dataset.optionChoice);
    else selectedOptionIds.delete(checkbox.dataset.optionChoice);
    checkbox.closest('.vote-choice')?.classList.toggle('is-selected', checkbox.checked);
    const submitButton = container.querySelector('[data-submit-votes]');
    if (submitButton) submitButton.disabled = !hasNewVotes();
  });

  container.addEventListener('click', async (event) => {
    if (event.target.closest('[data-retry-results]')) {
      status = '';
      loadResults();
      return;
    }
    const button = event.target.closest('[data-submit-votes]');
    if (!button || !user || loadingVote || !hasNewVotes()) return;
    loadingVote = true;
    status = '';
    button.disabled = true;
    try {
      const optionIds = await submitVotes(poll.id, [...selectedOptionIds]);
      votedOptionIds = new Set(optionIds);
      selectedOptionIds = new Set(optionIds);
    } catch (error) {
      if (error.message?.includes('Voting has ended')) {
        status = 'Voting has ended. Loading the results…';
        poll.ends_at = new Date(Date.now() - 1).toISOString();
        await loadResults();
      } else {
        status = 'Your vote could not be submitted. Please try again.';
      }
    } finally {
      loadingVote = false;
      if (!disposed) render();
    }
  });

  async function loadResults() {
    try {
      resultOptions = await fetchPollResults(poll.id, poll.poll_options ?? []);
      if (!resultOptions && !disposed) {
        retryTimer = window.setTimeout(loadResults, 15000);
      }
    } catch (error) {
      status = `We couldn't load the results. ${error.message}`;
    }
    if (!disposed) render();
  }

  async function load() {
    if (!id) {
      container.innerHTML = '<section class="page-card page-intro"><h1>Poll not found</h1><p>The poll link is not valid.</p></section>';
      return;
    }
    try {
      poll = await fetchPollById(id);
      if (!poll) {
        container.innerHTML = '<section class="page-card page-intro"><h1>Poll not found</h1><p>This poll does not exist.</p><a class="text-link" href="#/">Back to home</a></section>';
        return;
      }
      if (user) {
        try {
          const optionIds = await fetchUserVotes(poll.id, user);
          votedOptionIds = new Set(optionIds);
          selectedOptionIds = new Set(optionIds);
        } catch (error) {
          status = `We couldn't check your vote. ${error.message}`;
        }
      }
      if (Date.now() >= new Date(poll.ends_at).getTime()) {
        render();
        await loadResults();
      } else if (!disposed) {
        render();
      }
    } catch (error) {
      if (!disposed) {
        container.innerHTML = `<div class="error-state" role="alert"><p>We couldn't load this poll.</p><p class="error-detail">${escapeHtml(error.message)}</p><a class="text-link" href="#/">Back to home</a></div>`;
      }
    }
  }

  load();
  return () => {
    disposed = true;
    window.clearTimeout(retryTimer);
    window.clearInterval(countdownTimer);
  };
}
