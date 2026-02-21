-- Daily dashboard stored function

CREATE OR REPLACE FUNCTION get_daily_dashboard(p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object(
    'date', p_date,

    'captured', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', i.id, 'type', i.type, 'icon', it.icon,
          'content', i.content, 'summary', i.summary,
          'status', i.status, 'metadata', i.metadata,
          'created_at', i.created_at
        ) ORDER BY it.dashboard_priority, i.created_at
      ), '[]'::jsonb)
      FROM items i JOIN item_types it ON i.type = it.name
      WHERE i.day = p_date AND i.confirmed = true
        AND it.dashboard_section = 'captured'
        AND it.agent_internal = false
    ),

    'due_today', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', i.id, 'type', i.type, 'icon', it.icon,
          'content', i.content, 'summary', i.summary,
          'status', i.status, 'metadata', i.metadata, 'day', i.day
        ) ORDER BY it.dashboard_priority
      ), '[]'::jsonb)
      FROM items i JOIN item_types it ON i.type = it.name
      WHERE it.has_due_date = true AND i.confirmed = true
        AND it.agent_internal = false
        AND (i.metadata->>'due_date')::date = p_date
        AND i.status IN ('active', 'snoozed')
    ),

    'open_items', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', i.id, 'type', i.type, 'icon', it.icon,
          'content', i.content, 'summary', i.summary,
          'day', i.day, 'due_date', i.metadata->>'due_date',
          'age_days', p_date - i.day
        ) ORDER BY i.metadata->>'due_date' NULLS LAST, i.day
      ), '[]'::jsonb)
      FROM items i JOIN item_types it ON i.type = it.name
      WHERE it.completable = true AND i.confirmed = true
        AND it.agent_internal = false
        AND i.status = 'active' AND i.day < p_date
        AND (i.metadata->>'due_date' IS NULL
             OR (i.metadata->>'due_date')::date <= p_date)
    ),

    'lists', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object('list_name', sub.list_name, 'icon', sub.icon, 'items', sub.items)
      ), '[]'::jsonb)
      FROM (
        SELECT i.metadata->>'list_name' AS list_name, it.icon,
          jsonb_agg(jsonb_build_object(
            'id', i.id, 'content', i.content, 'status', i.status, 'day', i.day
          ) ORDER BY i.created_at) AS items
        FROM items i JOIN item_types it ON i.type = it.name
        WHERE it.is_list = true AND i.confirmed = true
          AND it.agent_internal = false
          AND i.status = 'active' AND i.metadata->>'list_name' IS NOT NULL
        GROUP BY i.metadata->>'list_name', it.icon
      ) sub
    ),

    'pending_confirmations', (
      SELECT coalesce(jsonb_agg(pending ORDER BY pending->>'created_at'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'table', 'items', 'id', i.id, 'type', i.type,
          'content', i.content, 'pending_action', i.pending_action,
          'created_at', i.created_at
        ) AS pending FROM items i WHERE i.confirmed = false
        UNION ALL
        SELECT jsonb_build_object(
          'table', 'item_types', 'id', it.name,
          'type', 'new_type', 'content', it.description,
          'pending_action', 'New type: ' || it.icon || ' ' || it.name,
          'created_at', it.created_at
        ) FROM item_types it WHERE it.confirmed = false
        UNION ALL
        SELECT jsonb_build_object(
          'table', 'entities', 'id', e.id,
          'type', 'entity_merge', 'content', e.name,
          'pending_action', e.pending_action,
          'created_at', e.created_at
        ) FROM entities e WHERE e.confirmed = false
      ) sub
    )
  );
$$;
