# Garment image standard

Read this at the start of every Digital Closet chat/session and before every generation or regeneration. It applies project-wide, including `0INPUT/`, `1PROCESSING/`, `2PROCESSED/` and `3NEEDS-INFO/`. This is the owner's standing image direction; use it with [photo intake](photo-intake.md) and [chat import](chat-import.md).

## Search before generation

1. Inspect the owner's front, label and optional back/detail photos. Read visible brand and product codes; record unknowns honestly.
2. Search the web for that garment before generating. Prefer the brand's product page and actual product photos; a trustworthy archived or resale listing can help identify older items. Compare product code when available, colour, fabric, collar, pockets, fastening layout, seams, hem and width-to-length ratio. A generic brand page or merely similar shirt is not a matching design reference.
3. When a matching online product image can be inspected, use that image as a generation reference alongside the owner's original photos. Record its URL, inspection date, match confidence, matching details and uncertainty. Do not describe a text search or inaccessible image as a visually inspected reference. A strong visual match without a verified code stays explicitly uncertain.
4. If no matching design image can be found or inspected, generate from the owner's original photos only. Record that fallback. Do not substitute a similar garment or invent unseen construction to resemble an online item. Search uses public product descriptions/codes; do not upload the owner's photos to a new search service without permission.

## Retail presentation when a matching online design reference exists

The final AI image should look ready for an online clothing store, with the tidy product presentation used by retailers such as UNIQLO:

- Button the garment's existing front fasteners neatly; close an accidentally open body placket. Respect the reference's collar construction: a camp collar or designed open neckline must retain its shape. Never invent a top button or other hardware. For zips/snaps, follow the matching reference's intended product presentation.
- Show a clean, neatly arranged garment with balanced sleeves, collar and hem. Remove distracting wrinkles and creases where possible, while retaining real fabric grain, seersucker puckering, pleats, knit structure, intentional distressing and natural drape.
- Preserve actual proportions, regular/cropped length, pocket positions, graphics, fastener count and colour. Buttoning or smoothing must not shrink the torso, narrow the shoulders or redesign the item.
- Keep the complete garment visible in the actual 4:5 catalogue card and square thumbnail, with the established close framing, neutral background and soft even studio lighting. No hanger, person, props or caption burned into the pixels.

This presentation adjustment is conditional on finding a matching online design reference. Without one, follow the original photos alone; do not guess concealed buttons or make unsupported changes. The owner's original remains authoritative if references conflict. Preserve originals and earlier AI versions separately. Generated images stay labelled **AI-generated**, and suggestions stay **Needs review** until owner confirmation.

## Before replacing a live image

Inspect original + online reference + new render side by side. Check closure, natural texture, body/sleeve proportions, collar, pockets, artwork, fastener layout and both display crops. Save reference evidence, prompt, provenance and final hash in the private garment folder. Update the existing stable UUID's render only; preserve original/label/back photos and other item data. Verify the replacement on the signed-in live website after cloud sync before calling it complete. Private garment media updates normally need no GitHub push. Existing cost, provider, privacy and push permissions still apply.
