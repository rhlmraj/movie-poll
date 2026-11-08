import { fetchActivePoll, fetchPollResults, fetchUserVote, submitVote } from '../pollData.js';
import { escapeHtml, formatDate, renderPoster, signInPrompt, showSignInPrompt } from './utils.js';

export function mountHomePage(container, user) {
  let disposed = false;
  let poll = null;
  let votedOptionId = null;
  let status = '';
  let countdownTimer;
  let votedLoading = false;
  let serverMarkedEnded = false;

  container.innerHTML = `
    <section class="hero page-card">
      <p class="eyebrow">A little friendly competition</p>
      <h1>Pick your movies.<br /><span>Let the votes decide.</span></h1>
      <p class="hero-copy">Create a weekly movie poll, share it with friends, and find out which film wins.</p>
      <a class="button button-primary" href="#/create">Create a poll <span aria-hidden="true">→</span></a>
    </section>
    <section class="active-poll-section" aria-labelledby="active-poll-title">
      <div class="section-heading">
        <p class="eyebrow">The community is choosing</p>
        <h2 id="active-poll-title">This week's poll</h2>
      </div>
      <div id="active-poll-content"><div class="loading-state" role="status">Finding the latest poll…</div></div>
    </section>
    <section class="how-it-works" aria-labelledby="how-title">
      <div class="section-heading"><p class="eyebrow">How it works</p><h2 id="how-title">Your next movie night, sorted.</h2></div>
      <div class="steps-grid">
        <article class="step-card"><span class="step-number">01</span><h3>Choose up to five</h3><p>Put together a shortlist of one to five movies for everyone to consider.</p></article>
        <article class="step-card"><span class="step-number">02</span><h3>Share the poll</h3><p>Invite friends to vote for the movie they want to watch.</p></article>
        <article class="step-card"><span class="step-number">03</span><h3>Watch the winner</h3><p>When voting closes, the group's pick is ready for movie night.</p></article>
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
    const votedOption = options.find((option) => option.id === votedOptionId);
    const cards = options.map((option) => `
      <article class="movie-card">
        ${renderPoster(option.poster_path, option.title)}
        <div class="movie-card-info">
          <h3>${escapeHtml(option.title)}</h3>
          <p>${option.year ? escapeHtml(option.year) : 'Release year unknown'}</p>
          ${votedOptionId
            ? `<span class="vote-note">${option.id === votedOptionId ? 'Your pick' : ''}</span>`
            : user && !ended
              ? `<button class="button button-vote" type="button" data-vote="${escapeHtml(option.id)}" ${votedLoading ? 'disabled' : ''}>Vote</button>`
              : ''}
        </div>
      </article>
    `).join('');

    content.innerHTML = `
      <div class="poll-meta"><span>Voting closes ${escapeHtml(formatDate(poll.ends_at))}</span><span class="countdown" aria-live="off"><span aria-hidden="true">◷</span> <span id="poll-countdown">${countdown}</span></span></div>
      ${votedOptionId && votedOption
        ? `<p class="inline-notice success-notice">You voted for <strong>${escapeHtml(votedOption.title)}</strong>.</p>`
        : status
          ? `<p class="inline-notice error-notice" role="alert">${escapeHtml(status)}</p>`
          : ''}
      <div class="movie-grid">${cards}</div>
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

  content.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-vote]');
    if (!button || !user || votedLoading) return;
    votedLoading = true;
    status = '';
    button.disabled = true;
    try {
      await submitVote(poll.id, button.dataset.vote);
      votedOptionId = button.dataset.vote;
    } catch (error) {
      status = error.message?.includes('already voted')
        ? 'You have already voted in this poll.'
        : error.message?.includes('Voting has ended')
          ? 'Voting has ended for this poll.'
          : 'Your vote could not be submitted. Please try again.';
      if (error.message?.includes('Voting has ended')) serverMarkedEnded = true;
      if (error.message?.includes('already voted')) {
        try {
          votedOptionId = await fetchUserVote(poll.id, user);
        } catch {
          status = 'Your vote was recorded, but we could not load it. Please refresh the page.';
        }
      }
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
          votedOptionId = await fetchUserVote(poll.id, user);
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
