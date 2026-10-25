-- Run as the database owner after applying 20261025100000_chat_import_media.sql.
-- Every fixture and assertion is in this transaction; it always ends with ROLLBACK.
-- Any unexpected result raises an exception. Do not replace ROLLBACK with COMMIT.
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'rls-test-a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'rls-test-b@example.invalid');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

insert into public.items (
  id, name, category, created_at, updated_at, label_path, back_path, render_path, render_thumb_path, ai
) values (
  '00000000-0000-0000-0000-000000000061', 'TEST ONLY — chat import RLS', 'Tops', now(), now(),
  '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000000061/test-label.webp',
  '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000000061/test-back.jpg',
  '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000000061/test-render.webp',
  '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000000061/test-render-thumb.webp',
  '{"render":{"provider":"test","model":"test-only","createdAt":"2026-10-25T01:00:00.000Z","sourcePhotoSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","prompt":"TEST ONLY","referenceUrl":"https://example.invalid/reference"}}'
);

do $$
declare
  affected int;
  bad jsonb;
begin
  if not row_security_active('public.items') then raise exception 'Items RLS is inactive'; end if;
  if (select count(*) from public.items where id = '00000000-0000-0000-0000-000000000061') <> 1 then
    raise exception 'A cannot read its own item';
  end if;
  update public.items set care = 'TEST ONLY — owner updated' where id = '00000000-0000-0000-0000-000000000061';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'A cannot update its own item'; end if;

  -- Changing the owner must fail even when all media-path checks would pass.
  begin
    update public.items set user_id = '00000000-0000-0000-0000-00000000000b',
      label_path = null, back_path = null, render_path = null, render_thumb_path = null
      where id = '00000000-0000-0000-0000-000000000061';
    raise exception 'Owner reassignment was allowed';
  exception when insufficient_privilege then null;
  end;

  -- Provenance is structured, bounded, and must describe an identifiable source file.
  foreach bad in array array[
    '[]'::jsonb,
    'null'::jsonb,
    '{"unexpected":"value"}'::jsonb,
    '{"render":null}'::jsonb,
    '{"render":{"provider":"test"}}'::jsonb,
    '{"render":{"provider":false,"model":"test","createdAt":"2026-10-25T01:00:00Z","sourcePhotoSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb,
    '{"render":{"provider":"test","model":"test","createdAt":"2026-02-30T01:00:00Z","sourcePhotoSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb,
    '{"render":{"provider":"test","model":"test","createdAt":"2026-10-25T01:00:00Z","sourcePhotoSha256":"not-a-sha"}}'::jsonb,
    '{"render":{"provider":"test","model":"test","createdAt":"2026-10-25T01:00:00Z","sourcePhotoSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","referenceUrl":"javascript:alert(1)"}}'::jsonb,
    jsonb_build_object('render', jsonb_build_object('provider', 'test', 'model', 'test',
      'createdAt', '2026-10-25T01:00:00Z', 'sourcePhotoSha256', repeat('a', 64), 'prompt', repeat('a', 8001)))
  ] loop
    begin
      update public.items set ai = bad where id = '00000000-0000-0000-0000-000000000061';
      raise exception 'Malformed AI metadata was accepted: %', bad;
    exception when check_violation then null;
    end;
  end loop;

  begin
    update public.items set label_path = '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-000000000061/forged-label.webp'
      where id = '00000000-0000-0000-0000-000000000061';
    raise exception 'A can reference a different owner folder';
  exception when check_violation then null;
  end;
end;
$$;

-- B must see and change zero rows belonging to A.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$
declare affected int;
begin
  if (select count(*) from public.items where id = '00000000-0000-0000-0000-000000000061') <> 0 then
    raise exception 'B can read A''s item';
  end if;
  update public.items set care = 'FORGED' where id = '00000000-0000-0000-0000-000000000061';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'B can update A''s item'; end if;
  delete from public.items where id = '00000000-0000-0000-0000-000000000061';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'B can delete A''s item'; end if;
  begin
    insert into public.items (id, user_id, name, category, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-00000000000a', 'TEST ONLY — forged', 'Tops', now(), now());
    raise exception 'B can insert an item owned by A';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Anon is denied at the table privilege layer, for every CRUD operation.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform 1 from public.items;
    raise exception 'Anon can read items';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.items (id, name, category, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000063', 'TEST ONLY — anon', 'Tops', now(), now());
    raise exception 'Anon can insert items';
  exception when insufficient_privilege then null; end;
  begin
    update public.items set care = 'FORGED';
    raise exception 'Anon can update items';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.items;
    raise exception 'Anon can delete items';
  exception when insufficient_privilege then null; end;
end;
$$;

-- Complete A's delete assertion after checking cross-owner isolation.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$
declare affected int;
begin
  delete from public.items where id = '00000000-0000-0000-0000-000000000061';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'A cannot delete its own item'; end if;
end;
$$;

rollback;
