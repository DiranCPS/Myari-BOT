window.myariSupabase = null;

const supabaseUrl = 'https://wevaawuhhtqlebmehstd.supabase.co';
const supabaseAnonKey = 'sb_publishable_nzB4WhsOOoX1cmpNRPEwDA_3-4LQt3u';

if (
  window.supabase?.createClient
  && supabaseUrl.startsWith('https://')
  && supabaseAnonKey
) {
  window.myariSupabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
}
