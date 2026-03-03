
-- Table for stored LoRa signals
CREATE TABLE public.signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_hash TEXT UNIQUE NOT NULL,
  message_text TEXT NOT NULL,
  message_length INTEGER NOT NULL,
  sf INTEGER NOT NULL,
  bw REAL NOT NULL,
  cr INTEGER NOT NULL DEFAULT 1,
  fc REAL NOT NULL DEFAULT 915000000,
  duration REAL NOT NULL,
  n_symbols INTEGER NOT NULL,
  symbols_preview JSONB,
  metadata JSONB,
  tags TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read/write (no auth for this tool)
CREATE POLICY "Anyone can read signals" ON public.signals FOR SELECT USING (true);
CREATE POLICY "Anyone can insert signals" ON public.signals FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete signals" ON public.signals FOR DELETE USING (true);
