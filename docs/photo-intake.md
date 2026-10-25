# Local photo intake

The owner drops garment photos into `0INPUT/` and tells the agent to process the folder. Front and label photos, plus optional back/detail photos, may be mixed in a batch. The agent groups photos by garment, checks the grouping, and asks only when a photo cannot be matched confidently. The owner does not need to rename files, make folders, prepare import JSON, or run commands.

This is an agent-assisted workflow when requested in chat. It is not a continuous folder watcher or unattended automation. Files appearing in the folder do not trigger processing or spending on their own. Existing permission rules still apply to paid generation, new external services and GitHub pushes. Adding garments updates private closet data and normally needs no code deployment.

## Folder organisation

| Folder | Meaning |
| --- | --- |
| `0INPUT/` | New, ungrouped photos. |
| `1PROCESSING/` | Grouped garments being analysed, researched, generated or synced. |
| `2PROCESSED/` | Finished garments with a finalized studio asset, proportion/crop QA and verified website sync. |
| `3NEEDS-INFO/` | Grouped garments blocked by missing or ambiguous information, with a written reason. |

Each grouped garment uses `<stable-item-UUID>-<short-slug>/` with:

- `originals/`: exact source files, retaining their original filenames and SHA-256 hashes.
- `working/`: rotations, conversions, contact sheets and prepared import data.
- `references/`: online product research and permitted reference assets. Record source URLs and uncertainty.
- `generated/`: AI studio versions, generation prompts and the final asset.
- `manifest.json`: identity, source hashes and roles, analysis, online-reference research, final-image provenance, visual QA and sync evidence.

These four top-level folders and private media are gitignored. Keep them outside `public/`; never commit photos, private manifests or prepared batches. Do not put credentials, session tokens or personal email addresses in manifests or logs. `1PROCESSING/.journals/` records local file operations and is ignored too.

## Processing a garment

1. Inspect and group the sources. Assign one stable UUID to the garment and use it again for import/retries. Stage files only once the grouping is clear; assign roles such as `front`, `label`, `back` and `detail` in the manifest. Preserve the original files exactly; make transformations in `working/`.
2. Read the visible label and record only supported facts. Find the item online where possible, compare construction and proportions, and record reference URLs. A visual match without a matching product code is uncertain. If there is no verified online match, say so rather than invent one.
3. Produce an AI-generated catalogue image for every garment, following the owner's chosen consistent style. Originals remain authoritative. Compare width against length, shoulders, sleeves, collar, pockets, fasteners and colour with both the original and online reference. Preserve the actual cut. Keep sleeves and hem visible after both the 4:5 catalogue and square thumbnail crops. Follow the detailed [catalogue image workflow](chat-import.md#catalogue-image-workflow).
4. Save final-image provenance and SHA-256. Record visual QA explicitly, including proportions and crop margins. Keep earlier versions until the final replacement has been verified. Label generated images **AI-generated** in the website; never replace the original photo.
5. Use the existing [private import and sync workflow](chat-import.md). Verify the actual stable item UUID and final image on the signed-in website after cloud sync, and record when and how that was checked. A local file conversion, generated PNG or attempted upload is not completion.
6. Finish the garment only after all checks pass. If grouping or garment identity needs the owner's help, park it in `3NEEDS-INFO/` with an explanation; keep it out of `2PROCESSED/`.

## Agent CLI (Node 24)

This script is local file management only: it never generates images, fetches references, uploads photos, changes the database or pushes Git. It does not analyse images by itself.

```sh
node scripts/manage-photo-intake.mjs init
node scripts/manage-photo-intake.mjs status

node scripts/manage-photo-intake.mjs stage \
  --id d244b23b-a245-4fde-a2a4-57edb9aa1bfd \
  --slug beige-shirt \
  --files front.jpg label.jpg back.jpg --dry-run

# Remove --dry-run after checking the grouping.
node scripts/manage-photo-intake.mjs stage \
  --id d244b23b-a245-4fde-a2a4-57edb9aa1bfd \
  --slug beige-shirt \
  --files front.jpg label.jpg back.jpg

node scripts/manage-photo-intake.mjs finish \
  --id d244b23b-a245-4fde-a2a4-57edb9aa1bfd --dry-run
node scripts/manage-photo-intake.mjs finish \
  --id d244b23b-a245-4fde-a2a4-57edb9aa1bfd

node scripts/manage-photo-intake.mjs hold \
  --id d244b23b-a245-4fde-a2a4-57edb9aa1bfd \
  --reason "Need to confirm which garment this label belongs to."
```

`stage` accepts plain image filenames directly inside `0INPUT/`, not arbitrary paths. It refuses an already organised UUID. The destination folder must be new. Each original is hashed before copying, copied exclusively, checked against the original hash, then removed from intake only after verification. Sources are rechecked immediately before removal. Names, extensions and bytes are preserved; HEIC/TIFF originals may be kept even though the web importer needs JPEG, PNG or still WebP working copies.

`finish` checks the manifest before moving the entire garment folder to `2PROCESSED/`. Required fields are:

```json
{
  "analysis": {
    "complete": true,
    "completedAt": "2026-10-25T10:00:00.000Z",
    "notes": "Visible garment and label details, original photo roles and grouping checked."
  },
  "reference": {
    "status": "uncertain",
    "checkedAt": "2026-10-25T10:05:00.000Z",
    "urls": [],
    "notes": "Online search completed; exact product not verified."
  },
  "generation": {
    "finalized": true,
    "path": "generated/studio-final.png",
    "sha256": "<actual 64-character SHA-256>",
    "provider": "<actual provider>",
    "model": "<actual model, or state when the built-in tool does not expose it>",
    "createdAt": "2026-10-25T10:10:00.000Z",
    "visualQA": {
      "passed": true,
      "checkedAt": "2026-10-25T10:15:00.000Z",
      "notes": "Document actual proportions, construction and phone/desktop crop checks."
    }
  },
  "sync": {
    "verified": true,
    "itemId": "d244b23b-a245-4fde-a2a4-57edb9aa1bfd",
    "verifiedAt": "2026-10-25T10:20:00.000Z",
    "evidence": "Record the live item URL and an actual post-sync verification or local screenshot path, without credentials."
  }
}
```

These are illustrative fields to update in the full staged manifest, not a replacement for its identity or `originals` array. Reference status is `checked` with at least one HTTPS source URL, or `uncertain` with a clear research note. Set all dates to the actual event times. The script checks completion records and image hashes; it cannot independently verify that a written observation is truthful or that cloud sync occurred. The agent must perform those checks before writing the evidence.

`hold --id UUID --reason "Reason"` (also available as `needs-info`) moves a processing folder to `3NEEDS-INFO/` with a separate timestamped reason file. `resume --id UUID` returns that whole folder to `1PROCESSING/`, preserving the stable UUID, original hashes and history. Both operations use the same verified-copy journals and support `--dry-run`. Do not stage its photos as a new garment.

## Interrupted operations

Moves are implemented as exclusive copies followed by hash verification and source removal. Operation plans are flushed to append-only `.jsonl` journals before moving files; each verified copy and removal is logged. If interrupted, `status` lists incomplete journals. Inspect the journal, then run:

```sh
node scripts/manage-photo-intake.mjs recover --journal <plain-journal-filename.jsonl> --dry-run
node scripts/manage-photo-intake.mjs recover --journal <plain-journal-filename.jsonl>
```

Recovery accepts only matching source/destination hashes, finishes the recorded operation and never overwrites a conflicting file. A partial copy or changed file stops recovery for manual inspection; preserve both copies, verify against the journal hash, and remove only a proven incomplete duplicate before retrying. Do not delete source photos to make an operation pass. Source folders are removed only when empty. Symlinks, traversal paths and unsupported filesystem objects are rejected.

`--dry-run` performs validation and hashing without changing files. `--root /absolute/local/test-directory` redirects the four folders for isolated checks; production use defaults to this project directory regardless of the current shell directory.
