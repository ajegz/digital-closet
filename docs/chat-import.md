# Chat photo import

For the owner’s folder-based intake, grouping and archive process, see [Local photo intake](photo-intake.md).

Send one garment per set: front, label close-up, and optional back. Chat can prepare a studio render, check it against the source, and package the piece for the app. Your real front photo remains the original record. Catalogue cards and the piece's detail view show the studio image by default, labelled **AI-generated**. Use the detail view's **Original**, **Label** and **Back** controls to inspect the source photos. Outfit collages, wear logs and other small thumbnails keep showing the original. All imported pieces start **Needs review**.

## Catalogue image workflow

The owner's chosen catalogue style is AI-generated studio images for every garment. First look for the same item online, using product codes when visible and comparing the cut, collar, fasteners, pockets and colour. Treat a visual match without a verified product code as a reference with uncertain identity. Use the owner's real photos as the authoritative record, and the online photos to check proportions and drape before generating the studio image.

Compare body width against length, shoulder span, sleeve length and openings, collar size, pocket placement and fastener count before importing. Preserve regular or cropped body length as actually supported by the references; do not change the cut to fit the frame. Keep the entire garment, including sleeve tips and hem, visible in both the 4:5 catalogue cards and square list thumbnails. Square assets need at least 14% clear background on each side to survive the cards' centred crop. Use a consistent neutral background, front view and lighting. Keep originals separate and generated images labelled **AI-generated**.

An existing piece's studio image can be replaced as a private data update: upload new versioned full and thumbnail paths, update only its render fields and generation provenance, and advance `updated_at` so other devices pull the revision. Preserve all original/reference photos and item details. The add-only import deliberately skips existing IDs. Keep the previous studio version until the replacement is verified, and never place either version in Git.

After the import feature's one approved deployment, a batch is data: importing it needs no GitHub push. Open **Add → Import from chat**, choose the private JSON file, and review the batch before saving. When cloud backup is configured, sign in and connect to the internet first; the app checks your private closet for duplicates before saving. It then syncs photos to the existing private Supabase bucket so the piece appears on the live GitHub Pages app and other devices. A development build with cloud backup disabled permits local imports for testing, which stay in that browser. Photos never belong in the public repository.

## Prepare a private batch locally

Run with Node 24:

```sh
node scripts/prepare-chat-import.mjs .closet-imports/shirt-spec.json zara-shirt.json
```

The spec uses local image paths (relative to the spec) instead of embedded data URLs:

```json
{
  "items": [{
    "id": "d244b23b-a245-4fde-a2a4-57edb9aa1bfd",
    "name": "Beige short-sleeve shirt",
    "category": "Shirts",
    "brand": "Zara",
    "color": "Beige",
    "size": "S–M",
    "photos": {
      "front": "front.jpg",
      "label": "label.jpg",
      "render": "studio.png"
    },
    "ai": {
      "render": {
        "provider": "OpenAI",
        "model": "The actual model used",
        "createdAt": "2026-10-25T00:00:00.000Z"
      }
    }
  }]
}
```

Keep the same UUID when retrying the same piece. The app skips existing IDs, including deleted pieces, and saves each new batch atomically. A render requires provider, model and creation date; the script adds a SHA-256 hash of the original front photo. Optional `prompt` and HTTPS `referenceUrl` record provenance. Reference URLs are metadata and are never fetched by the importer. Omit both `photos.render` and `ai` when there is no generated image.

The output is an embedded-photo JSON file under `.closet-imports/`, which is gitignored. Files are limited to 30 MB, ten pieces and 12 MB per input photo. Header checks reject dimensions above 40 megapixels or a 10,000-pixel edge before decoding; the app then decodes and compresses photos before saving. Supported formats are JPEG, PNG and still WebP. Keep source photos/specs under this ignored directory or outside the repository too. The preparer and importer make no AI provider calls and need no API secrets.

Run validator tests with `node --test tests/chat-import.test.mjs`.
