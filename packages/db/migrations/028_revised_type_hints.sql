-- 028_revised_type_hints.sql
-- Rewrite classification_hint and extraction_hint for all built-in item types.
-- Follows behavioral-trigger pattern: WHEN signal + surface phrases + negative boundary + tiebreaker.
-- Separates classification (should I use this type?) from extraction (what metadata to pull?).

-- ── User-facing types ─────────────────────────────────────

UPDATE item_types SET
  classification_hint = 'Use when the input is informational, observational, or doesn''t fit a more specific type. Choose note over idea when the user is recording something that happened or exists, not imagining something new. When uncertain between note and any specific type, prefer the specific type.',
  extraction_hint = ''
WHERE name = 'note';

UPDATE item_types SET
  classification_hint = 'Use when the user states something they need to do, complete, or follow up on. Key signal: personal ownership of an action ("I need to", "I have to", "don''t forget to do"). Prefer task over reminder when the emphasis is on the work itself rather than the timing. Prefer task over note when there is a clear next action.',
  extraction_hint = 'Extract priority (low/medium/high) and due_date (ISO date) when mentioned.'
WHERE name = 'task';

UPDATE item_types SET
  classification_hint = 'Use when the user wants to be alerted at a specific time or before a deadline — the emphasis is on the notification, not the action. Signal phrases: "remind me", "don''t let me forget", "alert me when", combined with a time or date. Prefer reminder over task when the goal is the nudge, not tracking work.',
  extraction_hint = 'Extract due_date (ISO date) and priority (low/medium/high) when mentioned.'
WHERE name = 'reminder';

UPDATE item_types SET
  classification_hint = 'Use for something happening at a specific future date/time that the user plans to attend or track. Signal phrases: "I have a", "scheduled for", "on [date]", "appointment". Prefer event over meeting when nothing has happened yet — event is future-facing, meeting is retrospective.',
  extraction_hint = 'Extract date (ISO date), time (HH:MM), and location when mentioned.'
WHERE name = 'event';

UPDATE item_types SET
  classification_hint = 'Use when the user is logging or summarizing a meeting that already happened or just finished. Often includes attendees, what was discussed, decisions made, or action items. Prefer meeting over event when recording what occurred, not what is upcoming.',
  extraction_hint = 'Extract attendees (list of names) and date (ISO date) when mentioned.'
WHERE name = 'meeting';

UPDATE item_types SET
  classification_hint = 'Use for discrete items that belong to a named collection — groceries, packing, shopping, reading lists. Signal: multiple items given in sequence, or a list name is implied ("eggs and milk" → groceries). Do not use for tasks or action items even if they appear in list form.',
  extraction_hint = 'Extract list_name from context. If the user says "add to my grocery list", list_name is "grocery".'
WHERE name = 'list_item';

UPDATE item_types SET
  classification_hint = 'Use when the user shares a URL or clearly wants to bookmark something for later. The URL must be present or clearly implied. Prefer link over note even if the user adds commentary — the URL is the primary artifact.',
  extraction_hint = 'Extract url and title when present.'
WHERE name = 'link';

UPDATE item_types SET
  classification_hint = 'Use when the user is brainstorming, imagining possibilities, or proposing something that doesn''t exist yet. Signal phrases: "what if", "we could", "I''ve been thinking about", "here''s an idea". Prefer idea over note when the input is generative or speculative rather than observational. Prefer idea over task when there is no concrete next action.',
  extraction_hint = ''
WHERE name = 'idea';

UPDATE item_types SET
  classification_hint = 'Use when a choice between options was made and should be recorded for future reference. Signal: past tense about an outcome ("we decided", "I''m going with", "we agreed on"). Often a child of a meeting item. Not a task (no action required) and not a note (a specific choice was made).',
  extraction_hint = 'Extract context — what was decided and why, if stated.'
WHERE name = 'decision';

UPDATE item_types SET
  classification_hint = 'Use when the user is processing feelings, reflecting on their day, or writing something deeply personal. Signal: emotional language, introspection, diary-style writing. Prefer journal over note when the content is about how the user feels, not what they observed. Private — never surface in casual recall.',
  extraction_hint = ''
WHERE name = 'journal';

UPDATE item_types SET
  classification_hint = 'Use when the user records something worth trying — a movie, book, restaurant, podcast, tool, or product. Signal: "you should check out", "apparently X is great", "someone recommended". Always capture the category. Prefer recommendation over note when a specific thing is being suggested to watch, read, try, visit, or use.',
  extraction_hint = 'Extract category (movie, book, restaurant, podcast, tool, etc.), recommended_by (who suggested it), and source (where they heard about it).'
WHERE name = 'recommendation';

-- ── Agent-internal types ──────────────────────────────────

UPDATE item_types SET
  classification_hint = 'Agent-internal. Use to record how the user prefers things done — communication style, scheduling habits, formatting choices, workflow preferences. These shape future agent behavior. Prefer preference over learned_fact when it describes a habitual choice, not a factual attribute.',
  extraction_hint = ''
WHERE name = 'preference';

UPDATE item_types SET
  classification_hint = 'Agent-internal. Use to record factual attributes about the user — relationships, dietary restrictions, location, professional role, recurring commitments. Prefer learned_fact over preference when it is a fact about who they are, not how they like things done.',
  extraction_hint = ''
WHERE name = 'learned_fact';

UPDATE item_types SET
  classification_hint = 'Agent-internal. Use when the agent observes a recurring behavior or tendency across multiple conversations — "always brain-dumps groceries on Thursdays", "tends to schedule meetings in the morning". Require at least 2-3 supporting instances before creating a pattern.',
  extraction_hint = ''
WHERE name = 'pattern';

-- ── System type ───────────────────────────────────────────

UPDATE item_types SET
  classification_hint = 'System-internal. Notification from a background agent run. Not user-classified — created programmatically by the notification service.',
  extraction_hint = ''
WHERE name = 'notification';
