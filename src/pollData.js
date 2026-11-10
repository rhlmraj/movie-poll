import { supabase } from './supabaseClient.js';

const pollSelection = 'id, created_at, ends_at, creator_name, poll_options(id, tmdb_id, title, year, poster_path)';

export async function fetchActivePolls() {
  const { data, error } = await supabase
    .from('polls')
    .select(pollSelection)
    .gt('ends_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
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

export async function fetchUserVotes(pollId, user) {
  if (!user) return [];

  const { data, error } = await supabase
    .from('votes')
    .select('option_id')
    .eq('poll_id', pollId)
    .eq('user_id', user.id);

  if (error) throw error;
  return (data ?? []).map((vote) => vote.option_id);
}

export async function fetchPollResults(pollId, options) {
  const { data, error } = await supabase.rpc('get_poll_results', { poll_id: pollId });
  if (error) throw error;

  const counts = new Map((data ?? []).map((row) => [row.option_id, Number(row.vote_count)]));
  if (!data?.length) return null;
  return {
    options: options.map((option) => ({ ...option, voteCount: counts.get(option.id) ?? 0 })),
    voterCount: Number(data[0].voter_count),
  };
}

export async function submitVotes(pollId, optionIds) {
  const { data, error } = await supabase.rpc('cast_vote', {
    p_poll_id: pollId,
    p_option_ids: optionIds,
  });
  if (error) throw error;
  return data;
}
