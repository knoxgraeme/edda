-- Entities — people, projects, companies, topics, places

CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('person', 'project', 'company', 'topic', 'place')),
  aliases TEXT[] DEFAULT '{}',
  description TEXT,
  mention_count INT DEFAULT 1,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_mentions ON entities(mention_count DESC);
CREATE INDEX idx_entities_embedding ON entities USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Join table: items <-> entities
CREATE TABLE item_entities (
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, entity_id)
);
