-- Private photo storage. Paths are <user_id>/<item_id>/full.webp and thumb.webp;
-- the first folder is the owner, which every policy checks.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('closet-photos', 'closet-photos', false, 2097152, array['image/webp', 'image/jpeg']);

create policy "Own photos: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'closet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Own photos: upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'closet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Upsert (replacing a photo) needs update as well as select.
create policy "Own photos: replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'closet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'closet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Own photos: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'closet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
