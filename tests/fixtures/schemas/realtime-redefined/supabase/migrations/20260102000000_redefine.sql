-- A full redefinition: membership is known again from here on.
drop publication supabase_realtime;

create publication supabase_realtime for table public.messages;
