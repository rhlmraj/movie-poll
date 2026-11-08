import { supabase } from './supabaseClient.js';

const pollSelection = 'id, created_at, ends_at, poll_options(id, tmdb_id, title, year, poster_path)';

export async function fetchActivePoll() {
  const { data, error } = await supabase
    .from('polls')
    .select(pollSelection)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;
  return (data ?? []).find((poll) => new Date(poll.ends_at).getTime() > Date.now()) ?? null;
}

export async function fetchPollById(id) {
  const { data, error } = await supabase
    .from('polls')
    .select(pollSelection)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchUserVote(pollId, user) {
  if (!user) return null;

  const { data, error } = await supabase
    .from('votes')
    .select('option_id')
    .eq('poll_id', pollId)
    .maybeSingle();

  if (error) throw error;
  return data?.option_id ?? null;
}

export async function fetchPollResults(pollId, options) {
  const { data, error } = await supabase.rpc('get_poll_results', { poll_id: pollId });
  if (error) throw error;

  const counts = new Map((data ?? []).map((row) => [row.option_id, Number(row.vote_count)]));
  if (!data?.length) return null;
  return options.map((option) => ({ ...option, voteCount: counts.get(option.id) ?? 0 }));
}

export async function submitVote(pollId, optionId) {
  const { error } = await supabase.rpc('cast_vote', {
    poll_id: pollId,
    option_id: optionId,
  });
  if (error) throw error;
}
