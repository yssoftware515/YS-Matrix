# YS-Matrix — Storage & File Architecture

**Status:** Discovery / Forensic Audit — Phase 1.

---

## 1. Core Fact: There Is No File Storage Implementation

YS-Matrix stores **no files**. There is no upload endpoint, no multipart handling, no `fs` writes, no S3/blob provider anywhere in either tree (FACT — glob for uploader/multer/storage/fs usage: none in `backend/src`; `frontend` has no upload components).

All "media" fields are **external URLs stored as strings** (FACT — `backend/prisma/schema.prisma`):

| Field | Model | Type |
|---|---|---|
| `image_urls TEXT[]` | Inventory | URL array (product images) |
| `avatar_url` | User | single URL (profile picture) |
| `logo_url` | Showroom | single URL (tenant logo) |

The frontend settings/onboarding/edit flows treat these as text inputs; no picker/uploader exists (FACT — pages confirmed; `updateProfileSchema` validates `avatar_url` as a URL string).

## 2. What This Means for Each Storage Question

| Question | Answer | Evidence |
|---|---|---|
| Where are uploaded files stored? | **N/A — no uploads** | |
| Filename generation? | N/A | |
| Predictable paths? | N/A | |
| Upload validation (MIME/size)? | N/A (body limit 10mb applies to JSON only) | index.js:104-105 |
| Authorization protecting files? | N/A for files; URLs are data and follow API authorization | invoice/customer APIs |
| Private files directly accessible? | N/A | |
| Local vs external? | External URLs only (client-provided) | schema |
| Deletion cleans files? | N/A — deleting a record leaves the URL string only; the hosted object (if any) is untouched | soft-delete semantics |
| Image processing? | None | |
| Storage abstraction? | None | |

## 3. Risks, Given the URL-Only Model (FACT-based analysis)

1. **Hotlink dependence**: product images live wherever the dealer pasted URLs from; a 403 on the source breaks dashboards (external dependency, no caching beyond browser).
2. **`image_urls` unvalidated**: any URL string (including `javascript:` or local network URLs in printed HTML contexts) can be stored by an authenticated user. The invoice HTML page does not render images (only text), so injection sink is the FE `<img src>` if FE renders inventory images — **FE renders inventory images?** Inventory card grid — partial INFO: FE page displays `image_urls` in cards (FACT — inventory page shows images; no URL sanitization on FE). This is a low-severity UX/abuse vector (hotlinking/SSRF-adjacent only if the browser ever loads it server-side — it doesn't).
3. **White-label/branding**: logo_url/avatar_url as URLs means branding quality depends on third-party availability and TLS (MIXED CONTENT risk if a dealer pastes `http://` URL into an `https` page — blocked by browsers; LOW).
4. **No size/type controls** — consistent with no-upload design.

## 4. Future-Readiness Assessment (RECOMMENDATION only)

For commercial scaling (real branding, photos, invoice logos, future SMS/pdf attachments):
- Introduce real upload infrastructure: S3-compatible object storage + signed URLs, with validation (MIME allow-list, size caps, random filenames, per-tenant prefixes)
- Keep URL fields for backward compatibility; migration path = optional storage layer behind a `store()`/`resolve()` abstraction
- Add cache headers/CDN for public images
- Consider serving user content from a dedicated domain (cookie isolation best practice for token-bearing apps — relevant to F2 mitigation)

**Until then, document the current model as "no file storage" so marketing claims ("barcode-ready", "PDF export") are tuned to reality (they are, partially).**

## 5. Database Blob/Media Facts

- No `BYTEA`/LOB columns; only TEXT[] URL arrays (FACT).
- No Media/Asset entity — images are denormalized strings (fine at current scale; an Asset table would be the honest evolution for uploads).

## 6. Conclusion

Storage audit is **trivially green today** because there is nothing to secure (no upload surface = no upload vulnerabilities). The gap is functional (no uploads at all), which constrains product claims; it becomes a security topic the day uploads are added — plan the object-storage + authorization model then (RECOMMENDATION for the roadmap, NOT this phase).