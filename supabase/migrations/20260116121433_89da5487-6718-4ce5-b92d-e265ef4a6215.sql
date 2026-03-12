CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_transfer_code
ON public.transfers(transfer_code)
WHERE transfer_code IS NOT NULL;