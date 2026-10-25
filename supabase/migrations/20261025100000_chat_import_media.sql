-- Chat-import proof of concept: real reference photos and a separate generated view.
-- All columns stay on items and inherit its existing owner-only RLS policies.
-- The original photo_path/thumb_path remain the real-photo record.

create function private.valid_item_ai(payload jsonb) returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  render jsonb;
  field text;
begin
  if payload is null then return true; end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or octet_length(payload::text) > 12288 then return false; end if;
  if exists (select 1 from jsonb_object_keys(payload) as keys(key) where key <> 'render') then
    return false;
  end if;
  if not (payload ? 'render') then return true; end if;
  render := payload -> 'render';
  if jsonb_typeof(render) is distinct from 'object' then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(render) as keys(key)
    where key not in ('provider', 'model', 'createdAt', 'sourcePhotoSha256', 'prompt', 'referenceUrl')
  ) then return false; end if;
  foreach field in array array['provider', 'model', 'createdAt', 'sourcePhotoSha256'] loop
    if jsonb_typeof(render -> field) is distinct from 'string' then return false; end if;
  end loop;
  if char_length(render ->> 'provider') not between 1 and 80
    or char_length(render ->> 'model') not between 1 and 120
    or char_length(render ->> 'createdAt') > 35
    or (render ->> 'createdAt') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,9})?Z$'
    or (render ->> 'sourcePhotoSha256') !~ '^[0-9a-f]{64}$' then return false; end if;
  -- Reject impossible calendar dates as well as structurally invalid timestamps.
  begin
    perform (render ->> 'createdAt')::timestamptz;
  exception when datetime_field_overflow or invalid_datetime_format then
    return false;
  end;
  if render ? 'prompt' then
    if jsonb_typeof(render -> 'prompt') is distinct from 'string'
      or char_length(render ->> 'prompt') > 8000 then return false; end if;
  end if;
  if render ? 'referenceUrl' then
    if jsonb_typeof(render -> 'referenceUrl') is distinct from 'string'
      or char_length(render ->> 'referenceUrl') > 2048
      or (render ->> 'referenceUrl') !~ '^https://[^[:space:]]+$' then return false; end if;
  end if;
  return true;
end;
$$;

create function private.valid_item_media_path(path text, owner_id uuid, item_id uuid) returns boolean
language sql immutable
set search_path = ''
as $$
  select path is null or (
    char_length(path) between 1 and 512
    and split_part(path, '/', 1) = owner_id::text
    and split_part(path, '/', 2) = item_id::text
    and path ~ '^[0-9a-f-]+/[0-9a-f-]+/[a-zA-Z0-9_-]+[.](webp|jpg|jpeg)$'
  );
$$;

alter table public.items
  add column label_path text,
  add column back_path text,
  add column render_path text,
  add column render_thumb_path text,
  add column ai jsonb,
  add constraint items_ai_valid check (private.valid_item_ai(ai)),
  add constraint items_label_path_valid check (private.valid_item_media_path(label_path, user_id, id)),
  add constraint items_back_path_valid check (private.valid_item_media_path(back_path, user_id, id)),
  add constraint items_render_path_valid check (private.valid_item_media_path(render_path, user_id, id)),
  add constraint items_render_thumb_path_valid check (private.valid_item_media_path(render_thumb_path, user_id, id));

comment on column public.items.ai is 'Bounded provenance for generated media; suggestions are not confirmed item details.';
comment on column public.items.render_path is 'Optional AI-generated extra; never replaces photo_path.';

-- No new table, bucket or policies: items RLS and private closet-photos policies apply.
-- Keep anonymous access explicitly revoked when applying this migration.
revoke all on public.items from anon;
