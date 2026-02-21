INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, dashboard_section, built_in)
VALUES (
  'recommendation', '⭐',
  'Something recommended to or by the user — movies, books, restaurants, podcasts, products, tools',
  '{"category": "string", "recommended_by": "string", "source": "string"}',
  'A recommendation for something to watch, read, try, visit, or use. Always include the category (e.g. movie, book, restaurant, podcast). If someone else recommended it, include recommended_by.',
  'captured', true
) ON CONFLICT (name) DO NOTHING;
