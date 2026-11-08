import { supabase } from '../supabaseClient.js';
import { escapeHtml, formatDate, renderPoster } from './utils.js';

export function mountArchivePage(container) {
  let disposed = false;
  container.innerHTML = `
    <section class="page-card page-intro archive-page">
      <p class="eyebrow">Past picks</p><h1>Poll archive</h1>
      <p>Revisit completed polls and see what the community chose.</p>
      <div id="archive-list" class="archive-list"><div class="loading-state" role="status">Loading past polls…</div></div>
    </section>
  `;
  const list = container.querySelector('#archive-list');

  async function load() {
    try {
      const { data, error } = await supabase
        .from('polls')
        .select('id, created_at, ends_at, creator_name, poll_options(id, title, year, poster_path)')
        .lte('ends_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (disposed) return;

      const pastPolls = data ?? [];
      if (!pastPolls.length) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">✦</span><p>No completed polls yet. Come back after the first poll closes.</p></div>';
        return;
      }

      list.innerHTML = pastPolls.map((poll) => {
        const options = [...(poll.poll_options ?? [])].sort((a, b) => a.title.localeCompare(b.title));
        return `
          <article class="archive-card">
            <div class="archive-card-heading"><div><p class="eyebrow">Ended ${escapeHtml(formatDate(poll.ends_at))}</p><h2>Movie poll</h2><p class="poll-creator">Created by <strong>${escapeHtml(poll.creator_name || 'Movie fan')}</strong></p></div><a class="button button-quiet" href="#/poll/${encodeURIComponent(poll.id)}">View results <span aria-hidden="true">→</span></a></div>
            <div class="archive-movies">${options.map((option) => `
              <div class="archive-movie">
                ${renderPoster(option.poster_path, option.title, 'w92')}
                <span>${escapeHtml(option.title)}${option.year ? ` · ${escapeHtml(option.year)}` : ''}</span>
              </div>
            `).join('')}</div>
          </article>
        `;
      }).join('');
    } catch (error) {
      if (disposed) return;
      list.innerHTML = `<div class="error-state" role="alert"><p>We couldn't load the poll archive.</p><p class="error-detail">${escapeHtml(error.message)}</p><button class="button button-quiet" type="button" data-retry>Try again</button></div>`;
      list.querySelector('[data-retry]').addEventListener('click', () => {
        list.innerHTML = '<div class="loading-state" role="status">Loading past polls…</div>';
        load();
      });
    }
  }

  load();
  return () => {
    disposed = true;
  };
}
