-- Add protocol-specific columns to signals table
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS symbol_rate real DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS freq_deviation real DEFAULT 25000,
  ADD COLUMN IF NOT EXISTS chip_rate real DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS sample_rate real DEFAULT 500000,
  ADD COLUMN IF NOT EXISTS encryption_type text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS encryption_key text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bits_per_symbol integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS snr_db real DEFAULT NULL;

-- Update existing records: set appropriate defaults based on mod_type
UPDATE public.signals SET
  symbol_rate = CASE
    WHEN mod_type = 'lora' THEN ROUND(bw / POWER(2, sf))
    WHEN mod_type IN ('bpsk', '2fsk') THEN 10000
    WHEN mod_type IN ('qpsk', '8psk', '4fsk') THEN 5000
    WHEN mod_type = 'cdma' THEN 10000
    ELSE 10000
  END,
  bits_per_symbol = CASE
    WHEN mod_type = 'lora' THEN sf
    WHEN mod_type = 'bpsk' THEN 1
    WHEN mod_type = 'qpsk' THEN 2
    WHEN mod_type = '8psk' THEN 3
    WHEN mod_type = '2fsk' THEN 1
    WHEN mod_type = '4fsk' THEN 2
    WHEN mod_type = 'cdma' THEN 1
    ELSE 1
  END,
  sample_rate = CASE
    WHEN mod_type = 'lora' THEN 500000
    WHEN mod_type = 'cdma' THEN 500000
    ELSE 200000
  END,
  encryption_type = 'none'
WHERE encryption_type IS NULL OR encryption_type = 'none';