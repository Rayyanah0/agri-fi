# Document Classification and Auto-Tagging

## Processing flow

Document uploads continue through the existing malware scan, storage, and Stellar anchoring flow. After the document record is persisted, the classification service analyzes the filename and embedded text, records a predicted document type, confidence, tags, extracted dates and currency amounts in the existing `documents.metadata` JSONB field, and returns the updated record. When `DOCUMENT_CLASSIFICATION_URL` is configured, the service submits bounded text and the declared type to that authenticated provider; the provider must return a supported type and a numeric confidence between 0 and 1. `DOCUMENT_CLASSIFICATION_TOKEN` is sent as a bearer credential.

The built-in classifier is a deterministic keyword fallback, not a trained machine-learning model. It does not perform OCR and intentionally uses a low confidence when text cues are absent. Results below 0.75 set `classification.needsReview`; the platform must not claim a measured accuracy until a representative labeled evaluation corpus and production classifier have been established.

## Partner APIs

- `GET /v1/documents/classification/analytics` returns uploader-scoped document counts by type, review counts, and mean classifier confidence.
- `GET /v1/documents/classification/clusters` groups the caller's documents by deal and classified document type.
- `GET /v1/documents/classification/:documentId/similar` ranks the caller's documents by same deal and type.
- `POST /v1/documents/classification/:documentId/feedback` accepts `correctedType` and optional tags, updates the classification metadata, and retains the correction for future training exports.

All routes require JWT authentication and scope document reads/updates to the authenticated uploader. Classification tags and extracted values are metadata only and do not change the immutable IPFS content.

## Metadata extraction, retention, and operational limits

Embedded text and filename parsing extracts date-like strings and currency amounts. Parties and locations remain empty unless the configured provider extracts them. `retention.reviewAfter` is a review date, not an automatic archive or deletion instruction; archival requires an operational retention policy and storage-tier integration. Similarity currently uses same-deal and same-type matching, rather than vector embeddings or learned clustering.

The provider endpoint is optional. Configure a private HTTPS endpoint, restrict its network egress, and avoid logging document contents. A classification provider outage falls back to the local classifier and marks uncertain results for review.