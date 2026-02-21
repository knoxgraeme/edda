-- Seed default item types

INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint) VALUES
  ('note',        '📝', 'General note or thought',                '{}', 'Catch-all for thoughts, observations, or information that doesn''t fit a more specific type'),
  ('reminder',    '🔔', 'Something to remember at a specific time', '{"due_date": "ISO date", "priority": "low|medium|high"}', 'User wants to be reminded about something, often with a date or deadline'),
  ('task',        '✅', 'Action item to complete',                 '{"priority": "low|medium|high", "due_date": "ISO date"}', 'A specific thing the user needs to do — different from reminder in that it''s an action, not just a nudge'),
  ('event',       '📅', 'Calendar event or appointment',           '{"date": "ISO date", "time": "HH:MM", "location": "string"}', 'Something happening at a specific date/time — meetings, appointments, events'),
  ('list_item',   '🛒', 'Item in a named list',                   '{"list_name": "string"}', 'Part of a list — groceries, packing, shopping. Multiple items often captured at once'),
  ('link',        '🔗', 'URL to save for later',                  '{"url": "string", "title": "string"}', 'A URL the user wants to save, bookmark, or read later'),
  ('idea',        '💡', 'Creative idea or inspiration',            '{}', 'An idea the user wants to capture — product ideas, creative thoughts, what-ifs'),
  ('decision',    '⚖️', 'A decision that was made',               '{"context": "string"}', 'Something that was decided — useful for institutional memory'),
  ('meeting',     '🤝', 'Meeting notes or summary',               '{"attendees": ["string"], "date": "ISO date"}', 'Notes from a meeting — often includes decisions, action items, and attendees'),
  ('journal',     '📓', 'Private reflection or diary entry',      '{}', 'Personal/emotional content — journal entries, reflections. Private by default (excluded from casual recall)'),
  ('preference',  '⚙️', 'User preference or setting',             '{}', 'How the user likes things done — communication style, scheduling preferences. Agent-internal.'),
  ('learned_fact','🧠', 'Fact about the user',                    '{}', 'Personal facts — relationships, routines, dietary restrictions. Agent-internal.'),
  ('pattern',     '📊', 'Behavioral pattern observed',            '{}', 'Patterns the agent notices — "brain-dumps groceries on Thursdays". Agent-internal.')
ON CONFLICT (name) DO NOTHING;
