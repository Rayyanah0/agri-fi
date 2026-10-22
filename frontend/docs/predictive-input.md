# Predictive Input & Smart Suggestions

The deal creation form includes a predictive input layer that reduces manual data entry for traders. It provides predictive text for common fields, smart amount suggestions, auto-fill for recurring fields, real-time validation with context-aware hints, template-based and batch deal creation, deal similarity detection, and analytics that track suggestion acceptance and time saved.

This document describes the capabilities, where suggestions come from, how the learning loop works, and the metrics that are tracked.

---

## Overview

Predictive input is composed of several cooperating features:

| Feature | Purpose |
| --- | --- |
| Predictive text | Suggest crop types, regions, and shipment routes as the trader types |
| Smart amount suggestions | Propose deal amounts based on market prices and historical deals |
| Auto-fill | Pre-populate recurring fields (trader details, standard terms) |
| Real-time validation | Validate input as it is entered and surface context-aware suggestions |
| Suggestion learning | Improve suggestions over time from user corrections |
| Templates | Pre-filled deal templates for common deal types |
| Similarity detection | Warn when a new deal closely resembles an existing deal |
| Batch creation | Create multiple similar deals from a template |
| Analytics | Track acceptance rate and time saved |

The goal is to cut deal creation time substantially (target: **45% reduction**) while reducing data-entry errors.

---

## Predictive Text

Predictive text is available on the following fields:

- **Crop types** — suggested from the trader's history and the platform's catalog of crops.
- **Regions** — suggested from historical deals, trader location, and common trade corridors.
- **Shipment routes** — origin/destination pairs suggested from past shipments and frequently used corridors.

### Behavior

- Suggestions appear as the trader types, ranked by relevance.
- Ranking blends frequency of use, recency, and similarity to the current input.
- Selecting a suggestion fills the field and records an acceptance event (see [Analytics](#analytics)).
- If the trader types a value that differs from a suggestion, the correction is recorded for the learning loop.

### Suggestion sources

Predictive text draws from:

1. **Historical deals** — the trader's own past deals and, where permitted, aggregated platform data.
2. **Catalog data** — canonical crop types, regions, and route definitions.
3. **Learned corrections** — values the trader has previously entered or corrected (see [Suggestion Learning](#suggestion-learning)).

---

## Smart Amount Suggestions

Amount fields receive suggestions derived from:

- **Market prices** — current and recent market price data for the selected crop and region.
- **Historical deals** — amounts from the trader's comparable past deals (same crop, region, and route).
- **Deal context** — quantity, unit, and counterparty influence the suggested range.

Suggestions are presented as a recommended value plus a plausible range, so the trader can accept, adjust, or ignore them. Amount suggestions are recalculated when the crop, region, or quantity changes.

---

## Auto-Fill for Recurring Fields

Fields that rarely change between deals are auto-filled from the trader's profile and prior deals:

- **Trader details** — name, contact, and account information.
- **Standard terms** — payment terms, delivery terms, and other defaults the trader has established.

Auto-filled values remain editable. Editing an auto-filled value is treated as a correction and feeds the learning loop.

---

## Real-Time Validation with Context-Aware Suggestions

Validation runs as the trader types rather than only on submit. When a value is invalid or unusual, the form:

- Flags the field immediately with a clear message.
- Offers context-aware suggestions to resolve the issue (e.g., a corrected region, a plausible amount range, or a matching route).

Context-aware suggestions take the rest of the form into account — for example, a region suggestion considers the selected crop and route.

---

## Suggestion Learning

Suggestions improve over time through a feedback loop:

1. Every suggestion shown is logged along with whether it was **accepted**, **modified**, or **ignored**.
2. Corrections (modified or ignored suggestions) are recorded as signals.
3. Signals are aggregated per trader and per field to re-rank future suggestions.
4. Over time, frequently accepted suggestions rise and frequently corrected ones fall.

The learning loop uses the existing analytics infrastructure, so no separate training pipeline is required for rule-based suggestions. Corrections are also available for future model-based improvements.

---

## Template-Based Deal Creation

Templates provide pre-filled deals for common deal types. A template captures:

- Crop type, region, and shipment route
- Typical amount or amount range
- Standard terms and trader details
- Any other recurring field values

Selecting a template pre-fills the form, which the trader can then adjust. Templates can be created from an existing deal ("save as template") or from scratch.

---

## Deal Similarity Detection

Before a deal is submitted, the form checks for existing deals that closely resemble the new one. Similarity considers crop, region, route, counterparty, amount, and timing.

If a similar deal is found, the trader is warned and shown the matching deal(s) so they can:

- Confirm the new deal is intentional (e.g., a legitimate repeat deal), or
- Adjust the new deal to avoid an accidental duplicate.

Similarity detection helps prevent duplicate entries and accidental double-booking.

---

## Batch Deal Creation

Batch creation lets a trader create multiple similar deals from a template in one flow:

1. Start from a template (or an existing deal).
2. Specify the varying fields across the batch (e.g., quantity, amount, or counterparty per deal).
3. Review the generated set of deals.
4. Submit the batch.

Each deal in the batch is validated individually, and similarity detection runs across the batch as well as against existing deals.

---

## Analytics

Suggestion analytics track the effectiveness of the predictive input layer:

| Metric | Description |
| --- | --- |
| **Acceptance rate** | Share of shown suggestions that were accepted, per field and overall |
| **Correction rate** | Share of suggestions that were modified or ignored |
| **Time saved** | Estimated reduction in deal creation time versus manual entry |
| **Template usage** | How often templates are used and which are most popular |
| **Similarity warnings** | How often similarity warnings fire and their outcomes |
| **Batch usage** | Number of deals created via batch flows |

These metrics are surfaced through the existing analytics infrastructure and are used to measure progress toward the 45% time-reduction target and to guide further improvements to suggestion ranking.

---

## Summary

Predictive input combines predictive text, smart amount suggestions, auto-fill, real-time validation, learning, templates, similarity detection, batch creation, and analytics into a single layer on top of the deal creation form. Together these features reduce manual entry, catch errors early, prevent duplicates, and continuously improve as traders use the form.