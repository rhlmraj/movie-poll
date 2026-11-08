import './style.css';
import { supabase } from './supabaseClient.js';
import { mountArchivePage } from './pages/archive.js';
import { mountCreatePage } from './pages/create.js';
import { mountHomePage } from './pages/home.js';
import { mountPollPage } from './pages/poll.js';

const app = document.querySelector('#app');
let currentUser = null;
let authMessage = '';
let authMessageType = '';
let disposePage = () => {};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function getDisplayName(user) {
  const metadata = user?.user_metadata ?? {};
  const candidate = metadata.full_name
    || metadata.name
    || metadata.display_name
    || metadata.preferred_username
    || metadata.username
    || [metadata.given_name, metadata.family_name].filter(Boolean).join(' ');

  if (typeof candidate === 'string' && candidate.trim() && !candidate.includes('@')) {
    return candidate.trim();
  }
  return 'Movie fan';
}

function getRoute() {
  const segments = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

  if (segments.length === 0) return { name: 'home' };
  if (segments[0] === 'create' && segments.length === 1) return { name: 'create' };
  if (segments[0] === 'archive' && segments.length === 1) return { name: 'archive' };
  if (segments[0] === 'poll' && segments[1]) {
    return { name: 'poll', id: segments.slice(1).join('/') };
  }
  return { name: 'not-found' };
}

function renderPage(route) {
  if (route.name === 'not-found') {
    return '<section class="page-card page-intro"><p class="eyebrow">404</p><h1>Page not found</h1><p>That page does not exist.</p><a class="text-link" href="#/">Back to home</a></section>';
  }
  return '<div id="page-content"></div>';
}

function render() {
  disposePage();
  disposePage = () => {};
  const route = getRoute();
  const signedIn = Boolean(currentUser);
  const authControl = signedIn
    ? `<div class="account"><span class="account-name">${escapeHtml(getDisplayName(currentUser))}</span><button class="button button-quiet" id="auth-button" type="button">Sign out</button></div>`
    : '<button class="button button-primary" id="auth-button" type="button">Sign in with Google</button>';
  const navItems = [
    ['home', 'Home', '#/'],
    ['create', 'Create poll', '#/create'],
    ['archive', 'Archive', '#/archive'],
  ];

  app.innerHTML = `
    <div class="site-shell">
      <header class="site-header">
        <a class="brand" href="#/" aria-label="Movie Poll home">
          <span class="brand-mark" aria-hidden="true">M</span>
          <span>Movie Poll</span>
        </a>
        <nav class="main-nav" aria-label="Main navigation">
          ${navItems.map(([name, label, href]) => `<a class="nav-link${route.name === name ? ' is-active' : ''}" href="${href}"${route.name === name ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        </nav>
        ${authControl}
      </header>
      <main class="main-content">${renderPage(route)}</main>
      <footer class="site-footer">
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB. <a href="./privacy.html">Privacy policy</a></p>
        <a class="tmdb-link" href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" aria-label="Visit The Movie Database">
          <img src="https://www.themoviedb.org/assets/2/v4/logos/blue_short.svg" alt="The Movie Database (TMDB)" />
        </a>
      </footer>
      ${authMessage ? `<div class="status-message status-${authMessageType}" role="status">${escapeHtml(authMessage)}</div>` : ''}
    </div>
  `;

  document.querySelector('#auth-button').addEventListener('click', handleAuthClick);
  if (route.name !== 'not-found') {
    const container = document.querySelector('#page-content');
    if (route.name === 'create') disposePage = mountCreatePage(container, currentUser) ?? (() => {});
    else if (route.name === 'poll') {
      let id = route.id;
      try {
        id = decodeURIComponent(id);
      } catch {
        id = '';
      }
      disposePage = mountPollPage(container, id, currentUser) ?? (() => {});
    } else if (route.name === 'archive') disposePage = mountArchivePage(container) ?? (() => {});
    else disposePage = mountHomePage(container, currentUser) ?? (() => {});
  }
}

async function handleAuthClick() {
  authMessage = '';
  if (currentUser) {
    const { error } = await supabase.auth.signOut();
    if (error) {
      authMessage = error.message;
      authMessageType = 'error';
      render();
    }
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
  });
  if (error) {
    authMessage = error.message;
    authMessageType = 'error';
    render();
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('movie-poll:sign-in', handleAuthClick);
render();

const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user ?? null;
  authMessage = '';
  render();
});

supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    authMessage = 'Unable to load your sign-in status.';
    authMessageType = 'error';
  } else {
    currentUser = data.session?.user ?? null;
  }
  render();
});

window.addEventListener('pagehide', () => subscription.unsubscribe(), { once: true });
