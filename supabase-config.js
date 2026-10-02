window.myariSupabase = null;

const supabaseUrl = ''; // Supabase Project URL
const supabaseAnonKey = ''; // anon/publishable key; never use service_role here

if (
  window.supabase?.createClient
  && supabaseUrl.startsWith('https://')
  && supabaseAnonKey
) {
  window.myariSupabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
}
