import { fetchActivePoll, fetchUserVotes, submitVotes } from '../pollData.js';
import { escapeHtml, formatDate, renderPoster, renderVoteChoice, signInPrompt, showSignInPrompt } from './utils.js';

export function mountHomePage(container, user) {
  let disposed = false;
  let poll = null;
  let votedOptionIds = new Set();
  let selectedOptionIds = new Set();
  let status = '';
  let countdownTimer;
  let votedLoading = false;
  let serverMarkedEnded = false;

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
        <h2 id="active-poll-title">Latest active poll</h2>
      </div>
      <div id="active-poll-content"><div class="loading-state" role="status">Finding the latest poll…</div></div>
    </section>
    <section class="how-it-works" aria-labelledby="how-title">
      <div class="section-heading"><p class="eyebrow">How it works</p><h2 id="how-title">Your next movie night, sorted.</h2></div>
      <div class="steps-grid">
        <article class="step-card"><span class="step-number">01</span><h3>Choose up to five</h3><p>Put together a shortlist of one to five movies for everyone to consider.</p></article>
        <article class="step-card"><span class="step-number">02</span><h3>Share the poll</h3><p>Invite friends to vote for the movies they want to watch.</p></article>
        <article class="step-card"><span class="step-number">03</span><h3>Watch the winners</h3><p>When voting closes, the group's favorites are ready for movie night.</p></article>
      </div>
    </section>
  `;

  const content = container.querySelector('#active-poll-content');

  function renderPoll() {
    window.clearInterval(countdownTimer);
    if (!poll) return;
    const options = [...(poll.poll_options ?? [])].sort((a, b) => a.title.localeCompare(b.title));
    const endsAt = new Date(poll.ends_at).getTime();
    const remaining = endsAt - Date.now();
    const ended = serverMarkedEnded || remaining <= 0;
    const days = Math.floor(Math.max(remaining, 0) / 86400000);
    const hours = Math.floor((Math.max(remaining, 0) % 86400000) / 3600000);
    const minutes = Math.floor((Math.max(remaining, 0) % 3600000) / 60000);
    const seconds = Math.floor((Math.max(remaining, 0) % 60000) / 1000);
    const countdown = ended
      ? 'Voting just ended'
      : `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    const votedOptions = options.filter((option) => votedOptionIds.has(option.id));
    const cards = options.map((option) => `
      <article class="movie-card">
        ${renderPoster(option.poster_path, option.title)}
        <div class="movie-card-info">
          <h3>${escapeHtml(option.title)}</h3>
          <p>${option.year ? escapeHtml(option.year) : 'Release year unknown'}</p>
          ${user && !ended
            ? renderVoteChoice(option, selectedOptionIds.has(option.id), votedOptionIds.has(option.id), votedLoading)
              : ''}
        </div>
      </article>
    `).join('');

    content.innerHTML = `
      <p class="poll-creator">Created by <strong>${escapeHtml(poll.creator_name || 'Movie fan')}</strong></p>
      <div class="poll-meta"><span>Voting closes ${escapeHtml(formatDate(poll.ends_at))}</span><span class="countdown" aria-live="off"><span aria-hidden="true">◷</span> <span id="poll-countdown">${countdown}</span></span></div>
      ${votedOptions.length ? `<p class="inline-notice success-notice">You voted for <strong>${votedOptions.map((option) => escapeHtml(option.title)).join(', ')}</strong>.</p>` : ''}
      ${status ? `<p class="inline-notice error-notice" role="alert">${escapeHtml(status)}</p>` : ''}
      <div class="movie-grid">${cards}</div>
      ${user && !ended ? `<div class="vote-submit"><p>Select one or more movies.</p><button class="button button-primary" type="button" data-submit-votes ${!hasNewVotes() || votedLoading ? 'disabled' : ''}>${votedLoading ? 'Submitting…' : votedOptionIds.size ? 'Add selected votes' : 'Submit votes'}</button></div>` : ''}
      ${!user && !ended
        ? `<div class="poll-sign-in"><p>Sign in to cast your vote.</p>${signInPrompt()}</div>`
        : ''}
      ${ended ? `<p class="inline-notice">Voting has ended. <a class="text-link" href="#/poll/${encodeURIComponent(poll.id)}">See poll results</a></p>` : ''}
    `;
    content.querySelector('[data-sign-in]')?.addEventListener('click', showSignInPrompt);

    const countdownNode = content.querySelector('#poll-countdown');
    if (countdownNode && !ended) {
      countdownTimer = window.setInterval(() => {
        const left = endsAt - Date.now();
        if (left <= 0) {
          window.clearInterval(countdownTimer);
          countdownNode.textContent = 'Voting just ended';
          if (!disposed) renderPoll();
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

  function hasNewVotes() {
    return [...selectedOptionIds].some((optionId) => !votedOptionIds.has(optionId));
  }

  content.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-option-choice]');
    if (!checkbox || votedLoading) return;
    if (checkbox.checked) selectedOptionIds.add(checkbox.dataset.optionChoice);
    else selectedOptionIds.delete(checkbox.dataset.optionChoice);
    checkbox.closest('.vote-choice')?.classList.toggle('is-selected', checkbox.checked);
    const submitButton = content.querySelector('[data-submit-votes]');
    if (submitButton) submitButton.disabled = !hasNewVotes();
  });

  content.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-submit-votes]');
    if (!button || !user || votedLoading || !hasNewVotes()) return;
    votedLoading = true;
    status = '';
    button.disabled = true;
    try {
      const optionIds = await submitVotes(poll.id, [...selectedOptionIds]);
      votedOptionIds = new Set(optionIds);
      selectedOptionIds = new Set(optionIds);
    } catch (error) {
      status = error.message?.includes('Voting has ended')
        ? 'Voting has ended for this poll.'
        : 'Your votes could not be submitted. Please try again.';
      if (error.message?.includes('Voting has ended')) serverMarkedEnded = true;
    } finally {
      votedLoading = false;
      if (!disposed) renderPoll();
    }
  });

  async function load() {
    try {
      poll = await fetchActivePoll();
      if (!poll) {
        if (!disposed) {
          content.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">✦</span><p>No active poll right now. Check the <a class="text-link" href="#/archive">archive</a> for past picks.</p></div>';
        }
        return;
      }
      if (user) {
        try {
          const optionIds = await fetchUserVotes(poll.id, user);
          votedOptionIds = new Set(optionIds);
          selectedOptionIds = new Set(optionIds);
        } catch {
          status = 'We could not check whether you have already voted. Refresh to try again.';
        }
      }
      if (!disposed) renderPoll();
    } catch (error) {
      if (!disposed) {
        content.innerHTML = `<div class="error-state" role="alert"><p>We couldn't load the active poll.</p><p class="error-detail">${escapeHtml(error.message)}</p><button class="button button-quiet" type="button" data-retry>Try again</button></div>`;
        content.querySelector('[data-retry]').addEventListener('click', () => {
          content.innerHTML = '<div class="loading-state" role="status">Finding the latest poll…</div>';
          load();
        });
      }
    }
  }

  load();
  return () => {
    disposed = true;
    window.clearInterval(countdownTimer);
  };
}
